"""AI API (P3.0)

依据: docs/09-AI集成方案.md §1 架构
依据: docs/02-API-规范.md (统一响应格式)

端点 (本轮 P3.0 范围):
- POST   /ai/rewrite                    启动改写 (enqueue Celery + 创建 run)
- GET    /ai/runs                       列出我的 runs (分页)
- GET    /ai/runs/{id}                  详情
- GET    /ai/runs/{id}/stream           SSE 流式
- POST   /ai/runs/{id}/accept           接受改写结果 → 写 content_versions
- GET    /ai/providers                  列出我的 providers
- POST   /ai/providers                  新建 provider
- DELETE /ai/providers/{id}             软删

P3.1+ TODO:
- /ai/draft /ai/expand /ai/translate /ai/audit /ai/theme
- /ai/runs/{id}/reject
- 限流 (slowapi)  ✅ P4 已接
- API key Fernet 加密
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from loguru import logger
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.router import list_tasks
from app.core.crypto import decrypt_api_key, encrypt_api_key
from app.core.deps import get_current_user
from app.core.ratelimit import limiter as _limiter
from app.core.responses import ok
from app.db.session import get_db
from app.models.ai_provider import AIProvider
from app.models.ai_run import AIRun, AIRunStep
from app.models.user import User
from app.models.site import Site
from app.schemas.ai import (
    AIRunAcceptIn,
    AIRunAcceptOut,
    AIRunListOut,
    AIRunOut,
    AIRunRejectOut,
    AIProviderCreate,
    AIProviderOut,
    AIRewriteStart,
    AITaskStart,
)
from app.workers.ai import execute_ai_run  # 触发 import 注册

router = APIRouter(prefix="/ai", tags=["ai"])


# ====== Provider CRUD ======
@router.get("/providers")
async def list_providers(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(AIProvider).where(
        AIProvider.user_id == user.id,
        AIProvider.deleted_at.is_(None),
    ).order_by(AIProvider.is_default.desc(), AIProvider.created_at.desc())
    result = await db.execute(stmt)
    items = result.scalars().all()
    out = []
    for i in items:
        d = AIProviderOut.model_validate(i).model_dump(mode="json")
        d["is_configured"] = bool(i.api_key_encrypted)  # P3.1: 脱敏
        out.append(d)
    return ok(out)


@router.post("/providers", status_code=status.HTTP_201_CREATED)
@_limiter.limit("10/minute")
async def create_provider(
    request: Request,
    payload: AIProviderCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # 若 is_default=true, 先把其他默认取消
    if payload.is_default:
        stmt = select(AIProvider).where(
            AIProvider.user_id == user.id,
            AIProvider.is_default.is_(True),
            AIProvider.deleted_at.is_(None),
        )
        for p in (await db.execute(stmt)).scalars():
            p.is_default = False

    p = AIProvider(
        user_id=user.id,
        name=payload.name,
        provider=payload.provider,
        model=payload.model,
        base_url=payload.base_url,
        # P3.1: Fernet 加密入库
        api_key_encrypted=encrypt_api_key(payload.api_key) if payload.api_key else None,
        is_default=payload.is_default,
        extra_config=payload.extra_config,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    d = AIProviderOut.model_validate(p).model_dump(mode="json")
    d["is_configured"] = bool(p.api_key_encrypted)
    return ok(d)


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    p = await db.get(AIProvider, provider_id)
    if p is None or p.user_id != user.id or p.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Provider 不存在")
    p.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return None


# === PATCH /providers/{id} (P3.6.2 补: 编辑现有 provider) ===
class AIProviderUpdate(BaseModel):
    name: str | None = None
    model: str | None = None
    api_key: str | None = None  # 留空 = 不动原 key
    base_url: str | None = None
    is_default: bool | None = None


@router.patch("/providers/{provider_id}")
async def update_provider(
    provider_id: UUID,
    body: AIProviderUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    p = await db.get(AIProvider, provider_id)
    if p is None or p.user_id != user.id or p.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Provider 不存在")

    if body.name is not None: p.name = body.name
    if body.model is not None: p.model = body.model
    if body.base_url is not None: p.base_url = body.base_url
    if body.is_default is not None:
        p.is_default = body.is_default
        if body.is_default:
            # 取消同用户其他 provider 的 default
            from sqlalchemy import update
            await db.execute(
                update(AIProvider)
                .where(AIProvider.user_id == user.id, AIProvider.id != p.id, AIProvider.deleted_at.is_(None))
                .values(is_default=False)
            )
    if body.api_key:  # 留空不动
        p.api_key_encrypted = encrypt_api_key(body.api_key)
    p.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(p)
    d = AIProviderOut.model_validate(p).model_dump(mode="json")
    d["is_configured"] = bool(p.api_key_encrypted)
    return ok(d)


# ====== AI Rewrite ======
@router.post("/rewrite", status_code=status.HTTP_202_ACCEPTED)
@_limiter.limit("30/minute")
async def start_rewrite(
    request: Request,
    payload: AIRewriteStart,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """启动改写任务, 立即返回 run_id, 后端 Celery 异步执行"""
    # 加载 provider
    provider_model = None
    if payload.provider_id:
        provider_model = await db.get(AIProvider, payload.provider_id)
        if provider_model and provider_model.user_id != user.id:
            raise HTTPException(status_code=403, detail="无权使用该 provider")
    else:
        # 用用户的默认 provider (若无, 用全局默认 ollama)
        stmt = select(AIProvider).where(
            AIProvider.user_id == user.id,
            AIProvider.is_default.is_(True),
            AIProvider.deleted_at.is_(None),
        )
        provider_model = (await db.execute(stmt)).scalar_one_or_none()

    # 创建 run
    run = AIRun(
        user_id=user.id,
        site_id=payload.site_id,
        task_type="rewrite",
        status="pending",
        current_step="validate",
        steps_total=4,
        steps_done=0,
        input={
            "original_text": payload.original_text,
            "operation": payload.operation,
            "target_language": payload.target_language,
        },
        provider_id=provider_model.id if provider_model else None,
        model=payload.model or (provider_model.model if provider_model else None),
        content_id=payload.content_id,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    # enqueue Celery
    execute_ai_run.delay(str(run.id))
    logger.info(f"AI rewrite enqueued: run_id={run.id} user_id={user.id}")

    return ok({
        "run_id": str(run.id),
        "status": run.status,
        "stream_url": f"/api/v1/ai/runs/{run.id}/stream",
    })


# ====== Run 列表/详情/SSE ======
@router.get("/runs")
async def list_runs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    task_type: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
):
    base = select(AIRun).where(AIRun.user_id == user.id)
    count_base = select(func.count(AIRun.id)).where(AIRun.user_id == user.id)
    if task_type:
        base = base.where(AIRun.task_type == task_type)
        count_base = count_base.where(AIRun.task_type == task_type)
    if status_filter:
        base = base.where(AIRun.status == status_filter)
        count_base = count_base.where(AIRun.status == status_filter)

    total = (await db.execute(count_base)).scalar() or 0
    offset = (page - 1) * page_size
    stmt = base.order_by(AIRun.created_at.desc()).offset(offset).limit(page_size)
    items = (await db.execute(stmt)).scalars().all()
    return ok(AIRunListOut(
        items=[AIRunOut.model_validate(i).model_dump(mode="json") for i in items],
        total=total, page=page, page_size=page_size,
    ).model_dump(mode="json"))


@router.get("/runs/{run_id}")
async def get_run(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = await db.get(AIRun, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="Run 不存在")
    return ok(AIRunOut.model_validate(run).model_dump(mode="json"))


@router.get("/runs/{run_id}/stream")
async def stream_run(
    run_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """SSE 流式: 推送 ai_run_steps.delta + 最终 output

    简化策略 (P3.0):
    - 每 1s 轮询 DB 拿最新 delta 和 status
    - 终态 (success/failed/cancelled) 后发 [DONE] 关闭
    - client abort / 取消: 不再误报 timeout
    """
    from fastapi.responses import StreamingResponse
    import asyncio
    import json

    # 鉴权
    run = await db.get(AIRun, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="Run 不存在")

    async def event_gen():
        last_delta = ""
        last_status = ""
        last_step_done = -1
        try:
            for _ in range(120):  # 最多 2min (120 * 1s)
                # client 断开: 静默结束, 不要 yield timeout
                if await request.is_disconnected():
                    return

                # 重新查 (避免 session 过期, 用新 session)
                from app.db.session import AsyncSessionLocal
                async with AsyncSessionLocal() as s:
                    r = await s.get(AIRun, run_id)
                    if r is None:
                        yield f"data: {json.dumps({'error': 'gone'})}\n\n"
                        return

                    # 拿 generate step 的 delta
                    step_stmt = select(AIRunStep).where(
                        AIRunStep.run_id == run_id,
                        AIRunStep.step_name == "generate",
                    )
                    gen_step = (await s.execute(step_stmt)).scalar_one_or_none()
                    current_delta = gen_step.delta if gen_step else ""

                # 推 delta (有新内容)
                if current_delta and current_delta != last_delta:
                    yield f"data: {json.dumps({'delta': current_delta[len(last_delta):]}, ensure_ascii=False)}\n\n"
                    last_delta = current_delta

                # 推状态变化
                if r.status != last_status or r.steps_done != last_step_done:
                    yield f"data: {json.dumps({'status': r.status, 'steps_done': r.steps_done, 'current_step': r.current_step}, ensure_ascii=False)}\n\n"
                    last_status = r.status
                    last_step_done = r.steps_done

                # 终态 → 发最终 output 后退出
                if r.status in ("success", "failed", "cancelled"):
                    final = {
                        "status": r.status,
                        "output": r.output,
                        "error": r.error_message,
                    }
                    yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                try:
                    await asyncio.sleep(1)
                except asyncio.CancelledError:
                    return

            # 轮询耗尽: 真正超时 (client 仍在线)
            yield f"data: {json.dumps({'error': 'timeout'})}\n\n"
            yield "data: [DONE]\n\n"
        except asyncio.CancelledError:
            return

    return StreamingResponse(
        event_gen(), media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx 禁用缓冲
        },
    )


# ====== 接受改写结果 ======
@router.post("/runs/{run_id}/accept")
async def accept_rewrite(
    run_id: UUID,
    payload: Optional[AIRunAcceptIn] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """接受 AI 改写结果, 写入 content_versions

    P3.0 简化:
    - 必须有 content_id (新建内容 P3.1)
    - 写一条新 version
    """
    from app.models.content import Content, ContentVersion
    from app.models.membership import SiteMember

    run = await db.get(AIRun, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="Run 不存在")
    if run.status != "success" or not run.output:
        raise HTTPException(status_code=400, detail="Run 未完成, 无法接受")

    # P3.10.5 (holy 反馈 #13285): content_id 优先从 run 自己取, 兑底从 payload
    # 这样前端不需要传 body 也能接受 之前的 text_transform / audit / import / theme 等结果
    content_id = run.content_id or (payload.content_id if payload else None)
    if not content_id:
        raise HTTPException(status_code=400, detail="Run 无关联 content_id")

    rewritten = (
        run.output.get("rewritten_text")
        or run.output.get("audit_report")
        or run.output.get("result_text")
    )
    if not rewritten:
        raise HTTPException(status_code=400, detail="Run 无可接受内容")

    content = await db.get(Content, content_id)
    if content is None:
        raise HTTPException(status_code=404, detail="内容不存在")
    # 鉴权: super_admin bypass + 作者 or 站点 owner/editor
    if not user.is_super_admin:
        is_author = content.author_id == user.id
        if not is_author:
            # 查站点成员
            sm_stmt = select(SiteMember).where(
                SiteMember.site_id == content.site_id,
                SiteMember.user_id == user.id,
                SiteMember.deleted_at.is_(None),
            )
            sm = (await db.execute(sm_stmt)).scalar_one_or_none()
            if sm is None or sm.role not in ("owner", "editor"):
                raise HTTPException(status_code=403, detail="无权操作该内容")

    # 写新 version
    max_ver_stmt = select(func.coalesce(func.max(ContentVersion.version_num), 0)).where(
        ContentVersion.content_id == content.id,
    )
    next_version = (await db.execute(max_ver_stmt)).scalar() + 1
    new_ver = ContentVersion(
        content_id=content.id,
        version_num=next_version,
        title=content.title,
        body=rewritten,
        excerpt=rewritten[:200] if len(rewritten) > 200 else rewritten,
        author_id=user.id,
        is_auto_save=False,
    )
    db.add(new_ver)
    # 同时更新 content 的 published_version_id 指针 (P3.0 简化: 不发布, 仅记录)
    # content.published_version_id = new_ver.id  # P3.0 不动, 让用户手动 publish
    await db.commit()
    await db.refresh(new_ver)

    return ok(AIRunAcceptOut(
        run_id=run.id,
        content_id=content.id,
        version=new_ver.version_num,
        accepted_text=rewritten,
    ).model_dump(mode="json"))


# ====== P3.9 AI 重设计接受 (走 layout_version) ======
@router.post("/runs/{run_id}/accept-redesign")
async def accept_redesign(
    run_id: UUID,
    payload: Optional[AIRunAcceptIn] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """接受 AI 重设计结果, 写入 layout_versions + 更新 layouts.html

    P3.9:
    - 接受 redesign run (optimize_design/responsive/a11y/seo)
    - 写一条新 layout_version, version 自增
    - 同时把 layouts.html 同步更新
    """
    from app.models.layout import Layout, LayoutVersion
    from app.models.membership import SiteMember

    run = await db.get(AIRun, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="Run 不存在")
    if run.status != "success" or not run.diff_html:
        raise HTTPException(status_code=400, detail="Run 未完成或无 diff_html")
    if not run.layout_id:
        raise HTTPException(status_code=400, detail="Run 不是 redesign 任务 (无 layout_id)")

    # 加载 layout
    layout = await db.get(Layout, run.layout_id)
    if layout is None:
        raise HTTPException(status_code=404, detail="Layout 不存在")

    # 鉴权: 站点 owner 自动有权限; 否则查 site_member
    if not user.is_super_admin:
        site = await db.get(Site, layout.site_id)
        is_owner = site is not None and site.owner_id == user.id
        sm_stmt = select(SiteMember).where(
            SiteMember.site_id == layout.site_id,
            SiteMember.user_id == user.id,
            SiteMember.deleted_at.is_(None),
        )
        sm = (await db.execute(sm_stmt)).scalar_one_or_none()
        if not (is_owner or (sm and sm.role in ("owner", "editor"))):
            raise HTTPException(status_code=403, detail="无权操作该 layout")

    # 写新 version (跟 PUT /layouts/{id} 一致逻辑)
    new_html = run.diff_html
    change_note = f"AI {run.task_type} (run {str(run.id)[:8]})"
    if run.design_lang:
        change_note += f" [{run.design_lang}]"
    new_ver = LayoutVersion(
        layout_id=layout.id,
        version=layout.version + 1,
        html=new_html,
        change_note=change_note,
        author_id=user.id,
    )
    db.add(new_ver)
    layout.version = layout.version + 1
    layout.html = new_html

    await db.commit()
    await db.refresh(layout)
    logger.info(
        f"AI redesign 接受: run_id={run.id} layout_id={layout.id} v{layout.version} "
        f"task={run.task_type} lang={run.design_lang}"
    )
    return ok({
        "run_id": str(run.id),
        "layout_id": str(layout.id),
        "version": layout.version,
        "html_length": len(new_html),
        "task_type": run.task_type,
        "design_lang": run.design_lang,
    })


# ====== P3.1 拒绝 ======
@router.post("/runs/{run_id}/reject")
async def reject_run(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """拒绝 AI 结果, 状态改 cancelled

    P3.1: 只允许 pending/running/success 状态的 run 被拒绝
    """
    run = await db.get(AIRun, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="Run 不存在")
    if run.status in ("cancelled", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Run 状态为 {run.status}, 无法拒绝",
        )
    run.status = "cancelled"
    from datetime import datetime as _dt, timezone as _tz
    if not run.finished_at:
        run.finished_at = _dt.now(_tz.utc)
    await db.commit()
    return ok(AIRunRejectOut(run_id=run.id, status=run.status).model_dump(mode="json"))


# ====== P3.1 通用 start 端点 (按 task_type 分发) ======
_VALID_TASK_TYPES = ("rewrite", "expand", "shorten", "polish", "translate", "draft", "audit", "theme", "image", "optimize_design", "responsive", "a11y", "seo", "format_html", "extract_assets", "import_docx", "import_pdf", "import_paste_html", "site_agent")


@router.post("/tasks/{task_type}/start", status_code=status.HTTP_202_ACCEPTED)
@_limiter.limit("30/minute")
async def start_task(
    request: Request,
    task_type: str,
    payload: AITaskStart,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """通用 AI 任务启动端点 (P3.1)

    - task_type in (rewrite, expand, shorten, polish, translate, draft)
    - payload.input 透传到 ai_runs.input 字段
    - 后端 worker 按 task_type 调用对应函数
    """
    if task_type not in _VALID_TASK_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"task_type 必须是 {_VALID_TASK_TYPES} 之一, 收到 '{task_type}'",
        )

    # 加载 provider (与 /rewrite 一致逻辑)
    provider_model = None
    if payload.provider_id:
        provider_model = await db.get(AIProvider, payload.provider_id)
        if provider_model and provider_model.user_id != user.id:
            raise HTTPException(status_code=403, detail="无权使用该 provider")
    else:
        stmt = select(AIProvider).where(
            AIProvider.user_id == user.id,
            AIProvider.is_default.is_(True),
            AIProvider.deleted_at.is_(None),
        )
        provider_model = (await db.execute(stmt)).scalar_one_or_none()
        # P3-minimax: is_default 但没 key (Mock stub) → 不作数, 走 settings fallback
        if provider_model and not provider_model.api_key_encrypted:
            provider_model = None
        # P3-minimax: user 没 is_default provider 时, worker 端走 settings 兑底
        # (不设虚拟 provider, 让 worker 拿 settings.AI_DEFAULT_PROVIDER)

    run = AIRun(
        user_id=user.id,
        site_id=payload.site_id,
        task_type=task_type,
        status="pending",
        current_step="validate",
        steps_total=4,
        steps_done=0,
        input=payload.input,
        provider_id=provider_model.id if provider_model else None,
        model=payload.model or (provider_model.model if provider_model else None),
        content_id=payload.content_id,
        layout_id=payload.layout_id,  # P3.9 redesign 专用
        design_lang=payload.design_lang,  # P3.9 redesign 专用
        conversation_id=payload.conversation_id,  # P3.9.6+ site_agent 多轮对话
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    execute_ai_run.delay(str(run.id))
    logger.info(
        f"AI {task_type} enqueued: run_id={run.id} user_id={user.id} provider={provider_model.name if provider_model else 'default'}"
    )

    return ok({
        "run_id": str(run.id),
        "task_type": task_type,
        "status": run.status,
        "stream_url": f"/api/v1/ai/runs/{run.id}/stream",
    })


# ====== 元信息 ======
@router.get("/tasks")
async def list_supported_tasks(user: User = Depends(get_current_user)):
    """列出后端已注册的 AI 任务类型 (前端按钮动态显示)"""
    return ok({"tasks": list_tasks()})


# ====== Prompt 统一管理（可读；改/导入需超管，方便外部工具对接） ======
class AIPromptUpdate(BaseModel):
    content: str


class AIPromptImportBody(BaseModel):
    items: list[dict]
    overwrite: bool = True


@router.get("/prompts")
async def list_ai_prompts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    category: Optional[str] = Query(None, description="task|quick|enhance|import"),
):
    """列出全部 AI prompt（登录可读，供快捷操作/设置页/工具拉取）"""
    from app.agents.prompts.service import ensure_prompts_seeded, prompt_to_dict
    from app.models.ai_prompt import AIPrompt

    await ensure_prompts_seeded(db)
    stmt = select(AIPrompt).order_by(AIPrompt.category, AIPrompt.key)
    if category:
        stmt = stmt.where(AIPrompt.category == category)
    rows = (await db.execute(stmt)).scalars().all()
    return ok({"items": [prompt_to_dict(r) for r in rows], "total": len(rows)})


@router.get("/prompts/export")
async def export_ai_prompts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """导出 JSON，便于脚本 / Langfuse 等工具同步"""
    from app.agents.prompts.service import export_prompts

    return ok(await export_prompts(db))


@router.post("/prompts/import")
async def import_ai_prompts(
    body: AIPromptImportBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """批量导入（工具对接）：items=[{key, content, ...}]"""
    from app.agents.prompts.service import import_prompts
    from app.core.exceptions import Forbidden

    if not user.is_super_admin:
        raise Forbidden("仅超管可导入 Prompt")
    stats = await import_prompts(
        db, body.items, user_id=user.id, overwrite=body.overwrite,
    )
    return ok(stats)


@router.get("/prompts/{key:path}")
async def get_ai_prompt(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.agents.prompts.service import ensure_prompts_seeded, prompt_to_dict
    from app.models.ai_prompt import AIPrompt

    await ensure_prompts_seeded(db)
    row = (await db.execute(select(AIPrompt).where(AIPrompt.key == key))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="prompt 不存在")
    return ok(prompt_to_dict(row))


@router.patch("/prompts/{key:path}")
async def update_ai_prompt(
    key: str,
    body: AIPromptUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.agents.prompts.service import ensure_prompts_seeded, prompt_to_dict, update_prompt
    from app.core.exceptions import Forbidden

    if not user.is_super_admin:
        raise Forbidden("仅超管可修改系统 Prompt")
    await ensure_prompts_seeded(db)
    try:
        row = await update_prompt(db, key, body.content, user_id=user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail="prompt 不存在")
    return ok(prompt_to_dict(row))


@router.post("/prompts/{key:path}/reset")
async def reset_ai_prompt(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.agents.prompts.service import ensure_prompts_seeded, prompt_to_dict, reset_prompt
    from app.core.exceptions import Forbidden

    if not user.is_super_admin:
        raise Forbidden("仅超管可重置系统 Prompt")
    await ensure_prompts_seeded(db)
    try:
        row = await reset_prompt(db, key, user_id=user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail="prompt 不存在")
    return ok(prompt_to_dict(row))
