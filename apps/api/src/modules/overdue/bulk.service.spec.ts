import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MdmLockService } from './mdm-lock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OverdueBulkService } from './bulk.service';
import { collectionsSessionDay } from '../collections-session/collections-session.service';
import { LINE_FINANCE_NOT_VERIFIED_MESSAGE } from '../line-oa/services/finance-line-link';

const mockPrisma = {
  contract: {
    updateMany: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  auditLog: { createMany: jest.fn() },
  dunningRule: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

const mockMdmLock = {
  proposeManual: jest.fn(),
};

/** งานรายวันวันนี้ของผู้ทวง (Task 24 fix round 2 I-R1 — นิยามวันเดียวกับโหมดโฟกัส) */
const assignedToday = (collectorId: string) => ({
  dailyAssignments: {
    some: { collectorId, date: collectionsSessionDay(), deletedAt: null },
  },
});

/** ผู้ใช้ข้ามสาขา (ไม่กรองสาขา) */
const OWNER = { id: 'actor-1', role: 'OWNER', branchId: null };

const mockNotifications = {
  send: jest.fn(),
};

describe('OverdueBulkService', () => {
  let service: OverdueBulkService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueBulkService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MdmLockService, useValue: mockMdmLock },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(OverdueBulkService);

    // Default: auditLog.createMany resolves to a benign value so bulkSendLine
    // audit-trail writes don't blow up in tests that don't assert on them.
    mockPrisma.auditLog.createMany.mockResolvedValue({ count: 0 });
  });

  describe('bulkAssign', () => {
    it('updates contracts and creates audit logs atomically via $transaction', async () => {
      const contractIds = ['c1', 'c2', 'c3'];
      mockPrisma.contract.updateMany.mockReturnValueOnce({ count: 3 });
      mockPrisma.auditLog.createMany.mockReturnValueOnce({ count: 3 });
      mockPrisma.$transaction.mockResolvedValueOnce([{ count: 3 }, { count: 3 }]);

      const result = await service.bulkAssign({ contractIds, assignedToId: 'user-99' }, 'actor-1');

      expect(result).toEqual({ updated: 3, requested: 3 });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      const updateArg = mockPrisma.contract.updateMany.mock.calls[0][0];
      expect(updateArg.where.id.in).toEqual(contractIds);
      expect(updateArg.data.assignedToId).toBe('user-99');

      const auditArg = mockPrisma.auditLog.createMany.mock.calls[0][0];
      expect(auditArg.data).toHaveLength(3);
      expect(auditArg.data[0].action).toBe('BULK_ASSIGN');
      expect(auditArg.data[0].userId).toBe('actor-1');
    });
  });

  describe('bulkProposeLock', () => {
    it('returns partial success when some proposeManual calls fail', async () => {
      mockMdmLock.proposeManual
        .mockResolvedValueOnce({ id: 'r1' })
        .mockRejectedValueOnce(new Error('device missing'))
        .mockResolvedValueOnce({ id: 'r3' });

      const result = await service.bulkProposeLock(
        { contractIds: ['c1', 'c2', 'c3'], reason: 'ลูกค้าไม่ตอบสนอง' },
        'actor-1',
      );

      expect(result).toEqual({
        proposed: 2,
        failed: 1,
        requested: 3,
        // Z8: created MdmLockRequest ids surfaced for FE undo (DELETE one as
        // representative reverse — the FE picks the first to undo).
        requestIds: ['r1', 'r3'],
      });
    });

    it('returns all proposed when all calls succeed', async () => {
      mockMdmLock.proposeManual.mockResolvedValue({ id: 'r1' });

      const result = await service.bulkProposeLock(
        { contractIds: ['c1', 'c2'], reason: 'ลูกค้าไม่รับสาย 3 วัน' },
        'actor-1',
      );

      expect(result).toEqual({
        proposed: 2,
        failed: 0,
        requested: 2,
        // Same id appears twice because the mock returns the same value on
        // every call — production proposeManual returns distinct ids.
        requestIds: ['r1', 'r1'],
      });
    });
  });

  /**
   * Task 24 RR-M2 + fix round 1 M-3/M-4 — ปุ่ม "ส่ง LINE" ของคิวทวงถาม (สัญญาเดียว):
   * - ลูกค้าไม่มีแถว OTP ที่ยังผูก ณ ตอนส่ง = 400 ข้อความบอกเหตุ + ทางที่มีจริง (เดิม 201 {sent:0} → toast "ลองใหม่" ทั้งที่ลองแล้วไม่หาย)
   * - ไม่พบสัญญา / อยู่นอกสาขาของ SALES·BM = 404 (ขอบเขตเดียวกับคิวทวงถามที่อ่าน — `getBranchScope`)
   */
  describe('sendLineAdhoc', () => {
    const row = (lineLinks: { lineUserId: string }[]) => ({
      id: 'c1',
      contractNumber: 'BC-001',
      branchId: 'b1',
      customer: { lineLinks, phone: '081', name: 'ก', id: 'cu1' },
    });

    it('ลูกค้าไม่มีแถว OTP ที่ยังผูก (แม้คอลัมน์มีค่า) → 400 LINE_FINANCE_NOT_VERIFIED_MESSAGE ไม่ส่ง', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([row([])]);
      await expect(service.sendLineAdhoc('c1', { customMessage: 'ทดสอบ' }, OWNER)).rejects.toThrow(
        new BadRequestException(LINE_FINANCE_NOT_VERIFIED_MESSAGE),
      );
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });

    it('มีแถว OTP → ส่งตามเดิม', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([row([{ lineUserId: 'U1' }])]);
      mockNotifications.send.mockResolvedValueOnce({ id: 'n1', status: 'SENT' });
      await expect(service.sendLineAdhoc('c1', { customMessage: 'ทดสอบ' }, OWNER)).resolves.toEqual(
        { sent: 1, failed: 0, total: 1 },
      );
      expect(mockNotifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: 'U1', channelKey: 'line-finance' }),
      );
    });

    it('M-4: ไม่พบสัญญา (ถูกลบ/ไม่มี) → 404 "ไม่พบสัญญา" (ไม่ใช่ 201 {sent:0} ที่หน้าเว็บบอกให้ลองใหม่)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      await expect(service.sendLineAdhoc('c1', { customMessage: 'ทดสอบ' }, OWNER)).rejects.toThrow(
        new NotFoundException('ไม่พบสัญญา'),
      );
    });

    it('M-3 + I-R1: SALES/BM ค้นด้วย สาขาตัวเอง หรือ งานรายวันวันนี้ของผู้ใช้ · นอกขอบเขต = 404 เหมือนหน้าจอที่อ่านไม่เห็น', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      await expect(
        service.sendLineAdhoc(
          'c1',
          { customMessage: 'ทดสอบ' },
          { id: 'u-s', role: 'SALES', branchId: 'b2' },
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.contract.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['c1'] },
        deletedAt: null,
        OR: [{ branchId: 'b2' }, assignedToday('u-s')],
      });
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });
  });

  describe('bulkSendLine', () => {
    it('throws BadRequestException when neither templateId nor customMessage provided', async () => {
      await expect(service.bulkSendLine({ contractIds: ['c1'] }, OWNER)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('counts contracts without lineId as failed', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-001',
          customer: { lineIdFinance: null, phone: '0812345678', name: 'ลูกค้า 1' },
        },
        {
          id: 'c2',
          contractNumber: 'BC-002',
          customer: {
            lineIdFinance: 'U123',
            lineLinks: [{ lineUserId: 'U123' }],
            phone: '0812345679',
            name: 'ลูกค้า 2',
          },
        },
      ]);
      mockNotifications.send.mockResolvedValueOnce({ id: 'n1', status: 'SENT' });

      const result = await service.bulkSendLine(
        { contractIds: ['c1', 'c2'], customMessage: 'กรุณาชำระเงินค้างชำระ' },
        OWNER,
      );

      expect(result).toEqual({ sent: 1, failed: 1, total: 2 });
      expect(mockNotifications.send).toHaveBeenCalledTimes(1);
    });

    it('Task 22 I-1 (ง): คอลัมน์ lineIdFinance ค้างแต่ไม่มีแถว OTP → นับเป็น failed ไม่ส่ง', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-001',
          customer: { lineIdFinance: 'U-stale', lineLinks: [], phone: '0812345678', name: 'ค้าง' },
        },
      ]);

      const result = await service.bulkSendLine(
        { contractIds: ['c1'], customMessage: 'กรุณาชำระเงินค้างชำระ' },
        OWNER,
      );

      expect(result).toEqual({ sent: 0, failed: 1, total: 1 });
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });

    it('uses customMessage verbatim when provided', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-001',
          customer: {
            lineIdFinance: 'U999',
            lineLinks: [{ lineUserId: 'U999' }],
            phone: '0899999999',
            name: 'ทดสอบ',
          },
        },
      ]);
      mockNotifications.send.mockResolvedValueOnce({ id: 'n1', status: 'SENT' });

      await service.bulkSendLine(
        { contractIds: ['c1'], customMessage: 'ข้อความทดสอบ 10 ตัวอักษร' },
        OWNER,
      );

      const sendArg = mockNotifications.send.mock.calls[0][0];
      expect(sendArg.message).toBe('ข้อความทดสอบ 10 ตัวอักษร');
      expect(sendArg.recipient).toBe('U999');
      expect(sendArg.channel).toBe('LINE');
    });

    it('renders templateId message with customerName and contractNumber vars', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-2026-001',
          customer: {
            lineIdFinance: 'U777',
            lineLinks: [{ lineUserId: 'U777' }],
            phone: '0811111111',
            name: 'สมชาย ใจดี',
          },
        },
      ]);
      mockPrisma.dunningRule.findUnique.mockResolvedValueOnce({
        id: 'rule-1',
        messageTemplate: 'เรียน {{customerName}} สัญญา {{contractNumber}} มียอดค้างชำระ',
      });
      mockNotifications.send.mockResolvedValueOnce({ id: 'n1', status: 'SENT' });

      const result = await service.bulkSendLine(
        { contractIds: ['c1'], templateId: 'rule-1' },
        OWNER,
      );

      expect(result.sent).toBe(1);
      const sendArg = mockNotifications.send.mock.calls[0][0];
      expect(sendArg.message).toBe('เรียน สมชาย ใจดี สัญญา BC-2026-001 มียอดค้างชำระ');
    });

    it('throws BadRequestException when templateId does not exist', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-001',
          customer: {
            lineIdFinance: 'U111',
            lineLinks: [{ lineUserId: 'U111' }],
            phone: '0800000000',
            name: 'ลูกค้า',
          },
        },
      ]);
      mockPrisma.dunningRule.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.bulkSendLine({ contractIds: ['c1'], templateId: 'no-such-template' }, OWNER),
      ).rejects.toThrow(BadRequestException);
    });

    it('counts notification send failures as failed (does not throw)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-001',
          customer: {
            lineIdFinance: 'U100',
            lineLinks: [{ lineUserId: 'U100' }],
            phone: '0800000001',
            name: 'ผู้ทดสอบ',
          },
        },
        {
          id: 'c2',
          contractNumber: 'BC-002',
          customer: {
            lineIdFinance: 'U200',
            lineLinks: [{ lineUserId: 'U200' }],
            phone: '0800000002',
            name: 'ผู้ทดสอบ 2',
          },
        },
      ]);
      mockNotifications.send
        .mockRejectedValueOnce(new Error('LINE API down'))
        .mockResolvedValueOnce({ id: 'n2', status: 'SENT' });

      const result = await service.bulkSendLine(
        { contractIds: ['c1', 'c2'], customMessage: 'ข้อความทดสอบสำหรับการส่ง' },
        OWNER,
      );

      expect(result).toEqual({ sent: 1, failed: 1, total: 2 });
    });
  });

  /** Task 24 fix round 1 M-3 — ส่ง LINE รวด (แบนเนอร์นัดครบกำหนด) ใช้ขอบเขตสาขาเดียวกับคิว/แบนเนอร์ที่อ่าน */
  describe('bulkSendLine — branch scope (M-3)', () => {
    it('ข้ามสาขา (OWNER/FM/ACCOUNTANT) → ไม่กรองสาขา', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      await service.bulkSendLine(
        { contractIds: ['c1', 'c2'], customMessage: 'กรุณาชำระเงิน' },
        OWNER,
      );
      expect(mockPrisma.contract.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['c1', 'c2'] },
        deletedAt: null,
      });
    });

    it('BRANCH_MANAGER → เฉพาะสัญญาในสาขาตัวเอง (สัญญาสาขาอื่นไม่ถูกโหลด ไม่ถูกส่ง ไม่นับ)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      const res = await service.bulkSendLine(
        { contractIds: ['c1', 'c2'], customMessage: 'กรุณาชำระเงิน' },
        { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'b1' },
      );
      expect(mockPrisma.contract.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['c1', 'c2'] },
        deletedAt: null,
        OR: [{ branchId: 'b1' }, assignedToday('u-bm')],
      });
      expect(res).toEqual({ sent: 0, failed: 0, total: 0 });
    });

    it('SALES/BM ที่ไม่มีสาขา → เฉพาะสัญญาที่มีงานรายวันวันนี้ (ไม่มีงาน = ไม่มีอะไร — fail closed)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      const res = await service.bulkSendLine(
        { contractIds: ['c1'], customMessage: 'กรุณาชำระเงิน' },
        { id: 'u-s', role: 'SALES', branchId: null },
      );
      expect(mockPrisma.contract.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['c1'] },
        deletedAt: null,
        OR: [assignedToday('u-s')],
      });
      expect(res).toEqual({ sent: 0, failed: 0, total: 0 });
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });
  });
});
