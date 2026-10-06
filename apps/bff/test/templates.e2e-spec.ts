import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

describe('Templates (e2e, against a fake business backend)', () => {
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

  const api = () => request.agent(app.getHttpServer()).set('Authorization', authorization);

  it('lists the catalog without scenes', async () => {
    const { body } = await api().get('/api/templates').expect(200);

    expect(body).toEqual([expect.objectContaining({ name: 'Retrospective', isBuiltIn: true })]);
    expect(body[0]).not.toHaveProperty('scene');
  });

  it('returns one template with its scene and forwards the access token', async () => {
    const { body } = await api().get(`/api/templates/${upstream.templates[0].id}`).expect(200);

    expect(JSON.parse(body.scene).type).toBe('excalidraw');
    expect(upstream.authorizations.at(-1)).toBe(authorization);
  });

  it('answers 404 for an unknown template and for a non-UUID id without asking the backend', async () => {
    await api().get('/api/templates/00000000-0000-4000-8000-000000000000').expect(404);
    const before = upstream.requests;
    await api().get('/api/templates/nope').expect(404);
    expect(upstream.requests).toBe(before);
  });

  it('requires a signed-in user', async () => {
    await request(app.getHttpServer()).get('/api/templates').expect(401);
  });
});
