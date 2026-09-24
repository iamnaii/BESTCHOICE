import { Body, Controller, Get, HttpException, Logger, NotFoundException, Param, Post, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
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

  /** จบ response แบบไม่ให้ error ไหลออกไปที่ global filter — ใช้ทั้งตอนยังไม่ส่ง header และส่งไปแล้ว */
  private endSafely(res: Response, status: number) {
    try {
      if (res.headersSent) { if (!res.writableEnded) res.end(); return; }
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
      this.logger.warn(`[finance-share] unexpected error serving page: ${(err as Error)?.message ?? err}`);
      if (!res.headersSent) { this.htmlHeaders(res, nonce); return res.status(410).send(buildGonePage(nonce)); }
      return this.endSafely(res, 410);
    }
  }

  @Get(':token/files/:fileId')
  @Throttle({ short: { limit: 120, ttl: 60_000 } })
  async file(@Param('token') token: string, @Param('fileId') fileId: string, @Res() res: Response) {
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
      // JSON ตามปกติ (ปลอดภัย ไม่มีโทเคนในข้อความ)
      if (err instanceof HttpException && !res.headersSent) throw err;
      // ที่เหลือทั้งหมด: premature close ตอนลูกค้าปิด lightbox/เปลี่ยนหน้า (no-store บังคับ
      // refetch ทุกครั้ง) หรือ error ที่ไม่คาดคิดระหว่างเตรียม/สตรีมไฟล์ — ต้องไม่ปล่อยให้ error
      // ไหลไปที่ SentryExceptionFilter (CRITICAL finding: จะ log request.url ที่มีโทเคนดิบติดอยู่)
      this.logger.debug(`[finance-share] file stream ended early app=${appId}: ${(err as Error)?.message ?? err}`);
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
      // ปิดทางค้าง (fix round 1 Important 2): ถ้า header ถูกส่งไปแล้วบางส่วนตอน error เกิด ต้อง
      // destroy การเชื่อมต่อ (rewrite status ไม่ได้อีกแล้ว) — ถ้ายังไม่ส่งอะไรเลยตอบ 410 ธรรมดาได้
      const failSafely = (err: unknown) => {
        if (settled) return;
        settled = true;
        this.logger.warn(`[finance-share] zip stream failed app=${appId}: ${(err as Error)?.message ?? err}`);
        try { if (!result.archive.destroyed) result.archive.abort(); } catch { /* ปิดไปแล้ว */ }
        this.endSafely(res, 410);
      };
      result.archive.on('error', failSafely);
      res.on('close', () => failSafely(new Error('client disconnected')));
      result.archive.pipe(res);
      try {
        await result.load();
        settled = true;
      } catch (err) {
        failSafely(err);
      }
    } catch (err) {
      // เกิดก่อนตั้ง header ใดๆ (เช่น zipStream() เอง throw แบบไม่คาดคิด) — โทเคนไม่หลุดเพราะยังไม่
      // เขียนอะไรออกไปเลย ปล่อย HttpException ปกติ (NotFoundException) ไหลตามทางเดิม
      if (err instanceof HttpException) throw err;
      this.logger.warn(`[finance-share] unexpected error preparing zip app=${appId}: ${(err as Error)?.message ?? err}`);
      this.endSafely(res, 410);
    }
  }

  @Post(':token/reply')
  @SkipCsrf()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  async reply(@Param('token') token: string, @Body() dto: FinanceShareReplyDto, @Req() req: Request) {
    try {
      return await this.share.reply(token, dto, this.ipHash(req));
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`[finance-share] unexpected error handling reply: ${(err as Error)?.message ?? err}`);
      throw new NotFoundException(GONE_MSG);
    }
  }
}
