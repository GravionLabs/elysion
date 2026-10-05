/** A stored board state and the version it was saved as. */
export interface StoredDocument {
  readonly state: Uint8Array;
  readonly version: string;
}

export type SaveResult =
  | { readonly saved: true; readonly version: string }
  /** Another instance saved first; `current` is what is stored now, to merge and save again. */
  | { readonly saved: false; readonly current: StoredDocument };

/**
 * Where board documents live between restarts (ADR 0011). A save names the version it is based on
 * (`null` for a board that has no stored document yet), so a stale writer cannot overwrite a newer state.
 * Implementations throw when the store cannot be reached; callers never treat that as "no document".
 */
export abstract class DocumentStore {
  /** The stored document, or `null` when the board has none yet. */
  abstract load(boardId: string): Promise<StoredDocument | null>;
  abstract save(
    boardId: string,
    state: Uint8Array,
    baseVersion: string | null,
  ): Promise<SaveResult>;
  abstract delete(boardId: string): Promise<void>;
}
