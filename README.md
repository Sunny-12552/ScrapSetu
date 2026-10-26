# ScrapSetu

**Turn your scrap into its real value.**

ScrapSetu is a two-sided scrap marketplace for India. Customers list recyclable scrap,
verified nearby dealers compete with transparent offers, the customer accepts one, the
dealer collects and weighs the material, and the customer approves a transparent final
settlement before payment is marked complete.

This repository is a working MVP: React + TypeScript frontend, FastAPI + SQLAlchemy
backend, PostgreSQL in production (SQLite for zero-install local development),
Alembic migrations, automated tests, and a one-click Windows launcher.

---

## Quick start (Windows)

```bat
start-scrapsetu.bat
```

The launcher checks Python 3.11+ and Node 20.19+, creates the Python virtual
environment, installs dependencies, creates `.env` from `.env.example` on first
run, applies migrations, seeds demo data **only in development**, starts the API
and the web app in separate console windows, and opens `http://localhost:5173`.
Use `start-scrapsetu.bat --update` after changing `requirements.txt` or
`package.json`.

Demo sign-in numbers (development only, OTP is printed in the browser and API console):

| Role     | Phone         |
|----------|---------------|
| Customer | +919000000001 |
| Customer | +919000000002 |
| Dealer   | +919000000101 (approved) |
| Dealer   | +919000000102 (approved) |
| Dealer   | +919000000103 (pending verification) |
| Admin    | +919000000999 |

No default password exists. The OTP is generated per request and expires in 5 minutes.

## Manual quick start

```bash
# 1. Backend (from the repository root)
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
copy .env.example .env
cd backend
alembic upgrade head
python -m app.cli seed-demo
uvicorn app.main:app --reload --port 8000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. API docs: <http://localhost:8000/docs>.
The launcher performs all of this automatically (without `--reload`).

## What works

- Phone-OTP auth for customers, dealers and admins; rotating refresh sessions.
- Listing wizard with images, EXIF stripping, pickup windows and drafts.
- Dealer matching, versioned quotes, exclusive offer acceptance.
- Full booking lifecycle with an explicit state machine, on-site weights,
  settlement versions, disputes, cash/UPI recording and customer confirmation.
- Admin verification, moderation, dispute resolution, catalogue/fee/price
  management, audit log and CSV exports.
- In-app notifications, optional SMS/email adapters, background expiry sweeps.

## Tests

```bash
cd backend
python -m pytest tests -q          # 51 passed
cd ../frontend
npm run typecheck && npm run build
```

## Production stack

- PostgreSQL 16 (`DATABASE_URL=postgresql+psycopg://...`)
- S3-compatible object storage (`STORAGE_BACKEND=s3`)
- Real SMS/OTP provider (`SMS_PROVIDER=msg91` or `twilio`)
- SMTP email, optional Google/Mapbox geocoding
- HTTPS reverse proxy; see `docs/deployment.md`

Docker: `docker compose up --build` (Postgres + API + web build served by the API).

## Documentation

- [Architecture](docs/architecture.md)
- [Database & ER diagram](docs/database.md)
- [API contract](docs/api.md)
- [Business rules](docs/business-rules.md)
- [Security checklist](docs/security.md)
- [Deployment & operations](docs/deployment.md)
- [Testing](docs/testing.md)

## Repository layout

```
scrapsetu/
  backend/     FastAPI API, SQLAlchemy models, Alembic, pytest suite
  frontend/    React + Vite + TypeScript + Tailwind + TanStack Query
  docs/        Architecture, database, API, rules, security, deployment, testing
  scripts/     run-api.bat and run-web.bat (used by the launcher)
  Dockerfile
  docker-compose.yml
  .env.example
  start-scrapsetu.bat
```

## Status

See `IMPLEMENTATION.md` for the phase-by-phase checklist, commands run, test results,
external integrations that require credentials, and known limitations.
