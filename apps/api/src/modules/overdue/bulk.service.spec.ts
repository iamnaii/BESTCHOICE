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
        { sent: 1, failed: 0, total: 1, notSent: [] },
      );
      // Task 30 รอบ 2 ข้อ 2 — พนักงานกดส่งเอง = ส่งด้วยมือ (ไม่ถูกระงับช่วงผ่อนผันหลังผูก LINE ของสัญญานำเข้า)
      expect(mockNotifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: 'U1', channelKey: 'line-finance' }),
        { manual: true },
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

      expect(result).toEqual({
        sent: 1,
        failed: 1,
        total: 2,
        notSent: [
          {
            contractId: 'c1',
            contractNumber: 'BC-001',
            reason: 'NO_RECIPIENT',
            reasonText: LINE_FINANCE_NOT_VERIFIED_MESSAGE,
          },
        ],
      });
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

      expect(result).toEqual({
        sent: 0,
        failed: 1,
        total: 1,
        notSent: [
          {
            contractId: 'c1',
            contractNumber: 'BC-001',
            reason: 'NO_RECIPIENT',
            reasonText: LINE_FINANCE_NOT_VERIFIED_MESSAGE,
          },
        ],
      });
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

      expect(result).toEqual({
        sent: 1,
        failed: 1,
        total: 2,
        notSent: [
          {
            contractId: 'c1',
            contractNumber: 'BC-001',
            reason: 'SEND_ERROR',
            reasonText: expect.stringContaining('ระบบส่งข้อความไม่ผ่าน'),
          },
        ],
      });
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
      expect(res).toEqual({ sent: 0, failed: 0, total: 0, notSent: [] });
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
      expect(res).toEqual({ sent: 0, failed: 0, total: 0, notSent: [] });
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });
  });

  /**
   * Task 34 ข้อ 2 — ผลการส่งที่คืนให้หน้าเว็บแยก "ส่งแล้ว" กับ "ไม่ได้ส่ง พร้อมเหตุผลภาษาไทย": เดิมนับทุกครั้งที่ `send()` ไม่ throw เป็นส่งแล้ว
   * ⇒ ข้อความที่ถูกระงับ (NO_CONSENT / FREQUENCY_CAP · นอกเวลาทำการ = DELAYED · LINE ล่ม = FAILED เข้าคิวส่งซ้ำ) ขึ้นว่าส่งสำเร็จ
   */
  describe('Task 34 ข้อ 2 — แยกส่งแล้ว / ไม่ได้ส่งพร้อมเหตุผล', () => {
    const linked = (id: string, contractNumber: string) => ({
      id,
      contractNumber,
      customer: { id: `cu-${id}`, lineLinks: [{ lineUserId: `U-${id}` }], phone: '081', name: id },
    });

    it('ส่งเดี่ยว: ลูกค้าไม่มีความยินยอม PDPA (BLOCKED NO_CONSENT) → ไม่นับเป็นส่งแล้ว + เหตุผลภาษาไทย', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([linked('c1', 'BC-001')]);
      mockNotifications.send.mockResolvedValueOnce({
        id: 'n1',
        status: 'BLOCKED',
        blockReason: 'NO_CONSENT',
      });

      await expect(
        service.sendLineAdhoc('c1', { customMessage: 'กรุณาชำระค่างวด' }, OWNER),
      ).resolves.toEqual({
        sent: 0,
        failed: 1,
        total: 1,
        notSent: [
          {
            contractId: 'c1',
            contractNumber: 'BC-001',
            reason: 'NO_CONSENT',
            reasonText: expect.stringContaining('ความยินยอม PDPA'),
          },
        ],
      });
    });

    it('ส่งรวด: SENT · FREQUENCY_CAP · นอกเวลาทำการ (DELAYED) · LINE ล่ม (FAILED) · ช่วงผ่อนผัน · เหตุผลอื่น → ส่งแล้ว 1 ที่เหลือแยกเหตุผล', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        linked('c1', 'BC-001'),
        linked('c2', 'BC-002'),
        linked('c3', 'BC-003'),
        linked('c4', 'BC-004'),
        linked('c5', 'BC-005'),
        linked('c6', 'BC-006'),
      ]);
      mockNotifications.send
        .mockResolvedValueOnce({ id: 'n1', status: 'SENT' })
        .mockResolvedValueOnce({ id: 'n2', status: 'BLOCKED', blockReason: 'FREQUENCY_CAP' })
        .mockResolvedValueOnce({ id: 'n3', status: 'DELAYED', blockReason: 'OUTSIDE_HOURS' })
        .mockResolvedValueOnce({ id: 'n4', status: 'FAILED', errorMsg: 'LINE API down' })
        .mockResolvedValueOnce({ id: 'n5', status: 'BLOCKED', blockReason: 'LEGACY_LINK_GRACE' })
        .mockResolvedValueOnce({ id: 'n6', status: 'BLOCKED', blockReason: 'SOMETHING_NEW' });

      const res = await service.bulkSendLine(
        { contractIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], customMessage: 'กรุณาชำระค่างวด' },
        OWNER,
      );

      expect(res.sent).toBe(1);
      expect(res.failed).toBe(5);
      expect(res.total).toBe(6);
      expect(res.notSent.map((n) => [n.contractId, n.contractNumber, n.reason])).toEqual([
        ['c2', 'BC-002', 'FREQUENCY_CAP'],
        ['c3', 'BC-003', 'OUTSIDE_HOURS'],
        ['c4', 'BC-004', 'DELIVERY_FAILED'],
        ['c5', 'BC-005', 'LEGACY_LINK_GRACE'],
        ['c6', 'BC-006', 'BLOCKED'],
      ]);
      const text = Object.fromEntries(res.notSent.map((n) => [n.reason, n.reasonText]));
      expect(text.FREQUENCY_CAP).toMatch(/^ไม่ได้ส่ง — .*วันละ 1/);
      expect(text.OUTSIDE_HOURS).toMatch(/^ยังไม่ได้ส่ง — นอกเวลา.*ส่งให้เอง/);
      expect(text.DELIVERY_FAILED).toMatch(/^ยังไม่ได้ส่ง — .*ลองส่งใหม่อัตโนมัติ/);
      expect(text.LEGACY_LINK_GRACE).toMatch(/^ไม่ได้ส่ง — .*ผ่อนผัน 7 วัน/);
      expect(text.BLOCKED).toMatch(/^ไม่ได้ส่ง — /);
    });

    it('LINE ไม่ผ่านแต่ส่ง SMS แทนได้ (SENT) → นับเป็นส่งแล้ว', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([linked('c1', 'BC-001')]);
      mockNotifications.send.mockResolvedValueOnce({
        id: 'n1',
        status: 'SENT',
        errorMsg: 'LINE failed, sent via SMS fallback',
      });

      await expect(
        service.bulkSendLine({ contractIds: ['c1'], customMessage: 'กรุณาชำระค่างวด' }, OWNER),
      ).resolves.toEqual({ sent: 1, failed: 0, total: 1, notSent: [] });
    });

    it('บันทึก audit ทุกครั้งที่กดส่ง พร้อมผลจริง (ไม่ใช่บอกว่าส่งแล้วทุกแถว)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        linked('c1', 'BC-001'),
        linked('c2', 'BC-002'),
      ]);
      mockNotifications.send
        .mockResolvedValueOnce({ id: 'n1', status: 'SENT' })
        .mockResolvedValueOnce({ id: 'n2', status: 'BLOCKED', blockReason: 'NO_CONSENT' });

      await service.bulkSendLine(
        { contractIds: ['c1', 'c2'], customMessage: 'กรุณาชำระค่างวด' },
        OWNER,
      );

      const rows = mockPrisma.auditLog.createMany.mock.calls[0][0].data;
      expect(
        rows.map((r: { entityId: string; newValue: unknown }) => [r.entityId, r.newValue]),
      ).toEqual([
        ['c1', expect.objectContaining({ outcome: 'SENT', notSentReason: null })],
        ['c2', expect.objectContaining({ outcome: 'BLOCKED', notSentReason: 'NO_CONSENT' })],
      ]);
    });
  });
});
