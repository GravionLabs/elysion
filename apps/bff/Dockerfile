FROM node:24-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/bff apps/bff
RUN pnpm install --frozen-lockfile --filter @elysion/bff...
RUN pnpm --filter @elysion/bff run build
RUN pnpm --filter @elysion/bff deploy --prod /out

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
EXPOSE 3000
CMD ["node", "dist/main.js"]
