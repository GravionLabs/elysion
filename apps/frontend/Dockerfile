FROM node:26-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/frontend apps/frontend
COPY apps/frontend-canvas apps/frontend-canvas
COPY packages/design-tokens packages/design-tokens
RUN pnpm install --frozen-lockfile --filter @elysion/frontend... --filter @elysion/frontend-canvas...
RUN pnpm --filter @elysion/frontend build

FROM nginx:alpine AS runtime
# Development defaults; the compose file / deployment sets the real values.
ENV OIDC_ISSUER_URL=http://localhost:8081/realms/elysion \
    OIDC_CLIENT_ID=elysion-frontend
COPY apps/frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/apps/frontend/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
