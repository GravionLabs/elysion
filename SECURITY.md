# Security policy

## Reporting a vulnerability

Please do not open a public issue, a pull request or a discussion for a security problem. Use GitHub's private vulnerability reporting for the
repository `GravionLabs/elysion`: **Security → Report a vulnerability**, or <https://github.com/GravionLabs/elysion/security/advisories/new>.
Only the maintainers see the report until a fix is released.

Please include:

- what you found and what an attacker gains (read or change a board, act as another person, take a service down, ...);
- the steps to reproduce it: the requests, the commands or a short script, and the account roles involved;
- the version you tried (a release tag or a commit) and how you ran it (the Docker Compose demo, the Helm chart, a development setup);
- whether it is already public, and whether you intend to publish it (and when).

What to expect: Elysion is a young project maintained by a small team. We aim to acknowledge a report within a week, to tell you whether we
consider it a vulnerability and how severe, and to keep you informed until it is fixed. A fix is released as a new version from `main`, and the
advisory credits you if you wish. Please give us a reasonable time to fix a problem before you disclose it; we will not take legal action against
good-faith research that stays within the limits below.

Please do not test against a deployment you do not own, do not read or change other people's data, and do not run denial-of-service tests against anything
but your own instance.

## Supported versions

Elysion is in pre-release (`0.1.0-beta.N`). Only the latest release on `main` gets fixes.

## What the demo is, and is not

The Docker Compose stack is a **demo and development setup**, not a production one: Keycloak runs in dev mode with a realm that has
the users `dev`, `dev1`, `dev2` (the password is the username) and the admin `admin` / `admin`, TLS is off, and `WS_TOKEN_SECRET` and
`INTERNAL_API_SECRET` have development values. Do not expose it to a network you do not trust. [docs/self-hosting.md](docs/self-hosting.md)
lists what a real deployment has to change. Reports about these development defaults are not vulnerabilities.

## What we already know

[docs/security.md](docs/security.md) has the threat model, the result of the first security review and the list of known findings. Check it before
you report: a finding that is listed there is being tracked, and a report that adds to it (a worse impact, a way around the fix) is welcome.
