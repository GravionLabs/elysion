import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

const BOARD = '0197a8d2-1c3e-7a10-8000-000000000001';
const USER = '0197a8d2-1c3e-7a10-8000-0000000000aa';

describe('/api/boards/:id/members (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let authorization: string;

  beforeEach(async () => {
    upstream = new FakeBusinessBackend();
    await upstream.start();
    process.env.BUSINESS_BACKEND_URL = upstream.url;
    upstream.members.set(BOARD, [
      { userId: USER, displayName: 'Ada', email: 'ada@example.com', role: 'Owner' },
    ]);
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

  it('lists the members of a board', async () => {
    const { body } = await api().get(`/api/boards/${BOARD}/members`).expect(200);

    expect(body).toEqual([
      { userId: USER, displayName: 'Ada', email: 'ada@example.com', role: 'Owner' },
    ]);
  });

  it('adds a member by email and answers 201 with the member', async () => {
    const { body } = await api()
      .post(`/api/boards/${BOARD}/members`)
      .send({ email: 'bea@example.com', role: 'Viewer' })
      .expect(201);

    expect(body).toMatchObject({ email: 'bea@example.com', role: 'Viewer' });
    expect(upstream.lastMemberRequest).toMatchObject({
      method: 'POST',
      path: `/boards/${BOARD}/members`,
      body: { email: 'bea@example.com', role: 'Viewer' },
    });
  });

  it('changes a role and removes a member', async () => {
    await api().patch(`/api/boards/${BOARD}/members/${USER}`).send({ role: 'Editor' }).expect(200);
    expect(upstream.members.get(BOARD)![0].role).toBe('Editor');

    await api().delete(`/api/boards/${BOARD}/members/${USER}`).expect(204);
    expect(upstream.members.get(BOARD)).toEqual([]);
  });

  it("passes the caller's own token on, on every call", async () => {
    await api().get(`/api/boards/${BOARD}/members`);
    await api().post(`/api/boards/${BOARD}/members`).send({ email: 'a@b.c', role: 'Viewer' });
    await api().patch(`/api/boards/${BOARD}/members/${USER}`).send({ role: 'Viewer' });
    await api().delete(`/api/boards/${BOARD}/members/${USER}`);

    expect(upstream.authorizations).toEqual([
      authorization,
      authorization,
      authorization,
      authorization,
    ]);
  });

  it('is 401 without a token and never asks the backend', async () => {
    await request(app.getHttpServer()).get(`/api/boards/${BOARD}/members`).expect(401);
    await request(app.getHttpServer()).post(`/api/boards/${BOARD}/members`).send({}).expect(401);

    expect(upstream.requests).toBe(0);
  });

  it('is 404 for a board the backend does not show the caller', async () => {
    await api().get(`/api/boards/${randomUUID()}/members`).expect(404);
  });

  it('is 404 for ids that are not UUIDs, without asking the backend', async () => {
    await api().get('/api/boards/not-a-uuid/members').expect(404);
    await api()
      .patch(`/api/boards/${BOARD}/members/not-a-uuid`)
      .send({ role: 'Viewer' })
      .expect(404);
    await api().delete(`/api/boards/${BOARD}/members/not-a-uuid`).expect(404);

    expect(upstream.requests).toBe(0);
  });

  it('is 400 for a body without a string email or role, without asking the backend', async () => {
    await api().post(`/api/boards/${BOARD}/members`).send({ role: 'Viewer' }).expect(400);
    await api().post(`/api/boards/${BOARD}/members`).send({ email: 'a@b.c' }).expect(400);
    await api().post(`/api/boards/${BOARD}/members`).send({ email: 5, role: 'Viewer' }).expect(400);
    await api().patch(`/api/boards/${BOARD}/members/${USER}`).send({}).expect(400);

    expect(upstream.requests).toBe(0);
  });

  it("passes the backend's refusals on with their message: unknown email (404), last owner and duplicates (409)", async () => {
    upstream.memberRefusal = { status: 404, detail: 'No user with this email has logged in yet.' };
    const unknown = await api()
      .post(`/api/boards/${BOARD}/members`)
      .send({ email: 'x@y.z', role: 'Viewer' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe('No user with this email has logged in yet.');

    upstream.memberRefusal = {
      status: 409,
      detail: 'The last owner cannot be removed or demoted.',
    };
    const lastOwner = await api().delete(`/api/boards/${BOARD}/members/${USER}`);
    expect(lastOwner.status).toBe(409);
    expect(lastOwner.body.message).toBe('The last owner cannot be removed or demoted.');
  });

  it("passes the backend's 403 on: a lower role may not manage members", async () => {
    upstream.memberRefusal = { status: 403, detail: '' };

    await api().get(`/api/boards/${BOARD}/members`).expect(403);
  });
});
