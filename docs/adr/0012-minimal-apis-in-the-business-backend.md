# ADR 0012: Minimal APIs in the business backend, and no Carter for now

- Status: accepted
- Date: 2026-10-05
- Issues: #428, #429, #430, #431
- Builds on: [ADR 0003](0003-net10-business-backend.md)

## Context

The business backend was scaffolded with MVC controllers (`HealthController`, `BoardsController`). The
product owner wants it to use ASP.NET Core minimal APIs instead and asked whether a library such as
[Carter](https://github.com/CarterCommunity/Carter) makes sense on top of them. The board document API for
realtime (#269) is the first set of endpoints written that way.

What the backend needs from its API layer: a handful of endpoints today (health, five for boards, three for
board documents) that will grow to a few dozen (templates, members, export); JSON bodies and, for board
documents, raw `application/octet-stream`; simple validation (a name of 1 to 120 characters); no file or form
uploads; no content negotiation (JSON only); tests through `WebApplicationFactory<Program>`.

## What Carter is

From its README and NuGet page (checked on 2026-10-05):

- A thin layer over minimal APIs. An `ICarterModule` has an `AddRoutes(IEndpointRouteBuilder)` method; all
  modules are found by scanning assemblies and registered automatically (`app.MapCarter()`).
- Helpers on top: `Validate`/`ValidateAsync` and `MapPost<T>`/`MapPut<T>` that validate with FluentValidation
  and answer `422` on failure; file binding (`BindFile`, `BindFileAndSave`); form binding (`MapFormPost<T>`);
  content negotiation through `IResponseNegotiator`.
- Version 10.0.0 was released on 2025-11-13 and targets `net10.0`; before it 9.0.0 (2024-11-16), 8.2.1
  (2024-06-06) and 8.2.0 (2024-05-24), so about one major release a year, following .NET. About 4.8 million
  downloads. Dependencies: FluentValidation 12.1 or later, `Carter.Analyzers`, and
  `Microsoft.Extensions.DependencyModel` (for the assembly scan).

What ASP.NET Core 10 already offers without it:

- `MapGroup` for a shared prefix, tags and filters; `TypedResults` for typed, documented responses; endpoint
  filters.
- Built-in validation of minimal API parameters and bodies with DataAnnotations: `AddValidation()` once, then
  attributes on request types; failures answer `400` with problem details.
- Endpoint grouping by plain code: one `static IEndpointRouteBuilder MapXEndpoints(this IEndpointRouteBuilder)`
  extension method per feature, called from `Program.cs`.

## Options

**A. Plain minimal APIs**, one extension method per feature, `MapGroup` and `TypedResults`, DataAnnotations
validation through `AddValidation()`, explicit registration in `Program.cs`. This is what
`Endpoints/BoardDocumentEndpoints.cs` already does.

**B. Minimal APIs with Carter**: the same handlers in `ICarterModule` classes, found by assembly scanning,
with FluentValidation for request validation.

**C. Stay on controllers.** Not an option: the owner asked for minimal APIs.

| Criterion                  | A: plain minimal APIs                                                                 | B: Carter                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| New dependencies           | None.                                                                                 | Carter, Carter.Analyzers, FluentValidation, DependencyModel.                                                          |
| Finding the endpoints      | One line per feature in `Program.cs`; easy to read and to grep.                       | Automatic by scanning; nothing to register, but also nothing in `Program.cs` to read.                                 |
| Validation                 | One system: built-in DataAnnotations, `400` with `errors` as the API already answers. | FluentValidation next to or instead of the built-in one; its `MapPost<T>` answers `422`, the API's contract is `400`. |
| What the backend would use | -                                                                                     | Module discovery only: it has no file or form uploads and no content negotiation.                                     |
| Testing                    | `WebApplicationFactory<Program>` as today.                                            | The same, modules are ordinary endpoints.                                                                             |
| Maintenance risk           | Moves with .NET.                                                                      | A third-party major release per .NET version; a lag would hold back a .NET upgrade.                                   |
| Cost of changing the mind  | Turning an extension method into a module (and back) is mechanical.                   | The same.                                                                                                             |

## Decision (proposed)

1. **The business backend's endpoints are minimal APIs.** New endpoints are written that way from now on; the
   two controllers move over in #432. This follows the owner's requirement.
2. **Plain minimal APIs (option A), without Carter.** What Carter adds for this backend is module discovery,
   which one `Map…Endpoints()` call per feature already gives explicitly, while it brings a second validation
   library, a different status for validation errors and a third-party release cycle tied to .NET upgrades.
3. **Organization:** an `IEndpointRouteBuilder` extension method per feature in `Endpoints/` that creates a
   `MapGroup` with its prefix and tags and uses `TypedResults` (or a small `IResult` where the response needs
   a status and a body that `TypedResults` cannot combine, as the board document `409` does). Request and
   response types stay records in `Contracts/`. `Program.cs` calls each feature's `Map` method.
4. **Validation:** request records carry DataAnnotations and `AddValidation()` turns failures into the
   existing `400` problem details; rules that need more than attributes (trimming, uniqueness) stay in the
   handler. Whether to keep the current explicit check for the board name is decided while moving
   `BoardsController` (#434), as long as the response stays the same. (#434 kept the explicit check: the board name needs trimming, and it answers the same `400` with `errors.name`.)
5. **Revisit Carter** if the endpoint count grows past a few dozen and registering features by hand becomes a
   burden, or if the backend needs form or file uploads. Because a `Map…Endpoints` method and a Carter module
   have the same shape, adopting it later is a mechanical change.

## Consequences

- No new package. The move of the existing controllers (#432) keeps the behavior: `BoardsApiTests` must pass
  with unchanged expectations.
- `apps/business-backend/AGENTS.md` describes the convention; MVC controllers are legacy until #432 is done.
- Endpoint discovery is explicit: forgetting the `Map` call for a new feature shows up as a 404 in its first
  test, not as silence.

## Owner decision

Accepted by the product owner on 2026-10-05:

1. **Minimal APIs** in the business backend.
2. **No Carter** for now: plain minimal APIs organized by extension methods.

#432 moves the existing controllers over.
