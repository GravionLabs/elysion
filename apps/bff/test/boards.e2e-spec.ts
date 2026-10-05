import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { FakeBusinessBackend } from './fake-business-backend.js';

describe('Boards (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;

  beforeEach(async () => {
    upstream = new FakeBusinessBackend();
    await upstream.start();
    process.env.BUSINESS_BACKEND_URL = upstream.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await upstream.stop();
    delete process.env.BUSINESS_BACKEND_URL;
  });

  const server = () => app.getHttpServer();

  it('creates a board and answers in the UI shape, including the route that opens it', async () => {
    const { body } = await request(server())
      .post('/api/boards')
      .send({ name: ' Sprint ' })
      .expect(201);

    expect(body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Sprint',
      createdAt: expect.any(String),
      path: `/board/${body.id}`,
    });
  });

  it('lists, reads, renames and deletes', async () => {
    const first = (await request(server()).post('/api/boards').send({ name: 'One' })).body;
    const second = (await request(server()).post('/api/boards').send({ name: 'Two' })).body;

    const list = await request(server()).get('/api/boards').expect(200);
    expect(list.body.map((b: { name: string }) => b.name)).toEqual(['Two', 'One']);

    await request(server())
      .get(`/api/boards/${first.id}`)
      .expect(200)
      .expect((r) => {
        expect(r.body.name).toBe('One');
      });

    const renamed = await request(server())
      .patch(`/api/boards/${first.id}`)
      .send({ name: 'Uno' })
      .expect(200);
    expect(renamed.body).toMatchObject({ id: first.id, name: 'Uno', path: `/board/${first.id}` });

    await request(server()).delete(`/api/boards/${second.id}`).expect(204);
    await request(server()).get(`/api/boards/${second.id}`).expect(404);
  });

  it('answers 404 for an unknown board', async () => {
    await request(server()).get('/api/boards/0197a8d2-1c3e-7a10-8000-000000000001').expect(404);
  });

  it('answers 404 for an id that is not a UUID without calling the backend', async () => {
    await request(server()).get('/api/boards/not-a-uuid').expect(404);
    await request(server()).patch('/api/boards/not-a-uuid').send({ name: 'x' }).expect(404);
    await request(server()).delete('/api/boards/not-a-uuid').expect(404);

    expect(upstream.requests).toBe(0);
  });

  it('accepts version 7 UUIDs, which is what the business backend generates', async () => {
    await request(server()).get('/api/boards/01a109a8-cb51-7223-9988-b7c7d725080c').expect(404);

    expect(upstream.requests).toBe(1);
  });

  it("passes the backend's name validation through as 400", async () => {
    const { body } = await request(server()).post('/api/boards').send({ name: '   ' }).expect(400);

    expect(body.message).toContain('between 1 and 120');
  });

  it('rejects a body without a string name as 400 without calling the backend', async () => {
    await request(server()).post('/api/boards').send({}).expect(400);
    await request(server()).post('/api/boards').send({ name: 42 }).expect(400);

    expect(upstream.requests).toBe(0);
  });

  it('answers 502 when the business backend is down', async () => {
    await upstream.stop();

    const { body } = await request(server()).get('/api/boards').expect(502);

    expect(body.message).toContain('not reachable');
  });
});
