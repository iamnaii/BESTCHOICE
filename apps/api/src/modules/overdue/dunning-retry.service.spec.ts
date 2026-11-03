import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DunningRetryService } from './dunning-retry.service';
import { LINE_FINANCE_NOT_VERIFIED_MESSAGE } from '../line-oa/services/finance-line-link';

const mockPrisma = {
  dunningAction: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockNotifications = {
  send: jest.fn(),
};

const baseAction = {
  id: 'action-1',
  status: 'FAILED',
  deletedAt: null,
  messageContent: 'กรุณาชำระค่างวด',
  contractId: 'contract-1',
  dunningRule: { id: 'rule-1', name: 'LINE Reminder', channel: 'LINE' },
  contract: {
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    customer: {
      id: 'cust-1',
      name: 'สมชาย ใจดี',
      phone: '0812345678',
      lineIdFinance: 'Uabc123',
      lineLinks: [{ lineUserId: 'Uabc123' }],
    },
  },
};

describe('DunningRetryService', () => {
  let service: DunningRetryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DunningRetryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(DunningRetryService);
  });

  describe('listFailed', () => {
    it('queries status=FAILED ordered by createdAt desc', async () => {
      mockPrisma.dunningAction.findMany.mockResolvedValueOnce([baseAction]);
      const result = await service.listFailed(50);
      expect(result).toEqual([baseAction]);
      const arg = mockPrisma.dunningAction.findMany.mock.calls[0][0];
      expect(arg.where.status).toBe('FAILED');
      expect(arg.where.deletedAt).toBeNull();
      expect(arg.orderBy).toEqual({ createdAt: 'desc' });
      expect(arg.take).toBe(50);
    });

    it('uses default limit 100 when not specified', async () => {
      mockPrisma.dunningAction.findMany.mockResolvedValueOnce([]);
      await service.listFailed();
      const arg = mockPrisma.dunningAction.findMany.mock.calls[0][0];
      expect(arg.take).toBe(100);
    });
  });

  describe('retry', () => {
    it('throws NotFoundException if action not found', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce(null);
      await expect(service.retry('nope', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest if action status is not FAILED', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce({
        ...baseAction,
        status: 'SENT',
      });
      await expect(service.retry('action-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });

    it('throws BadRequest if no recipient for channel', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce({
        ...baseAction,
        dunningRule: { id: 'rule-1', name: 'LINE Reminder', channel: 'LINE' },
        contract: {
          ...baseAction.contract,
          customer: { ...baseAction.contract.customer, lineIdFinance: null, lineLinks: [] },
        },
      });
      // Task 24 RR-M2 — บอกเหตุตรง ๆ (ยังไม่ยืนยัน OTP) + ทางที่มีจริง แทน "ไม่พบผู้รับ…"
      await expect(service.retry('action-1', 'user-1')).rejects.toThrow(
        LINE_FINANCE_NOT_VERIFIED_MESSAGE,
      );
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });

    it('Task 22 I-1 (ง): คอลัมน์ lineIdFinance ค้างแต่ไม่มีแถว OTP → ไม่มีผู้รับ LINE (ไม่ส่งไปค่านั้น)', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce({
        ...baseAction,
        dunningRule: { id: 'rule-1', name: 'LINE Reminder', channel: 'LINE' },
        contract: {
          ...baseAction.contract,
          customer: { ...baseAction.contract.customer, lineIdFinance: 'U-stale', lineLinks: [] },
        },
      });
      await expect(service.retry('action-1', 'user-1')).rejects.toThrow(
        LINE_FINANCE_NOT_VERIFIED_MESSAGE,
      );
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });

    it('updates status=SENT and sets executedById on success', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce(baseAction);
      mockNotifications.send.mockResolvedValueOnce({ id: 'notif-1', status: 'SENT' });
      const updatedAction = { ...baseAction, status: 'SENT', executedById: 'user-1' };
      mockPrisma.dunningAction.update.mockResolvedValueOnce(updatedAction);

      const result = await service.retry('action-1', 'user-1');
      expect(result.status).toBe('SENT');
      const updateArg = mockPrisma.dunningAction.update.mock.calls[0][0];
      expect(updateArg.data.status).toBe('SENT');
      expect(updateArg.data.executedById).toBe('user-1');
      expect(updateArg.data.result).toContain('manual retry OK');
      // Task 30 รอบ 2 ข้อ 2 — พนักงานกดส่งซ้ำเอง = ส่งด้วยมือ
      expect(mockNotifications.send.mock.calls[0][1]).toEqual({ manual: true });
    });

    it('keeps FAILED and throws BadRequest when send returns FAILED', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce(baseAction);
      mockNotifications.send.mockResolvedValueOnce({
        id: 'notif-2',
        status: 'FAILED',
        errorMsg: 'LINE token invalid',
      });
      mockPrisma.dunningAction.update.mockResolvedValueOnce({ ...baseAction });

      await expect(service.retry('action-1', 'user-1')).rejects.toThrow(BadRequestException);
      const updateArg = mockPrisma.dunningAction.update.mock.calls[0][0];
      expect(updateArg.data.result).toContain('manual retry failed');
    });

    /**
     * Task 34 รอบเก็บ (ผู้คุมงานข้อ 3) — ส่งซ้ำแล้วถูกระงับ / ยังไม่ได้ส่ง เคยขึ้น "ส่ง LINE ไม่สำเร็จ: unknown" (ผล `BLOCKED`/`DELAYED`
     * ไม่มี `errorMsg`) ⇒ ใช้เหตุผลภาษาไทยชุดเดียวกับคิวทวงถาม (`describeSendOutcome`)
     */
    it.each([
      [
        { status: 'BLOCKED', blockReason: 'NO_CONSENT' },
        'NO_CONSENT',
        /^ไม่ได้ส่ง — ลูกค้ายังไม่ได้ให้ความยินยอม PDPA/,
      ],
      [
        { status: 'BLOCKED', blockReason: 'FREQUENCY_CAP' },
        'FREQUENCY_CAP',
        /^ไม่ได้ส่ง — วันนี้สัญญานี้ได้ข้อความทวงไปแล้ว/,
      ],
      [
        { status: 'DELAYED', blockReason: 'OUTSIDE_HOURS' },
        'OUTSIDE_HOURS',
        /^ยังไม่ได้ส่ง — นอกเวลาทวงถาม/,
      ],
    ])(
      'ผล %j → 400 เหตุผลภาษาไทย (ไม่ใช่ "unknown") · คง FAILED · บันทึกเหตุผลใน result',
      async (sendResult, reason, text) => {
        mockPrisma.dunningAction.findUnique.mockResolvedValueOnce(baseAction);
        mockNotifications.send.mockResolvedValueOnce({ id: 'notif-3', ...sendResult });
        mockPrisma.dunningAction.update.mockResolvedValueOnce({ ...baseAction });

        const err = await service.retry('action-1', 'user-1').catch((e: unknown) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).message).toMatch(text);
        expect((err as BadRequestException).message).not.toContain('unknown');
        const updateArg = mockPrisma.dunningAction.update.mock.calls[0][0];
        expect(updateArg.data.status).toBeUndefined();
        expect(updateArg.data.result).toBe(`manual retry failed: ${reason}`);
      },
    );

    it('ส่งไม่ผ่าน (FAILED · ส่งซ้ำด้วยมือไม่เข้าคิวส่งซ้ำ — noRetry) → ไม่บอกว่าระบบจะลองใหม่เอง · คงข้อความผิดพลาดจริงไว้', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce(baseAction);
      mockNotifications.send.mockResolvedValueOnce({
        id: 'notif-4',
        status: 'FAILED',
        errorMsg: 'LINE token invalid',
      });
      mockPrisma.dunningAction.update.mockResolvedValueOnce({ ...baseAction });

      const err = await service.retry('action-1', 'user-1').catch((e: unknown) => e);

      expect((err as BadRequestException).message).toBe(
        'ไม่ได้ส่ง — ระบบส่งข้อความไม่ผ่าน กรุณาลองใหม่ (LINE token invalid)',
      );
      expect(mockPrisma.dunningAction.update.mock.calls[0][0].data.result).toBe(
        'manual retry failed: SEND_ERROR — LINE token invalid',
      );
    });
  });
});
