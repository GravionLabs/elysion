# ADR 0020: Where the timer and the votes of a board are stored

- Status: Proposed
- Date: 2026-10-07
- Issues: #577, #578 (Feature #574); implemented in #579 (the timer) and #582 (dot voting), which are written for the recommended option
- Builds on: [ADR 0010](0010-shell-controls-the-canvas.md), [ADR 0011](0011-board-document-persistence.md)

## Context

Facilitation tools as in Mural need state that everybody on the board shares: a **timer** (running, paused, how much is
left) and **dot voting** (a session with a number of votes per person, who put which votes on which element, the
results). Where that state lives decides what a reload, a new participant, a viewer and an export see, so it is decided
once, before either feature is built.

What exists today (checked in the code on 2026-10-07):

- A board is one Yjs document that every client syncs through the realtime service and that is persisted as a whole by
  the business backend (ADR 0011). The canvas binds **only** the map `elements` to Excalidraw
  (`excalidraw-binding.ts`, `ELEMENTS_MAP_KEY`; there is no Yjs `UndoManager`). Any other shared type on the same
  document, such as `doc.getMap('session')`, is synced, persisted and restored on reload without a change to the
  realtime service or the backend.
- A **viewer's** connection is read-only: its sync step 2 and update messages are dropped, never applied or relayed, and
  a connection that keeps sending them (more than 20) is closed with `4403` (`yjs.gateway.ts`).
- **Awareness** (cursors, who is on the board) is relayed across realtime instances through Valkey and vanishes with the
  client; it is never persisted.
- The canvas has **no stable user id**: it makes a random session id per tab. The shell knows the Keycloak `sub`
  (`SessionUser.id`) and the WS token carries it, but `<elysion-canvas>` only gets `user-name` and `user-color`.
- Exports (`board-io.ts`: PNG, SVG, PDF, `.excalidraw`) are made from the scene the Excalidraw API returns (elements,
  app state, files), not from the Yjs document. Overlays such as `ConnectionPoints.tsx` are a separate React layer and
  are not part of the scene or of an export.
- The roles are `owner`, `editor`, `viewer`; the shell knows the user's role and gives a viewer `readonly`.

Constraints: facilitation state must not be undoable with Ctrl+Z, must not appear in an export, and must not break a board
when it is missing (a board that never used facilitation has none).

## Options

**A. The Yjs document.** A map `session` next to `elements`, for example `session.timer` (`state`, `endsAt` or
`remainingMs`, `durationMs`, `startedBy`) and `session.voting` (`id`, `votesPerPerson`, `open`, and the votes). Synced
and persisted by what exists; a reload or a new participant gets the current state with the document.

- Everybody sees the same at the same time (Yjs sync, typically well under a second).
- A reload or a new participant: the state comes with the document, a running timer shows the right remaining time.
- **Viewers cannot write, so they cannot vote** (their writes are dropped, and too many close the connection: the UI
  must not offer the vote to them). They see the timer and the results.
- Anonymity: every client receives the whole document, so a person's votes are readable by anybody who looks into it.
  "Anonymous" would be a promise of the UI (it shows totals only), not a property of the system. A vote needs a person
  (to enforce "n votes each"), so `user-id` has to be passed to the canvas.
- Undo: `session` is outside the `elements` binding, so **Ctrl+Z does not touch it**, and Excalidraw's history does not
  know it. A guard is a test, not an assumption.
- Persistence and export: persisted with the document (a closed session stays until cleared); exports read the scene
  from the Excalidraw API, so votes and the timer never appear in a PDF.
- Effort: small. No change to the realtime service or the backend. New: the `session` map and its observers in the canvas,
  the `user-id` attribute, an element contract for timer and voting (methods and events).
- A timer's `endsAt` is a timestamp from the facilitator's clock, so a participant whose clock differs by a few seconds
  sees a few seconds too much or too little.

**B. Yjs awareness.** The timer and the votes are awareness state of the facilitator's client.

- Everybody sees it live, but it is **gone when the facilitator's tab closes or reloads**, and a participant who joins
  later gets it only while the facilitator is connected. Acceptable for nothing that has to be reliable: the timer would
  stop silently, the votes could be lost.
- Viewers: can read, cannot write (awareness is read-only for them as well).
- Anonymity: nothing is stored, but nothing survives either.
- Undo and export: not affected. Persistence: none.
- Effort: smallest. **Not usable for votes**; for the timer alone it is weaker than A for the same amount of work.

**C. The business backend.** New entities (`FacilitationSession`, `Vote`) and endpoints; the BFF forwards them.

- Votes are stored per user and the server decides what everybody gets: it can return totals only, so anonymity is real
  while a session runs and afterwards. **Viewers can vote** if the endpoint allows them.
- Live updates need their own channel: a new message type through the realtime service (relayed across instances
  through Valkey), or polling. Two clients must see the same count within a second or two, which polling does not do
  cheaply.
- A reload or a new participant: a request for the current state.
- Undo and export: not affected (the state is not in the document). Persistence: a database table, with retention to
  decide.
- Effort: the largest. Entities and a migration, endpoints and authorization, BFF routes, a new realtime message and its
  relay, client code for fetching and live updates, tests at every layer.

**D. A and C mixed.** The timer in the document, the votes in the backend.

- The timer is as in A; votes are as in C, with C's live-update problem for the vote counts and its effort for the votes.
- Two mechanisms to explain and to test; the work of C stays, the only saving is that the timer is simple.

## Criteria

| Criterion                              | A: Yjs document                              | B: awareness                    | C: business backend                           | D: A and C mixed                             |
| -------------------------------------- | -------------------------------------------- | ------------------------------- | --------------------------------------------- | -------------------------------------------- |
| What everybody sees at the same time   | Yes, through the sync                        | Yes while the facilitator is on | Needs a live channel (new message or polling) | Timer yes; votes need the live channel       |
| Reload and new participants            | Get the state with the document              | Lose it with the facilitator    | Fetch it                                      | Timer with the document; votes fetched       |
| Viewers                                | See; cannot vote                             | See; cannot vote                | Can vote                                      | Timer: see; votes: can vote                  |
| Anonymity while running and afterwards | UI promise only (the document has the votes) | Nothing stored                  | Real (the server returns totals)              | Real for votes                               |
| Undoable with Ctrl+Z                   | No (outside the `elements` binding)          | No                              | No                                            | No                                           |
| Persistence and export                 | Persisted with the document; not in exports  | Not persisted                   | Database; not in exports                      | Timer in the document, votes in the database |
| Change in the realtime service         | None                                         | None                            | A message type and its relay                  | A message type and its relay                 |
| Change in the backend                  | None                                         | None                            | Entities, migration, endpoints                | Entities, migration, endpoints               |
| Effort                                 | Small                                        | Smallest                        | Largest                                       | Large                                        |
| Fit for the timer / for votes          | Good / good, with the viewer limit           | Poor / unusable                 | Overbuilt / good                              | Good / good                                  |

## Recommendation

**Option A, the Yjs document, for the first version of both features**, with the viewer limit stated as its price.

The reasons: it is the only option that is small, durable and live at once; it needs no change to the realtime service or
the backend; the board's own sync already solves what the other options have to build (a late joiner, a reload, several
realtime instances); and the two things it cannot do, viewers voting and anonymity as a guarantee, are both limits that a
workshop on a shared board can live with and that the product can state ("viewers watch, collaborators vote"; "results are
shown as totals"). Option C stays the way out if viewers voting or real secrecy becomes a requirement; that is then a
migration of the votes only, because the element contract hides where the state lives.

How the open questions are answered:

| Question                                            | Answer                                                                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who may start and stop the timer, and start voting? | Owners and editors, the people who can write anyway. The shell hides the controls from viewers; the check is the one that exists (a viewer's write is dropped), so no new rule is needed.                                    |
| Who may clear the results?                          | The board's owner, and the person who started the session. Any editor can write the map, so this is a rule of the UI, not an enforced one; the ADR says so rather than hiding it.                                            |
| What happens to votes on a deleted element?         | They stay in the map (cheap) and are left out of the counts while the element is deleted, so an undone delete brings them back; clearing the results removes them.                                                           |
| How is a session identified?                        | A random `id` made when voting starts; every vote belongs to it. Starting a new session, or clearing, replaces the `id`, so late or stale writes of an old session are ignored.                                              |
| How is a person identified?                         | By the Keycloak `sub`, passed as a new attribute `user-id` on `<elysion-canvas>` (the shell has it; today the canvas only has a random id per tab). One person on two tabs is one voter.                                     |
| What does a late joiner see of a running timer?     | The remaining time, computed from `endsAt` and the local clock; a clock a few seconds off shows a few seconds off. This is the stated limit of A; a server-time offset can be added later without changing the stored shape. |

## What changes in the planned PBIs

- **Under A (recommended):** #579 (the timer) and #582 (voting) are as written. The first task of each (#580, #583) adds the
  `session` map, the `user-id` attribute and the element contract; the shell tasks (#581, #585) and the canvas task
  (#584) build on it.
- **Under B:** #579's state moves to awareness and the timer is lost with the facilitator's tab; #582 cannot be built on
  it and needs A or C.
- **Under C:** the state tasks (#580, #583) become backend and realtime tasks (entities, endpoints, a message type and its
  relay, a client for it), #582 grows by the live updates, and #579 grows if the timer goes there too.
- **Under D:** #579 stays as under A; #582 is rewritten as under C.

## Decision

Pending: the product owner picks an option. After the decision the status becomes Accepted and the `needs-decision`
label is removed from #577, #578 and the dependent PBIs (#579, #582).
