import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

describe('Board snapshots (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let authorization: string;
  const boardId = randomUUID();
  const snapshotId = randomUUID();
  const snapshot = {
    id: snapshotId,
    kind: 'Manual',
    name: 'Before the workshop',
    author: 'Dev',
    createdAt: '2026-10-31T10:00:00Z',
    sizeBytes: 120,
    elementCount: null,
  };

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

  const api = () => request(app.getHttpServer());
  const authed = (req: request.Test) => req.set('Authorization', authorization);
  const base = `/api/boards/${boardId}/snapshots`;

  it('needs a token', async () => {
    await api().get(base).expect(401);
    await api().post(base).expect(401);
    await api().patch(`${base}/${snapshotId}`).expect(401);
    await api().delete(`${base}/${snapshotId}`).expect(401);
    await api().get(`${base}/${snapshotId}/document`).expect(401);
  });

  it('lists the versions the backend returns', async () => {
    upstream.snapshotAnswer = { status: 200, body: [snapshot] };

    const { body } = await authed(api().get(base)).expect(200);

    expect(body).toEqual([snapshot]);
    expect(upstream.lastSnapshotRequest).toMatchObject({
      method: 'GET',
      path: `/boards/${boardId}/snapshots`,
    });
  });

  it('saves a version with only a name, whatever else the browser sends', async () => {
    upstream.snapshotAnswer = { status: 201, body: snapshot };

    await authed(api().post(base)).send({ name: 'Before', state: 'AAAA' }).expect(201);

    expect(upstream.lastSnapshotRequest).toEqual({
      method: 'POST',
      path: `/boards/${boardId}/snapshots`,
      body: { name: 'Before' },
    });
  });

  it('saves a version without a name', async () => {
    upstream.snapshotAnswer = { status: 201, body: snapshot };

    await authed(api().post(base)).expect(201);

    expect(upstream.lastSnapshotRequest?.body).toEqual({});
  });

  it('refuses a name that is no text', async () => {
    await authed(api().post(base)).send({ name: 5 }).expect(400);
    await authed(api().post(base)).send('[1]').set('Content-Type', 'application/json').expect(400);
  });

  it('renames, and needs a name', async () => {
    upstream.snapshotAnswer = { status: 200, body: { ...snapshot, name: 'New' } };

    const { body } = await authed(api().patch(`${base}/${snapshotId}`))
      .send({ name: 'New' })
      .expect(200);

    expect(body.name).toBe('New');
    expect(upstream.lastSnapshotRequest).toEqual({
      method: 'PATCH',
      path: `/boards/${boardId}/snapshots/${snapshotId}`,
      body: { name: 'New' },
    });
    await authed(api().patch(`${base}/${snapshotId}`))
      .send({})
      .expect(400);
    await authed(api().patch(`${base}/${snapshotId}`)).expect(400);
  });

  it('deletes', async () => {
    upstream.snapshotAnswer = { status: 204 };

    await authed(api().delete(`${base}/${snapshotId}`)).expect(204);

    expect(upstream.lastSnapshotRequest).toMatchObject({
      method: 'DELETE',
      path: `/boards/${boardId}/snapshots/${snapshotId}`,
    });
  });

  it('streams the state of a version without the backend internal headers', async () => {
    upstream.snapshotAnswer = { status: 200, body: undefined };
    upstream.snapshotDocument = Buffer.from([9, 8, 7]);

    const response = await authed(api().get(`${base}/${snapshotId}/document`))
      .buffer(true)
      .parse((res, done) => {
        const parts: Buffer[] = [];
        res.on('data', (chunk: Buffer) => parts.push(chunk));
        res.on('end', () => done(null, Buffer.concat(parts)));
      })
      .expect(200);

    expect(response.body).toEqual(Buffer.from([9, 8, 7]));
    expect(response.headers['content-type']).toContain('application/octet-stream');
    expect(response.headers['x-internal']).toBeUndefined();
  });

  it.each([
    [403, 403],
    [404, 404],
    [409, 409],
    [400, 400],
    [503, 503],
    [500, 502],
  ])('passes the backend status %i on as %i', async (backend, bff) => {
    upstream.snapshotAnswer = { status: backend };

    await authed(api().post(base)).send({ name: 'x' }).expect(bff);
  });

  it('answers 404 for ids that are no UUIDs without asking the backend', async () => {
    await authed(api().get('/api/boards/not-a-uuid/snapshots')).expect(404);
    await authed(api().delete(`${base}/not-a-uuid`)).expect(404);
    expect(upstream.lastSnapshotRequest).toBeNull();
  });
});
