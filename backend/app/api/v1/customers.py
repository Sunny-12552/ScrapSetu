"""Customer profile, saved addresses, dashboard, transactions, deletion."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, require_roles
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import normalize_indian_phone
from app.models import City, CustomerAddress, Role
from app.schemas import AddressCreate, AddressRead, AddressUpdate, Message, ProfileUpdate
from app.services import engagement, requests as request_service
from app.services.serializers import profile_read

router = APIRouter(
    prefix="/customers",
    tags=["customers"],
    dependencies=[Depends(require_roles(Role.CUSTOMER))],
)


def _address_dict(address: CustomerAddress, city_name: str | None = None) -> dict:
    return {
        "id": address.id,
        "label": address.label,
        "contact_name": address.contact_name,
        "contact_phone": address.contact_phone,
        "line1": address.line1,
        "line2": address.line2,
        "locality": address.locality,
        "postal_code": address.postal_code,
        "city_id": address.city_id,
        "city_name": city_name or (address.city.name if address.city else None),
        "is_default": address.is_default,
        "is_active": address.is_active,
        "latitude": address.latitude,
        "longitude": address.longitude,
        "created_at": address.created_at,
    }


@router.get("/dashboard")
def dashboard(db: DbSession, user: CurrentUser):
    return request_service.customer_dashboard(db, user)


@router.get("/addresses", response_model=list[AddressRead])
def list_addresses(db: DbSession, user: CurrentUser):
    rows = (
        db.execute(
            select(CustomerAddress)
            .where(
                CustomerAddress.customer_id == user.id,
                CustomerAddress.is_active.is_(True),
            )
            .order_by(CustomerAddress.is_default.desc(), CustomerAddress.created_at)
        )
        .scalars()
        .all()
    )
    return [_address_dict(a) for a in rows]


@router.post("/addresses", response_model=AddressRead, status_code=201)
def create_address(payload: AddressCreate, db: DbSession, user: CurrentUser):
    city = db.get(City, payload.city_id)
    if not city or not city.is_active:
        raise ValidationError("Choose a city we currently serve.")
    active_count = db.execute(
        select(func.count(CustomerAddress.id)).where(
            CustomerAddress.customer_id == user.id,
            CustomerAddress.is_active.is_(True),
        )
    ).scalar_one()
    if active_count >= 8:
        raise ConflictError("You can save up to 8 addresses. Remove one first.")
    if payload.is_default or active_count == 0:
        for existing in db.execute(
            select(CustomerAddress).where(
                CustomerAddress.customer_id == user.id,
                CustomerAddress.is_default.is_(True),
            )
        ).scalars():
            existing.is_default = False
    phone = payload.contact_phone or user.phone
    address = CustomerAddress(
        customer_id=user.id,
        label=payload.label.strip() or "Home",
        contact_name=payload.contact_name.strip(),
        contact_phone=phone,
        line1=payload.line1.strip(),
        line2=payload.line2,
        locality=payload.locality.strip(),
        city_id=payload.city_id,
        postal_code=payload.postal_code,
        latitude=payload.latitude,
        longitude=payload.longitude,
        is_default=payload.is_default or active_count == 0,
    )
    db.add(address)
    db.commit()
    db.refresh(address)
    return _address_dict(address, city.name)


@router.patch("/addresses/{address_id}", response_model=AddressRead)
def update_address(
    address_id: str, payload: AddressUpdate, db: DbSession, user: CurrentUser
):
    address = db.get(CustomerAddress, address_id)
    if not address or address.customer_id != user.id or not address.is_active:
        raise NotFoundError("Address not found.")
    data = payload.model_dump(exclude_unset=True)
    if "contact_phone" in data and data["contact_phone"]:
        data["contact_phone"] = normalize_indian_phone(data["contact_phone"])
    if "city_id" in data:
        city = db.get(City, data["city_id"])
        if not city or not city.is_active:
            raise ValidationError("Choose a city we currently serve.")
    if data.get("is_default"):
        for existing in db.execute(
            select(CustomerAddress).where(
                CustomerAddress.customer_id == user.id,
                CustomerAddress.is_default.is_(True),
                CustomerAddress.id != address.id,
            )
        ).scalars():
            existing.is_default = False
    for key, value in data.items():
        setattr(address, key, value)
    db.commit()
    db.refresh(address)
    return _address_dict(address)


@router.delete("/addresses/{address_id}", response_model=Message)
def delete_address(address_id: str, db: DbSession, user: CurrentUser):
    address = db.get(CustomerAddress, address_id)
    if not address or address.customer_id != user.id or not address.is_active:
        raise NotFoundError("Address not found.")
    address.is_active = False
    address.is_default = False
    db.commit()
    return {"message": "Address removed."}


@router.patch("/profile", response_model=dict)
def update_profile(payload: ProfileUpdate, db: DbSession, user: CurrentUser):
    profile = user.profile
    if not profile:
        raise NotFoundError("Profile not found.")
    data = payload.model_dump(exclude_unset=True)
    if "full_name" in data and data["full_name"] is not None:
        profile.full_name = data["full_name"].strip()[:160]
    if "email" in data:
        profile.email = str(data["email"]) if data["email"] else None
    language = data.get("preferred_language") or data.get("locale")
    if language:
        profile.preferred_language = language
        user.locale = language
    db.commit()
    return {"profile": profile_read(profile), "message": "Profile updated."}


@router.get("/transactions")
def transactions(db: DbSession, user: CurrentUser, limit: int = 100):
    return engagement_transactions(db, user, limit)


def engagement_transactions(db, user, limit: int):
    from app.services.bookings import customer_transactions

    return customer_transactions(db, user.id, limit=min(limit, 200))


@router.delete("/me", response_model=Message)
def delete_account(
    request: Request, db: DbSession, user: CurrentUser, reason: str | None = None
):
    engagement.delete_customer_account(db, user, reason=reason, http_request=request)
    return {"message": "Your account has been deleted. Financial records are retained as required by law."}
