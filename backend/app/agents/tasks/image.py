"""AI 配图任务 (P3.5 Mock 实现)

依据: docs/09-AI集成方案.md §4.5 (image 任务)
依据: docs/13-P3-进度.md P3.5 计划 (mock 占位)

输入 (run.input):
  - prompt: str  自然语言描述 (必填, 1-500 字符)
  - width: int   图片宽度 (默认 800, 范围 100-2048)
  - height: int  图片高度 (默认 600, 范围 100-2048)
  - site_id: str|None  可选 (P3.5 不写入 Media 表, 仅记录)

输出:
  - image_url: str  生成的图片 URL (picsum.photos, 公开)
  - width: int
  - height: int
  - prompt: str
  - seed: str       picsum seed (用 prompt hash, 保证同 prompt 出同图)
  - provider: str   "mock-picsum"
  - steps_total: int

状态机: validate → fetch → save → finalize (4 步)

# P3.5 决策: 走 picsum.photos 占位, 真实 API (gpt-image-1/SD) 留 TODO 接口.
# 写库逻辑 (Media 表) 留到 P3.5+ 二次, 当前仅返 URL 给前端展示 + accept 写 body.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

import httpx
from loguru import logger
from sqlalchemy import select

from app.agents.router import register
from app.models.ai_run import AIRunStep


# 4 步状态机 (前端可见, generate 是 SSE 流阶段,
# 不算独立步骤, 仅仅复用 SSE 推图)
_STEPS = ["validate", "fetch", "generate", "save", "finalize"]

# picsum.photos 上限 (官方文档)
PICSUM_MAX_SIDE = 5000
PICSUM_TIMEOUT = 10.0  # 秒


@register("image")
async def ai_image(run, db, provider_model) -> dict:
    """AI 配图主函数 (P3.5 mock).

    走 picsum.photos 占位: 同 prompt 出同图 (seed = sha1(prompt)).
    """
    logger.info(f"AI image 启动: run_id={run.id}")

    input_data: dict = run.input or {}
    prompt: str = (input_data.get("prompt") or "").strip()
    width: int = int(input_data.get("width") or 800)
    height: int = int(input_data.get("height") or 600)

    # === 1. validate ===
    if not prompt:
        raise ValueError("prompt 不能为空")
    if len(prompt) > 500:
        raise ValueError(f"prompt 超过 500 字符 (当前 {len(prompt)})")
    if not (100 <= width <= PICSUM_MAX_SIDE):
        raise ValueError(f"width 必须在 100-{PICSUM_MAX_SIDE} 之间 (当前 {width})")
    if not (100 <= height <= PICSUM_MAX_SIDE):
        raise ValueError(f"height 必须在 100-{PICSUM_MAX_SIDE} 之间 (当前 {height})")

    seed = hashlib.sha1(prompt.encode("utf-8")).hexdigest()[:16]
    image_url = f"https://picsum.photos/seed/{seed}/{width}/{height}"

    # 写 4 个 step 行
    for i, name in enumerate(_STEPS, start=1):
        existing = (await db.execute(
            select(AIRunStep).where(
                AIRunStep.run_id == run.id,
                AIRunStep.step_name == name,
            )
        )).scalar_one_or_none()
        if existing is None:
            db.add(AIRunStep(
                run_id=run.id, step_name=name, step_order=i, status="pending",
            ))
    await db.flush()

    # === 2. fetch (拉 picsum head 检查可达, 不下载完整 body 节省带宽) ===
    fetch_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "fetch",
        )
    )).scalar_one()
    fetch_step.status = "running"
    fetch_step.started_at = datetime.now(timezone.utc)
    await db.flush()

    try:
        async with httpx.AsyncClient(timeout=PICSUM_TIMEOUT, follow_redirects=True) as client:
            # picsum 不支持 HEAD (返 405), 用 GET stream 拉头部后立即关闭
            async with client.stream("GET", image_url) as r:
                r.raise_for_status()
                final_url = str(r.url)
                content_length = int(r.headers.get("content-length", 0))
                # 读 1 字节确认 body 真的能流
                async for _ in r.aiter_bytes(1):
                    break
    except httpx.HTTPError as e:
        fetch_step.status = "failed"
        fetch_step.finished_at = datetime.now(timezone.utc)
        fetch_step.error = f"picsum 不可达: {type(e).__name__}: {e or '(no message)'}"
        await db.flush()
        raise ValueError(f"图片生成服务不可达: {type(e).__name__}: {e or '(no message)'}") from e

    fetch_step.status = "success"
    fetch_step.finished_at = datetime.now(timezone.utc)
    fetch_step.output = {
        "url": final_url,
        "size_bytes": content_length,
        "status_code": r.status_code,
    }
    await db.flush()

    # === 3. save (P3.5 简化: 仅记录 metadata, 不写 Media 表) ===
    save_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "save",
        )
    )).scalar_one()
    save_step.status = "running"
    save_step.started_at = datetime.now(timezone.utc)
    await db.flush()

    # P3.5: 走 SSE 推图 — SSE 端点只看 generate step 的 delta
    # generate 阶段推 image_url 一次 (P3.5 简化: 一次性推完整 URL, 非流式)
    gen_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "generate",
        )
    )).scalar_one()
    gen_step.status = "success"
    gen_step.started_at = datetime.now(timezone.utc)
    gen_step.finished_at = datetime.now(timezone.utc)
    gen_step.delta = image_url
    gen_step.output = {"image_url": image_url}
    save_step.delta = image_url
    await db.flush()

    save_step.status = "success"
    save_step.finished_at = datetime.now(timezone.utc)
    save_step.output = {
        "url": image_url,
        "width": width,
        "height": height,
        "size_bytes": content_length,
    }
    await db.flush()

    # === 4. finalize ===
    finalize_step = (await db.execute(
        select(AIRunStep).where(
            AIRunStep.run_id == run.id, AIRunStep.step_name == "finalize",
        )
    )).scalar_one()
    finalize_step.status = "success"
    finalize_step.finished_at = datetime.now(timezone.utc)
    await db.flush()

    output: dict[str, Any] = {
        "image_url": image_url,
        "final_url": final_url,
        "width": width,
        "height": height,
        "prompt": prompt,
        "seed": seed,
        "provider": "mock-picsum",
        "size_bytes": content_length,
        "steps_total": len(_STEPS),
        "tokens_used": 0,  # 图片任务无 token
    }

    logger.info(
        f"AI image 完成: run_id={run.id} prompt={prompt[:30]!r} "
        f"url={image_url} size={content_length}B"
    )
    return output
