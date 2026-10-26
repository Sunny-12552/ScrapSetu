# Testing

## 1. Automated backend tests

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest tests -q
```

- **51 tests**, all passing.
- Tests use an isolated SQLite file, `ENVIRONMENT=test`, rate limiting disabled,
  the scheduler disabled, and the development OTP mode enabled.
- Each test module gets a fresh database; fixtures create users, catalogue,
  dealers, listings and offers on demand.

### Coverage by file

| File | Tests | What it proves |
|---|---|---|
| `test_auth_roles.py` | 9 | Health/metadata, protected endpoints, OTP cookie, wrong OTP + attempt count, role enforcement, admin sign-in, customer cannot request admin role, refresh rotation revokes old cookie, logout revokes access |
| `test_security.py` | 13 | Indian phone normalization (4 cases) and rejection (5 cases), OTP hash phone-binding, JWT round-trip/tamper detection, JWT signed with another key rejected, comma/JSON CORS origin parsing |
| `test_marketplace_flow.py` | 4 | Full lifecycle offer → review, idempotent acceptance returns one booking, offer comparison data, customer cannot read another customer's listing |
| `test_concurrency.py` | 2 | Second accept returns `409 already_booked`; the database partial unique index rejects a manually inserted second live booking |
| `test_negative.py` | 9 | Expired offer, dealer below minimum, duplicate offer without revision, payment tampering, confirming payment before recording, private image access for another customer and unrelated dealer, invalid image, duplicate material lines |
| `test_settlement.py` | 8 | `ROUND_HALF_UP` (never banker's), 3-dp weights, per-line rounding, gross − deductions − fee + adjustments, non-negative payout, negative inputs rejected, indicative payout, zero default fee |
| `test_admin.py` | 6 | Real dashboard aggregates, dealer approval requires documents + audit, CSV attachment streaming, admin-only fee rules, user filtering, CSV formula-injection neutralization |

### Test fixtures

`tests/conftest.py` provides:

- `db` – SQLAlchemy session bound to the test engine;
- `client` – `TestClient` with the application;
- `login(phone, role)` – OTP sign-in helper returning auth headers;
- `catalogue` – categories, city, fee rules;
- `marketplace` – approved dealers, customers, a published listing and offers.

### Running a subset

```powershell
..\.venv\Scripts\python.exe -m pytest tests/test_negative.py -q
..\.venv\Scripts\python.exe -m pytest tests -q -k "settlement or concurrency"
..\.venv\Scripts\python.exe -m pytest tests/test_marketplace_flow.py -q -s
```

## 2. Frontend checks

```powershell
cd frontend
npm run typecheck     # tsc --noEmit, strict mode
npm run build         # tsc --noEmit + Vite production build
```

Both pass. The build warns that the main chunk is ~845 kB (before gzip) because
Zod, React and the UI are in one bundle. This is acceptable for the MVP; split
admin/customer routes with `React.lazy` before optimizing for low-bandwidth
users.

## 3. Manual end-to-end QA performed

The following flows were exercised against the running app with real HTTP calls
and browser interaction:

### Authentication
- Customer, dealer and admin OTP sign-in; role mismatch rejected.
- Session restoration after reload, refresh rotation, sign-out, suspended user
  rejection.
- Dev OTP banner shown and auto-filled only in development.

### Customer
- Dashboard aggregates and recent activity.
- Listing wizard: default address, item add/remove, image upload/preview
  revocation, review step, publish; stale step errors cleared after fixing.
- Listing detail, offer comparison, quote breakdown, accept offer.
- Booking detail: dealer contact after confirmation, measurements prefill,
  settlement breakdown, dispute, payment confirmation, review.
- Transactions, addresses CRUD, support ticket, notifications.

### Dealer
- Marketplace matching, eligibility explanation, listing detail, image access.
- Create quote, revise quote (v2), withdraw; minimum-collection enforcement.
- Confirm job, start pickup, record weights, submit settlement.
- Dispute response, record UPI payment, dashboard earnings.

### Admin
- Sign-in; dashboard real aggregates (GMV, dispute rate, completed jobs).
- Dealer approve/reject/suspend/reactivate; document review.
- Listing matching explanation; bookings/payments/offers lists.
- Dispute resolution: reject, adjust settlement with deduction reason and
  customer re-confirmation, complete/cancel/fail.
- Users suspend/reinstate; abuse reports; reviews flag → republish.
- Catalogue: fee rule create/deactivate, category, city, price reference.
- Support reply; audit log; CSV exports (`bookings`, `dealers`, `disputes`,
  `audit-logs`) with attachment headers.

### Cross-cutting
- Offer exclusivity: second accept → `409 already_booked`.
- Adjustment consistency: settlement row and `calculation` both show gross
  ₹129.60, deduction ₹9.60, payout ₹120.00; payment ₹120 confirmed; booking
  completed; 5-star review published.
- Money fields verified as JSON strings across customer, dealer and admin APIs.
- Dealer phone revealed to customer only on an active booking.
- Image access denied to unrelated customers/dealers.

## 4. Suggested CI pipeline

```yaml
# shape only — adapt to your CI provider
backend:
  steps:
    - checkout
    - run: pip install -r backend/requirements-dev.txt
    - run: cd backend && pytest tests -q
frontend:
  steps:
    - checkout
    - run: cd frontend && npm ci
    - run: cd frontend && npm run typecheck
    - run: cd frontend && npm run build
```

Add a PostgreSQL service container to the backend job to run the suite against
PostgreSQL as well. The current suite runs on SQLite; the schema and ORM path are
shared, but PostgreSQL-specific plans/locks are not exercised.

## 5. Gaps and recommended next tests

- No committed Playwright/Cypress E2E suite; the QA above was manual. Add a
  small Playwright suite for sign-in, publish, accept, settle, admin resolve.
- No PostgreSQL CI matrix yet.
- No load test for offer acceptance under high concurrency (the DB invariant is
  tested, but throughput is not).
- No contract tests between SPA types and OpenAPI; generate the client from
  `openapi.json` or add schema checks.
- No accessibility audit. Add axe-core checks to the E2E suite.
- No visual regression tests.
- CSV injection is unit-tested; file malware scanning is not implemented.
- Docker Compose was not executed in this environment (Docker unavailable), so
  the image build should be smoke-tested on a machine with Docker.
