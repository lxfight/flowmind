FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN --mount=type=cache,id=flowmind-npm-cache,target=/root/.npm,sharing=locked \
    npm ci --registry="${NPM_REGISTRY}"

ARG APP_VERSION=0.2.1
ARG GIT_SHA=development
ARG BUILD_TIME=
ENV VITE_APP_VERSION=$APP_VERSION
ENV VITE_GIT_SHA=$GIT_SHA
ENV VITE_BUILD_TIME=$BUILD_TIME

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
