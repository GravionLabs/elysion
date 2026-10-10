import { Test } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { MAX_CSP_REPORT_BYTES } from '../src/csp/csp-report.controller.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { testVerifier } from './test-auth.js';

describe('POST /api/csp-report (e2e)', () => {
  let app: INestApplication<App>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TokenVerifier)
      .useValue(testVerifier())
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    warn.mockRestore();
    await app.close();
  });

  it('takes a legacy report without a token and logs the directive and the blocked URI, without the query', async () => {
    await request(app.getHttpServer())
      .post('/api/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(
        JSON.stringify({
          'csp-report': {
            'effective-directive': 'script-src-elem',
            'blocked-uri': 'https://evil.example/x.js?token=secret#frag',
            'document-uri': 'http://localhost/board/abc?x=1',
          },
        }),
      )
      .expect(204);

    expect(warn).toHaveBeenCalledOnce();
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('script-src-elem');
    expect(line).toContain('https://evil.example/x.js');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('localhost');
  });

  it('takes the Reporting API format', async () => {
    await request(app.getHttpServer())
      .post('/api/csp-report')
      .set('Content-Type', 'application/reports+json')
      .send(
        JSON.stringify([
          { type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'inline' } },
          { type: 'deprecation', body: {} },
        ]),
      )
      .expect(204);

    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('img-src blocked inline');
  });

  it('takes an application/json body too', async () => {
    await request(app.getHttpServer())
      .post('/api/csp-report')
      .send({ 'csp-report': { 'violated-directive': 'style-src', 'blocked-uri': 'eval' } })
      .expect(204);

    expect(String(warn.mock.calls[0][0])).toContain('style-src blocked eval');
  });

  it('answers 204 and logs nothing for garbage and for a body over the limit', async () => {
    await request(app.getHttpServer())
      .post('/api/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send('not json')
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send('x'.repeat(MAX_CSP_REPORT_BYTES + 1))
      .expect(204);

    expect(warn).not.toHaveBeenCalled();
  });
});
