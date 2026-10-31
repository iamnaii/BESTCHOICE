import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { LineChannelType } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  LIFF_DOWNLOAD_TICKET_INVALID_MESSAGE,
  LiffDownloadController,
} from './liff-download.controller';
import { LiffTokenGuard } from './guards/liff-token.guard';
import { LIFF_CHANNEL_KEY } from './guards/liff-channel.decorator';
import { LiffDownloadTicketDto } from './dto/liff.dto';

/**
 * Task 22 M-3 — ลิงก์ดาวน์โหลดของหน้า LIFF ไม่พก id_token ใน URL: หน้าเว็บแลก id_token (header) เป็นตั๋วครั้งเดียว 60 วิ
 * แล้วเปิด `…?dl=<ตั๋ว>` · ตั๋ว = หลักฐานเดียวของ GET (ไม่มี LiffTokenGuard) และผูกกับ LINE + เอกสาร
 */
describe('LiffDownloadController', () => {
  const LINE = 'U-line-a';
  const RECEIPT = '0b9c1a52-2f0c-4b8e-9d55-6f0a8e1d2c3b';
  const CONTRACT = '7d4e2a10-1c3b-4f6a-8e2d-9b0c5a1f3e47';
  let liff: { resolveDownloadDocumentId: jest.Mock };
  let tickets: { issue: jest.Mock; consume: jest.Mock };
  let documents: { getDocumentStream: jest.Mock };
  let controller: LiffDownloadController;
  let res: { set: jest.Mock };
  let stream: { pipe: jest.Mock };

  beforeEach(() => {
    liff = { resolveDownloadDocumentId: jest.fn().mockResolvedValue('edoc-1') };
    tickets = { issue: jest.fn().mockResolvedValue('TICKET'), consume: jest.fn() };
    stream = { pipe: jest.fn() };
    documents = {
      getDocumentStream: jest
        .fn()
        .mockResolvedValue({ stream, filename: 'ใบเสร็จ.pdf', contentType: 'application/pdf' }),
    };
    res = { set: jest.fn() };
    controller = new LiffDownloadController(liff as never, tickets as never, documents as never);
  });

  const req = { liffUserId: LINE } as never;
  const getReq = { method: 'GET' } as never;

  describe('POST liff/download-ticket', () => {
    it('ตรวจว่าเป็นเอกสารของ LINE นี้ก่อน แล้วออกตั๋วผูก (LINE, ชนิด, id)', async () => {
      await expect(
        controller.issueDownloadTicket(req, { kind: 'receipt', resourceId: RECEIPT }),
      ).resolves.toEqual({ ticket: 'TICKET' });
      expect(liff.resolveDownloadDocumentId).toHaveBeenCalledWith(LINE, 'receipt', RECEIPT);
      expect(tickets.issue).toHaveBeenCalledWith(LINE, 'receipt', RECEIPT);
    });

    it('ไม่ใช่เอกสารของ LINE นี้ / ไม่มีไฟล์ → 404 ข้อความเดิม ไม่ออกตั๋ว', async () => {
      liff.resolveDownloadDocumentId.mockRejectedValue(new NotFoundException('ไม่พบใบเสร็จ'));
      await expect(
        controller.issueDownloadTicket(req, { kind: 'receipt', resourceId: RECEIPT }),
      ).rejects.toThrow('ไม่พบใบเสร็จ');
      expect(tickets.issue).not.toHaveBeenCalled();
    });

    it('ต้องผ่าน LiffTokenGuard (header) และเป็นช่อง FINANCE', () => {
      const handler = LiffDownloadController.prototype.issueDownloadTicket;
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([LiffTokenGuard]);
      expect(Reflect.getMetadata(LIFF_CHANNEL_KEY, handler)).toBe(LineChannelType.FINANCE);
    });

    it('DTO: ชนิดเอกสารต้องอยู่ในรายการ · id ต้องเป็น UUID', async () => {
      const ok = plainToInstance(LiffDownloadTicketDto, {
        kind: 'contract-document',
        resourceId: CONTRACT,
      });
      expect(await validate(ok)).toHaveLength(0);
      const bad = plainToInstance(LiffDownloadTicketDto, { kind: 'payslip', resourceId: '../etc' });
      const errors = await validate(bad);
      expect(errors.map((e) => e.property).sort()).toEqual(['kind', 'resourceId']);
    });
  });

  describe('GET ด้วยตั๋ว ?dl=', () => {
    it('ใบเสร็จ: ใช้ตั๋ว → ตรวจเจ้าของด้วย LINE ของตั๋ว → ส่งไฟล์', async () => {
      tickets.consume.mockResolvedValue(LINE);
      await controller.downloadLiffReceipt(getReq, res as never, RECEIPT, 'TICKET');
      expect(tickets.consume).toHaveBeenCalledWith('TICKET', 'receipt', RECEIPT);
      expect(liff.resolveDownloadDocumentId).toHaveBeenCalledWith(LINE, 'receipt', RECEIPT);
      expect(documents.getDocumentStream).toHaveBeenCalledWith('edoc-1');
      expect(res.set).toHaveBeenCalledWith({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${encodeURIComponent('ใบเสร็จ.pdf')}"`,
      });
      expect(stream.pipe).toHaveBeenCalledWith(res);
    });

    it('สัญญา: ใช้ตั๋วชนิด contract-document กับ id ในพาธ', async () => {
      tickets.consume.mockResolvedValue(LINE);
      await controller.getLiffContractDocument(getReq, res as never, CONTRACT, 'TICKET');
      expect(tickets.consume).toHaveBeenCalledWith('TICKET', 'contract-document', CONTRACT);
      expect(liff.resolveDownloadDocumentId).toHaveBeenCalledWith(
        LINE,
        'contract-document',
        CONTRACT,
      );
      expect(stream.pipe).toHaveBeenCalledWith(res);
    });

    it.each([
      ['ไม่มีตั๋ว', undefined],
      ['ตั๋วใช้แล้ว / หมดอายุ / ผิดเอกสาร / ผิด LINE (consume = null)', 'TICKET'],
    ])('%s → 401 ข้อความไทย ไม่แตะเอกสาร', async (_label, dl) => {
      tickets.consume.mockResolvedValue(null);
      const err = await controller
        .downloadLiffReceipt(getReq, res as never, RECEIPT, dl)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).message).toBe(LIFF_DOWNLOAD_TICKET_INVALID_MESSAGE);
      expect(liff.resolveDownloadDocumentId).not.toHaveBeenCalled();
      expect(documents.getDocumentStream).not.toHaveBeenCalled();
    });

    it('LINE ของตั๋วไม่ใช่เจ้าของเอกสารแล้ว (ยกเลิกผูกระหว่างนั้น) → 404 ไม่ส่งไฟล์', async () => {
      tickets.consume.mockResolvedValue(LINE);
      liff.resolveDownloadDocumentId.mockRejectedValue(new NotFoundException('ไม่พบข้อมูลลูกค้า'));
      await expect(
        controller.downloadLiffReceipt(getReq, res as never, RECEIPT, 'TICKET'),
      ).rejects.toThrow('ไม่พบข้อมูลลูกค้า');
      expect(documents.getDocumentStream).not.toHaveBeenCalled();
    });

    it('GET ไม่มี LiffTokenGuard (ลิงก์แท็บใหม่แนบ header ไม่ได้ — ตั๋วคือหลักฐาน) ทั้งระดับคลาสและเมธอด', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, LiffDownloadController)).toBeUndefined();
      for (const handler of [
        LiffDownloadController.prototype.downloadLiffReceipt,
        LiffDownloadController.prototype.getLiffContractDocument,
      ]) {
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
      }
    });
  });
});
