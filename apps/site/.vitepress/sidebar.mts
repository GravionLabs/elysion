import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SidebarItem {
  text: string;
  link: string;
}

/** The title of a document: its first `# ` heading, else its file name. */
export function titleOf(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : fallback;
}

/** A short title for an ADR: "ADR 0019: How boards are grouped" becomes "0019 How boards are grouped". */
export function adrTitle(title: string): string {
  return title.replace(/^ADR\s+(\d+):\s*/i, '$1 ');
}

/** The ADRs of `docs/adr`, in number order. */
export function adrItems(docsDir: string): SidebarItem[] {
  const folder = join(docsDir, 'adr');
  return readdirSync(folder)
    .filter((file) => /^\d{4}-.+\.md$/.test(file))
    .sort()
    .map((file) => ({
      text: adrTitle(titleOf(readFileSync(join(folder, file), 'utf8'), file)),
      link: `/adr/${file.replace(/\.md$/, '')}`,
    }));
}

/** The specs, in the order they are best read. */
export const SPECS: readonly SidebarItem[] = [
  { text: 'Frontend and canvas', link: '/specs/frontend' },
  { text: 'BFF', link: '/specs/bff' },
  { text: 'Business backend', link: '/specs/business-backend' },
  { text: 'Realtime', link: '/specs/realtime' },
  { text: 'Gateway', link: '/specs/gateway' },
  { text: 'Identity', link: '/specs/identity' },
];
