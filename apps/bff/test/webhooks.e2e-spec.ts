import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { applyHttpLimits } from '../src/http-limits.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { expectContract } from './openapi-contract.js';
import { bearer, testVerifier } from './test-auth.js';

/** Personal access tokens: one with the webhook scope, one without. */
const HOOKS = `elp_${'h'.repeat(43)}`;
const READ = `elp_${'r'.repeat(43)}`;
const PROBLEM = /^application\/problem\+json/;
const SECRET = `whsec_${'s'.repeat(43)}`;

describe('webhooks in the shell and on the public API (e2e, #853)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let browser: string;
  let boardId: string;

  beforeEach(async () => {
    upstream = new FakeBusinessBackend();
    await upstream.start();
    process.env.BUSINESS_BACKEND_URL = upstream.url;
    for (const [token, scopes] of [
      [HOOKS, ['webhooks:write']],
      [READ, ['boards:read']],
    ] as const) {
      upstream.credentials.set(token, {
        status: 200,
        body: {
          userId: '11111111-1111-4111-8111-111111111111',
          displayName: 'Ada',
          kind: 'person',
          tokenId: randomUUID(),
          scopes,
        },
      });
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TokenVerifier)
      .useValue(testVerifier())
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    applyHttpLimits(app as NestExpressApplication);
    await app.init();
    browser = await bearer();
    boardId = randomUUID();
    upstream.boards.set(boardId, {
      id: boardId,
      name: 'Retro',
      createdAt: '2026-10-01T10:00:00Z',
      roomId: null,
    });
  });

  afterEach(async () => {
    await app.close();
    await upstream.stop();
    delete process.env.BUSINESS_BACKEND_URL;
  });

  const server = () => request(app.getHttpServer());

  describe('the shell (/api)', () => {
    it('registers a webhook for a board: the secret once, then never again', async () => {
      const created = await server()
        .post(`/api/boards/${boardId}/webhooks`)
        .set('Authorization', browser)
        .send({ url: 'https://hooks.example.com/elysion', events: ['board.renamed'], extra: 1 })
        .expect(201);

      expect(created.body).toMatchObject({
        boardId,
        url: 'https://hooks.example.com/elysion',
        events: ['board.renamed'],
        enabled: true,
        secret: SECRET,
        secretPrefix: SECRET.slice(0, 10),
      });
      expect(upstream.lastWebhookRequest).toEqual({
        method: 'POST',
        path: `/boards/${boardId}/webhooks`,
        body: { url: 'https://hooks.example.com/elysion', events: ['board.renamed'] },
      });
      expect(upstream.authorizations.at(-1)).toBe(browser);

      const listed = await server()
        .get(`/api/boards/${boardId}/webhooks`)
        .set('Authorization', browser)
        .expect(200);
      expect(listed.body).toHaveLength(1);
      expect(JSON.stringify(listed.body)).not.toContain(SECRET);
    });

    it('sends a test event, lists the deliveries and sends one again', async () => {
      const { body: webhook } = await server()
        .post(`/api/boards/${boardId}/webhooks`)
        .set('Authorization', browser)
        .send({ url: 'https://hooks.example.com/elysion' })
        .expect(201);
      const base = `/api/boards/${boardId}/webhooks/${webhook.id}`;

      const test = await server().post(`${base}/test`).set('Authorization', browser).expect(202);
      expect(test.body).toMatchObject({ eventType: 'webhook.test', status: 'pending' });
      await server()
        .post(`${base}/deliveries/${test.body.id}/redeliver`)
        .set('Authorization', browser)
        .expect(409);
      upstream.webhookDeliveries.get(webhook.id)![0]!.status = 'succeeded';
      const again = await server()
        .post(`${base}/deliveries/${test.body.id}/redeliver`)
        .set('Authorization', browser)
        .expect(202);
      expect(again.body.eventId).toBe(test.body.eventId);

      const deliveries = await server()
        .get(`${base}/deliveries`)
        .set('Authorization', browser)
        .expect(200);
      expect(deliveries.body).toHaveLength(2);
    });

    it('switches a webhook off and on and deletes it', async () => {
      const { body: webhook } = await server()
        .post(`/api/boards/${boardId}/webhooks`)
        .set('Authorization', browser)
        .send({ url: 'https://hooks.example.com/elysion' })
        .expect(201);
      const path = `/api/boards/${boardId}/webhooks/${webhook.id}`;

      const off = await server()
        .patch(path)
        .set('Authorization', browser)
        .send({ enabled: false })
        .expect(200);
      expect(off.body).toMatchObject({
        enabled: false,
        disabledReason: 'Switched off by a person.',
      });
      expect(upstream.lastWebhookRequest?.body).toEqual({ enabled: false });
      await server().delete(path).set('Authorization', browser).expect(204);
      await server().get(path).set('Authorization', browser).expect(404);
    });

    it('refuses a body of the wrong shape before the backend is asked, and an id that is no UUID with 404', async () => {
      const requests = upstream.requests;
      const base = `/api/boards/${boardId}/webhooks`;

      await server().post(base).set('Authorization', browser).send({ url: 7 }).expect(400);
      await server()
        .post(base)
        .set('Authorization', browser)
        .send({ url: 'https://a.example.com', events: 'board.renamed' })
        .expect(400);
      await server()
        .patch(`${base}/${randomUUID()}`)
        .set('Authorization', browser)
        .send({ enabled: 'yes' })
        .expect(400);
      await server().get(`${base}/not-an-id`).set('Authorization', browser).expect(404);
      await server().get(`/api/boards/nope/webhooks`).set('Authorization', browser).expect(404);

      expect(upstream.requests).toBe(requests);
    });

    it("passes on the backend's answers: 400 for an http URL, 403 below Owner, 404 for a foreign board", async () => {
      const refused = await server()
        .post(`/api/boards/${boardId}/webhooks`)
        .set('Authorization', browser)
        .send({ url: 'http://hooks.example.com' })
        .expect(400);
      expect(refused.body.message).toBe('Only https URLs are allowed.');

      upstream.roles.set(boardId, 'Editor');
      await server()
        .get(`/api/boards/${boardId}/webhooks`)
        .set('Authorization', browser)
        .expect(403);
      await server()
        .get(`/api/boards/${randomUUID()}/webhooks`)
        .set('Authorization', browser)
        .expect(404);
    });

    it('passes the instance-wide webhooks of the admin pages on to /admin/webhooks', async () => {
      const id = randomUUID();
      upstream.adminAnswer = { status: 201, body: { id, boardId: null, secret: SECRET } };

      const created = await server()
        .post('/api/admin/webhooks')
        .set('Authorization', browser)
        .send({ url: 'https://all.example.com', events: [] })
        .expect(201);

      expect(created.body).toEqual({ id, boardId: null, secret: SECRET });
      expect(upstream.lastAdminRequest).toEqual({
        method: 'POST',
        path: '/admin/webhooks',
        body: { url: 'https://all.example.com', events: [] },
      });

      upstream.adminAnswer = { status: 202, body: { id: randomUUID(), status: 'pending' } };
      await server()
        .post(`/api/admin/webhooks/${id}/test`)
        .set('Authorization', browser)
        .expect(202);
      expect(upstream.lastAdminRequest?.path).toBe(`/admin/webhooks/${id}/test`);
    });

    it('refuses a personal access token on the browser routes', async () => {
      await server()
        .get(`/api/boards/${boardId}/webhooks`)
        .set('Authorization', `Bearer ${HOOKS}`)
        .expect(401);
    });
  });

  describe('the public API (/public/v1)', () => {
    const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token: string) =>
      server()[method](path).set('Authorization', `Bearer ${token}`);

    it('registers a webhook with webhooks:write, with its address, and lists it a page at a time', async () => {
      const created = await call('post', `/public/v1/boards/${boardId}/webhooks`, HOOKS)
        .send({ url: 'https://hooks.example.com/elysion', events: ['member.added'] })
        .expect(201);

      expect(created.body.secret).toBe(SECRET);
      expect(created.headers.location).toBe(
        `/public/v1/boards/${boardId}/webhooks/${created.body.id}`,
      );
      expectContract('post', '/public/v1/boards/{id}/webhooks', created);

      const listed = await call('get', `/public/v1/boards/${boardId}/webhooks`, HOOKS).expect(200);
      expect(listed.body.items).toHaveLength(1);
      expect(listed.body.next).toBeNull();
      expect(JSON.stringify(listed.body)).not.toContain(SECRET);
      expectContract('get', '/public/v1/boards/{id}/webhooks', listed);

      const one = await call(
        'get',
        `/public/v1/boards/${boardId}/webhooks/${created.body.id}`,
        HOOKS,
      ).expect(200);
      expectContract('get', '/public/v1/boards/{id}/webhooks/{webhookId}', one);
    });

    it('sends a test event and lists the deliveries, as documented', async () => {
      const { body: webhook } = await call('post', `/public/v1/boards/${boardId}/webhooks`, HOOKS)
        .send({ url: 'https://hooks.example.com/elysion' })
        .expect(201);
      const base = `/public/v1/boards/${boardId}/webhooks/${webhook.id}`;

      const test = await call('post', `${base}/test`, HOOKS).expect(202);
      expectContract('post', '/public/v1/boards/{id}/webhooks/{webhookId}/test', test);
      const conflict = await call(
        'post',
        `${base}/deliveries/${test.body.id}/redeliver`,
        HOOKS,
      ).expect(409);
      expect(conflict.headers['content-type']).toMatch(PROBLEM);
      expect(conflict.body.detail).toBe('This delivery is still being sent.');

      const deliveries = await call('get', `${base}/deliveries`, HOOKS).expect(200);
      expect(deliveries.body.items.map((d: { id: string }) => d.id)).toEqual([test.body.id]);
      expectContract('get', '/public/v1/boards/{id}/webhooks/{webhookId}/deliveries', deliveries);
    });

    it('answers a test event for a switched-off webhook 409, as documented', async () => {
      const { body: webhook } = await call('post', `/public/v1/boards/${boardId}/webhooks`, HOOKS)
        .send({ url: 'https://hooks.example.com/elysion' })
        .expect(201);
      const base = `/public/v1/boards/${boardId}/webhooks/${webhook.id}`;
      await call('patch', base, HOOKS).send({ enabled: false }).expect(200);

      const refused = await call('post', `${base}/test`, HOOKS).expect(409);

      expect(refused.headers['content-type']).toMatch(PROBLEM);
      expect(refused.body.detail).toBe('This webhook is switched off. Switch it on to send to it.');
      expectContract('post', '/public/v1/boards/{id}/webhooks/{webhookId}/test', refused);
      expect(upstream.webhookDeliveries.get(webhook.id)).toEqual([]);
    });

    it('needs the scope webhooks:write on every webhook route, before the backend is asked', async () => {
      const id = randomUUID();
      const b = `/public/v1/boards/${boardId}/webhooks`;
      const routes: Array<[method: 'get' | 'post' | 'patch' | 'delete', path: string]> = [
        ['get', b],
        ['post', b],
        ['get', `${b}/${id}`],
        ['patch', `${b}/${id}`],
        ['delete', `${b}/${id}`],
        ['post', `${b}/${id}/test`],
        ['get', `${b}/${id}/deliveries`],
        ['post', `${b}/${id}/deliveries/${id}/redeliver`],
        ['get', '/public/v1/webhooks'],
        ['post', '/public/v1/webhooks'],
        ['post', `/public/v1/webhooks/${id}/test`],
      ];
      const before = upstream.lastWebhookRequest;

      for (const [method, path] of routes) {
        const response = await call(method, path, READ)
          .send({ url: 'https://a.example.com' })
          .expect(403);
        expect(response.headers['content-type'], `${method} ${path}`).toMatch(PROBLEM);
        expect(response.body.detail).toBe('This needs a token with the scope "webhooks:write".');
      }
      expect(upstream.lastWebhookRequest).toBe(before);
      expect(upstream.webhooks.size).toBe(0);
    });

    it('answers a board the caller has no role on 404 as problem details, and registers nothing', async () => {
      const foreign = `/public/v1/boards/${randomUUID()}/webhooks`;

      for (const [method, path] of [
        ['get', foreign],
        ['post', foreign],
        ['get', `${foreign}/${randomUUID()}/deliveries`],
      ] as Array<['get' | 'post', string]>) {
        const response = await call(method, path, HOOKS)
          .send({ url: 'https://a.example.com' })
          .expect(404);
        expect(response.headers['content-type']).toMatch(PROBLEM);
        expect(response.body).toEqual({ type: 'about:blank', title: 'Not Found', status: 404 });
      }
      expect(upstream.webhooks.size).toBe(0);
    });

    it('answers a refused URL as problem details (400)', async () => {
      const response = await call('post', `/public/v1/boards/${boardId}/webhooks`, HOOKS)
        .send({ url: 'http://hooks.example.com' })
        .expect(400);

      expect(response.headers['content-type']).toMatch(PROBLEM);
      expect(response.body.detail).toBe('Only https URLs are allowed.');
    });
  });
});
