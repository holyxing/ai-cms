"""邮件发送 (P5.2 自助找回密码)

策略:
- ENV=dev: 邮件发到控制台日志 (不真发, 方便开发)
- ENV=prod: 用 SMTP_* 配置真发邮件

接口:
- send_password_reset_email(to_email: str, reset_url: str, user_name: str)
"""
import logging
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def send_password_reset_email(
    to_email: str,
    reset_url: str,
    user_name: str,
) -> bool:
    """发送密码重置链接

    Returns: True=成功, False=失败 (调用方自己 toast 重试, 不抛错)
    """
    settings = get_settings()
    subject = "重置您的 AI-CMS 密码"

    html = f"""
    <p>您好 {user_name},</p>
    <p>您 (或其他人) 刚刚请求重置您的 AI-CMS 账户密码。</p>
    <p>请点击以下链接重置密码 (1 小时内有效):</p>
    <p style="margin: 16px 0;">
        <a href="{reset_url}" style="padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">
            重置密码
        </a>
    </p>
    <p>如果按钮无法点击, 请复制以下链接到浏览器:</p>
    <p style="word-break: break-all; color: #666;">{reset_url}</p>
    <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;" />
    <p style="color: #999; font-size: 12px;">
        如果您没有请求重置密码, 请忽略此邮件. 您的账户仍然安全.
    </p>
    """

    if settings.ENV == "dev":
        # 开发环境: 控制台日志 + 返 reset_url 给 API 响应 (方便 E2E 测)
        logger.warning(
            "📧 [DEV EMAIL] To: %s | Subject: %s | URL: %s",
            to_email, subject, reset_url,
        )
        return True

    # 生产: SMTP
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM
        msg["To"] = to_email
        msg.attach(MIMEText(html, "html"))

        context = ssl.create_default_context()
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls(context=context)
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        return True
    except Exception as e:
        logger.exception("SMTP 发送失败: %s", e)
        return False
