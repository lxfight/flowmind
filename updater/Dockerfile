FROM python:3.12-alpine

RUN apk add --no-cache docker-cli docker-cli-compose git curl postgresql-client

ARG APP_VERSION=0.2.1
ARG GIT_SHA=development
ARG BUILD_TIME=

WORKDIR /app
COPY server.py cli.py ./

ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

EXPOSE 8090
CMD ["python3", "/app/server.py"]
