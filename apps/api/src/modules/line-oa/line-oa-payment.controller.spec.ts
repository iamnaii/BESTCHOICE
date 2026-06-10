import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { LineOaPaymentController } from './line-oa-payment.controller';
import { LineOaService } from './line-oa.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { PaymentEvidenceService } from './services/payment-evidence.service';
import { StorageService } from '../storage/storage.service';
import { FlexTemplatesService } from './flex-templates.service';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

// ── helpers ──────────────────────────────────────────────
function mockReq(userId?: string): Request {
  return { user: userId ? { id: userId } : undefined } as unknown as Request;
}

function dec(n: number | string): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

describe('LineOaPaymentController (characterization)', () => {
  let controller: LineOaPaymentController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lineOa: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let promptPay: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let paymentLink: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let flexTemplates: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lineFinance: any;

  beforeEach(async () => {
    prisma = {
      paymentEvidence: {
        count: jest.fn(),
        aggregate: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      paymentLink: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      contract: { findFirst: jest.fn() },
      payment: { count: jest.fn() },
      chatRoom: { findFirst: jest.fn(), update: jest.fn() },
      chatMessage: { create: jest.fn() },
      notificationLog: { create: jest.fn() },
      $transaction: jest.fn(),
    };

    lineOa = {
      buildPaymentSuccess: jest.fn().mockReturnValue({ type: 'flex' }),
      sendFlexMessage: jest.fn().mockResolvedValue(undefined),
      pushMessage: jest.fn().mockResolvedValue(undefined),
    };

    promptPay = {
      generateQrBuffer: jest.fn(),
      generateQrDataUrl: jest.fn(),
      getAccountName: jest.fn().mockReturnValue('สมชาย'),
      getMaskedPromptPayId: jest.fn().mockReturnValue('xxx-xxx-1234'),
    };

    storage = {
      configured: false,
      upload: jest.fn().mockResolvedValue(undefined),
      getSignedDownloadUrl: jest.fn(),
    };

    flexTemplates = {
      overdueNotice: jest.fn().mockReturnValue({ type: 'overdue' }),
      paymentReminder: jest.fn().mockReturnValue({ type: 'reminder' }),
    };

    lineFinance = {
      pushMessage: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LineOaPaymentController],
      providers: [
        // Real services exercised through the controller — keeps every
        // observable-behavior assertion running through the moved code.
        PaymentEvidenceService,
        PaymentLinkService,
        { provide: LineOaService, useValue: lineOa },
        { provide: PrismaService, useValue: prisma },
        { provide: PromptPayQrService, useValue: promptPay },
        { provide: StorageService, useValue: storage },
        { provide: FlexTemplatesService, useValue: flexTemplates },
        { provide: LineFinanceClientService, useValue: lineFinance },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:5173') },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LineOaPaymentController>(LineOaPaymentController);

    // PaymentLinkService.getPaymentLink / .createPaymentLink are still the
    // unit-under-test's collaborators (used by resolvePaymentLink,
    // sendPaymentFlex, and PaymentEvidenceService.uploadSlipFromLiff) —
    // spy on the real instance so the existing stubs apply.
    const realPaymentLink = module.get<PaymentLinkService>(PaymentLinkService);
    paymentLink = {
      getPaymentLink: jest.spyOn(realPaymentLink, 'getPaymentLink'),
      createPaymentLink: jest.spyOn(realPaymentLink, 'createPaymentLink'),
    };
  });

  // ─── getEvidenceStats ────────────────────────────────
  describe('getEvidenceStats', () => {
    it('returns the 4 counts + approvedAmountToday from _sum.amount', async () => {
      prisma.paymentEvidence.count
        .mockResolvedValueOnce(5) // pending
        .mockResolvedValueOnce(3) // approvedToday
        .mockResolvedValueOnce(1); // rejectedToday
      prisma.paymentEvidence.aggregate.mockResolvedValue({ _sum: { amount: dec(1500) } });

      const result = await controller.getEvidenceStats();

      expect(result).toEqual({
        pendingCount: 5,
        approvedToday: 3,
        rejectedToday: 1,
        approvedAmountToday: dec(1500),
      });
      expect(prisma.paymentEvidence.count).toHaveBeenCalledTimes(3);
      expect(prisma.paymentEvidence.aggregate).toHaveBeenCalledTimes(1);
    });

    it('falls back approvedAmountToday to 0 when _sum.amount is null', async () => {
      prisma.paymentEvidence.count.mockResolvedValue(0);
      prisma.paymentEvidence.aggregate.mockResolvedValue({ _sum: { amount: null } });

      const result = await controller.getEvidenceStats();
      expect(result.approvedAmountToday).toBe(0);
    });
  });

  // ─── getEvidenceList ─────────────────────────────────
  describe('getEvidenceList', () => {
    it('builds default where (empty) + take 50, returns rows verbatim when storage not configured', async () => {
      const rows = [{ id: 'e1', imageUrl: 'slips/key.jpg' }];
      prisma.paymentEvidence.findMany.mockResolvedValue(rows);

      const result = await controller.getEvidenceList();

      expect(result).toBe(rows);
      const arg = prisma.paymentEvidence.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({});
      expect(arg.take).toBe(50);
      expect(arg.orderBy).toEqual({ createdAt: 'desc' });
      // storage not configured → imageUrl untouched
      expect(rows[0].imageUrl).toBe('slips/key.jpg');
    });

    it('builds dynamic where for status/search/date/amount + caps take at 10000', async () => {
      prisma.paymentEvidence.findMany.mockResolvedValue([]);

      await controller.getEvidenceList(
        'PENDING_REVIEW',
        'สมชาย',
        '2026-01-01',
        '2026-01-31',
        '100',
        '5000',
        '99999',
      );

      const arg = prisma.paymentEvidence.findMany.mock.calls[0][0];
      expect(arg.where.status).toBe('PENDING_REVIEW');
      expect(arg.where.contract).toEqual({
        OR: [
          { contractNumber: { contains: 'สมชาย', mode: 'insensitive' } },
          { customer: { name: { contains: 'สมชาย', mode: 'insensitive' } } },
        ],
      });
      expect(arg.where.createdAt.gte).toEqual(new Date('2026-01-01'));
      const expectedEnd = new Date('2026-01-31');
      expectedEnd.setHours(23, 59, 59, 999);
      expect(arg.where.createdAt.lte).toEqual(expectedEnd);
      expect(arg.where.amount).toEqual({ gte: 100, lte: 5000 });
      expect(arg.take).toBe(10000); // min(99999, 10000)
    });

    it('signs S3 keys via getSignedDownloadUrl, mutates imageUrl, leaves http/absolute keys alone', async () => {
      storage.configured = true;
      storage.getSignedDownloadUrl.mockResolvedValue('https://signed/url');
      const rows = [
        { id: 'a', imageUrl: 'slips/key.jpg' },
        { id: 'b', imageUrl: 'https://already.http/x.jpg' },
        { id: 'c', imageUrl: '/local/path.jpg' },
        { id: 'd', imageUrl: null },
      ];
      prisma.paymentEvidence.findMany.mockResolvedValue(rows);

      const result = await controller.getEvidenceList();

      expect(storage.getSignedDownloadUrl).toHaveBeenCalledTimes(1);
      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('slips/key.jpg', 3600);
      expect((result[0] as { imageUrl: string }).imageUrl).toBe('https://signed/url');
      expect((result[1] as { imageUrl: string }).imageUrl).toBe('https://already.http/x.jpg');
      expect((result[2] as { imageUrl: string }).imageUrl).toBe('/local/path.jpg');
    });

    it('keeps original key if signing throws', async () => {
      storage.configured = true;
      storage.getSignedDownloadUrl.mockRejectedValue(new Error('boom'));
      const rows = [{ id: 'a', imageUrl: 'slips/key.jpg' }];
      prisma.paymentEvidence.findMany.mockResolvedValue(rows);

      const result = await controller.getEvidenceList();
      expect((result[0] as { imageUrl: string }).imageUrl).toBe('slips/key.jpg');
    });
  });

  // ─── batchApproveEvidence ────────────────────────────
  describe('batchApproveEvidence', () => {
    it('skips not-found / already-reviewed and reports them in errors', async () => {
      prisma.paymentEvidence.findUnique
        .mockResolvedValueOnce(null) // id1 not found
        .mockResolvedValueOnce({ id: 'id2', status: 'APPROVED' }); // already reviewed

      const result = await controller.batchApproveEvidence(
        { ids: ['id1', 'id2'], paymentMethod: 'CASH' },
        mockReq('u1'),
      );

      expect(result).toEqual({
        success: true,
        count: 0,
        errors: [
          'id1: ข้ามรายการ (ไม่พบหรือตรวจสอบแล้ว)',
          'id2: ข้ามรายการ (ไม่พบหรือตรวจสอบแล้ว)',
        ],
      });
      expect(prisma.paymentEvidence.update).not.toHaveBeenCalled();
    });

    it('approves + sends flex with installmentNo from linked payment', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValueOnce({
        id: 'id1',
        status: 'PENDING_REVIEW',
        amount: dec(1515.83),
        lineUserId: 'U_line',
        payment: { installmentNo: 5 },
        contract: {
          contractNumber: 'C-001',
          customer: { name: 'สมชาย' },
          payments: [
            { status: 'PAID', installmentNo: 1 },
            { status: 'PENDING', installmentNo: 2 },
          ],
        },
      });

      const result = await controller.batchApproveEvidence(
        { ids: ['id1'], paymentMethod: 'CASH' },
        mockReq('u1'),
      );

      expect(result).toEqual({ success: true, count: 1, errors: [] });
      expect(prisma.paymentEvidence.update).toHaveBeenCalledWith({
        where: { id: 'id1' },
        data: {
          status: 'APPROVED',
          amount: dec(1515.83),
          reviewedById: 'u1',
          reviewedAt: expect.any(Date),
        },
      });
      const flexArg = lineOa.buildPaymentSuccess.mock.calls[0][0];
      expect(flexArg.installmentNo).toBe(5); // from linked payment
      expect(flexArg.totalInstallments).toBe(2);
      expect(flexArg.remainingInstallments).toBe(0); // total(2) - paid(1) - 1
      expect(flexArg.amountPaid).toBe(1515.83);
      expect(lineOa.sendFlexMessage).toHaveBeenCalledWith('U_line', { type: 'flex' }, 'line-finance');
    });

    it('derives installmentNo from next-unpaid when no linked payment', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValueOnce({
        id: 'id1',
        status: 'PENDING_REVIEW',
        amount: null,
        lineUserId: 'U_line',
        payment: null,
        contract: {
          contractNumber: 'C-001',
          customer: { name: 'สมชาย' },
          payments: [
            { status: 'PAID', installmentNo: 1 },
            { status: 'PAID', installmentNo: 2 },
            { status: 'PENDING', installmentNo: 3 },
          ],
        },
      });

      await controller.batchApproveEvidence(
        { ids: ['id1'], paymentMethod: 'CASH' },
        mockReq('u1'),
      );

      const flexArg = lineOa.buildPaymentSuccess.mock.calls[0][0];
      expect(flexArg.installmentNo).toBe(3); // next unpaid
      expect(flexArg.amountPaid).toBe(0); // amount null → 0
    });

    it('falls back installmentNo to min(paidCount+1,total) when no linked + no unpaid', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValueOnce({
        id: 'id1',
        status: 'PENDING_REVIEW',
        amount: null,
        lineUserId: 'U_line',
        payment: null,
        contract: {
          contractNumber: 'C-001',
          customer: { name: 'สมชาย' },
          payments: [
            { status: 'PAID', installmentNo: 1 },
            { status: 'PAID', installmentNo: 2 },
          ],
        },
      });

      await controller.batchApproveEvidence(
        { ids: ['id1'], paymentMethod: 'CASH' },
        mockReq('u1'),
      );

      const flexArg = lineOa.buildPaymentSuccess.mock.calls[0][0];
      expect(flexArg.installmentNo).toBe(2); // min(2+1, 2)
    });

    it('still counts the approval when flex send throws (caught + logged)', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValueOnce({
        id: 'id1',
        status: 'PENDING_REVIEW',
        amount: dec(100),
        lineUserId: 'U_line',
        payment: { installmentNo: 1 },
        contract: { contractNumber: 'C-001', customer: { name: 'สมชาย' }, payments: [] },
      });
      lineOa.sendFlexMessage.mockRejectedValueOnce(new Error('line down'));

      const result = await controller.batchApproveEvidence(
        { ids: ['id1'], paymentMethod: 'CASH' },
        mockReq('u1'),
      );
      expect(result.count).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('does not send flex when evidence has no lineUserId', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValueOnce({
        id: 'id1',
        status: 'PENDING_REVIEW',
        amount: dec(100),
        lineUserId: null,
        payment: { installmentNo: 1 },
        contract: { contractNumber: 'C-001', customer: { name: 'สมชาย' }, payments: [] },
      });

      const result = await controller.batchApproveEvidence(
        { ids: ['id1'], paymentMethod: 'CASH' },
        mockReq('u1'),
      );
      expect(result.count).toBe(1);
      expect(lineOa.sendFlexMessage).not.toHaveBeenCalled();
    });

    it('captures thrown errors per-id into errors[]', async () => {
      prisma.paymentEvidence.findUnique.mockRejectedValueOnce(new Error('db fail'));

      const result = await controller.batchApproveEvidence(
        { ids: ['id1'], paymentMethod: 'CASH' },
        mockReq('u1'),
      );
      expect(result.count).toBe(0);
      expect(result.errors[0]).toContain('id1:');
      expect(result.errors[0]).toContain('db fail');
    });
  });

  // ─── batchRejectEvidence ─────────────────────────────
  describe('batchRejectEvidence', () => {
    it('skips not-found / already-reviewed', async () => {
      prisma.paymentEvidence.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'id2', status: 'REJECTED' });

      const result = await controller.batchRejectEvidence(
        { ids: ['id1', 'id2'], reviewNote: 'ไม่ชัด' },
        mockReq('u1'),
      );

      expect(result).toEqual({
        success: true,
        count: 0,
        errors: [
          'id1: ข้ามรายการ (ไม่พบหรือตรวจสอบแล้ว)',
          'id2: ข้ามรายการ (ไม่พบหรือตรวจสอบแล้ว)',
        ],
      });
    });

    it('rejects + pushes LINE text with reason', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValueOnce({
        id: 'id1',
        status: 'PENDING_REVIEW',
        lineUserId: 'U_line',
        contract: { customer: { name: 'สมชาย' } },
      });

      const result = await controller.batchRejectEvidence(
        { ids: ['id1'], reviewNote: 'สลิปไม่ชัด' },
        mockReq('u1'),
      );

      expect(result).toEqual({ success: true, count: 1, errors: [] });
      expect(prisma.paymentEvidence.update).toHaveBeenCalledWith({
        where: { id: 'id1' },
        data: {
          status: 'REJECTED',
          reviewedById: 'u1',
          reviewedAt: expect.any(Date),
          reviewNote: 'สลิปไม่ชัด',
        },
      });
      const pushArgs = lineOa.pushMessage.mock.calls[0];
      expect(pushArgs[0]).toBe('U_line');
      expect(pushArgs[1][0].text).toContain('เหตุผล: สลิปไม่ชัด');
      expect(pushArgs[2]).toBe('line-finance');
    });

    it('omits reason line when reviewNote absent', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValueOnce({
        id: 'id1',
        status: 'PENDING_REVIEW',
        lineUserId: 'U_line',
        contract: { customer: { name: 'สมชาย' } },
      });

      await controller.batchRejectEvidence({ ids: ['id1'] }, mockReq('u1'));
      const text = lineOa.pushMessage.mock.calls[0][1][0].text;
      expect(text).not.toContain('เหตุผล:');
    });
  });

  // ─── approveEvidence ─────────────────────────────────
  describe('approveEvidence', () => {
    function evidence(overrides: Record<string, unknown> = {}) {
      return {
        id: 'e1',
        status: 'PENDING_REVIEW',
        lineUserId: 'U_line',
        contract: {
          contractNumber: 'C-001',
          customer: { name: 'สมชาย' },
          payments: [
            {
              installmentNo: 1,
              amountDue: dec(1500),
              lateFee: dec(0),
              amountPaid: dec(0),
              status: 'PENDING',
            },
          ],
        },
        ...overrides,
      };
    }

    it('returns non-throwing { error } when not found', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValue(null);

      const result = await controller.approveEvidence(
        'e1',
        { installmentNo: 1, amount: 1500, paymentMethod: 'CASH' },
        mockReq('u1'),
      );
      expect(result).toEqual({ error: 'ไม่พบหลักฐาน' });
      expect(prisma.paymentEvidence.update).not.toHaveBeenCalled();
    });

    it('returns non-throwing { error } when already reviewed', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValue(evidence({ status: 'APPROVED' }));

      const result = await controller.approveEvidence(
        'e1',
        { installmentNo: 1, amount: 1500, paymentMethod: 'CASH' },
        mockReq('u1'),
      );
      expect(result).toEqual({ error: 'หลักฐานนี้ได้รับการตรวจสอบแล้ว' });
    });

    it('throws BadRequestException when amount mismatch > 100 and no acceptMismatch', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValue(evidence());

      await expect(
        controller.approveEvidence(
          'e1',
          { installmentNo: 1, amount: 1700, paymentMethod: 'CASH' }, // diff 200 > 100
          mockReq('u1'),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.paymentEvidence.update).not.toHaveBeenCalled();
    });

    it('approves when mismatch > 100 but acceptMismatch=true (override)', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValue(evidence());

      const result = await controller.approveEvidence(
        'e1',
        { installmentNo: 1, amount: 1700, paymentMethod: 'CASH', acceptMismatch: true },
        mockReq('u1'),
      );
      expect(result).toEqual({ success: true, message: 'อนุมัติสลิปเรียบร้อย' });
      expect(prisma.paymentEvidence.update).toHaveBeenCalled();
    });

    it('approves when within ±100 tolerance (no override needed)', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValue(evidence());

      const result = await controller.approveEvidence(
        'e1',
        { installmentNo: 1, amount: 1550, paymentMethod: 'CASH' }, // diff 50 <= 100
        mockReq('u1'),
      );
      expect(result).toEqual({ success: true, message: 'อนุมัติสลิปเรียบร้อย' });
      expect(prisma.paymentEvidence.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: {
          status: 'APPROVED',
          amount: 1550,
          reviewedById: 'u1',
          reviewedAt: expect.any(Date),
          reviewNote: undefined,
        },
      });
      expect(lineOa.sendFlexMessage).toHaveBeenCalledWith('U_line', { type: 'flex' }, 'line-finance');
    });

    it('skips tolerance check when no matching installment payment', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValue(
        evidence({
          contract: {
            contractNumber: 'C-001',
            customer: { name: 'สมชาย' },
            payments: [], // no installment 1
          },
        }),
      );

      const result = await controller.approveEvidence(
        'e1',
        { installmentNo: 1, amount: 99999, paymentMethod: 'CASH' },
        mockReq('u1'),
      );
      expect(result).toEqual({ success: true, message: 'อนุมัติสลิปเรียบร้อย' });
    });

    it('does not notify when no lineUserId', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValue(evidence({ lineUserId: null }));

      await controller.approveEvidence(
        'e1',
        { installmentNo: 1, amount: 1500, paymentMethod: 'CASH' },
        mockReq('u1'),
      );
      expect(lineOa.sendFlexMessage).not.toHaveBeenCalled();
    });
  });

  // ─── rejectEvidence ──────────────────────────────────
  describe('rejectEvidence', () => {
    it('returns non-throwing { error } when not found', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValue(null);
      const result = await controller.rejectEvidence('e1', {}, mockReq('u1'));
      expect(result).toEqual({ error: 'ไม่พบหลักฐาน' });
      expect(prisma.paymentEvidence.update).not.toHaveBeenCalled();
    });

    it('rejects + pushes LINE text + returns success', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValue({
        id: 'e1',
        lineUserId: 'U_line',
        contract: { customer: { name: 'สมชาย' } },
      });

      const result = await controller.rejectEvidence('e1', { reviewNote: 'เบลอ' }, mockReq('u1'));

      expect(result).toEqual({ success: true, message: 'ปฏิเสธสลิปเรียบร้อย' });
      expect(prisma.paymentEvidence.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: {
          status: 'REJECTED',
          reviewedById: 'u1',
          reviewedAt: expect.any(Date),
          reviewNote: 'เบลอ',
        },
      });
      expect(lineOa.pushMessage.mock.calls[0][1][0].text).toContain('เหตุผล: เบลอ');
    });
  });

  // ─── getSuggestedMatches ─────────────────────────────
  describe('getSuggestedMatches', () => {
    it('throws NotFoundException when evidence missing', async () => {
      prisma.paymentEvidence.findUnique.mockResolvedValue(null);
      await expect(controller.getSuggestedMatches('e1')).rejects.toThrow(NotFoundException);
    });

    it('scores by amount-diff buckets, boosts overdue, sorts desc, returns top-5', async () => {
      const today = new Date();
      const mkPayment = (
        id: string,
        installmentNo: number,
        amountDue: number,
        daysFromToday: number,
      ) => ({
        id,
        installmentNo,
        amountDue: dec(amountDue),
        lateFee: dec(0),
        amountPaid: dec(0),
        status: 'PENDING',
        dueDate: new Date(today.getTime() - daysFromToday * 86400000),
      });

      prisma.paymentEvidence.findUnique.mockResolvedValue({
        amount: dec(1000),
        contract: {
          payments: [
            mkPayment('p1', 1, 1000, 5), // exact match (diff 0 → 1.0) overdue 5d → +0.1 capped 1.0
            mkPayment('p2', 2, 1050, -10), // diff 50 → 0.85, future (not overdue)
            mkPayment('p3', 3, 1200, 0), // diff 200 → 0.65
            mkPayment('p4', 4, 1500, 0), // diff 500 → 0.4
            mkPayment('p5', 5, 3000, 0), // diff 2000 → 0.1
            mkPayment('p6', 6, 1001, 0), // diff 1 → 1.0 (extra, should be dropped by top-5)
          ],
        },
      });

      const result = await controller.getSuggestedMatches('e1');

      expect(result.evidenceId).toBe('e1');
      expect(result.slipAmount).toBe(1000);
      expect(result.suggestions).toHaveLength(5); // top-5
      // highest scores first
      expect(result.suggestions[0].score).toBe(1.0);
      // p1 exact + overdue boost capped at 1.0, p6 diff1 = 1.0 too — both 1.0, sorted by installmentNo asc
      expect(result.suggestions[0].installmentNo).toBe(1);
      const scores = result.suggestions.map((s) => s.score);
      // sorted descending
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      }
      // p1 overdue flags
      const p1 = result.suggestions.find((s) => s.paymentId === 'p1');
      expect(p1?.isOverdue).toBe(true);
      expect(p1?.daysOverdue).toBe(5);
      // p2 future → not overdue
      const p2 = result.suggestions.find((s) => s.paymentId === 'p2');
      expect(p2?.isOverdue).toBe(false);
      expect(p2?.daysOverdue).toBe(0);
    });

    it('uses 0.3 base score when slip amount is null', async () => {
      const today = new Date();
      prisma.paymentEvidence.findUnique.mockResolvedValue({
        amount: null,
        contract: {
          payments: [
            {
              id: 'p1',
              installmentNo: 1,
              amountDue: dec(1000),
              lateFee: dec(0),
              amountPaid: dec(0),
              status: 'PENDING',
              dueDate: new Date(today.getTime() + 86400000), // future, no boost
            },
          ],
        },
      });

      const result = await controller.getSuggestedMatches('e1');
      expect(result.slipAmount).toBeNull();
      expect(result.suggestions[0].score).toBe(0.3);
    });
  });

  // ─── generateQrCode ──────────────────────────────────
  describe('generateQrCode', () => {
    function mockRes(): Response {
      return {
        set: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
    }

    it('streams PNG buffer with correct headers', async () => {
      const buf = Buffer.from('png');
      promptPay.generateQrBuffer.mockResolvedValue(buf);
      const res = mockRes();

      await controller.generateQrCode('pay1', '1500', res);

      expect(promptPay.generateQrBuffer).toHaveBeenCalledWith(1500);
      expect(res.set).toHaveBeenCalledWith({
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline; filename="promptpay-qr-pay1.png"',
        'Cache-Control': 'no-cache',
      });
      expect(res.send).toHaveBeenCalledWith(buf);
    });

    it('passes undefined amount when amountStr empty', async () => {
      promptPay.generateQrBuffer.mockResolvedValue(Buffer.from('x'));
      const res = mockRes();
      await controller.generateQrCode('pay1', '', res);
      expect(promptPay.generateQrBuffer).toHaveBeenCalledWith(undefined);
    });

    it('returns 500 json error on generation failure', async () => {
      promptPay.generateQrBuffer.mockRejectedValue(new Error('qr fail'));
      const res = mockRes();
      await controller.generateQrCode('pay1', '1500', res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'ไม่สามารถสร้าง QR Code ได้' });
    });
  });

  // ─── resolvePaymentLink ──────────────────────────────
  describe('resolvePaymentLink', () => {
    it('returns { valid:false } when link not found', async () => {
      paymentLink.getPaymentLink.mockResolvedValue(null);
      const result = await controller.resolvePaymentLink('tok');
      expect(result).toEqual({ error: 'ลิงก์ชำระเงินไม่ถูกต้อง', valid: false });
    });

    it('returns { valid:false, status } when not ACTIVE', async () => {
      paymentLink.getPaymentLink.mockResolvedValue({ status: 'USED' });
      const result = await controller.resolvePaymentLink('tok');
      expect(result).toEqual({
        error: 'ลิงก์ชำระเงินหมดอายุหรือถูกใช้แล้ว',
        valid: false,
        status: 'USED',
      });
    });

    it('returns { valid:false } when no contract (online-order link)', async () => {
      paymentLink.getPaymentLink.mockResolvedValue({ status: 'ACTIVE', contract: null });
      const result = await controller.resolvePaymentLink('tok');
      expect(result).toEqual({ error: 'ลิงก์ชำระเงินไม่ถูกต้อง', valid: false });
    });

    it('returns full masked response for a valid contract link', async () => {
      promptPay.generateQrDataUrl.mockResolvedValue('data:image/png;base64,xx');
      const expiresAt = new Date('2026-02-01');
      const dueDate = new Date('2026-01-15');
      paymentLink.getPaymentLink.mockResolvedValue({
        status: 'ACTIVE',
        amount: dec(1500),
        expiresAt,
        contract: {
          id: 'ct1',
          contractNumber: 'C-001',
          customer: { name: 'สมชาย ใจดี' },
        },
        payment: {
          installmentNo: 3,
          amountDue: dec(1400),
          lateFee: dec(100),
          dueDate,
        },
      });

      const result = await controller.resolvePaymentLink('tok');

      expect(result).toEqual({
        valid: true,
        token: 'tok',
        amount: 1500,
        status: 'ACTIVE',
        expiresAt,
        contract: {
          id: 'ct1',
          contractNumber: 'C-001',
          customer: { name: expect.any(String) }, // masked
        },
        payment: {
          installmentNo: 3,
          amountDue: 1400,
          lateFee: 100,
          dueDate,
        },
        promptPay: {
          qrDataUrl: 'data:image/png;base64,xx',
          accountName: 'สมชาย',
          maskedId: 'xxx-xxx-1234',
        },
      });
      // name was masked (not the raw name)
      expect((result as { contract: { customer: { name: string } } }).contract.customer.name).not.toBe(
        'สมชาย ใจดี',
      );
    });

    it('returns qrDataUrl null when QR generation fails', async () => {
      promptPay.generateQrDataUrl.mockRejectedValue(new Error('boom'));
      paymentLink.getPaymentLink.mockResolvedValue({
        status: 'ACTIVE',
        amount: dec(1500),
        expiresAt: new Date(),
        contract: { id: 'ct1', contractNumber: 'C-001', customer: { name: 'สมชาย' } },
        payment: { installmentNo: 1, amountDue: dec(1500), lateFee: dec(0), dueDate: new Date() },
      });

      const result = await controller.resolvePaymentLink('tok');
      expect(
        (result as { promptPay: { qrDataUrl: string | null } }).promptPay.qrDataUrl,
      ).toBeNull();
    });
  });

  // ─── uploadSlipFromLiff ──────────────────────────────
  describe('uploadSlipFromLiff', () => {
    const file = {
      mimetype: 'image/jpeg',
      buffer: Buffer.from('img'),
    } as Express.Multer.File;

    function activeLink(overrides: Record<string, unknown> = {}) {
      return {
        id: 'link1',
        status: 'ACTIVE',
        amount: dec(1500),
        payment: { id: 'pay1', installmentNo: 2 },
        contract: {
          id: 'ct1',
          contractNumber: 'C-001',
          totalMonths: 12,
          customer: { name: 'สมชาย', lineIdFinance: 'U_line' },
        },
        ...overrides,
      };
    }

    it('throws BadRequest when link missing/expired', async () => {
      paymentLink.getPaymentLink.mockResolvedValue(null);
      await expect(
        controller.uploadSlipFromLiff(file, { token: 'tok' }),
      ).rejects.toThrow(BadRequestException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws BadRequest when link has no contract', async () => {
      paymentLink.getPaymentLink.mockResolvedValue({ id: 'l', status: 'ACTIVE', contract: null });
      await expect(
        controller.uploadSlipFromLiff(file, { token: 'tok' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('uploads to storage BEFORE tx, runs $transaction (TOCTOU recheck + create + notify + mark-used), confirms via LINE after', async () => {
      paymentLink.getPaymentLink.mockResolvedValue(activeLink());
      prisma.payment.count.mockResolvedValue(1);

      // Capture the tx callback to introspect its operations
      const tx = {
        paymentLink: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }), update: jest.fn() },
        paymentEvidence: { create: jest.fn().mockResolvedValue({ id: 'ev1' }) },
        notificationLog: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

      const result = await controller.uploadSlipFromLiff(file, { token: 'tok', amount: '1500' });

      // storage upload before tx
      expect(storage.upload).toHaveBeenCalledTimes(1);
      const uploadKey = storage.upload.mock.calls[0][0] as string;
      expect(uploadKey).toMatch(/^slips\/slip-liff-\d+-[a-z0-9]+\.jpg$/);
      expect(storage.upload).toHaveBeenCalledWith(uploadKey, file.buffer, 'image/jpeg');

      // tx ran
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // TOCTOU recheck
      expect(tx.paymentLink.findUnique).toHaveBeenCalledWith({
        where: { id: 'link1' },
        select: { status: true },
      });
      // evidence create
      expect(tx.paymentEvidence.create).toHaveBeenCalledWith({
        data: {
          contractId: 'ct1',
          paymentId: 'pay1',
          lineUserId: 'U_line',
          imageUrl: uploadKey,
          amount: dec(1500),
          status: 'PENDING_REVIEW',
        },
      });
      // notification
      expect(tx.notificationLog.create).toHaveBeenCalledTimes(1);
      expect(tx.notificationLog.create.mock.calls[0][0].data.relatedId).toBe('ev1');
      // mark link used
      expect(tx.paymentLink.update).toHaveBeenCalledWith({
        where: { id: 'link1' },
        data: { status: 'USED', usedAt: expect.any(Date) },
      });
      // LINE confirm after tx
      expect(lineOa.sendFlexMessage).toHaveBeenCalledWith('U_line', { type: 'flex' }, 'line-finance');
      const flexArg = lineOa.buildPaymentSuccess.mock.calls[0][0];
      expect(flexArg.installmentNo).toBe(2);
      expect(flexArg.totalInstallments).toBe(12);
      expect(flexArg.amountPaid).toBe(1500);
      expect(flexArg.remainingInstallments).toBe(11); // total(12) - paidCount(1)

      expect(result).toEqual({ success: true, message: 'อัพโหลดสลิปเรียบร้อย กำลังตรวจสอบ' });
    });

    it('throws BadRequest inside tx when TOCTOU recheck fails (link used concurrently)', async () => {
      paymentLink.getPaymentLink.mockResolvedValue(activeLink());
      const tx = {
        paymentLink: { findUnique: jest.fn().mockResolvedValue({ status: 'USED' }), update: jest.fn() },
        paymentEvidence: { create: jest.fn() },
        notificationLog: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

      await expect(
        controller.uploadSlipFromLiff(file, { token: 'tok' }),
      ).rejects.toThrow(BadRequestException);
      expect(tx.paymentEvidence.create).not.toHaveBeenCalled();
    });

    it('amount null when body.amount absent; lineUserId null when customer has none', async () => {
      paymentLink.getPaymentLink.mockResolvedValue(
        activeLink({
          contract: {
            id: 'ct1',
            contractNumber: 'C-001',
            totalMonths: 12,
            customer: { name: 'สมชาย', lineIdFinance: null },
          },
        }),
      );
      const tx = {
        paymentLink: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }), update: jest.fn() },
        paymentEvidence: { create: jest.fn().mockResolvedValue({ id: 'ev1' }) },
        notificationLog: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

      await controller.uploadSlipFromLiff(file, { token: 'tok' });

      const createArg = tx.paymentEvidence.create.mock.calls[0][0];
      expect(createArg.data.amount).toBeNull();
      expect(createArg.data.lineUserId).toBeNull();
      // no LINE confirm without customer line id
      expect(lineOa.sendFlexMessage).not.toHaveBeenCalled();
    });

    it('uses .png ext for image/png', async () => {
      paymentLink.getPaymentLink.mockResolvedValue(activeLink());
      const tx = {
        paymentLink: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }), update: jest.fn() },
        paymentEvidence: { create: jest.fn().mockResolvedValue({ id: 'ev1' }) },
        notificationLog: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
      prisma.payment.count.mockResolvedValue(0);

      await controller.uploadSlipFromLiff(
        { mimetype: 'image/png', buffer: Buffer.from('x') } as Express.Multer.File,
        { token: 'tok' },
      );
      const uploadKey = storage.upload.mock.calls[0][0] as string;
      expect(uploadKey).toMatch(/\.png$/);
    });
  });

  // ─── createPaymentLink ───────────────────────────────
  describe('createPaymentLink', () => {
    it('delegates to service and spreads result with success:true', async () => {
      paymentLink.createPaymentLink.mockResolvedValue({
        token: 't',
        url: 'http://x/pay/t',
        expiresAt: new Date('2026-02-01'),
        amount: 1500,
      });

      const result = await controller.createPaymentLink({ contractId: 'ct1', installmentNo: 3 });

      expect(paymentLink.createPaymentLink).toHaveBeenCalledWith('ct1', 3);
      expect(result).toEqual({
        success: true,
        token: 't',
        url: 'http://x/pay/t',
        expiresAt: new Date('2026-02-01'),
        amount: 1500,
      });
    });
  });

  // ─── sendPaymentFlex ─────────────────────────────────
  describe('sendPaymentFlex', () => {
    const reqUser = { user: { id: 'staff1' } };

    it('throws BadRequest when contractId missing', async () => {
      await expect(controller.sendPaymentFlex({ contractId: '' }, reqUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFound when contract not found', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);
      await expect(controller.sendPaymentFlex({ contractId: 'ct1' }, reqUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequest when customer has no finance LINE link', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        contractNumber: 'C-001',
        customer: { id: 'cu1', name: 'สมชาย', lineLinks: [] },
        payments: [{ installmentNo: 1, dueDate: new Date(), lateFee: dec(0) }],
      });
      await expect(controller.sendPaymentFlex({ contractId: 'ct1' }, reqUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequest when no unpaid installments', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        contractNumber: 'C-001',
        customer: { id: 'cu1', name: 'สมชาย', lineLinks: [{ lineUserId: 'U_line' }] },
        payments: [],
      });
      await expect(controller.sendPaymentFlex({ contractId: 'ct1' }, reqUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sends reminder flex + writes chatMessage with payment-reminder metaText when not overdue', async () => {
      const future = new Date(Date.now() + 10 * 86400000);
      prisma.contract.findFirst.mockResolvedValue({
        id: 'ct1',
        contractNumber: 'C-001',
        customer: { id: 'cu1', name: 'สมชาย', lineLinks: [{ lineUserId: 'U_line' }] },
        payments: [{ installmentNo: 4, dueDate: future, lateFee: dec(0) }],
      });
      paymentLink.createPaymentLink.mockResolvedValue({
        token: 't',
        url: 'http://x/pay/t',
        expiresAt: new Date(),
        amount: 1500,
      });
      prisma.payment.count.mockResolvedValue(12); // totalInstallments
      prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room1' });

      const result = await controller.sendPaymentFlex({ contractId: 'ct1' }, reqUser);

      expect(flexTemplates.paymentReminder).toHaveBeenCalled();
      expect(flexTemplates.overdueNotice).not.toHaveBeenCalled();
      expect(lineFinance.pushMessage).toHaveBeenCalledWith('U_line', [{ type: 'reminder' }]);
      const msgText = prisma.chatMessage.create.mock.calls[0][0].data.text as string;
      expect(msgText).toContain('[flex:payment-reminder|C-001|4/12|1500|');
      expect(msgText).toContain('http://x/pay/t');
      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room1' },
        data: { lastMessageAt: expect.any(Date), totalMessages: { increment: 1 } },
      });
      expect(result).toEqual({ success: true, type: 'reminder', url: 'http://x/pay/t' });
    });

    it('sends overdue flex + writes overdue-notice metaText when overdue', async () => {
      const past = new Date(Date.now() - 10 * 86400000);
      prisma.contract.findFirst.mockResolvedValue({
        id: 'ct1',
        contractNumber: 'C-001',
        customer: { id: 'cu1', name: 'สมชาย', lineLinks: [{ lineUserId: 'U_line' }] },
        payments: [{ installmentNo: 2, dueDate: past, lateFee: dec(50) }],
      });
      paymentLink.createPaymentLink.mockResolvedValue({
        token: 't',
        url: 'http://x/pay/t',
        expiresAt: new Date(),
        amount: 2000,
      });
      prisma.payment.count.mockResolvedValue(12);
      prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room1' });

      const result = await controller.sendPaymentFlex({ contractId: 'ct1' }, reqUser);

      expect(flexTemplates.overdueNotice).toHaveBeenCalled();
      expect(lineFinance.pushMessage).toHaveBeenCalledWith('U_line', [{ type: 'overdue' }]);
      const msgText = prisma.chatMessage.create.mock.calls[0][0].data.text as string;
      expect(msgText).toContain('[flex:overdue-notice|C-001|1|2000|50|');
      expect(result).toEqual({ success: true, type: 'overdue', url: 'http://x/pay/t' });
    });

    it('throws BadRequest when LINE push fails', async () => {
      const future = new Date(Date.now() + 10 * 86400000);
      prisma.contract.findFirst.mockResolvedValue({
        id: 'ct1',
        contractNumber: 'C-001',
        customer: { id: 'cu1', name: 'สมชาย', lineLinks: [{ lineUserId: 'U_line' }] },
        payments: [{ installmentNo: 1, dueDate: future, lateFee: dec(0) }],
      });
      paymentLink.createPaymentLink.mockResolvedValue({
        token: 't',
        url: 'http://x/pay/t',
        expiresAt: new Date(),
        amount: 1500,
      });
      prisma.payment.count.mockResolvedValue(12);
      lineFinance.pushMessage.mockRejectedValue(new Error('push fail'));

      await expect(controller.sendPaymentFlex({ contractId: 'ct1' }, reqUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('skips chatMessage when no chat room exists', async () => {
      const future = new Date(Date.now() + 10 * 86400000);
      prisma.contract.findFirst.mockResolvedValue({
        id: 'ct1',
        contractNumber: 'C-001',
        customer: { id: 'cu1', name: 'สมชาย', lineLinks: [{ lineUserId: 'U_line' }] },
        payments: [{ installmentNo: 1, dueDate: future, lateFee: dec(0) }],
      });
      paymentLink.createPaymentLink.mockResolvedValue({
        token: 't',
        url: 'http://x/pay/t',
        expiresAt: new Date(),
        amount: 1500,
      });
      prisma.payment.count.mockResolvedValue(12);
      prisma.chatRoom.findFirst.mockResolvedValue(null);

      const result = await controller.sendPaymentFlex({ contractId: 'ct1' }, reqUser);
      expect(prisma.chatMessage.create).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });
});
