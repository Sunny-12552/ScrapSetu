"""Email delivery (console for dev, SMTP for configured environments)."""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger("scrapsetu.email")


def provider_status() -> dict:
    configured = settings.email_provider == "console" or bool(
        settings.smtp_host and settings.smtp_username
    )
    return {
        "provider": settings.email_provider,
        "configured": configured,
        "simulated": settings.email_provider == "console",
    }


def send_email(to: str, subject: str, body: str) -> dict:
    if settings.email_provider == "console":
        logger.warning("DEV EMAIL (not delivered) to %s | %s | %s", to, subject, body)
        return {"provider": "console", "simulated": True}
    if not settings.smtp_host:
        raise RuntimeError("SMTP is not configured.")
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_username and settings.smtp_password:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)
    return {"provider": "smtp", "simulated": False}
