import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { pipeline } from 'stream/promises';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { FinanceShareService } from './services/finance-share.service';
import { buildFinanceSharePage, buildGonePage, LINE_GROUP_NAME } from './services/finance-share-page.util';
import { FinanceShareReplyDto } from './dto/finance-share-reply.dto';

/**
 * หน้าลิงก์ชุดเช็คเครดิตสำหรับเจ้าหน้าที่ GFIN — public (ไม่มี JwtAuthGuard) ตาม spec §6/§12:
 * - เข้าถึงด้วยโทเคน 256 บิตอย่างเดียว (ค้นด้วย sha256 hash) · หมดอายุ 7 วัน · ยกเลิกได้
 * - ทุก route throttle ต่อ IP · POST reply ใช้ @SkipCsrf() เพราะไม่มี session — โทเคนในพาธคือหลักฐานสิทธิ์
 * - "ไม่พบ/หมดอายุ/ยกเลิก/ล้างแล้ว" ตอบหน้า 410 เดียวกัน ไม่บอกว่าโทเคนเคยมีอยู่ไหม
 * - ห้าม log โทเคนดิบ — log เฉพาะ application id หลัง resolve
 * ดู `.claude/rules/security.md` รายการ Intentionally Public Endpoints (`finance-share-public`)
 */
@Controller('g')
export class FinanceSharePublicController {
  constructor(private share: FinanceShareService, private config: ConfigService) {}

  /** spec §12: sha256(salt ประจำระบบ + IP + วันตาม BKK) — ไม่เก็บ IP ดิบ · salt = PII_HASH_SALT (secret ที่ prod มีอยู่แล้ว) */
  private ipHash(req: Request): string {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || '';
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
    const salt = this.config.get<string>('PII_HASH_SALT') ?? '';
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

  @Get(':token')
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  async page(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const nonce = randomBytes(16).toString('base64');
    const r = await this.share.resolve(token);
    this.htmlHeaders(res, nonce);
    if (r.state !== 'OK') return res.status(410).send(buildGonePage(nonce));
    await this.share.recordView(r.app.id, this.ipHash(req), req.headers['user-agent']);
    const base = `/api/g/${encodeURIComponent(token)}`;
    const groups = this.share.groups(r.app, (fileId) => `${base}/files/${fileId}`);
    return res.status(200).send(buildFinanceSharePage({
      nonce, number: r.app.number, status: r.app.status, expiresAt: r.app.shareExpiresAt!,
      messageText: r.app.messageText ?? '', groups, zipUrl: `${base}/zip`, replyUrl: `${base}/reply`,
      fileCount: groups.reduce((n, g) => n + g.files.length, 0), lineGroupName: LINE_GROUP_NAME,
    }));
  }

  @Get(':token/files/:fileId')
  @Throttle({ short: { limit: 120, ttl: 60_000 } })
  async file(@Param('token') token: string, @Param('fileId') fileId: string, @Res() res: Response) {
    const { file, stream } = await this.share.fileStream(token, fileId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName ?? file.id)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(stream, res);
  }

  @Get(':token/zip')
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  async zip(@Param('token') token: string, @Res() res: Response) {
    const { filename, archive, load } = await this.share.zipStream(token);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    archive.on('error', (err) => { res.destroy(err); });
    archive.pipe(res);
    await load();
  }

  @Post(':token/reply')
  @SkipCsrf()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  reply(@Param('token') token: string, @Body() dto: FinanceShareReplyDto, @Req() req: Request) {
    return this.share.reply(token, dto, this.ipHash(req));
  }
}
