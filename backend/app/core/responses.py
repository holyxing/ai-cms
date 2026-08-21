"""统一响应格式"""
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class APIResponse(BaseModel, Generic[T]):
    """统一响应"""
    code: int = 0
    message: str = "ok"
    data: T | None = None


class Pagination(BaseModel, Generic[T]):
    """分页响应"""
    items: list[T]
    total: int
    page: int = 1
    page_size: int = 20

    @property
    def pages(self) -> int:
        return (self.total + self.page_size - 1) // self.page_size


class APIError(BaseModel):
    """错误响应"""
    code: int
    message: str
    data: Any | None = None
    errors: list[dict] | None = None


def ok(data: Any = None, message: str = "ok") -> dict:
    return {"code": 0, "message": message, "data": data}


def page_resp(items: list, total: int, page: int = 1, page_size: int = 20) -> dict:
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        },
    }


def err(
    code: int,
    message: str,
    data: Any = None,
    errors: list[dict] | None = None,
) -> dict:
    return {"code": code, "message": message, "data": data, "errors": errors}
