# ADR 0029: Dot voting moves from the Yjs document to the business backend

- Status: Accepted
- Date: 2026-10-11
- Issues: #732 (Feature #731)
- Supersedes: [ADR 0020](0020-facilitation-state.md) for the votes (the timer stays in the document)
- Builds on: [ADR 0017](0017-internal-api-authentication.md), [ADR 0011](0011-board-document-persistence.md)

## Context

ADR 0020 chose option A, the Yjs document, for the votes and named its price: viewers cannot vote (their writes are
dropped) and secrecy is a promise of the interface, because every client receives the whole document including who voted
for what. The product owner moved both to requirements (#731, #732), which is the way out ADR 0020 named: option C for the
votes only. The timer is unaffected and stays in the document.

## Decision

The votes live in the business backend; the server decides what each person may see; the realtime service only carries a
signal to the other clients.

**Model.** `VotingSession` (`Id`, `BoardId`, `Name`, `VotesPerPerson`, `Status` open or closed, `Named`, the starter's id
and name, `StartedAt`, `ClosedAt`) and `Vote` (`Id`, `SessionId`, `UserId`, `ElementId`, `CreatedAt`). At most one open
session per board (a unique partial index). Sessions and votes go with the board.

**API** (business backend; the BFF forwards under `/api/boards/...` with the same paths and bodies):

| Call                                                        | Role  | Result                                                                                                                      |
| ----------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /boards/{id}/voting`                                   | read  | `200` the current voting as the caller may see it, or `204` when the board has none                                         |
| `POST /boards/{id}/votings` `{name, votesPerPerson, named}` | write | `201` the new voting; `409` while one is open; `400` for votes outside 1 to 100 or a name over 80 characters                |
| `POST /boards/{id}/votings/{votingId}/votes` `{elementId}`  | read  | `200` the voting after the vote; `409` when the person has no vote left or the voting is closed (problem)                   |
| `DELETE /boards/{id}/votings/{votingId}/votes/{elementId}`  | read  | `200` the voting after one of the person's votes on that element is taken back; `409` when closed; `204` when they had none |
| `POST /boards/{id}/votings/{votingId}/close`                | write | `200` the closed voting with its result; idempotent                                                                         |
| `DELETE /boards/{id}/votings`                               | write | `204` removes every closed voting with its votes; an open one stays                                                         |

Viewers vote (read role); starting, closing and clearing need the write role.

**The voting as the caller sees it** (`VotingView`):
`{ id, name, votesPerPerson, status, named, startedBy: {id, name}, startedAt, closedAt, myVotes: number,
myElementVotes: { [elementId]: number }, placed: { [userId]: number } (open only), result?: [{ elementId, count,
voters?: [{id, name}] }] (closed only; `voters`only when`named`) }`.
While a voting is open the response holds the caller's own votes and, in `placed`, how many votes each person has placed
(not on what): that is what lets a client end the voting once everybody present has spent theirs. A closed voting shows
counts per element and, only when the facilitator chose "named" at the start, the names. An element's label and whether
it still exists are the canvas's business: it drops the elements that are deleted from the result, as before.

**Live update.** After every change (start, vote, retract, close, clear) the backend tells the realtime service, with a
service token like ADR 0017 in the other direction: `POST {REALTIME_URL}/internal/boards/{boardId}/voting` with
`{ "event": "start|vote|retract|close|clear", "voting": VotingBroadcast | null }`, where `VotingBroadcast` is the
`VotingView` without `myVotes`, `myElementVotes` (those are the caller's alone). The realtime service publishes it on the
Valkey channel of the board (so every instance relays it) and sends every client of the board a binary message of type
`5` (`voting`) whose payload is that JSON. A failed notification is logged and does not fail the request: a client also
fetches `GET voting` when it connects and on every `synced`, so a missed signal heals at the next reconnect.

**Clients.** The canvas gets a `votingApi` property from the shell (like `fileStore`): `get`, `start`, `vote`, `retract`,
`close`, `clear`. It fetches the voting on `synced`, updates it from the responses of its own calls and from message `5`
(refetching its own votes when `placed` for the caller differs from what it knows). The element contract
(`startVoting`, `endVoting`, `clearVotingResults`, the `voting` event) stays; `startVoting` takes `named`.

**Auto-end.** A client that may write still ends the voting once everybody present who may vote has spent their votes
(awareness `voter` as before, `placed` from the broadcast); closing is idempotent.

**Migration.** The `voting` key of the document's `session` map is not read any more. A client that may write deletes it
when it finds it; if a voting in it was still open, the client tells the person once with the counts of that voting
(`notice` event) and the votes are gone with the key. Closed old votings are dropped without a message.

## Consequences

- Viewers can vote and the votes are secret while the voting runs, as a property of the system.
- A voting needs the backend and the realtime service's internal route; without the backend the voting menu shows an error.
- A vote is a request: a few per second per person at most; the broadcast is small (no targets).
- A new setting `REALTIME_URL` for the business backend (compose, `.env.example`, the chart) and the realtime service
  accepts calls with a service token at `/internal/...`; Traefik does not route `/internal`.
