"""自定义异常"""
from typing import Any


class AppException(Exception):
    """应用基础异常"""
    code: int = 50000
    message: str = "Internal error"
    status_code: int = 500

    def __init__(
        self,
        message: str | None = None,
        code: int | None = None,
        status_code: int | None = None,
        data: Any = None,
    ):
        self.message = message or self.message
        self.code = code or self.code
        self.status_code = status_code or self.status_code
        self.data = data
        super().__init__(self.message)


class BadRequest(AppException):
    code = 40000
    message = "Bad request"
    status_code = 400


class Unauthorized(AppException):
    code = 40100
    message = "Unauthorized"
    status_code = 401


class TokenExpired(Unauthorized):
    code = 40101
    message = "Token expired"


class TokenInvalid(Unauthorized):
    code = 40102
    message = "Token invalid"


class Forbidden(AppException):
    code = 40300
    message = "Forbidden"
    status_code = 403


class NotFound(AppException):
    code = 40400
    message = "Not found"
    status_code = 404


class Conflict(AppException):
    code = 40900
    message = "Conflict"
    status_code = 409


class Unprocessable(AppException):
    code = 42200
    message = "Unprocessable entity"
    status_code = 422
