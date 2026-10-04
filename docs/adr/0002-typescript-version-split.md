# 0002 — TypeScript version per app: TS 6 for NestJS services, TS 6 for Angular frontend

## Status

Accepted — superseded the original TS-7-for-NestJS plan after hitting a concrete incompatibility.

## Context

`apps/bff` and `apps/realtime` (NestJS) and `apps/frontend` (Angular) are independent pnpm workspace packages. TypeScript 7 is the new native/Go-based compiler line; TypeScript 6 is the last JS-hosted line.

The original plan (below, kept for the record) was TS 7 for the NestJS services. While scaffolding `apps/bff` (TS 7.0.2, `@nestjs/cli` 12.0.0), `nest build` failed with:

> The installed TypeScript version (7.0.2) does not expose the programmatic compiler API that the Nest CLI requires. TypeScript 7.0 ships the "tsc" executable only; the compiler API is expected to return in 7.1.

This isn't a peer-dependency warning that can be ignored — the build cannot run at all under TS 7.0.x with the current Nest CLI.

## Decision

- `apps/bff`, `apps/realtime`: TypeScript **6.x** (downgraded from the original TS 7 plan — see Context).
- `apps/frontend`: TypeScript **6.x**.
- `packages/shared-types`: authored and compiled independently to plain `.js` + `.d.ts` output (its own minimal tsconfig), so it is consumed as compiled output by both sides.
- No root tsconfig is shared across apps; each app keeps its own `tsconfig.json`.
- Revisit TS 7 for `apps/bff`/`apps/realtime` once TypeScript 7.1 restores the programmatic compiler API and `@nestjs/cli` confirms support.

## Original decision (superseded)

- `apps/bff`, `apps/realtime`: TypeScript 7.x — blocked by the Nest CLI incompatibility above.

## Consequences

- No TS-version split across the monorepo for now; all apps sit on TS 6.x until the Nest CLI/TS 7 story matures.
- `packages/shared-types` must still avoid syntax that isn't valid on TS 6, since Angular's peer range also gates it.
