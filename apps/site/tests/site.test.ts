import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPOSITORY, repoUrl, rewriteLink } from '../.vitepress/repo-links.mts';
import { adrItems, adrTitle, titleOf } from '../.vitepress/sidebar.mts';

/** A small repository: docs/ with a page and an excluded folder, an app with a file, a folder of infra. */
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'elysion-site-'));
  const docs = join(root, 'docs');
  for (const folder of ['docs/adr', 'docs/specs', 'docs/brand', 'apps/bff', 'infra/helm']) {
    mkdirSync(join(root, folder), { recursive: true });
  }
  writeFileSync(join(docs, 'self-hosting.md'), '# Self-hosting\n');
  writeFileSync(join(docs, 'specs/bff.md'), '# BFF\n');
  writeFileSync(join(docs, 'brand/README.md'), '# Brand\n');
  writeFileSync(join(root, 'README.md'), '# Elysion\n');
  writeFileSync(join(root, 'apps/bff/AGENTS.md'), '# BFF agents\n');
  return { root, docs };
}

describe('rewriteLink', () => {
  const { root, docs } = repository();
  const onSite = (path: string) => !path.startsWith(join(docs, 'brand'));
  const from = join(docs, 'specs/bff.md');
  const rewrite = (href: string) => rewriteLink(href, from, root, docs, onSite);

  it('leaves a link to another document of the site alone', () => {
    expect(rewrite('../self-hosting.md')).toBe('../self-hosting.md');
    expect(rewrite('../self-hosting.md#images')).toBe('../self-hosting.md#images');
    expect(rewrite('./bff.md')).toBe('./bff.md');
  });

  it('leaves addresses, anchors and absolute paths alone', () => {
    for (const href of [
      'https://example.com/x',
      'mailto:a@b.c',
      '#section',
      '/self-hosting',
      'http://localhost:4200',
    ]) {
      expect(rewrite(href)).toBe(href);
    }
  });

  it('sends a link to a file of the repository outside docs to GitHub, with its anchor', () => {
    expect(rewrite('../../README.md#what-is-missing')).toBe(
      `${REPOSITORY}/blob/main/README.md#what-is-missing`,
    );
    expect(rewrite('../../apps/bff/AGENTS.md')).toBe(`${REPOSITORY}/blob/main/apps/bff/AGENTS.md`);
  });

  it('sends a link to a folder to its tree', () => {
    expect(rewrite('../../infra/helm')).toBe(`${REPOSITORY}/tree/main/infra/helm`);
  });

  it('sends a link to a document the site leaves out to GitHub', () => {
    expect(rewrite('../brand/README.md')).toBe(`${REPOSITORY}/blob/main/docs/brand/README.md`);
  });

  it('leaves a link to something that does not exist, for the dead link check to report', () => {
    expect(rewrite('../../nowhere/missing.md')).toBe('../../nowhere/missing.md');
    expect(rewrite('./missing.md')).toBe('./missing.md');
  });
});

describe('repoUrl', () => {
  it('points at a file or a folder on the main branch', () => {
    expect(repoUrl('a/b.md', false)).toBe(`${REPOSITORY}/blob/main/a/b.md`);
    expect(repoUrl('a', true, '#x')).toBe(`${REPOSITORY}/tree/main/a#x`);
  });
});

describe('the sidebar', () => {
  it('takes the title of a document from its first heading', () => {
    expect(titleOf('text\n# The title\n## Not this', 'file.md')).toBe('The title');
    expect(titleOf('no heading', 'file.md')).toBe('file.md');
  });

  it('shortens the title of an ADR', () => {
    expect(adrTitle('ADR 0019: How boards are grouped')).toBe('0019 How boards are grouped');
    expect(adrTitle('Something else')).toBe('Something else');
  });

  it('lists every ADR of the repository in number order', () => {
    const items = adrItems(resolve(import.meta.dirname, '../../../docs'));

    expect(items.length).toBeGreaterThanOrEqual(21);
    expect(items[0]?.link).toBe('/adr/0001-gateway-and-bff');
    expect(items.map((item) => item.link)).toEqual([...items.map((item) => item.link)].sort());
    expect(items.at(-1)?.link).toMatch(/^\/adr\/\d{4}-/);
  });
});
