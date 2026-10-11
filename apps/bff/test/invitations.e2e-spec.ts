import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { LOG_STREAM } from '../src/logging/logging.module.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

describe('Invitation links (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let authorization: string;
  let raw: string[];
  const boardId = randomUUID();
  const roomId = randomUUID();
  const invitationId = randomUUID();
  const token = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo'.slice(0, 43);
  const link = {
    id: invitationId,
    token,
    url: null,
    role: 'Viewer',
    expiresAt: '2026-10-12T10:00:00Z',
    maxUses: null,
    uses: 0,
    createdAt: '2026-10-11T10:00:00Z',
  };

  beforeEach(async () => {
    raw = [];
    upstream = new FakeBusinessBackend();
    await upstream.start();
    process.env.BUSINESS_BACKEND_URL = upstream.url;
    const stream = new Writable({
      write(chunk, _encoding, done) {
        raw.push(String(chunk));
        done();
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TokenVerifier)
      .useValue(testVerifier())
      .overrideProvider(LOG_STREAM)
      .useValue(stream)
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

  it('makes, lists and revokes the links of a board', async () => {
    upstream.invitationAnswer = { status: 201, body: link };
    const created = await authed(api().post(`/api/boards/${boardId}/invitations`)).send({
      role: 'Viewer',
      expiresInHours: 24,
      maxUses: 3,
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual(link);
    expect(upstream.lastInvitationRequest).toEqual({
      method: 'POST',
      path: `/boards/${boardId}/invitations`,
      body: { role: 'Viewer', expiresInHours: 24, maxUses: 3 },
    });

    const { token: _secret, url: _url, ...listed } = link;
    upstream.invitationAnswer = { status: 200, body: [listed] };
    const list = await authed(api().get(`/api/boards/${boardId}/invitations`)).expect(200);
    expect(list.body).toEqual([listed]);

    upstream.invitationAnswer = { status: 204 };
    await authed(api().delete(`/api/boards/${boardId}/invitations/${invitationId}`)).expect(204);
    expect(upstream.lastInvitationRequest?.path).toBe(
      `/boards/${boardId}/invitations/${invitationId}`,
    );
  });

  it('does the same for a room', async () => {
    upstream.invitationAnswer = { status: 201, body: link };
    await authed(api().post(`/api/rooms/${roomId}/invitations`))
      .send({ role: 'Editor', expiresInHours: 1 })
      .expect(201);
    expect(upstream.lastInvitationRequest?.path).toBe(`/rooms/${roomId}/invitations`);
    upstream.invitationAnswer = { status: 200, body: [] };
    await authed(api().get(`/api/rooms/${roomId}/invitations`)).expect(200, []);
    upstream.invitationAnswer = { status: 204 };
    await authed(api().delete(`/api/rooms/${roomId}/invitations/${invitationId}`)).expect(204);
  });

  it('passes the refusals of the backend on', async () => {
    for (const status of [403, 404, 409]) {
      upstream.invitationAnswer = { status };
      await authed(api().post(`/api/boards/${boardId}/invitations`))
        .send({ role: 'Viewer', expiresInHours: 1 })
        .expect(status);
    }
  });

  it('refuses a body that is no object, and ids that are no UUIDs', async () => {
    await authed(api().post(`/api/boards/${boardId}/invitations`))
      .send([1])
      .expect(400);
    await authed(api().get('/api/boards/not-a-uuid/invitations')).expect(404);
    await authed(api().delete(`/api/boards/${boardId}/invitations/nope`)).expect(404);
  });

  it('follows a link and answers what the backend says, 410 included', async () => {
    const accepted = { kind: 'board', id: boardId, role: 'Viewer' };
    upstream.invitationAnswer = { status: 200, body: accepted };
    const response = await authed(api().post(`/api/invitations/${token}/accept`)).expect(200);
    expect(response.body).toEqual(accepted);
    expect(upstream.lastInvitationRequest?.path).toBe(`/invitations/${token}/accept`);

    upstream.invitationAnswer = { status: 410 };
    await authed(api().post(`/api/invitations/${token}/accept`)).expect(410);
    upstream.invitationAnswer = { status: 404 };
    await authed(api().post(`/api/invitations/${token}/accept`)).expect(404);
  });

  it('does not ask the backend about something that cannot be a token', async () => {
    upstream.lastInvitationRequest = null;

    await authed(api().post('/api/invitations/short/accept')).expect(404);

    expect(upstream.lastInvitationRequest).toBeNull();
  });

  it('needs a login', async () => {
    await api().post(`/api/invitations/${token}/accept`).expect(401);
  });

  it('never writes the token of a link into the log', async () => {
    upstream.invitationAnswer = {
      status: 200,
      body: { kind: 'board', id: boardId, role: 'Viewer' },
    };
    await authed(api().post(`/api/invitations/${token}/accept`)).expect(200);
    upstream.invitationAnswer = { status: 201, body: link };
    await authed(api().post(`/api/boards/${boardId}/invitations`))
      .send({ role: 'Viewer', expiresInHours: 1 })
      .expect(201);

    const output = raw.join('');
    expect(output).toContain('/api/invitations/:token/accept');
    expect(output).not.toContain(token);
  });
});
