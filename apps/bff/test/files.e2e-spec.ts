import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { FakeBusinessBackend } from './fake-business-backend.js';
import { bearer, testVerifier } from './test-auth.js';

const FILE_ID = '0123456789abcdef0123456789abcdef01234567';

describe('Board files (e2e, against a fake business backend)', () => {
  let upstream: FakeBusinessBackend;
  let app: INestApplication;
  let authorization: string;
  const boardId = randomUUID();

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
    await app.listen(0);
    authorization = await bearer();
  });

  afterEach(async () => {
    await app.close();
    await upstream.stop();
    delete process.env.BUSINESS_BACKEND_URL;
  });

  const api = () => request.agent(app.getHttpServer()).set('Authorization', authorization);
  const port = () => (app.getHttpServer().address() as { port: number }).port;

  it('stores a file through the backend and reads it back with the headers a browser needs', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

    await api()
      .put(`/api/boards/${boardId}/files/${FILE_ID}`)
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(204);
    const response = await api().get(`/api/boards/${boardId}/files/${FILE_ID}`).expect(200);

    expect(response.body).toEqual(png);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    // Only the headers that matter to the browser are passed on.
    expect(response.headers['x-internal']).toBeUndefined();
    expect(upstream.authorizations.every((a) => a === authorization)).toBe(true);
  });

  it('streams a 5 MB upload: the backend gets bytes while the client is still sending', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 7);
    const total = 5 * chunk.length;
    let seenWhileSending = 0;

    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        {
          port: port(),
          method: 'PUT',
          path: `/api/boards/${boardId}/files/${FILE_ID}`,
          headers: {
            authorization,
            'content-type': 'image/png',
            'content-length': total,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () =>
            res.statusCode === 204 ? resolve() : reject(new Error(String(res.statusCode))),
          );
        },
      );
      req.on('error', reject);
      void (async () => {
        for (let i = 0; i < 5; i++) {
          req.write(chunk);
          if (i === 2) {
            // Half of the file is out and the request is not finished: a buffering proxy would have passed on nothing yet.
            for (let wait = 0; wait < 100 && upstream.uploadedSoFar === 0; wait++) {
              await new Promise((r) => setTimeout(r, 20));
            }
            seenWhileSending = upstream.uploadedSoFar;
          }
        }
        req.end();
      })();
    });

    expect(seenWhileSending).toBeGreaterThan(0);
    expect(seenWhileSending).toBeLessThan(total);
    expect(upstream.files.get(`${boardId}/${FILE_ID}`)!.bytes.length).toBe(total);
  });

  it('needs a token', async () => {
    await request(app.getHttpServer()).get(`/api/boards/${boardId}/files/${FILE_ID}`).expect(401);
    await request(app.getHttpServer())
      .put(`/api/boards/${boardId}/files/${FILE_ID}`)
      .set('Content-Type', 'image/png')
      .send('x')
      .expect(401);
    expect(upstream.requests).toBe(0);
  });

  it('answers 404 for a board id that is not a UUID without asking the backend', async () => {
    await api().get(`/api/boards/not-a-uuid/files/${FILE_ID}`).expect(404);
    expect(upstream.requests).toBe(0);
  });

  it('answers 404 for a file that is not there', async () => {
    await api().get(`/api/boards/${boardId}/files/${FILE_ID}`).expect(404);
  });

  it('refuses a body with no declared length and one that announces too much', async () => {
    const chunked = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          port: port(),
          method: 'PUT',
          path: `/api/boards/${boardId}/files/${FILE_ID}`,
          headers: { authorization, 'content-type': 'image/png', 'transfer-encoding': 'chunked' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(Buffer.from('abc'));
    });
    expect(chunked).toBe(411);

    await api()
      .put(`/api/boards/${boardId}/files/${FILE_ID}`)
      .set('Content-Type', 'image/png')
      .set('Content-Length', String(1024 * 1024 * 1024))
      .expect(413);
    expect(upstream.requests).toBe(0);
  });

  it.each([
    [413, 413],
    [415, 415],
    [409, 409],
    [403, 403],
  ])("passes the backend's %i on as %i", async (refusal, expected) => {
    upstream.fileRefusal = refusal;
    await api()
      .put(`/api/boards/${boardId}/files/${FILE_ID}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from([1, 2, 3]))
      .expect(expected);
  });

  it('lets the client finish its upload when the backend refuses it early, so the connection is not torn down', async () => {
    upstream.fileRefusal = 413;
    upstream.fileRefusalEarly = true;
    const chunk = Buffer.alloc(1024 * 1024, 7);

    const outcome = await new Promise<{ status?: number; error?: string }>((resolve) => {
      const req = httpRequest(
        {
          port: port(),
          method: 'PUT',
          path: `/api/boards/${boardId}/files/${FILE_ID}`,
          headers: {
            authorization,
            'content-type': 'image/png',
            'content-length': 5 * chunk.length,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode }));
        },
      );
      req.on('error', (error) => resolve({ error: error.message }));
      void (async () => {
        for (let i = 0; i < 5; i++) {
          req.write(chunk);
          await new Promise((r) => setTimeout(r, 30));
        }
        req.end();
      })();
    });

    // Without the drain the BFF destroyed the request: the client saw a reset instead of the 413.
    expect(outcome).toEqual({ status: 413 });
  });

  it('answers 502 when the backend is not reachable', async () => {
    await upstream.stop();
    await api().get(`/api/boards/${boardId}/files/${FILE_ID}`).expect(502);
  });
});
