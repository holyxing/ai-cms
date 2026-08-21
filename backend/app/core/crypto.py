"""API Key Fernet 加密 (P3.1)

依据: docs/09-AI集成方案.md §3.2 (api_key 加密)
依据: docs/07-开发注意事项.md §P3 坑 "AI Key 加密 Fernet"

Fernet = 对称加密 (AES-128-CBC + HMAC-SHA256)
密钥: 从 settings.FERNET_KEY 读 (32 字节 url-safe base64)
"""
from cryptography.fernet import Fernet, InvalidToken
from loguru import logger

from app.core.config import get_settings


def _get_fernet() -> Fernet:
    settings = get_settings()
    key = (settings.FERNET_KEY or "").strip()
    if not key:
        raise RuntimeError(
            "未配置 FERNET_KEY, 无法加解密 API Key。"
            "请在环境变量或 .env 中设置 FERNET_KEY。"
            '生成方式: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_api_key(plain: str) -> str:
    """加密 API key (明文 → Fernet token)"""
    if not plain:
        return ""
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_api_key(token: str) -> str:
    """解密 API key (Fernet token → 明文)

    失败时返空字符串, 不抛异常 (兼容老数据 / 未加密数据)
    """
    if not token:
        return ""
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        # 老数据 / 错误密钥, 不阻塞流程
        logger.warning("API key 解密失败, 可能是未加密或密钥错误")
        return ""
    except Exception as e:
        logger.error(f"API key 解密异常: {e}")
        return ""
