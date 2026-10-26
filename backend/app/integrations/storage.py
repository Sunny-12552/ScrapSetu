"""Object storage + image validation.

Local disk is used for development. Production must use S3-compatible storage
(``STORAGE_BACKEND=s3``). Files are always served through an authorization check;
object keys are never trusted as user input without validation.
"""

from __future__ import annotations

import io
import logging
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings
from app.core.errors import ValidationError

logger = logging.getLogger("scrapsetu.storage")

ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
ALLOWED_DOC_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
}
KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-./]{2,250}$")
MAX_PIXELS = 40_000_000
MAX_DIMENSION = 2400


@dataclass
class StoredObject:
    key: str
    mime_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None


def _safe_key(key: str) -> str:
    if not KEY_RE.match(key) or ".." in key or key.startswith("/"):
        raise ValidationError("Invalid file reference.")
    return key


def _local_root() -> Path:
    root = settings.storage_path
    root.mkdir(parents=True, exist_ok=True)
    return root


class LocalStorage:
    name = "local"

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = (_local_root() / _safe_key(key)).resolve()
        if not str(path).startswith(str(_local_root().resolve())):
            raise ValidationError("Invalid storage path.")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes:
        path = (_local_root() / _safe_key(key)).resolve()
        if not str(path).startswith(str(_local_root().resolve())) or not path.exists():
            raise FileNotFoundError(key)
        return path.read_bytes()

    def delete(self, key: str) -> None:
        try:
            (_local_root() / _safe_key(key)).unlink(missing_ok=True)
        except OSError:
            logger.warning("could not delete local object %s", key)

    def exists(self, key: str) -> bool:
        return (_local_root() / _safe_key(key)).exists()


class S3Storage:
    name = "s3"

    def __init__(self) -> None:
        import boto3  # imported lazily so local dev does not need credentials

        if not settings.s3_bucket:
            raise RuntimeError("S3_BUCKET is not configured.")
        self._bucket = settings.s3_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._client.put_object(
            Bucket=self._bucket,
            Key=_safe_key(key),
            Body=data,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )

    def get(self, key: str) -> bytes:
        response = self._client.get_object(Bucket=self._bucket, Key=_safe_key(key))
        return response["Body"].read()

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=_safe_key(key))

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=_safe_key(key))
            return True
        except Exception:  # noqa: BLE001 - provider-specific errors
            return False


_storage: LocalStorage | S3Storage | None = None


def get_storage() -> LocalStorage | S3Storage:
    global _storage
    if _storage is None:
        if settings.storage_backend == "s3":
            _storage = S3Storage()
        else:
            _storage = LocalStorage()
    return _storage


def storage_status() -> dict:
    return {
        "backend": settings.storage_backend,
        "configured": settings.storage_backend == "local" or bool(settings.s3_bucket),
        "local_development": settings.storage_backend == "local",
    }


# --- image pipeline ---------------------------------------------------------


def process_image(data: bytes, *, max_bytes: int | None = None) -> tuple[bytes, str, int, int]:
    max_bytes = max_bytes or settings.max_upload_mb * 1024 * 1024
    if not data:
        raise ValidationError("The uploaded file is empty.")
    if len(data) > max_bytes:
        raise ValidationError(
            f"Images must be smaller than {settings.max_upload_mb} MB."
        )
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in ALLOWED_IMAGE_FORMATS:
                raise ValidationError("Only JPEG, PNG and WebP images are allowed.")
            width, height = probe.size
            if width * height > MAX_PIXELS:
                raise ValidationError("Image resolution is too large.")
            probe.verify()
    except UnidentifiedImageError as exc:
        raise ValidationError("The file is not a valid image.") from exc
    except ValidationError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ValidationError("The image could not be processed.") from exc

    # Re-open after verify() (which invalidates the file pointer) and re-encode,
    # dropping EXIF/GPS metadata as a privacy measure.
    with Image.open(io.BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode in ("RGBA", "LA", "P"):
                rgba = img.convert("RGBA")
                background.paste(rgba, mask=rgba.split()[-1])
                img = background
            else:
                img = img.convert("RGB")
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION))
        output = io.BytesIO()
        img.convert("RGB").save(output, format="JPEG", quality=85, optimize=True)
        cleaned = output.getvalue()
    return cleaned, "image/jpeg", img.width, img.height


def process_document(data: bytes, content_type: str) -> tuple[bytes, str]:
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if not data:
        raise ValidationError("The uploaded file is empty.")
    if len(data) > max_bytes:
        raise ValidationError(f"Files must be smaller than {settings.max_upload_mb} MB.")
    if content_type == "application/pdf":
        if not data.startswith(b"%PDF"):
            raise ValidationError("The file is not a valid PDF.")
        return data, "application/pdf"
    if content_type in {"image/jpeg", "image/png", "image/webp"}:
        cleaned, mime, _, _ = process_image(data)
        return cleaned, mime
    raise ValidationError("Upload a PDF, JPEG, PNG or WebP document.")


def build_key(prefix: str, owner_id: str, extension: str = "jpg") -> str:
    extension = extension.lstrip(".").lower()
    if extension not in {"jpg", "jpeg", "png", "webp", "pdf"}:
        extension = "bin"
    return f"{prefix}/{owner_id}/{uuid.uuid4().hex}.{extension}"


def save_image(prefix: str, owner_id: str, data: bytes) -> StoredObject:
    cleaned, mime, width, height = process_image(data)
    key = build_key(prefix, owner_id, "jpg")
    get_storage().put(key, cleaned, mime)
    return StoredObject(key, mime, len(cleaned), width, height)


def save_document(
    prefix: str, owner_id: str, data: bytes, content_type: str, filename: str
) -> StoredObject:
    cleaned, mime = process_document(data, content_type)
    ext = "pdf" if mime == "application/pdf" else "jpg"
    key = build_key(prefix, owner_id, ext)
    get_storage().put(key, cleaned, mime)
    return StoredObject(key, mime, len(cleaned))


def read_object(key: str) -> bytes:
    return get_storage().get(key)


def delete_object(key: str) -> None:
    get_storage().delete(key)
