# Self-hosting Elysion

Elysion is a **pre-release**. It runs end to end and the images are published, but the stack in this repository is a
demo and a development setup, not a production one. This page says how to run the published images and what has to change
before anything real depends on them.

## The images

Every merge to `main` that passes the checks publishes four images to GHCR and creates a GitHub release
([ADR 0021](adr/0021-versioning-and-releases.md)):

| Image                                          | What it is                                       |
| ---------------------------------------------- | ------------------------------------------------ |
| `ghcr.io/gravionlabs/elysion-frontend`         | the Angular app with the canvas, served by nginx |
| `ghcr.io/gravionlabs/elysion-bff`              | the NestJS backend-for-frontend (`/api`)         |
| `ghcr.io/gravionlabs/elysion-realtime`         | the NestJS WebSocket service (`/yjs`)            |
| `ghcr.io/gravionlabs/elysion-business-backend` | the .NET 10 API: boards, rooms, templates, roles |

They are built for `linux/amd64` and `linux/arm64`. While the version has a pre-release label (`0.1.0-beta.126`) the tags are the
version, the version with the commit (`0.1.0-beta.126-abc1234`) and the moving tag **`next`**, the newest pre-release; there is no
`latest` until there is a stable release, which also gets `1` and `1.0`. The releases and their notes are on the
[releases page](https://github.com/GravionLabs/elysion/releases).

## Run the demo from the published images

You need Docker with Compose and this repository (the stack mounts the Traefik configuration and the Keycloak realm from it).

```sh
git clone https://github.com/GravionLabs/elysion.git && cd elysion
ELYSION_VERSION=next docker compose up -d --pull always
bash scripts/demo-smoke.sh        # optional: checks that it works end to end
```

Then open <http://localhost> and log in as `dev`, `dev1` or `dev2` (the password is the username). Use a version instead of `next`
to pin one (`ELYSION_VERSION=0.1.0-beta.126`). Settings (`ELYSION_VERSION`, ports) can also go into a `.env` (copy `.env.example`). `pnpm demo` builds the images from the checkout instead.
`docker compose down` stops it, and `down -v` also forgets the data.

The stack is Traefik (port 80), the four images, Postgres, Valkey (its own, for the realtime service) and Keycloak (port 8081,
admin console `admin` / `admin`). The business backend applies its database migrations when it starts.

## What a real deployment needs

The demo is wired to `localhost` and uses development values. Before it faces anybody else:

- **A host name and TLS.** The identity provider's address is part of every token: `OIDC_ISSUER_URL` (the address the browser uses) is
  `http://localhost:8081/realms/elysion` in the demo, in the frontend, the business backend and the BFF. Put TLS in front (Traefik or your
  ingress), and set the issuer, the redirect URIs and the web origins of the realm's clients to your host name.
- **A production Keycloak:** not `start-dev` with an imported demo realm. Create your own realm, clients and users, a strong admin
  password, and a database of its own ([ADR 0014](adr/0014-keycloak-identity-provider.md)).
- **Your own secrets.** `WS_TOKEN_SECRET` (BFF and realtime, [identity](specs/identity.md)) and `INTERNAL_API_SECRET` (realtime and business backend, [ADR 0017](adr/0017-internal-api-authentication.md))
  have development values in the compose file: set long random ones, the same in the services that share them.
- **Postgres with backups** (the demo's volume is a convenience), and Valkey if you run more than one realtime instance.
- **Keycloak and the network:** the compose file publishes Keycloak (with its development admin password) on the loopback only (`KEYCLOAK_BIND`); in a real deployment it sits behind your TLS proxy and has no development admin at all.
- **A Content-Security-Policy.** The frontend image sends `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options`, but no CSP yet; set one at your proxy once you know the identity provider's origin.
- **CORS and the rate limit:** `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_AVERAGE` and `RATE_LIMIT_BURST` ([gateway](specs/gateway.md)).

The Helm chart ([ADR 0018](adr/0018-kubernetes-packaging.md), `infra/helm/elysion`) is the way to run it on Kubernetes; its default image
names are still the local ones (`elysion/frontend`, ...), so set `images.<service>.repository` and `tag` to the GHCR images above. It has
been run on a local kind cluster only.

## Known limits of this pre-release

See [What is missing](../README.md#what-is-missing) and the [roadmap](roadmap.md): no production configuration yet, no security review
yet, no browser end-to-end tests, and votes that are not secret from the server.
