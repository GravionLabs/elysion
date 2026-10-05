import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

describe('Boards (e2e, against a fake business backend)', () => {
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

  const server = () => app.getHttpServer();
  let authorization: string;
  beforeEach(async () => {
    authorization = await bearer();
  });
  /** A client that is signed in. */
  const api = () => request.agent(server()).set('Authorization', authorization);

  it('creates a board and answers in the UI shape, including the route that opens it', async () => {
    const { body } = await api().post('/api/boards').send({ name: ' Sprint ' }).expect(201);

    expect(body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Sprint',
      createdAt: expect.any(String),
      path: `/board/${body.id}`,
    });
  });

  it("forwards the caller's access token to the business backend on every call", async () => {
    const created = (await api().post('/api/boards').send({ name: 'Retro' })).body;
    await api().get('/api/boards');
    await api().get(`/api/boards/${created.id}`);
    await api().patch(`/api/boards/${created.id}`).send({ name: 'New' });
    await api().post(`/api/boards/${created.id}/duplicate`);
    await api().delete(`/api/boards/${created.id}`);

    expect(upstream.authorizations).toHaveLength(6);
    expect(new Set(upstream.authorizations)).toEqual(new Set([authorization]));
  });

  it('does not call the backend at all without a token', async () => {
    await request(server()).get('/api/boards').expect(401);
    await request(server()).post('/api/boards').send({ name: 'x' }).expect(401);

    expect(upstream.requests).toBe(0);
  });

  it('duplicates a board and answers in the UI shape with the route of the copy', async () => {
    const source = (await api().post('/api/boards').send({ name: 'Retro' })).body;

    const { body } = await api().post(`/api/boards/${source.id}/duplicate`).expect(201);

    expect(body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Retro (copy)',
      createdAt: expect.any(String),
      path: `/board/${body.id}`,
    });
    expect(body.id).not.toBe(source.id);
  });

  it('answers 404 when duplicating an unknown board, without asking the backend for a bad id', async () => {
    await api().post(`/api/boards/${randomUUID()}/duplicate`).expect(404);

    const before = upstream.requests;
    await api().post('/api/boards/not-a-uuid/duplicate').expect(404);
    expect(upstream.requests).toBe(before);
  });

  it('lists, reads, renames and deletes', async () => {
    const first = (await api().post('/api/boards').send({ name: 'One' })).body;
    const second = (await api().post('/api/boards').send({ name: 'Two' })).body;

    const list = await api().get('/api/boards').expect(200);
    expect(list.body.map((b: { name: string }) => b.name)).toEqual(['Two', 'One']);

    await api()
      .get(`/api/boards/${first.id}`)
      .expect(200)
      .expect((r) => {
        expect(r.body.name).toBe('One');
      });

    const renamed = await api().patch(`/api/boards/${first.id}`).send({ name: 'Uno' }).expect(200);
    expect(renamed.body).toMatchObject({ id: first.id, name: 'Uno', path: `/board/${first.id}` });

    await api().delete(`/api/boards/${second.id}`).expect(204);
    await api().get(`/api/boards/${second.id}`).expect(404);
  });

  it('answers 404 for an unknown board', async () => {
    await api().get('/api/boards/0197a8d2-1c3e-7a10-8000-000000000001').expect(404);
  });

  it('answers 404 for an id that is not a UUID without calling the backend', async () => {
    await api().get('/api/boards/not-a-uuid').expect(404);
    await api().patch('/api/boards/not-a-uuid').send({ name: 'x' }).expect(404);
    await api().delete('/api/boards/not-a-uuid').expect(404);

    expect(upstream.requests).toBe(0);
  });

  it('accepts version 7 UUIDs, which is what the business backend generates', async () => {
    await api().get('/api/boards/01a109a8-cb51-7223-9988-b7c7d725080c').expect(404);

    expect(upstream.requests).toBe(1);
  });

  it("passes the backend's name validation through as 400", async () => {
    const { body } = await api().post('/api/boards').send({ name: '   ' }).expect(400);

    expect(body.message).toContain('between 1 and 120');
  });

  it('rejects a body without a string name as 400 without calling the backend', async () => {
    await api().post('/api/boards').send({}).expect(400);
    await api().post('/api/boards').send({ name: 42 }).expect(400);

    expect(upstream.requests).toBe(0);
  });

  it('answers 502 when the business backend is down', async () => {
    await upstream.stop();

    const { body } = await api().get('/api/boards').expect(502);

    expect(body.message).toContain('not reachable');
  });
});
