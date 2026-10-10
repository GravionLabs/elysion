# ADR 0021: Versioning and releases: GitVersion, GHCR images, a pre-release first

- Status: Accepted
- Date: 2026-10-07
- Builds on: [ADR 0018](0018-kubernetes-packaging.md), the release setup of [ariadne](https://github.com/GravionLabs/ariadne) and `GravionLabs/ci`

## Context

Elysion has no version (`0.0.0` in every `package.json`), no tag, no release and no published image: to run it somebody has to
build four images from a checkout. The owner wants a first **pre-release** whose version comes from the git history with
**GitVersion**, in the way ariadne does it (images on GHCR, a GitHub release, release notes from the Conventional Commits, a
documentation site on GitHub Pages).

ariadne uses the shared `GravionLabs/ci` repository: the action `versioning/determine-version` (GitVersion), the reusable workflow
`docker-package.yml` (one image, one release) and the action `versioning/gh-release` (tag, release, git-cliff notes). Elysion has **four**
images, and the reusable workflow makes one release per call, so it does not fit as it is. It also gives every build on `main` the tags
`latest`, `<major>` and `<major>.<minor>.<patch>`, which would put a pre-release on `latest`.

## Decision

1. **GitVersion computes the version** from the history (`GitVersion.yml`, `ContinuousDelivery`, `next-version: 0.1.0`). On `main` it has the
   label `beta`, so the version is `0.1.0-beta.<commits since the last tag>` (`0.1.0-beta.126` for the first release). `+semver: minor` or
   `+semver: major` in a commit message bumps that part. A stable release is a change to `GitVersion.yml`: delete the `label` line and set
   `next-version` to `1.0.0`; from then on a merge to `main` is `1.0.0`, `1.0.1`, and so on.
2. **Every merge to `main` that passes the checks is a release** (`release` in `ci.yml`, after `verify`, `dotnet-coverage` and `e2e`): the
   workflow works out the version once, builds and pushes the four images in parallel (a matrix), and then creates the tag and the
   GitHub release once with `versioning/gh-release` (git-cliff notes from `cliff.toml`, marked as a **pre-release** by the version's label).
   Pushes to `main` are not cancelled by a newer push, so a release always runs to its end.
3. **The images** are `ghcr.io/gravionlabs/elysion-{frontend,bff,realtime,business-backend}`, for `linux/amd64` and `linux/arm64`. A pre-release is tagged
   `<version>`, `<version>-<commit>` and the moving tag `next`; only a stable release gets `latest`, `<major>` and `<major>.<minor>`.
   This logic is in the workflow and not in the shared reusable workflow, whose tags are not right for a pre-release.
4. **Release notes** come from the Conventional Commits of the squash-merged pull requests (the squash body's `* type: message` lines are read as
   commits of their own). `chore`, `ci`, `style`, `test` and `build` are left out. The notes of a release are what came after the last tag of any
   kind, pre-releases included. Pull request titles are therefore Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`).
5. **A pull request that touches the images or the demo** (`container.yml`) builds the four images and starts the stack, and
   `scripts/demo-smoke.sh` checks that it works: the app is served, `dev`, `dev1` and `dev2` log in, the API answers, a board is made and a
   realtime token issued. The images are not pushed from a pull request.
6. **Self-hosting** is described in [docs/self-hosting.md](../self-hosting.md): `docker-compose.yml` runs the published images (`ELYSION_VERSION`; [ADR 0023](0023-own-valkey-one-compose-file.md)), and the page lists what a real deployment needs. The demo is not a production setup.

## Consequences

- The first merge to `main` after this change creates `v0.1.0-beta.N`, N being the number of commits on `main`, and the first release notes
  list the whole history. After that N counts up from the last tag.
- The shared actions are pinned to a commit of `GravionLabs/ci` (the one ariadne uses). The repository must be allowed to use them, which depends on
  the `ci` repository's Actions access settings; the first run shows it. The workflow also needs `packages: write` for GHCR, and the
  published packages are private until their visibility is set to public (package settings on GitHub).
- Building `linux/arm64` under QEMU makes the release slower (the .NET image most of all); the build cache (`type=gha`, one scope per image) keeps repeat builds short.
- The images run as a non-root user (nginx-unprivileged 101, `node` 1000, `app` 1654) since #691; the chart adds a read-only root file system and drops all capabilities.
- The Helm chart's default image names are not the GHCR ones yet; the self-hosting page says how to set them.
- The version is not shown in the application yet; the images carry it as OCI labels (`org.opencontainers.image.version`).
- The documentation site on GitHub Pages is [ADR 0022](0022-documentation-site.md).
