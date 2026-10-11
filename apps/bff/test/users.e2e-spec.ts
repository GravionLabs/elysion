import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

describe('/api/users (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let authorization: string;

  beforeEach(async () => {
    upstream = new FakeBusinessBackend();
    await upstream.start();
    upstream.users = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        displayName: 'Erika',
        email: 'erika@example.com',
      },
      { id: '22222222-2222-4222-8222-222222222222', displayName: 'Emil', email: null },
    ];
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

  const api = () =>
    request(app.getHttpServer()).get('/api/users').set('Authorization', authorization);

  it('passes the query on and answers with the people', async () => {
    const { body } = await api().query({ query: 'Eri' }).expect(200);

    expect(upstream.lastUserSearch).toBe('eri');
    expect(body).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        displayName: 'Erika',
        email: 'erika@example.com',
      },
    ]);
  });

  it('passes a query that is too short on, so the backend answers 400', async () => {
    await api().query({ query: 'e' }).expect(400);
    await api().expect(400);
  });

  it('treats a query given twice as no query', async () => {
    await api().query('query=er&query=em').expect(400);
  });

  it('needs a login', async () => {
    await request(app.getHttpServer()).get('/api/users?query=er').expect(401);
  });
});
