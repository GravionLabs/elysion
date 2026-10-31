FROM node:26-alpine AS base

FROM base AS build
# Node 25 and later ship without corepack; it is installed for the build only and reads pnpm from `packageManager`.
RUN npm install --global corepack@0.36.0 && corepack enable
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
# The `node` user of the image (uid 1000); the files stay owned by root and are only read.
USER 1000
EXPOSE 3000
CMD ["node", "dist/main.js"]
