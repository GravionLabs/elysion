import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { bearer, testVerifier } from './test-auth.js';

describe('Metrics (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TokenVerifier)
      .useValue(testVerifier())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const scrape = async () => (await request(app.getHttpServer()).get('/metrics').expect(200)).text;

  it('serves the Prometheus text format without a token, with the process metrics', async () => {
    const response = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('# TYPE process_cpu_user_seconds_total counter');
  });

  it('counts requests by method, route pattern and status, also the ones refused by the auth guard', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/api/boards').expect(401); // no token

    const text = await scrape();

    expect(text).toContain(
      'elysion_bff_http_requests_total{method="GET",route="/health",status_code="200"} 1',
    );
    expect(text).toContain(
      'elysion_bff_http_requests_total{method="GET",route="/api/boards",status_code="401"} 1',
    );
    expect(text).toContain('elysion_bff_http_request_duration_seconds_bucket');
  });

  it('uses the route pattern and not the URL as the label: no ids, no query strings', async () => {
    const authorization = await bearer();

    await request(app.getHttpServer())
      .get('/api/boards/not-a-uuid?token=SECRETVALUE')
      .set('Authorization', authorization);

    const text = await scrape();
    expect(text).toContain('route="/api/boards/:id"');
    expect(text).not.toContain('SECRETVALUE');
    expect(text).not.toContain('not-a-uuid');
  });

  it('puts every URL that matches no route under one label', async () => {
    await request(app.getHttpServer()).get('/nothing/here/1').expect(404);
    await request(app.getHttpServer()).get('/nothing/here/2').expect(404);

    const text = await scrape();

    expect(text).toContain(
      'elysion_bff_http_requests_total{method="GET",route="unmatched",status_code="404"} 2',
    );
  });
});
