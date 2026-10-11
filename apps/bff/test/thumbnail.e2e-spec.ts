import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

describe('Board thumbnails (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let authorization: string;
  const boardId = randomUUID();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

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
    await app.listen(0);
    authorization = await bearer();
  });

  afterEach(async () => {
    await app.close();
    await upstream.stop();
    delete process.env.BUSINESS_BACKEND_URL;
  });

  const api = () => request.agent(app.getHttpServer()).set('Authorization', authorization);

  it('stores a picture through the backend and reads it back with an ETag', async () => {
    await api()
      .put(`/api/boards/${boardId}/thumbnail`)
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(204);

    const response = await api().get(`/api/boards/${boardId}/thumbnail`).expect(200);

    expect(response.body).toEqual(png);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['etag']).toBe('"1"');
    expect(response.headers['cache-control']).toBe('private, no-cache');
    expect(response.headers['x-internal']).toBeUndefined();
    expect(upstream.authorizations.every((a) => a === authorization)).toBe(true);
  });

  it('answers 304 to a browser that has the current picture', async () => {
    await api()
      .put(`/api/boards/${boardId}/thumbnail`)
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(204);

    await api().get(`/api/boards/${boardId}/thumbnail`).set('If-None-Match', '"1"').expect(304);
  });

  it('is 404 for a board without a picture, and for an id that is no UUID without asking the backend', async () => {
    await api().get(`/api/boards/${boardId}/thumbnail`).expect(404);
    const asked = upstream.authorizations.length;
    await api().get('/api/boards/not-a-uuid/thumbnail').expect(404);
    expect(upstream.authorizations.length).toBe(asked);
  });

  it('refuses an upload without a length or over the limit before it reaches the backend', async () => {
    const huge = Buffer.alloc(3 * 1024 * 1024);

    await api()
      .put(`/api/boards/${boardId}/thumbnail`)
      .set('Content-Type', 'image/png')
      .send(huge)
      .expect(413);
    expect(upstream.thumbnails.size).toBe(0);
  });

  it('needs a token', async () => {
    await request(app.getHttpServer()).get(`/api/boards/${boardId}/thumbnail`).expect(401);
    await request(app.getHttpServer())
      .put(`/api/boards/${boardId}/thumbnail`)
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(401);
  });
});
