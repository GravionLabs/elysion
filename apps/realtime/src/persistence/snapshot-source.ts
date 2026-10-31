import { REQUEST_ID_HEADER, currentRequestId } from '@elysion/node-logging';
import { Injectable } from '@nestjs/common';
import type { InternalTokenSigner } from '../auth/internal-token-signer.js';

const REQUEST_TIMEOUT_MS = 30_000;

/** Where the bytes of a board's version come from when one is restored (ADR 0032). */
export abstract class SnapshotSource {
  /** The Yjs state of the version, or `null` when the board has no such version (or its object is gone). */
  abstract read(boardId: string, snapshotId: string): Promise<Uint8Array | null>;
}

/**
 * The business backend's `/internal/boards/{id}/snapshots/{snapshotId}/document` route, with the same service token as
 * {@link HttpDocumentStore}. Throws when the backend cannot be reached or answers with an error.
 */
@Injectable()
export class HttpSnapshotSource extends SnapshotSource {
  private readonly baseUrl: string;

  constructor(
    private readonly tokens: InternalTokenSigner,
    baseUrl = process.env.BUSINESS_BACKEND_URL ?? 'http://localhost:5174',
  ) {
    super();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async read(boardId: string, snapshotId: string): Promise<Uint8Array | null> {
    const url = `${this.baseUrl}/internal/boards/${encodeURIComponent(boardId)}/snapshots/${encodeURIComponent(snapshotId)}/document`;
    const requestId = currentRequestId();
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${await this.tokens.sign()}`,
        ...(requestId === undefined ? {} : { [REQUEST_ID_HEADER]: requestId }),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 410) return null;
    if (response.status !== 200) {
      throw new Error(`Snapshot source answered ${response.status}, expected 200`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

/** Keeps versions in the process; for tests that do not need the business backend. */
export class InMemorySnapshotSource extends SnapshotSource {
  readonly snapshots = new Map<string, Uint8Array>();

  async read(boardId: string, snapshotId: string): Promise<Uint8Array | null> {
    return this.snapshots.get(`${boardId}/${snapshotId}`) ?? null;
  }

  put(boardId: string, snapshotId: string, state: Uint8Array): void {
    this.snapshots.set(`${boardId}/${snapshotId}`, state);
  }
}
