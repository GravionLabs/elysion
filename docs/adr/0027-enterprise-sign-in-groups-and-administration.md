# ADR 0027: How enterprise sign-in, group mapping and administration work

- Status: Proposed
- Date: 2026-10-09
- Issues: #638 (Feature #637, Epic #636); implemented in #639, #644, #647, #656 and the PBIs below them
- Builds on: [ADR 0014](0014-keycloak-identity-provider.md) (Keycloak, services only validate tokens), [ADR 0019](0019-grouping-boards.md) (a role is the highest of the sources), [ADR 0017](0017-internal-api-authentication.md)

## Context

A company that runs Elysion wants its people to sign in with the company's identity (Microsoft Entra ID is the first case), to find the
people in a "Share" dialog by name, to give a board to a department as a group, and to have somebody administer all of it. Today:

- Keycloak (realm `elysion`, ADR 0014) holds the users. The frontend logs in with the authorization code flow and PKCE; the BFF, the realtime
  service and the business backend validate Keycloak's access token against its JWKS, check `iss` and `aud` (`OIDC_ISSUER_URL`,
  `OIDC_AUDIENCE`) and never call Keycloak per request.
- The business backend creates a local `User` from the token on the first request and keeps its email and display name in step
  (`UserProvisioningService`: `sub`, `email`, `preferred_username`, `name`). Roles on a board come from `BoardMembership` rows and, since ADR 0019,
  from room memberships; the highest wins, and the realtime handshake only learns the answer (`membership/me`).
- There are no groups and no administrator. Anybody who has an account can only be found by the exact email.
- The Helm chart does not deploy Keycloak (ADR 0018): production has an external one or its own.

## Options

### Where Entra ID plugs in

**A. Identity brokering.** Entra ID is an OpenID Connect identity provider of the realm `elysion`. People click "Sign in with Microsoft" on
Keycloak's login page (or the shell goes there directly with `kc_idp_hint`, #644); Keycloak talks to Entra and issues **its own** token. The services
see what they see today.

**B. Direct.** The frontend and the services use Entra ID as the issuer. No Keycloak in production.

**C. Both, A first.** Same as A now, B possible later.

| Criterion                                        | A: brokering                                                                                                               | B: direct                                                                                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What changes in the three services               | Nothing in the token validation. New claims (`groups`, the admin role) are read by the business backend only.              | Issuer, audience and the claim names become configuration; Entra's tokens differ (v1 or v2 issuer, `aud` is an app id or `api://...`, `email` is often absent, `sub` is per application, `roles`/`groups` shapes). |
| One place for clients and roles                  | The realm: clients, roles, mappers, session lengths, one admin console.                                                    | Entra's app registrations and the services' configuration; Elysion's own roles (`elysion-admin`) are Entra app roles.                                                                                              |
| Development without a tenant                     | A second realm plays Entra (below). The same Keycloak, nothing to download.                                                | A mock OIDC server in every dev stack and in CI, and it has to speak Entra's token shapes to be worth anything.                                                                                                    |
| Browser tests                                    | Two users sign in through the brokered path against the stub realm.                                                        | The same, against the mock.                                                                                                                                                                                        |
| Helm chart                                       | Unchanged: it takes an issuer URL; that is the realm's.                                                                    | Unchanged too, and simpler: no Keycloak at all.                                                                                                                                                                    |
| Logout                                           | Keycloak ends its session; Entra's single sign-on session stays (a second click on "Sign in with Microsoft" does not ask). | `end_session_endpoint` of Entra.                                                                                                                                                                                   |
| A second provider (Google Workspace, Okta, SAML) | Another identity provider in the realm: no code, a realm file and mappers.                                                 | Multi-issuer validation in every service, per-provider claim mapping, per-provider logout: code in three services.                                                                                                 |
| Cost of A                                        | One more hop at login, and **claims come from Keycloak's last login at Entra, not from every request** (see "Lifecycle").  | Claims come from Entra; its token size and the 200-group overage apply to the access token itself.                                                                                                                 |

**Recommendation: A**, with the configuration kept generic so that B stays possible: the claim that carries groups, the claim that carries roles
and the administrator role are settings, not constants (`OIDC_GROUPS_CLAIM` = `groups`, `OIDC_ROLES_CLAIM` = `realm_access.roles`,
`OIDC_ADMIN_ROLE` = `elysion-admin`), and nothing in a service says "Keycloak" except the default of those three. C is A plus a sentence; it is
not a separate decision.

### How Entra groups reach Elysion

**1. From the token.** The app registration in Entra emits the groups into the `groups` claim (Token configuration, "Add groups claim"); the claim
holds **object ids** (GUIDs), not names. A Keycloak identity provider mapper copies them onto the Keycloak user, and a protocol mapper emits them
as the multi-valued claim `groups` of the access token. The business backend keeps the person's group memberships in step with it on every
request, as it already does with the email.

**2. From the directory.** Elysion reads the members of linked groups from Microsoft Graph (`Group.Read.All`, an application permission with
admin consent), so a group is complete before its people have ever signed in, and a person who left is found without waiting for a login.

**3. Both, 1 first.**

| Criterion                        | 1: token                                                                                                                                                                                                        | 2: Graph                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| What it needs from the tenant    | A "groups" claim in the app registration. "Groups assigned to the application" keeps it below the overage limit (assigning groups to an application needs the tenant licence for it, to be checked per tenant). | An application permission with **admin consent** and a secret or certificate held by Elysion. |
| Who is in a group before sign-in | Nobody: a person appears when they sign in (that is enough to share a board with a group; Share lists the group, not its people).                                                                               | Everybody; the user directory in "Share" can offer people who never came.                     |
| Overage                          | Entra omits the claim above **200 groups per token** and sends a pointer to Graph instead (`_claim_names`); Keycloak cannot follow it. Mitigation: restrict the claim to groups assigned to the application.    | No such limit.                                                                                |
| Names                            | **Not in the token** (object ids only). A group's name is given in Elysion when it is linked.                                                                                                                   | The name is there.                                                                            |
| Secret held by Elysion           | None.                                                                                                                                                                                                           | A tenant-wide read permission is a serious secret.                                            |
| Code                             | A claim reader and a sync in the business backend (#647).                                                                                                                                                       | A Graph client, paging, throttling, a schedule, the permission set (#667).                    |

**Recommendation: 1 now, 2 later and only if somebody needs it** (#667, `needs-refinement`). Everything below is built so that 2 adds a source of
members and changes nothing else.

**The shape:** the claim `groups` is an array of strings (Entra's object ids; a Keycloak group path or any other id from another provider works
the same). A **group** in Elysion has a **source**: `local` (made in Elysion, members added by hand) or `linked` (owned by the provider:
`(provider alias, external id)` is unique, members come **only** from the claims and cannot be edited in Elysion). The two coexist; a board or a
room can be shared with either, and the effective role is the highest of the sources (board, room, group), as in ADR 0019. An administrator links a
group by entering the external id (copied from the Entra portal) and a name; Elysion does not list every group id it ever saw, which would store the
directory structure of a company for no reason. Graph (#667) would add "search by name".

**On every request** the backend compares the claim with the person's linked memberships and writes only the difference; the comparison is cached per
user by a hash of the sorted claim for the lifetime of the token, so an ordinary request does not touch the database for it.

### The administrator

A **realm role `elysion-admin`**, in `realm_access.roles` of the access token. It is given in Keycloak by hand, or by an identity provider mapper
("Claim to Role") from one **configured Entra group** (`ENTRA_ADMIN_GROUP_ID`), so the company decides who is an administrator in the place where it
already decides everything else. The business backend reads it as one policy (`AdminOnly`).

**An administrator may:** list and search all users; make, link, rename and delete groups and change local groups' members; list all rooms and
boards **by metadata** (name, owner, member counts, size, last change); delete a room or a board; hand a board or room over to somebody else when its
owner has left (#668); see the audit log (#669).

**An administrator may not** get a role on a board or a room by being one. They cannot open a board, read its content, or appear in its member list.
Handing a board over is an explicit action that gives the **new owner** a role and is logged; the administrator themselves still have none. The
content of a board stays with its members.

### The development stand-in

A **second realm `entra-stub`** in the same Keycloak (`infra/keycloak/realm-entra-stub.json`) with a confidential client for the `elysion` realm's
identity provider, three users and two groups whose **names are GUIDs**, to look like object ids, emitted as the claim `groups`. The identity provider
`entra` of the realm `elysion` points at it by default (`ENTRA_*` placeholders in the realm file, #639, point it at a real tenant), so
`pnpm dev:infra` and the browser tests exercise the whole brokered login, the group sync and the admin role with no network and no tenant.

Why a second realm and not a mock OIDC container: one image fewer in every compose project and in CI, the same import mechanism as the main realm, and
real protocol behaviour (PKCE, JWKS rotation, a real token endpoint) instead of a hand-written fake.

What it cannot test: **Entra's own claim shapes** (`_claim_names` and the overage pointer, `tid`, `oid`, `upn`, the missing `email`, the v1 and v2
issuers), and Entra's consent screens and conditional access. Those are checked by hand once against a real tenant, and the mapper that reads the
claims is kept small and unit-tested on recorded token payloads.

Two details for #639, so that nobody discovers them there: the browser has to reach the stub's authorization endpoint at `http://localhost:8081`
while Keycloak itself reaches its token and JWKS endpoints at `http://keycloak:8080`, so the identity provider is configured with explicit endpoint
URLs and not with the discovery document; and the user attribute that holds the groups has to be synchronized on **every** login (sync mode
`FORCE`), not only on the first.

### Lifecycle: leaving a group, being disabled

With option 1 and brokering the facts are these, and they are less comfortable than "gone with the next token":

- **Keycloak does not ask Entra again when it refreshes a token.** A person's groups are as of their **last brokered login**. A person removed from an
  Entra group is removed from the Elysion group at their **next sign-in through Entra**, which Keycloak's SSO session length decides: the realm's
  `ssoSessionMaxLifespan` (10 hours by default) is the longest a removed person keeps what the group gave them. The proposal is to set it to **8 hours**
  for the enterprise realm and to document the number.
- **A person disabled or deleted in Entra** cannot sign in again, but the Keycloak user remains (a shadow of the Entra account) and its session lives
  until the same limit. Entra's own conditional access and sign-in policies are not re-evaluated in between.
- **Elysion's own "deactivated" state** (#666/#668) is **not needed for the first version**: the maximum window above is the same for "left the group"
  and "was disabled", and shortening it is a setting. It becomes necessary when a company wants a person cut off **now** (an administrator action that
  also revokes the Keycloak sessions through its admin API) or wants the directory to decide (Graph, #667). Both are in #666, already `needs-refinement`.
- **Data of a person who left** stays where it is: their boards, their name on elements. Ownership is handed over by an administrator (#668).

## Decision (proposed)

1. **Option A (brokering), configuration kept generic** (`OIDC_GROUPS_CLAIM`, `OIDC_ROLES_CLAIM`, `OIDC_ADMIN_ROLE`); services unchanged except the
   business backend reading two claims.
2. **Groups from the token (1)**, as the claim `groups` (an array of strings), local and linked groups side by side, linked groups identified by
   `(provider alias, external id)` and entered by an administrator with a name; Graph (2) stays in #667.
3. **The administrator is the realm role `elysion-admin`**, optionally mapped from one configured Entra group; it never gives a role on a board or a
   room.
4. **The development stand-in is a second realm `entra-stub`**, and `pnpm dev:infra` brokers through it by default.
5. **Lifecycle:** the window between a change in Entra and its effect is the realm's SSO session maximum, set to 8 hours and documented; no
   "deactivated" state in the first version.
6. **Configuration names** (also in `docs/specs/identity.md`): business backend `OIDC_GROUPS_CLAIM`, `OIDC_ROLES_CLAIM`, `OIDC_ADMIN_ROLE`; realm
   import and compose `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_ADMIN_GROUP_ID` (the secret is a Kubernetes or compose secret,
   never a committed value).

## Rejected options

- **B (direct):** every service would learn Entra's token shapes, and each further provider would multiply that. It also removes the realm as the
  one place for roles and session lengths. It stays possible through the generic settings.
- **Graph first (2):** a tenant-wide read permission and a secret to hold, for a convenience (people before they sign in) that nobody has asked for yet.
- **A mock OIDC container for development:** one more image, a different import mechanism, and a fake instead of a protocol.
- **Giving administrators board access:** the content of a board is what a company's people trust Elysion with; an administrator who can read it by
  default makes every board a compliance question.
- **Storing every group id seen in a token:** it keeps the shape of a company's directory for a feature that does not need it.

## Consequences

- #639 (the identity provider and `entra-stub`), #644 (the shell's `kc_idp_hint`), #647 (the group model and the claim sync), #656 (the admin role and
  endpoints) and the PBIs under them can be refined against this ADR; they are blocked until it is accepted.
- Access tokens grow with the number of groups: 200 object ids are about 8 KB. Traefik's, nginx's, Kestrel's and Node's default header limits are
  larger, but a deployment with a very large claim should check them; "groups assigned to the application" is the recommended setting in Entra for
  this reason too. The WS token does not carry groups: the backend's `membership/me` still answers the one role the realtime service needs.
- The realm file gets the identity provider, its mappers and a role, and the Helm chart needs nothing (it only knows the issuer).
- `docs/specs/identity.md` gets "Enterprise sign-in" with this ADR's names and the lifecycle facts above, including that they are claims as of the last
  login.

## Open questions for the owner

- Is 8 hours of SSO session the right window for the first customers, or does somebody need "now" (an admin button that revokes sessions) from the start?
- Should an administrator be able to **delete a board** without being a member? The proposal says yes (a company must be able to remove content), with
  an audit entry; the other reading is "only hand it over".

## Decision

_Proposed. To be accepted by the product owner, who then removes `needs-decision` from #638._
