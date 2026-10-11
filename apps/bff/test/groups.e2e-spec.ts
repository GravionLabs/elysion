import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

describe('Groups (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let authorization: string;
  const design = { id: randomUUID(), name: 'Design team', source: 'Local' };
  const engineering = { id: randomUUID(), name: 'Engineering', source: 'IdentityProvider' };

  beforeEach(async () => {
    upstream = new FakeBusinessBackend();
    upstream.groups.set(design.id, design);
    upstream.groups.set(engineering.id, engineering);
    upstream.myGroups.add(engineering.id);
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
  const newRoom = async () => (await api().post('/api/rooms').send({ name: 'Sprint' })).body;

  describe('GET /api/groups', () => {
    it('forwards the search with the caller’s token and returns the groups', async () => {
      const { body } = await api().get('/api/groups?query=design').expect(200);

      expect(body).toEqual([design]);
      expect(upstream.lastGroupRequest?.path).toBe('/groups?query=design');
      expect(upstream.authorizations.at(-1)).toBe(authorization);
    });

    it('passes the backend’s 400 for a search that is too short', async () => {
      await api().get('/api/groups?query=d').expect(400);
      await api().get('/api/groups').expect(400);
    });

    it('needs a login', async () => {
      await request(app.getHttpServer()).get('/api/groups?query=design').expect(401);
      expect(upstream.requests).toBe(0);
    });
  });

  it('lists the caller’s own groups', async () => {
    const { body } = await api().get('/api/me/groups').expect(200);

    expect(body).toEqual([engineering]);
  });

  describe('/api/rooms/:id/groups', () => {
    it('gives a group a role, lists it, changes it and removes it', async () => {
      const room = await newRoom();

      const set = await api()
        .put(`/api/rooms/${room.id}/groups/${design.id}`)
        .send({ role: 'Editor' })
        .expect(200);
      expect(set.body).toEqual({ groupId: design.id, name: 'Design team', role: 'Editor' });
      expect(upstream.lastGroupRequest).toMatchObject({
        method: 'PUT',
        body: { role: 'Editor' },
      });

      await api()
        .put(`/api/rooms/${room.id}/groups/${design.id}`)
        .send({ role: 'Viewer' })
        .expect(200);
      const list = await api().get(`/api/rooms/${room.id}/groups`).expect(200);
      expect(list.body).toEqual([{ groupId: design.id, name: 'Design team', role: 'Viewer' }]);

      await api().delete(`/api/rooms/${room.id}/groups/${design.id}`).expect(204);
      expect((await api().get(`/api/rooms/${room.id}/groups`).expect(200)).body).toEqual([]);
    });

    it('answers 404 from the backend for an unknown group, a group without a role and an unknown room', async () => {
      const room = await newRoom();

      await api()
        .put(`/api/rooms/${room.id}/groups/${randomUUID()}`)
        .send({ role: 'Viewer' })
        .expect(404);
      await api().delete(`/api/rooms/${room.id}/groups/${design.id}`).expect(404);
      await api().get(`/api/rooms/${randomUUID()}/groups`).expect(404);
    });

    it('answers 404 for an id that is not a UUID without asking the backend', async () => {
      const before = upstream.requests;

      await api().get('/api/rooms/nope/groups').expect(404);
      await api()
        .put(`/api/rooms/${randomUUID()}/groups/nope`)
        .send({ role: 'Viewer' })
        .expect(404);

      expect(upstream.requests).toBe(before);
    });

    it('is a 400 when the body has no role, and passes the backend’s 400 for a bad one', async () => {
      const room = await newRoom();

      await api().put(`/api/rooms/${room.id}/groups/${design.id}`).send({}).expect(400);
      await api()
        .put(`/api/rooms/${room.id}/groups/${design.id}`)
        .send({ role: 'Boss' })
        .expect(400);
    });

    it('needs a login', async () => {
      await request(app.getHttpServer()).get(`/api/rooms/${randomUUID()}/groups`).expect(401);
    });
  });
});
