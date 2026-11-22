FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
RUN --mount=type=secret,id=registry_ca \
    if [ -f /run/secrets/registry_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/registry_ca; fi \
    && npm ci
COPY frontend frontend
COPY shared shared
COPY ["samples/black shirt test.JPG", "samples/white shirt on body test.JPG", "samples/"]
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY --chown=nginx:nginx docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
