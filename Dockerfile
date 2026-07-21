# WACMAKR production image: Vite UI + FastAPI (serves frontend/dist)
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Optional: enable Google button in the built SPA
ARG VITE_GOOGLE_SIGNIN=false
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_GOOGLE_SIGNIN=$VITE_GOOGLE_SIGNIN
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

FROM python:3.13-slim-bookworm
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY data /app/data
COPY --from=frontend /app/frontend/dist /app/frontend/dist

ENV PYTHONPATH=/app/backend
ENV PYTHONUNBUFFERED=1
# Persist DB / cases / chroma on a Railway volume mounted at /data when available
ENV SQLITE_PATH=/data/wac_app.db
ENV CHROMA_DIR=/data/chroma
ENV CASES_DIR=/data/cases

EXPOSE 8000

# Inline entrypoint (avoids Windows CRLF breaking the shebang on Linux)
RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'mkdir -p /data/chroma /data/cases /data/bug-reports' \
  'export PYTHONPATH=/app/backend' \
  'cd /app/backend' \
  'exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"' \
  > /app/docker-entrypoint.sh \
  && chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
