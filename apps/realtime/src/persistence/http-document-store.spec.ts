import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INTERNAL_TOKEN_AUDIENCE, INTERNAL_TOKEN_ISSUER } from '@elysion/shared-types';
import { jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InternalTokenSigner } from '../auth/internal-token-signer.js';
import { HttpDocumentStore } from './http-document-store.js';

const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';

interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

describe('HttpDocumentStore', () => {
  let server: Server;
  let store: HttpDocumentStore;
  let requests: Recorded[];
  let respond: (request: Recorded) => { status: number; etag?: string; body?: Buffer };

  beforeEach(async () => {
    requests = [];
    respond = () => ({ status: 404 });
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const recorded: Recorded = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(recorded);
      const answer = respond(recorded);
      response.statusCode = answer.status;
      if (answer.etag) response.setHeader('etag', answer.etag);
      response.end(answer.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    store = new HttpDocumentStore(
      new InternalTokenSigner(SECRET),
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    );
  });
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('loads the state and its version from the board document route', async () => {
    respond = () => ({ status: 200, etag: '"4"', body: Buffer.from([1, 2, 3]) });

    const stored = await store.load('my board/1');

    expect(stored).toEqual({ state: new Uint8Array([1, 2, 3]), version: '4' });
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe('/internal/boards/my%20board%2F1/document');
  });

  it('answers null for a board without a document', async () => {
    expect(await store.load('b')).toBeNull();
  });

  it('throws instead of answering null when the backend fails', async () => {
    respond = () => ({ status: 500 });

    await expect(store.load('b')).rejects.toThrow('500');
  });

  it('throws when the backend cannot be reached', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await expect(store.load('b')).rejects.toThrow();
    server = createServer().listen(0); // keeps afterEach's close valid
  });

  it('saves the first state with If-None-Match: * and returns the new version', async () => {
    respond = () => ({ status: 204, etag: '"1"' });

    const result = await store.save('b', new Uint8Array([9, 8]), null);

    expect(result).toEqual({ saved: true, version: '1' });
    expect(requests[0].method).toBe('PUT');
    expect(requests[0].headers['if-none-match']).toBe('*');
    expect(requests[0].headers['content-type']).toBe('application/octet-stream');
    expect([...requests[0].body]).toEqual([9, 8]);
  });

  it('saves later states with If-Match naming the base version', async () => {
    respond = () => ({ status: 204, etag: '"6"' });

    const result = await store.save('b', new Uint8Array([1]), '5');

    expect(result).toEqual({ saved: true, version: '6' });
    expect(requests[0].headers['if-match']).toBe('"5"');
  });

  it('returns the stored state on a version conflict', async () => {
    respond = () => ({ status: 409, etag: '"8"', body: Buffer.from([7]) });

    const result = await store.save('b', new Uint8Array([1]), '5');

    expect(result).toEqual({ saved: false, current: { state: new Uint8Array([7]), version: '8' } });
  });

  it('deletes a document', async () => {
    respond = () => ({ status: 204 });

    await store.delete('b');

    expect(requests[0].method).toBe('DELETE');
    expect(requests[0].url).toBe('/internal/boards/b/document');
  });

  describe('authentication', () => {
    const bearer = (request: Recorded) =>
      /^Bearer (.+)$/.exec(String(request.headers.authorization))?.[1];

    it('sends a signed service token with every call: load, save and delete', async () => {
      respond = (request) =>
        request.method === 'PUT'
          ? { status: 204, etag: '"1"' }
          : request.method === 'DELETE'
            ? { status: 204 }
            : { status: 404 };

      await store.load('b1');
      await store.save('b1', new Uint8Array([1]), null);
      await store.delete('b1');

      expect(requests.map((r) => r.method)).toEqual(['GET', 'PUT', 'DELETE']);
      for (const request of requests) {
        const token = bearer(request);
        expect(token).toBeTruthy();
        await expect(
          jwtVerify(token!, new TextEncoder().encode(SECRET), {
            issuer: INTERNAL_TOKEN_ISSUER,
            audience: INTERNAL_TOKEN_AUDIENCE,
            algorithms: ['HS256'],
          }),
        ).resolves.toBeTruthy();
      }
    });

    it('keeps the headers of the call next to the token', async () => {
      respond = () => ({ status: 204, etag: '"2"' });

      await store.save('b1', new Uint8Array([1]), '1');

      expect(requests[0].headers['content-type']).toBe('application/octet-stream');
      expect(requests[0].headers['if-match']).toBe('"1"');
      expect(bearer(requests[0])).toBeTruthy();
    });

    it('treats a 401 of the backend as a failed call, not as a missing document', async () => {
      respond = () => ({ status: 401 });

      await expect(store.load('b1')).rejects.toThrow(/401/);
      await expect(store.save('b1', new Uint8Array([1]), null)).rejects.toThrow(/401/);
    });
  });
});
