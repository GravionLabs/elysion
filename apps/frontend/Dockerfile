FROM node:26-alpine AS base

FROM base AS build
# Node 25 and later ship without corepack; it is installed for the build only and reads pnpm from `packageManager`.
RUN npm install --global corepack@0.36.0 && corepack enable
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/frontend apps/frontend
COPY apps/frontend-canvas apps/frontend-canvas
COPY packages/design-tokens packages/design-tokens
RUN pnpm install --frozen-lockfile --filter @elysion/frontend... --filter @elysion/frontend-canvas...
RUN pnpm --filter @elysion/frontend build

# The unprivileged variant: user nginx (uid 101), port 8080, pid and temp files in /tmp.
FROM nginxinc/nginx-unprivileged:alpine AS runtime
# The upstream image lags behind Alpine's security fixes (brotli-libs, curl): take the patched packages, then drop root again.
USER root
RUN apk upgrade --no-cache
USER 101
# Development defaults; the compose file / deployment sets the real values.
ENV OIDC_ISSUER_URL=http://localhost:8081/realms/elysion \
    OIDC_CLIENT_ID=elysion-frontend \
    AUTH_IDP_HINT=
COPY apps/frontend/nginx.conf /etc/nginx/templates/default.conf.template
# Runs before the templates are filled (the entrypoint runs /docker-entrypoint.d in order).
COPY --chmod=755 apps/frontend/security-headers.sh /docker-entrypoint.d/10-security-headers.sh
COPY --from=build /workspace/apps/frontend/dist/frontend/browser /usr/share/nginx/html
EXPOSE 8080
