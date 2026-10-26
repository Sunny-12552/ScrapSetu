# Security

ScrapSetu handles phone numbers, home addresses, dealer KYC documents, scrap
photos and payment records. This document describes the controls that are
implemented, the assumptions behind them, and what must change before a public
launch.

## 1. Threat model (MVP)

| Threat | Impact | Primary controls |
|---|---|---|
| OTP brute force / SMS bombing | Account takeover, cost | Hashed OTP, 5-minute TTL, 5 attempts, per-phone and per-IP limits, resend cooldown, old-code invalidation |
| Refresh-token theft | Session hijack | HttpOnly/SameSite cookie, hashed tokens, rotation, reuse detection, session revocation |
| IDOR on listings/bookings/files | Privacy breach | Role- and ownership-scoped queries on every read/write; per-file authorization |
| Double offer acceptance | Two dealers dispatched | Row locks + partial unique index + idempotency keys |
| Price manipulation | Financial loss | Server-side recomputation of all totals; client values never trusted |
| Payment fraud claims | Disputes | Explicit external payment model, customer confirmation, `gateway_verified=false` |
| Malicious uploads | XSS, malware, path traversal | Format allow-list, re-encoding, size/pixel limits, key validation, `nosniff`, sandbox CSP |
| Privilege escalation | Admin takeover | No self-registration for admins, router-level role guards, audited admin actions |
| SQL injection | Data breach | SQLAlchemy parameterized queries; no string-built SQL with user input |
| XSS in the SPA | Session/data theft | React escaping, no `dangerouslySetInnerHTML` with user content |
| CSRF | Unwanted actions | Bearer tokens in memory for mutations; refresh cookie is `SameSite=Lax`, path-scoped to `/api/v1/auth` |
| Secret leakage | Full compromise | Environment-only secrets, `.env` gitignored, no default admin password |

## 2. Authentication

- **No passwords** for customers/dealers/admins. Phone OTP only.
- OTPs are generated with `secrets`, stored as HMAC-SHA256 over
  `phone:code` keyed by `SECRET_KEY`, and compared with
  `hmac.compare_digest`. Plaintext codes are never stored.
- Challenges expire after `OTP_TTL_MINUTES` (5), allow
  `OTP_MAX_ATTEMPTS` (5), and enforce `OTP_RESEND_SECONDS` (45).
- Request limits: 3 per phone / 12 per IP per 10 minutes. Verify limits: 10 per
  phone / 20 per IP per 10 minutes.
- Requesting a new code invalidates all previous unconsumed codes for that
  phone.
- Role is part of the challenge flow. A customer/dealer cannot sign in through
  the admin role and vice versa (`role_mismatch`).
- Suspended/deleted users are rejected at verify time and on every request.
- In development `OTP_DEV_MODE=true` returns `dev_otp` and logs the code. The
  service refuses to return it when `ENVIRONMENT=production`.
- Delivery failures in production return a generic `otp_delivery_failed`
  without leaking whether the number exists.

### Access tokens

- JWT HS256, signed with `SECRET_KEY` (minimum 32 chars), issuer `scrapsetu`,
  `type=access`, `sub=user_id`, `role`, `sid=session_id`, `jti`, `iat`, `exp`.
- TTL 20 minutes by default. Verified on every request; the session row must
  still exist and be unrevoked.
- Stored in memory in the frontend only — never `localStorage`.

### Refresh tokens

- 48 random bytes, URL-safe; only SHA-256 hashes are stored.
- Cookie name `scrapsetu_refresh`, `HttpOnly`, `SameSite=Lax`, path
  `/api/v1/auth`, `Secure` when `SECURE_COOKIES=true`.
- Rotated on every refresh. The old session row points to its replacement
  (`replaced_by_id`). Presenting an already-rotated token revokes the whole
  family (reuse detection).
- `logout` revokes one session; `sessions/revoke-all` revokes all.

## 3. Authorization

- Router-level dependencies (`require_roles(...)`) enforce the coarse role.
- Service-level checks enforce ownership and state:
  - customers can only touch their own listings/addresses/bookings;
  - dealers can only touch their own offers/bookings and eligible listings;
  - admins can read across tenants but actions are audited.
- Sensitive response shaping is role-aware (`booking_read`): full address and
  counterparty phone are only included for the right viewer at the right
  booking stage.
- File access is authorized per object (`/files/{key}`):
  - `request-images/<request_id>`: owning customer, assigned dealer, or an
    eligible approved dealer while the listing is open;
  - `dealer-docs/<dealer_id>`: owning dealer or admin;
  - `booking-evidence/<booking_id>`, `payment-evidence/<booking_id>`,
    `dispute-evidence/<dispute_id>`: the booking's customer/dealer or admin.
- Client-side route guards are UX only; the API is the security boundary.

## 4. Input validation and injection

- Pydantic validates types, lengths, enums, dates and decimal bounds on every
  request body and query parameter.
- SQLAlchemy Core/ORM parameterizes all queries. No user input is interpolated
  into SQL.
- Phone numbers are normalized before storage/queries.
- State filters are validated against enum values before use.
- File object keys must match `^[A-Za-z0-9][A-Za-z0-9_\-./]{2,250}$`, cannot
  contain `..`, and are resolved inside the storage root.
- CSV exports quote and escape values with Python's `csv` module, and cells that
  begin with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with an
  apostrophe so spreadsheets cannot execute them as formulas. Exports still
  contain personal data: treat downloaded CSVs as sensitive.

## 5. Uploads

- Allowed images: JPEG, PNG, WebP. Documents: PDF or those images.
- Max 8 MB per file, 8 images per listing, max 40 MP, resized to 2400 px.
- Images are decoded and re-encoded to JPEG; EXIF/GPS metadata is dropped and
  orientation is applied. This also neutralizes polyglot/metadata payloads.
- PDFs must start with `%PDF`; they are not parsed or sanitized beyond that.
  A production deployment should add malware scanning (ClamAV or a cloud
  scanner) and store files outside the web root.
- Downloads set `X-Content-Type-Options: nosniff` and a restrictive
  `Content-Security-Policy: default-src 'none'; sandbox` for user content.

## 6. Transport, headers and CORS

- HTTPS is required in production (reverse proxy/load balancer). HSTS is added
  automatically when `ENVIRONMENT=production`.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- API responses are `Cache-Control: no-store`; private files use
  `Cache-Control: private, max-age=300`.
- CORS allow-list is configuration-driven, credentials enabled, methods and
  headers restricted.
- The production SPA is same-origin, so CORS is only needed for local dev or a
  separately hosted frontend.

## 7. Rate limiting

- In-process sliding-window limiter. Global API limit: 120 requests/minute/IP
  (configurable). OTP has narrower buckets.
- 429 responses include `Retry-After: 60`.
- **Limitation:** buckets are per process and reset on restart. With multiple
  workers/containers this is not a global limit. Move the store to Redis before
  scaling out.
- **Proxy note:** `client_ip()` trusts the first `X-Forwarded-For` value. Only
  deploy behind a proxy that overwrites this header; otherwise clients can
  spoof it to bypass IP limits.

## 8. Secrets and configuration

| Secret | Where | Rule |
|---|---|---|
| `SECRET_KEY` | env | ≥32 random chars; rotate invalidates all JWTs/OTPs |
| SMS/email credentials | env | never logged, never returned |
| S3 credentials | env / instance role | prefer an IAM role in AWS |
| DB password | env/secret manager | not in compose defaults for production |
| OTP codes | DB (HMAC) + logs in dev | production never logs/returns them |

- `.env`, `backend/.env` and `frontend/.env*` are gitignored.
- `.env.example` contains only development defaults.
- The API logs an error if production starts with the default development
  secret; treat that as a release blocker.
- CI should run secret scanning (e.g. gitleaks) on every push.

## 9. Audit and monitoring

- `audit_logs` records actor, role, action, entity, before/after, reason, hashed
  IP and user agent. It is append-only through the API.
- Sensitive actions covered: offer acceptance, booking transitions, settlement
  submission, payment recording/verification, dispute resolution, dealer
  verification, user suspension, moderation, catalogue changes, exports.
- Request logs include a request ID and method/path/status/duration; bodies and
  tokens are not logged.
- Production should ship logs to a central store, alert on 5xx/429 spikes,
  repeated OTP failures, refresh-token reuse, and admin export volume.

## 10. Privacy

- Public dealer cards omit phone/email; masked names are used where possible.
- Phone numbers are revealed to the counterparty only after the dealer confirms
  the job.
- Full pickup addresses are hidden from dealers before confirmation.
- KYC documents are private to the dealer and admins.
- Account deletion is a soft delete plus phone anonymization; financial and
  audit records are retained.
- IP addresses are hashed in audit records.
- Data retention, consent text and a grievance officer are operational/legal
  requirements, not fully automated in this MVP (`meta/config` labels the legal
  documents as drafts).

## 11. Production checklist

- [ ] `ENVIRONMENT=production`
- [ ] `SECRET_KEY` replaced with a 48+ byte random value from a secret manager
- [ ] `OTP_DEV_MODE=false`, real `SMS_PROVIDER` configured and tested
- [ ] `SECURE_COOKIES=true` and HTTPS terminated at a trusted proxy
- [ ] PostgreSQL with backups, least-privilege DB user, TLS to the DB
- [ ] `STORAGE_BACKEND=s3`, private bucket, no public ACLs, lifecycle policy
- [ ] Redis-backed rate limiting and shared cache
- [ ] Malware scanning for uploads; PDF sanitization
- [ ] CORS restricted to the exact web origin
- [ ] Proxy overwrites `X-Forwarded-For`
- [ ] `ALLOW_DEMO_SEED=false` and no demo data in the database
- [ ] Log shipping, alerting, uptime checks, error tracking
- [ ] Dependency and container scanning in CI
- [ ] Admin accounts created individually via CLI; MFA/SSO considered for admins
- [ ] Legal review of terms, privacy policy, refunds and grievance process

## 12. Reporting a vulnerability

Email `security@scrapsetu.in` with reproduction steps and impact. Do not open a
public issue for an unpatched vulnerability. This address is a placeholder for
the MVP and must be staffed before launch.
