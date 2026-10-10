import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The German file has a translation for every message of the source file (#738). `ng build --configuration
 * production` fails on a missing translation as well (`i18nMissingTranslation: error`); this fails earlier, in
 * `pnpm test`, and names the ids. After a change to a text run `pnpm --filter @elysion/frontend i18n:extract`
 * and add the German text to `messages.de.xlf`.
 */
const dir = join(process.cwd(), 'src', 'locale');

function units(file: string): Map<string, { source: string; target: string | null }> {
  const xml = readFileSync(join(dir, file), 'utf8');
  const result = new Map<string, { source: string; target: string | null }>();
  for (const match of xml.matchAll(/<unit id="([^"]+)"[\s\S]*?<\/unit>/g)) {
    const source = /<source>([\s\S]*?)<\/source>/.exec(match[0]);
    const target = /<target>([\s\S]*?)<\/target>/.exec(match[0]);
    result.set(match[1], { source: source?.[1] ?? '', target: target?.[1] ?? null });
  }
  return result;
}

describe('locale files', () => {
  const english = units('messages.xlf');
  const german = units('messages.de.xlf');

  it('extracts messages', () => {
    expect(english.size).toBeGreaterThan(0);
  });

  it('has a German translation for every message', () => {
    const missing = [...english.keys()].filter((id) => !german.get(id)?.target?.trim());
    expect(missing).toEqual([]);
  });

  it('has no German translation for a message that is gone', () => {
    const stale = [...german.keys()].filter((id) => !english.has(id));
    expect(stale).toEqual([]);
  });

  it('keeps the placeholders of the English text', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/<(?:ph|pc|sc|ec)\b[^>]*?(?:id|equiv|dataRef)="([^"]+)"/g)]
        .map((m) => m[1])
        .sort();
    const broken = [...english.entries()]
      .filter(([id, { source }]) => {
        const target = german.get(id)?.target;
        return target != null && placeholders(source).join() !== placeholders(target).join();
      })
      .map(([id]) => id);
    expect(broken).toEqual([]);
  });
});
