import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { bearer, testVerifier } from './test-auth.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TokenVerifier)
      .useValue(testVerifier())
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET) needs a token', async () => {
    await request(app.getHttpServer()).get('/').expect(401);
    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', await bearer())
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET) needs no token: container health checks carry none', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  afterEach(async () => {
    await app.close();
  });
});
