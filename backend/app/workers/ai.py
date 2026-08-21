"""AI Celery worker (P3.0)

依据: docs/09-AI集成方案.md §1 架构 + §4.2 状态机
依据: docs/12-P2-决策.md §E2-E4 (超时/重试/限流)

执行流程 (P3.0 简化):
1. 加载 run 记录
2. 加载 provider 配置
3. 启动独立 event loop (避免 Celery 同步 + async SQLAlchemy 冲突)
4. 执行任务函数 (4 步状态机)
5. 写回 output + status=success/failed
6. 累加 ai_usage_daily
"""
import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from app.agents.router import get_task, list_tasks
from app.db.session import AsyncSessionLocal
from app.models.ai_provider import AIProvider
from app.models.ai_run import AIRun, AIUsageDaily
from app.workers.celery_app import celery_app


def _run_with_loop(coro):
    """在独立 event loop 里跑 async 协程 (Celery 同步环境)

    P2 Day 6 教训: 必须先 dispose 老的 engine, 否则 'attached to a different loop'
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        # 丢弃 worker 启动时创建的连接池, 让新 loop 重新创建
        from app.db.session import engine
        try:
            loop.run_until_complete(engine.dispose())
        except Exception:
            pass
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _execute_run(run_id: UUID):
    """主执行函数"""
    async with AsyncSessionLocal() as db:
        try:
            # 1. 加载 run
            run = await db.get(AIRun, run_id)
            if run is None:
                logger.error(f"AI run 不存在: {run_id}")
                return

            # 已是终态, 跳过 (幂等)
            if run.status in ("success", "failed", "cancelled"):
                logger.warning(f"AI run 已是终态, 跳过: {run_id} status={run.status}")
                return

            # 2. 加载 provider 配置
            provider_model = None
            if run.provider_id:
                provider_model = await db.get(AIProvider, run.provider_id)
                if provider_model and provider_model.deleted_at:
                    provider_model = None  # 已删除的 provider 视为 None
                # P3-minimax: provider 有 key_encrypted 时才用 (否则是 Mock stub, 走 settings fallback)
                if provider_model and not provider_model.api_key_encrypted:
                    provider_model = None

            # P3-minimax: run 没 provider_id 时, 走 settings.AI_DEFAULT_PROVIDER (兑底)
            if provider_model is None:
                from app.core.config import get_settings
                s = get_settings()
                default_prov = s.AI_DEFAULT_PROVIDER
                if default_prov in ("minimax", "openai", "custom"):
                    from types import SimpleNamespace
                    provider_model = SimpleNamespace(
                        id=None,
                        provider=default_prov,
                        base_url=None,
                        api_key_encrypted=None,  # 走 settings fallback
                        model=(
                            s.MINIMAX_DEFAULT_MODEL if default_prov == "minimax"
                            else "gpt-4o-mini"
                        ),
                    )

            # 3. 更新状态 running
            run.status = "running"
            run.started_at = datetime.now(timezone.utc)
            run.current_step = "generate"
            # P3.3 修复: steps_total 读 task 返的 output.steps_total (不同任务 3-4 步不同)
            run.steps_total = 4  # 默认, task 完成后会被 output 里的值覆盖
            run.steps_done = 1  # validate 视为完成 (任务函数内部已校验)
            if provider_model:
                run.model = provider_model.model
            await db.commit()

            # 4. 执行任务
            task_func = get_task(run.task_type)
            output = await task_func(run, db, provider_model)

            # 5. 写回结果
            run.output = output
            run.status = "success"
            run.current_step = "save"
            # P3.3 修复: 优先用 task 返的 steps_total, 默认 4
            run.steps_total = int(output.get("steps_total", 4)) if isinstance(output, dict) else 4
            run.steps_done = run.steps_total
            run.finished_at = datetime.now(timezone.utc)
            # token 统计 (从 output 拿)
            if "tokens_used" in output:
                run.completion_tokens = output.get("tokens_used", 0)
            # 用 provider 算成本
            from app.services.llm.factory import get_provider_for_user
            provider = get_provider_for_user(run.user_id, provider_model)
            run.cost_usd = provider.get_cost(
                run.prompt_tokens or 0,
                run.completion_tokens or 0,
                run.model or "unknown",
            )
            await db.commit()

            # 6. 累加 ai_usage_daily
            await _accumulate_usage(db, run, output)
            await db.commit()

            logger.info(
                f"AI run 完成: {run_id} task={run.task_type} "
                f"tokens={run.completion_tokens or 0} cost=${run.cost_usd}"
            )

        except Exception as e:
            logger.exception(f"AI run 失败: {run_id}: {e}")
            await db.rollback()
            # 重新加载再写失败状态
            try:
                run = await db.get(AIRun, run_id)
                if run:
                    run.status = "failed"
                    run.error_message = str(e)[:1000]
                    run.finished_at = datetime.now(timezone.utc)
                    await db.commit()
            except Exception as e2:
                logger.error(f"写失败状态也失败: {e2}")


async def _accumulate_usage(db, run: AIRun, output: dict):
    """累加 ai_usage_daily"""
    today = datetime.now(timezone.utc).date()
    tokens = output.get("tokens_used", 0)

    stmt = select(AIUsageDaily).where(
        AIUsageDaily.user_id == run.user_id,
        AIUsageDaily.usage_date == today,
        AIUsageDaily.task_type == run.task_type,
    )
    usage = (await db.execute(stmt)).scalar_one_or_none()
    if usage is None:
        usage = AIUsageDaily(
            user_id=run.user_id, usage_date=today, task_type=run.task_type,
            runs_count=1, tokens_used=tokens, cost_usd=run.cost_usd or Decimal("0"),
        )
        db.add(usage)
    else:
        usage.runs_count += 1
        usage.tokens_used += tokens
        usage.cost_usd = (usage.cost_usd or Decimal("0")) + (run.cost_usd or Decimal("0"))
        usage.updated_at = datetime.now(timezone.utc)


@celery_app.task(
    name="app.workers.ai.execute_ai_run",
    bind=True,
    max_retries=1,  # E4 决策: 失败重试 1 次
    soft_time_limit=120,  # AI 单任务 2min 软超时
    time_limit=180,
)
def execute_ai_run(self, run_id: str):
    """Celery 入口: 执行一次 AI run"""
    logger.info(f"Celery 收到 AI run: {run_id}")
    return _run_with_loop(_execute_run(UUID(run_id)))
