import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { applyHttpLimits } from '../src/http-limits.js';
import { PublicRateLimiter } from '../src/public-api/rate-limit.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { expectContract } from './openapi-contract.js';
import { bearer, testVerifier } from './test-auth.js';

/** A personal access token per set of scopes; the fake backend resolves each to Ada. */
const READ = `elp_${'r'.repeat(43)}`;
const WRITE = `elp_${'w'.repeat(43)}`;
const MEMBERS = `elp_${'m'.repeat(43)}`;
const SNAPSHOTS = `elp_${'s'.repeat(43)}`;
const ALL = `elp_${'a'.repeat(43)}`;
const SCOPES: Record<string, string[]> = {
  [READ]: ['boards:read'],
  [WRITE]: ['boards:write'],
  [MEMBERS]: ['members:write'],
  [SNAPSHOTS]: ['snapshots:write'],
  [ALL]: ['boards:read', 'boards:write', 'members:write', 'snapshots:write'],
};

const PROBLEM = /^application\/problem\+json/;
const ROOM_ID = '0192f7a4-7a11-7d42-8e60-3b5c7d9e1f20';
const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';

function stateOf(elements: Array<Record<string, unknown>>, files: Record<string, unknown> = {}) {
  const doc = new Y.Doc();
  for (const element of elements) doc.getMap<unknown>('elements').set(String(element.id), element);
  for (const [id, file] of Object.entries(files)) doc.getMap<unknown>('files').set(id, file);
  return Y.encodeStateAsUpdate(doc);
}

describe('the public REST API v1 (e2e, ADR 0033, #852)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;

  const start = async (limit = 10_000) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TokenVerifier)
      .useValue(testVerifier())
      .overrideProvider(PublicRateLimiter)
      .useValue(new PublicRateLimiter({ limit }))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    applyHttpLimits(app as NestExpressApplication); // as main.ts does: the public API's own body parser
    await app.init();
  };

  beforeEach(async () => {
    upstream = new FakeBusinessBackend();
    await upstream.start();
    process.env.BUSINESS_BACKEND_URL = upstream.url;
    for (const [token, scopes] of Object.entries(SCOPES)) {
      upstream.credentials.set(token, {
        status: 200,
        body: {
          userId: '11111111-1111-4111-8111-111111111111',
          displayName: 'Ada',
          kind: 'person',
          tokenId: `22222222-2222-4222-8222-${token.charCodeAt(4).toString(16).padStart(12, '0')}`,
          scopes,
        },
      });
    }
    await start();
  });

  afterEach(async () => {
    await app.close();
    await upstream.stop();
    delete process.env.BUSINESS_BACKEND_URL;
  });

  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token?: string) => {
    const pending = request(app.getHttpServer())[method](path);
    return token === undefined ? pending : pending.set('Authorization', `Bearer ${token}`);
  };

  const board = (name: string, createdAt: string, roomId: string | null = null) => {
    const value = { id: randomUUID(), name, createdAt, roomId };
    upstream.boards.set(value.id, value);
    return value;
  };

  describe('boards', () => {
    it('lists the boards newest first, a page at a time, with a cursor to the next page', async () => {
      const old = board('Old', '2026-10-01T10:00:00Z');
      const middle = board('Middle', '2026-10-02T10:00:00Z');
      const newest = board('Newest', '2026-10-03T10:00:00Z');

      const first = await call('get', '/public/v1/boards?limit=2', READ).expect(200);
      const second = await call(
        'get',
        `/public/v1/boards?limit=2&cursor=${first.body.next}`,
        READ,
      ).expect(200);

      expect(first.body.items.map((b: { id: string }) => b.id)).toEqual([newest.id, middle.id]);
      expect(first.body.items[0]).toEqual({
        id: newest.id,
        name: 'Newest',
        createdAt: '2026-10-03T10:00:00Z',
        roomId: null,
      });
      expect(second.body).toEqual({ items: [{ ...old }], next: null });
      expectContract('get', '/public/v1/boards', first);
    });

    it('lists only the boards of a room with roomId', async () => {
      const inRoom = board('In the room', '2026-10-01T10:00:00Z', ROOM_ID);
      board('Elsewhere', '2026-10-02T10:00:00Z');

      const { body } = await call('get', `/public/v1/boards?roomId=${ROOM_ID}`, READ).expect(200);

      expect(body.items.map((b: { id: string }) => b.id)).toEqual([inRoom.id]);
    });

    it('refuses a bad limit, cursor or roomId as problem details (400)', async () => {
      for (const query of ['limit=0', 'limit=201', 'limit=x', 'cursor=bogus', 'roomId=nope']) {
        const response = await call('get', `/public/v1/boards?${query}`, READ).expect(400);
        expect(response.headers['content-type']).toMatch(PROBLEM);
        expect(response.body).toMatchObject({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
        });
        expectContract('get', '/public/v1/boards', response);
      }
    });

    it('reads a board with its ETag, and answers a foreign or unknown one 404 like the browser', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');

      const found = await call('get', `/public/v1/boards/${retro.id}`, READ).expect(200);
      const foreign = await call('get', `/public/v1/boards/${randomUUID()}`, READ).expect(404);
      await call('get', '/public/v1/boards/not-a-uuid', READ).expect(404);

      expect(found.headers.etag).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
      expect(found.body).toEqual(retro);
      expect(foreign.headers['content-type']).toMatch(PROBLEM);
      expect(foreign.body).toEqual({ type: 'about:blank', title: 'Not Found', status: 404 });
      expectContract('get', '/public/v1/boards/{id}', found);
      expectContract('get', '/public/v1/boards/{id}', foreign);
    });

    it('creates a board (boards:write) with its address and ETag', async () => {
      const response = await call('post', '/public/v1/boards', WRITE)
        .send({ name: 'From a script' })
        .expect(201);

      expect(response.body).toMatchObject({ name: 'From a script', roomId: null });
      expect(response.headers.location).toBe(`/public/v1/boards/${response.body.id}`);
      expect(response.headers.etag).toBeDefined();
      expect(upstream.boards.has(response.body.id)).toBe(true);
      expectContract('post', '/public/v1/boards', response);
    });

    it('refuses to create without boards:write (403), and a body without a name (400)', async () => {
      const refused = await call('post', '/public/v1/boards', READ).send({ name: 'x' }).expect(403);
      const invalid = await call('post', '/public/v1/boards', WRITE)
        .send({ title: 'x' })
        .expect(400);
      const backendRule = await call('post', '/public/v1/boards', WRITE)
        .send({ name: '' })
        .expect(400);

      expect(refused.body.detail).toBe('This needs a token with the scope "boards:write".');
      expect(invalid.body.detail).toBe('A board needs a name, as text.');
      expect(backendRule.body.detail).toBe('The name must be between 1 and 120 characters.');
      expect(upstream.boards.size).toBe(0);
      expectContract('post', '/public/v1/boards', refused);
      expectContract('post', '/public/v1/boards', invalid);
    });

    it('answers malformed JSON and a body over 1 MiB as problem details', async () => {
      const malformed = await call('post', '/public/v1/boards', WRITE)
        .set('Content-Type', 'application/json')
        .send('{"name":')
        .expect(400);
      const large = await call('post', '/public/v1/boards', WRITE)
        .send({ name: 'x'.repeat(1024 * 1024 + 1) })
        .expect(413);

      expect(malformed.headers['content-type']).toMatch(PROBLEM);
      expect(malformed.body).toMatchObject({ status: 400, detail: 'The body is not valid JSON.' });
      expect(large.body).toMatchObject({ status: 413, detail: 'The body is larger than 1 MiB.' });
    });

    describe('rename', () => {
      it('needs If-Match with the ETag as read (428 without, 412 for an old one)', async () => {
        const retro = board('Retro', '2026-10-01T10:00:00Z');
        const { headers } = await call('get', `/public/v1/boards/${retro.id}`, READ).expect(200);

        const missing = await call('patch', `/public/v1/boards/${retro.id}`, WRITE)
          .send({ name: 'A' })
          .expect(428);
        const renamed = await call('patch', `/public/v1/boards/${retro.id}`, WRITE)
          .set('If-Match', headers.etag)
          .send({ name: 'Retro (done)' })
          .expect(200);
        const stale = await call('patch', `/public/v1/boards/${retro.id}`, WRITE)
          .set('If-Match', headers.etag)
          .send({ name: 'Lost update' })
          .expect(412);

        expect(missing.body.status).toBe(428);
        expect(renamed.body.name).toBe('Retro (done)');
        expect(renamed.headers.etag).not.toBe(headers.etag);
        expect(stale.body.detail).toBe('The board changed since it was read: read it again.');
        expect(upstream.boards.get(retro.id)!.name).toBe('Retro (done)');
        expectContract('patch', '/public/v1/boards/{id}', renamed);
        expectContract('patch', '/public/v1/boards/{id}', missing);
        expectContract('patch', '/public/v1/boards/{id}', stale);
      });

      it('takes If-Match: * and a list that names the ETag', async () => {
        const retro = board('Retro', '2026-10-01T10:00:00Z');

        const any = await call('patch', `/public/v1/boards/${retro.id}`, WRITE)
          .set('If-Match', '*')
          .send({ name: 'Any' })
          .expect(200);
        await call('patch', `/public/v1/boards/${retro.id}`, WRITE)
          .set('If-Match', `"old", ${any.headers.etag}`)
          .send({ name: 'Listed' })
          .expect(200);
      });

      it('is 404 for a foreign board, before any change', async () => {
        await call('patch', `/public/v1/boards/${randomUUID()}`, WRITE)
          .set('If-Match', '*')
          .send({ name: 'x' })
          .expect(404);
      });
    });

    it('deletes a board (204) and duplicates one (201), with boards:write', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');

      const copy = await call('post', `/public/v1/boards/${retro.id}/duplicate`, WRITE).expect(201);
      const removed = await call('delete', `/public/v1/boards/${retro.id}`, WRITE).expect(204);
      await call('delete', `/public/v1/boards/${retro.id}`, READ).expect(403);
      await call('post', `/public/v1/boards/${randomUUID()}/duplicate`, WRITE).expect(404);

      expect(copy.body.name).toBe('Retro (copy)');
      expect(copy.headers.location).toBe(`/public/v1/boards/${copy.body.id}`);
      expect(upstream.boards.has(retro.id)).toBe(false);
      expectContract('post', '/public/v1/boards/{id}/duplicate', copy);
      expectContract('delete', '/public/v1/boards/{id}', removed);
    });
  });

  describe('elements', () => {
    it('are the live elements as an Excalidraw scene with images as links', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      upstream.documents.set(
        retro.id,
        stateOf(
          [
            { id: 'img', type: 'image', index: 'a1', fileId: 'f1', isDeleted: false },
            { id: 'note', type: 'rectangle', index: 'a0', isDeleted: false },
            { id: 'gone', type: 'text', index: 'a2', isDeleted: true },
          ],
          { f1: { mimeType: 'image/png', created: 1761902100000 } },
        ),
      );

      const response = await call('get', `/public/v1/boards/${retro.id}/elements`, READ).expect(
        200,
      );

      expect(response.body).toEqual({
        type: 'excalidraw',
        version: 2,
        source: 'elysion',
        elements: [
          { id: 'note', type: 'rectangle', index: 'a0', isDeleted: false },
          { id: 'img', type: 'image', index: 'a1', fileId: 'f1', isDeleted: false },
        ],
        appState: {},
        files: {
          f1: {
            id: 'f1',
            mimeType: 'image/png',
            created: 1761902100000,
            url: `/public/v1/boards/${retro.id}/files/f1`,
          },
        },
      });
      expectContract('get', '/public/v1/boards/{id}/elements', response);
    });

    it('of a board never saved are an empty scene; of a foreign board 404', async () => {
      const empty = board('Empty', '2026-10-01T10:00:00Z');

      const { body } = await call('get', `/public/v1/boards/${empty.id}/elements`, READ).expect(
        200,
      );
      await call('get', `/public/v1/boards/${randomUUID()}/elements`, READ).expect(404);

      expect(body.elements).toEqual([]);
      expect(body.files).toEqual({});
    });

    it('need boards:read', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      await call('get', `/public/v1/boards/${retro.id}/elements`, WRITE).expect(403);
    });

    it('link to files the API serves; a file id that cannot exist never reaches the backend', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      upstream.files.set(`${retro.id}/f1`, {
        contentType: 'image/png',
        bytes: Buffer.from([137, 80]),
      });

      const file = await call('get', `/public/v1/boards/${retro.id}/files/f1`, READ).expect(200);
      const before = upstream.requests;
      await call('get', `/public/v1/boards/${retro.id}/files/..%2Fdocument`, READ).expect(404);

      expect(file.headers['content-type']).toBe('image/png');
      expect(file.body).toEqual(Buffer.from([137, 80]));
      expect(file.headers['x-internal']).toBeUndefined();
      expect(upstream.requests).toBe(before); // the credential was remembered: no call at all
      expectContract('get', '/public/v1/boards/{id}/files/{fileId}', file);
    });
  });

  describe('members', () => {
    const member = (userId: string, role: string) => ({
      userId,
      displayName: userId === USER_A ? 'Ada' : 'Bob',
      email: null,
      role,
    });

    it('of a board are listed by user id a page at a time (boards:read)', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      upstream.members.set(retro.id, [member(USER_B, 'Viewer'), member(USER_A, 'Owner')]);

      const first = await call('get', `/public/v1/boards/${retro.id}/members?limit=1`, READ).expect(
        200,
      );
      const second = await call(
        'get',
        `/public/v1/boards/${retro.id}/members?limit=1&cursor=${first.body.next}`,
        READ,
      ).expect(200);

      expect(first.body.items).toEqual([member(USER_A, 'Owner')]);
      expect(second.body).toEqual({ items: [member(USER_B, 'Viewer')], next: null });
      expectContract('get', '/public/v1/boards/{id}/members', first);
    });

    it('of a board are added, changed and removed with members:write, and not with boards:write', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      upstream.members.set(retro.id, [member(USER_A, 'Owner')]);
      const path = `/public/v1/boards/${retro.id}/members`;

      await call('post', path, WRITE)
        .send({ email: 'bob@example.com', role: 'Editor' })
        .expect(403);
      const added = await call('post', path, MEMBERS)
        .send({ email: 'bob@example.com', role: 'Editor' })
        .expect(201);
      const changed = await call('patch', `${path}/${added.body.userId}`, MEMBERS)
        .send({ role: 'Viewer' })
        .expect(200);
      const removed = await call('delete', `${path}/${added.body.userId}`, MEMBERS).expect(204);
      const invalid = await call('post', path, MEMBERS).send({ role: 'Editor' }).expect(400);

      expect(added.body).toMatchObject({ email: 'bob@example.com', role: 'Editor' });
      expect(changed.body.role).toBe('Viewer');
      expect(upstream.members.get(retro.id)).toHaveLength(1);
      expect(invalid.body.detail).toBe('A member needs an email or a userId.');
      expectContract('post', '/public/v1/boards/{id}/members', added);
      expectContract('patch', '/public/v1/boards/{id}/members/{userId}', changed);
      expectContract('delete', '/public/v1/boards/{id}/members/{userId}', removed);
    });

    it("keep the backend's rules and messages (409 for the last owner)", async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      upstream.members.set(retro.id, [member(USER_A, 'Owner')]);
      upstream.memberRefusal = { status: 409, detail: 'A board needs an owner.' };

      const response = await call(
        'delete',
        `/public/v1/boards/${retro.id}/members/${USER_A}`,
        MEMBERS,
      ).expect(409);

      expect(response.body).toEqual({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'A board needs an owner.',
      });
      expectContract('delete', '/public/v1/boards/{id}/members/{userId}', response);
    });

    it('of a room work the same way', async () => {
      upstream.rooms.set(ROOM_ID, {
        id: ROOM_ID,
        name: 'Team',
        createdAt: '2026-09-01T08:00:00Z',
        role: 'Owner',
      });
      upstream.roomMembers.set(ROOM_ID, [member(USER_A, 'Owner')]);
      const path = `/public/v1/rooms/${ROOM_ID}/members`;

      const list = await call('get', path, READ).expect(200);
      const added = await call('post', path, MEMBERS)
        .send({ email: 'bob@example.com', role: 'Viewer' })
        .expect(201);
      await call('patch', `${path}/${added.body.userId}`, MEMBERS)
        .send({ role: 'Editor' })
        .expect(200);
      await call('delete', `${path}/${added.body.userId}`, MEMBERS).expect(204);
      await call('get', `/public/v1/rooms/${randomUUID()}/members`, READ).expect(404);
      await call('post', path, READ).send({ email: 'x@example.com', role: 'Viewer' }).expect(403);

      expect(list.body.items).toEqual([member(USER_A, 'Owner')]);
      expectContract('get', '/public/v1/rooms/{id}/members', list);
      expectContract('post', '/public/v1/rooms/{id}/members', added);
    });
  });

  describe('rooms', () => {
    it('are listed newest first and read one by one; a room without a role is 404', async () => {
      upstream.rooms.set(ROOM_ID, {
        id: ROOM_ID,
        name: 'Team',
        createdAt: '2026-09-01T08:00:00Z',
        role: 'Editor',
      });
      const newer = randomUUID();
      upstream.rooms.set(newer, {
        id: newer,
        name: 'Newer',
        createdAt: '2026-09-02T08:00:00Z',
        role: 'Viewer',
      });

      const list = await call('get', '/public/v1/rooms', READ).expect(200);
      const one = await call('get', `/public/v1/rooms/${ROOM_ID}`, READ).expect(200);
      const foreign = await call('get', `/public/v1/rooms/${randomUUID()}`, READ).expect(404);
      await call('get', '/public/v1/rooms', WRITE).expect(403);

      expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([newer, ROOM_ID]);
      expect(one.body).toEqual({
        id: ROOM_ID,
        name: 'Team',
        createdAt: '2026-09-01T08:00:00Z',
        role: 'Editor',
      });
      expectContract('get', '/public/v1/rooms', list);
      expectContract('get', '/public/v1/rooms/{id}', one);
      expectContract('get', '/public/v1/rooms/{id}', foreign);
    });
  });

  describe('snapshots', () => {
    const snapshot = (id: string, createdAt: string) => ({
      id,
      kind: 'Manual',
      name: 'Before',
      author: 'Ada',
      createdAt,
      sizeBytes: 120,
      elementCount: 1,
    });

    it('are listed newest first (boards:read)', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      const older = snapshot(randomUUID(), '2026-10-01T11:00:00Z');
      const newer = snapshot(randomUUID(), '2026-10-01T12:00:00Z');
      upstream.snapshotAnswer = { status: 200, body: [older, newer] };

      const response = await call('get', `/public/v1/boards/${retro.id}/snapshots`, READ).expect(
        200,
      );

      expect(response.body).toEqual({ items: [newer, older], next: null });
      expectContract('get', '/public/v1/boards/{id}/snapshots', response);
    });

    it('are saved with snapshots:write, with a name or without', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      const saved = snapshot(randomUUID(), '2026-10-01T11:00:00Z');
      upstream.snapshotAnswer = { status: 201, body: saved };

      await call('post', `/public/v1/boards/${retro.id}/snapshots`, READ)
        .send({ name: 'x' })
        .expect(403);
      const response = await call('post', `/public/v1/boards/${retro.id}/snapshots`, SNAPSHOTS)
        .send({ name: 'Before' })
        .expect(201);
      await call('post', `/public/v1/boards/${retro.id}/snapshots`, SNAPSHOTS)
        .send({ name: 3 })
        .expect(400);

      expect(response.body).toEqual(saved);
      expect(response.headers.location).toBe(`/public/v1/boards/${retro.id}/snapshots/${saved.id}`);
      expect(upstream.lastSnapshotRequest?.body).toEqual({ name: 'Before' });
      expectContract('post', '/public/v1/boards/{id}/snapshots', response);
    });

    it('is read as JSON: the version with its scene, decoded from the stored state', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      const kept = snapshot(randomUUID(), '2026-10-01T11:00:00Z');
      upstream.snapshotAnswer = { status: 200, body: [kept] };
      upstream.snapshotDocument = Buffer.from(
        stateOf([{ id: 'n', type: 'text', index: 'a0', text: 'Hi' }]),
      );

      const response = await call(
        'get',
        `/public/v1/boards/${retro.id}/snapshots/${kept.id}`,
        READ,
      ).expect(200);
      await call('get', `/public/v1/boards/${retro.id}/snapshots/${randomUUID()}`, READ).expect(
        404,
      );

      expect(response.body).toEqual({
        ...kept,
        scene: {
          type: 'excalidraw',
          version: 2,
          source: 'elysion',
          elements: [{ id: 'n', type: 'text', index: 'a0', text: 'Hi' }],
          appState: {},
          files: {},
        },
      });
      expectContract('get', '/public/v1/boards/{id}/snapshots/{snapshotId}', response);
    });

    it('has no rename, delete, restore or copy in v1', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      const id = randomUUID();
      const path = `/public/v1/boards/${retro.id}/snapshots/${id}`;

      for (const [method, url] of [
        ['patch', path],
        ['delete', path],
        ['post', `${path}/restore`],
        ['post', `${path}/copy`],
      ] as const) {
        const response = await call(method, url, ALL).expect(404);
        expect(response.headers['content-type']).toMatch(PROBLEM);
      }
    });
  });

  describe('every route', () => {
    const routes = (id: string) => [
      `/public/v1/boards`,
      `/public/v1/boards/${id}`,
      `/public/v1/boards/${id}/elements`,
      `/public/v1/boards/${id}/members`,
      `/public/v1/boards/${id}/snapshots`,
      `/public/v1/rooms`,
    ];

    it('passes the token on to the backend, so a revoke the guard has not seen yet is refused at once (401)', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      upstream.members.set(retro.id, []);
      upstream.snapshotAnswer = { status: 200, body: [] };
      for (const path of routes(retro.id)) await call('get', path, READ).expect(200);

      upstream.revoked.add(READ); // the guard's 30-second cache still knows the token as valid

      for (const path of routes(retro.id)) {
        const response = await call('get', path, READ).expect(401);
        expect(response.headers['content-type']).toMatch(PROBLEM);
      }
      expect(upstream.credentialCalls).toBe(1);
    });

    it("refuses a token without the route's scope (403 as problem details) before the backend is asked", async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      upstream.members.set(retro.id, [
        { userId: USER_A, displayName: 'Ada', email: null, role: 'Owner' },
      ]);
      const b = `/public/v1/boards/${retro.id}`;
      const r = `/public/v1/rooms/${ROOM_ID}`;
      const snapshotId = randomUUID();
      const scoped: Array<
        [method: 'get' | 'post' | 'patch' | 'delete', path: string, token: string, scope: string]
      > = [
        ['get', '/public/v1/boards', WRITE, 'boards:read'],
        ['post', '/public/v1/boards', READ, 'boards:write'],
        ['get', b, WRITE, 'boards:read'],
        ['patch', b, READ, 'boards:write'],
        ['delete', b, READ, 'boards:write'],
        ['post', `${b}/duplicate`, READ, 'boards:write'],
        ['get', `${b}/elements`, WRITE, 'boards:read'],
        ['get', `${b}/files/f1`, WRITE, 'boards:read'],
        ['get', `${b}/members`, WRITE, 'boards:read'],
        ['post', `${b}/members`, WRITE, 'members:write'],
        ['patch', `${b}/members/${USER_A}`, WRITE, 'members:write'],
        ['delete', `${b}/members/${USER_A}`, WRITE, 'members:write'],
        ['get', `${b}/snapshots`, WRITE, 'boards:read'],
        ['post', `${b}/snapshots`, READ, 'snapshots:write'],
        ['get', `${b}/snapshots/${snapshotId}`, WRITE, 'boards:read'],
        ['get', '/public/v1/rooms', WRITE, 'boards:read'],
        ['get', r, WRITE, 'boards:read'],
        ['get', `${r}/members`, WRITE, 'boards:read'],
        ['post', `${r}/members`, READ, 'members:write'],
        ['patch', `${r}/members/${USER_A}`, READ, 'members:write'],
        ['delete', `${r}/members/${USER_A}`, READ, 'members:write'],
      ];
      const requests = upstream.requests;
      const credentialCalls = upstream.credentialCalls;

      for (const [method, path, token, scope] of scoped) {
        const response = await call(method, path, token)
          .set('If-Match', '*')
          .send({ name: 'x', email: 'bob@example.com', role: 'Editor' })
          .expect(403);
        expect(response.headers['content-type'], `${method} ${path}`).toMatch(PROBLEM);
        expect(response.body, `${method} ${path}`).toEqual({
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: `This needs a token with the scope "${scope}".`,
        });
      }

      // Only the credentials were resolved: no route of the backend was called.
      expect(upstream.requests - requests).toBe(upstream.credentialCalls - credentialCalls);
      expect(upstream.boards.get(retro.id)!.name).toBe('Retro');
      expect(upstream.boards.size).toBe(1);
      expect(upstream.members.get(retro.id)).toHaveLength(1);
    });

    it('answers a board the caller has no role on 404 as problem details on every board route, and changes nothing', async () => {
      const own = board('Own', '2026-10-01T10:00:00Z');
      const foreign = `/public/v1/boards/${randomUUID()}`;
      const foreignRoom = `/public/v1/rooms/${randomUUID()}`;
      // The backend answers a non-member's snapshot calls 404, as every board route (ADR 0032).
      upstream.snapshotAnswer = { status: 404 };
      const routes: Array<[method: 'get' | 'post' | 'patch' | 'delete', path: string]> = [
        ['get', foreign],
        ['patch', foreign],
        ['delete', foreign],
        ['post', `${foreign}/duplicate`],
        ['get', `${foreign}/elements`],
        ['get', `${foreign}/files/f1`],
        ['get', `${foreign}/members`],
        ['post', `${foreign}/members`],
        ['patch', `${foreign}/members/${USER_A}`],
        ['delete', `${foreign}/members/${USER_A}`],
        ['get', `${foreign}/snapshots`],
        ['post', `${foreign}/snapshots`],
        ['get', `${foreign}/snapshots/${randomUUID()}`],
        ['get', foreignRoom],
        ['get', `${foreignRoom}/members`],
        ['post', `${foreignRoom}/members`],
        ['patch', `${foreignRoom}/members/${USER_A}`],
        ['delete', `${foreignRoom}/members/${USER_A}`],
      ];

      for (const [method, path] of routes) {
        const response = await call(method, path, ALL)
          .set('If-Match', '*')
          .send({ name: 'x', email: 'bob@example.com', role: 'Editor' })
          .expect(404);
        expect(response.headers['content-type'], `${method} ${path}`).toMatch(PROBLEM);
        expect(response.body, `${method} ${path}`).toEqual({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
        });
      }

      expect([...upstream.boards.values()]).toEqual([own]);
      expect(upstream.members.size).toBe(0);
      expect(upstream.roomMembers.size).toBe(0);
    });

    it('needs a credential: 401 as problem details with WWW-Authenticate', async () => {
      const response = await call('get', '/public/v1/boards').expect(401);

      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.body).toEqual({ type: 'about:blank', title: 'Unauthorized', status: 401 });
      expectContract('get', '/public/v1/boards', response);
    });

    it("answers a path that does not exist as problem details, and leaves the browser routes' errors as they are", async () => {
      const unknown = await call('get', '/public/v1/nothing', READ).expect(404);
      const browser = await request(app.getHttpServer())
        .get(`/api/boards/${randomUUID()}`)
        .set('Authorization', await bearer())
        .expect(404);

      expect(unknown.headers['content-type']).toMatch(PROBLEM);
      expect(browser.headers['content-type']).toMatch(/^application\/json/);
      expect(browser.body).toMatchObject({ statusCode: 404 });
    });

    it('sends no CORS headers, also when asked from a browser origin', async () => {
      const response = await call('get', '/public/v1/boards', READ)
        .set('Origin', 'https://evil.example')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('is counted per route pattern and status in the metrics', async () => {
      const retro = board('Retro', '2026-10-01T10:00:00Z');
      await call('get', `/public/v1/boards/${retro.id}`, READ).expect(200);
      await call('get', `/public/v1/boards/${randomUUID()}`, READ).expect(404);

      const metrics = (await request(app.getHttpServer()).get('/metrics').expect(200)).text;

      expect(metrics).toContain(
        'elysion_bff_http_requests_total{method="GET",route="/public/v1/boards/:id",status_code="200"} 1',
      );
      expect(metrics).toContain(
        'elysion_bff_http_requests_total{method="GET",route="/public/v1/boards/:id",status_code="404"} 1',
      );
      expect(metrics).not.toContain(retro.id);
    });
  });

  describe('the rate limit', () => {
    beforeEach(async () => {
      await app.close();
      await start(3);
    });

    it('is announced on every answer and refuses the request over it (429, Retry-After)', async () => {
      const answers = [];
      for (let i = 0; i < 4; i += 1) answers.push(await call('get', '/public/v1/boards', READ));

      expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 429]);
      expect(answers[0]!.headers).toMatchObject({
        'ratelimit-limit': '3',
        'ratelimit-remaining': '2',
        'ratelimit-policy': '3;w=60',
      });
      expect(Number(answers[0]!.headers['ratelimit-reset'])).toBeGreaterThan(0);
      expect(answers[3]!.headers['retry-after']).toMatch(/^\d+$/);
      expect(answers[3]!.headers['content-type']).toMatch(PROBLEM);
      expect(answers[3]!.body.status).toBe(429);
      expectContract('get', '/public/v1/boards', answers[0]!);
      expectContract('get', '/public/v1/boards', answers[3]!);
    });

    it('counts each token on its own', async () => {
      for (let i = 0; i < 3; i += 1) await call('get', '/public/v1/boards', READ).expect(200);

      await call('get', '/public/v1/boards', READ).expect(429);
      await call('get', '/public/v1/boards', ALL).expect(200);
    });

    it("does not count the browser's routes", async () => {
      for (let i = 0; i < 5; i += 1) {
        const response = await request(app.getHttpServer())
          .get('/api/boards')
          .set('Authorization', await bearer())
          .expect(200);
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });
  });
});
