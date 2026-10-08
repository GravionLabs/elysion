# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on <https://github.com/GravionLabs/elysion/security/advisories/new>. Say what you found, how to reproduce it and
which version (a release tag or commit) you tried. You will get an answer as soon as someone has read it; Elysion is a young project
maintained by a small team, so please allow some days.

## Supported versions

Elysion is in pre-release (`0.1.0-beta.N`). Only the latest release on `main` gets fixes.

## What the demo is, and is not

The Docker Compose stack is a **demo and development setup**, not a production one: Keycloak runs in dev mode with a realm that has
the users `dev`, `dev1`, `dev2` (the password is the username) and the admin `admin` / `admin`, TLS is off, and `WS_TOKEN_SECRET` and
`INTERNAL_API_SECRET` have development values. Do not expose it to a network you do not trust. [docs/self-hosting.md](docs/self-hosting.md)
lists what a real deployment has to change. Reports about these development defaults are not vulnerabilities.
