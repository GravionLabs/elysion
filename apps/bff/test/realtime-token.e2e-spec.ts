import { WS_TOKEN_AUDIENCE, WS_TOKEN_ISSUER } from '@elysion/shared-types';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { decodeJwt, jwtVerify } from 'jose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

const SECRET = 'test-only-ws-token-secret-0123456789abcdef'; // from vitest.config.e2e.ts
const BOARD = '0197a8d2-1c3e-7a10-8000-000000000001';

describe('POST /api/realtime/token (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;

  beforeEach(async () => {
    upstream = new FakeBusinessBackend();
    await upstream.start();
    process.env.BUSINESS_BACKEND_URL = upstream.url;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TokenVerifier)
      .useValue(testVerifier())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await upstream.stop();
    delete process.env.BUSINESS_BACKEND_URL;
  });

  const post = async (body: unknown, authorization: string | null = null) => {
    const call = request(app.getHttpServer())
      .post('/api/realtime/token')
      .send(body as object);
    return authorization === null ? call : call.set('Authorization', authorization);
  };

  it('is 401 without a token, and never asks the backend', async () => {
    await post({ boardId: BOARD }).then((r) => expect(r.status).toBe(401));

    expect(upstream.requests).toBe(0);
  });

  it('is 401 for an invalid token', async () => {
    const response = await post({ boardId: BOARD }, await bearer({ wrongKey: true }));

    expect(response.status).toBe(401);
  });

  it('is 403 for a signed-in user who has no role on the board: a token is never minted just because the caller is authenticated', async () => {
    const response = await post({ boardId: BOARD }, await bearer());

    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty('token');
    expect(upstream.requests).toBe(1); // the backend was asked
  });

  it('counts the refusals by reason on /metrics', async () => {
    await post({ boardId: BOARD }, await bearer()); // no role on a stored board
    await post({ boardId: 'not-a-uuid' }, await bearer());
    await post({ boardId: 'default' }, await bearer());

    const text = (await request(app.getHttpServer()).get('/metrics')).text;

    expect(text).toContain('elysion_bff_realtime_token_refusals_total{reason="no_role"} 1');
    expect(text).toContain('elysion_bff_realtime_token_refusals_total{reason="not_uuid"} 2');
  });

  it('is 403 for a board id that is not a stored board, without asking the backend', async () => {
    for (const boardId of ['default', 'not-a-uuid', '../etc']) {
      expect((await post({ boardId }, await bearer())).status).toBe(403);
    }

    expect(upstream.requests).toBe(0);
  });

  it('is 200 with a decodable token for the requested board when the user has a role', async () => {
    upstream.roles.set(BOARD, 'Editor');
    const authorization = await bearer({ subject: 'kc-sub-9' });

    const response = await post({ boardId: BOARD }, authorization);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ token: expect.any(String), expiresAt: expect.any(String) });
    expect(decodeJwt(response.body.token)).toMatchObject({
      sub: 'kc-sub-9',
      boardId: BOARD,
      role: 'editor',
      iss: WS_TOKEN_ISSUER,
      aud: WS_TOKEN_AUDIENCE,
    });
    expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(upstream.authorizations).toEqual([authorization]); // the caller's own token went to the backend
  });

  it('signs with the shared secret so the realtime service can verify it offline', async () => {
    upstream.roles.set(BOARD, 'Viewer');

    const { body } = await post({ boardId: BOARD }, await bearer());

    const verified = await jwtVerify(body.token, new TextEncoder().encode(SECRET), {
      issuer: WS_TOKEN_ISSUER,
      audience: WS_TOKEN_AUDIENCE,
      algorithms: ['HS256'],
    });
    expect(verified.payload).toMatchObject({ boardId: BOARD, role: 'viewer' });
  });

  it.each([
    ['Owner', 'owner'],
    ['Editor', 'editor'],
    ['Viewer', 'viewer'],
  ])('maps the backend role %s to %s', async (backendRole, expected) => {
    upstream.roles.set(BOARD, backendRole);

    const { body } = await post({ boardId: BOARD }, await bearer());

    expect(decodeJwt(body.token).role).toBe(expected);
  });

  it('is 400 without a board id', async () => {
    for (const body of [{}, { boardId: 42 }, { boardId: '  ' }, null]) {
      expect((await post(body, await bearer())).status).toBe(400);
    }
  });

  it('passes on a 401 of the backend, and answers 502 when the backend fails or answers nonsense', async () => {
    upstream.membershipStatus = 401;
    expect((await post({ boardId: BOARD }, await bearer())).status).toBe(401);

    upstream.membershipStatus = 500;
    expect((await post({ boardId: BOARD }, await bearer())).status).toBe(502);

    upstream.membershipStatus = null;
    upstream.roles.set(BOARD, 'Superuser');
    expect((await post({ boardId: BOARD }, await bearer())).status).toBe(502);
  });

  it('answers 502 when the backend is down', async () => {
    await upstream.stop();

    expect((await post({ boardId: BOARD }, await bearer())).status).toBe(502);
  });
});
