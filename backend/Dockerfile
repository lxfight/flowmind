FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv==0.11.28 && \
    uv sync --frozen --no-dev --no-install-project

ARG APP_VERSION=0.2.1
ARG GIT_SHA=development
ARG BUILD_TIME=

COPY . .

ENV PATH="/app/.venv/bin:$PATH"
ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

EXPOSE 8000

CMD ["sh", "-c", "python -m app.core.migrations && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
