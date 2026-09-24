import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AfterSalesExchangeService } from '../services/after-sales-exchange.service';

const MGR = { id: 'user-mgr', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
const SALES = { id: 'user-sales', role: 'SALES', branchId: 'branch-1' };
const STAFF = SALES; // deliver/switchToRepair are STAFF-level — no internal role gate expected
const OWNER = { id: 'user-owner', role: 'OWNER', branchId: null };

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
  let contractExchange: any;
  let exchangeCancel: any;
  let lookup: any;
  let svc: AfterSalesExchangeService;

  beforeEach(() => {
    prisma = {
      afterSalesCase: {
        update: jest.fn().mockResolvedValue({ id: 'as-1' }),
        // M4 — claim CAS (confirm/reject) — ชนะการจองโดย default
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contract: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    query = { getCase: jest.fn() };
    defect = { checkEligibility: jest.fn(), execute: jest.fn() };
    repair = { createInTx: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    // Task 6 deps — Task 5's tests below never touch these, but the constructor now
    // requires them (unused-but-present so this describe still compiles/constructs).
    contractExchange = { approve: jest.fn(), reject: jest.fn(), buildPreview: jest.fn() };
    exchangeCancel = { cancel: jest.fn() };
    lookup = { lookup: jest.fn() };

    svc = new AfterSalesExchangeService(
      prisma as never,
      query as never,
      defect as never,
      repair as never,
      audit as never,
      contractExchange as never,
      exchangeCancel as never,
      lookup as never,
    );
  });

  describe('confirmSameModel', () => {
    // (a)
    it('confirm ในกรอบ (elig.eligible) → execute ถูกเรียกโดยไม่มี bypass, เคสอัปเดตครบ, audit หลัง execute+update', async () => {
      query.getCase.mockResolvedValue(buildCase());
      defect.checkEligibility.mockResolvedValue({
        eligible: true,
        reasons: [],
        newProduct: { id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
      });
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
          newValue: { newContractId: 'ct-new', bypass: false, fromRepair: false },
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
        newProduct: { id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
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
        expect.objectContaining({
          newValue: { newContractId: 'ct-new', bypass: true, fromRepair: false },
        }),
      );
    });

    // (new — Review Focus P-H.2) นอกกรอบ + เครื่องทดแทนไม่พร้อมขาย → 400 ด้วยเหตุผลเครื่องทดแทน
    // เอง (bypassWindowCheck ทำให้ engine ข้าม checkEligibility จึงต้องบังคับที่นี่ก่อนเรียก execute)
    it('นอกกรอบ 7 วัน + เครื่องทดแทนไม่พร้อมขาย (productReasons) → 400 ด้วยเหตุผลเครื่องทดแทน, execute ไม่ถูกเรียก, ไม่ update/audit', async () => {
      query.getCase.mockResolvedValue(buildCase());
      defect.checkEligibility.mockResolvedValue({
        eligible: false,
        reasons: ['พ้นกำหนด 7 วันแล้ว (รับเครื่องเมื่อ 2026-01-01)', 'สินค้าใหม่ไม่พร้อมจำหน่าย'],
      });

      await expect(svc.confirmSameModel('as-1', {} as never, MGR)).rejects.toThrow(
        new BadRequestException('สินค้าใหม่ไม่พร้อมจำหน่าย'),
      );

      expect(defect.execute).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    // (c) — Review Focus 2
    it('เครื่องทดแทนไม่ IN_STOCK แล้ว (defect.execute โยน BadRequestException) → error ส่งต่อเดิม, เคสไม่ถูกอัปเดต, ไม่ audit', async () => {
      query.getCase.mockResolvedValue(buildCase());
      defect.checkEligibility.mockResolvedValue({
        eligible: true,
        reasons: [],
        newProduct: { id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
      });
      defect.execute.mockRejectedValue(
        new BadRequestException('ไม่เข้าเกณฑ์: สินค้าใหม่ไม่พร้อมจำหน่าย'),
      );

      await expect(svc.confirmSameModel('as-1', {} as never, MGR)).rejects.toThrow(
        new BadRequestException('ไม่เข้าเกณฑ์: สินค้าใหม่ไม่พร้อมจำหน่าย'),
      );

      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    // (d) — P-H.1: เคส REPAIR ที่ยืนยันขณะยัง "ในกรอบ 7 วัน" (elig.eligible=true) ก็ยังต้อง
    // bypassWindowCheck=true เสมอ (fromRepair บังคับ bypass) เพื่อให้ engine เดินกิ่ง markReplaced —
    // แต่ข้อความห้ามพูดว่า "ข้ามกรอบ 7 วัน" เพราะไม่ได้ข้ามกรอบจริง (แค่มาจากใบซ่อม)
    it('confirm บนเคส REPAIR (ซ่อมไม่ได้) ในกรอบ (elig.eligible=true) + dto.replacementProductId → execute ได้ bypassWindowCheck=true + originRepairTicketId จาก repairTicket.id, note มี "จากใบซ่อม" แต่ไม่มี "ข้ามกรอบ 7 วัน"', async () => {
      query.getCase.mockResolvedValue(
        buildCase({
          outcome: 'REPAIR',
          replacementProductId: null, // เคส REPAIR ไม่เคยมี replacementProductId จากตอนแจ้งปัญหา
          repairTicketId: 'rt-1',
          repairTicket: { id: 'rt-1', status: 'IN_PROGRESS' },
        }),
      );
      defect.checkEligibility.mockResolvedValue({
        eligible: true,
        reasons: [],
        newProduct: { id: 'prod-repl', brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
      });
      defect.execute.mockResolvedValue({
        newContract: { id: 'ct-new', contractNumber: 'CT-NEW-0003' },
      });

      await svc.confirmSameModel('as-1', { replacementProductId: 'prod-repl' } as never, MGR);

      expect(defect.checkEligibility).toHaveBeenCalledWith('ct-1', 'prod-repl');
      expect(defect.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          newProductId: 'prod-repl',
          bypassWindowCheck: true,
          originRepairTicketId: 'rt-1',
          originAfterSalesCaseId: 'as-1',
        }),
        MGR,
      );
      const note = prisma.afterSalesCase.update.mock.calls[0][0].data.events.create.note;
      expect(note).toContain('จากใบซ่อม (ซ่อมไม่ได้)');
      expect(note).not.toContain('ข้ามกรอบ 7 วัน');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: { newContractId: 'ct-new', bypass: false, fromRepair: true },
        }),
      );
    });

    // I1 (final fix wave) — ผจก. ข้ามได้เฉพาะกรอบ 7 วัน ไม่ใช่กติกาอื่นของ engine
    it.each([
      ['PHONE_NEW', 'เปลี่ยนเครื่องได้เฉพาะมือสอง (PHONE_USED)', {}],
      ['สัญญาไม่ ACTIVE', 'สัญญาต้องอยู่ในสถานะ ACTIVE เท่านั้น', {}],
      [
        'PHONE_NEW บนเคส REPAIR (fromRepair บังคับ bypass)',
        'เปลี่ยนเครื่องได้เฉพาะมือสอง (PHONE_USED)',
        {
          outcome: 'REPAIR',
          replacementProductId: null,
          repairTicketId: 'rt-1',
          repairTicket: { id: 'rt-1', status: 'IN_PROGRESS' },
        },
      ],
    ])('I1: %s → 400 ด้วยเหตุผลจริง, ไม่จอง/ไม่ execute', async (_l, reason, caseOverrides) => {
      query.getCase.mockResolvedValue(buildCase(caseOverrides as Record<string, unknown>));
      defect.checkEligibility.mockResolvedValue({
        eligible: false,
        reasons: [reason],
        newProduct: { id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
      });

      await expect(
        svc.confirmSameModel('as-1', { replacementProductId: 'prod-new' } as never, MGR),
      ).rejects.toThrow(new BadRequestException(reason));

      expect(defect.execute).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.updateMany).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
    });

    it('I1: เหตุผลเดียว = กรอบ 7 วัน (ข้อความจริงของ engine) + BM → ผ่านด้วย bypass', async () => {
      query.getCase.mockResolvedValue(buildCase());
      defect.checkEligibility.mockResolvedValue({
        eligible: false,
        reasons: ['พ้นกำหนด 7 วันแล้ว (รับเครื่องเมื่อ 2026-09-01)'],
        newProduct: { id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
      });
      defect.execute.mockResolvedValue({ newContract: { id: 'ct-new', contractNumber: 'CT-1' } });

      await svc.confirmSameModel('as-1', {} as never, MGR);

      expect(defect.execute).toHaveBeenCalledWith(
        expect.objectContaining({ bypassWindowCheck: true }),
        MGR,
      );
    });

    // M4 — claim CAS
    it('M4: จองเคสก่อน execute (CAS stage/replacementContractId/cancelledAt/approvedAt) — count 0 → 409, execute ไม่ถูกเรียก', async () => {
      query.getCase.mockResolvedValue(buildCase());
      defect.checkEligibility.mockResolvedValue({
        eligible: true,
        reasons: [],
        newProduct: { id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
      });
      prisma.afterSalesCase.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(svc.confirmSameModel('as-1', {} as never, MGR)).rejects.toThrow(
        new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว'),
      );

      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'as-1',
          deletedAt: null,
          stage: { in: ['AWAITING_APPROVAL'] },
          replacementContractId: null,
          cancelledAt: null,
          approvedAt: null,
        },
        data: { approvedAt: expect.any(Date), approvedById: MGR.id },
      });
      expect(defect.execute).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
    });

    it('M4: engine ล้ม → ปล่อยการจองคืน (approvedAt/approvedById = null) แล้วส่ง error เดิม', async () => {
      query.getCase.mockResolvedValue(buildCase());
      defect.checkEligibility.mockResolvedValue({
        eligible: true,
        reasons: [],
        newProduct: { id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
      });
      defect.execute.mockRejectedValue(new BadRequestException('engine ล้ม'));

      await expect(svc.confirmSameModel('as-1', {} as never, MGR)).rejects.toThrow('engine ล้ม');

      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.afterSalesCase.updateMany.mock.calls[1][0]).toEqual({
        where: { id: 'as-1', approvedAt: expect.any(Date), replacementContractId: null },
        data: { approvedAt: null, approvedById: null },
      });
    });

    it('residual sweep: ปล่อยการจองคืนไม่สำเร็จ → logger.error พร้อม caseId (ไม่กลืนเงียบ) แล้วยังส่ง error เดิมของ engine', async () => {
      query.getCase.mockResolvedValue(buildCase());
      defect.checkEligibility.mockResolvedValue({
        eligible: true,
        reasons: [],
        newProduct: { id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
      });
      defect.execute.mockRejectedValue(new BadRequestException('engine ล้ม'));
      prisma.afterSalesCase.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockRejectedValueOnce(new Error('DB หลุดตอนปล่อยจอง'));
      const logSpy = jest
        .spyOn((svc as unknown as { logger: { error: jest.Mock } }).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(svc.confirmSameModel('as-1', {} as never, MGR)).rejects.toThrow('engine ล้ม');

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain('caseId=as-1');
      expect(logSpy.mock.calls[0][0]).toContain('DB หลุดตอนปล่อยจอง');
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
        where: { id: 'ct-new', deletedAt: null },
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
              expect.objectContaining({
                kind: 'DELIVERED',
                note: 'ส่งมอบเครื่องใหม่ · สัญญา CT-NEW-0004',
              }),
              expect.objectContaining({ kind: 'CLOSED', note: 'ปิดเคส' }),
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
    // residual sweep — CAS + event REJECTED อยู่ใน $transaction เดียว (tx client) · audit หลัง commit
    function rejectTx(count = 1) {
      const tx = {
        afterSalesCase: {
          updateMany: jest.fn().mockResolvedValue({ count }),
          update: jest.fn().mockResolvedValue({ id: 'as-1', stage: 'CANCELLED' }),
        },
      };
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));
      return tx;
    }

    it('MGR ปฏิเสธเคส AWAITING_APPROVAL SAME_MODEL → ใน tx: CAS เขียน cancelledAt/cancelReason/stage CANCELLED + event REJECTED, audit หลัง tx', async () => {
      query.getCase.mockResolvedValue(buildCase({ stage: 'AWAITING_APPROVAL' }));
      const tx = rejectTx();

      const result = await svc.rejectSameModel(
        'as-1',
        { reason: 'ลูกค้าไม่สะดวกรอ' } as never,
        MGR,
      );

      expect(tx.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'as-1', stage: 'AWAITING_APPROVAL' }),
        data: {
          cancelledAt: expect.any(Date),
          cancelReason: 'ลูกค้าไม่สะดวกรอ',
          stage: 'CANCELLED',
        },
      });
      expect(tx.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: {
          events: {
            create: expect.objectContaining({ kind: 'REJECTED', note: 'ลูกค้าไม่สะดวกรอ' }),
          },
        },
      });
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'as-1', stage: 'CANCELLED' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AFTER_SALES_EXCHANGE_REJECTED', entityId: 'as-1' }),
      );
      expect(tx.afterSalesCase.update.mock.invocationCallOrder[0]).toBeLessThan(
        audit.log.mock.invocationCallOrder[0],
      );
    });

    it('M4: CAS แพ้ (มีคนยืนยัน/เปลี่ยนเป็นซ่อมไปก่อน) → 409 ใน tx, ไม่เขียน event/audit', async () => {
      query.getCase.mockResolvedValue(buildCase({ stage: 'AWAITING_APPROVAL' }));
      const tx = rejectTx(0);

      await expect(
        svc.rejectSameModel('as-1', { reason: 'x'.repeat(10) } as never, MGR),
      ).rejects.toThrow(new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว'));

      expect(tx.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'as-1',
          stage: 'AWAITING_APPROVAL',
          approvedAt: null,
          cancelledAt: null,
        }),
        data: expect.objectContaining({ stage: 'CANCELLED' }),
      });
      expect(tx.afterSalesCase.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
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
          updateMany: jest.fn().mockResolvedValue({ count: 1 }), // M4 CAS
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
          events: {
            create: expect.objectContaining({
              kind: 'OUTCOME_SET',
              note: 'เปลี่ยนเป็น "ซ่อม" แทน · ผู้จ่าย CUSTOMER',
            }),
          },
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
          updateMany: jest.fn().mockResolvedValue({ count: 1 }), // M4 CAS
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

    it('M4: CAS ใน tx แพ้ → 409 ก่อนเปิดใบซ่อม (createInTx ไม่ถูกเรียก)', async () => {
      query.getCase.mockResolvedValue(buildCase({ stage: 'AWAITING_APPROVAL' }));
      const tx = {
        afterSalesCase: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          update: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));

      await expect(svc.switchToRepair('as-1', {} as never, STAFF)).rejects.toThrow(
        new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว'),
      );
      expect(tx.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'as-1',
          stage: 'AWAITING_APPROVAL',
          approvedAt: null,
        }),
        data: { outcome: 'REPAIR', stage: 'RECEIVED' },
      });
      expect(repair.createInTx).not.toHaveBeenCalled();
      expect(tx.afterSalesCase.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
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

/**
 * Task 6 — proxy คำขอมีราคา (อนุมัติ/ปฏิเสธ/ยกเลิก) + preview + รายการเครื่องทดแทน.
 * Second top-level describe (own beforeEach) — keeps the Task 5 describe above untouched
 * in spirit even though its beforeEach needed the 3 new constructor deps to keep compiling.
 */
function buildPricedCase(overrides: Record<string, unknown> = {}) {
  return buildCase({
    outcome: 'PRICED_EXCHANGE',
    exchangeRequestId: 'req-1',
    stage: 'AWAITING_APPROVAL',
    ...overrides,
  });
}

function buildReconcileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'as-1',
    stage: 'AWAITING_APPROVAL',
    outcome: 'PRICED_EXCHANGE',
    cancelledAt: null,
    closedAt: null,
    replacementContractId: null,
    repairTicket: null,
    exchangeRequest: {
      status: 'APPROVED',
      mode: 'PRICED',
      memoAppliedAt: null,
      rejectionReason: null,
      cancelReason: null,
      newContract: null,
    },
    ...overrides,
  };
}

describe('AfterSalesExchangeService — priced exchange proxy (Task 6)', () => {
  let prisma: any;
  let query: any;
  let defect: any;
  let repair: any;
  let audit: any;
  let contractExchange: any;
  let exchangeCancel: any;
  let lookup: any;
  let svc: AfterSalesExchangeService;

  beforeEach(() => {
    prisma = {
      afterSalesCase: {
        update: jest.fn().mockResolvedValue({ id: 'as-1' }),
        findFirstOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contract: { findUnique: jest.fn() },
      product: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    query = { getCase: jest.fn() };
    defect = { checkEligibility: jest.fn(), execute: jest.fn() };
    repair = { createInTx: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    contractExchange = { approve: jest.fn(), reject: jest.fn(), buildPreview: jest.fn() };
    exchangeCancel = { cancel: jest.fn() };
    lookup = { lookup: jest.fn() };

    svc = new AfterSalesExchangeService(
      prisma as never,
      query as never,
      defect as never,
      repair as never,
      audit as never,
      contractExchange as never,
      exchangeCancel as never,
      lookup as never,
    );
  });

  describe('approvePriced', () => {
    const dto = { memoAddendumSigned: true, memoMdmSwapped: true };

    // (a)
    it('MEMO mode → approve ถูกเรียกด้วย dto checkbox, reconcile → CLOSED, event note มี "MEMO"', async () => {
      query.getCase.mockResolvedValue(buildPricedCase());
      contractExchange.approve.mockResolvedValue({
        id: 'req-1',
        newContractId: null,
        mode: 'MEMO',
      });
      prisma.afterSalesCase.findFirstOrThrow.mockResolvedValue(
        buildReconcileRow({
          exchangeRequest: {
            status: 'APPROVED',
            mode: 'MEMO',
            memoAppliedAt: new Date('2026-09-24T10:00:00Z'),
            rejectionReason: null,
            cancelReason: null,
            newContract: null,
          },
        }),
      );
      prisma.afterSalesCase.update.mockResolvedValue({ id: 'as-1', stage: 'CLOSED' });

      const result = await svc.approvePriced('as-1', dto as never, MGR);

      expect(contractExchange.approve).toHaveBeenCalledWith('req-1', MGR, dto);
      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: { id: 'as-1', stage: 'AWAITING_APPROVAL' },
        data: expect.objectContaining({ stage: 'CLOSED' }),
      });
      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: {
          approvedById: MGR.id,
          approvedAt: expect.any(Date),
          events: {
            create: {
              kind: 'APPROVED',
              actorId: MGR.id,
              note: 'อนุมัติ · MEMO ลงผลแล้ว',
            },
          },
        },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AFTER_SALES_EXCHANGE_APPROVED',
          entity: 'after_sales_case',
          entityId: 'as-1',
          userId: MGR.id,
        }),
      );
      // ลำดับ: approve → reconcile (updateMany) → update → audit
      expect(contractExchange.approve.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.afterSalesCase.updateMany.mock.invocationCallOrder[0],
      );
      expect(prisma.afterSalesCase.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.afterSalesCase.update.mock.invocationCallOrder[0],
      );
      expect(prisma.afterSalesCase.update.mock.invocationCallOrder[0]).toBeLessThan(
        audit.log.mock.invocationCallOrder[0],
      );
      expect(result).toEqual({ id: 'as-1', stage: 'CLOSED' });
    });

    it('PRICED mode → note มีเลขสัญญาใหม่จาก prisma.contract.findUnique, reconcile → READY_FOR_PICKUP', async () => {
      query.getCase.mockResolvedValue(buildPricedCase());
      contractExchange.approve.mockResolvedValue({
        id: 'req-1',
        newContractId: 'ct-new',
        mode: 'PRICED',
      });
      prisma.contract.findUnique.mockResolvedValue({ contractNumber: 'CT-NEW-0099' });
      prisma.afterSalesCase.findFirstOrThrow.mockResolvedValue(
        buildReconcileRow({
          exchangeRequest: {
            status: 'APPROVED',
            mode: 'PRICED',
            memoAppliedAt: null,
            rejectionReason: null,
            cancelReason: null,
            newContract: { status: 'DRAFT' },
          },
        }),
      );
      prisma.afterSalesCase.update.mockResolvedValue({ id: 'as-1', stage: 'READY_FOR_PICKUP' });

      await svc.approvePriced('as-1', dto as never, MGR);

      expect(prisma.contract.findUnique).toHaveBeenCalledWith({
        where: { id: 'ct-new', deletedAt: null },
        select: { contractNumber: true },
      });
      // T6-3 — reconcile เขียน stage READY_FOR_PICKUP จริง (CAS จาก stage ที่อ่านมา)
      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: { id: 'as-1', stage: 'AWAITING_APPROVAL' },
        data: { stage: 'READY_FOR_PICKUP' },
      });
      expect(prisma.afterSalesCase.findFirstOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'as-1', deletedAt: null } }),
      );
      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: expect.objectContaining({
          events: {
            create: expect.objectContaining({
              note: 'อนุมัติ · PRICED สัญญาใหม่ CT-NEW-0099 รอเปิดใช้',
            }),
          },
        }),
      });
    });

    it('PRICED mode + contract.findUnique คืน null → fallback ใช้ newContractId แทนเลขสัญญาในข้อความ', async () => {
      query.getCase.mockResolvedValue(buildPricedCase());
      contractExchange.approve.mockResolvedValue({
        id: 'req-1',
        newContractId: 'ct-new',
        mode: 'PRICED',
      });
      prisma.contract.findUnique.mockResolvedValue(null);
      prisma.afterSalesCase.findFirstOrThrow.mockResolvedValue(buildReconcileRow());
      prisma.afterSalesCase.update.mockResolvedValue({ id: 'as-1' });

      await svc.approvePriced('as-1', dto as never, MGR);

      const note = prisma.afterSalesCase.update.mock.calls[0][0].data.events.create.note;
      expect(note).toBe('อนุมัติ · PRICED สัญญาใหม่ ct-new รอเปิดใช้');
    });

    // (b)
    it('engine ปฏิเสธ (เช่น ESCALATE ต้อง OWNER) → ส่งต่อ 403, ไม่แตะเคส/ไม่ audit', async () => {
      query.getCase.mockResolvedValue(buildPricedCase());
      contractExchange.approve.mockRejectedValue(
        new ForbiddenException(
          'ราคารับซื้อต่ำกว่า 70% ของมูลค่าคงเหลือ — ต้องให้ผู้จัดการใหญ่ (OWNER) อนุมัติเท่านั้น',
        ),
      );

      await expect(svc.approvePriced('as-1', dto as never, MGR)).rejects.toThrow(
        ForbiddenException,
      );

      expect(prisma.afterSalesCase.findFirstOrThrow).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.updateMany).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('เคสไม่ใช่ PRICED_EXCHANGE → 400, ไม่เรียก engine', async () => {
      query.getCase.mockResolvedValue(buildCase({ outcome: 'SAME_MODEL_EXCHANGE' }));
      await expect(svc.approvePriced('as-1', dto as never, MGR)).rejects.toThrow(
        BadRequestException,
      );
      expect(contractExchange.approve).not.toHaveBeenCalled();
    });

    it('เคสไม่มี exchangeRequestId → 400 "เคสนี้ไม่มีคำขอเปลี่ยนเครื่อง"', async () => {
      query.getCase.mockResolvedValue(buildPricedCase({ exchangeRequestId: null }));
      await expect(svc.approvePriced('as-1', dto as never, MGR)).rejects.toThrow(
        new BadRequestException('เคสนี้ไม่มีคำขอเปลี่ยนเครื่อง'),
      );
      expect(contractExchange.approve).not.toHaveBeenCalled();
    });

    it('เคสจบแล้ว (CLOSED) → 400, ไม่เรียก engine', async () => {
      query.getCase.mockResolvedValue(buildPricedCase({ stage: 'CLOSED' }));
      await expect(svc.approvePriced('as-1', dto as never, MGR)).rejects.toThrow(
        BadRequestException,
      );
      expect(contractExchange.approve).not.toHaveBeenCalled();
    });

    it('SALES เรียก approvePriced → 403 ก่อนแตะ query.getCase', async () => {
      await expect(svc.approvePriced('as-1', dto as never, SALES)).rejects.toThrow(
        ForbiddenException,
      );
      expect(query.getCase).not.toHaveBeenCalled();
    });
  });

  describe('rejectPriced', () => {
    const dto = { reason: 'ลูกค้ายกเลิกก่อนอนุมัติ' };

    // (c)
    it('BM เรียก rejectPriced → 403 ที่ service (assertOwner) ก่อนแตะ query.getCase', async () => {
      await expect(svc.rejectPriced('as-1', dto as never, MGR)).rejects.toThrow(ForbiddenException);
      expect(query.getCase).not.toHaveBeenCalled();
    });

    it('OWNER เรียกสำเร็จ → reject(requestId, reason, user.id) ถูกเรียก, reconcile → CANCELLED, event REJECTED, audit', async () => {
      query.getCase.mockResolvedValue(buildPricedCase({ stage: 'AWAITING_APPROVAL' }));
      contractExchange.reject.mockResolvedValue({ id: 'req-1', status: 'REJECTED' });
      prisma.afterSalesCase.findFirstOrThrow.mockResolvedValue(
        buildReconcileRow({
          exchangeRequest: {
            status: 'REJECTED',
            mode: 'PRICED',
            memoAppliedAt: null,
            rejectionReason: dto.reason,
            cancelReason: null,
            newContract: null,
          },
        }),
      );
      prisma.afterSalesCase.update.mockResolvedValue({ id: 'as-1', stage: 'CANCELLED' });

      const result = await svc.rejectPriced('as-1', dto as never, OWNER);

      expect(contractExchange.reject).toHaveBeenCalledWith('req-1', dto.reason, OWNER.id);
      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: { id: 'as-1', stage: 'AWAITING_APPROVAL' },
        data: expect.objectContaining({
          stage: 'CANCELLED',
          cancelledAt: expect.any(Date),
          cancelReason: dto.reason,
        }),
      });
      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: {
          events: { create: { kind: 'REJECTED', actorId: OWNER.id, note: dto.reason } },
        },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AFTER_SALES_EXCHANGE_REJECTED_PRICED',
          entity: 'after_sales_case',
          entityId: 'as-1',
        }),
      );
      expect(result).toEqual({ id: 'as-1', stage: 'CANCELLED' });
    });

    it('เคสไม่ใช่ PRICED_EXCHANGE → 400, ไม่เรียก engine', async () => {
      query.getCase.mockResolvedValue(buildCase({ outcome: 'REPAIR' }));
      await expect(svc.rejectPriced('as-1', dto as never, OWNER)).rejects.toThrow(
        BadRequestException,
      );
      expect(contractExchange.reject).not.toHaveBeenCalled();
    });

    it('engine โยน (เช่น คำขออาจถูกตอบกลับแล้ว) → ส่งต่อ error เดิม, ไม่แตะเคส/ไม่ audit', async () => {
      query.getCase.mockResolvedValue(buildPricedCase());
      contractExchange.reject.mockRejectedValue(new ConflictException('คำขออาจถูกตอบกลับแล้ว'));

      await expect(svc.rejectPriced('as-1', dto as never, OWNER)).rejects.toThrow(
        ConflictException,
      );

      expect(prisma.afterSalesCase.updateMany).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('cancelSwap', () => {
    const dto = { reason: 'ลูกค้าเปลี่ยนใจหลังอนุมัติ' };

    // (d)
    it('MGR เรียก cancelSwap → ExchangeCancelService.cancel ถูกเรียก, reconcile → CANCELLED, event CANCELLED', async () => {
      query.getCase.mockResolvedValue(
        buildPricedCase({ stage: 'READY_FOR_PICKUP', replacementContractId: 'ct-new' }),
      );
      exchangeCancel.cancel.mockResolvedValue({
        id: 'req-1',
        cancelWindow: 'FREE',
        penaltyAmount: null,
      });
      prisma.afterSalesCase.findFirstOrThrow.mockResolvedValue(
        buildReconcileRow({
          stage: 'READY_FOR_PICKUP',
          replacementContractId: 'ct-new',
          exchangeRequest: {
            status: 'CANCELED',
            mode: 'PRICED',
            memoAppliedAt: null,
            rejectionReason: null,
            cancelReason: dto.reason,
            newContract: null,
          },
        }),
      );
      prisma.afterSalesCase.update.mockResolvedValue({ id: 'as-1', stage: 'CANCELLED' });

      const result = await svc.cancelSwap('as-1', dto as never, MGR);

      expect(exchangeCancel.cancel).toHaveBeenCalledWith('req-1', dto.reason, MGR);
      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: { id: 'as-1', stage: 'READY_FOR_PICKUP' },
        data: expect.objectContaining({ stage: 'CANCELLED' }),
      });
      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: {
          events: {
            create: {
              kind: 'CANCELLED',
              actorId: MGR.id,
              note: `ยกเลิกคำขอเปลี่ยนเครื่อง: ${dto.reason}`,
            },
          },
        },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AFTER_SALES_EXCHANGE_CANCELLED',
          entity: 'after_sales_case',
          entityId: 'as-1',
        }),
      );
      expect(result).toEqual({ id: 'as-1', stage: 'CANCELLED' });
    });

    // I3 — ยกเลิก swap ที่ลงผลแล้ว (เคส CLOSED) ยังทำได้เมื่อคำขอยัง APPROVED
    it('I3: เคส CLOSED + คำขอ APPROVED (MEMO ลงผลแล้ว) → engine cancel ถูกเรียก, reconcile → CANCELLED + cancelledAt/cancelReason', async () => {
      query.getCase.mockResolvedValue(
        buildPricedCase({ stage: 'CLOSED', exchangeRequest: { status: 'APPROVED' } }),
      );
      exchangeCancel.cancel.mockResolvedValue({ id: 'req-1' });
      prisma.afterSalesCase.findFirstOrThrow.mockResolvedValue(
        buildReconcileRow({
          stage: 'CLOSED',
          closedAt: new Date('2026-09-20T00:00:00Z'),
          exchangeRequest: {
            status: 'CANCELED',
            mode: 'MEMO',
            memoAppliedAt: new Date('2026-09-20T00:00:00Z'),
            rejectionReason: null,
            cancelReason: dto.reason,
            newContract: null,
          },
        }),
      );

      await svc.cancelSwap('as-1', dto as never, MGR);

      expect(exchangeCancel.cancel).toHaveBeenCalledWith('req-1', dto.reason, MGR);
      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: { id: 'as-1', stage: 'CLOSED' },
        data: { stage: 'CANCELLED', cancelledAt: expect.any(Date), cancelReason: dto.reason },
      });
    });

    it.each([
      ['CLOSED + คำขอ CANCELED แล้ว', { stage: 'CLOSED', exchangeRequest: { status: 'CANCELED' } }],
      ['CANCELLED', { stage: 'CANCELLED', exchangeRequest: { status: 'APPROVED' } }],
    ])('I3: เคส %s → 400 "เคสนี้จบแล้ว", ไม่เรียก engine', async (_l, overrides) => {
      query.getCase.mockResolvedValue(buildPricedCase(overrides));
      await expect(svc.cancelSwap('as-1', dto as never, MGR)).rejects.toThrow(
        new BadRequestException('เคสนี้จบแล้ว'),
      );
      expect(exchangeCancel.cancel).not.toHaveBeenCalled();
    });

    it('I3: approvePriced บนเคส CLOSED (คำขอ APPROVED) ยังปฏิเสธ — ยกเว้นเฉพาะ cancelSwap', async () => {
      query.getCase.mockResolvedValue(
        buildPricedCase({ stage: 'CLOSED', exchangeRequest: { status: 'APPROVED' } }),
      );
      await expect(svc.approvePriced('as-1', {} as never, MGR)).rejects.toThrow(
        new BadRequestException('เคสนี้จบแล้ว'),
      );
      expect(contractExchange.approve).not.toHaveBeenCalled();
    });

    it('เคสไม่ใช่ PRICED_EXCHANGE → 400, ไม่เรียก engine', async () => {
      query.getCase.mockResolvedValue(buildCase({ outcome: 'SAME_MODEL_EXCHANGE' }));
      await expect(svc.cancelSwap('as-1', dto as never, MGR)).rejects.toThrow(BadRequestException);
      expect(exchangeCancel.cancel).not.toHaveBeenCalled();
    });

    it('engine โยน (ยกเลิกได้เฉพาะคำขอที่อนุมัติแล้ว) → ส่งต่อ error เดิม, ไม่แตะเคส/ไม่ audit', async () => {
      query.getCase.mockResolvedValue(buildPricedCase());
      exchangeCancel.cancel.mockRejectedValue(
        new BadRequestException('ยกเลิกได้เฉพาะคำขอที่อนุมัติแล้ว'),
      );

      await expect(svc.cancelSwap('as-1', dto as never, MGR)).rejects.toThrow(BadRequestException);

      expect(prisma.afterSalesCase.updateMany).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('SALES เรียก cancelSwap → 403 ก่อนแตะ query.getCase', async () => {
      await expect(svc.cancelSwap('as-1', dto as never, SALES)).rejects.toThrow(ForbiddenException);
      expect(query.getCase).not.toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    const q = {
      imei: 'IMEI-1',
      replacementProductId: 'prod-new',
      buybackPrice: '5000',
      deviceCondition: 'GOOD',
      newTotalMonths: 6,
      newInterestRate: '2.5',
    };

    // (e)
    it('ส่งพารามิเตอร์ครบไปที่ lookup แล้ว buildPreview, คืนผลเดิมของ engine', async () => {
      lookup.lookup.mockResolvedValue({
        contract: { id: 'ct-1', contractNumber: 'CT-1', status: 'ACTIVE' },
      });
      const previewResult = {
        mode: 'PRICED',
        ncv: '10000.00',
        tier: 'AUTO',
        marketMin: '8000.00',
        expectedPl: '500.00',
        blockers: { overdueBlocked: false, advanceBlocked: false },
        hasUnpaidLateFee: false,
      };
      contractExchange.buildPreview.mockResolvedValue(previewResult);

      const result = await svc.preview(q, STAFF);

      expect(lookup.lookup).toHaveBeenCalledWith({ imei: 'IMEI-1' }, STAFF);
      expect(contractExchange.buildPreview).toHaveBeenCalledWith(
        {
          oldContractId: 'ct-1',
          newProductId: 'prod-new',
          buybackPrice: '5000',
          deviceCondition: 'GOOD',
          newTotalMonths: 6,
          newInterestRate: '2.5',
        },
        STAFF,
      );
      expect(result).toBe(previewResult);
    });

    it('ไม่พบสัญญาผ่อนของเครื่องนี้ → 400, ไม่เรียก buildPreview', async () => {
      lookup.lookup.mockResolvedValue({ contract: null });
      await expect(svc.preview(q, STAFF)).rejects.toThrow(
        new BadRequestException('ไม่พบสัญญาผ่อนของเครื่องนี้'),
      );
      expect(contractExchange.buildPreview).not.toHaveBeenCalled();
    });

    it('role ที่ไม่ใช่ OWNER/BM/SALES → 403 ก่อนแตะ lookup', async () => {
      const ACCOUNTANT = { id: 'user-acc', role: 'ACCOUNTANT', branchId: 'branch-1' };
      await expect(svc.preview(q, ACCOUNTANT)).rejects.toThrow(ForbiddenException);
      expect(lookup.lookup).not.toHaveBeenCalled();
    });
  });

  describe('replacementProducts', () => {
    // (f)
    it('sameModel=true โดย SALES → กรอง brand/model/storage/PHONE_USED/IN_STOCK + สาขาของ SALES', async () => {
      lookup.lookup.mockResolvedValue({
        product: {
          id: 'prod-old',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          imeiSerial: 'IMEI-1',
        },
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p1',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          color: 'Black',
          imeiSerial: 'IMEI-2',
          cashPrice: { toString: () => '15000.00' },
          branchId: 'branch-1',
        },
      ]);

      const result = await svc.replacementProducts(
        { imei: 'IMEI-1', sameModel: true } as never,
        SALES,
      );

      expect(lookup.lookup).toHaveBeenCalledWith({ imei: 'IMEI-1' }, SALES);
      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          status: 'IN_STOCK',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          category: 'PHONE_USED',
          branchId: 'branch-1',
        },
        select: {
          id: true,
          brand: true,
          model: true,
          storage: true,
          color: true,
          imeiSerial: true,
          cashPrice: true,
          branchId: true,
        },
        take: 200,
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([
        {
          id: 'p1',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          color: 'Black',
          imeiSerial: 'IMEI-2',
          cashPrice: '15000.00',
          branchId: 'branch-1',
        },
      ]);
    });

    it('sameModel=true แต่ไม่พบเครื่องเดิมจาก IMEI → 400, ไม่เรียก findMany', async () => {
      lookup.lookup.mockResolvedValue({ product: null });
      await expect(
        svc.replacementProducts({ imei: 'IMEI-1', sameModel: true } as never, SALES),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it('cross-branch role (OWNER) + q.branchId ระบุมา → ใช้ q.branchId', async () => {
      lookup.lookup.mockResolvedValue({ product: null });
      prisma.product.findMany.mockResolvedValue([]);

      await svc.replacementProducts(
        { imei: 'IMEI-1', sameModel: false, branchId: 'branch-9' } as never,
        OWNER,
      );

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ branchId: 'branch-9' }) }),
      );
    });

    it('T6-2: sameModel=false → ไม่เรียก lookup (ไม่ต้องใช้เครื่องเดิม)', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await svc.replacementProducts({ imei: 'IMEI-1', sameModel: false } as never, SALES);
      expect(lookup.lookup).not.toHaveBeenCalled();
      expect(prisma.product.findMany).toHaveBeenCalled();
    });

    it('BM ไม่มี branchId ติดตัว → คืน [] ไม่เรียก findMany (fail-closed)', async () => {
      lookup.lookup.mockResolvedValue({ product: null });
      const bmNoBranch = { id: 'user-bm2', role: 'BRANCH_MANAGER', branchId: null };

      const result = await svc.replacementProducts(
        { imei: 'IMEI-1', sameModel: false } as never,
        bmNoBranch,
      );

      expect(result).toEqual([]);
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });
  });
});
