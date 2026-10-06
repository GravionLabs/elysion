# ADR 0009: Plain signals for the Angular shell's state, SignalStore when it earns its place

- Status: accepted (2026-10-04); the update of 2026-10-06 below is accepted
- Date: 2026-10-04
- Issues: #123, #125, #129, #130, #317, #318
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

## Update 2026-10-06: the review this ADR asked for (proposed)

The condition of point 2 is met: the session (#306), the presence list (#110) and the board list (#286) exist. This is the
review of what the shell's state looks like now, and whether a store pays off. Facts are from the code of this date.

| State                                                                                                                                             | Where it lives                                                                                  | Who reads it                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Session: the signed-in user (`SessionService`, 90 lines)                                                                                          | a root service; a signal over the login library's observable                                    | `Board` (and through it the top bar and the canvas attributes), `BoardList`'s header, the 401 interceptor |
| Presence: the other people on the board (`PresenceStore`, 45 lines)                                                                               | a service provided by the board page, so it starts empty per board                              | `Board` only (it hands the list to the top bar as an input)                                               |
| Board list                                                                                                                                        | signals in `BoardList` (167 lines with create, delete and errors); `BoardApi` is stateless HTTP | `BoardList` only; nothing is cached between navigations                                                   |
| The board page's own state: status, sync, library, selection, notice, export, import, role, share dialog (about 14 signals in `Board`, 312 lines) | signals in `Board`                                                                              | `Board` and what it passes down as inputs; no sibling reads them                                          |
| Theme (`ThemeService`, 62 lines)                                                                                                                  | a root service: a signal and `localStorage`                                                     | `Board`, `BoardList`                                                                                      |

What this shows:

- **No piece of state is read by more than two components** (the session by two pages and an interceptor, the theme by two
  pages). Presence and the board list have one reader each. The sharing that happens is parent to child through inputs.
- The shell's shared state is already in **small injectable services with a read-only public API** (`SessionService`,
  `PresenceStore`, `ThemeService`), each tested without a component. That is the structure a store would give, without the
  library.
- The **session is not state the shell owns**: the login library holds it, and `SessionService` turns its observable into a
  signal and maps the claims. A store around it would still wrap the library's observable; nothing gets simpler.
- The prototype of #177 (a `BoardStore` with `withState`, `withComputed` and `withMethods`) cost +5.46 kB raw and +1.68 kB
  transferred for a single flag when it was measured. The initial bundle is now 449.87 kB raw and 109.13 kB transferred (it
  has grown by the login library, the share dialog and more), so the same addition is about 1.5 percent of the transferred
  size: small, but for nothing a service does not already give. (The prototype's own numbers were not re-measured on this
  tree.)
- What a store offers that a service does not here (entity collections with caching, `rxMethod`, devtools, undo) is not
  needed by any of the three: the board list is fetched once per visit, nothing is undone in the shell, and nobody debugs
  shell state across components.

### Options

**A. Stay with plain signals and small services (recommended).** Keep point 1 of the decision. Close the draft PR #177 and
#319 as not needed. The convention is written down: state shared beyond one component is an injectable service that holds
signals and exposes them read-only (`asReadonly()`, `computed`), as `PresenceStore` and `SessionService` do.

**B. Adopt `@ngrx/signals` for all three now.** Move `SessionService`, `PresenceStore` and the board list into stores in one change
(#319, starting from #177), keep their public APIs and tests. Costs a dependency, about 1.7 kB transferred, a convention to
learn and the work of #319; gains consistency with ariadne's way of writing state.

**C. Adopt it for the board list only, when it grows.** Not now: the list has one reader and no cache. Revisit when it gets
paging or search with a shared, cached result.

### Decision

1. **Option A**: no `@ngrx/signals` in the shell now. The three pieces stay services; #177 is closed with this reason and #319
   is not done.
2. **Revisit when one of these is true**, and then adopt it for the shared state at once, not piece by piece: a piece of
   state is read by three or more components in different routes; the board list needs paging, search or a cache that
   outlives the page; the shell gets undo or persisted UI state; or the team wants the devtools for shell state.
3. The decision covers only the Angular shell, as before.

### Owner decision

Accepted by the product owner on 2026-10-06: **option A**, plain signals and small services. #177 is closed with this reason
and #319 is not done.
