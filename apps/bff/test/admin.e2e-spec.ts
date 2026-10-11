import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

describe('Administration (e2e, against a fake business backend)', () => {
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
    authorization = await bearer({ realmRoles: ['elysion-admin'] });
  });

  afterEach(async () => {
    await app.close();
    await upstream.stop();
    delete process.env.BUSINESS_BACKEND_URL;
  });

  const api = () => request.agent(app.getHttpServer()).set('Authorization', authorization);

  it('passes a read on with the caller’s token and the query, and returns what the backend says', async () => {
    upstream.adminAnswer = { status: 200, body: { items: [], total: 0, page: 2, pageSize: 10 } };

    const { body } = await api().get('/api/admin/users?query=ada&page=2&pageSize=10').expect(200);

    expect(body).toEqual({ items: [], total: 0, page: 2, pageSize: 10 });
    expect(upstream.lastAdminRequest).toEqual({
      method: 'GET',
      path: '/admin/users?query=ada&page=2&pageSize=10',
      body: undefined,
    });
    expect(upstream.authorizations.at(-1)).toBe(authorization);
  });

  it('forwards the area’s own root and nested paths', async () => {
    const group = randomUUID();
    const user = randomUUID();

    await api().get('/api/admin/stats').expect(200);
    expect(upstream.lastAdminRequest?.path).toBe('/admin/stats');
    await api().get(`/api/admin/groups/${group}/members?pageSize=5`).expect(200);
    expect(upstream.lastAdminRequest?.path).toBe(`/admin/groups/${group}/members?pageSize=5`);

    upstream.adminAnswer = { status: 204 };
    await api().put(`/api/admin/groups/${group}/members/${user}`).expect(204);
    expect(upstream.lastAdminRequest).toEqual({
      method: 'PUT',
      path: `/admin/groups/${group}/members/${user}`,
      body: undefined,
    });
    await api().delete(`/api/admin/groups/${group}/members/${user}`).expect(204);
    expect(upstream.lastAdminRequest?.method).toBe('DELETE');
  });

  it('passes a JSON body on and keeps the status of the answer (201 for a made group)', async () => {
    upstream.adminAnswer = { status: 201, body: { id: 'g1', name: 'Marketing' } };

    const response = await api().post('/api/admin/groups').send({ name: 'Marketing' }).expect(201);

    expect(response.body).toEqual({ id: 'g1', name: 'Marketing' });
    expect(upstream.lastAdminRequest?.body).toEqual({ name: 'Marketing' });
  });

  it('passes a patch on, with null kept as null', async () => {
    const id = randomUUID();

    await api().patch(`/api/admin/groups/${id}`).send({ externalId: null }).expect(200);

    expect(upstream.lastAdminRequest).toEqual({
      method: 'PATCH',
      path: `/admin/groups/${id}`,
      body: { externalId: null },
    });
  });

  it.each([
    [403, 403],
    [404, 404],
    [409, 409],
    [400, 400],
  ])('turns the backend’s %i into a %i', async (backend, expected) => {
    upstream.adminAnswer = { status: backend, body: { title: 'x' } };

    await api().get('/api/admin/groups').expect(expected);
  });

  it('needs a token', async () => {
    await request(app.getHttpServer()).get('/api/admin/stats').expect(401);
    expect(upstream.lastAdminRequest).toBeNull();
  });

  it('asks the backend even for a token without the role: the backend says 403', async () => {
    upstream.adminAnswer = { status: 403 };

    await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', await bearer())
      .expect(403);
    expect(upstream.lastAdminRequest?.path).toBe('/admin/stats');
  });

  it.each(['a%2Fb', 'a.b', 'x%20y'])(
    'refuses the path segment %s without calling the backend',
    async (segment) => {
      await api().get(`/api/admin/groups/${segment}`).expect(404);

      expect(upstream.lastAdminRequest).toBeNull();
    },
  );

  /** supertest and every browser resolve `..` before they send; a hand-written client does not, so the path goes out raw. */
  it.each(['/api/admin/groups/..', '/api/admin/groups/%2e%2e', '/api/admin/../boards'])(
    'does not let the raw path %s climb out of the area',
    async (path) => {
      await app.listen(0, '127.0.0.1');
      const port = (app.getHttpServer().address() as { port: number }).port;
      const status = await new Promise<number>((resolve, reject) => {
        const call = httpRequest(
          { host: '127.0.0.1', port, path, headers: { authorization } },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        call.on('error', reject);
        call.end();
      });

      expect(status).toBe(404);
      expect(upstream.lastAdminRequest).toBeNull();
    },
  );

  it('refuses a path that is too deep', async () => {
    await api().get('/api/admin/a/b/c/d/e/f').expect(404);

    expect(upstream.lastAdminRequest).toBeNull();
  });

  it('refuses a query value that is given twice', async () => {
    await api().get('/api/admin/users?query=a&query=b').expect(400);

    expect(upstream.lastAdminRequest).toBeNull();
  });

  it('does not pass on a method the area does not use', async () => {
    await api().options('/api/admin/stats');

    expect(upstream.lastAdminRequest).toBeNull();
  });

  describe('what the BFF checks before it asks the backend', () => {
    it.each([
      ['/api/admin/users?query=' + 'x'.repeat(101)],
      ['/api/admin/users?page=abc'],
      ['/api/admin/users?page=-1'],
      ['/api/admin/users?pageSize=1.5'],
      ['/api/admin/groups?page=99999999999'],
    ])('refuses %s with a 400', async (url) => {
      await api().get(url.slice(0, 2000)).expect(400);

      expect(upstream.lastAdminRequest).toBeNull();
    });

    it('builds the query from the three values only and encodes the text', async () => {
      await api().get('/api/admin/rooms?query=a%20%26%20b&page=3&pageSize=7&other=1').expect(200);

      expect(upstream.lastAdminRequest?.path).toBe('/admin/rooms?query=a+%26+b&page=3&pageSize=7');
    });

    it('needs a text name to make a group', async () => {
      await api().post('/api/admin/groups').send({}).expect(400);
      await api().post('/api/admin/groups').send({ name: 5 }).expect(400);

      expect(upstream.lastAdminRequest).toBeNull();
    });

    it.each([[{}], [{ name: 5 }], [{ externalId: 5 }], [[1]]])(
      'refuses the group change %j with a 400',
      async (body) => {
        await api().patch(`/api/admin/groups/${randomUUID()}`).send(body).expect(400);

        expect(upstream.lastAdminRequest).toBeNull();
      },
    );

    it('sends only the keys of a group change it knows', async () => {
      const id = randomUUID();

      await api().patch(`/api/admin/groups/${id}`).send({ name: 'Dev', extra: 'x' }).expect(200);

      expect(upstream.lastAdminRequest?.body).toEqual({ name: 'Dev' });
    });

    it('answers 404 for ids that are no UUIDs and for routes the area does not have', async () => {
      await api().get('/api/admin/users/not-a-uuid').expect(404);
      await api().delete('/api/admin/groups/1').expect(404);
      await api().put(`/api/admin/groups/${randomUUID()}/members/x`).expect(404);
      await api().get('/api/admin/boards').expect(404);
      await api().post('/api/admin').expect(404);

      expect(upstream.lastAdminRequest).toBeNull();
    });
  });
});
