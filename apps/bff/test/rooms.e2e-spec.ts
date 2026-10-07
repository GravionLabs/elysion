import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

const USER = '0197a8d2-1c3e-7a10-8000-0000000000aa';

describe('Rooms (e2e, against a fake business backend)', () => {
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

  const newRoom = async (name = 'Sprint') => (await api().post('/api/rooms').send({ name })).body;
  const newBoard = async (name = 'Retro') => (await api().post('/api/boards').send({ name })).body;

  describe('/api/rooms', () => {
    it('creates a room, lists it and renames it', async () => {
      const created = await api().post('/api/rooms').send({ name: ' Sprint ' }).expect(201);
      expect(created.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: 'Sprint',
        createdAt: expect.any(String),
        role: 'Owner',
      });

      expect((await api().get('/api/rooms').expect(200)).body).toEqual([created.body]);

      const renamed = await api().patch(`/api/rooms/${created.body.id}`).send({ name: 'New' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('New');
    });

    it('deletes a room; its boards stay and leave it', async () => {
      const room = await newRoom();
      const board = await newBoard();
      await api().put(`/api/boards/${board.id}/room`).send({ roomId: room.id }).expect(200);

      await api().delete(`/api/rooms/${room.id}`).expect(204);

      expect((await api().get('/api/rooms')).body).toEqual([]);
      expect((await api().get(`/api/boards/${board.id}`).expect(200)).body.roomId).toBeNull();
    });

    it("forwards the caller's access token on every call", async () => {
      const room = await newRoom();
      await api().get('/api/rooms');
      await api().patch(`/api/rooms/${room.id}`).send({ name: 'x' });
      await api().delete(`/api/rooms/${room.id}`);

      expect(upstream.authorizations).toHaveLength(4);
      expect(new Set(upstream.authorizations)).toEqual(new Set([authorization]));
    });

    it('does not call the backend at all without a token', async () => {
      const server = app.getHttpServer();
      await request(server).get('/api/rooms').expect(401);
      await request(server).post('/api/rooms').send({ name: 'x' }).expect(401);
      await request(server)
        .put(`/api/boards/${randomUUID()}/room`)
        .send({ roomId: null })
        .expect(401);
      await request(server).get(`/api/rooms/${randomUUID()}/members`).expect(401);

      expect(upstream.requests).toBe(0);
    });

    it("answers 400 with the backend's message for a name it refuses, and without asking for a missing one", async () => {
      const refused = await api().post('/api/rooms').send({ name: '   ' }).expect(400);
      expect(refused.body.message).toContain('between 1 and 120');

      const before = upstream.requests;
      await api().post('/api/rooms').send({}).expect(400);
      await api().patch(`/api/rooms/${randomUUID()}`).send({ name: 5 }).expect(400);
      expect(upstream.requests).toBe(before);
    });

    it('answers 404 for an unknown room, and for an id that cannot exist without asking the backend', async () => {
      await api().patch(`/api/rooms/${randomUUID()}`).send({ name: 'x' }).expect(404);
      await api().delete(`/api/rooms/${randomUUID()}`).expect(404);

      const before = upstream.requests;
      await api().patch('/api/rooms/not-a-uuid').send({ name: 'x' }).expect(404);
      await api().delete('/api/rooms/not-a-uuid').expect(404);
      expect(upstream.requests).toBe(before);
    });

    it("passes the backend's refusals on: 403 for a role that is too low, 404 for a room that is not visible", async () => {
      upstream.roomRefusal = { status: 403, detail: 'Your role in this room does not allow that.' };
      await api().patch(`/api/rooms/${randomUUID()}`).send({ name: 'x' }).expect(403);
      await api().delete(`/api/rooms/${randomUUID()}`).expect(403);

      upstream.roomRefusal = { status: 404, detail: 'No such room.' };
      await api().patch(`/api/rooms/${randomUUID()}`).send({ name: 'x' }).expect(404);
    });

    it('answers 502 when the backend is not reachable', async () => {
      await upstream.stop();

      await api().get('/api/rooms').expect(502);
      await api().post('/api/rooms').send({ name: 'x' }).expect(502);
    });
  });

  describe('PUT /api/boards/:id/room', () => {
    it('puts a board in a room and the board list carries its roomId', async () => {
      const room = await newRoom();
      const board = await newBoard();

      const { body } = await api()
        .put(`/api/boards/${board.id}/room`)
        .send({ roomId: room.id })
        .expect(200);

      expect(body).toMatchObject({ id: board.id, roomId: room.id, path: `/board/${board.id}` });
      expect(upstream.lastRoomRequest).toMatchObject({
        method: 'PUT',
        path: `/boards/${board.id}/room`,
        body: { roomId: room.id },
      });
      const listed = (await api().get('/api/boards')).body as Array<{ id: string; roomId: string }>;
      expect(listed.find((b) => b.id === board.id)!.roomId).toBe(room.id);
    });

    it('takes a board out of its room with a null room', async () => {
      const room = await newRoom();
      const board = await newBoard();
      await api().put(`/api/boards/${board.id}/room`).send({ roomId: room.id });

      const { body } = await api()
        .put(`/api/boards/${board.id}/room`)
        .send({ roomId: null })
        .expect(200);

      expect(body.roomId).toBeNull();
    });

    it('answers 400 for a body that names no room or null, and 404 without asking for ids that cannot exist', async () => {
      const board = await newBoard();
      await api().put(`/api/boards/${board.id}/room`).send({}).expect(400);
      await api().put(`/api/boards/${board.id}/room`).send({ roomId: 7 }).expect(400);

      const before = upstream.requests;
      await api().put(`/api/boards/${board.id}/room`).send({ roomId: 'nope' }).expect(404);
      await api().put('/api/boards/not-a-uuid/room').send({ roomId: null }).expect(404);
      expect(upstream.requests).toBe(before);
    });

    it("passes the backend's answers on: 404 for a room the caller has no role in, 403 for a viewer", async () => {
      const board = await newBoard();
      await api().put(`/api/boards/${board.id}/room`).send({ roomId: randomUUID() }).expect(404);

      upstream.roomRefusal = { status: 403, detail: 'Your role in this room does not allow it.' };
      await api().put(`/api/boards/${board.id}/room`).send({ roomId: randomUUID() }).expect(403);
    });
  });

  describe('/api/rooms/:id/members', () => {
    let room: string;

    beforeEach(() => {
      room = randomUUID();
      upstream.roomMembers.set(room, [
        { userId: USER, displayName: 'Ada', email: 'ada@example.com', role: 'Owner' },
      ]);
    });

    it("lists, adds, changes and removes members, with the caller's token", async () => {
      const list = await api().get(`/api/rooms/${room}/members`).expect(200);
      expect(list.body).toHaveLength(1);

      const added = await api()
        .post(`/api/rooms/${room}/members`)
        .send({ email: 'bea@example.com', role: 'Viewer' })
        .expect(201);
      expect(added.body).toMatchObject({ email: 'bea@example.com', role: 'Viewer' });
      expect(upstream.lastRoomRequest).toMatchObject({
        method: 'POST',
        path: `/rooms/${room}/members`,
        body: { email: 'bea@example.com', role: 'Viewer' },
      });

      await api()
        .patch(`/api/rooms/${room}/members/${added.body.userId}`)
        .send({ role: 'Editor' })
        .expect(200);
      expect(upstream.roomMembers.get(room)![1].role).toBe('Editor');

      await api().delete(`/api/rooms/${room}/members/${added.body.userId}`).expect(204);
      expect(upstream.roomMembers.get(room)).toHaveLength(1);
      expect(new Set(upstream.authorizations)).toEqual(new Set([authorization]));
    });

    it('answers 400 for a body without email or role, without asking the backend', async () => {
      const before = upstream.requests;
      await api().post(`/api/rooms/${room}/members`).send({ role: 'Viewer' }).expect(400);
      await api().post(`/api/rooms/${room}/members`).send({ email: 'a@b.c' }).expect(400);
      await api().patch(`/api/rooms/${room}/members/${USER}`).send({}).expect(400);

      expect(upstream.requests).toBe(before);
    });

    it('answers 404 for a room that is not visible and for ids that cannot exist', async () => {
      await api().get(`/api/rooms/${randomUUID()}/members`).expect(404);

      const before = upstream.requests;
      await api().get('/api/rooms/not-a-uuid/members').expect(404);
      await api().delete(`/api/rooms/${room}/members/not-a-uuid`).expect(404);
      expect(upstream.requests).toBe(before);
    });

    it("passes the backend's refusals on with its message", async () => {
      upstream.roomRefusal = { status: 409, detail: 'A room needs at least one owner.' };

      const { body } = await api().delete(`/api/rooms/${room}/members/${USER}`).expect(409);

      expect(body.message).toBe('A room needs at least one owner.');
    });
  });
});
