import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { PublicApi, RequireScope } from '../src/auth/public-api.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { signToken, testVerifier } from './test-auth.js';

/** A public route that needs a scope, to test the guard's scope check (the real ones come with #852). */
@PublicApi()
@Controller('public/v1/test-scoped')
class ScopedController {
  @Get()
  @RequireScope('boards:write')
  get(): { ok: true } {
    return { ok: true };
  }
}

const PAT = `elp_${'a'.repeat(43)}`;
const credential = (scopes: string[], extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    userId: '11111111-1111-4111-8111-111111111111',
    displayName: 'Ada',
    kind: 'person',
    tokenId: '22222222-2222-4222-8222-222222222222',
    scopes,
    ...extra,
  },
});

describe('the public API and its credentials (e2e, ADR 0033, #851)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;

  beforeEach(async () => {
    upstream = new FakeBusinessBackend();
    await upstream.start();
    process.env.BUSINESS_BACKEND_URL = upstream.url;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ScopedController],
    })
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

  const get = (path: string, token?: string) => {
    const call = request(app.getHttpServer()).get(path);
    return token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
  };

  describe('a personal access token', () => {
    it('is accepted on the public API and resolved to its owner and scopes', async () => {
      upstream.credentials.set(PAT, credential(['boards:read']));

      const { body } = await get('/public/v1/me', PAT).expect(200);

      expect(body).toEqual({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Ada',
        kind: 'person',
        tokenId: '22222222-2222-4222-8222-222222222222',
        scopes: ['boards:read'],
      });
      // Passed on unchanged: the business backend looks it up by its hash.
      expect(upstream.authorizations).toContain(`Bearer ${PAT}`);
    });

    it('is refused (401) on the browser routes without asking the backend', async () => {
      upstream.credentials.set(PAT, credential(['boards:read']));

      for (const path of [
        '/api/boards',
        '/api/auth/verify',
        '/api/auth/me',
        '/api/access-tokens',
      ]) {
        const response = await get(path, PAT).expect(401);
        expect(response.headers['www-authenticate']).toBe('Bearer');
      }
      expect(upstream.requests).toBe(0);
    });

    it('is refused (401) when the backend does not know it, or says it expired or was revoked', async () => {
      await get('/public/v1/me', PAT).expect(401);
      upstream.credentials.set(`elp_${'b'.repeat(43)}`, { status: 401 });
      await get('/public/v1/me', `elp_${'b'.repeat(43)}`).expect(401);
    });

    it('is refused (403) on a route whose scope it lacks, and accepted with it', async () => {
      upstream.credentials.set(PAT, credential(['boards:read']));
      const other = `elp_${'c'.repeat(43)}`;
      upstream.credentials.set(other, credential(['boards:read', 'boards:write']));

      const refused = await get('/public/v1/test-scoped', PAT).expect(403);
      expect(refused.body.detail).toBe('This needs a token with the scope "boards:write".');
      await get('/public/v1/test-scoped', other).expect(200, { ok: true });
    });

    it('is resolved once for many calls: the answer is remembered', async () => {
      upstream.credentials.set(PAT, credential(['boards:write']));

      await get('/public/v1/test-scoped', PAT).expect(200);
      await get('/public/v1/test-scoped', PAT).expect(200);
      await get('/public/v1/test-scoped', PAT).expect(200);

      expect(upstream.credentialCalls).toBe(1);
    });

    it('is refused by "me" at once after a revoke, which asks the backend afresh', async () => {
      upstream.credentials.set(PAT, credential(['boards:read']));
      await get('/public/v1/me', PAT).expect(200);

      upstream.credentials.set(PAT, { status: 401 });

      await get('/public/v1/me', PAT).expect(401);
    });

    it('passes the refusal of a deactivated owner on with its code', async () => {
      upstream.credentials.set(PAT, {
        status: 403,
        body: { title: 'Account deactivated', code: 'account-deactivated' },
      });

      const { body } = await get('/public/v1/me', PAT).expect(403);

      expect(body.code).toBe('account-deactivated');
    });

    it('is a 502 when the backend cannot be reached', async () => {
      await upstream.stop();

      await get('/public/v1/me', PAT).expect(502);
    });
  });

  describe('a Keycloak token', () => {
    it('of a person works on the public API too, with the scopes the backend gives it', async () => {
      const token = await signToken();
      upstream.credentials.set(
        token,
        credential(['boards:read', 'boards:write'], { tokenId: null, displayName: 'dev' }),
      );

      const { body } = await get('/public/v1/me', token).expect(200);
      await get('/public/v1/test-scoped', token).expect(200);

      expect(body).toMatchObject({ name: 'dev', kind: 'person', tokenId: null });
    });

    it('of an integration works on the public API only and is refused (403) on the browser routes', async () => {
      const token = await signToken({
        subject: 'sa-ci',
        email: '',
        realmRoles: ['elysion-integration'],
      });
      upstream.credentials.set(
        token,
        credential(['boards:read'], { kind: 'integration', tokenId: null, displayName: 'ci' }),
      );

      const { body } = await get('/public/v1/me', token).expect(200);
      expect(body).toMatchObject({ kind: 'integration', name: 'ci' });
      await get('/public/v1/test-scoped', token).expect(403);

      for (const path of ['/api/boards', '/api/auth/verify', '/api/access-tokens']) {
        await get(path, token).expect(403);
      }
    });

    it('that is invalid is 401 on the public API without asking the backend', async () => {
      await get('/public/v1/me', await signToken({ expiresIn: -600 })).expect(401);
      expect(upstream.credentialCalls).toBe(0);
    });
  });

  it('needs a credential', async () => {
    const response = await get('/public/v1/me').expect(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });
});
