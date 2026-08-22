import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeCancelService, bkkDayDiff } from './contract-exchange-cancel.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';

// ============================================================================
// bkkDayDiff — pure function (จำนวนวันปฏิทิน Asia/Bangkok)
// ============================================================================
describe('bkkDayDiff (วันปฏิทิน BKK)', () => {
  // 2026-07-01T05:00:00Z = 12:00 BKK — noon keeps +N*24h on the same BKK clock time
  const base = new Date('2026-07-01T05:00:00Z');
  const plusDays = (n: number) => new Date(base.getTime() + n * 86_400_000);

  it('วัน BKK เดียวกัน → 0', () => {
    // 10:00 BKK vs 17:00 BKK same day
    expect(bkkDayDiff(new Date('2026-07-15T03:00:00Z'), new Date('2026-07-15T10:00:00Z'))).toBe(0);
  });

  it('+7 วัน → 7', () => {
    expect(bkkDayDiff(base, plusDays(7))).toBe(7);
  });

  it('+8 วัน → 8', () => {
    expect(bkkDayDiff(base, plusDays(8))).toBe(8);
  });

  // owner decision 2026-07-31 removed the 30-day cancellation cap — this
  // pure date-math check just confirms bkkDayDiff keeps counting past it
  // (the service no longer reads this value as a threshold, only for audit).
  it('+45 วัน → 45 (เกินเพดานเดิม — ตอนนี้ยกเลิกได้ทุกเมื่อ)', () => {
    expect(bkkDayDiff(base, plusDays(45))).toBe(45);
  });

  it('ข้ามเที่ยงคืน BKK: 23:59 → 00:01 (ห่าง 2 นาที) → 1', () => {
    const from = new Date('2026-07-01T16:59:00Z'); // 23:59 BKK 1 ก.ค.
    const to = new Date('2026-07-01T17:01:00Z'); // 00:01 BKK 2 ก.ค.
    expect(bkkDayDiff(from, to)).toBe(1);
  });
});

// ============================================================================
// ExchangeCancelService — 6 หัวใจ (spec §9, workbook Cases 3A/3B)
// ============================================================================
describe('ExchangeCancelService (spec §9)', () => {
  let svc: ExchangeCancelService;
  let txMock: any; // PrismaService mock; $transaction executes the callback with the same object
  let reversal: { reverse: jest.Mock };
  let audit: any;
  let requests: Record<string, any>;

  // OWNER = cross-branch role → passes the I7 branch check for any branch
  const user = { id: 'u-owner', role: 'OWNER', branchId: null };
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  // Finalized PRICED request: JE chain posted at activation (je1..je4 + A.5 ECL)
  const makeFinalizedReq = (exchangedDaysAgo: number) => ({
    id: 'req1',
    deletedAt: null,
    status: 'APPROVED',
    mode: 'PRICED',
    oldContractId: 'oldC1',
    oldProductId: 'oldP1',
    newProductId: 'newP1',
    newContractId: 'newC1',
    je1aId: 'je1',
    je2Id: 'je2',
    je3Id: 'je3',
    je4Id: 'je4',
    eclReversalJeId: 'je5',
    buybackPrice: new Decimal('8000'),
    depositAccountCode: '11-1101',
    memoAppliedAt: null,
    approvedAt: daysAgo(exchangedDaysAgo),
    createdAt: daysAgo(exchangedDaysAgo),
    oldContract: {
      id: 'oldC1',
      status: 'EXCHANGED',
      branchId: 'br-1',
      productId: 'oldP1',
      exchangedAt: daysAgo(exchangedDaysAgo),
    },
    newContract: {
      id: 'newC1',
      status: 'ACTIVE',
      // Park guard 3 ถัง (final review Phase 3 — Important 2ก): ค่า 0 = ผ่าน
      advanceBalance: new Decimal('0'),
      creditBalance: new Decimal('0'),
      rescheduleAdvanceBalance: new Decimal('0'),
    },
  });

  beforeEach(async () => {
    requests = {};
    txMock = {
      contractExchangeRequest: {
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => requests[where.id] ?? null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contract: {
        update: jest.fn().mockResolvedValue({}),
        // CAS soft-delete of the DRAFT contract (PRE_FINALIZE path)
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // restore guard ชั้น 2 — สัญญาที่ยังไม่จบซึ่งอ้างเครื่องเก่าอยู่
        findFirst: jest.fn().mockResolvedValue(null),
      },
      badDebtProvision: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      // Phase 3 Task 5 (C-2): open-batch guard (findFirst → null = ไม่มีรอบเปิด)
      // + POSTED SETTLEMENT detect (findMany → [] = ไม่เคยตัดจ่าย ⇒ isC2 false —
      // ทุกเทสเดิมในไฟล์นี้จึงเดินเส้น C-1 byte-เดิม รวม assertion ที่ปักว่า
      // reverse ถูกเรียกโดย "ไม่มี" key redirects/redirectStamp)
      interCoSettlementItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Pre-sweep scan (final review Phase 3 — cash tripwire + C-2 defensive):
      // [] = ไม่มี candidate ผิดปกติ ⇒ ทุกเทสเดิมเดินเส้นเดิม
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
      product: {
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          status: 'SOLD_INSTALLMENT',
          ownedByCompanyId: 'finance-co-id',
        }),
        // Final review I-1: restore guard อ่านเครื่องเก่าก่อนชุบชีวิตสัญญา —
        // ค่า default = สภาพหลัง swap ปกติ (อยู่บนชั้น ยังไม่ถูกผูกไปที่อื่น)
        findUnique: jest.fn().mockResolvedValue({
          id: 'oldP1',
          status: 'REFURBISHED',
          deletedAt: null,
        }),
      },
      // ชั้น 2-4 ของ `assertProductNotHeld` (สัญญาที่ยังเดิน / จองบนเว็บ / ออเดอร์ค้าง)
      productReservation: { findFirst: jest.fn().mockResolvedValue(null) },
      onlineOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      installmentSchedule: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (fn: any) => fn(txMock)),
    };
    reversal = { reverse: jest.fn().mockResolvedValue({ reversalJeIds: ['r1', 'r2'] }) };
    audit = { log: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        ExchangeCancelService,
        { provide: PrismaService, useValue: txMock },
        { provide: AuditService, useValue: audit },
        {
          provide: CompanyResolverService,
          useValue: {
            getShopCompanyId: jest.fn().mockResolvedValue('shop-co-id'),
            getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-id'),
          },
        },
        { provide: ExchangeCancelReversalTemplate, useValue: reversal },
      ],
    }).compile();
    svc = mod.get(ExchangeCancelService);
  });

  it('วันที่ 5 → FREE: reverse ทุก JE, ไม่มี penalty, restore สัญญาเก่า ACTIVE', async () => {
    requests.req1 = makeFinalizedReq(5);

    const r = await svc.cancel('req1', 'เครื่องมีปัญหา ลูกค้าขอยกเลิก', user);

    expect(r.cancelWindow).toBe('FREE');
    expect(r.penaltyAmount).toBeNull();
    // Mirror-reverse the full JE chain incl. A.5 ECL reversal
    expect(reversal.reverse).toHaveBeenCalledWith(
      { jeIds: ['je1', 'je2', 'je3', 'je4', 'je5'], newContractId: 'newC1' },
      txMock,
    );
    // Restore: old contract back to ACTIVE, exchangedAt cleared
    expect(txMock.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'oldC1' },
        data: expect.objectContaining({ status: 'ACTIVE', exchangedAt: null }),
      }),
    );
    // New contract CANCELED + exchangedFromContractId nulled (C1a — the
    // @unique pointer must not brick a future re-exchange of the old contract)
    expect(txMock.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'newC1' },
        data: expect.objectContaining({ status: 'CANCELED', exchangedFromContractId: null }),
      }),
    );
    // Product flips: old device back on installment under FINANCE; new device back to SHOP stock
    expect(txMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'oldP1' },
        data: expect.objectContaining({
          status: 'SOLD_INSTALLMENT',
          ownedByCompanyId: 'finance-co-id',
        }),
      }),
    );
    expect(txMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'newP1' },
        data: expect.objectContaining({ status: 'IN_STOCK', ownedByCompanyId: 'shop-co-id' }),
      }),
    );
    // Soft-delete the new contract's schedule + payments
    expect(txMock.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contractId: 'newC1' }),
        data: { deletedAt: expect.any(Date) },
      }),
    );
    expect(txMock.installmentSchedule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contractId: 'newC1' }),
        data: { deletedAt: expect.any(Date) },
      }),
    );
    // CAS lock stamps cancel fields
    expect(txMock.contractExchangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'req1', status: 'APPROVED' }),
        data: expect.objectContaining({
          status: 'CANCELED',
          cancelWindow: 'FREE',
          penaltyAmount: null,
          penaltyJeId: null,
          reversalJeIds: ['r1', 'r2'],
        }),
      }),
    );
  });

  // Owner decision 2026-07-31: cancellation windows + the 5%/8-30-day penalty
  // rule were removed entirely — cancel succeeds at ANY day past finalize,
  // with no penalty JE ever posted. This replaces the old day-31 BadRequest
  // test (the 30-day cap no longer exists).
  it('วันที่ 45 (เกินเพดานเดิม) → SUCCEEDS: window FREE, ไม่มี penalty JE', async () => {
    requests.req1 = makeFinalizedReq(45);

    const r = await svc.cancel('req1', 'ยกเลิกหลังผ่านไปนาน — ไม่มีเพดานแล้ว', user);

    expect(r.cancelWindow).toBe('FREE');
    expect(r.penaltyAmount).toBeNull();
    expect(reversal.reverse).toHaveBeenCalledTimes(1);
    expect(txMock.contractExchangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelWindow: 'FREE',
          penaltyAmount: null,
          penaltyJeId: null,
        }),
      }),
    );
  });

  // Workbook 2026-08-19 Phase 1 (Task 5): A.4 เขียนทับ product.costPrice เป็น
  // ราคารับซื้อตอน finalize — cancel ต้อง restore กลับจาก snapshot
  // request.previousCostPrice (Task 3/4)
  it('previousCostPrice มีค่า → restore costPrice บนเครื่องเก่าตอน cancel', async () => {
    requests.req1 = { ...makeFinalizedReq(5), previousCostPrice: new Decimal('7500.00') };

    await svc.cancel('req1', 'ทดสอบ restore costPrice', user);

    expect(txMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'oldP1' },
        data: expect.objectContaining({
          status: 'SOLD_INSTALLMENT',
          ownedByCompanyId: 'finance-co-id',
          costPrice: new Decimal('7500.00'),
        }),
      }),
    );
  });

  it('previousCostPrice null (finalize ก่อนฟีเจอร์ — forward-only) → ไม่แตะ costPrice', async () => {
    requests.req1 = { ...makeFinalizedReq(5), previousCostPrice: null };

    await svc.cancel('req1', 'ทดสอบ legacy ไม่มี snapshot', user);

    const oldProdCall = txMock.product.update.mock.calls.find(
      ([arg]: [any]) => arg.where.id === 'oldP1',
    );
    expect(oldProdCall).toBeDefined();
    expect('costPrice' in oldProdCall![0].data).toBe(false);
  });

  it('FINALIZED แต่สัญญาใหม่ไม่ ACTIVE (COMPLETED) → BadRequest, ไม่หลุดไป PRE_FINALIZE ไม่แตะอะไร', async () => {
    // exchangedAt set = finalized จริง; newContract COMPLETED ต้องถูก REJECT —
    // ห้าม route ไป PRE_FINALIZE (จะ soft-delete สัญญาจริงโดยไม่มี reversal/paid-guard)
    requests.req1 = {
      ...makeFinalizedReq(5),
      newContract: { id: 'newC1', status: 'COMPLETED' },
    };

    await expect(svc.cancel('req1', 'ลองยกเลิกหลังปิดสัญญาใหม่', user)).rejects.toThrow(
      'ยกเลิกเปลี่ยนเครื่องไม่ได้',
    );
    expect(reversal.reverse).not.toHaveBeenCalled();
    expect(txMock.contract.update).not.toHaveBeenCalled();
    expect(txMock.product.update).not.toHaveBeenCalled();
    expect(txMock.contractExchangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('สัญญาใหม่มี amountPaid > 0 → BadRequest ให้ void ใบเสร็จก่อน', async () => {
    requests.req1 = makeFinalizedReq(5);
    txMock.payment.findFirst.mockResolvedValue({ id: 'p1' });

    await expect(svc.cancel('req1', 'มีจ่ายแล้วลองยกเลิก', user)).rejects.toThrow('void');
    expect(reversal.reverse).not.toHaveBeenCalled();
    expect(txMock.contract.update).not.toHaveBeenCalled();
  });

  it('PRE_FINALIZE (DRAFT ยังไม่เซ็น): CAS soft-delete สัญญาใหม่ + null pointer + คืน product, ไม่มี reversal JE', async () => {
    requests.reqDraft = {
      ...makeFinalizedReq(5),
      id: 'reqDraft',
      je1aId: null,
      je2Id: null,
      je3Id: null,
      je4Id: null,
      eclReversalJeId: null,
      oldContract: { id: 'oldC1', status: 'EXCHANGED', branchId: 'br-1', productId: 'oldP1', exchangedAt: null }, // ยังไม่ finalize
      newContract: { id: 'newC1', status: 'DRAFT' },
    };

    const r = await svc.cancel('reqDraft', 'ลูกค้าไม่มาเซ็นสัญญา', user);

    expect(r.cancelWindow).toBe('PRE_FINALIZE');
    expect(r.penaltyAmount).toBeNull();
    // CAS soft-delete: guarded on status=DRAFT (concurrent-activation race) +
    // exchangedFromContractId nulled in the same write (C1a)
    expect(txMock.contract.updateMany).toHaveBeenCalledWith({
      where: { id: 'newC1', status: 'DRAFT', deletedAt: null },
      data: { deletedAt: expect.any(Date), exchangedFromContractId: null },
    });
    expect(txMock.contract.update).not.toHaveBeenCalled(); // old contract untouched
    expect(txMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'newP1' },
        data: expect.objectContaining({ status: 'IN_STOCK' }),
      }),
    );
    // NO JE of any kind
    expect(reversal.reverse).not.toHaveBeenCalled();
  });

  it('PRE_FINALIZE race: DRAFT ถูก activate ระหว่างยกเลิก (CAS count=0) → Conflict, ไม่แตะ product', async () => {
    requests.reqDraft = {
      ...makeFinalizedReq(5),
      id: 'reqDraft',
      je1aId: null,
      je2Id: null,
      je3Id: null,
      je4Id: null,
      eclReversalJeId: null,
      oldContract: { id: 'oldC1', status: 'EXCHANGED', branchId: 'br-1', productId: 'oldP1', exchangedAt: null },
      newContract: { id: 'newC1', status: 'DRAFT' },
    };
    txMock.contract.updateMany.mockResolvedValue({ count: 0 });

    await expect(svc.cancel('reqDraft', 'ยกเลิกชนกับ activation', user)).rejects.toThrow(
      ConflictException,
    );
    expect(txMock.product.update).not.toHaveBeenCalled();
    expect(txMock.contractExchangeRequest.updateMany).not.toHaveBeenCalled();
  });

  // Post-MEMO state: contract ACTIVE + pointing at the request's NEW product
  // (I4 guard requires both before the blind revert may run).
  const makeMemoReq = (memoDaysAgo = 5) => ({
    id: 'memoReq',
    deletedAt: null,
    status: 'APPROVED',
    mode: 'MEMO',
    oldContractId: 'oldC1',
    oldProductId: 'oldP1',
    newProductId: 'newP1',
    newContractId: null,
    memoAppliedAt: daysAgo(memoDaysAgo),
    approvedAt: daysAgo(memoDaysAgo),
    createdAt: daysAgo(memoDaysAgo + 1),
    oldContract: {
      id: 'oldC1',
      status: 'ACTIVE',
      branchId: 'br-1',
      productId: 'newP1',
      exchangedAt: null,
    },
    newContract: null,
  });

  it('MEMO cancel: สลับ productId กลับ, ไม่มี JE, ไม่มี penalty', async () => {
    requests.memoReq = makeMemoReq();

    const r = await svc.cancel('memoReq', 'ลูกค้าขอเครื่องเดิมคืน', user);

    // MEMO — distinct window label for reporting (MEMO ไม่มี penalty ทุกวัน)
    expect(r.cancelWindow).toBe('MEMO');
    expect(r.penaltyAmount).toBeNull();
    expect(txMock.contractExchangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cancelWindow: 'MEMO' }),
      }),
    );
    // No JE posted at all (templates are the only JE paths in this service)
    expect(reversal.reverse).not.toHaveBeenCalled();
    // Contract points back at the old product
    expect(txMock.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'oldC1' },
        data: expect.objectContaining({ productId: 'oldP1' }),
      }),
    );
    // Old device inherits the new device's current status/ownership; new device back to SHOP stock
    expect(txMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'oldP1' },
        data: expect.objectContaining({
          status: 'SOLD_INSTALLMENT',
          ownedByCompanyId: 'finance-co-id',
        }),
      }),
    );
    expect(txMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'newP1' },
        data: expect.objectContaining({ status: 'IN_STOCK', ownedByCompanyId: 'shop-co-id' }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXCHANGE_MEMO_CANCELED', entityId: 'memoReq' }),
    );
  });

  // ==========================================================================
  // Phase 5 Task 5 ข้อ 0 — audit ของ MEMO/PRE_FINALIZE ถูกกลืนด้วย P2028
  //
  // FINALIZED path ย้าย audit ออกไปหลัง commit ตั้งแต่ Phase 3 (pendingAudit)
  // แต่สองเส้นทางนี้ยัง `await this.audit.log(...)` อยู่ **ข้างใน** $transaction —
  // `AuditService.log` เปิด root-client `$transaction` ของตัวเอง (hash chain)
  // ⇒ nested root-tx ที่ doctrine R-1 ห้าม ⇒ P2028 และ log() กลืน error ทิ้ง
  // ⇒ ไม่มีแถว audit เลยทั้งที่กรรมสิทธิ์เครื่อง/สัญญาถูกสลับกลับจริง.
  // ==========================================================================
  it('MEMO cancel: audit EXCHANGE_MEMO_CANCELED ต้องเขียนหลัง tx commit (ไม่ใช่ระหว่าง tx)', async () => {
    requests.memoReq = makeMemoReq();
    const auditInsideTx: boolean[] = [];
    let inTx = false;
    txMock.$transaction.mockImplementation(async (fn: any) => {
      inTx = true;
      try {
        return await fn(txMock);
      } finally {
        inTx = false;
      }
    });
    audit.log.mockImplementation(async () => {
      auditInsideTx.push(inTx);
    });

    await svc.cancel('memoReq', 'ลูกค้าขอเครื่องเดิมคืน', user);

    expect(audit.log).toHaveBeenCalledTimes(1);
    // audit ต้องถูกเรียกนอก $transaction (false = หลัง commit)
    expect(auditInsideTx).toEqual([false]);
  });

  it('MEMO cancel: tx ล้มเหลว → ไม่เขียน audit (กัน phantom audit row)', async () => {
    requests.memoReq = makeMemoReq();
    txMock.contract.update.mockRejectedValueOnce(new Error('db exploded'));
    await expect(svc.cancel('memoReq', 'ลูกค้าขอเครื่องเดิมคืน', user)).rejects.toThrow(
      'db exploded',
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('PRE_FINALIZE cancel: audit EXCHANGE_CANCELED ต้องเขียนหลัง tx commit (ไม่ใช่ระหว่าง tx)', async () => {
    requests.reqDraft = {
      ...makeFinalizedReq(5),
      id: 'reqDraft',
      je1aId: null,
      je2Id: null,
      je3Id: null,
      je4Id: null,
      eclReversalJeId: null,
      oldContract: {
        id: 'oldC1',
        status: 'EXCHANGED',
        branchId: 'br-1',
        productId: 'oldP1',
        exchangedAt: null,
      },
      newContract: { id: 'newC1', status: 'DRAFT' },
    };
    const auditInsideTx: boolean[] = [];
    let inTx = false;
    txMock.$transaction.mockImplementation(async (fn: any) => {
      inTx = true;
      try {
        return await fn(txMock);
      } finally {
        inTx = false;
      }
    });
    audit.log.mockImplementation(async () => {
      auditInsideTx.push(inTx);
    });

    await svc.cancel('reqDraft', 'ลูกค้าไม่มาเซ็นสัญญา', user);

    expect(audit.log).toHaveBeenCalledTimes(1);
    // audit ต้องถูกเรียกนอก $transaction (false = หลัง commit)
    expect(auditInsideTx).toEqual([false]);
  });

  // Owner decision 2026-07-31: MEMO also lost its 30-day cap — cancel at day
  // 45 must succeed exactly like day 5, still with no JE and no penalty.
  it('MEMO cancel วันที่ 45 (เกินเพดานเดิม) → SUCCEEDS เหมือนวันที่ 5, ไม่มี JE, ไม่มี penalty', async () => {
    requests.memoReq = makeMemoReq(45);

    const r = await svc.cancel('memoReq', 'ยกเลิก MEMO หลังผ่านไปนาน — ไม่มีเพดานแล้ว', user);

    expect(r.cancelWindow).toBe('MEMO');
    expect(r.penaltyAmount).toBeNull();
    expect(reversal.reverse).not.toHaveBeenCalled();
    expect(txMock.contractExchangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cancelWindow: 'MEMO', penaltyAmount: null, penaltyJeId: null }),
      }),
    );
  });

  // ==========================================================================
  // Final review 2026-07-29 — I3 / I4 / I7
  // ==========================================================================

  // I3 — the ECL cron may have provisioned the NEW contract during the window;
  // cancel must REVERSE those rows (their JEs are mirror-reversed by the sweep).
  it('I3: FINALIZED cancel → BadDebtProvision rows ของสัญญาใหม่ ACTIVE → REVERSED', async () => {
    requests.req1 = makeFinalizedReq(5);

    await svc.cancel('req1', 'ทดสอบ reverse provision rows', user);

    expect(txMock.badDebtProvision.updateMany).toHaveBeenCalledWith({
      where: { contractId: 'newC1', status: 'ACTIVE', deletedAt: null },
      data: { status: 'REVERSED' },
    });
  });

  // I4 — MEMO cancel guards: blind revert only when the contract is still in
  // the post-MEMO state (ACTIVE + pointing at the request's NEW product).
  it('I4: MEMO cancel เมื่อสัญญาไม่ ACTIVE (EARLY_PAYOFF) → BadRequest, ไม่แตะอะไร', async () => {
    requests.memoReq = makeMemoReq();
    requests.memoReq.oldContract.status = 'EARLY_PAYOFF';

    await expect(svc.cancel('memoReq', 'ยกเลิกหลังสัญญาปิดไปแล้ว', user)).rejects.toThrow(
      'ยกเลิกแบบ MEMO ไม่ได้',
    );
    expect(txMock.contract.update).not.toHaveBeenCalled();
    expect(txMock.product.update).not.toHaveBeenCalled();
    expect(txMock.contractExchangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('I4: MEMO cancel เมื่อ contract.productId ไม่ใช่เครื่องใหม่ของคำขอ (สลับซ้ำ/สัญญาเปลี่ยน) → BadRequest', async () => {
    requests.memoReq = makeMemoReq();
    requests.memoReq.oldContract.productId = 'someOtherProduct'; // e.g. a LATER memo swap

    await expect(svc.cancel('memoReq', 'ยกเลิกหลังสลับเครื่องรอบใหม่', user)).rejects.toThrow(
      BadRequestException,
    );
    expect(txMock.contract.update).not.toHaveBeenCalled();
    expect(txMock.product.update).not.toHaveBeenCalled();
  });

  // I7 — branch scoping: BM must not cancel another branch's swap by UUID
  it('I7: BRANCH_MANAGER ต่างสาขา → Forbidden ก่อนแตะ state ใดๆ', async () => {
    requests.req1 = makeFinalizedReq(5); // oldContract.branchId = 'br-1'

    await expect(
      svc.cancel('req1', 'BM สาขาอื่นลองยกเลิก', {
        id: 'u-bm',
        role: 'BRANCH_MANAGER',
        branchId: 'br-OTHER',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(reversal.reverse).not.toHaveBeenCalled();
    expect(txMock.contract.update).not.toHaveBeenCalled();
    expect(txMock.contractExchangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('I7: BRANCH_MANAGER สาขาเดียวกัน → ยกเลิกได้', async () => {
    requests.req1 = makeFinalizedReq(5);

    const r = await svc.cancel('req1', 'BM สาขาตัวเองยกเลิก', {
      id: 'u-bm',
      role: 'BRANCH_MANAGER',
      branchId: 'br-1',
    });
    expect(r.cancelWindow).toBe('FREE');
  });

  // ==========================================================================
  // Final review I-1 — ยกเลิกเปลี่ยนเครื่องต้องไม่ชุบชีวิตสัญญาบนเครื่องที่ถูกผูกไปที่อื่นแล้ว
  //
  // Phase 5 Task 3 ทำให้ REFURBISHED → IN_STOCK เป็นปุ่มชั้นหนึ่ง ⇒ ลำดับนี้เดินได้จริง:
  //   finalize swap → เครื่องเก่า REFURBISHED → กดปุ่มนำเข้าคลัง → POS ขายให้ลูกค้า B
  //   → มีคนยกเลิก swap → เครื่องเก่าถูก flip กลับเป็น SOLD_INSTALLMENT + สัญญาเก่า ACTIVE
  // = เครื่องตัวเดียวมีทั้งใบขายของ B และสัญญาผ่อนที่ยังเดินของ A
  // ==========================================================================
  describe('I-1: restore guard บนเครื่องเก่า (ทั้ง FINALIZED และ MEMO)', () => {
    it('FINALIZED: เครื่องเก่าถูกขายสดไปแล้ว → BadRequest, ไม่ reverse JE, ไม่แตะ state', async () => {
      requests.req1 = makeFinalizedReq(5);
      txMock.product.findUnique.mockResolvedValue({
        id: 'oldP1',
        status: 'SOLD_CASH',
        deletedAt: null,
      });

      await expect(svc.cancel('req1', 'ยกเลิกหลังเครื่องเก่าถูกขายไปแล้ว', user)).rejects.toThrow(
        BadRequestException,
      );
      expect(reversal.reverse).not.toHaveBeenCalled();
      expect(txMock.contract.update).not.toHaveBeenCalled();
      expect(txMock.product.update).not.toHaveBeenCalled();
      expect(txMock.contractExchangeRequest.updateMany).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('FINALIZED: เครื่องเก่าถูกลบไปแล้ว (deletedAt) → BadRequest (สัญญาจะชี้ไปแถวที่ถูกลบ)', async () => {
      requests.req1 = makeFinalizedReq(5);
      txMock.product.findUnique.mockResolvedValue({
        id: 'oldP1',
        status: 'REFURBISHED',
        deletedAt: new Date(),
      });

      await expect(svc.cancel('req1', 'ยกเลิกหลังเครื่องเก่าถูกลบ', user)).rejects.toThrow(
        BadRequestException,
      );
      expect(reversal.reverse).not.toHaveBeenCalled();
      expect(txMock.product.update).not.toHaveBeenCalled();
    });

    it('FINALIZED: เครื่องเก่าถูกจองบนเว็บ (ไม่แตะ product.status) → BadRequest', async () => {
      requests.req1 = makeFinalizedReq(5);
      txMock.productReservation.findFirst.mockResolvedValue({
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      await expect(svc.cancel('req1', 'ยกเลิกขณะมีคนจองเครื่องเก่า', user)).rejects.toThrow(
        BadRequestException,
      );
      expect(reversal.reverse).not.toHaveBeenCalled();
      expect(txMock.product.update).not.toHaveBeenCalled();
    });

    it('MEMO: เครื่องเก่าถูกขายสดไปแล้ว → BadRequest, ไม่สลับ productId กลับ', async () => {
      requests.memoReq = makeMemoReq();
      txMock.product.findUnique.mockResolvedValue({
        id: 'oldP1',
        status: 'SOLD_CASH',
        deletedAt: null,
      });

      await expect(
        svc.cancel('memoReq', 'ยกเลิก MEMO หลังเครื่องเก่าถูกขายไปแล้ว', user),
      ).rejects.toThrow(BadRequestException);
      expect(txMock.contract.update).not.toHaveBeenCalled();
      expect(txMock.product.update).not.toHaveBeenCalled();
      expect(txMock.contractExchangeRequest.updateMany).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('MEMO: เครื่องเก่าไปอยู่ในสัญญาผ่อนใบอื่นที่ยังเดิน → BadRequest (ชั้นสัญญา ไม่ใช่ชั้นสถานะ)', async () => {
      requests.memoReq = makeMemoReq();
      txMock.contract.findFirst.mockResolvedValue({
        contractNumber: 'CT-OTHER-0001',
        status: 'ACTIVE',
      });

      await expect(
        svc.cancel('memoReq', 'ยกเลิก MEMO ขณะเครื่องเก่าอยู่ในสัญญาใบอื่น', user),
      ).rejects.toThrow(BadRequestException);
      expect(txMock.contract.update).not.toHaveBeenCalled();
      expect(txMock.product.update).not.toHaveBeenCalled();
    });

    it('เครื่องเก่ายังอยู่บนชั้น (REFURBISHED / IN_STOCK / DAMAGED) → ยกเลิกได้ตามเดิม', async () => {
      for (const status of ['REFURBISHED', 'IN_STOCK', 'DAMAGED']) {
        requests.req1 = makeFinalizedReq(5);
        txMock.product.findUnique.mockResolvedValue({ id: 'oldP1', status, deletedAt: null });

        const r = await svc.cancel('req1', `ยกเลิกขณะเครื่องเก่าสถานะ ${status}`, user);
        expect(r.cancelWindow).toBe('FREE');
      }
    });

    it('เครื่องเก่าหายไปจากฐานข้อมูล (แถวไม่มีจริง) → NotFound ไม่ใช่ crash', async () => {
      requests.req1 = makeFinalizedReq(5);
      txMock.product.findUnique.mockResolvedValue(null);

      await expect(svc.cancel('req1', 'ยกเลิกขณะไม่พบเครื่องเก่า', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(reversal.reverse).not.toHaveBeenCalled();
    });
  });
});
