"""Application configuration. All secrets come from the environment."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- application ---
    app_name: str = "ScrapSetu"
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = False
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"
    timezone: str = "Asia/Kolkata"
    default_city: str = "Hyderabad"
    default_city_slug: str = "hyderabad"
    public_web_url: str = "http://localhost:5173"

    # --- security ---
    secret_key: str = Field(
        default="dev-only-insecure-secret-change-me-0123456789abcdef",
        min_length=32,
    )
    access_token_ttl_minutes: int = 20
    refresh_token_ttl_days: int = 30
    otp_ttl_minutes: int = 5
    otp_max_attempts: int = 5
    otp_resend_seconds: int = 45
    otp_length: int = 6
    otp_dev_mode: bool = True
    secure_cookies: bool = False
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
    ]

    # --- database ---
    database_url: str = "sqlite:///./scrapsetu.db"
    db_echo: bool = False

    # --- uploads / storage ---
    storage_backend: Literal["local", "s3"] = "local"
    storage_dir: str = "./var/uploads"
    max_upload_mb: int = 6
    max_images_per_request: int = 8
    s3_endpoint_url: str | None = None
    s3_region: str = "ap-south-1"
    s3_bucket: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_presign_seconds: int = 900

    # --- integrations ---
    sms_provider: Literal["console", "msg91", "twilio"] = "console"
    msg91_auth_key: str | None = None
    msg91_template_id: str | None = None
    msg91_sender_id: str | None = None
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None

    email_provider: Literal["console", "smtp"] = "console"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "no-reply@scrapsetu.local"
    smtp_use_tls: bool = True

    maps_provider: Literal["none", "google", "mapbox"] = "none"
    google_maps_api_key: str | None = None
    mapbox_access_token: str | None = None

    payment_gateway: Literal["manual"] = "manual"
    payment_gateway_key_id: str | None = None
    payment_gateway_key_secret: str | None = None
    payment_webhook_secret: str | None = None

    # --- operational ---
    enable_scheduler: bool = True
    offer_expiry_sweep_seconds: int = 60
    rate_limit_enabled: bool = True
    max_requests_per_minute: int = 120
    seed_demo_on_startup: bool = False
    allow_demo_seed: bool = True

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            raw = value.strip()
            if raw.startswith("["):
                import json

                try:
                    parsed = json.loads(raw)
                except ValueError:
                    parsed = None
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
                return []
            return [o.strip() for o in raw.split(",") if o.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def is_test(self) -> bool:
        return self.environment == "test"

    @property
    def storage_path(self) -> Path:
        p = Path(self.storage_dir)
        if not p.is_absolute():
            p = (BACKEND_DIR / p).resolve()
        return p

    @property
    def database_dsn(self) -> str:
        """Normalise SQLite paths so the app works from any working directory."""
        url = self.database_url
        if url.startswith("sqlite:///") and not url.startswith("sqlite:////"):
            relative = url.replace("sqlite:///", "", 1)
            if relative != ":memory:":
                path = Path(relative)
                if not path.is_absolute():
                    path = (BACKEND_DIR / path).resolve()
                return f"sqlite:///{path.as_posix()}"
        return url

    @property
    def is_sqlite(self) -> bool:
        return self.database_dsn.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
