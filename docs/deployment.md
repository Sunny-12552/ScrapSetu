# Deployment and operations

## 1. Local development (Windows, one click)

```bat
start-scrapsetu.bat
```

The launcher:

1. verifies Node 20.19+/22.12+ and Python 3.11+;
2. creates `.venv` if missing;
3. copies `.env.example` to `.env` on first run;
4. installs Python and npm dependencies when needed;
5. runs `alembic upgrade head` and the idempotent demo seed;
6. starts the API (`:8000`) and Vite (`:5173`) in separate consoles;
7. opens <http://localhost:5173>.

Use `start-scrapsetu.bat --update` after changing `requirements.txt` or
`package.json`. Demo sign-in numbers are printed by the launcher and in the
README; OTPs appear in the browser and the API console in development.

### Manual development

```powershell
cd backend
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m app.cli seed-demo
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# second terminal
cd frontend
npm run dev
```

### Useful CLI commands

```powershell
cd backend
python -m app.cli seed-demo                          # idempotent demo data
python -m app.cli create-admin --phone 9876543210 --name "Ops Admin" --email ops@example.com
python -m app.cli expire-sweep                       # expire stale listings/offers
```

`create-admin` is the only way to create an administrator. There is no default
admin password; admins sign in with phone OTP.

## 2. Configuration

Copy `.env.example` to `.env` and edit it. Full reference with comments lives in
`.env.example`.

Minimum production changes:

| Variable | Production value |
|---|---|
| `ENVIRONMENT` | `production` |
| `SECRET_KEY` | 48+ random bytes from a secret manager |
| `DATABASE_URL` | `postgresql+psycopg://user:pass@host:5432/scrapsetu` |
| `OTP_DEV_MODE` | `false` |
| `SMS_PROVIDER` | `msg91` or `twilio` + credentials |
| `SECURE_COOKIES` | `true` |
| `PUBLIC_WEB_URL` | `https://app.example.com` |
| `CORS_ORIGINS` | `https://app.example.com` |
| `STORAGE_BACKEND` | `s3` + bucket/credentials |
| `ALLOW_DEMO_SEED` | `false` |
| `ENABLE_SCHEDULER` | `true` for a single process; externalize when scaling |

Generate a secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## 3. PostgreSQL

```sql
CREATE USER scrapsetu WITH PASSWORD 'use-a-secret-manager';
CREATE DATABASE scrapsetu OWNER scrapsetu;
-- optional extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- future fuzzy search
```

Then:

```bash
cd backend
alembic upgrade head
```

Notes:

- Use `sslmode=require` (or stricter) in the URL when the database is remote.
- The DB user only needs rights on its own schema; migrations need DDL.
- Run migrations as a release step, before starting new API processes.
- Never run `seed-demo` in production; `ALLOW_DEMO_SEED=false` makes it refuse.

## 4. Docker

```bash
docker compose up --build
# open http://localhost:8000
```

What it does:

- `db`: PostgreSQL 16 with a named volume and health check;
- `api`: multi-stage build (Node builds the SPA, Python serves it), Alembic
  migration, optional demo seed (`SEED_DEMO=1`), Uvicorn on `:8000`;
- `uploads`: named volume for local storage;
- the SPA is served by FastAPI, so there is one origin and no CORS setup.

Compose defaults are development-friendly (console OTP, demo seed). For a
production-like run, create a `.env` next to `docker-compose.yml` with at least:

```dotenv
ENVIRONMENT=production
SECRET_KEY=<48+ random chars>
OTP_DEV_MODE=false
SMS_PROVIDER=msg91
MSG91_AUTH_KEY=...
MSG91_TEMPLATE_ID=...
MSG91_SENDER_ID=...
SECURE_COOKIES=true
ALLOW_DEMO_SEED=false
SEED_DEMO=0
PUBLIC_WEB_URL=https://app.example.com
CORS_ORIGINS=https://app.example.com
POSTGRES_PASSWORD=<strong password>
```

Put TLS in front of the API (Caddy, nginx, an ALB, or a platform ingress).
Expose only the proxy publicly; keep PostgreSQL on a private network.

## 5. Process model

### Single host

```bash
cd /app/backend
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Use **one worker** if the in-process scheduler is enabled, or run the scheduler
separately and use multiple workers behind a proxy.

### Multiple workers / containers

- Disable the scheduler in API processes (`ENABLE_SCHEDULER=false`).
- Run `python -m app.cli expire-sweep` from cron/Systemd timer/Cloud Scheduler
  every minute.
- Move rate limiting and any future cache to Redis.
- Send all instances to the same PostgreSQL and S3 bucket.
- Sticky sessions are not required (JWT access tokens, no server-side session
  state beyond the DB).

### Reverse proxy checklist

- Terminate TLS; redirect HTTP → HTTPS.
- Pass `Host`, `X-Forwarded-For` (overwrite, do not append untrusted values),
  and `X-Forwarded-Proto`.
- Set request body limits at least as high as `MAX_UPLOAD_MB`.
- Serve `/assets/*` with long-lived caching; everything else `no-store`.
- Do not cache `/api/*` or `/files/*` in a shared CDN.

## 6. Storage

### Local (development only)

`STORAGE_BACKEND=local`, `STORAGE_DIR=./var/uploads`. Back up this directory
together with the database. It is not shared between containers.

### S3-compatible (production)

```
STORAGE_BACKEND=s3
S3_BUCKET=scrapsetu-prod-private
S3_REGION=ap-south-1
S3_ENDPOINT_URL=            # optional for MinIO/R2
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

- Keep the bucket private; no public ACLs.
- Prefer an instance/task IAM role over static keys on AWS.
- Enable versioning and a lifecycle rule for orphaned objects.
- Files are still streamed through the API authorization check by default. If
  you add presigned URLs, preserve the same per-object authorization before
  signing.

## 7. SMS, email and maps

### MSG91

```
SMS_PROVIDER=msg91
MSG91_AUTH_KEY=...
MSG91_TEMPLATE_ID=...
MSG91_SENDER_ID=SCRPSU
```

Create and approve the OTP template with the same wording as the console
message. `OTP_DEV_MODE` must be `false`; test with a real handset before launch.

### Twilio

```
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+91...
```

### Email

`EMAIL_PROVIDER=smtp` plus `SMTP_*`. Delivery failures are recorded in
`notification_deliveries` and never roll back business actions.

### Maps

`MAPS_PROVIDER=google|mapbox` with a key enables geocoding adapters. Distance
ranking is not required; service areas use locality/pincode matching. The app
works with `MAPS_PROVIDER=none`.

## 8. Payments

`PAYMENT_GATEWAY` is deliberately fixed to `manual`. Cash/UPI is exchanged
offline:

1. dealer records method, amount and reference;
2. customer confirms receipt;
3. admin can manually reconcile.

`gateway_verified` is always `false` and the UI says so. If a real gateway is
added later, it must introduce server-side webhook verification, signature
checks, idempotency and a separate verification flag; do not relabel the manual
flow.

## 9. Backups and recovery

- **PostgreSQL:** nightly `pg_dump -Fc`, retain 30 days, test restores monthly.
  For point-in-time recovery, enable WAL archiving/managed PITR.
- **Uploads:** S3 versioning + cross-region replication, or snapshot the local
  volume.
- **Secrets:** stored in a secret manager, backed up separately from the DB.
- **Recovery order:** restore DB → restore/uploads bucket → run `alembic
  upgrade head` → start API → verify `/health` → smoke test sign-in and one
  booking read.

Example backup:

```bash
pg_dump "$DATABASE_URL" -Fc -f "scrapsetu-$(date +%F).dump"
aws s3 cp "scrapsetu-$(date +%F).dump" s3://scrapsetu-backups/db/
```

## 10. Monitoring

- Liveness/readiness: `GET /health` (checks DB connectivity and reports adapter
  status). Alert if non-200 or `database != ok`.
- Metrics to watch: request rate, p95 latency, 5xx rate, 429 rate, OTP failure
  rate, bookings stuck in a non-terminal state, disputes open > 48 h, payment
  confirmations pending > 24 h, scheduler lag.
- Logs: JSON-ish structured lines with request IDs. Ship to CloudWatch/Loki/ELK.
- Errors: add Sentry (or equivalent) to FastAPI and the SPA before launch.
- Uptime: external probe every minute on `/health` and a synthetic sign-in.

## 11. Upgrade procedure

1. Back up the DB.
2. Deploy the new code without starting it.
3. Run `alembic upgrade head`.
4. Start new API workers; drain old ones.
5. Build/serve the new SPA (`npm ci && npm run build` in the image build).
6. Smoke test: health, sign-in, one listing read, one booking read, admin
   dashboard, CSV export.
7. Roll back code first; roll back migrations only if the release notes say the
   downgrade is safe and data loss is acceptable.

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `database is not reachable` in logs | Wrong `DATABASE_URL`, DB down, firewall | Check DSN, container health, security groups |
| `PRODUCTION SECRET_KEY is still the development default` | `.env` not loaded | Set `SECRET_KEY`; restart |
| OTP never arrives | `OTP_DEV_MODE=false` and SMS provider unconfigured/failing | Check provider credentials/template; check API logs |
| `role_mismatch` on sign-in | Wrong role selected or account is admin | Use the correct role; admins must exist |
| 401 immediately after sign-in | Cookies blocked or `SECURE_COOKIES` mismatched | Use HTTPS in production; check `SameSite`/domain |
| 429 on every request | Shared IP/proxy not forwarding client IP | Overwrite `X-Forwarded-For` at the proxy |
| Uploads 413/422 | File too large or wrong format | Check `MAX_UPLOAD_MB`, use JPEG/PNG/WebP/PDF |
| SPA route 404 in production | Frontend dist missing at `frontend/dist` | Build the frontend; keep the same repo layout |
| Images 403 | Not the owner/assigned dealer/admin | Expected authorization behaviour |
| Alembic “target database is not up to date” | Pending migration | Run `alembic upgrade head` |
| Docker API restarts immediately | DB not healthy yet, bad env, failed migration | `docker compose logs api db` |

## 13. Known operational gaps (MVP)

- Rate limits are in-process and not shared across replicas.
- The scheduler is in-process; externalize it when running multiple workers.
- No malware scanning for uploads.
- No automated database backup job in this repository; configure at the
  infrastructure level.
- No CDN/cache layer; fine for early traffic, revisit before scale.
- No structured error tracking or metrics exporter wired in yet.
