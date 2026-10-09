FROM node:24-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared-types packages/shared-types
COPY packages/node-logging packages/node-logging
COPY apps/realtime apps/realtime
RUN pnpm install --frozen-lockfile --filter @elysion/realtime...
RUN pnpm --filter @elysion/realtime run build
RUN pnpm --filter @elysion/realtime deploy --prod /out

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
EXPOSE 3000
CMD ["node", "dist/main.js"]
