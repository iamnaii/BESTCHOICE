import { ArgumentsHost, Catch, ExceptionFilter, HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import * as http from 'http';
import type { AddressInfo } from 'net';
import archiver from 'archiver';
import request from 'supertest';
import * as Sentry from '@sentry/nestjs';
import { FinanceSharePublicController } from '../finance-share-public.controller';
import { FinanceShareService } from '../services/finance-share.service';
import { CsrfGuard } from '../../../guards/csrf.guard';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

/**
 * A `@Catch()` filter that records every exception that reaches Nest's own exception-handling
 * layer instead of the app's real global filter (which isn't wired into this isolated test
 * module). Used by the two tests below (fix round 2 finding 6) to PROVE — not just assume from
 * the response shape — that a premature client disconnect / a mid-archive failure never
 * propagates past the controller's own catch blocks. It still answers a legitimate HttpException
 * (e.g. the ValidationPipe's 400 on the invalid-action test elsewhere in this file) with that
 * exception's own status — a "plain 500" for every exception regardless of type would make the
 * pre-existing validation test fail as a side effect of registering this filter, which would
 * hide the real signal (a NON-HttpException/unexpected fault reaching here) behind test noise.
 */
const recordedExceptions: unknown[] = [];
@Catch()
class RecordingFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    recordedExceptions.push(exception);
    const res = host.switchToHttp().getResponse();
    if (res.headersSent) return;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === 'string' ? { message: body } : body);
      return;
    }
    res.status(500).json({ message: 'recorded-by-test-filter' });
  }
}

/**
 * HTTP-layer spec (fix round 1 Important 6) — everything above is unit-tested against the
 * service directly; this file drives the controller through the real Express/Nest pipeline
 * (real CsrfGuard, real ValidationPipe, real headers) with a mocked FinanceShareService, so
 * it catches things a method-call test cannot: header wiring, the 410 gone page, HEAD not
 * counting as a view, a stream that dies mid-flight not producing a raw 500/hang, and the
 * @SkipCsrf() bypass actually working end-to-end.
 *
 * fix round 2 finding 6: the app also listens on a real TCP port (not just supertest's
 * per-request ephemeral listener) so the "real client disconnect" tests can issue their own
 * raw `http.request()` and call `req.destroy()` mid-response — proving what actually happens
 * on the wire, not just what our mocked source stream does to itself.
 */
describe('FinanceSharePublicController (HTTP)', () => {
  let app: INestApplication;
  let port: number;
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
        // fix round 2 finding 6 — records anything that reaches Nest's exception layer instead
        // of asserting on it indirectly through the HTTP response.
        { provide: APP_FILTER, useClass: RecordingFilter },
      ],
    }).compile();
    app = mod.createNestApplication();
    // mirrors app.setup.ts's global ValidationPipe so the invalid-action test exercises the
    // same validation behavior prod has (whitelist+transform)
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    share.recordView.mockResolvedValue(undefined);
    share.groups.mockReturnValue([]);
    recordedExceptions.length = 0;
    (Sentry.captureException as jest.Mock).mockClear();
  });

  /** Issues a raw request against the real listening port and calls `req.destroy()` the instant the first response chunk arrives — a genuine client-initiated abort, not a self-destroying mock stream. */
  function abortAfterFirstChunk(path: string): Promise<void> {
    return new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        res.once('data', () => req.destroy());
        res.on('close', () => resolve());
        res.on('error', () => resolve());
      });
      req.on('error', () => resolve());
      req.end();
    });
  }

  /** Issues a raw request and reports whether it saw any body bytes and whether it ended CLEANLY (a proper 'end', not an abrupt close/error/reset). */
  function rawGet(path: string): Promise<{ sawData: boolean; endedCleanly: boolean; statusCode?: number }> {
    return new Promise((resolve) => {
      let sawData = false;
      let settled = false;
      const settle = (endedCleanly: boolean, statusCode?: number) => {
        if (settled) return;
        settled = true;
        resolve({ sawData, endedCleanly, statusCode });
      };
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        res.on('data', () => { sawData = true; });
        res.on('end', () => settle(true, res.statusCode));
        res.on('aborted', () => settle(false, res.statusCode));
        res.on('error', () => settle(false, res.statusCode));
        res.on('close', () => settle(false, res.statusCode));
      });
      req.on('error', () => settle(false));
      req.end();
    });
  }

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

  // fix round 2 finding 6: this used to only prove "the server stays up afterwards" — it never
  // asserted that the premature-close error stayed OUT of Nest's exception layer and out of
  // Sentry. It also used a mock stream that destroyed ITSELF with an arbitrary Error rather than
  // a genuine client-initiated abort, so it would have passed even against pre-fix code that
  // forwarded the error somewhere unsafe, as long as the server didn't crash outright.
  it('a real client-side abort mid-file-stream never reaches any exception filter or Sentry (Important 6 fix)', async () => {
    let pushed = false;
    const stream = new Readable({
      read() {
        // a single large chunk, then go quiet — simulates a slow/large download so the client
        // has time to receive the first chunk and abort before the stream would ever finish
        if (!pushed) {
          pushed = true;
          this.push(Buffer.alloc(5 * 1024 * 1024, 'x'));
        }
      },
    });
    share.fileStream.mockResolvedValue({
      file: { id: 'f1', mimeType: 'image/jpeg', size: 5 * 1024 * 1024, originalName: 'a.jpg' },
      stream,
      appId: 'app-1',
    });

    await abortAfterFirstChunk(`/g/${rawToken}/files/f1`);
    // give the server's pipeline() a tick to detect the premature close and run the controller's catch block
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(recordedExceptions).toEqual([]);
    expect(Sentry.captureException).not.toHaveBeenCalled();

    // server must still be healthy afterwards
    const okStream = Readable.from([Buffer.from('ok')]);
    share.fileStream.mockResolvedValue({ file: { id: 'f2', mimeType: 'image/jpeg', size: 2, originalName: 'b.jpg' }, stream: okStream, appId: 'app-1' });
    await request(app.getHttpServer()).get(`/g/${rawToken}/files/f2`).expect(200);
  }, 10_000);

  // fix round 3 finding 2 minor (ii): the OLD `isExpectedStreamAbort` classified purely by
  // error CODE — an unrelated fault that happens to carry the same code a real client
  // disconnect produces (e.g. a storage/DB blip surfaced as `ECONNRESET`) would have been
  // silently swallowed at DEBUG even though the client never went anywhere and headers were
  // never even sent. It must now check the response/request objects themselves too.
  it('an error carrying a stream-abort error code, with no evidence the client actually disconnected, is treated as a genuine server fault — not silently swallowed (Minor ii fix)', async () => {
    const err = new Error('unrelated fault that happens to carry ECONNRESET') as NodeJS.ErrnoException;
    err.code = 'ECONNRESET';
    share.fileStream.mockRejectedValue(err);

    const res = await request(app.getHttpServer()).get(`/g/${rawToken}/files/f1`);

    expect(res.status).toBe(410); // still the uniform GONE response, never a raw 500
    expect(recordedExceptions).toEqual([]); // never reaches Nest's own exception layer
    expect(Sentry.captureException).toHaveBeenCalledWith(err); // but the genuine fault IS captured
  });

  it('a zip load failure before any bytes flow settles as a plain 410 with the zip headers removed, not a hang or a raw 500 (Important 2 fix)', async () => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const err = new Error('storage read failed before any entry was appended');
    const abort = jest.fn();
    share.zipStream.mockResolvedValue({
      filename: 'BC-260924-001.zip',
      archive,
      load: jest.fn().mockRejectedValue(err),
      abort,
      appId: 'app-1',
    });
    const res = await request(app.getHttpServer()).get(`/g/${rawToken}/zip`);
    expect(res.status).toBe(410);
    expect(res.headers['content-type'] ?? '').not.toContain('zip');
    expect(res.headers['content-disposition']).toBeUndefined();
    // never reaches Nest's own exception layer (would produce the recorded 500 body instead)...
    expect(recordedExceptions).toEqual([]);
    // ...but a genuine fault (not a client disconnect) IS captured directly, so it stays visible
    // (fix round 2 finding 1 visibility ruling — silently swallowing this at DEBUG was the gap).
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
    // fix round 3 finding 2: the controller must call the service's abort() (not just
    // archive.abort() on its own) so appended-but-unconsumed streams get destroyed too.
    expect(abort).toHaveBeenCalledTimes(1);
  }, 10_000);

  // fix round 2 finding 6: the previous version of this spec only covered a failure BEFORE any
  // bytes were sent. The mid-archive case — where headers/bytes are already flowing when the
  // failure happens — is exactly the scenario finding 2 was about (a clean-looking 200 with a
  // truncated zip) and had zero coverage.
  it('a mid-archive storage failure after bytes have started flowing aborts the transfer instead of a clean 200, and never surfaces via Nest\'s exception layer (Important 2 + 6 fix)', async () => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const calls: string[] = [];
    const err = new Error('storage read failed for entry 2');
    const abort = jest.fn();
    const load = jest.fn().mockImplementation(async () => {
      calls.push('entry-1');
      archive.append(Buffer.alloc(2 * 1024 * 1024, 'x'), { name: '01.jpg' });
      // let archiver actually flush real compressed bytes down the socket before failing
      await new Promise((resolve) => setTimeout(resolve, 150));
      calls.push('entry-2');
      throw err;
    });
    share.zipStream.mockResolvedValue({ filename: 'BC-260924-001.zip', archive, load, abort, appId: 'app-1' });

    const result = await rawGet(`/g/${rawToken}/zip`);

    expect(result.sawData).toBe(true); // the first entry's bytes DID reach the client...
    expect(result.endedCleanly).toBe(false); // ...but the transfer was aborted, not completed as a clean 200
    expect(calls).toEqual(['entry-1', 'entry-2']);
    expect(recordedExceptions).toEqual([]); // never reaches Nest's own exception layer
    expect(Sentry.captureException).toHaveBeenCalledWith(err); // but the genuine fault IS captured
    // fix round 3 finding 2: the service's abort() (which destroys appended streams and
    // unblocks an in-flight finalize()) must be called, not just archive.abort() directly.
    expect(abort).toHaveBeenCalledTimes(1);
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
