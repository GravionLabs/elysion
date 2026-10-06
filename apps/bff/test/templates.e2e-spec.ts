import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './../src/app.module.js';
import { applyHttpLimits } from '../src/http-limits.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

describe('Templates (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: NestExpressApplication;
  let authorization: string;

  beforeEach(async () => {
    upstream = new FakeBusinessBackend();
    await upstream.start();
    process.env.BUSINESS_BACKEND_URL = upstream.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TokenVerifier)
      .useValue(testVerifier())
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    applyHttpLimits(app);
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

  describe('own templates', () => {
    const scene = '{"type":"excalidraw","version":2,"elements":[]}';

    it('saves a template: forwards name, description and scene with the token, and answers 201', async () => {
      const { body } = await api()
        .post('/api/templates')
        .send({ name: 'Mine', description: 'A start', scene, ignored: 'x' })
        .expect(201);

      expect(body).toEqual(expect.objectContaining({ name: 'Mine', isBuiltIn: false, scene }));
      expect(upstream.lastTemplateRequest?.body).toEqual({
        name: 'Mine',
        description: 'A start',
        scene,
      });
      expect(upstream.authorizations.at(-1)).toBe(authorization);
      const list = (await api().get('/api/templates').expect(200)).body;
      expect(list.map((t: { name: string }) => t.name)).toContain('Mine');
    });

    it('takes a scene larger than the default body limit of Express', async () => {
      const big = JSON.stringify({
        type: 'excalidraw',
        elements: [],
        padding: 'x'.repeat(500_000),
      });

      await api().post('/api/templates').send({ name: 'Big', scene: big }).expect(201);
    });

    it('answers 400 for a body that is not an object, without asking the backend', async () => {
      const before = upstream.requests;

      await api()
        .post('/api/templates')
        .set('Content-Type', 'application/json')
        .send('[1]')
        .expect(400);

      expect(upstream.requests).toBe(before);
    });

    it('passes on what the backend refuses (400, 403, 404)', async () => {
      for (const status of [400, 403, 404]) {
        upstream.templateRefusal = status;
        await api().post('/api/templates').send({ name: 'x', scene }).expect(status);
      }
    });

    it('deletes a template with 204, and answers 404 for an id that is not a UUID without asking the backend', async () => {
      const id = upstream.templates[0].id;

      await api().delete(`/api/templates/${id}`).expect(204);
      expect(upstream.lastTemplateRequest?.path).toBe(`/templates/${id}`);
      const before = upstream.requests;
      await api().delete('/api/templates/nope').expect(404);
      expect(upstream.requests).toBe(before);
    });

    it('needs a signed-in user', async () => {
      await request(app.getHttpServer())
        .post('/api/templates')
        .send({ name: 'x', scene })
        .expect(401);
      await request(app.getHttpServer())
        .delete(`/api/templates/${upstream.templates[0].id}`)
        .expect(401);
    });
  });
});
