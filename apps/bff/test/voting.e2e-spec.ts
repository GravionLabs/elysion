import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

describe('Dot voting (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let authorization: string;
  const boardId = randomUUID();
  const votingId = randomUUID();
  const voting = {
    id: votingId,
    name: 'Priorities',
    votesPerPerson: 3,
    status: 'open',
    named: false,
    startedBy: { id: 'kc-sub-1', name: 'Dev' },
    startedAt: '2026-10-11T10:00:00Z',
    closedAt: null,
    myVotes: 1,
    myElementVotes: { e1: 1 },
    placed: { 'kc-sub-1': 1 },
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

  it('passes the current voting through, and a 204 when the board has none', async () => {
    upstream.votingAnswer = { status: 204 };
    await authed(api().get(`/api/boards/${boardId}/voting`)).expect(204);

    upstream.votingAnswer = { status: 200, body: voting };
    const { body } = await authed(api().get(`/api/boards/${boardId}/voting`)).expect(200);

    expect(body).toEqual(voting);
    expect(upstream.lastVotingRequest).toMatchObject({
      method: 'GET',
      path: `/boards/${boardId}/voting`,
    });
  });

  it('starts a voting with only the fields it knows', async () => {
    upstream.votingAnswer = { status: 201, body: voting };

    await authed(api().post(`/api/boards/${boardId}/votings`))
      .send({ name: 'Priorities', votesPerPerson: 3, named: true, evil: 'x' })
      .expect(201);

    expect(upstream.lastVotingRequest).toEqual({
      method: 'POST',
      path: `/boards/${boardId}/votings`,
      body: { name: 'Priorities', votesPerPerson: 3, named: true },
    });
  });

  it('refuses a start that is no object', async () => {
    await authed(api().post(`/api/boards/${boardId}/votings`))
      .send('[1]')
      .set('Content-Type', 'application/json')
      .expect(400);
  });

  it('casts a vote and takes one back', async () => {
    upstream.votingAnswer = { status: 200, body: voting };
    await authed(api().post(`/api/boards/${boardId}/votings/${votingId}/votes`))
      .send({ elementId: 'e1' })
      .expect(200);
    expect(upstream.lastVotingRequest?.body).toEqual({ elementId: 'e1' });

    await authed(api().delete(`/api/boards/${boardId}/votings/${votingId}/votes/e1`)).expect(200);
    expect(upstream.lastVotingRequest?.path).toBe(
      `/boards/${boardId}/votings/${votingId}/votes/e1`,
    );

    upstream.votingAnswer = { status: 204 };
    await authed(api().delete(`/api/boards/${boardId}/votings/${votingId}/votes/e2`)).expect(204);
  });

  it('needs an element id for a vote', async () => {
    await authed(api().post(`/api/boards/${boardId}/votings/${votingId}/votes`))
      .send({})
      .expect(400);
  });

  it('closes and clears', async () => {
    upstream.votingAnswer = { status: 200, body: { ...voting, status: 'closed' } };
    await authed(api().post(`/api/boards/${boardId}/votings/${votingId}/close`)).expect(200);

    upstream.votingAnswer = { status: 204 };
    await authed(api().delete(`/api/boards/${boardId}/votings`)).expect(204);
    expect(upstream.lastVotingRequest).toMatchObject({
      method: 'DELETE',
      path: `/boards/${boardId}/votings`,
    });
  });

  it("passes on the backend's refusals with their reason", async () => {
    upstream.votingAnswer = { status: 409, body: { detail: 'No votes left.' } };
    const { body } = await authed(api().post(`/api/boards/${boardId}/votings/${votingId}/votes`))
      .send({ elementId: 'e1' })
      .expect(409);
    expect(JSON.stringify(body)).toContain('No votes left.');

    upstream.votingAnswer = { status: 403 };
    await authed(api().post(`/api/boards/${boardId}/votings`))
      .send({ votesPerPerson: 1 })
      .expect(403);
  });

  it('answers 404 for ids that are no UUIDs without asking the backend', async () => {
    const before = upstream.requests;

    await authed(api().get('/api/boards/not-a-uuid/voting')).expect(404);
    await authed(api().post(`/api/boards/${boardId}/votings/nope/close`)).expect(404);

    expect(upstream.requests).toBe(before);
  });

  it('needs a login', async () => {
    await api().get(`/api/boards/${boardId}/voting`).expect(401);
  });
});
