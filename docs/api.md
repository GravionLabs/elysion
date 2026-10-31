# The public API

Elysion has a versioned API for scripts and integrations at `/public/v1` ([ADR 0033](adr/0033-public-api-tokens-and-webhooks.md)). It is
not the API the browser uses (`/api`): it has its own route at the edge, without CORS, a rate limit per token (600 requests a minute) and a
body limit of 1 MiB. This page says how to get a token and make the first call, and what the API has; every route, with its scope, its
parameters and an example of each answer, is in the [reference](api/reference.md), made from the OpenAPI 3.1 document
[`openapi.v1.json`](api/openapi.v1.json) that the code generates.

## The first call

1. In Elysion, open the menu under your name, **Access tokens**, and make a token with the scope **Read boards** (`boards:read`). Copy it:
   it is shown once.
2. Ask who you are, then list your boards:

```sh
TOKEN=elp_...   # the token you copied
curl -s -H "Authorization: Bearer $TOKEN" https://elysion.example.com/public/v1/me
# {"id":"…","name":"Ada","kind":"person","tokenId":"…","scopes":["boards:read"]}
curl -s -H "Authorization: Bearer $TOKEN" 'https://elysion.example.com/public/v1/boards?limit=10'
# {"items":[{"id":"0192f7a4-…","name":"Sprint 42 retro","createdAt":"2026-10-31T09:15:00Z","roomId":null}],"next":null}
```

On the development stack the address is `http://localhost`. To create and rename boards, make a token with `boards:write` as well:

```sh
BOARD=$(curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"From a script"}' \
  https://elysion.example.com/public/v1/boards | jq -r .id)
ETAG=$(curl -s -o /dev/null -D - -H "Authorization: Bearer $TOKEN" https://elysion.example.com/public/v1/boards/$BOARD \
  | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "If-Match: $ETAG" -H 'Content-Type: application/json' \
  -d '{"name":"Renamed by a script"}' https://elysion.example.com/public/v1/boards/$BOARD
curl -s -H "Authorization: Bearer $TOKEN" https://elysion.example.com/public/v1/boards/$BOARD/elements
# {"type":"excalidraw","version":2,"source":"elysion","elements":[],"appState":{},"files":{}}
```

## What v1 has

| Resource  | Routes (under `/public/v1`)                                                                                                                                                                                 | Scope                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Caller    | `GET /me`                                                                                                                                                                                                   | none                                             |
| Boards    | `GET /boards` (`?roomId=` for one room), `GET /boards/{id}`, `POST /boards`, `PATCH /boards/{id}`, `DELETE /boards/{id}`, `POST /boards/{id}/duplicate`                                                     | `boards:read` to read, `boards:write` to change  |
| Elements  | `GET /boards/{id}/elements`, `GET /boards/{id}/files/{fileId}`                                                                                                                                              | `boards:read`                                    |
| Rooms     | `GET /rooms`, `GET /rooms/{id}`                                                                                                                                                                             | `boards:read`                                    |
| Members   | `GET`, `POST /boards/{id}/members`, `PATCH`, `DELETE /boards/{id}/members/{userId}`; the same under `/rooms/{id}/members`                                                                                   | `boards:read` to list, `members:write` to change |
| Snapshots | `GET /boards/{id}/snapshots`, `POST /boards/{id}/snapshots`, `GET /boards/{id}/snapshots/{snapshotId}`                                                                                                      | `boards:read` to read, `snapshots:write` to save |
| Webhooks  | `GET`, `POST /boards/{id}/webhooks`, `GET`, `PATCH`, `DELETE /boards/{id}/webhooks/{webhookId}`, `.../test`, `.../deliveries`, `.../redeliver`; the same under `/webhooks` for every board (administrators) | `webhooks:write`                                 |

- **The same rights as in the browser.** A token acts as its person (or integration) and never sees more: a board you are no member of is
  `404`, as if it did not exist; a viewer cannot rename (`403`); only owners delete a board and change its members.
- **Elements** are the board as an Excalidraw scene (the `.excalidraw` format, version 2): the live elements in drawing order, and the images
  as links (`files.<id>.url`, a route of the API that needs `boards:read`), never inline. It is the state of the last save, at most about 10
  seconds behind an open board. Writing elements is not in v1.
- **Snapshots** (the versions of a board) can be listed, saved and read as JSON (the version and its scene, like the elements). **Renaming,
  deleting and restoring a version, and opening one as a new board, are not in v1**: they are in the browser only.
- **Webhooks** tell your service when a board changes instead of it asking: an owner registers a URL for a board's events, an
  administrator for every board's. The events, the payloads, the retries and how to check the `Elysion-Signature` are in
  [webhooks.md](webhooks.md).
- **Rename** needs `If-Match` with the `ETag` that `GET /boards/{id}` (or the last change) answered; `*` renames whatever the board is
  called now. Without it the answer is `428`, with an old one `412`.
- **Lists** come in pages: `?limit=` (1 to 200, default 50) and `?cursor=`, the `next` of the page before (`null` on the last page). A
  cursor is opaque; one that was not handed out is `400`.
- **Errors** are problem details (RFC 9457, `application/problem+json`): `{"type":"about:blank","title":"Not Found","status":404}`, with a
  `detail` where there is more to say and `code: "account-deactivated"` when the token's owner was deactivated.
- **Rate limit:** 600 requests a minute per token (`PUBLIC_API_RATE_LIMIT_PER_MINUTE`). Every answer says how many are left
  (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` in seconds, `RateLimit-Policy`); over the limit the answer is `429` with
  `Retry-After`. The edge also limits each client address (1200 a minute) against floods.
- **Bodies** are JSON of at most 1 MiB (`413` above).
- **Versioning:** a breaking change is a `/public/v2`; v1 stays for at least six months after it and then answers with `Deprecation` and
  `Sunset` headers.

## Who can call

A caller is one of three:

| Caller                  | Credential                                                     | Scopes                                  | Where it is accepted    |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------- | ----------------------- |
| A script of a person    | A **personal access token** (`elp_...`) the person made        | The ones chosen when the token was made | `/public/v1` only       |
| An integration          | A **Keycloak token** of a service account (client credentials) | The `scope` of the token (see below)    | `/public/v1` only       |
| A person trying the API | The person's own Keycloak access token (the browser's)         | All of them                             | `/public/v1` and `/api` |

Whatever the credential, the caller sees and changes only what its person or integration may: the roles on boards and rooms decide, as in
the browser. A scope only narrows that.

## Scopes

| Scope             | Allows                                           |
| ----------------- | ------------------------------------------------ |
| `boards:read`     | Reading boards, rooms, members and versions      |
| `boards:write`    | Creating, renaming, duplicating, deleting boards |
| `members:write`   | Adding, changing and removing members            |
| `snapshots:write` | Saving versions of boards                        |
| `webhooks:write`  | Registering and managing webhooks                |

A route that needs a scope the credential does not have answers `403`. An unknown, expired or revoked token is `401`.

## Personal access tokens

Make one in Elysion: the menu under your name, **Access tokens**. Give it a name (what it is for), the scopes it needs and an expiry (7, 30
or 90 days, or a year; a token never lives longer than a year). The token is shown **once**, right after it is made: copy it then. Elysion
keeps only a hash of it and its first twelve characters, which the list shows so you can tell your tokens apart.

```sh
TOKEN=elp_...   # the token you copied
curl -s -H "Authorization: Bearer $TOKEN" https://elysion.example.com/public/v1/me
# {"id":"…","name":"Ada","kind":"person","tokenId":"…","scopes":["boards:read"]}
```

- A token acts as you, within its scopes: it never sees a board you do not see.
- The list shows when each token was last used (written at most once a minute). Revoke a token you no longer use; a revoked token is
  refused within 30 seconds.
- A token cannot make, list or revoke tokens, and it is refused on the browser's API (`/api`, `401`).
- When an administrator deactivates you, your tokens stop working at once; administrators can also revoke any token
  (Administration, **Access tokens**).
- Tokens start with `elp_`, so secret scanners can find one that leaked ([Security](security.md#personal-access-tokens-and-secret-scanning)).

## Integrations (Keycloak service accounts)

An integration is a program that is not a person: a chat bot, a sync with a wiki. It authenticates with a client of its own in Keycloak,
made by a Keycloak administrator (Elysion has no administrator rights in Keycloak and does not make clients):

1. **Clients → Create client.** Client type OpenID Connect, a client id that names the integration (it becomes its name in Elysion, for
   example `wiki-sync`). Next: **Client authentication** on, **Service accounts roles** on, every other flow off. Save.
2. **Client scopes → Create client scope**, once per realm, for each scope of the table above: the name is the scope (`boards:read`, …),
   type None, protocol OpenID Connect, **Include in token scope** on.
3. In the new client, **Client scopes → Add client scope**: add the scopes the integration may ask for as **Optional**.
4. In the client, **Client scopes → `<client id>`-dedicated → Add mapper → By configuration → Audience**: name `audience-elysion-bff`,
   included client audience `elysion-bff`, **Add to access token** on. Without it the token is not meant for Elysion and is refused.
5. In the client, **Service accounts roles → Assign role**: the realm role `elysion-integration` (create it under **Realm roles** if the
   realm has none). **Do not leave it out:** without the role Elysion cannot tell the client from a person, so its token would be
   accepted on the browser's API as well and would have every scope.
6. **Credentials**: copy the client secret and give it to the integration.

The integration gets a token with the client-credentials grant, asking for the scopes it needs, and calls the API with it:

```sh
TOKEN=$(curl -s https://keycloak.example.com/realms/elysion/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=wiki-sync -d client_secret="$SECRET" \
  -d scope='boards:read' | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" https://elysion.example.com/public/v1/me
# {"id":"…","name":"wiki-sync","kind":"integration","tokenId":null,"scopes":["boards:read"]}
```

- On its first call Elysion makes a user for the integration: no email, the client id as its name. It shows as **Integration** in the
  people search of the Share dialog and in Administration, **Users** ("Integrations").
- It has the **access of a member**: it sees only the boards and rooms it was added to, with the role it was given there. Add it like a
  person: Share, search for its name.
- Its token is accepted on `/public/v1` only; the browser's API refuses it (`403`).
- To stop it, deactivate it in Administration, **Users** (its next call is refused), or disable the client in Keycloak.

The development realm (`infra/keycloak`) has an example: the client `elysion-integration-example` with the secret
`elysion-integration-example-dev-secret` and the five scopes as optional scopes. It is for development only: the production realm
(`realm-elysion.production.json`, built by `scripts/build-realm.mjs`) leaves out every client whose id ends in `-example`, so create your own client there.

```sh
curl -s http://localhost:8081/realms/elysion/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=elysion-integration-example \
  -d client_secret=elysion-integration-example-dev-secret -d scope='boards:read'
```
