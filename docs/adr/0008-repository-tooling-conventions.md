# ADR 0008: Repository tooling conventions

- Status: accepted
- Date: 2026-10-04
- Issues: #144, #150, #107
- Pull requests: #145, #153
- Builds on: [ADR 0002](0002-typescript-version-split.md)

## Context

Elysion started with a Prettier config per app, which disagreed (the NestJS apps used the default print
width and trailing commas, the Angular app 100 columns), no shared editor settings and no root scripts
to build, test or lint everything. GravionLabs/ariadne already solved this with a handful of root files.

## Decision

1. **pnpm only**, pinned through `packageManager`; Node is pinned in `.nvmrc` (24, matching the
   Dockerfiles).
2. **One root formatter configuration**: `.prettierrc` (100 columns, single quotes, trailing commas,
   the Angular parser for HTML), `.prettierignore` and `.editorconfig`. Per-app Prettier configs are
   removed. `pnpm format` / `pnpm format:check` run over the whole repository.
3. **Root scripts fan out** with `pnpm -r --if-present`: `build`, `test`, `lint`.
4. **Linters stay per app.** The NestJS apps use oxlint; the frontend has none yet. There is no root
   ESLint configuration as in ariadne.
5. **No shared `tsconfig.base.json`.** The apps need different module systems and compiler options
   (NestJS with `nodenext` and decorators, the canvas with a bundler and JSX, Angular with its own
   options), so a base would share almost nothing. This keeps [ADR 0002](0002-typescript-version-split.md).
6. **Editor setup is committed**: `.vscode/extensions.json`, `launch.json` (one configuration per
   service and a full-stack compound) and `tasks.json`. Other files in `.vscode` stay ignored.
7. The repository is MIT licensed.

## Consequences

- The initial reformat touched about 40 files; formatting-only commits will show up in `git blame`.
- Every new app inherits the formatter without configuration. A new linter or compiler option still
  has to be chosen per app.
- Ports for local runs are fixed in `launch.json` (frontend 4200, BFF 3000, realtime 3001, business
  backend 5174), and changing them means changing the configurations and the README table together.
