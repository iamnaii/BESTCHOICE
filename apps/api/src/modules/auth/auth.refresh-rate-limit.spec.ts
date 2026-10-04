import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserThrottlerGuard } from '../../guards/user-throttler.guard';

describe('refresh throttle over HTTP with real guard', () => {
  let app: INestApplication;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: 'short', ttl: 1000, limit: 200 }])],
      controllers: [AuthController],
      providers: [
        { provide: APP_GUARD, useClass: UserThrottlerGuard },
        { provide: AuthService, useValue: {
          refreshToken: async (token: string) => ({ accessToken: `access-${token}`, refreshToken: token }),
          login: async () => ({ accessToken: 'access', refreshToken: 'refresh', user: {} }),
          forgotPassword: async () => ({ message: 'ok' }),
        } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    // Keep one owned listener for the request burst instead of opening and
    // closing an ephemeral port for every Supertest request.
    await app.listen(0, '127.0.0.1');
  });
  afterEach(async () => { await app.close(); });
  it('accepts 30 refreshes from three sessions sharing one IP', async () => {
    for (let i = 0; i < 30; i++) {
      const res = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', `refresh_token=session-${i % 3}`);
      expect(res.status).toBe(201);
    }
  });
  it('still rate limits one session and supplies Retry-After', async () => {
    for (let i = 0; i < 600; i++) {
      const res = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', 'refresh_token=one');
      expect({ attempt: i, status: res.status, error: res.status === 201 ? undefined : res.text }).toEqual({ attempt: i, status: 201, error: undefined });
    }
    const res = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', 'refresh_token=one');
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'] ?? res.headers['retry-after-short'])).toBeGreaterThan(0);
  });
  it('keeps login and password-reset limits unchanged', async () => {
    for (let i = 0; i < 10; i++) expect((await request(app.getHttpServer()).post('/auth/login').send({})).status).toBe(201);
    expect((await request(app.getHttpServer()).post('/auth/login').send({})).status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await request(app.getHttpServer()).post('/auth/forgot-password').send({})).status).toBe(201);
    expect((await request(app.getHttpServer()).post('/auth/forgot-password').send({})).status).toBe(429);
  });
});
