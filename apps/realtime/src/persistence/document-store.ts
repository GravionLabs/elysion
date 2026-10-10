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

/** Statuses that say the board's document will never be accepted as it is; retrying is pointless. 401 and 403 are not here: a secret that is set right later makes them work. */
const PERMANENT_STATUSES = new Set([400, 404, 410, 413, 422]);

/**
 * The store answered, and the answer will not change by asking again: the board is gone (404, 410) or its state is
 * refused (400, 413, 422). The registry gives up on such a board instead of retrying for ever (#774).
 */
export class DocumentRejectedError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentRejectedError';
  }

  static isPermanent(status: number): boolean {
    return PERMANENT_STATUSES.has(status);
  }
}
