FROM node:24-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/frontend apps/frontend
RUN pnpm install --frozen-lockfile --filter @elysion/frontend...
RUN pnpm --filter @elysion/frontend exec ng build

FROM nginx:alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/frontend/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
