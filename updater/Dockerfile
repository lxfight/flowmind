FROM python:3.12-alpine

ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
RUN --mount=type=cache,id=flowmind-apk-cache,target=/var/cache/apk,sharing=locked \
    sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR}|g" /etc/apk/repositories && \
    apk add docker-cli docker-cli-compose git curl postgresql-client

ARG APP_VERSION=0.2.2
ARG GIT_SHA=development
ARG BUILD_TIME=

WORKDIR /app
COPY server.py cli.py ./

ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

EXPOSE 8090
CMD ["python3", "/app/server.py"]
