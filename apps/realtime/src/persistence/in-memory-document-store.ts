import { DocumentStore, type SaveResult, type StoredDocument } from './document-store.js';

/** Keeps documents in the process; for tests that do not need the business backend. */
export class InMemoryDocumentStore extends DocumentStore {
  readonly documents = new Map<string, { state: Uint8Array; version: number }>();

  async load(boardId: string): Promise<StoredDocument | null> {
    const stored = this.documents.get(boardId);
    return stored ? { state: stored.state, version: String(stored.version) } : null;
  }

  async save(boardId: string, state: Uint8Array, baseVersion: string | null): Promise<SaveResult> {
    const stored = this.documents.get(boardId);
    if ((stored?.version.toString() ?? null) !== baseVersion) {
      return stored
        ? { saved: false, current: { state: stored.state, version: String(stored.version) } }
        : { saved: false, current: { state: new Uint8Array(), version: '0' } };
    }
    const version = (stored?.version ?? 0) + 1;
    this.documents.set(boardId, { state: Uint8Array.from(state), version });
    return { saved: true, version: String(version) };
  }

  async delete(boardId: string): Promise<void> {
    this.documents.delete(boardId);
  }
}
