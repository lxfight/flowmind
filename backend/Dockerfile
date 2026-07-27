FROM python:3.12-slim

WORKDIR /app

ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security
RUN --mount=type=cache,id=flowmind-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,id=flowmind-apt-cache,target=/var/cache/apt,sharing=locked \
    sed -i \
      -e "s|https\?://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g" \
      -e "s|https\?://deb.debian.org/debian|${DEBIAN_MIRROR}|g" \
      /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev ffmpeg

COPY pyproject.toml uv.lock ./
ARG PYPI_INDEX_URL=https://pypi.org/simple
RUN --mount=type=cache,id=flowmind-pip-cache,target=/root/.cache/pip,sharing=locked \
    --mount=type=cache,id=flowmind-uv-cache,target=/root/.cache/uv,sharing=locked \
    pip install --index-url "${PYPI_INDEX_URL}" uv==0.11.28 && \
    UV_INDEX_URL="${PYPI_INDEX_URL}" uv sync --frozen --no-dev --no-install-project

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
