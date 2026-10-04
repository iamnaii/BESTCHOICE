import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from './app.setup';

@Controller('cors-probe')
class CorsProbeController {
  @Get() read() { return { ok: true }; }
}

it('exposes rate-limit retry deadlines to the production browser origin', async () => {
  const module = await Test.createTestingModule({ controllers: [CorsProbeController] }).compile();
  const app: INestApplication = module.createNestApplication();
  configureApp(app, { swagger: false });
  await app.init();
  try {
    const res = await request(app.getHttpServer()).get('/api/cors-probe').set('Origin', 'https://www.bestchoicephone.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://www.bestchoicephone.com');
    expect(res.headers['access-control-expose-headers']).toContain('Retry-After');
    expect(res.headers['access-control-expose-headers']).toContain('Retry-After-short');
  } finally { await app.close(); }
});
