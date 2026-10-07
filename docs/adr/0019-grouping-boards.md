# ADR 0019: How boards are grouped in the overview

- Status: Proposed
- Date: 2026-10-07
- Issues: #563, #564 (Feature #559); implemented in #565 (business backend and BFF) and #569 (the overview), which are written for the recommended option
- Builds on: [ADR 0014](0014-keycloak-identity-provider.md), "Board authorization" in [business-backend.md](../specs/business-backend.md)

## Context

The board overview (`BoardList`) is one flat list, newest first: the boards the caller owns or is a member of. That works
for a handful of boards and not for a team that holds a board per sprint, per workshop and per customer. Mural groups
boards in **rooms**; this ADR decides what Elysion does, because the answer changes the data model, the access rules and the
layout of the overview, and two PBIs (#565, #569) wait for it.

What exists today (checked in the code on 2026-10-07):

- A `Board` has an `OwnerId` and a list of `BoardMembership` rows `(BoardId, UserId, Role)`, `Role` being `Owner`,
  `Editor` or `Viewer`. Access is rank-based: three policies (`BoardRead`, `BoardWrite`, `BoardAdminister`) compare the
  caller's role on **that board** with a minimum. The board's owner is an Owner even without a membership row. A caller
  without a role gets `404`, not `403`, so ids cannot be probed.
- `GET /boards` returns only boards the caller owns or is a member of. A board is `{ id, name, createdAt, path }`.
- The realtime service asks the BFF's WS token check for the role (`GET /boards/{id}/membership/me`), so any new way to
  get a role on a board has to end up in that answer too.
- Sharing (invitations by role) exists per board (#245).

Constraints: a board must keep working with no grouping at all (a blank account, a link sent to a stranger); the 404-not-403
rule stays; a change to access rules touches the BFF, the backend **and** the realtime handshake, so the smaller the
change there, the better.

## Options

**A. Rooms as shared spaces (as in Mural).** A room has a name, an owner and members with roles (`Owner`, `Editor`,
`Viewer`). A board lives in at most one room. A room member gets the room's role on every board in the room, **in
addition** to what the board's own memberships give: the effective role is the higher of the two. Boards outside any
room stay exactly as they are today.

- _User sees:_ a sidebar with "All boards", "Not in a room" and the user's rooms; a room's page lists its boards and its
  members; New board in a room creates the board there.
- _Access control:_ **adds** to the board membership (union, highest rank wins). The authorization handler gets one more
  source of a role; the policies do not change.
- _Data model:_ new `Room` (`Id`, `Name`, `OwnerId`, `CreatedAt`) and `RoomMembership` (`RoomId`, `UserId`, `Role`,
  `CreatedAt`); `Board.RoomId` (nullable foreign key). One migration, existing boards get `RoomId = null` and nothing else
  changes.
- _Effort:_ the two planned PBIs: #565 (3 tasks: entities and migration, endpoints and room-aware access, end-to-end
  test) and #569 (2 tasks: API client and sidebar, room management and moving boards).
- _Risk:_ the highest. Access now has two sources, so "why can this person see this board" needs an answer in the UI and
  in the tests; the WS token check and the board list query both change.
- _Later:_ nested rooms, room-wide invitations by link, per-room defaults for new boards.

**B. Rooms as organization only.** A room is a named container that groups boards for the people who can see them.
Access stays per board: the room list shows only the boards the caller can already see.

- _User sees:_ the same sidebar as A, but nobody can "give a room to a team": everybody has to be invited to every
  board.
- _Access control:_ **does not exist** for rooms; `BoardMembership` stays the only source.
- _Data model:_ `Room` (`Id`, `Name`, `OwnerId`) and `Board.RoomId`; no room memberships. A room belongs to a person, and
  two people grouping the same boards need two rooms with the same name.
- _Effort:_ roughly half of A: no room membership, no access change; the room endpoints and the overview remain.
- _Risk:_ low technically, high in product terms: it looks like Mural's rooms and does not behave like them. Who sees a
  room that holds boards of different people, and who may rename or delete it, has no good answer.
- _Later:_ turning it into A, which means a second migration and a changed meaning of existing rooms.

**C. Personal folders.** Each user arranges the boards they can see into their own folders; nobody else sees them.

- _User sees:_ folders in the sidebar, drag or "Move to" on a card; the same board can be in different folders for
  different people.
- _Access control:_ none, folders are a private view.
- _Data model:_ `Folder` (`Id`, `OwnerId`, `Name`) and `BoardFolder` (`FolderId`, `BoardId`) or a per-user placement
  `(UserId, BoardId, FolderId)`. A board deleted or unshared must drop the placements of everybody it concerned.
- _Effort:_ about as much as B. No shared meaning: a team cannot say "everything for the Q3 workshop is in this folder".
- _Later:_ nested folders; sharing a folder (which is A with another name).

**D. Tags.** Flat labels, several per board, shared or personal.

- _User sees:_ chips on the cards and a filter row; no navigation tree.
- _Access control:_ none. Shared tags need a rule for who may create and rename them, which is a rights model by the back
  door; personal tags are C without nesting.
- _Data model:_ `Tag` and `BoardTag`; shared tags have an owner or a scope as well.
- _Effort:_ small for personal tags, medium for shared ones. Scales worst on the page: a long list of unorganized
  boards with a filter is still a long list.
- _Later:_ saved filters.

**E. No grouping, but search, sorting and favorites.** The overview gets a search field, sorting (newest, last opened,
name) and a star on a card; favorites float to the top.

- _User sees:_ a faster way through the same flat list.
- _Access control:_ none. _Data model:_ a `Favorite` per user and board, "last opened" needs a timestamp that is written
  on every visit (a write on read).
- _Effort:_ the smallest of all. It does not answer "show me everything that belongs to this workshop".
- _Later:_ any of A to D on top of it. Search and sorting are worth having under every option.

## Criteria

| Criterion                                | A: shared rooms                          | B: rooms for organization          | C: personal folders           | D: tags                    | E: search and favorites       |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------- | ----------------------------- | -------------------------- | ----------------------------- |
| Gives a team a shared place for its work | Yes                                      | No (only a shared name, if at all) | No                            | Partly (shared tags)       | No                            |
| Matches what users know from Mural       | Yes                                      | Looks like it, behaves differently | No                            | No                         | No                            |
| Effect on access control                 | Adds a second source of a role           | None                               | None                          | None (or a rights model)   | None                          |
| Change in the realtime handshake         | Yes: `membership/me` includes the room   | No                                 | No                            | No                         | No                            |
| New entities                             | `Room`, `RoomMembership`, `Board.RoomId` | `Room`, `Board.RoomId`             | `Folder`, placement           | `Tag`, `BoardTag`          | `Favorite`, last opened       |
| Effort (PBIs as planned)                 | #565 (3 tasks) + #569 (2 tasks)          | About 60 percent of A              | About 60 percent of A         | 40 to 70 percent of A      | About 25 percent of A         |
| Existing boards                          | Stay as they are (`RoomId` null)         | Stay as they are                   | Stay as they are              | Stay as they are           | Stay as they are              |
| Fit in the overview                      | Sidebar with rooms, room page            | Sidebar                            | Sidebar                       | Filter row, chips on cards | Search field, sort menu, star |
| Risk                                     | Highest: two sources of access           | Product risk: unclear ownership    | Low                           | Low to medium              | Lowest                        |
| Easy to extend later                     | Nested rooms, invitations to a room      | Becomes A by migration             | Becomes A by sharing a folder | Combines with any          | Combines with any             |

## Recommendation

**Option A, rooms as shared spaces**, with search and sorting (E) as a later, independent addition.

The reasons: it is the only option where a team gets a place of its own, which is what the grouping is for; it matches the
product Elysion measures itself against; and B and C do not go away cheaply, because each of them ends in A (a room that
needs a member list, a folder that gets shared). The price is the access model, and it is kept small on purpose:

- **A room's role adds to the board's role; the highest rank wins.** `BoardAuthorizationHandler` asks the repository for
  the board role and, if the board is in a room, for the caller's room role, and takes the maximum. A board's own
  members keep their roles; leaving a room cannot lock out a person who was invited to the board itself.
- **A caller with no role from either source still gets `404`.** `GET /boards/{id}/membership/me` answers with the
  effective role, so the BFF's WS token check and the realtime service need no change at all.
- `GET /boards` returns the boards where the caller has a role from either source.

Answers to the questions the option raises:

| Question                                          | Answer                                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What happens to a board when its room is deleted? | The boards stay and leave the room (`RoomId` becomes null). They keep their own owner and board memberships; the room's members lose the access the room gave them. The confirmation says so and counts the boards.       |
| May a board be in no room?                        | Yes. It is the state of every existing board and of every board created from "All boards". The sidebar lists them as "Not in a room".                                                                                     |
| Who may move a board into or out of a room?       | The board's Owner, and only into a room where they are at least an Editor; out of a room, the board's Owner or the room's Owner. Moving never changes the board's own memberships.                                        |
| Does the creator of a board in a room own it?     | Yes. `OwnerId` is the creator, as today. Room roles map onto the board ranks one to one (a room Owner is an Owner of its boards, so a room can be kept clean by its owner), but nobody loses ownership of what they made. |
| Who may create, rename and delete a room?         | Any signed-in user creates one and becomes its Owner. Rename and member management: room Owner. Delete: room Owner.                                                                                                       |
| Who may create a board in a room?                 | Editor and Owner of the room; the creator owns the new board.                                                                                                                                                             |

### Sketch of the overview for A

```text
+---------------------------------------------------------------+
| (E) Elysion                               [+ New board]  (dev) |
+----------------+----------------------------------------------+
| All boards     | Sprint planning                    6 boards   |
| Not in a room  | [Members: Ana, Ben, +2]                       |
| ROOMS          |                                               |
| > Sprint pl.   | +--------+  +--------+  +--------+            |
|   Customer X   | | SP     |  | RT     |  | KB     |            |
|   Workshops    | | Sprint |  | Retro  |  | Kanban |            |
| [+ New room]   | +--------+  +--------+  +--------+            |
+----------------+----------------------------------------------+
```

On a phone the sidebar becomes a menu above the grid. "New board" in a room creates the board there.

## If the owner picks something else

- **B** (rooms for organization): #565 loses its access task (room membership and the room-aware handler) and most of
  the end-to-end test; #569 keeps the sidebar but has no member management. Both are rewritten.
- **C** (personal folders): #565 is replaced by a smaller per-user placement; #569 gets folder management and no members.
- **D** (tags) and **E** (search and favorites): #565 is dropped or rewritten as a small `Tag`/`Favorite` endpoint;
  #569 becomes a filter row and chips (D) or a search and sort bar (E), a much smaller page change.

## Decision

Pending: the product owner picks an option. After the decision the status becomes Accepted and the `needs-decision`
label is removed from #563, #564 and the dependent PBIs (#565, #569, or whatever replaces them).
