import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { REPOSITORY, repoLinks } from './repo-links.mts';
import { SPECS, adrItems } from './sidebar.mts';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// VitePress brings its own Vue; the documents are outside this package, so Vite is told where to find it.
const vitepressRequire = createRequire(require.resolve('vitepress/package.json'));
const repoRoot = resolve(here, '../../..');
const docsRoot = resolve(repoRoot, 'docs');

// The documents of docs/ that the site does not contain; a link to one of them goes to GitHub.
const EXCLUDED = ['brand'];
const isOnSite = (absolutePath: string) =>
  !EXCLUDED.some(
    (folder) =>
      absolutePath === resolve(docsRoot, folder) ||
      absolutePath.startsWith(resolve(docsRoot, folder) + '/'),
  ) && existsSync(absolutePath);

// On GitHub Pages the site is at https://<owner>.github.io/<repository>/, so every address needs that prefix.
const base = process.env['SITE_BASE'] ?? '/';

export default defineConfig({
  title: 'Elysion',
  description: 'An open-source collaborative whiteboard you can self-host.',
  lang: 'en',
  base,
  // docs/ is the only source: nothing is copied.
  srcDir: '../../docs',
  srcExclude: EXCLUDED.map((folder) => `${folder}/**`),
  cleanUrls: true,
  lastUpdated: false,
  // Dead links fail the build, so a broken link in any pull request is found by CI. Only the addresses of a local run are exempt.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}icon.svg` }]],
  // The documents are in docs/, outside this package, so Vite cannot find Vue from them: point it at the one of VitePress.
  vite: {
    // The icon (copied here by scripts/prepare.mjs); VitePress would look in docs/public.
    publicDir: resolve(here, '../public'),
    resolve: {
      alias: [
        {
          find: /^vue\/server-renderer$/,
          replacement: vitepressRequire.resolve('vue/server-renderer'),
        },
        { find: /^vue$/, replacement: vitepressRequire.resolve('vue') },
      ],
    },
  },
  markdown: {
    config: (md) => {
      md.use(repoLinks(repoRoot, docsRoot, isOnSite));
    },
  },
  themeConfig: {
    logo: '/icon.svg',
    nav: [
      { text: 'User guide', link: '/user-guide' },
      { text: 'Self-hosting', link: '/self-hosting' },
      { text: 'Specifications', link: '/specs/frontend' },
      { text: 'Decisions', link: '/adr/0001-gateway-and-bff' },
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'Releases', link: `${REPOSITORY}/releases` },
    ],
    sidebar: [
      {
        text: 'Elysion',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'User guide', link: '/user-guide' },
          { text: 'Self-hosting', link: '/self-hosting' },
          { text: 'Roadmap', link: '/roadmap' },
        ],
      },
      { text: 'Specifications', items: [...SPECS] },
      { text: 'Decisions (ADRs)', collapsed: true, items: adrItems(docsRoot) },
    ],
    socialLinks: [{ icon: 'github', link: REPOSITORY }],
    search: { provider: 'local' },
    editLink: { pattern: `${REPOSITORY}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    outline: [2, 3],
    footer: { message: 'A pre-release. Released under the MIT license.' },
  },
});
