import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import archiver from 'archiver';
import request from 'supertest';
import { FinanceSharePublicController } from '../finance-share-public.controller';
import { FinanceShareService } from '../services/finance-share.service';
import { CsrfGuard } from '../../../guards/csrf.guard';

/**
 * HTTP-layer spec (fix round 1 Important 6) — everything above is unit-tested against the
 * service directly; this file drives the controller through the real Express/Nest pipeline
 * (real CsrfGuard, real ValidationPipe, real headers) with a mocked FinanceShareService, so
 * it catches things a method-call test cannot: header wiring, the 410 gone page, HEAD not
 * counting as a view, a stream that dies mid-flight not producing a raw 500/hang, and the
 * @SkipCsrf() bypass actually working end-to-end.
 */
describe('FinanceSharePublicController (HTTP)', () => {
  let app: INestApplication;
  const rawToken = 'a'.repeat(43);

  const liveApp = () => ({
    id: 'app-1',
    number: 'BC-260924-001',
    status: 'SENT' as const,
    shareExpiresAt: new Date(Date.now() + 86400000),
    messageText: 'ข้อความ',
  });

  const share = {
    resolve: jest.fn(),
    recordView: jest.fn().mockResolvedValue(undefined),
    groups: jest.fn().mockReturnValue([]),
    fileStream: jest.fn(),
    zipStream: jest.fn(),
    reply: jest.fn(),
  };
  const config = { get: jest.fn((key: string) => (key === 'PII_HASH_SALT' ? 'test-salt-0123456789abcdef0123456789abcdef' : undefined)) };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [FinanceSharePublicController],
      providers: [
        { provide: FinanceShareService, useValue: share },
        { provide: ConfigService, useValue: config },
        // real global CsrfGuard registered as APP_GUARD — proves @SkipCsrf() actually bypasses
        // it on POST /reply instead of just trusting the decorator exists (fix round 1 Important 6)
        { provide: APP_GUARD, useClass: CsrfGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    // mirrors app.setup.ts's global ValidationPipe so the invalid-action test exercises the
    // same validation behavior prod has (whitelist+transform)
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    share.recordView.mockResolvedValue(undefined);
    share.groups.mockReturnValue([]);
  });

  it('GET a live token → 200 text/html with every required header + CSP nonce, and records the view once', async () => {
    share.resolve.mockResolvedValue({ state: 'OK', app: liveApp() });
    const res = await request(app.getHttpServer()).get(`/g/${rawToken}`).expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("script-src 'nonce-");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(share.recordView).toHaveBeenCalledTimes(1);
    expect(share.recordView.mock.calls[0][0]).toBe('app-1');
    expect(typeof share.recordView.mock.calls[0][1]).toBe('string');
    expect(share.recordView.mock.calls[0][1]).toHaveLength(32); // ipHash — sha256(...).slice(0, 32)
  });

  it('GET an unknown/expired/revoked token → 410 gone page, and recordView is never called', async () => {
    share.resolve.mockResolvedValue({ state: 'GONE', reason: 'NOT_FOUND' });
    const res = await request(app.getHttpServer()).get(`/g/${rawToken}`).expect(410);
    expect(res.text).toContain('หมดอายุ');
    expect(res.text).not.toContain('BC-');
    expect(share.recordView).not.toHaveBeenCalled();
  });

  it('HEAD request on a live token does not count as a view (link-preview crawlers)', async () => {
    share.resolve.mockResolvedValue({ state: 'OK', app: liveApp() });
    await request(app.getHttpServer()).head(`/g/${rawToken}`).expect(200);
    expect(share.recordView).not.toHaveBeenCalled();
  });

  it('GET a file streams the body with inline disposition and private, no-store', async () => {
    const stream = Readable.from([Buffer.from('jpeg-bytes')]);
    share.fileStream.mockResolvedValue({
      file: { id: 'f1', mimeType: 'image/jpeg', size: 10, originalName: 'บัตร.jpg' },
      stream,
      appId: 'app-1',
    });
    const res = await request(app.getHttpServer()).get(`/g/${rawToken}/files/f1`).expect(200);
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  it('a premature close mid-file-stream does not crash the server or leave the request hanging (CRITICAL fix)', async () => {
    const brokenStream = new Readable({
      read() {
        // simulates the client aborting mid-download / a storage read error
        this.destroy(new Error('ERR_STREAM_PREMATURE_CLOSE simulated'));
      },
    });
    share.fileStream.mockResolvedValue({
      file: { id: 'f1', mimeType: 'image/jpeg', size: 10, originalName: 'บัตร.jpg' },
      stream: brokenStream,
      appId: 'app-1',
    });
    // Node's pipeline() destroys the response stream itself the instant the source errors —
    // for a genuine premature close there is no HTTP response left to send, so the socket may
    // legitimately reset (supertest surfaces that as a rejected request, not a 500 status).
    // What the fix actually guarantees is: no unhandled rejection reaches SentryExceptionFilter
    // (which would log the raw token — see the filter spec) and the server keeps working
    // afterwards — proven below by a normal follow-up request succeeding.
    await request(app.getHttpServer()).get(`/g/${rawToken}/files/f1`).catch(() => undefined);
    const okStream = Readable.from([Buffer.from('ok')]);
    share.fileStream.mockResolvedValue({ file: { id: 'f2', mimeType: 'image/jpeg', size: 2, originalName: 'b.jpg' }, stream: okStream, appId: 'app-1' });
    await request(app.getHttpServer()).get(`/g/${rawToken}/files/f2`).expect(200);
  });

  it('a zip read failure settles the response (does not hang) and does not surface as a 500 (Important 2 fix)', async () => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    share.zipStream.mockResolvedValue({
      filename: 'BC-260924-001.zip',
      archive,
      load: jest.fn().mockRejectedValue(new Error('storage read failed')),
      appId: 'app-1',
    });
    const res = await request(app.getHttpServer()).get(`/g/${rawToken}/zip`);
    expect(res.status).not.toBe(500);
  }, 10_000);

  it('POST reply without X-Requested-With still passes CSRF (real CsrfGuard + @SkipCsrf()) and returns 201 with the mocked status', async () => {
    share.reply.mockResolvedValue({ status: 'ACKNOWLEDGED' });
    const res = await request(app.getHttpServer())
      .post(`/g/${rawToken}/reply`)
      .send({ action: 'ACK', name: 'คุณเอ' })
      .expect(201);
    expect(res.body).toEqual({ status: 'ACKNOWLEDGED' });
    expect(share.reply).toHaveBeenCalledWith(rawToken, expect.objectContaining({ action: 'ACK', name: 'คุณเอ' }), expect.any(String));
  });

  it('POST reply with an invalid action → 400 (class-validator, before the service is even called)', async () => {
    await request(app.getHttpServer())
      .post(`/g/${rawToken}/reply`)
      .send({ action: 'BOGUS', name: 'คุณเอ' })
      .expect(400);
    expect(share.reply).not.toHaveBeenCalled();
  });
});
