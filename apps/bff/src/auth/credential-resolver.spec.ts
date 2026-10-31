import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialResolver } from './credential-resolver.js';

const ADA = {
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Ada',
  kind: 'person',
  tokenId: '22222222-2222-4222-8222-222222222222',
  scopes: ['boards:read'],
};

describe('CredentialResolver', () => {
  let server: Server;
  let url: string;
  /** What the stand-in backend answers to `/me/credential`, and the tokens it was asked for. */
  let answer: { status: number; body?: unknown };
  let asked: string[];
  let now: number;

  beforeEach(async () => {
    answer = { status: 200, body: ADA };
    asked = [];
    now = 1_000_000;
    server = createServer((req, res) => {
      asked.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(answer.body === undefined ? undefined : JSON.stringify(answer.body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const resolver = (options: { maxEntries?: number } = {}) =>
    new CredentialResolver({ baseUrl: url, ttlMs: 30_000, now: () => now, ...options });

  it('asks the backend with the token and answers its credential', async () => {
    expect(await resolver().resolve('elp_x')).toEqual(ADA);
    expect(asked).toEqual(['GET /me/credential Bearer elp_x']);
  });

  it('remembers an answer for 30 seconds, then asks again', async () => {
    const credentials = resolver();
    await credentials.resolve('elp_x');
    now += 29_999;
    await credentials.resolve('elp_x');
    expect(asked).toHaveLength(1);

    now += 1;
    await credentials.resolve('elp_x');
    expect(asked).toHaveLength(2);
  });

  it('asks again when told to, and remembers the new answer', async () => {
    const credentials = resolver();
    await credentials.resolve('elp_x');
    answer = { status: 401 };

    expect(await credentials.resolve('elp_x', { fresh: true })).toBeNull();
    expect(await credentials.resolve('elp_x')).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('answers null for a token the backend refuses, and remembers that too', async () => {
    answer = { status: 401 };
    const credentials = resolver();

    expect(await credentials.resolve('elp_unknown')).toBeNull();
    expect(await credentials.resolve('elp_unknown')).toBeNull();
    expect(asked).toHaveLength(1);
  });

  it('keeps the tokens apart', async () => {
    const credentials = resolver();
    await credentials.resolve('elp_a');
    await credentials.resolve('elp_b');
    expect(asked).toHaveLength(2);
  });

  it('forgets the oldest answer when it holds as many as it may', async () => {
    const credentials = resolver({ maxEntries: 2 });
    await credentials.resolve('elp_a');
    await credentials.resolve('elp_b');
    await credentials.resolve('elp_c');
    await credentials.resolve('elp_b');
    expect(asked).toHaveLength(3);

    await credentials.resolve('elp_a');
    expect(asked).toHaveLength(4);
  });

  it('throws 403 with the code for a deactivated account and does not remember it', async () => {
    answer = { status: 403, body: { code: 'account-deactivated' } };
    const credentials = resolver();

    const error = await credentials.resolve('elp_x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'account-deactivated',
    });

    answer = { status: 200, body: ADA };
    expect(await credentials.resolve('elp_x')).toEqual(ADA);
  });

  it.each([
    [{ status: 500 }],
    [{ status: 200, body: { userId: 1 } }],
    [{ status: 200, body: { ...ADA, kind: 'robot' } }],
    [{ status: 200, body: { ...ADA, scopes: [1] } }],
  ])('throws 502 for an answer it cannot use (%j)', async (bad) => {
    answer = bad;
    await expect(resolver().resolve('elp_x')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws 502 when the backend cannot be reached', async () => {
    const unreachable = new CredentialResolver({ baseUrl: 'http://127.0.0.1:1' });
    await expect(unreachable.resolve('elp_x')).rejects.toBeInstanceOf(BadGatewayException);
  });
});
