"""Celery 应用 (P0 + P2 配置)

依据: docs/12-P2-决策.md §E2 (10min 超时) + §E3 (worker prefetch=1)
"""
from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "ai_cms",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.workers.publish",
        "app.workers.ai",
        "app.workers.scheduler",  # P3.5 scheduled → published
        "app.workers.media",  # P3.6.2 媒体缩略图
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone=settings.TZ,
    enable_utc=False,
    task_track_started=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # E3 决策: 1 worker 同时只跑 1 任务, 避免资源争抢
    worker_prefetch_multiplier=1,
    # E2 决策: 软超时 9min, 硬超时 10min
    task_soft_time_limit=540,
    task_time_limit=600,
    # 避免 worker 启动后一直没收到任务导致超时
    broker_connection_retry_on_startup=True,
    # P3.5: Beat 调度 (状态机定时任务)
    beat_schedule={
        "promote-scheduled-contents": {
            "task": "app.workers.scheduler.promote_scheduled",
            "schedule": 60.0,  # 每分钟
        },
    },
)
