/** A version of the board as the host's API returns it (ADR 0032, #846). */
export interface SnapshotInfo {
  id: string;
  /** `Manual`: saved by a person; `Auto`: made by the server; `BeforeRestore`: made before a restore (#847). */
  kind: 'Manual' | 'Auto' | 'BeforeRestore';
  name: string | null;
  /** The display name of who saved it; `null` for an automatic one. */
  author: string | null;
  createdAt: string;
  /** Gzipped size. */
  sizeBytes: number;
  elementCount: number | null;
}

/**
 * How the canvas reaches the board's versions (the `snapshotApi` property of `<elysion-canvas>`): the BFF's routes under
 * `/api/boards/:id/snapshots`, set by the host. A rejection may carry the HTTP `status` of the refusal.
 */
export interface SnapshotApi {
  list(): Promise<SnapshotInfo[]>;
  create(name?: string): Promise<SnapshotInfo>;
  rename(id: string, name: string): Promise<SnapshotInfo>;
  remove(id: string): Promise<void>;
  /** The Yjs state of a version, for its preview picture. */
  document(id: string): Promise<Uint8Array>;
}

export const MAX_SNAPSHOT_NAME_LENGTH = 120;

export interface DayGroup<T> {
  /** The local calendar day, `YYYY-MM-DD`. */
  key: string;
  label: string;
  items: T[];
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The local calendar day of a moment, as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Versions grouped by the local day they were made, newest day first and newest first inside a day; `label` names a day
 * ("Today", "Yesterday" or the date).
 */
export function groupByDay(
  items: readonly SnapshotInfo[],
  now: Date,
  label: (day: 'today' | 'yesterday' | Date) => string,
): DayGroup<SnapshotInfo>[] {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const today = dayKey(now);
  const before = dayKey(yesterday);
  const sorted = [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const groups: DayGroup<SnapshotInfo>[] = [];
  for (const item of sorted) {
    const moment = new Date(item.createdAt);
    const key = dayKey(moment);
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = {
        key,
        label: label(key === today ? 'today' : key === before ? 'yesterday' : moment),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** "12 KB", "1.4 MB": the size of a stored version. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
