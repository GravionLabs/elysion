import { Injectable } from '@nestjs/common';
import type { InternalTokenSigner } from '../auth/internal-token-signer.js';
import { DocumentStore, type SaveResult, type StoredDocument } from './document-store.js';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The business backend's `/internal/boards/{id}/document` API (ADR 0011). Every call carries a short-lived service
 * token (ADR 0017), signed locally: the API accepts nothing else.
 */
@Injectable()
export class HttpDocumentStore extends DocumentStore {
  private readonly baseUrl: string;

  constructor(
    private readonly tokens: InternalTokenSigner,
    baseUrl = process.env.BUSINESS_BACKEND_URL ?? 'http://localhost:5174',
  ) {
    super();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async load(boardId: string): Promise<StoredDocument | null> {
    const response = await this.request(boardId, { method: 'GET' });
    if (response.status === 404) {
      return null;
    }
    this.expect(response, 200);
    return this.read(response);
  }

  async save(boardId: string, state: Uint8Array, baseVersion: string | null): Promise<SaveResult> {
    const response = await this.request(boardId, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        ...(baseVersion === null ? { 'if-none-match': '*' } : { 'if-match': `"${baseVersion}"` }),
      },
      body: state as BodyInit,
    });
    if (response.status === 409) {
      return { saved: false, current: await this.read(response) };
    }
    this.expect(response, 204);
    return { saved: true, version: this.version(response) };
  }

  async delete(boardId: string): Promise<void> {
    const response = await this.request(boardId, { method: 'DELETE' });
    this.expect(response, 204);
  }

  private async request(boardId: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}/internal/boards/${encodeURIComponent(boardId)}/document`;
    const headers = { ...init.headers, authorization: `Bearer ${await this.tokens.sign()}` };
    return fetch(url, { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }

  private expect(response: Response, status: number): void {
    if (response.status !== status) {
      throw new Error(`Document store answered ${response.status}, expected ${status}`);
    }
  }

  private async read(response: Response): Promise<StoredDocument> {
    return {
      state: new Uint8Array(await response.arrayBuffer()),
      version: this.version(response),
    };
  }

  private version(response: Response): string {
    const version = response.headers.get('etag')?.replaceAll('"', '');
    if (!version) {
      throw new Error('Document store answered without an ETag');
    }
    return version;
  }
}
