# ScrapSetu — implementation report

**Status:** working, tested MVP of a two-sided scrap marketplace for India.
**Built:** October 2026. **Last verified:** 2026-10-25.

ScrapSetu lets customers publish scrap listings, verified dealers send
per-kg quotes, the customer accepts exactly one offer, the dealer collects and
weighs the material, submits a transparent settlement, and the customer confirms
the payout and payment before the job completes. Admins verify dealers, resolve
disputes, moderate content, manage the catalogue and export data.

---

## 1. What runs today

### One-click Windows launcher

```bat
start-scrapsetu.bat
```

It verifies Python/Node, creates `.venv`, installs dependencies, copies
`.env.example` → `.env`, applies migrations, seeds demo data idempotently,
starts the API and Vite in separate consoles, waits for both to be healthy and
opens <http://localhost:5173>. Use `start-scrapsetu.bat --update` after
dependency changes.

### Manual

```powershell
# terminal 1
cd backend
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m app.cli seed-demo
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# terminal 2
cd frontend
npm run dev
```

- Web app: <http://localhost:5173>
- API docs: <http://127.0.0.1:8000/docs>
- Health: <http://127.0.0.1:8000/health>

### Demo accounts (development only)

| Role | Phone | Notes |
|---|---|---|
| Customer | 9000000001 | Primary demo customer |
| Customer | 9000000002 | Second customer |
| Dealer | 9000000101 | Approved (Kumar Scrap Traders) |
| Dealer | 9000000102 | Approved (Meena Recycling) |
| Dealer | 9000000103 | Pending verification (GreenLoop) |
| Admin | 9000000999 | Admin console |

Type the 10-digit number on `/auth`. The OTP is shown in a development banner
and printed in the API console — no SMS is sent. There is **no default
password** for any account.

---

## 2. Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5.9, Vite 7, Tailwind CSS v4, React Router 7, TanStack Query 5, React Hook Form 7, Zod 4, lucide-react |
| Backend | Python 3.12, FastAPI 0.162, Pydantic 2.14, SQLAlchemy 2.1, Alembic 1.20 |
| Database | PostgreSQL 16 in production; SQLite for zero-install local dev |
| Auth | Phone OTP (HMAC-hashed), JWT access token, rotating opaque refresh token in an HttpOnly cookie |
| Files | Local disk (dev) or S3-compatible storage (prod); Pillow re-encoding strips EXIF |
| Tests | pytest 9 + FastAPI TestClient (SQLite), 51 tests |
| Packaging | `start-scrapsetu.bat`, Dockerfile multi-stage, docker-compose (Postgres + API + SPA) |

---

## 3. Delivered features

### Customer
- Marketing landing page, OTP sign-in, session restore.
- Dashboard with real aggregates and recent activity.
- Listing wizard: address (default preselected), material categories with
  quantities, photo upload with previews and EXIF stripping, pickup date/window,
  notes, review, publish. Draft editing and cancellation.
- Offer comparison with rate/payout/rating/ETA context, quote breakdown,
  exclusive acceptance.
- Booking detail: dealer contact after confirmation, pickup progress, measured
  weights, settlement breakdown, dispute, payment confirmation, completed
  summary, review.
- Address book (max 8), transactions/payout history, support tickets, in-app
  notifications.

### Dealer
- Application/profile, categories, service areas, operating hours, capacity,
  KYC document upload, availability pause/resume.
- Matching marketplace with eligibility explanation; photo preview only while
  eligible.
- Create/revise/withdraw offers (versioned), minimum collection enforcement,
  validity windows.
- Job lifecycle: confirm, start pickup, record actual weights, attach evidence,
  submit settlement, record cash/UPI payment, respond to disputes.
- Dashboard with earnings, rating, job counts and pipeline.

### Admin
- Real database aggregates: GMV, platform revenue, completed collections,
  active listings, live offers, dispute rate, dealer counts, recent activity.
- Dealer verification: approve/reject/suspend/reactivate with reasons and
  document review.
- Listings with matching explanation; all bookings/offers/payments.
- Dispute resolution: reject, adjust settlement (new version, deductions with a
  reason, customer re-confirmation), complete, cancel, fail.
- User suspend/reinstate with reasons (customer self-deletion is a separate endpoint); abuse reports; review flag/hide/publish.
- Catalogue: categories, cities, fee rules, material price references.
- Support ticket replies, audit log, CSV exports for bookings/dealers/disputes/
  audit logs.

### Cross-cutting
- Backend-enforced role and ownership checks on every protected operation.
- Explicit booking state machine with actor rules and history.
- Immutable accepted-offer snapshots; server-recomputed totals.
- Exclusive acceptance guaranteed by row locks and a partial unique index.
- Decimal money math (`ROUND_HALF_UP`), money as JSON strings.
- Idempotency keys for critical mutations.
- In-app notifications plus optional SMS/email adapters with delivery records.
- Background expiry sweeper (listings and offers).
- Audit log for sensitive actions, hashed IPs.
- Responsive warm paper/forest/brass UI, dark app shell, accessible controls and
  visible focus states.

---

## 4. Repository layout

```
scrapsetu/
  start-scrapsetu.bat       one-click Windows launcher
  scripts/
    run-api.bat             API console
    run-web.bat             Vite console
  backend/
    app/
      api/v1/               routers (auth, requests, offers, bookings, dealers,
                            admin, meta, notifications, support, files)
      core/                 config, security, errors, limits, logging, time
      db/                   Base + session
      integrations/         sms, email, storage, maps, payments
      models/               37 tables + enums
      schemas/              Pydantic contracts
      services/             business logic
      workers/              expiry scheduler
      cli.py                seed-demo | create-admin | expire-sweep
      main.py               app factory, health, SPA serving
    alembic/                initial migration
    tests/                  51 tests
    requirements.txt
    requirements-dev.txt
  frontend/
    src/
      components/           AppShell, UI kit, guards, offer modal, toasts
      lib/                  API client, auth, types, formatting, hooks
      routes/               public, customer, dealer, admin, shared
    package.json
    vite.config.ts
  docs/                     architecture, database, API, business rules,
                            security, deployment, testing
  Dockerfile
  docker-compose.yml
  .env.example
  .gitignore
  .dockerignore
  README.md
  IMPLEMENTATION.md
```

**Size:** ~11,400 lines of backend Python, ~13,900 lines of frontend TS/TSX,
~1,100 lines of tests. **API surface:** 94 paths. **Database:** 37 tables.

---

## 5. Verification performed

### Automated

```powershell
cd backend
$env:PYTHONPATH="."
..\.venv\Scripts\python.exe -m pytest tests -q      # 51 passed, exit 0

cd ..\frontend
npm run typecheck                                    # passed
npm run build                                        # passed (845 kB main chunk warning)
```

The suite covers authentication/roles, refresh rotation, full marketplace
lifecycle, idempotent acceptance, concurrency (second booking rejected at API and
DB level), negative authorization/validation cases, Decimal money rules, admin
aggregates/verification/exports, and CSV formula-injection neutralization.

### Live QA (real API + browser)

- Customer/dealer/admin sign-in, role mismatch, session restore, sign-out.
- Full listing publish → dealer quote v1 → revision v2 → customer accepts →
  dealer confirms/starts/weighs/submits settlement → customer disputes weight →
  admin adjusts settlement (v2, deduction ₹9.60, payout ₹120) → dealer records
  UPI ₹120 → customer confirms payment and settlement → booking completed →
  5-star review.
- Verified adjusted settlement row and `calculation` agree (gross ₹129.60,
  deduction ₹9.60, payout ₹120.00).
- Verified exclusive acceptance: second accept returns `409 already_booked`.
- Verified dealer phone is visible to the customer on an active booking and
  hidden elsewhere.
- Verified private image access: owning customer and eligible dealer allowed;
  unrelated customer/dealer denied.
- Verified money fields are strings across customer/dealer/admin payloads.
- Verified admin dashboard aggregates against seeded/live data (GMV ₹1,528,
  dispute rate 50%, 2 completed).
- Verified CSV downloads for bookings/dealers/disputes/audit logs (200,
  `text/csv`, attachment filename).
- Verified admin catalogue changes (fee rule, category, city), user
  suspend/reinstate, review flag → republish, support reply, audit log.

---

## 6. Business rules that are enforced (not just UI)

- One live booking per listing, enforced by a partial unique DB index.
- One accepted offer per listing, enforced by a partial unique DB index.
- Offer totals recomputed server-side; client totals ignored.
- Accepted terms frozen in `offer_acceptance_snapshots`.
- Booking completion blocked until the latest settlement is customer-confirmed
  and confirmed payments cover the payout.
- Customer self-cancellation closes 4 hours before the pickup window.
- Dealer sees the full address/phone only after confirming the job.
- Lowering a payout requires a deduction with a reason; existing deductions can
  never be reduced; customer must confirm the new settlement version.
- Platform fee defaults to zero and is snapshotted per settlement version.
- Payments are always marked `gateway_verified: false`.
- Admin actions are role-checked and audited.
- Uploaded images are re-encoded, size/format-limited, and served only after an
  authorization check.

---

## 7. External credentials required for real use

The app runs end-to-end without these by using explicitly labeled development
adapters. To go live:

| Capability | Variables | Current fallback |
|---|---|---|
| SMS OTP | `SMS_PROVIDER=msg91|twilio`, keys, template, sender | Console logs OTP; dev OTP returned to browser |
| Email | `EMAIL_PROVIDER=smtp`, `SMTP_*` | Console logs messages |
| File storage | `STORAGE_BACKEND=s3`, bucket + keys/role | Local disk under `backend/var/uploads` |
| Geocoding | `MAPS_PROVIDER=google|mapbox`, key | Disabled; locality/pincode matching still works |
| Payments | — | Deliberately manual cash/UPI recording + customer confirmation; no gateway |
| PostgreSQL | `DATABASE_URL=postgresql+psycopg://...` | SQLite file |
| HTTPS | Reverse proxy | Local HTTP |

No external credential is hard-coded. `SECRET_KEY` must be replaced in
production; the app logs an error if the development default is used with
`ENVIRONMENT=production`.

---

## 8. Known limitations

1. **Payments are not gateway-verified.** This is intentional and clearly
   labeled. Cash/UPI is recorded by the dealer and confirmed by the customer;
   admin verification is manual reconciliation.
2. **No real-time chat/push.** In-app notifications plus optional SMS/email.
3. **Rate limiting is in-process.** It is not shared across workers/containers
   and trusts `X-Forwarded-For`; put it behind a trusted proxy and move to Redis
   before scaling out.
4. **Scheduler is in-process.** Run a single API worker or externalize
   `expire-sweep` when scaling.
5. **SQLite is the local default.** Concurrency guarantees are tested on SQLite
   (partial unique index) but production should run the suite against
   PostgreSQL 16.
6. **Docker image not executed in this environment** (Docker unavailable). The
   Dockerfile/compose are written and documented but should be smoke-tested
   before deployment.
7. **No malware scanning** for uploads. Images are re-encoded and PDFs are
   header-checked only.
8. **No Playwright/Cypress suite committed.** Live QA was manual; add browser
   E2E tests to CI.
9. **No automated backups, metrics exporter, error tracking or CDN.** Configure
   at the infrastructure level.
10. **Legal pages are placeholders.** Terms/privacy/grievance flows need legal
    review; `meta/config` marks policy content as a draft.
11. **Frontend bundle is one ~845 kB chunk.** Split admin/customer routes with
    `React.lazy` for low-bandwidth users.
12. **No GST invoicing/accounting integration**, no multi-currency, no
    multi-language UI (data model has a language field).

---

## 9. Security posture

Implemented: OTP hashing + attempt/resend limits, role-scoped router guards,
ownership checks, rotating refresh tokens with reuse detection, in-memory access
tokens, HttpOnly refresh cookie, security headers, CORS allow-list, upload
validation + EXIF stripping + per-file authorization, parameterized queries,
Decimal money, audit log, idempotency, and explicit “not gateway-verified”
payments.

Before public launch: real SMS provider, `OTP_DEV_MODE=false`, strong
`SECRET_KEY`, HTTPS, `SECURE_COOKIES=true`, PostgreSQL + backups, S3 private
bucket, Redis rate limits, malware scanning, proxy that overwrites
`X-Forwarded-For`, centralized logs/alerts, and a staffed security contact. See
`docs/security.md` for the full checklist.

---

## 10. Documentation

- [README](README.md) — quick start, demo accounts, production stack
- [Architecture](docs/architecture.md) — components, flows, trade-offs
- [Database](docs/database.md) — ER diagram, 37-table catalogue, invariants
- [API](docs/api.md) — auth, conventions, endpoint reference, cURL flow
- [Business rules](docs/business-rules.md) — lifecycle, money, disputes, admin
- [Security](docs/security.md) — threat model, controls, production checklist
- [Deployment](docs/deployment.md) — launcher, Docker, Postgres, ops runbook
- [Testing](docs/testing.md) — 51-test matrix, QA evidence, CI suggestions

---

## 11. Suggested next milestones

1. Add Playwright E2E + PostgreSQL CI matrix; run the Docker compose smoke test.
2. Move rate limits/scheduler to Redis + a worker/cron; add structured metrics.
3. Integrate a real SMS provider and verify OTP delivery end-to-end.
4. Add malware scanning and PDF sanitization for uploads.
5. Add legal pages, consent records, and a grievance workflow.
6. Add route-level code splitting, image CDN, and a11y audit.
7. Consider a payment gateway only with server-verified webhooks and a separate
   verification flag; keep the manual flow for cash.
