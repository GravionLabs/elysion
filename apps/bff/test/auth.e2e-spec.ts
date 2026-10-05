import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { type TokenOptions, bearer, signToken, testVerifier } from './test-auth.js';

describe('Authentication (e2e, tokens signed with a local key pair)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TokenVerifier)
      .useValue(testVerifier())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  const verify = (authorization?: string) => {
    const call = request(app.getHttpServer()).get('/api/auth/verify');
    return authorization === undefined ? call : call.set('Authorization', authorization);
  };

  it('answers 200 for a valid token and names the user in headers, for the edge to pass on', async () => {
    const response = await verify(
      await bearer({ subject: 'kc-sub-9', email: 'ada@example.com' }),
    ).expect(200);

    expect(response.headers['x-auth-user-id']).toBe('kc-sub-9');
    expect(response.headers['x-auth-user-email']).toBe('ada@example.com');
    expect(response.text).toBe('');
  });

  it('leaves out the email header when the token has no email', async () => {
    const response = await verify(await bearer({ email: '' })).expect(200);

    expect(response.headers['x-auth-user-id']).toBe('kc-sub-1');
    expect(response.headers).not.toHaveProperty('x-auth-user-email');
  });

  it('answers 401 without a token, and asks for a bearer token', async () => {
    const response = await verify().expect(401);

    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.headers).not.toHaveProperty('x-auth-user-id');
  });

  it.each<[string, TokenOptions]>([
    ['another key', { wrongKey: true }],
    ['another issuer', { issuer: 'http://evil.test/realms/elysion' }],
    ['another audience', { audience: 'account' }],
    ['no audience', { audience: null }],
    ['an expired token', { expiresIn: -600 }],
    ['no subject', { subject: null }],
  ])('answers 401 for a token with %s', async (_label, options) => {
    await verify(await bearer(options)).expect(401);
  });

  it.each([
    ['Bearer'],
    ['Bearer '],
    ['Bearer not.a.jwt'],
    ['Basic dXNlcjpwYXNz'],
    ['bearer'],
    ['Token abc'],
  ])('answers 401 for the header "%s"', async (header) => {
    await verify(header).expect(401);
  });

  it('accepts the scheme in any letter case', async () => {
    await verify(`bearer ${await signToken()}`).expect(200);
  });

  it('protects every route but /health', async () => {
    const server = request(app.getHttpServer());
    await server.get('/').expect(401);
    await server.get('/api/boards').expect(401);
    await server.post('/api/boards').send({ name: 'x' }).expect(401);
    await server.get('/api/boards/0197a8d2-1c3e-7a10-8000-000000000001').expect(401);
    await server.get('/health').expect(200);
  });
});
