from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)


def smtp_configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from)


def send_email(to: str, subject: str, body: str) -> bool:
    """Send a plain-text email. Returns False if SMTP is not configured or send fails."""
    if not smtp_configured():
        logger.warning("SMTP not configured — email to %s was not sent (%s)", to, subject)
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg.set_content(body)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
            if settings.smtp_tls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        logger.info("Sent email to %s: %s", to, subject)
        return True
    except Exception:
        logger.exception("Failed to send email to %s", to)
        return False


def send_password_reset_email(to: str, token: str) -> bool:
    base = settings.app_public_url.rstrip("/")
    link = f"{base}/reset-password?token={token}"
    body = (
        "A password reset was requested for your WACMAKR account.\n\n"
        f"Open this link to choose a new password (expires in {settings.password_reset_expire_minutes} minutes):\n"
        f"{link}\n\n"
        "If you did not request this, you can ignore this email.\n"
    )
    return send_email(to, "Password reset — WACMAKR", body)
