import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LineChannelType } from '@prisma/client';
import { Request, Response } from 'express';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { DocumentsService } from '../contracts/documents.service';
import { LiffDownloadTicketDto } from './dto/liff.dto';
import { LiffChannel } from './guards/liff-channel.decorator';
import { LiffRequest, LiffTokenGuard } from './guards/liff-token.guard';
import { LiffApiService } from './liff-api.service';
import {
  LiffDownloadKind,
  LiffDownloadTicketService,
} from './services/liff-download-ticket.service';

/** ตั๋วไม่มี / ใช้แล้ว / หมดอายุ / ไม่ใช่เอกสารนี้ — ข้อความเดียวกันทุกกรณี (ผู้ใช้เห็นในแท็บที่เปิดเอกสาร) */
export const LIFF_DOWNLOAD_TICKET_INVALID_MESSAGE =
  'ลิงก์ดาวน์โหลดหมดอายุหรือถูกใช้แล้ว — กลับไปหน้าเดิมในไลน์แล้วกดดาวน์โหลดอีกครั้ง';

/**
 * ดาวน์โหลดเอกสารของหน้า LIFF การเงิน (สัญญา PDF · ใบเสร็จ PDF) — Task 22 M-3
 *
 * ลิงก์เปิดแท็บใหม่ (`<a target="_blank">`) แนบ header `X-Liff-Id-Token` ไม่ได้ ⇒ เดิมใส่ id_token ใน `?idToken=` ซึ่งไปอยู่ใน
 * access log ของ Cloud Run/Firebase และใช้ยืนยันตัวตนกับ LINE ได้จนหมดอายุ. ตอนนี้หน้าเว็บแลก id_token (header ผ่าน
 * `LiffTokenGuard`) เป็นตั๋วครั้งเดียว 60 วิ ที่ผูกกับ (LINE, ชนิดเอกสาร, id) แล้วเปิด `…?dl=<ตั๋ว>`.
 *
 * แยก controller จาก `LiffApiController` เพราะตัวนั้นติด `LiffTokenGuard` ระดับคลาส (GET ดาวน์โหลดต้องไม่ต้องใช้ header) ·
 * GET ไม่มี guard ตัวตน — **ตั๋วคือหลักฐานเดียว** แล้วตรวจความเป็นเจ้าของซ้ำด้วย LINE ที่ผูกกับตั๋ว (ทางเดียวกับตอนออกตั๋ว)
 */
@ApiTags('LIFF API')
@Controller('line-oa')
@SkipCsrf()
export class LiffDownloadController {
  constructor(
    private readonly liffApiService: LiffApiService,
    private readonly tickets: LiffDownloadTicketService,
    private readonly documentsService: DocumentsService,
  ) {}

  @Post('liff/download-ticket')
  @UseGuards(LiffTokenGuard)
  @LiffChannel(LineChannelType.FINANCE)
  @Throttle({ short: { ttl: 60000, limit: 30 } })
  async issueDownloadTicket(
    @Req() req: Request,
    @Body() dto: LiffDownloadTicketDto,
  ): Promise<{ ticket: string }> {
    const lineId = (req as unknown as LiffRequest).liffUserId;
    await this.liffApiService.resolveDownloadDocumentId(lineId, dto.kind, dto.resourceId);
    return { ticket: await this.tickets.issue(lineId, dto.kind, dto.resourceId) };
  }

  @Get('liff/contracts/:contractId/document')
  @Throttle({ short: { ttl: 60000, limit: 30 } })
  async getLiffContractDocument(
    @Req() req: Request,
    @Res() res: Response,
    @Param('contractId') contractId: string,
    @Query('dl') dl: string | undefined,
  ): Promise<void> {
    await this.stream(req, res, 'contract-document', contractId, dl);
  }

  @Get('liff/receipts/:receiptId/download')
  @Throttle({ short: { ttl: 60000, limit: 30 } })
  async downloadLiffReceipt(
    @Req() req: Request,
    @Res() res: Response,
    @Param('receiptId') receiptId: string,
    @Query('dl') dl: string | undefined,
  ): Promise<void> {
    await this.stream(req, res, 'receipt', receiptId, dl);
  }

  /**
   * Task 24 (Task 22 review M-5) — Express ส่ง `HEAD` เข้า handler ของ `@Get` ด้วย ⇒ ตัว preview/prefetch ของ in-app browser ที่ยิง HEAD
   * ก่อนเคยเผาตั๋ว (แท็บจริงได้ 401). **เฉพาะ `GET` ใช้ตั๋ว** · `HEAD` (และเมธอดอื่นที่ไหลมา) = 405 `Allow: GET` ไม่แตะตั๋ว/DB/เอกสาร:
   * ตอบ HEAD ให้ตรงกับ GET (RFC 9110 §9.3.2) ต้องตรวจตั๋ว ซึ่งตรวจได้ทางเดียวคือใช้ (เผา) มัน — แอบดูตั๋วโดยไม่เผาจะบอกผู้ยิง prefetch ว่า
   * ตั๋วใช้ได้ไหม และเป็นทางที่สองของการตรวจตั๋ว ⇒ ตอบว่าทรัพยากรนี้ไม่รองรับเมธอดนั้น (405 + `Allow` — RFC 9110 §15.5.6) ตอบเหมือนกันทุกตั๋ว
   */
  private async stream(
    req: Request,
    res: Response,
    kind: LiffDownloadKind,
    resourceId: string,
    dl: string | undefined,
  ): Promise<void> {
    if (req.method !== 'GET') {
      res.status(405).set('Allow', 'GET').end();
      return;
    }
    const lineId = await this.tickets.consume(dl, kind, resourceId);
    if (!lineId) throw new UnauthorizedException(LIFF_DOWNLOAD_TICKET_INVALID_MESSAGE);
    const documentId = await this.liffApiService.resolveDownloadDocumentId(
      lineId,
      kind,
      resourceId,
    );
    const { stream, filename, contentType } =
      await this.documentsService.getDocumentStream(documentId);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
    });
    stream.pipe(res);
  }
}
