# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# ScrapSetu production image: build the React app, then serve it from FastAPI
# on a single origin (http://localhost:8000). PostgreSQL runs as a separate
# service in docker-compose.yml.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS api
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONIOENCODING=utf-8
WORKDIR /app/backend

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=web /web/dist /app/frontend/dist

RUN mkdir -p /app/backend/var/uploads \
    && useradd --create-home --shell /usr/sbin/nologin scrapsetu \
    && chown -R scrapsetu:scrapsetu /app

USER scrapsetu
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
