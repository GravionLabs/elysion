# 0002 — TypeScript 7 for NestJS services, TypeScript 6 for Angular frontend

## Status
Accepted (revisit if incompatibilities surface)

## Context
`apps/bff` and `apps/realtime` (NestJS) and `apps/frontend` (Angular) are independent pnpm workspace packages. TypeScript 7 is the new native/Go-based compiler line; TypeScript 6 is the last JS-hosted line. NestJS leans heavily on decorators and `emitDecoratorMetadata`; Angular pins a tight supported TypeScript range per major version.

## Decision
- `apps/bff`, `apps/realtime`: TypeScript **7.x**.
- `apps/frontend`: TypeScript **6.x** (whatever range the chosen Angular major actually supports).
- `packages/shared-types`: authored and compiled independently to plain `.js` + `.d.ts` output (its own minimal tsconfig), so it is consumed as compiled output by both sides rather than raw `.ts` — this avoids needing a single shared TS version across the version split.
- No root tsconfig is shared across the TS-6/TS-7 boundary; each app keeps its own `tsconfig.json`.

## Consequences
- Risk: TS 7's ecosystem (ts-jest, SWC transformers, custom decorators, IDE tooling) is new and may lag for NestJS's decorator-heavy style. If a real incompatibility surfaces in `apps/bff` or `apps/realtime`, downgrade that specific package to TS 6 rather than blocking on it.
- `packages/shared-types` must avoid TS-7-only syntax so its source stays buildable to a target both consumers can use.
