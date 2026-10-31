import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

const ID = '33333333-3333-4333-8333-333333333333';

describe('/api/access-tokens and the admin token list (e2e, #851)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let authorization: string;

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
    authorization = await bearer();
  });

  afterEach(async () => {
    await app.close();
    await upstream.stop();
    delete process.env.BUSINESS_BACKEND_URL;
  });

  const server = () => request(app.getHttpServer());

  it('lists the caller’s tokens with the caller’s token', async () => {
    upstream.accessTokenAnswer = { status: 200, body: [{ id: ID, name: 'CI' }] };

    const { body } = await server()
      .get('/api/access-tokens')
      .set('Authorization', authorization)
      .expect(200);

    expect(body).toEqual([{ id: ID, name: 'CI' }]);
    expect(upstream.lastAccessTokenRequest).toMatchObject({
      method: 'GET',
      path: '/access-tokens',
    });
    expect(upstream.authorizations.at(-1)).toBe(authorization);
  });

  it('makes a token with the name, scopes and expiry as sent, and answers with the secret', async () => {
    upstream.accessTokenAnswer = { status: 201, body: { id: ID, token: 'elp_secret' } };

    const { body } = await server()
      .post('/api/access-tokens')
      .set('Authorization', authorization)
      .send({ name: 'CI', scopes: ['boards:read'], expiresInDays: 30, extra: 'dropped' })
      .expect(201);

    expect(body).toEqual({ id: ID, token: 'elp_secret' });
    expect(upstream.lastAccessTokenRequest?.body).toEqual({
      name: 'CI',
      scopes: ['boards:read'],
      expiresInDays: 30,
    });
  });

  it.each([
    [{ scopes: ['boards:read'], expiresInDays: 30 }],
    [{ name: 'CI', scopes: 'boards:read', expiresInDays: 30 }],
    [{ name: 'CI', scopes: [1], expiresInDays: 30 }],
    [{ name: 'CI', scopes: ['boards:read'], expiresInDays: '30' }],
    [{ name: 'CI', scopes: ['boards:read'], expiresInDays: 1.5 }],
  ])('refuses a body of the wrong shape (%j) without asking the backend', async (body) => {
    await server()
      .post('/api/access-tokens')
      .set('Authorization', authorization)
      .send(body)
      .expect(400);
    expect(upstream.lastAccessTokenRequest).toBeNull();
  });

  it('passes the backend’s rules on: a validation problem is 400 with its message', async () => {
    upstream.accessTokenAnswer = {
      status: 400,
      body: { errors: { expiresInDays: ['A token expires after 1 to 365 days.'] } },
    };

    const { body } = await server()
      .post('/api/access-tokens')
      .set('Authorization', authorization)
      .send({ name: 'CI', scopes: ['boards:read'], expiresInDays: 400 })
      .expect(400);

    expect(body.message).toBe('A token expires after 1 to 365 days.');
  });

  it('revokes a token by id, and an id that is not one is 404 without a call', async () => {
    upstream.accessTokenAnswer = { status: 204 };

    await server()
      .delete(`/api/access-tokens/${ID}`)
      .set('Authorization', authorization)
      .expect(204);
    expect(upstream.lastAccessTokenRequest).toMatchObject({
      method: 'DELETE',
      path: `/access-tokens/${ID}`,
    });

    upstream.lastAccessTokenRequest = null;
    await server().delete('/api/access-tokens/x').set('Authorization', authorization).expect(404);
    expect(upstream.lastAccessTokenRequest).toBeNull();
  });

  it('needs a login', async () => {
    await server().get('/api/access-tokens').expect(401);
  });

  it('passes the admin token list on with its search and page', async () => {
    upstream.adminAnswer = { status: 200, body: { items: [], total: 0, page: 2, pageSize: 25 } };

    await server()
      .get('/api/admin/access-tokens?query=ci&page=2&pageSize=25&other=x')
      .set('Authorization', authorization)
      .expect(200);

    expect(upstream.lastAdminRequest).toMatchObject({
      method: 'GET',
      path: '/admin/access-tokens?query=ci&page=2&pageSize=25',
    });
  });

  it('passes an admin revoke on, and a 403 of the backend stays 403', async () => {
    upstream.adminAnswer = { status: 204 };
    await server()
      .delete(`/api/admin/access-tokens/${ID}`)
      .set('Authorization', authorization)
      .expect(204);
    expect(upstream.lastAdminRequest).toMatchObject({
      method: 'DELETE',
      path: `/admin/access-tokens/${ID}`,
    });

    upstream.adminAnswer = { status: 403 };
    await server()
      .delete(`/api/admin/access-tokens/${ID}`)
      .set('Authorization', authorization)
      .expect(403);
  });

  it('passes the kind of the admin user list on, and refuses another one', async () => {
    upstream.adminAnswer = { status: 200, body: { items: [] } };

    await server()
      .get('/api/admin/users?kind=integration')
      .set('Authorization', authorization)
      .expect(200);
    expect(upstream.lastAdminRequest?.path).toBe('/admin/users?kind=integration');

    upstream.lastAdminRequest = null;
    await server()
      .get('/api/admin/users?kind=robots')
      .set('Authorization', authorization)
      .expect(400);
    expect(upstream.lastAdminRequest).toBeNull();
  });
});
