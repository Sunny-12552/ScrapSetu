# API reference

- Base URL (development): `http://127.0.0.1:8000/api/v1`
- Interactive docs: <http://127.0.0.1:8000/docs> (OpenAPI: `/openapi.json`)
- All responses are JSON except file downloads and CSV exports.
- All timestamps are UTC ISO-8601 (`Z`); display them in Asia/Kolkata.
- All money and weight values are **decimal strings** (`"120.00"`, `"7.200"`).

## 1. Conventions

### Authentication headers

```
Authorization: Bearer <access_token>
Idempotency-Key: <8-120 letters/digits/-/_>   # only on mutations that support it
```

`POST /auth/otp/verify` and `/auth/refresh` also set the `scrapsetu_refresh`
cookie (`HttpOnly`, `SameSite=Lax`, path `/api/v1/auth`). Clients must send
cookies for refresh/logout (`credentials: "include"`).

### Error envelope

```json
{
  "error": {
    "code": "already_booked",
    "message": "This listing is no longer open. Refresh to see the current booking.",
    "details": { "settlement_confirmed": true, "payment_confirmed": false }
  }
}
```

Common codes: `validation_error` (422), `unauthorized` (401),
`token_expired` (401), `forbidden` (403), `not_found` (404), `conflict` (409),
`already_booked` (409), `rate_limited` (429, with `Retry-After`),
`role_mismatch` (403), `otp_delivery_failed` (409).

### Pagination

Paginated collections return:

```json
{ "items": [], "total": 0, "page": 1, "page_size": 20, "pages": 1 }
```

`page` starts at 1; `page_size` is 1–100 (default 20). Not every collection is
paginated (for example notifications use the same shape; dashboards are
aggregates).

### Idempotent mutations

Supported on offer acceptance, settlement submission, payment recording,
payment confirmation, settlement confirmation and completion. Replaying the
same key with the same payload returns the stored response; reusing the key
with a different payload returns `409`.

## 2. Authentication

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/otp/request` | public | Send OTP. Body: `phone`, `role` (`customer`/`dealer`/`admin`), `purpose` (`login`/`signup`). Returns masked phone, expiry, resend window, `delivered_via`, and `dev_otp` in development. |
| POST | `/auth/otp/verify` | public | Verify OTP. Body: `phone`, `code`, `role`, optional `full_name`. Returns `access_token`, `expires_in`, `user`. Sets refresh cookie. |
| POST | `/auth/refresh` | cookie | Rotate refresh token; returns a new access token. Reuse revokes the session family. |
| POST | `/auth/logout` | authenticated | Revoke the current session and clear the cookie. |
| POST | `/auth/sessions/revoke-all` | authenticated | Revoke every session for the user. |
| GET | `/auth/me` | authenticated | Current user, profile, dealer summary. |

First sign-in creates customer/dealer accounts only. Admin accounts are created
with `python -m app.cli create-admin`.

## 3. Public metadata

| Method | Path | Description |
|---|---|---|
| GET | `/meta/categories` | Active material categories (optional `city_id`). |
| GET | `/meta/cities` | Active cities. |
| GET | `/meta/config` | Feature/config flags: uploads (`max_mb`, `max_images_per_request`, allowed types), OTP (dev mode, TTL, resend, provider), support contacts, legal version, integration status. |
| GET | `/dealers/{dealer_id}/public` | Public dealer card. |
| GET | `/dealers/{dealer_id}/reviews` | Published reviews for a dealer. |
| GET | `/health` (no prefix) | Service + database + integration health. |

## 4. Customer

| Method | Path | Description |
|---|---|---|
| GET | `/customers/dashboard` | Aggregates, active listings/bookings, recent activity, earnings. |
| PATCH | `/customers/profile` | Update display name/email/language. |
| DELETE | `/customers/me` | Soft-delete and anonymize the account. |
| GET/POST | `/customers/addresses` | List/create addresses (max 8). |
| PATCH/DELETE | `/customers/addresses/{id}` | Update/deactivate an owned address. |
| GET | `/customers/transactions` | Payout history (`limit` ≤ 100). |
| GET | `/customers/reviews` | Reviews written by the customer. |

### Listings

| Method | Path | Description |
|---|---|---|
| GET | `/scrap-requests` | Own listings (`status`, paginated). |
| POST | `/scrap-requests` | Create a draft. Body: address, preferred date/window, notes, items (`category_id`, `estimated_weight_kg`, optional quantity/condition). |
| GET | `/scrap-requests/{id}` | Own listing with items, images, offers summary. |
| PATCH | `/scrap-requests/{id}` | Edit a draft; bumps version. |
| POST | `/scrap-requests/{id}/images` | Multipart image upload (JPEG/PNG/WebP, ≤8 MB, ≤8 per listing). EXIF removed. |
| DELETE | `/scrap-requests/{id}/images/{image_id}` | Remove an image. |
| POST | `/scrap-requests/{id}/submit` | Validate and publish (`draft → open`). |
| GET | `/scrap-requests/{id}/offers` | Offers for the listing. `sort` = `payout`/`rating`/`newest`/`eta`. |

### Offers and bookings

| Method | Path | Description |
|---|---|---|
| GET | `/offers/{offer_id}` | Offer detail (owning customer or quoting dealer). |
| POST | `/offers/{offer_id}/accept` | Accept exclusively (idempotent). Creates booking; `409 already_booked` on a second attempt. |
| GET | `/bookings` | Role-scoped bookings (`status`, paginated). |
| GET | `/bookings/{id}` | Role-aware booking detail: snapshot, address visibility, dealer phone, measurements, settlement, payments, disputes, history, next actions. |
| POST | `/bookings/{id}/confirm-settlement` | Customer confirms the latest settlement. |
| POST | `/bookings/{id}/confirm-payment` | Customer confirms receipt of a recorded payment. |
| POST | `/bookings/{id}/cancel` | Cancel within the allowed window. |
| GET/POST | `/bookings/{id}/dispute` | List/open a dispute (one open per booking). |
| POST | `/bookings/{id}/evidence` | Upload evidence (multipart). |

## 5. Dealer

| Method | Path | Description |
|---|---|---|
| POST | `/dealers/applications` | Create/update dealer application. |
| GET | `/dealers/profile` | Own profile, categories, areas, documents, status. |
| PATCH | `/dealers/availability` | Pause/resume new requests; update capacity/operating hours. |
| PUT | `/dealers/categories` | Replace traded category set. |
| PUT | `/dealers/service-areas` | Replace service area set. |
| POST | `/dealers/documents` | Upload KYC document (multipart). |
| DELETE | `/dealers/documents/{id}` | Remove an unreviewed document. |
| GET | `/dealers/dashboard` | Earnings, rating, job counts, live offers, pipeline. |
| GET | `/dealers/requests` | Matching marketplace. Filters: `category_id`, `search`, `preferred_date`, `time_window`, `max_weight_kg`, `service_area`. |
| GET | `/dealers/requests/{id}` | Eligible listing detail with indicative payout and photos. |
| GET/POST | `/dealer-offers` | List own offers / create a quote. Quote body: items (rate + estimated weight), pickup date/window, validity, conditions, disclosure. |
| PATCH | `/dealer-offers/{id}` | Revise a live offer (new version). |
| POST | `/dealer-offers/{id}/withdraw` | Withdraw a live offer. |
| GET | `/dealers/bookings` | Own jobs (`status`). |
| POST | `/bookings/{id}/confirm` | Accept the assigned job (reveals address/contact). |
| POST | `/bookings/{id}/start-pickup` | Mark pickup in progress. |
| POST | `/bookings/{id}/record-weighing` | Record actual weights per category. |
| POST | `/bookings/{id}/submit-settlement` | Submit final settlement (idempotent). |
| POST | `/bookings/{id}/record-payment` | Record cash/UPI payment (idempotent). |

## 6. Admin

All endpoints require `role=admin`.

| Method | Path | Description |
|---|---|---|
| GET | `/admin/dashboard` | Real DB aggregates: GMV, completed bookings, active listings, live offers, dispute rate, dealers, recent activity. |
| GET | `/admin/requests` | All listings (`status`, `city_id`, paginated). |
| GET | `/admin/requests/{id}/matching` | Eligibility + ranking explanation for a listing. |
| GET | `/admin/bookings` | All bookings (`status`, `city_id`, `search`). |
| GET | `/admin/bookings/{id}` | Full booking detail. |
| GET | `/admin/offers` | All offers (`status`, `request_id`). |
| GET | `/admin/dealers` | Dealer applications (`status`, `search`). |
| GET | `/admin/dealers/{id}` | Dealer detail with documents and stats. |
| POST | `/admin/dealers/{id}/approve` | Approve with optional notes. |
| POST | `/admin/dealers/{id}/reject` | Reject with reason. |
| POST | `/admin/dealers/{id}/suspend` | Suspend with reason. |
| POST | `/admin/dealers/{id}/reactivate` | Reactivate an approved dealer. |
| GET | `/admin/users` | All users (`role`, `status`, `search`). |
| POST | `/admin/users/{id}/{action}` | `suspend` or `reinstate`. Reason required; admin accounts are rejected. |
| GET | `/admin/payments` | Payment ledger (`status`). |
| POST | `/admin/payments/{id}/verify` | Manual reconciliation (not gateway verification). |
| GET | `/admin/disputes` | Disputes (`status`). |
| POST | `/admin/disputes/{id}/resolve` | Body: `resolution` (reason), `outcome` (`resolved`/`rejected`/`adjust_settlement`), optional `adjusted_final_payout`, `adjusted_deductions`, `deduction_reason`; for non-adjust outcomes `booking_status_after` is required (`settlement_pending`/`completed`/`cancelled`). |
| GET | `/admin/reviews` | Reviews (`status`). |
| POST | `/admin/reviews/{id}/moderate` | `publish`/`flag`/`hide` with a note. |
| GET | `/admin/support` | Support tickets (`status`). |
| PATCH | `/admin/support/{id}` | Reply/update status/priority. |
| GET | `/admin/reports` | Abuse reports (`status`). |
| PATCH | `/admin/reports/{id}` | Resolve/dismiss with notes. |
| GET/POST | `/admin/material-categories` | List/create categories. |
| PATCH/DELETE | `/admin/material-categories/{id}` | Update/deactivate. |
| GET/POST | `/admin/cities` | List/create cities. |
| PATCH | `/admin/cities/{id}` | Update/activate/deactivate. |
| GET/POST | `/admin/fee-rules` | List/create fee rules. |
| POST | `/admin/fee-rules/{id}/deactivate` | Deactivate a rule. |
| GET/POST | `/admin/price-references` | List/create indicative price references. |
| DELETE | `/admin/price-references/{id}` | Delete a price reference. |
| GET | `/admin/exports/{kind}` | CSV export: `bookings`, `dealers`, `disputes`, `audit-logs`. |
| GET | `/admin/audit-logs` | Audit trail (`action`, `entity_type`, `actor_id`, `since`, `until`). |

## 7. Notifications, support and files

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/notifications` | any | `unread_only`, paginated. |
| POST | `/notifications/{id}/read` | any | Mark one read. |
| POST | `/notifications/read-all` | any | Mark all read. |
| GET/POST | `/support/tickets` | any | List/create support tickets. |
| POST | `/support/reports` | any | Report a user. |
| GET | `/files/{key}` | authorized | Stream a private upload after an ownership/role check. |

## 8. Example: full happy path (cURL)

```bash
BASE=http://127.0.0.1:8000/api/v1

# 1) Sign in (development: dev_otp comes back in the response)
curl -s -X POST $BASE/auth/otp/request \
  -H 'Content-Type: application/json' \
  -d '{"phone":"9000000001","role":"customer","purpose":"login"}'

curl -s -c cookies.txt -X POST $BASE/auth/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"phone":"9000000001","code":"123456","role":"customer"}'
# -> { "access_token": "...", "user": { ... } }

TOKEN=...   # access_token

# 2) Create and publish a listing
curl -s -X POST $BASE/scrap-requests -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"address_id":"...","preferred_date":"2026-11-02","time_window":"morning",
       "items":[{"category_id":"...","estimated_weight_kg":"7.5"}]}'

curl -s -X POST $BASE/scrap-requests/{id}/images -H "Authorization: Bearer $TOKEN" \
  -F 'file=@scrap.jpg'

curl -s -X POST $BASE/scrap-requests/{id}/submit -H "Authorization: Bearer $TOKEN"

# 3) Accept the chosen offer exactly once
curl -s -X POST $BASE/offers/{offer_id}/accept -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: accept-$(uuidgen)"

# 4) Dealer confirms, starts pickup, records weights and submits settlement,
#    records UPI payment. Customer confirms settlement and payment.
```

## 9. CSV exports

`GET /admin/exports/{kind}` returns `text/csv` with a dated attachment filename.
Cells are quoted/escaped by the standard `csv` module. Exports are limited to
the current data set and are not streamed; for very large datasets, move export
generation to a background job.

## 10. Versioning

The API is versioned by path (`/api/v1`). Status values and error codes are part
of the contract. Additive fields are non-breaking; removing/renaming fields
requires `/api/v2`.
