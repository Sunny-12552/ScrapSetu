"""SMS providers. The console adapter is explicit local development only."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.core.config import settings

logger = logging.getLogger("scrapsetu.sms")


@dataclass
class DeliveryResult:
    provider: str
    simulated: bool
    detail: str = ""


def provider_status() -> dict:
    configured = {
        "console": True,
        "msg91": bool(settings.msg91_auth_key and settings.msg91_template_id),
        "twilio": bool(
            settings.twilio_account_sid
            and settings.twilio_auth_token
            and settings.twilio_from_number
        ),
    }
    return {
        "provider": settings.sms_provider,
        "configured": configured.get(settings.sms_provider, False),
        "simulated": settings.sms_provider == "console",
    }


def send_sms(phone: str, message: str) -> DeliveryResult:
    provider = settings.sms_provider
    if provider == "console":
        logger.warning(
            "DEV SMS (not delivered) to %s: %s", phone, message
        )
        return DeliveryResult(provider="console", simulated=True, detail="logged to server")
    if provider == "msg91":
        if not (settings.msg91_auth_key and settings.msg91_template_id):
            raise RuntimeError("MSG91 credentials are not configured.")
        response = httpx.post(
            "https://control.msg91.com/api/v5/flow/",
            headers={"authkey": settings.msg91_auth_key, "Content-Type": "application/json"},
            json={
                "template_id": settings.msg91_template_id,
                "sender": settings.msg91_sender_id,
                "recipients": [{"mobiles": phone.lstrip("+"), "message": message}],
            },
            timeout=15,
        )
        response.raise_for_status()
        return DeliveryResult(provider="msg91", simulated=False)
    if provider == "twilio":
        if not (
            settings.twilio_account_sid
            and settings.twilio_auth_token
            and settings.twilio_from_number
        ):
            raise RuntimeError("Twilio credentials are not configured.")
        sid = settings.twilio_account_sid
        response = httpx.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            auth=(sid, settings.twilio_auth_token),
            data={
                "To": phone,
                "From": settings.twilio_from_number,
                "Body": message,
            },
            timeout=15,
        )
        response.raise_for_status()
        return DeliveryResult(provider="twilio", simulated=False)
    raise RuntimeError(f"Unsupported SMS provider: {provider}")
