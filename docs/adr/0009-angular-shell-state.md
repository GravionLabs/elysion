# ADR 0009: Plain signals for the Angular shell's state, SignalStore when it earns its place

- Status: accepted
- Date: 2026-10-04
- Issues: #123, #125, #129, #130
- Pull requests: #177 (the spike, not merged)
- Builds on: [ADR 0004](0004-canvas-library.md)

## Context

GravionLabs/ariadne keeps its application state in NgRx SignalStore
([its ADR 0004](https://github.com/GravionLabs/ariadne/blob/main/docs/adr/0004-ngrx-signal-store.md)) and the question was whether the
Angular shell, `apps/frontend`, should do the same. The frontend spec prescribes plain RxJS and
signals; today the shell holds exactly one piece of state, the canvas load status in `Board`, a single
`signal`.

Ariadne had reasons Elysion does not have yet: three hand-rolled store classes with their own
structure, an undo/redo stack welded into one of them, a selection that other components had to read,
and several documents open at once.

## Experiment

#177 (a draft pull request that is not meant to be merged) moves `Board`'s status into a `BoardStore`
built with `@ngrx/signals` 22, together with a collaborators list shaped like the presence data #110
will need. Measured against `main`:

|                              | plain `signal`       | `BoardStore`                              |
| ---------------------------- | -------------------- | ----------------------------------------- |
| Code                         | `board.ts`, 39 lines | `board.ts` 42 + `board.store.ts` 39 lines |
| Initial bundle, raw          | 193.82 kB            | 199.28 kB (+5.46 kB)                      |
| Initial bundle, transferred  | 53.00 kB             | 54.68 kB (+1.68 kB)                       |
| Existing Board and App tests | 13 pass              | 13 pass unchanged, plus 2 new store tests |

The store works and is easy to test without a component. For a single status flag it adds a
dependency, a second file and about 1.7 kB for no behavior that a `signal` does not already give.
The presence list shows where it starts to pay: immutable collection updates and derived values such as
the collaborator count read well as `patchState` and `computed`. A plain injectable service holding
signals would do the same job with similar code, though; the difference is convention, not capability.

## Decision

1. **Do not add `@ngrx/signals` to the frontend now.** The shell keeps plain signals in components and,
   where state is shared, in small injectable services.
2. **Reconsider when the shell has real shared state**, for example when the presence list (#110), the
   board list (#102) and the session (#97) all exist and more than one component reads them. Adopt it
   then for all of them at once rather than mixing two styles, starting from the store in #177.
3. The decision covers only the Angular shell. The canvas's React tree is unaffected.

## Consequences

- No new dependency and no bundle growth until there is something for the store to manage.
- When the time comes, the migration is small: the prototype shows that `Board` keeps its public `status`
  signal and its tests unchanged.
- Ariadne and Elysion will differ here for now. Anything shared between them, such as the design tokens
  ([ADR 0005](0005-canvas-follows-ariadne-design.md)), does not depend on how each app holds its state.
