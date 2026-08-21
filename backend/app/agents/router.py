"""AI 任务注册表 (P3.0)

依据: docs/09-AI集成方案.md §4

每个任务 (rewrite / draft / audit / theme / image) 注册一个函数:
- 函数签名: async def task_func(run_id, db, run_repo, **input) -> output
- 状态机: validate → generate → sanitize → save (4 步)
"""
from typing import Awaitable, Callable, Dict

# 类型: task_func(run, db, llm) -> output_dict
TaskFunc = Callable[..., Awaitable[dict]]

_REGISTRY: Dict[str, TaskFunc] = {}


def register(task_type: str):
    """装饰器: 注册任务"""

    def decorator(func: TaskFunc) -> TaskFunc:
        if task_type in _REGISTRY:
            raise ValueError(f"任务 '{task_type}' 已注册")
        _REGISTRY[task_type] = func
        return func

    return decorator


def get_task(task_type: str) -> TaskFunc:
    """获取任务函数, 不存在则 404"""
    if task_type not in _REGISTRY:
        raise KeyError(f"未知 AI 任务类型: {task_type}")
    return _REGISTRY[task_type]


def list_tasks() -> list[str]:
    """列出所有已注册任务"""
    return list(_REGISTRY.keys())


# 触发任务模块的副作用注册
def _bootstrap():
    from app.agents.tasks import _text_transform  # noqa: F401
    from app.agents.tasks import audit  # noqa: F401  # P3.3
    from app.agents.tasks import theme  # noqa: F401  # P3.4
    from app.agents.tasks import image  # noqa: F401  # P3.5
    from app.agents.tasks import redesign  # noqa: F401  # P3.9 AI 设计 (4 动作)
    from app.agents.tasks import extract_assets  # noqa: F401  # P3.9.4 模板 AI: CSS/JS 提取+上传
    from app.agents.tasks import import_file  # noqa: F401  # P3.9.4+ holy 反馈 #12096: Word/PDF/HTML 导入+排版
    from app.agents.tasks import site_agent  # noqa: F401  # P3.9.6+ holy 反馈 #12444: 站点 AI 智能体 (多轮对话)


_bootstrap()
