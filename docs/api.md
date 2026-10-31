# The public API

Elysion has a versioned API for scripts and integrations at `/public/v1` ([ADR 0033](adr/0033-public-api-tokens-and-webhooks.md)). It is
not the API the browser uses (`/api`): it has its own route at the edge, without CORS, with a rate limit per token (600 requests a minute,
a burst of 60) and a body limit of 1 MiB. This page says how a caller authenticates. The routes for boards, rooms, members, versions and
elements, and their OpenAPI document, come with #852; until then the API has one route, `GET /public/v1/me`.

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
| `webhooks:write`  | Registering webhooks                             |

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
`elysion-integration-example-dev-secret` and the five scopes as optional scopes.

```sh
curl -s http://localhost:8081/realms/elysion/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=elysion-integration-example \
  -d client_secret=elysion-integration-example-dev-secret -d scope='boards:read'
```
