# Architecture

ScrapSetu is a two-sided scrap marketplace for India. Customers publish scrap
listings, verified dealers quote per-kg rates, and a single accepted quote becomes
a booking. The dealer collects and weighs the material, submits a transparent
settlement, and the customer confirms both the settlement and the recorded
payment before the booking closes.

This document describes how the system is put together and why.

## 1. Runtime topology

```
Browser (React SPA)
   │  HTTPS / JSON
   ▼
FastAPI (app.main:app)  ──────►  PostgreSQL 16
   │                                (SQLite in local dev)
   ├── local disk or S3-compatible object storage (scrap photos, documents)
   ├── SMS provider (console | MSG91 | Twilio)
   ├── SMTP email (console | SMTP)
   ├── optional geocoding (Google | Mapbox)
   └── background scheduler thread (offer/listing expiry sweep)
```

- **Single origin in production.** The Vite build is served by FastAPI:
  `/api/v1/*` for JSON, `/assets/*` for bundles, and an SPA fallback for client
  routes. `docker compose up --build` produces exactly this.
- **Two origins in development.** Vite runs on `:5173` and proxies `/api` and
  `/health` to `:8000`. Access tokens stay in memory either way.
- **Zero-install fallback.** If `DATABASE_URL` is not set, a SQLite database is
  used at `backend/scrapsetu.db`. PostgreSQL is the production database and the
  Alembic baseline is portable between the two.

## 2. Backend layers

| Layer | Location | Responsibility |
|---|---|---|
| HTTP routers | `app/api/v1/*.py` | Validation, role guards, status codes, idempotency plumbing |
| Dependencies | `app/api/deps.py` | Bearer token → user/session; role checks |
| Services | `app/services/*.py` | All business rules and state changes |
| Models | `app/models/__init__.py` | SQLAlchemy 2 mapped classes + status enums |
| Schemas | `app/schemas/__init__.py` | Pydantic request bodies and shared response shapes |
| Integrations | `app/integrations/*.py` | SMS, email, storage, maps, payments adapters |
| Core | `app/core/*.py` | Settings, errors, security primitives, rate limits, logging, time |
| Workers | `app/workers/scheduler.py` | Expiry sweeps on a daemon thread |
| CLI | `app/cli.py` | `seed-demo`, `create-admin`, `expire-sweep` |

Rules live in services rather than routers so that the CLI, tests and any future
worker call the same code path. Routers do not mutate model fields directly.

### Key services

- `requests.py` – listing drafts, item validation, submit, matching summary.
- `offers.py` – quote creation/revision/withdrawal, exclusive acceptance,
  acceptance snapshots, offer expiry.
- `bookings.py` – booking queries, weighing, evidence, settlement submission,
  payment recording/confirmation, cancellation, review eligibility.
- `state_machine.py` – explicit booking transitions, actor authorization,
  completion guards, history entries.
- `settlement.py` – pure Decimal arithmetic (`ROUND_HALF_UP`, 2 dp money).
- `fees.py` – effective-dated, city-overridable platform fee rules.
- `matching.py` – dealer eligibility and explainable ranking.
- `admin.py` – dashboard aggregates, verification, moderation, dispute
  resolution, fee/price/city catalogue administration.
- `serializers.py` – role-aware response shaping (addresses, phone numbers,
  settlement snapshots, money as strings).
- `idempotency.py` – replay-safe mutations keyed by `Idempotency-Key`.
- `audit.py` / `notifications.py` – append-only audit trail and delivery queue.

## 3. Authentication and sessions

1. `POST /auth/otp/request` normalizes the Indian mobile number, rate-limits per
   phone and IP, invalidates older codes, stores only an HMAC of the OTP, and
   sends it through the configured SMS adapter. In development the OTP is
   logged and returned as `dev_otp`; in production it is never returned.
2. `POST /auth/otp/verify` checks expiry, attempt count and hash, then:
   - signs in an existing user if the requested role matches;
   - creates a **customer** or **dealer** on first sign-in (never an admin);
   - rejects role mismatches (`role_mismatch`) and suspended accounts.
3. The API returns a short-lived JWT access token (~20 min) and sets an opaque
   refresh token in an `HttpOnly`, `SameSite=Lax` cookie (`scrapsetu_refresh`).
   Only the refresh token hash is stored, per session family.
4. `POST /auth/refresh` rotates the refresh token. Reuse of an already-rotated
   token revokes the whole session family (theft detection).
5. `POST /auth/logout` revokes the current session; `POST
   /auth/sessions/revoke-all` revokes every session for the user.

The frontend keeps the access token in memory only. A page reload restores the
session with a cookie-based refresh call. Concurrent 401s share one refresh
request (single-flight) and replay the original request once.

Admin accounts are created with the CLI (`python -m app.cli create-admin`) and
sign in through the same OTP flow with `role="admin"`. There is no default admin
password anywhere in the codebase.

## 4. Listing → offer → booking flow

```
draft ──submit──► open ──offers──► offer_selected ──dealer confirm──► booking_confirmed
                    │                     │                                   │
                    │                     └── accept (exclusive)              ▼
                    │                                                   pickup_in_progress
                    ▼                                                         │
                 expired / cancelled                                          ▼
                                                                       weighing_recorded
                                                                              │
                                                                              ▼
                                                                     settlement_pending
                                                                       │            │
                                                                       ▼            ▼
                                                                   completed     disputed
                                                                                   │
                                                                                   ▼
                                                                          admin resolution
```

- **Draft → open:** the wizard saves a draft, uploads images (re-encoded to JPEG
  with EXIF/GPS removed), then submits. Submission validates quantities, pickup
  window, address ownership and at least one item.
- **Offers:** eligible dealers see listings matching their service area,
  categories, availability and operating hours. Each dealer has at most one live
  offer per listing; revisions bump `version`.
- **Exclusive acceptance:** `POST /offers/{id}/accept` locks the offer and
  listing rows (where supported), writes an immutable
  `offer_acceptance_snapshots` row, and creates the booking. A partial unique
  index (`uq_booking_active_request`) guarantees at most one non-terminal
  booking per listing even on SQLite. A second accept returns `409
  already_booked`.
- **Confirmation:** the dealer confirms the job, which reveals the full pickup
  address and customer contact. Until then the dealer sees only locality-level
  information.
- **Weighing:** the dealer records actual weights per category. Customers can
  dispute the weighing before a settlement is submitted.
- **Settlement:** the dealer submits final rates/weights, deductions and notes.
  The server recomputes every line; the client total is never trusted. The
  customer either confirms or disputes.
- **Payment:** cash/UPI is exchanged offline. The dealer records a payment
  instrument and reference; the customer confirms receipt. No gateway callback
  exists, so `gateway_verified` is always `false`.
- **Completion:** only after the latest settlement is customer-confirmed and
  confirmed payments cover the final payout. The state machine enforces this.

## 5. Concurrency and consistency

- Money is `Numeric(14,2)` and weights are `Numeric(12,3)`; Python code uses
  `Decimal` exclusively. No floats touch money.
- Status columns are strings validated against `StrEnum` values so migrations
  stay simple and invalid values are rejected in code.
- Offer acceptance uses row locks plus the partial unique index. The loser of a
  race gets a conflict, not a second booking.
- Settlement versions are append-only. Admin adjustments create a new version
  and require the customer to confirm again.
- `Idempotency-Key` on accept, settlement, payment and completion endpoints
  returns the stored response for a retried key with the same payload and a
  conflict for a reused key with a different payload.
- All timestamps are stored in UTC; the UI formats them in `Asia/Kolkata`.
  Pickup windows are converted from local time to UTC at the boundary.

## 6. Background work

A single daemon scheduler (disabled in tests and configurable via
`ENABLE_SCHEDULER`) runs every `OFFER_EXPIRY_SWEEP_SECONDS`:

- expires open listings past `expires_at`;
- expires submitted offers past `valid_until` and recounts live offers.

Audit entries are written for state changes and administrative actions. The
scheduler is intentionally in-process for the MVP; a production deployment with
multiple API workers should run the sweep as a separate cron/worker process to
avoid duplicate work (the operations are idempotent, so duplicates are safe but
wasteful).

## 7. Storage and privacy

- Uploads are limited by size, count, pixel count, format (JPEG/PNG/WebP) and
  re-encoded server-side. Metadata including GPS is dropped.
- Object keys are validated and every download goes through
  `GET /files/{key}` with an authorization check. Customers see their own
  listing/booking images; eligible dealers see request photos; unrelated users
  receive `403/404`.
- Dealer KYC documents are private and visible only to the owning dealer and
  admins.
- Production should use `STORAGE_BACKEND=s3` with a private bucket and
  short-lived presigned URLs for direct delivery.

## 8. Frontend

```
src/
  App.tsx                 route tree + lazy-free role sections
  components/             AppShell, UI kit, guards, toasts, offer modal
  lib/                    api client, auth context, types, formatting, hooks
  routes/
    public/               landing + OTP sign-in
    customer/             dashboard, listings, wizard, addresses, support
    dealer/               marketplace, offers, profile, bookings
    admin/                dashboard, dealers, disputes, catalogue, exports
    shared/               booking detail, notifications
```

- React 19 + React Router 7 + TanStack Query 5 + React Hook Form + Zod.
- Tailwind CSS v4 with a warm paper/forest/brass design system, Fraunces
  display type and Manrope body type.
- Role-based routes are guarded on the client for navigation, but every
  protected read/write is authorized again by the API. Client guards are UX,
  not security.
- The API client retries once after a token refresh and surfaces typed error
  codes as toasts.

## 9. Deliberate trade-offs

- **No payment gateway.** Recording an external cash/UPI transfer and asking the
  customer to confirm is honest about what the platform can verify. The API is
  explicit that it is not gateway-verified.
- **No real-time chat.** Notifications, disputes and evidence cover the MVP;
  SMS/email delivery is adapter-based.
- **SQLite in development.** It keeps the one-click launcher dependency-free.
  PostgreSQL is the documented production target and is exercised by the same
  SQLAlchemy/Alembic code path.
- **No multi-city launch tooling.** Cities, service areas and fee rules are
  data-driven, so expansion does not require code changes.
- **In-process scheduler.** Adequate for one API process; documented for scale.
