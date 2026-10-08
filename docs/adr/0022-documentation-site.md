# ADR 0022: The documentation site: VitePress on GitHub Pages, with `docs/` as the only source

- Status: Accepted
- Date: 2026-10-07
- Builds on: [ADR 0021](0021-versioning-and-releases.md), the documentation site of [ariadne](https://github.com/GravionLabs/ariadne)

## Context

Elysion's documentation is Markdown in `docs/` (specs, ADRs, the roadmap, the self-hosting page), written to be read on GitHub. Somebody
who only wants to know what Elysion is, or how to run it, should not need a clone. A second copy of the text would drift, so the
Markdown in the repository has to stay the single source. A live demo of the application cannot be a static site (it needs the services),
so the site is documentation only; the demo is `pnpm demo`.

## Decision

1. **VitePress in `apps/site`** (`@elysion/site`, private, a pnpm workspace project), whose `srcDir` is `../../docs`: nothing is copied. The site contains
   `docs/index.md` (the landing page), `self-hosting.md`, `roadmap.md`, the specs and the ADRs; `docs/brand` is left out (`srcExclude`).
2. **The sidebar is read from the folders:** the specs in a fixed order (`sidebar.mts`), the ADRs by their number and their first heading, so a new ADR needs no change to the site.
3. **Links to files the site does not contain** (the README, an app's `AGENTS.md`, `infra/`, a document the site leaves out) are rewritten to
   `https://github.com/GravionLabs/elysion/blob/main/<path>` (`tree/main` for a folder) by a small markdown-it plugin (`repo-links.mts`, with tests). The Markdown is
   unchanged, so the same links work on GitHub and on the site. A link to something that does not exist is left alone, and VitePress's **dead link check
   fails the build**. `pnpm build` at the root builds the site (a few seconds), so CI catches a broken link in any pull request.
4. **Documents are plain Markdown for both readers:** a word in angle brackets outside code (`<name>`) is a tag to the site's Vue compiler (and to GitHub), so write it in code or as `&lt;name&gt;`.
5. **The icon** has one source, `apps/frontend/public/icon.svg`, copied to `apps/site/public` (git-ignored) before every build.
6. **Published on GitHub Pages** at `https://gravionlabs.github.io/elysion/` by `.github/workflows/pages.yml`: pull requests that touch the site or `docs/` build it; only `main` deploys, and only while
   the repository variable `DEPLOY_PAGES` is `true`, with Pages set to the source "GitHub Actions" (settings that belong to the repository's owner).

## Consequences

- The site is not live until the owner sets `DEPLOY_PAGES` to `true` and the Pages source to "GitHub Actions" in the repository settings.
- Search is the local one of VitePress (no external service); the site has no analytics.
- `vitepress` and its dependencies are new to the lockfile; VitePress brings its own Vue, which the config points Vite to because the documents are outside the package.
