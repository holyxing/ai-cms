"""本地开发辅助: 创建一个测试超管 (可选)
用法: uv run python scripts/create_test_user.py
"""
import asyncio

from loguru import logger
from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.user import User


async def main():
    async with AsyncSessionLocal() as db:
        email = "admin@admin.com"
        existing = await db.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none():
            logger.info(f"用户 {email} 已存在")
            return

        user = User(
            email=email,
            name="Admin",
            password_hash=hash_password("admin123456"),
            is_super_admin=True,
        )
        db.add(user)
        await db.commit()
        logger.info(f"✅ 创建超管: {email} / admin123456")


if __name__ == "__main__":
    asyncio.run(main())
