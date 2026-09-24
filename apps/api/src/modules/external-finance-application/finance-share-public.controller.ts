import { Body, Controller, Get, HttpException, Logger, NotFoundException, Param, Post, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { pipeline } from 'stream/promises';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { clientIp } from '../../utils/client-ip.util';
import { FinanceShareService } from './services/finance-share.service';
import { buildFinanceSharePage, buildGonePage, LINE_GROUP_NAME } from './services/finance-share-page.util';
import { FinanceShareReplyDto } from './dto/finance-share-reply.dto';

const GONE_MSG = 'ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว';

/**
 * A client closing the tab / navigating away mid-stream (or the controller's own
 * `res.destroy()` on a mid-archive failure — fix round 2 finding 2) is EXPECTED
 * traffic on `no-store` routes that refetch constantly — never a fault to alarm
 * on. Node surfaces it via one of these error codes on the stream/pipeline
 * rejection. Anything else reaching the catch block is a genuine, unexpected
 * fault and must stay visible (Sentry + WARN — fix round 2 finding 1 visibility
 * ruling), not silently swallowed at DEBUG.
 *
 * fix round 3 finding 2 minor (ii): the error CODE alone cannot tell "the client
 * actually went away" apart from "the SOURCE stream (storage backend) threw the
 * exact same code while the client is still there, waiting" — e.g. a GCS read
 * hiccupping with ECONNRESET is a genuine server-side fault even though its
 * error code is identical to what a real client disconnect produces. Only the
 * response/request objects themselves can distinguish the two.
 */
function isExpectedStreamAbort(err: unknown, res: Response, req: Request): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  const isRecognizedAbortCode = code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET' || code === 'EPIPE';
  if (!isRecognizedAbortCode) return false;
  return res.destroyed || res.writableEnded || req.aborted === true;
}

/**
 * หน้าลิงก์ชุดเช็คเครดิตสำหรับเจ้าหน้าที่ GFIN — public (ไม่มี JwtAuthGuard) ตาม spec §6/§12:
 * - เข้าถึงด้วยโทเคน 256 บิตอย่างเดียว (ค้นด้วย sha256 hash) · หมดอายุ 7 วัน · ยกเลิกได้
 * - ทุก route throttle ต่อ IP · POST reply ใช้ @SkipCsrf() เพราะไม่มี session — โทเคนในพาธคือหลักฐานสิทธิ์
 * - "ไม่พบ/หมดอายุ/ยกเลิก/ล้างแล้ว" ตอบหน้า 410 เดียวกัน ไม่บอกว่าโทเคนเคยมีอยู่ไหม
 * - ห้าม log โทเคนดิบ — log เฉพาะ application id หลัง resolve
 * - security fix round 1 (CRITICAL): error ที่ไม่ใช่ HttpException (premature-close ตอนสตรีมไฟล์/zip,
 *   DB สะดุด ฯลฯ) ต้องไม่ไหลไปที่ SentryExceptionFilter เป็น raw 500 — request.url ของทุก route นี้
 *   มีโทเคนดิบติดอยู่ (`/api/g/<token>/...`) ⇒ filter จะ log + ส่ง Sentry พร้อมโทเคน ทุก handler
 *   จึงจับ error ที่ไม่ใช่ HttpException เองแล้วตอบหน้า/สถานะ GONE แทน (ตาข่ายชั้นสองคือการ redact
 *   โทเคนใน SentryExceptionFilter เอง — ดู filters/sentry-exception.filter.ts)
 * - security fix round 2 (CRITICAL finding 1): ตาข่ายชั้นสองยังไม่พอ — `@sentry/nestjs`'s
 *   `requestDataIntegration` แปะ URL ดิบลง `event.request.url` เองจาก request context โดยไม่สนใจว่า
 *   filter ทำอะไรกับ `extra.url` ⇒ แก้ที่ `sentry.ts`'s `beforeSend`/`beforeSendTransaction` แทน (ตาข่าย
 *   ชั้นสาม ครอบทั้ง error event และ APM transaction event ที่ tracesSampleRate สุ่มส่ง). ผลคือ handler
 *   ในไฟล์นี้ "ปลอดภัยที่จะปล่อยผ่านได้แล้ว" สำหรับ HttpException ปกติ (เช่น 503 ตอน salt หาย) — ไม่ต้อง
 *   กันเองอีกชั้นสำหรับกรณีนั้น. ที่ยังต้องกันเอง (genuine fault ที่ไม่ใช่ HttpException — premature
 *   close/DB สะดุด) คือให้ `Sentry.captureException()` + log WARN (ไม่ใช่ DEBUG) แล้วค่อยตอบ GONE —
 *   เดิมกลืน error เงียบทำให้ fault จริงมองไม่เห็นเลยแม้จะปลอดภัยจากโทเคนรั่วแล้วก็ตาม
 *   (`isExpectedStreamAbort()` แยก client ปิดเอง/เราเอง destroy connection ออกจาก fault จริง)
 * - security fix round 2 (IMPORTANT finding 1b): `file()`/`zip()` เคยปล่อย HttpException จาก
 *   storage backend (เช่น GCS `BadRequestException('ไม่พบไฟล์: <storageKey>')`) ไหลตรงไปเป็น 400 JSON —
 *   ข้อความมี storageKey ซึ่งมี applicationId ติดอยู่ ⇒ ย้ายไปแปลงเป็น GONE_MSG ที่ตัว service เอง
 *   (`fileStream()`) แล้ว, controller จึงไม่ต้องแยกเคสนี้อีก
 * - security fix round 2 (IMPORTANT finding 2): mid-archive failure เดิมจบด้วย `res.end()` (headers
 *   ส่งไปแล้ว) = client เห็น 200 "จบสวย" ทั้งที่ zip ขาด แยกไม่ออกจาก success จริง — เปลี่ยนเป็น
 *   `res.destroy()` (connection ขาดเห็นชัด) เฉพาะกรณี headers ส่งไปแล้ว
 * - security fix round 3 (CRITICAL finding 1): ตาข่ายชั้นสามยังพลาด — โทเคนหลุดผ่าน
 *   `contexts.trace.data.*`/`spans[].data.*` (OpenTelemetry root-span/span attributes) และ
 *   `event.transaction` เอง (ก่อน Express router resolve เป็น route param) — แก้ที่ `sentry.ts`
 *   ด้วย deep recursive scrub (`scrubShareTokensDeep`) ครอบทั้ง event แทนการไล่ทีละ field, บวก
 *   `beforeSendTransaction` ทิ้ง transaction event ของ share route ไปเลย (ไม่มีประโยชน์ทาง APM
 *   สำหรับ route สาธารณะนี้) และ regex ไม่สนตัวพิมพ์เล็ก/ใหญ่ (Express routing ไม่สนตัวพิมพ์)
 * - security fix round 3 (IMPORTANT finding 2): `archive.abort()` ไม่ destroy stream ที่ append
 *   ไปแล้ว และถ้า abort เกิดหลัง `archive.finalize()` เริ่มแล้ว promise นั้นไม่ resolve เอง —
 *   `zipStream()` เปลี่ยนมาคืน `abort()` ที่ track stream ที่ append ไปเอง + race `finalize()`
 *   กับ "aborted" promise ให้ `load()` settle เสมอ
 * ดู `.claude/rules/security.md` รายการ Intentionally Public Endpoints (`finance-share-public`)
 */
@Controller('g')
export class FinanceSharePublicController {
  private readonly logger = new Logger(FinanceSharePublicController.name);

  constructor(private share: FinanceShareService, private config: ConfigService) {}

  /**
   * spec §12: sha256(salt ประจำระบบ + IP + วันตาม BKK) — ไม่เก็บ IP ดิบ · salt = PII_HASH_SALT
   * (secret ที่ prod มีอยู่แล้ว) · ใช้ `clientIp()` กลางของระบบแทนการอ่าน X-Forwarded-For เอง
   * (เดิมอ่าน entry ซ้ายสุดตรงๆ ซึ่งปลอมได้ฟรีและไม่ผ่าน TRUSTED_PROXY_HOPS เหมือนจุดอื่นในระบบ
   * — fix round 1 Important 5) · salt หาย = fail-closed แทนการ hash แบบไม่มี salt
   */
  private ipHash(req: Request): string {
    const salt = this.config.get<string>('PII_HASH_SALT');
    if (!salt) throw new ServiceUnavailableException('ระบบยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง');
    const ip = clientIp(req as Parameters<typeof clientIp>[0]);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
    return createHash('sha256').update(`${salt}|${ip}|${day}`).digest('hex').slice(0, 32);
  }

  private htmlHeaders(res: Response, nonce: string) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  }

  /**
   * จบ response แบบไม่ให้ error ไหลออกไปที่ global filter — ใช้ทั้งตอนยังไม่ส่ง header และส่งไปแล้ว.
   * fix round 2 finding 2: ตอน header ถูกส่งไปแล้ว (สตรีมไฟล์/zip พังกลางทาง) เดิมเรียก `res.end()`
   * ซึ่งปิด response แบบ "สมบูรณ์" — ฝั่ง client (โดยเฉพาะ chunked transfer ของ zip) เห็นเป็น 200
   * จบสวยทั้งที่เนื้อหาขาด แยกไม่ออกจาก success จริง ต้องใช้ `res.destroy()` (ตัดการเชื่อมต่อดิบ)
   * แทนเพื่อให้ client เห็นเป็น connection ขาด/ไม่สมบูรณ์อย่างชัดเจน.
   */
  private endSafely(res: Response, status: number) {
    try {
      if (res.headersSent) { if (!res.destroyed) res.destroy(); return; }
      if (!res.destroyed) res.status(status).end();
    } catch { /* response ปิดไปแล้ว — ไม่มีอะไรต้องทำ */ }
  }

  @Get(':token')
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  async page(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const nonce = randomBytes(16).toString('base64');
    try {
      const r = await this.share.resolve(token);
      this.htmlHeaders(res, nonce);
      if (r.state !== 'OK') return res.status(410).send(buildGonePage(nonce));
      // link-preview crawlers (LINE/Facebook) ยิง HEAD มาดึงลิงก์ก่อนคนเปิดจริง — ต้องไม่นับเป็นการเปิด
      // (fix round 1 Minor 8); recordView เองก็ห้ามทำให้หน้าเปิดไม่ได้ไม่ว่าจะพังด้วยเหตุใด
      if (req.method !== 'HEAD') {
        try {
          await this.share.recordView(r.app.id, this.ipHash(req), req.headers['user-agent']);
        } catch (err) {
          this.logger.warn(`[finance-share] recordView failed app=${r.app.id}: ${(err as Error)?.message ?? err}`);
        }
      }
      const base = `/api/g/${encodeURIComponent(token)}`;
      const groups = this.share.groups(r.app, (fileId) => `${base}/files/${fileId}`);
      return res.status(200).send(buildFinanceSharePage({
        nonce, number: r.app.number, status: r.app.status, expiresAt: r.app.shareExpiresAt!,
        messageText: r.app.messageText ?? '', groups, zipUrl: `${base}/zip`, replyUrl: `${base}/reply`,
        fileCount: groups.reduce((n, g) => n + g.files.length, 0), lineGroupName: LINE_GROUP_NAME,
      }));
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // fix round 2 finding 1 (visibility ruling): a genuine, non-HttpException
      // fault here (DB hiccup, etc.) must stay visible — Sentry + WARN — before
      // falling back to the uniform GONE page. The URL is safe to reach Sentry
      // now (sentry.ts's beforeSend scrubs it), so there's no reason to hide the
      // fault itself anymore.
      Sentry.captureException(err);
      this.logger.warn(`[finance-share] unexpected error serving page: ${(err as Error)?.message ?? err}`);
      if (!res.headersSent) { this.htmlHeaders(res, nonce); return res.status(410).send(buildGonePage(nonce)); }
      return this.endSafely(res, 410);
    }
  }

  @Get(':token/files/:fileId')
  @Throttle({ short: { limit: 120, ttl: 60_000 } })
  async file(@Param('token') token: string, @Param('fileId') fileId: string, @Req() req: Request, @Res() res: Response) {
    let appId: string | undefined;
    try {
      const { file, stream, appId: id } = await this.share.fileStream(token, fileId);
      appId = id;
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', String(file.size));
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName ?? file.id)}`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      await pipeline(stream, res);
    } catch (err) {
      // HttpException ปกติ (เช่น token ไม่พบ) ที่เกิดก่อนส่ง header ใดๆ — ปล่อยให้ Nest ตอบ 404
      // JSON ตามปกติ (ปลอดภัย ไม่มีโทเคนในข้อความ — fix round 2 finding 1b: `fileStream()` เอง
      // แปล storage-layer HttpException เป็น GONE_MSG แล้ว จึงไม่มีทางที่ err ตรงนี้จะมีข้อความ
      // ไม่ปลอดภัยหลุดออกไปอีก)
      if (err instanceof HttpException && !res.headersSent) throw err;
      // ที่เหลือทั้งหมด: premature close ตอนลูกค้าปิด lightbox/เปลี่ยนหน้า (no-store บังคับ
      // refetch ทุกครั้ง) หรือ error ที่ไม่คาดคิดระหว่างเตรียม/สตรีมไฟล์ — ต้องไม่ปล่อยให้ error
      // ไหลไปที่ SentryExceptionFilter โดยตรง (ตาข่ายชั้นสาม — sentry.ts scrub — ทำให้แม้หลุดไปก็
      // ปลอดภัยแล้ว แต่ยังจับเองที่นี่เพื่อตอบ GONE ที่หน้าตาเดียวกับทุกกรณี ไม่ใช่ raw 500/JSON)
      if (isExpectedStreamAbort(err, res, req)) {
        this.logger.debug(`[finance-share] file stream aborted app=${appId ?? 'unresolved'}: ${(err as Error)?.message ?? err}`);
      } else {
        // fix round 2 finding 1 (visibility ruling): genuine fault, not a client
        // disconnect — must reach Sentry + WARN, not be silently swallowed at DEBUG.
        Sentry.captureException(err);
        this.logger.warn(`[finance-share] file stream failed app=${appId ?? 'unresolved'}: ${(err as Error)?.message ?? err}`);
      }
      this.endSafely(res, 410);
    }
  }

  @Get(':token/zip')
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  async zip(@Param('token') token: string, @Res() res: Response) {
    let appId: string | undefined;
    try {
      const result = await this.share.zipStream(token);
      appId = result.appId;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
      res.setHeader('Cache-Control', 'private, no-store');
      let settled = false;
      // fix round 2 finding 2: a mid-archive failure while headers are already
      // sent must NOT look like a clean 200 (that's what `endSafely`'s
      // `res.destroy()` branch is for — see its own doc comment), and a 410 sent
      // BEFORE any bytes flowed must not carry zip-specific headers a moment
      // ago set in anticipation of success — remove them first.
      const respondGone = () => {
        if (res.headersSent) return;
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Disposition');
        res.removeHeader('Cache-Control');
        this.endSafely(res, 410);
      };
      // `expected=true` = client disconnected (no fault of ours, no Sentry noise);
      // `expected=false` = the archive/load pipeline itself failed (storage error,
      // etc.) — a genuine fault that must stay visible (fix round 2 finding 1
      // visibility ruling).
      const failSafely = (err: unknown, expected: boolean) => {
        if (settled) return;
        settled = true;
        if (expected) {
          this.logger.debug(`[finance-share] zip stream aborted app=${appId}: ${(err as Error)?.message ?? err}`);
        } else {
          Sentry.captureException(err);
          this.logger.warn(`[finance-share] zip stream failed app=${appId}: ${(err as Error)?.message ?? err}`);
        }
        // fix round 3 finding 2: `abort()` now lives on the service's result
        // object — besides calling `archive.abort()`, it destroys every stream
        // already appended to the archive (`archive.abort()` alone never did
        // that — probe found 1 of 2 storage streams left open) and unblocks an
        // in-flight `finalize()` so `load()`'s awaited promise always settles
        // instead of hanging (probe observed the handler stuck PENDING for 3s).
        result.abort();
        if (res.headersSent) { if (!res.destroyed) res.destroy(); } else { respondGone(); }
      };
      result.archive.on('error', (err) => failSafely(err, false));
      res.on('close', () => failSafely(new Error('client disconnected'), true));
      result.archive.pipe(res);
      try {
        await result.load();
        settled = true;
      } catch (err) {
        failSafely(err, false);
      }
    } catch (err) {
      // เกิดก่อนตั้ง header ใดๆ (เช่น zipStream() เอง throw แบบไม่คาดคิด) — โทเคนไม่หลุดเพราะยังไม่
      // เขียนอะไรออกไปเลย ปล่อย HttpException ปกติ (NotFoundException) ไหลตามทางเดิม
      if (err instanceof HttpException) throw err;
      Sentry.captureException(err);
      this.logger.warn(`[finance-share] unexpected error preparing zip app=${appId ?? 'unresolved'}: ${(err as Error)?.message ?? err}`);
      if (!res.headersSent) res.status(410).end();
    }
  }

  @Post(':token/reply')
  @SkipCsrf()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  async reply(@Param('token') token: string, @Body() dto: FinanceShareReplyDto, @Req() req: Request) {
    try {
      return await this.share.reply(token, dto, this.ipHash(req));
    } catch (err) {
      // HttpException (รวม 503 ตอน PII_HASH_SALT หาย — fix round 2 finding 1c) ไหลตามทางปกติ:
      // ปลอดภัยแล้วเพราะ sentry.ts's beforeSend scrub โทเคนออกจาก event.request.url ก่อนถึง Sentry
      if (err instanceof HttpException) throw err;
      Sentry.captureException(err);
      this.logger.warn(`[finance-share] unexpected error handling reply: ${(err as Error)?.message ?? err}`);
      throw new NotFoundException(GONE_MSG);
    }
  }
}
