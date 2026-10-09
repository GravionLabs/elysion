import { Writable } from 'node:stream';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { isValidRequestId } from '@elysion/node-logging';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { LOG_STREAM } from '../src/logging/logging.module.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, signToken, testVerifier } from './test-auth.js';

type Line = Record<string, any>;

describe('Logging (e2e, ADR 0025)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let raw: string[];

  /** Every log line written so far, parsed. A line that is not JSON fails the test: stdout is JSON only. */
  const lines = (): Line[] =>
    raw
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Line);
  const requestLine = (route: string): Line => lines().find((line) => line.http?.route === route)!;

  beforeEach(async () => {
    raw = [];
    upstream = new FakeBusinessBackend();
    await upstream.start();
    process.env.BUSINESS_BACKEND_URL = upstream.url;
    const stream = new Writable({
      write(chunk, _encoding, done) {
        raw.push(String(chunk));
        done();
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TokenVerifier)
      .useValue(testVerifier())
      .overrideProvider(LOG_STREAM)
      .useValue(stream)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await upstream.stop();
    delete process.env.BUSINESS_BACKEND_URL;
  });

  const get = async (path: string, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', await bearer())
      .set(headers);

  it('writes one JSON line per request with the shared fields, the route pattern and the subject', async () => {
    const response = await get('/api/boards');

    expect(response.status).toBe(200);
    const line = requestLine('/api/boards');
    expect(line).toMatchObject({
      level: 'info',
      service: 'elysion-bff',
      userId: 'kc-sub-1',
      message: 'HTTP GET /api/boards responded 200',
      http: { method: 'GET', route: '/api/boards', status: 200 },
    });
    expect(line.requestId).toBe(response.headers['x-request-id']);
    expect(line.http.durationMs).toBeGreaterThanOrEqual(0);
    expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // No headers, no URL, none of pino's own names.
    for (const name of ['req', 'res', 'responseTime', 'pid', 'hostname', 'msg', 'time']) {
      expect(Object.keys(line)).not.toContain(name);
    }
  });

  it('logs the route pattern, not the URL: an id in the path is not in the log', async () => {
    const id = '0b6f1c1e-5d3a-4f0e-9a51-6c1d2f3a4b01';
    await get(`/api/boards/${id}`);

    expect(requestLine('/api/boards/:id')).toBeDefined();
    expect(raw.join('')).not.toContain(id);
  });

  it('gives a request without an id one, echoes it and sends the same one to the business backend', async () => {
    const response = await get('/api/boards');

    const id = response.headers['x-request-id'];
    expect(isValidRequestId(id)).toBe(true);
    expect(upstream.requestIds).toEqual([id]);
    expect(lines().every((line) => line.requestId === id)).toBe(true);
  });

  it('takes the id of the caller when it is well formed', async () => {
    const response = await get('/api/boards', { 'X-Request-Id': 'client-1234.abcd_EF' });

    expect(response.headers['x-request-id']).toBe('client-1234.abcd_EF');
    expect(upstream.requestIds).toEqual(['client-1234.abcd_EF']);
    expect(requestLine('/api/boards').requestId).toBe('client-1234.abcd_EF');
  });

  it.each(['short', 'has spaces in it 12345', 'semi;colon;and;more', 'x'.repeat(70)])(
    'replaces an id that is not well formed (%s) and never logs it',
    async (sent) => {
      const response = await get('/api/boards', { 'X-Request-Id': sent });

      const id = response.headers['x-request-id'];
      expect(id).not.toBe(sent);
      expect(isValidRequestId(id)).toBe(true);
      expect(upstream.requestIds).toEqual([id]);
      expect(raw.join('')).not.toContain(sent);
    },
  );

  it('never writes Authorization, Cookie or the token query parameter', async () => {
    const authorization = await bearer();
    const token = authorization.replace(/^Bearer /, '');
    await request(app.getHttpServer())
      .get('/api/boards?token=query-marker&access_token=query-marker-2')
      .set('Authorization', authorization)
      .set('Cookie', 'session=cookie-marker');
    await request(app.getHttpServer())
      .get('/yjs?board=1&token=query-marker-3')
      .set('Authorization', 'Bearer garbage-marker')
      .set('Cookie', 'session=cookie-marker');

    const output = raw.join('');
    expect(output.length).toBeGreaterThan(0);
    for (const secret of [
      token,
      'garbage-marker',
      'cookie-marker',
      'query-marker',
      'query-marker-2',
      'query-marker-3',
      process.env.WS_TOKEN_SECRET ?? 'test-only-ws-token-secret-0123456789abcdef',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it.each([
    ['expired', { expiresIn: -600 }],
    ['wrong_audience', { audience: 'someone-else' }],
    ['wrong_issuer', { issuer: 'http://evil.test/realms/elysion' }],
    ['invalid_signature', { wrongKey: true }],
  ])('logs why a token was refused (%s) without the token', async (reason, options) => {
    const token = await signToken(options);
    const response = await request(app.getHttpServer())
      .get('/api/boards')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    const rejection = lines().find((line) => line.message === 'Access token rejected')!;
    expect(rejection).toMatchObject({
      level: 'warn',
      reason,
      requestId: response.headers['x-request-id'],
    });
    expect(rejection.userId).toBeUndefined();
    expect(raw.join('')).not.toContain(token);
  });

  it('logs a token that is no token as malformed', async () => {
    await request(app.getHttpServer()).get('/api/boards').set('Authorization', 'Bearer not.a.jwt');

    expect(lines().find((line) => line.message === 'Access token rejected')).toMatchObject({
      reason: 'malformed',
    });
  });

  it('puts every URL that matches no route under "unmatched"', async () => {
    await get('/nothing/here/1');

    expect(requestLine('unmatched')).toMatchObject({ http: { status: 404 } });
    expect(raw.join('')).not.toContain('/nothing/here/1');
  });

  it('logs a failed call as an error with the exception in the shared shape', async () => {
    await upstream.stop();

    const response = await get('/api/boards');

    expect(response.status).toBe(502);
    const line = requestLine('/api/boards');
    expect(line.level).toBe('error');
    expect(line.err).toMatchObject({ type: expect.any(String), message: expect.any(String) });
    expect(line.err.type).not.toBe('NonError');
  });

  it('keeps health checks out of the logs at the default level', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);

    expect(lines().filter((line) => line.http?.route === '/health')).toEqual([]);
  });
});
