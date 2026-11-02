# syntax=docker/dockerfile:1.7
#
# IQVO landing page, fleet-standard packaging: multi-stage (node build -> nginx-unprivileged
# runtime, uid 101, port 8080), digest-pinned bases shared with the ecosystem image,
# static output served read-only. No runtime dependency, no Node in the final image.
#
#   docker build -t iqvo-landing-page --build-arg SITE_URL=https://iqvo.example.com .
#   docker run --rm -p 8080:8080 iqvo-landing-page

# --- build stage ---
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app
ARG SITE_URL=""
ARG DOCS_URL=""
ENV SITE_URL=${SITE_URL} DOCS_URL=${DOCS_URL}
COPY package.json site.config.json ./
COPY data ./data
COPY scripts ./scripts
COPY src ./src
RUN node scripts/build.mjs && node scripts/check.mjs

# --- runtime stage ---
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:378d0c32f6562f7fd9629170797f57d2b953aa09be983b3daaf4809bb039ca00
USER root
RUN apk upgrade --no-cache && mkdir -p /etc/nginx/snippets
USER nginx
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
