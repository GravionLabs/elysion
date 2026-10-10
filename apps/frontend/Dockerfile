FROM node:24-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/frontend apps/frontend
COPY apps/frontend-canvas apps/frontend-canvas
COPY packages/design-tokens packages/design-tokens
RUN pnpm install --frozen-lockfile --filter @elysion/frontend... --filter @elysion/frontend-canvas...
RUN pnpm --filter @elysion/frontend build

# The unprivileged variant: user nginx (uid 101), port 8080, pid and temp files in /tmp.
FROM nginxinc/nginx-unprivileged:alpine AS runtime
# Development defaults; the compose file / deployment sets the real values.
ENV OIDC_ISSUER_URL=http://localhost:8081/realms/elysion \
    OIDC_CLIENT_ID=elysion-frontend
COPY apps/frontend/nginx.conf /etc/nginx/templates/default.conf.template
# Runs before the templates are filled (the entrypoint runs /docker-entrypoint.d in order).
COPY --chmod=755 apps/frontend/security-headers.sh /docker-entrypoint.d/10-security-headers.sh
COPY --from=build /workspace/apps/frontend/dist/frontend/browser /usr/share/nginx/html
EXPOSE 8080
