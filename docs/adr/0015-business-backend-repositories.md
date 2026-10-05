# ADR 0015: Repositories in the business backend: hand-written, Ardalis.Specification later if needed

- Status: Accepted
- Date: 2026-10-05
- Issues: #461, #462, #463 (Feature #460); implemented in #468
- Builds on: [ADR 0003](0003-net10-business-backend.md), [ADR 0011](0011-board-document-persistence.md), [ADR 0012](0012-minimal-apis-in-the-business-backend.md)

## Context

The business backend's endpoints take `ElysionDbContext` directly and query it in the handler (about 330
lines in three endpoint classes today: boards, board documents, health). The owner wants the repository
pattern, and asked to compare [Ardalis.Specification](https://github.com/ardalis/specification) with
repositories written by hand. Guard clauses (Ardalis.GuardClauses) are not part of this decision: they are
decided and tracked in #464.

What the repositories must carry, now and in the identity epic (#91):

| Need                                   | Where it comes from                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Boards newest first, one board by id   | board CRUD today                                                                         |
| Boards a user may open, with the role  | authorization (#117): a join over memberships                                            |
| A user by identity-provider subject    | just-in-time provisioning (#115), on the path of every request                           |
| Memberships of a board                 | sharing (#320)                                                                           |
| Versioned save of a board document     | ADR 0011: the writer names the version it is based on, a stale one is a conflict (`409`) |
| Board and owner membership in one save | board creation (#117): two aggregates, one transaction                                   |

That is about eight queries and one operation with its own concurrency rule.

## Prototype and measurements

A throwaway test (not committed) put `Ardalis.Specification.EntityFrameworkCore` 9.3.1 and
`Ardalis.GuardClauses` 5.0.0 into the existing test project and ran specifications through
`RepositoryBase<Board>` against SQLite in memory on .NET 10 and EF Core 10.0.11, the versions of this backend.

- **It works.** A specification with `Where` + `OrderBy`, one with `Include(...).ThenInclude(...)` as a
  `SingleResultSpecification`, one with a `Where` over a collection (`Memberships.Any(...)`) plus `Skip`/`Take`,
  and `CountAsync` all returned the expected rows; the full suite (49 existing tests plus the prototype) passed.
  The guard clauses ran too (`NullOrWhiteSpace`, `OutOfRange`).
- **But it is not built for this runtime.** `Ardalis.Specification.EntityFrameworkCore` 9.3.1 lists
  `net8.0` and `net9.0` targets with EF Core 8.0.19 and 9.0.8 as dependencies. NuGet resolved it to EF Core
  10.0.11 here (a higher version satisfies the dependency), so it runs on a version it was not released for.
- **Maintenance.** The last release is 9.3.1 from 2025-08-24 and the repository's last push is 2025-11-25
  (about ten months before this ADR); an issue "Version 10 - Epic" (#536) is open and no 10.x package exists. The
  guard clauses package is older (5.0.0, 2024-09-30) but small and stable, its repository was pushed in
  September 2026, and its `net8.0` build is what the prototype used.
- **A SQLite limit, not a library one:** ordering by `DateTimeOffset` is not supported by the SQLite provider
  (the prototype had to order by name). Repository tests against SQLite will hit it for "newest first"; the
  same query is fine on Postgres. Whichever option is chosen, that query needs a Postgres test or a
  value converter in the test model.

## Options

**A. Ardalis.Specification: a generic `IRepository<T>` (`RepositoryBase<T>`) and one specification class per
query.** Queries are classes (`BoardsNewestFirst`, `BoardsOfUser(userId)`), reusable and combinable, and
testable on in-memory lists without a database. Two new packages, a base class that exposes `ListAsync`,
`FirstOrDefaultAsync`, `CountAsync` and so on.

**B. Hand-written repositories: an interface per aggregate with intention-revealing methods**
(`IBoardRepository.ListNewestFirstAsync()`, `FindAsync(id)`, `ListVisibleToAsync(userId)`; `IBoardDocumentRepository.TrySaveAsync(id, state, expectedVersion)`),
implemented on `ElysionDbContext`, plus a small `IUnitOfWork` for saves that span aggregates. No dependency;
handlers read as the domain; tests can use NSubstitute (already in the test project) for handlers and SQLite for
the repositories.

**C. Keep the DbContext in the endpoints.** The status quo. Not chosen: the owner asked for the pattern, and
authorization queries (#117) would otherwise be repeated in every handler.

| Criterion                                     | A: Ardalis.Specification                                                             | B: hand-written                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Runs on .NET 10 / EF Core 10                  | Yes in the prototype; packages declare net8/net9 and EF 8/9                          | Yes: it is EF Core 10                                                    |
| Maintenance risk                              | Last release Aug 2025, v10 only planned: a risk at the next EF major                 | None beyond EF Core itself                                               |
| Fit for about eight queries                   | Eight small classes plus two packages for something four methods do                  | A handful of methods per interface, each named for what it is for        |
| Combinations of filter, sort, include, paging | Strong: specifications compose                                                       | Weak: a new combination is a new method                                  |
| `BoardDocument`'s versioned save              | Does not fit a generic `UpdateAsync`; needs its own repository anyway                | Fits: `TrySaveAsync` with the version rule inside                        |
| Unit of work across aggregates                | `SaveChangesAsync` on the repository, one per aggregate: needs a unit of work on top | The same small `IUnitOfWork`                                             |
| Leaking `IQueryable` to callers               | No: callers pass specifications                                                      | No, as long as methods return lists, not queries                         |
| Learning curve for the next developer         | A library's vocabulary                                                               | Plain C#                                                                 |
| Cost of changing later                        | Moving to B means writing the methods the specs hid                                  | Moving to A means turning methods into specification classes: mechanical |

## Decision

1. **Option B: hand-written repositories**, one interface and one EF implementation per aggregate
   (`IBoardRepository`, `IBoardDocumentRepository`, later `IUserRepository` and a membership repository),
   registered in `Program.cs`. Methods return lists, single entities or results, never `IQueryable`.
2. **A small `IUnitOfWork`** (`SaveChangesAsync`) for operations that change more than one aggregate, such as
   creating a board and its owner membership in one transaction. A repository that changes one aggregate
   saves it itself.
3. **`BoardDocument` keeps its versioned save inside its repository** (`TrySaveAsync` returns saved or conflict);
   ADR 0011's protocol and the `409` do not change.
4. **Endpoints and services depend on the interfaces, not on `ElysionDbContext`.** The context is used only by
   the repositories and the migrations.
5. **When to revisit:** adopt Ardalis.Specification when a version built for .NET 10 and EF Core 10 exists and
   either an aggregate has several repository methods that differ only by filter, sort, include or paging, or a
   search with user-chosen criteria arrives. The change is mechanical (a method becomes a specification class
   behind the same interface), so choosing B now does not close A.

## Consequences

- No new dependency and nothing to track for EF Core upgrades beyond EF Core.
- Each new query is a new repository method: the interface grows with the domain. That is the cost B
  accepts; point 5 says when it stops being worth it.
- Repository tests need a relational provider (SQLite in memory, as in `MembershipModelTests`); the
  "newest first" query orders by `DateTimeOffset`, which SQLite cannot, so its test needs a converter in the test
  model or a Postgres test.
- Handlers become easy to unit-test with a substitute repository, but the existing
  `WebApplicationFactory` tests stay the main safety net; they are unchanged by this refactoring (#468).

## Implementation note

Built in #468. Repositories **stage** changes (`Add`, `Remove`) and `IUnitOfWork` commits, for every aggregate, instead of
some repository methods saving themselves and others not: one rule is easier to follow than two, and a request
that changes one aggregate commits once the same way. The one exception stays point 3: the versioned document save
commits inside `SaveAsync`, because it has to turn a lost write into a `Conflict`.

## Owner decision

Accepted by the product owner on 2026-10-05: **option B, hand-written repositories**, as recommended above. #468 implements
it; Ardalis.Specification is revisited under the conditions in point 5.
