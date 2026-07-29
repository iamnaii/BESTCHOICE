import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeCancelService, bkkDayDiff } from './contract-exchange-cancel.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { ExchangeCancelPenaltyTemplate } from '../journal/cpa-templates/exchange-cancel-penalty.template';

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

  it('+7 วัน → 7 (ขอบบน FREE_7D)', () => {
    expect(bkkDayDiff(base, plusDays(7))).toBe(7);
  });

  it('+8 วัน → 8 (เริ่ม PENALTY_8_30D)', () => {
    expect(bkkDayDiff(base, plusDays(8))).toBe(8);
  });

  it('+31 วัน → 31 (เกินหน้าต่างยกเลิก)', () => {
    expect(bkkDayDiff(base, plusDays(31))).toBe(31);
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
  let penalty: { execute: jest.Mock };
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
    newContract: { id: 'newC1', status: 'ACTIVE' },
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
      },
      badDebtProvision: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      product: {
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          status: 'SOLD_INSTALLMENT',
          ownedByCompanyId: 'finance-co-id',
        }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      installmentSchedule: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue({ value: '5' }) },
      $transaction: jest.fn(async (fn: any) => fn(txMock)),
    };
    reversal = { reverse: jest.fn().mockResolvedValue({ reversalJeIds: ['r1', 'r2'] }) };
    penalty = { execute: jest.fn().mockResolvedValue({ id: 'pje', entryNumber: 'JE-202607-7777' }) };
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
        { provide: ExchangeCancelPenaltyTemplate, useValue: penalty },
      ],
    }).compile();
    svc = mod.get(ExchangeCancelService);
  });

  it('วันที่ 5 → FREE_7D: reverse ทุก JE, ไม่มี penalty, restore สัญญาเก่า ACTIVE', async () => {
    requests.req1 = makeFinalizedReq(5);

    const r = await svc.cancel('req1', 'เครื่องมีปัญหา ลูกค้าขอยกเลิก', user);

    expect(r.cancelWindow).toBe('FREE_7D');
    expect(r.penaltyAmount).toBeNull();
    // Mirror-reverse the full JE chain incl. A.5 ECL reversal
    expect(reversal.reverse).toHaveBeenCalledWith(
      { jeIds: ['je1', 'je2', 'je3', 'je4', 'je5'], newContractId: 'newC1' },
      txMock,
    );
    expect(penalty.execute).not.toHaveBeenCalled();
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
          cancelWindow: 'FREE_7D',
          penaltyAmount: null,
          penaltyJeId: null,
          reversalJeIds: ['r1', 'r2'],
        }),
      }),
    );
  });

  it('วันที่ 15 → PENALTY_8_30D: penalty = 5% × buyback (8000 → 400.00) + JE Cr 42-1107', async () => {
    requests.req1 = makeFinalizedReq(15);

    const r = await svc.cancel('req1', 'ลูกค้าเปลี่ยนใจหลังใช้งาน', user);

    expect(r.cancelWindow).toBe('PENALTY_8_30D');
    expect(r.penaltyAmount).toBe('400.00');
    expect(penalty.execute).toHaveBeenCalledTimes(1);
    const pInput = penalty.execute.mock.calls[0][0];
    expect(pInput.requestId).toBe('req1');
    expect(pInput.oldContractId).toBe('oldC1');
    expect(pInput.depositAccountCode).toBe('11-1101');
    expect(pInput.penalty.toFixed(2)).toBe('400.00');
    // Penalty JE id persisted on the request
    expect(txMock.contractExchangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cancelWindow: 'PENALTY_8_30D', penaltyJeId: 'pje' }),
      }),
    );
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
    expect(penalty.execute).not.toHaveBeenCalled();
    expect(txMock.contract.update).not.toHaveBeenCalled();
    expect(txMock.product.update).not.toHaveBeenCalled();
    expect(txMock.contractExchangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('penalty pct = "0" (ปิดค่าปรับ) → วันที่ 15: ไม่มี penalty JE, penaltyAmount null, window ยัง PENALTY_8_30D', async () => {
    requests.req1 = makeFinalizedReq(15);
    txMock.systemConfig.findFirst.mockResolvedValue({ value: '0' });

    const r = await svc.cancel('req1', 'ยกเลิกช่วงเจ้าของปิดค่าปรับ', user);

    expect(r.cancelWindow).toBe('PENALTY_8_30D');
    expect(r.penaltyAmount).toBeNull();
    expect(penalty.execute).not.toHaveBeenCalled();
    // Reversal + restores still run in full
    expect(reversal.reverse).toHaveBeenCalledTimes(1);
    expect(txMock.contractExchangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelWindow: 'PENALTY_8_30D',
          penaltyAmount: null,
          penaltyJeId: null,
        }),
      }),
    );
  });

  it('วันที่ 31 → BadRequest "เกิน 30 วัน"', async () => {
    requests.req1 = makeFinalizedReq(31);

    await expect(svc.cancel('req1', 'สายเกินไปแล้วนะ', user)).rejects.toThrow('30 วัน');
    await expect(svc.cancel('req1', 'สายเกินไปแล้วนะ', user)).rejects.toThrow(BadRequestException);
    expect(reversal.reverse).not.toHaveBeenCalled();
    expect(penalty.execute).not.toHaveBeenCalled();
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
    expect(penalty.execute).not.toHaveBeenCalled();
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
  const makeMemoReq = () => ({
    id: 'memoReq',
    deletedAt: null,
    status: 'APPROVED',
    mode: 'MEMO',
    oldContractId: 'oldC1',
    oldProductId: 'oldP1',
    newProductId: 'newP1',
    newContractId: null,
    memoAppliedAt: daysAgo(5),
    approvedAt: daysAgo(5),
    createdAt: daysAgo(6),
    oldContract: {
      id: 'oldC1',
      status: 'ACTIVE',
      branchId: 'br-1',
      productId: 'newP1',
      exchangedAt: null,
    },
    newContract: null,
  });

  it('MEMO cancel ≤30 วัน: สลับ productId กลับ, ไม่มี JE, ไม่มี penalty', async () => {
    requests.memoReq = makeMemoReq();

    const r = await svc.cancel('memoReq', 'ลูกค้าขอเครื่องเดิมคืน', user);

    // MEMO_30D — distinct window label for reporting (MEMO ไม่มี penalty ทุกวัน)
    expect(r.cancelWindow).toBe('MEMO_30D');
    expect(r.penaltyAmount).toBeNull();
    expect(txMock.contractExchangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cancelWindow: 'MEMO_30D' }),
      }),
    );
    // No JE posted at all (templates are the only JE paths in this service)
    expect(reversal.reverse).not.toHaveBeenCalled();
    expect(penalty.execute).not.toHaveBeenCalled();
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
    expect(r.cancelWindow).toBe('FREE_7D');
  });
});
