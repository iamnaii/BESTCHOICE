import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AfterSalesExchangeService } from '../services/after-sales-exchange.service';

const MGR = { id: 'user-mgr', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
const SALES = { id: 'user-sales', role: 'SALES', branchId: 'branch-1' };
const STAFF = SALES; // deliver/switchToRepair are STAFF-level — no internal role gate expected

function buildCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'as-1',
    contractId: 'ct-1',
    outcome: 'SAME_MODEL_EXCHANGE',
    stage: 'AWAITING_APPROVAL',
    symptom: 'จอแตก',
    replacementProductId: 'prod-new',
    replacementContractId: null,
    customerId: 'cust-1',
    productId: 'prod-old',
    branchId: 'branch-1',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 13',
    deviceImei: 'IMEI-1',
    deviceSerial: null,
    warrantySnapshot: { status: 'IN_7DAY_DEFECT' },
    repairTicketId: null,
    repairTicket: null,
    ...overrides,
  };
}

describe('AfterSalesExchangeService', () => {
  let prisma: any;
  let query: any;
  let defect: any;
  let repair: any;
  let audit: any;
  let svc: AfterSalesExchangeService;

  beforeEach(() => {
    prisma = {
      afterSalesCase: { update: jest.fn().mockResolvedValue({ id: 'as-1' }) },
      contract: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    query = { getCase: jest.fn() };
    defect = { checkEligibility: jest.fn(), execute: jest.fn() };
    repair = { createInTx: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    svc = new AfterSalesExchangeService(
      prisma as never,
      query as never,
      defect as never,
      repair as never,
      audit as never,
    );
  });

  describe('confirmSameModel', () => {
    // (a)
    it('confirm ในกรอบ (elig.eligible) → execute ถูกเรียกโดยไม่มี bypass, เคสอัปเดตครบ, audit หลัง execute+update', async () => {
      query.getCase.mockResolvedValue(buildCase());
      defect.checkEligibility.mockResolvedValue({ eligible: true, reasons: [] });
      defect.execute.mockResolvedValue({
        newContract: { id: 'ct-new', contractNumber: 'CT-NEW-0001' },
      });

      const result = await svc.confirmSameModel('as-1', { note: 'ok' } as never, MGR);

      expect(defect.checkEligibility).toHaveBeenCalledWith('ct-1', 'prod-new');
      expect(defect.execute).toHaveBeenCalledWith(
        {
          oldContractId: 'ct-1',
          newProductId: 'prod-new',
          defectReason: 'จอแตก',
          notes: 'ok',
          bypassWindowCheck: undefined,
          originRepairTicketId: undefined,
          originAfterSalesCaseId: 'as-1',
        },
        MGR,
      );
      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: expect.objectContaining({
          outcome: 'SAME_MODEL_EXCHANGE',
          replacementProductId: 'prod-new',
          replacementContractId: 'ct-new',
          approvedById: MGR.id,
          stage: 'READY_FOR_PICKUP',
          events: {
            create: expect.objectContaining({
              kind: 'APPROVED',
              note: 'ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ CT-NEW-0001',
            }),
          },
        }),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AFTER_SALES_EXCHANGE_CONFIRMED',
          entity: 'after_sales_case',
          entityId: 'as-1',
          newValue: { newContractId: 'ct-new', bypass: false },
        }),
      );
      // ลำดับ: execute → update → audit
      expect(defect.execute.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.afterSalesCase.update.mock.invocationCallOrder[0],
      );
      expect(prisma.afterSalesCase.update.mock.invocationCallOrder[0]).toBeLessThan(
        audit.log.mock.invocationCallOrder[0],
      );
      expect(result).toEqual({
        id: 'as-1',
        stage: 'READY_FOR_PICKUP',
        replacementContractId: 'ct-new',
        contractNumber: 'CT-NEW-0001',
      });
    });

    // (b)
    it('confirm นอกกรอบ (elig.eligible=false) โดย BM → bypassWindowCheck true + originAfterSalesCaseId, ข้อความมี "ข้ามกรอบ 7 วัน"', async () => {
      query.getCase.mockResolvedValue(buildCase());
      defect.checkEligibility.mockResolvedValue({
        eligible: false,
        reasons: ['พ้นกำหนด 7 วันแล้ว'],
      });
      defect.execute.mockResolvedValue({
        newContract: { id: 'ct-new', contractNumber: 'CT-NEW-0002' },
      });

      await svc.confirmSameModel('as-1', {} as never, MGR);

      expect(defect.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          bypassWindowCheck: true,
          originAfterSalesCaseId: 'as-1',
        }),
        MGR,
      );
      const updateData = prisma.afterSalesCase.update.mock.calls[0][0].data;
      expect(updateData.events.create.note).toContain('ข้ามกรอบ 7 วัน');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ newValue: { newContractId: 'ct-new', bypass: true } }),
      );
    });

    // (c) — Review Focus 2
    it('เครื่องทดแทนไม่ IN_STOCK แล้ว (defect.execute โยน BadRequestException) → error ส่งต่อเดิม, เคสไม่ถูกอัปเดต, ไม่ audit', async () => {
      query.getCase.mockResolvedValue(buildCase());
      defect.checkEligibility.mockResolvedValue({ eligible: true, reasons: [] });
      defect.execute.mockRejectedValue(
        new BadRequestException('ไม่เข้าเกณฑ์: สินค้าใหม่ไม่พร้อมจำหน่าย'),
      );

      await expect(svc.confirmSameModel('as-1', {} as never, MGR)).rejects.toThrow(
        new BadRequestException('ไม่เข้าเกณฑ์: สินค้าใหม่ไม่พร้อมจำหน่าย'),
      );

      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    // (d)
    it('confirm บนเคส REPAIR (ซ่อมไม่ได้) + dto.replacementProductId → newProductId มาจาก dto, originRepairTicketId มาจาก repairTicket.id', async () => {
      query.getCase.mockResolvedValue(
        buildCase({
          outcome: 'REPAIR',
          replacementProductId: null, // เคส REPAIR ไม่เคยมี replacementProductId จากตอนแจ้งปัญหา
          repairTicketId: 'rt-1',
          repairTicket: { id: 'rt-1', status: 'IN_PROGRESS' },
        }),
      );
      defect.checkEligibility.mockResolvedValue({ eligible: true, reasons: [] });
      defect.execute.mockResolvedValue({
        newContract: { id: 'ct-new', contractNumber: 'CT-NEW-0003' },
      });

      await svc.confirmSameModel('as-1', { replacementProductId: 'prod-repl' } as never, MGR);

      expect(defect.checkEligibility).toHaveBeenCalledWith('ct-1', 'prod-repl');
      expect(defect.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          newProductId: 'prod-repl',
          originRepairTicketId: 'rt-1',
          originAfterSalesCaseId: 'as-1',
        }),
        MGR,
      );
      const note = prisma.afterSalesCase.update.mock.calls[0][0].data.events.create.note;
      expect(note).toContain('จากใบซ่อม (ซ่อมไม่ได้)');
    });

    // (e) — Review Focus 1
    it('SALES เรียก confirmSameModel → ForbiddenException ก่อนแตะ query.getCase', async () => {
      await expect(svc.confirmSameModel('as-1', {} as never, SALES)).rejects.toThrow(
        ForbiddenException,
      );
      expect(query.getCase).not.toHaveBeenCalled();
    });
  });

  describe('deliver', () => {
    // (f) — Review Focus 4
    it('สัญญาใหม่ยัง DRAFT → 400 ชี้หน้าสัญญาตามข้อความจริง, ไม่แตะเคส/ไม่ audit', async () => {
      query.getCase.mockResolvedValue(
        buildCase({ stage: 'READY_FOR_PICKUP', replacementContractId: 'ct-new' }),
      );
      prisma.contract.findUnique.mockResolvedValue({
        status: 'DRAFT',
        contractNumber: 'CT-NEW-0004',
      });

      await expect(svc.deliver('as-1', STAFF)).rejects.toThrow(
        new BadRequestException('ต้องเปิดใช้สัญญาใหม่ CT-NEW-0004 ที่หน้าสัญญาก่อนส่งมอบ'),
      );
      expect(prisma.contract.findUnique).toHaveBeenCalledWith({
        where: { id: 'ct-new' },
        select: { status: true, contractNumber: true },
      });
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('สัญญาใหม่ ACTIVE → ปิดเคส (closedAt, stage CLOSED) + events DELIVERED แล้ว CLOSED, audit หลัง update', async () => {
      query.getCase.mockResolvedValue(
        buildCase({ stage: 'READY_FOR_PICKUP', replacementContractId: 'ct-new' }),
      );
      prisma.contract.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        contractNumber: 'CT-NEW-0004',
      });
      prisma.afterSalesCase.update.mockResolvedValue({ id: 'as-1', stage: 'CLOSED' });

      const result = await svc.deliver('as-1', STAFF);

      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: expect.objectContaining({
          stage: 'CLOSED',
          closedAt: expect.any(Date),
          events: {
            create: [
              expect.objectContaining({ kind: 'DELIVERED' }),
              expect.objectContaining({ kind: 'CLOSED' }),
            ],
          },
        }),
      });
      expect(result).toEqual({ id: 'as-1', stage: 'CLOSED' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AFTER_SALES_EXCHANGE_DELIVERED', entityId: 'as-1' }),
      );
      expect(prisma.afterSalesCase.update.mock.invocationCallOrder[0]).toBeLessThan(
        audit.log.mock.invocationCallOrder[0],
      );
    });

    it('เคสยังไม่ถึง READY_FOR_PICKUP → 400, ไม่แตะ prisma.contract', async () => {
      query.getCase.mockResolvedValue(
        buildCase({ stage: 'AWAITING_APPROVAL', replacementContractId: null }),
      );
      await expect(svc.deliver('as-1', STAFF)).rejects.toThrow(BadRequestException);
      expect(prisma.contract.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('rejectSameModel', () => {
    // (g)
    it('MGR ปฏิเสธเคส AWAITING_APPROVAL SAME_MODEL → cancelledAt/cancelReason/stage CANCELLED + event REJECTED, audit หลัง update', async () => {
      query.getCase.mockResolvedValue(buildCase({ stage: 'AWAITING_APPROVAL' }));
      prisma.afterSalesCase.update.mockResolvedValue({ id: 'as-1', stage: 'CANCELLED' });

      const result = await svc.rejectSameModel(
        'as-1',
        { reason: 'ลูกค้าไม่สะดวกรอ' } as never,
        MGR,
      );

      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: expect.objectContaining({
          cancelledAt: expect.any(Date),
          cancelReason: 'ลูกค้าไม่สะดวกรอ',
          stage: 'CANCELLED',
          events: {
            create: expect.objectContaining({ kind: 'REJECTED', note: 'ลูกค้าไม่สะดวกรอ' }),
          },
        }),
      });
      expect(result).toEqual({ id: 'as-1', stage: 'CANCELLED' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AFTER_SALES_EXCHANGE_REJECTED', entityId: 'as-1' }),
      );
    });

    it('เคสไม่ใช่ SAME_MODEL_EXCHANGE → 400, ไม่แตะ prisma', async () => {
      query.getCase.mockResolvedValue(buildCase({ outcome: 'REPAIR', stage: 'AWAITING_APPROVAL' }));
      await expect(
        svc.rejectSameModel('as-1', { reason: 'x'.repeat(10) } as never, MGR),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
    });

    it('SALES เรียก rejectSameModel → ForbiddenException ก่อนแตะ query.getCase', async () => {
      await expect(
        svc.rejectSameModel('as-1', { reason: 'x'.repeat(10) } as never, SALES),
      ).rejects.toThrow(ForbiddenException);
      expect(query.getCase).not.toHaveBeenCalled();
    });
  });

  describe('switchToRepair', () => {
    // (h)
    it('เปลี่ยนเป็นซ่อม → createInTx ถูกเรียกด้วย tx client ภายใน $transaction, outcome REPAIR, stage RECEIVED', async () => {
      const c = buildCase({
        stage: 'AWAITING_APPROVAL',
        warrantySnapshot: { status: 'OUT_OF_WARRANTY' },
      });
      query.getCase.mockResolvedValue(c);
      const tx = {
        afterSalesCase: {
          update: jest.fn().mockResolvedValue({
            id: 'as-1',
            stage: 'RECEIVED',
            outcome: 'REPAIR',
            repairTicketId: 'rt-9',
          }),
        },
      };
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));
      repair.createInTx.mockResolvedValue({ ticket: { id: 'rt-9' } });

      const result = await svc.switchToRepair('as-1', { estimatedCost: 500 } as never, STAFF);

      expect(repair.createInTx).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          contractId: 'ct-1',
          productId: 'prod-old',
          branchId: 'branch-1',
          defectDescription: 'จอแตก',
          payer: 'CUSTOMER', // OUT_OF_WARRANTY default
          estimatedCost: 500,
        }),
        STAFF,
        tx,
      );
      expect(tx.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: expect.objectContaining({
          outcome: 'REPAIR',
          repairTicketId: 'rt-9',
          replacementProductId: null,
          stage: 'RECEIVED',
          events: { create: expect.objectContaining({ kind: 'OUTCOME_SET' }) },
        }),
      });
      expect(result).toEqual({
        id: 'as-1',
        stage: 'RECEIVED',
        outcome: 'REPAIR',
        repairTicketId: 'rt-9',
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AFTER_SALES_OUTCOME_SWITCHED', entityId: 'as-1' }),
      );
      // ไม่แตะ prisma.afterSalesCase.update ตัวนอก tx เลย (ต้องใช้ tx ตัวใน $transaction เท่านั้น)
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
    });

    it('dto.payer ระบุมาตรง ๆ → ใช้ dto.payer แทน default จาก warranty', async () => {
      const c = buildCase({
        stage: 'AWAITING_APPROVAL',
        warrantySnapshot: { status: 'IN_SHOP_WARRANTY' }, // default = SHOP
      });
      query.getCase.mockResolvedValue(c);
      const tx = {
        afterSalesCase: {
          update: jest.fn().mockResolvedValue({ id: 'as-1', stage: 'RECEIVED' }),
        },
      };
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));
      repair.createInTx.mockResolvedValue({ ticket: { id: 'rt-9' } });

      await svc.switchToRepair('as-1', { payer: 'CUSTOMER' } as never, STAFF);

      expect(repair.createInTx).toHaveBeenCalledWith(
        expect.objectContaining({ payer: 'CUSTOMER' }),
        STAFF,
        tx,
      );
    });

    it('เคสนี้มีใบซ่อมอยู่แล้ว (repairTicketId ตั้งอยู่) → ConflictException, ไม่เข้า tx', async () => {
      query.getCase.mockResolvedValue(
        buildCase({ stage: 'AWAITING_APPROVAL', repairTicketId: 'rt-1' }),
      );
      await expect(svc.switchToRepair('as-1', {} as never, STAFF)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('เคสไม่ได้อยู่ระหว่างรออนุมัติ → 400, ไม่เข้า tx', async () => {
      query.getCase.mockResolvedValue(buildCase({ stage: 'READY_FOR_PICKUP' }));
      await expect(svc.switchToRepair('as-1', {} as never, STAFF)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
