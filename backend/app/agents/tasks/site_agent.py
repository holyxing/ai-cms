"""站点 AI 智能体 (P3.9.6+ holy 反馈 #12444)

依据: docs/09-AI集成方案.md + dashboard AI 站点助手

多轮对话: 同 conversation_id 把多次 run 串起来, 拼历史.
LLM 返两种结构化 JSON 之一:
  A. { kind: "reply", message, questions? }              — 普通对话
  B. { kind: "propose_action", message, action, preview } — 前端弹确认卡片

前端 (SiteAIPanel) 解析 output, 看到 propose_action 就显示 ConfirmCard, 用户点确认
才调真实 API 写库. AI 永远不直接调后端 mutation.

输入 (run.input):
  {
    user_input: str,         # 本轮用户输入
    conversation_id: uuid,   # 多轮关联
    sites_context: [...],    # 可选, 前端预拉, 1 站 ≈ 50 token
  }

输出 (run.output):
  {
    kind: "reply" | "propose_action",
    message: str,
    questions?: [...],
    action?: { type, params },
    preview?: { title, rows },
    history_used: int,
    tokens_used: int,
    steps_total: 1,
  }
"""
from __future__ import annotations

import json
import re
import uuid  # noqa: F401 - 用在 _load_sites_context 注解
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from sqlalchemy import select

from app.agents.router import register
from app.models.ai_run import AIRun, AIRunStep
from app.models.site import Site, SiteDomain
from app.services.llm.factory import get_provider_for_user
from app.services.llm.base import LLMMessage


# 4 步状态机 (validate → load_history → generate → parse) - 跟审计对齐
_STEPS = ["validate", "load_history", "generate", "parse"]
# 多轮最大历史条数 (跟 YAML defaults.max_history 一致, 留 fallback)
_MAX_HISTORY = 12


@register("site_agent")
async def ai_site_agent(run, db, provider_model) -> dict:
    """站点 AI 智能体主函数.

    - 拿同 conversation_id 的历史 run (按时间正序)
    - 拼 LLM messages (system 含 sites_context + history + user_input)
    - 解析 LLM 返的 JSON, 校验 action 字段
    - 不实际执行 action (前端确认后调 API)
    """
    logger.info(f"AI site_agent 启动: run_id={run.id} conv_id={run.conversation_id}")

    input_data = run.input or {}
    user_input: str = (input_data.get("user_input") or "").strip()
    sites_context_override = input_data.get("sites_context")  # 前端预拉

    # === 1. validate ===
    if not user_input:
        raise ValueError("user_input 不能为空")
    if len(user_input) > 2000:
        raise ValueError(f"user_input 超过 2000 字符 (当前 {len(user_input)})")

    from datetime import datetime, timezone
    for i, name in enumerate(_STEPS, start=1):
        existing = (await db.execute(
            select(AIRunStep).where(
                AIRunStep.run_id == run.id, AIRunStep.step_name == name,
            )
        )).scalar_one_or_none()
        if existing is None:
            db.add(AIRunStep(
                run_id=run.id, step_name=name, step_order=i, status="pending",
            ))
    await db.flush()

    validate_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "validate",
        )
    )).scalar_one()
    validate_step.status = "success"
    validate_step.finished_at = datetime.now(timezone.utc)
    validate_step.output = {"input_length": len(user_input)}

    # === 2. load_history + sites_context ===
    history_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "load_history",
        )
    )).scalar_one()
    history_step.status = "running"
    history_step.started_at = datetime.now(timezone.utc)

    # 拿用户可访问的站点列表 (跨站聚合, owner + member + super_admin)
    if sites_context_override and isinstance(sites_context_override, list):
        sites_ctx = sites_context_override
    else:
        sites_ctx = await _load_sites_context(db, run.user_id)

    # 拿历史对话 (同 conversation_id 排除自己, 按 created_at 升序, 取最近 N 条)
    history_msgs: list[dict] = []
    history_used = 0
    if run.conversation_id:
        stmt = (
            select(AIRun)
            .where(
                AIRun.conversation_id == run.conversation_id,
                AIRun.id != run.id,
                AIRun.status.in_(("success", "failed")),
            )
            .order_by(AIRun.created_at.asc())
            .limit(_MAX_HISTORY)
        )
        past_runs = (await db.execute(stmt)).scalars().all()
        for pr in past_runs:
            past_input = pr.input or {}
            past_output = pr.output or {}
            past_user = (past_input.get("user_input") or "").strip()
            past_assistant = _summarize_past_output(past_output)
            if past_user:
                history_msgs.append({"role": "user", "content": past_user})
            if past_assistant:
                history_msgs.append({"role": "assistant", "content": past_assistant})
        history_used = len(past_runs)

    history_step.status = "success"
    history_step.finished_at = datetime.now(timezone.utc)
    history_step.output = {
        "history_count": history_used,
        "sites_count": len(sites_ctx),
    }

    # === 3. generate (LLM 调) ===
    generate_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "generate",
        )
    )).scalar_one()
    generate_step.status = "running"
    generate_step.started_at = datetime.now(timezone.utc)

    # P3.4: YAML + DB
    from app.agents.prompts import resolve_task_system_prompt
    _HARDCODED_PROMPT = (
        "你是 AI-CMS 的「站点 AI 智能体」. "
        "帮助用户创建/管理/发布站点. "
        "输出 JSON: {kind:'reply'|message,...} 或 {kind:'propose_action',message,action:{type,params},preview:{...}}"
    )
    system_template = await resolve_task_system_prompt(db, "site_agent", _HARDCODED_PROMPT)
    # 拼模板变量
    sites_context_text = _format_sites_context(sites_ctx)
    history_text = _format_history(history_msgs)
    system_prompt = (
        system_template
        .replace("{sites_context}", sites_context_text)
        .replace("{history}", history_text)
        .replace("{user_input}", user_input)
    )

    provider = get_provider_for_user(
        user_id=run.user_id, provider_config=provider_model,
    )
    model = run.model or "qwen2.5:1.5b"

    accumulated: list[str] = []
    total_prompt_tokens = 0
    total_completion_tokens = 0

    # messages 列表: [system, ...history, user]
    messages: list[LLMMessage] = [LLMMessage(role="system", content=system_prompt)]
    for m in history_msgs:
        messages.append(LLMMessage(role=m["role"], content=m["content"]))
    messages.append(LLMMessage(role="user", content=user_input))

    async for chunk in provider.stream(messages, model=model):
        if chunk.delta:
            accumulated.append(chunk.delta)
            generate_step.delta = "".join(accumulated[-300:])
        if chunk.prompt_tokens:
            total_prompt_tokens = chunk.prompt_tokens
        if chunk.completion_tokens:
            total_completion_tokens = chunk.completion_tokens

    raw = "".join(accumulated).strip()
    generate_step.delta = raw

    # === 4. parse ===
    parse_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "parse",
        )
    )).scalar_one()
    parse_step.status = "running"
    parse_step.started_at = datetime.now(timezone.utc)

    parsed = _parse_site_agent_json(raw)

    # 校验 action 字段 (防御 AI 幻觉/越权)
    validated_action = await _validate_action(parsed.get("action"), sites_ctx, db) if parsed.get("action") else None

    output = {
        "kind": parsed.get("kind", "reply"),
        "message": str(parsed.get("message", "")).strip()[:600],
        "questions": parsed.get("questions") or None,
        "action": validated_action,
        "preview": parsed.get("preview") or None,
        "history_used": history_used,
        "sites_count": len(sites_ctx),
        "tokens_used": total_prompt_tokens + total_completion_tokens,
        "steps_total": len(_STEPS),
        "raw_length": len(raw),
    }

    generate_step.status = "success"
    generate_step.finished_at = datetime.now(timezone.utc)
    generate_step.output = {"raw_length": len(raw)}

    parse_step.status = "success"
    parse_step.finished_at = datetime.now(timezone.utc)
    parse_step.output = {
        "kind": output["kind"],
        "action_type": validated_action.get("type") if validated_action else None,
    }

    logger.info(
        f"AI site_agent 完成: run_id={run.id} kind={output['kind']} "
        f"action={output['action']} tokens={output['tokens_used']}"
    )
    return output


# ============ 辅助函数 ============

async def _load_sites_context(db, user_id: uuid.UUID) -> list[dict]:
    """加载用户可访问的站点列表 (含域名) 作为 AI context."""
    from app.models.user import User
    from app.models.membership import SiteMember

    user = await db.get(User, user_id)
    if user is None:
        return []
    if user.is_super_admin:
        site_q = select(Site).where(Site.deleted_at.is_(None))
    else:
        # owner + member
        member_site_ids = select(SiteMember.site_id).where(
            SiteMember.user_id == user.id,
            SiteMember.deleted_at.is_(None),
        )
        site_q = select(Site).where(
            Site.deleted_at.is_(None),
            (Site.owner_id == user.id) | (Site.id.in_(member_site_ids)),
        )
    sites = (await db.execute(site_q.order_by(Site.slug))).scalars().all()

    # 一次查所有域名
    site_ids = [s.id for s in sites]
    domains_by_site: dict[uuid.UUID, list[dict]] = {sid: [] for sid in site_ids}
    if site_ids:
        from sqlalchemy.orm import selectinload
        d_q = select(SiteDomain).where(
            SiteDomain.site_id.in_(site_ids),
            SiteDomain.deleted_at.is_(None),
        )
        for d in (await db.execute(d_q)).scalars().all():
            domains_by_site.setdefault(d.site_id, []).append({
                "id": str(d.id),
                "domain": d.domain,
                "type": d.type,
                "ssl_status": d.ssl_status,
            })

    return [
        {
            "id": str(s.id),
            "slug": s.slug,
            "name": s.name,
            "description": (s.description or "")[:200],
            "status": s.status,
            "publish_status": s.publish_status,
            "owner_id": str(s.owner_id),
            "domains": domains_by_site.get(s.id, []),
        }
        for s in sites
    ]


def _format_sites_context(sites: list[dict]) -> str:
    """格式化为紧凑文本 (省 token). 例:
    [1] id=... slug=demo-site name=AI-CMS 演示站点 status=active domains=2
        domains:
          - id=... domain=demo.com type=primary ssl=pending
    """
    if not sites:
        return "(用户当前无任何可访问站点, 只能创建新站)"
    lines = []
    for i, s in enumerate(sites, 1):
        lines.append(
            f"[{i}] id={s['id']} slug={s['slug']} name={s['name']} "
            f"status={s['status']} publish={s['publish_status']} "
            f"domains={len(s.get('domains', []))}"
        )
        for d in s.get("domains", []):
            lines.append(f"    - id={d['id']} domain={d['domain']} type={d['type']} ssl={d['ssl_status']}")
    return "\n".join(lines)


def _format_history(messages: list[dict]) -> str:
    """把 [{role, content}...] 拼成 system 注入的 history 文本."""
    if not messages:
        return "(无历史对话)"
    lines = []
    for m in messages:
        role = "用户" if m["role"] == "user" else "助手"
        c = m["content"][:500]
        lines.append(f"{role}: {c}")
    return "\n".join(lines)


def _summarize_past_output(output: dict) -> str:
    """把过去 AI 返的 output 还原成 assistant 文本 (喂给历史)."""
    if not output:
        return ""
    kind = output.get("kind", "reply")
    msg = output.get("message", "")
    if kind == "propose_action" and output.get("action"):
        act = output["action"]
        preview = output.get("preview", {})
        rows = preview.get("rows", [])
        rows_text = "; ".join(f"{r[0]}={r[1]}" for r in rows[:5]) if rows else ""
        return f"{msg} [提议动作: {act.get('type')} {rows_text}]"
    return msg


def _parse_site_agent_json(raw: str) -> dict[str, Any]:
    """从 LLM 文本抽 JSON. 容错: 去掉 ``` 包裹 + 找首 { 末 } + 失败 fallback reply."""
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```$", "", s)
    if "{" in s:
        start = s.index("{")
        if "}" in s[start:]:
            end = s.rindex("}")
            s = s[start:end + 1]
    try:
        data = json.loads(s)
    except Exception as e:
        logger.warning(f"site_agent JSON 解析失败: {e}, raw={raw[:200]}")
        # fallback: 整个 raw 当 reply
        return {"kind": "reply", "message": raw[:400] or "AI 没能理解, 请换种说法"}
    if not isinstance(data, dict):
        return {"kind": "reply", "message": "AI 返回格式错"}
    kind = data.get("kind")
    if kind not in ("reply", "propose_action"):
        return {"kind": "reply", "message": str(data.get("message", ""))[:400] or raw[:400]}
    return data


async def _validate_action(action: dict | None, sites_ctx: list[dict], db) -> dict | None:
    """校验 AI 提议的 action 合法 (防幻觉/越权).
    - site_id 必须在 sites_ctx 里
    - create_site: 校验 slug 格式
    - update_site: 必须是 sites_ctx 里的
    - publish_site: 必须是 sites_ctx 里的
    - add_domain: 域名格式
    - remove_domain: domain_id 必须在 sites_ctx 里的某站
    """
    if not action or not isinstance(action, dict):
        return None
    t = action.get("type")
    params = action.get("params") or {}

    if t == "create_site":
        slug = (params.get("slug") or "").strip().lower()
        if not slug or not re.match(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$", slug):
            return {"type": "create_site", "params": params, "error": "slug 格式错"}
        # 查 slug 是否已被占用
        from sqlalchemy import select
        existing = (await db.execute(
            select(Site).where(Site.slug == slug, Site.deleted_at.is_(None))
        )).scalar_one_or_none()
        if existing:
            return {"type": "create_site", "params": params, "error": f"slug '{slug}' 已被占用"}
        return {"type": t, "params": params}

    if t in ("update_site", "publish_site"):
        sid = params.get("site_id")
        if not sid or not any(s["id"] == sid for s in sites_ctx):
            return {"type": t, "params": params, "error": f"site_id '{sid}' 不在你可访问的列表中"}
        return {"type": t, "params": params}

    if t == "add_domain":
        sid = params.get("site_id")
        domain = (params.get("domain") or "").strip().lower()
        if not sid or not any(s["id"] == sid for s in sites_ctx):
            return {"type": t, "params": params, "error": f"site_id '{sid}' 不在你可访问的列表中"}
        if not re.match(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$", domain):
            return {"type": t, "params": params, "error": f"域名 '{domain}' 格式错"}
        return {"type": t, "params": params}

    if t == "remove_domain":
        sid = params.get("site_id")
        did = params.get("domain_id")
        if not sid or not any(s["id"] == sid for s in sites_ctx):
            return {"type": t, "params": params, "error": f"site_id '{sid}' 不在你可访问的列表中"}
        in_ctx = False
        for s in sites_ctx:
            if s["id"] == sid and any(d["id"] == did for d in s.get("domains", [])):
                in_ctx = True
                break
        if not in_ctx:
            return {"type": t, "params": params, "error": f"domain_id '{did}' 不在该站域名列表里"}
        return {"type": t, "params": params}

    # 未知 action type - 拒绝
    return {"type": t, "params": params, "error": f"未知 action 类型: {t}"}
