import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { DefectExchangeService } from './defect-exchange.service';
import * as credit from './defect-exchange-credit';
import * as gl from '../journal/gl-contract-balance';

jest.mock('../../utils/sequence.util', () => ({ generateContractNumber: jest.fn().mockResolvedValue('CT-NEW-0001') }));

const D = (n: string | number) => new Decimal(n);
const fmt = (l: { accountCode: string; dr: Decimal; cr: Decimal }) => `${l.accountCode}:${l.dr.toFixed(2)}:${l.cr.toFixed(2)}`;

function makeService(prisma: Record<string, unknown>) {
  return new DefectExchangeService(
    prisma as never,
    { createAndPost: jest.fn() } as never,
    { reverseContract: jest.fn() } as never,
    { markReplaced: jest.fn() } as never,
    { voidReceipt: jest.fn(), voidAccrualPostedAtReceipt: jest.fn() } as never,
    { generateReceiptNumber: jest.fn() } as never,
  );
}

const oldProduct = { id: 'p-old', brand: 'Apple', model: 'iPhone 14', storage: '128GB', category: 'PHONE_USED', imeiSerial: '1', supplierId: null, stockInDate: null, shopWarrantyDays: null };
const contract = {
  id: 'ct-old', contractNumber: 'CT-OLD', status: 'ACTIVE', deletedAt: null, tradeInCreditSnapshot: null,
  deviceReceivedAt: new Date(), shopWarrantyStartDate: null, createdAt: new Date(),
  rescheduleAdvanceBalance: new Prisma.Decimal(0), product: oldProduct,
  payments: [{ amountPaid: new Prisma.Decimal('1515.83') }],
};

describe('checkEligibility — ใบ/เครดิตที่จะย้าย + ด่านเงิน (15ข)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('รายงาน receiptsToCreditNote และ creditToTransfer = Σ ใบ + 21-1103 + 21-5101 ในบัญชี', async () => {
    jest.spyOn(credit, 'exchangeMoneyBlockers').mockResolvedValue([]);
    jest.spyOn(credit, 'listReceiptsToCreditNote').mockResolvedValue([
      { id: 'rc-1', receiptNumber: 'RT-31', receiptType: 'INSTALLMENT', installmentNo: 1, paidDate: new Date('2026-10-10T00:00:00Z'), paymentMethod: 'BANK_TRANSFER', amount: new Prisma.Decimal('1515.83'), vatAmount: new Prisma.Decimal('99.17') },
    ]);
    jest.spyOn(gl, 'glContractBalance').mockImplementation(async (_c, _id, code) => (code === '21-5101' ? D(300) : D(0)));
    const prisma = { contract: { findUnique: jest.fn().mockResolvedValue(contract) }, product: { findUnique: jest.fn() } };
    const out = await makeService(prisma).checkEligibility('ct-old');
    expect(out.eligible).toBe(true);
    expect(out.receiptsToCreditNote).toEqual([
      { id: 'rc-1', receiptNumber: 'RT-31', receiptType: 'INSTALLMENT', installmentNo: 1, paidDate: '2026-10-10T00:00:00.000Z', paymentMethod: 'BANK_TRANSFER', amount: '1515.83', vatAmount: '99.17' },
    ]);
    expect(out.creditToTransfer).toBe('1815.83');
    expect(out.ledgerAdvance).toBe('0.00');
    expect(out.ledgerCredit).toBe('300.00');
    expect(out.oldContract.paidAmount).toBe(1515.83);
  });

  it('เหตุผลด้านเงินถูกต่อท้าย reasons → eligible=false (ไม่ใช่เหตุผลกรอบ 7 วัน)', async () => {
    jest.spyOn(credit, 'exchangeMoneyBlockers').mockResolvedValue([credit.EXCHANGE_BLOCK_RESCHEDULED]);
    jest.spyOn(credit, 'listReceiptsToCreditNote').mockResolvedValue([]);
    jest.spyOn(gl, 'glContractBalance').mockResolvedValue(D(0));
    const prisma = { contract: { findUnique: jest.fn().mockResolvedValue(contract) }, product: { findUnique: jest.fn() } };
    const out = await makeService(prisma).checkEligibility('ct-old');
    expect(out.eligible).toBe(false);
    expect(out.reasons).toEqual([credit.EXCHANGE_BLOCK_RESCHEDULED]);
    expect(out.creditToTransfer).toBe('0.00');
  });
});

import * as voidCore from '../receipts/services/receipt-void-core';
import * as closeAdv from '../journal/contract-close-advances';
import * as advVat from '../journal/advance-vat';
import { BadRequestException } from '@nestjs/common';
import * as inputVatClaim from '../journal/input-vat/installment-input-vat.claim';
import * as creditApproval from '../credit-check/services/credit-approval';
import * as creditLocks from '../credit-check/services/room-credit-history';

describe('execute — ขั้น ก/ค/ข/ง (15ข)', () => {
  afterEach(() => jest.restoreAllMocks());
  const newProduct = { id: 'p-new', brand: 'Apple', model: 'iPhone 14', storage: '128GB', category: 'PHONE_USED', status: 'IN_STOCK', name: 'iPhone 14', imeiSerial: '356789012345678', po: null, shopWarrantyDays: 30, stockInDate: new Date(), supplierId: null, deviceOrigin: 'IMPORTED', warrantyTerms: null };
  const oldContractRow = {
    ...contract,
    customerId: 'cust-1', productId: 'p-old', branchId: 'b-1', salespersonId: 'u-2', planType: 'INSTALLMENT',
    sellingPrice: 17000, downPayment: 0, interestRate: 0, totalMonths: 12, interestTotal: 6000, financedAmount: 10000,
    storeCommission: 1000, vatAmount: 1190, vatPct: 7, monthlyPayment: 1515.83, paymentDueDay: 5, interestConfigId: null, notes: null,
    customer: { id: 'cust-1', name: 'ลูกค้าจริง', phone: '0891234567', addressCurrent: 'กรุงเทพ' },
    payments: [],
  };
  const receiptRow = { id: 'rc-1', receiptNumber: 'RT-31', receiptType: 'INSTALLMENT', installmentNo: 1, paidDate: new Date('2026-10-10T00:00:00Z'), paymentMethod: 'BANK_TRANSFER', isVoided: false, deletedAt: null, amount: new Prisma.Decimal('1515.83'), vatAmount: new Prisma.Decimal('99.17') };

  function setup(opts: { receipts?: unknown[]; blockers?: string[]; close?: { advance: Decimal; credit: Decimal }; vat?: Decimal; suspense?: Decimal; suspenseBefore?: Decimal } = {}) {
    jest.spyOn(creditApproval, 'bindExchangeCreditCheck').mockResolvedValue(undefined);
    jest.spyOn(creditLocks, 'lockCreditCustomer').mockResolvedValue(undefined);
    jest.spyOn(inputVatClaim, 'markInputVatReversedIfSwept').mockResolvedValue('UNCHANGED');
    jest.spyOn(credit, 'exchangeMoneyBlockers').mockResolvedValue(opts.blockers ?? []);
    jest.spyOn(credit, 'listReceiptsToCreditNote').mockResolvedValue((opts.receipts ?? []) as never);
    jest.spyOn(closeAdv, 'readContractCloseAdvances').mockResolvedValue({ advance: opts.close?.advance ?? D(0), credit: opts.close?.credit ?? D(0), warnings: [] });
    jest.spyOn(advVat, 'advanceVatOutstanding').mockResolvedValue(opts.vat ?? D(0));
    // 21-1106 ถูกอ่าน 2 ครั้งใน execute: ก่อนขั้น ก (suspenseBefore) และหลังขั้น ข (suspense) — T = delta
    let suspenseReads = 0;
    jest.spyOn(gl, 'glContractBalance').mockImplementation(async (_c, _id, code) => {
      if (code !== '21-1106') return D(0);
      suspenseReads += 1;
      return suspenseReads === 1 ? (opts.suspenseBefore ?? D(0)) : (opts.suspense ?? D(0));
    });
    const voidSpy = jest.spyOn(voidCore, 'voidReceiptInTx').mockResolvedValue({
      voidedReceipt: receiptRow as never, creditNote: { receiptNumber: 'RT-44' } as never, paymentReverted: null,
      siblingCreditNoteNumbers: [], siblingReceiptNumbers: [], accrualReversal: null, warnings: [],
    });
    const tx = {
      contract: { findUnique: jest.fn().mockResolvedValue(oldContractRow), update: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({ id: 'ct-new', contractNumber: 'CT-NEW-0001', customerId: 'cust-1' }) },
      product: { findUnique: jest.fn().mockResolvedValue(newProduct), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      payment: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      receipt: { findUnique: jest.fn().mockResolvedValue(receiptRow), findMany: jest.fn().mockResolvedValue(opts.receipts?.length ? [receiptRow] : []) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      productReservation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      product: { findUnique: jest.fn().mockResolvedValue(newProduct) },
      companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx)),
    };
    const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-X' });
    const reverseContract = jest.fn().mockResolvedValue({ reversedCount: 1, entryNos: ['JE-R'] });
    const service = new DefectExchangeService(prisma as never, { createAndPost } as never, { reverseContract } as never, { markReplaced: jest.fn() } as never, { voidReceipt: jest.fn() } as never, { generateReceiptNumber: jest.fn() } as never);
    return { service, tx, createAndPost, reverseContract, voidSpy };
  }
  const dto = { oldContractId: 'ct-old', newProductId: 'p-new', defectReason: 'จอเสีย' } as never;
  const MGR = { id: 'mgr-1', role: 'BRANCH_MANAGER', branchId: 'b-1' };

  it('มีใบรับเงิน 1 ใบ: ไม่ปฏิเสธ · voidReceiptInTx ด้วยนโยบายเปลี่ยนเครื่อง · ค หลัง ก · ง = Σ ใบ · creditBalance ใหม่ = T', async () => {
    const { service, tx, createAndPost, reverseContract, voidSpy } = setup({ receipts: [receiptRow], suspense: D('1515.83') });
    const res = await service.execute(dto, MGR);
    expect(voidSpy).toHaveBeenCalledTimes(1);
    const input = voidSpy.mock.calls[0][2];
    expect(input.policy).toEqual({ skipAgeLimit: true, cnSource: 'DEFECT_EXCHANGE', redirect: credit.DEFECT_EXCHANGE_REDIRECT });
    expect(input.reason).toContain('CT-NEW-0001');
    expect(input.issuedById).toBe('mgr-1');
    expect(voidSpy.mock.invocationCallOrder[0]).toBeLessThan(reverseContract.mock.invocationCallOrder[0]);
    expect(createAndPost).toHaveBeenCalledTimes(1);
    const creditIn = createAndPost.mock.calls[0][0];
    expect(creditIn.metadata).toMatchObject({ flow: 'defect-exchange-credit-in', contractId: 'ct-new', exchangeOf: 'ct-old', amount: '1515.83' });
    expect(creditIn.lines.map(fmt)).toEqual(['21-1106:1515.83:0.00', '21-5101:0.00:1515.83']);
    expect(tx.contract.update).toHaveBeenCalledWith({ where: { id: 'ct-new' }, data: { creditBalance: D('1515.83') } });
    expect(res.transferredCredit).toBe('1515.83');
    expect(res.creditNoteNumbers).toEqual(['RT-44']);
    expect(res.voidedReceiptNumbers).toEqual(['RT-31']);
    expect(res.newContract.creditBalance).toBe(1515.83);
    expect(tx.auditLog.create.mock.calls.at(-1)[0].data.newValue).toMatchObject({ transferredCredit: '1515.83', creditNoteNumbers: ['RT-44'], creditInEntryNo: 'JE-X' });
  });

  it('ไม่มีใบ ไม่มีเงินค้าง: ไม่มีรายการ ข/ง · creditBalance ไม่ถูกตั้ง · transferredCredit 0.00 (พฤติกรรมเดิม)', async () => {
    const { service, tx, createAndPost, voidSpy } = setup();
    const res = await service.execute(dto, MGR);
    expect(voidSpy).not.toHaveBeenCalled();
    expect(createAndPost).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ct-new' } }));
    expect(res.transferredCredit).toBe('0.00');
    expect(res.creditInEntryNo).toBeNull();
  });

  it('เงินค้าง a=500 c=300 p=52.34: ข ลงก่อน ง · stamp advanceVatConsume · คอลัมน์สัญญาเดิมเป็น 0 · ง = 800', async () => {
    const { service, tx, createAndPost } = setup({ close: { advance: D(500), credit: D(300) }, vat: D('52.34'), suspense: D(800) });
    await service.execute(dto, MGR);
    expect(createAndPost).toHaveBeenCalledTimes(2);
    const out = createAndPost.mock.calls[0][0];
    expect(out.metadata).toMatchObject({ flow: 'defect-exchange-credit-out', contractId: 'ct-old', advanceVatConsume: '52.34' });
    expect(out.lines.map(fmt)).toEqual(['21-1103:500.00:0.00', '21-5101:300.00:0.00', '21-2101:52.34:0.00', '21-1106:0.00:800.00', '21-2102:0.00:52.34']);
    expect(tx.contract.update).toHaveBeenCalledWith({ where: { id: 'ct-old' }, data: closeAdv.CONTRACT_ADVANCE_COLUMNS_CLEARED });
    expect(createAndPost.mock.calls[1][0].metadata.amount).toBe('800.00');
  });

  it('ด่านเงินใน tx: มีเหตุผล → BadRequest ก่อนปิดสัญญาเดิม', async () => {
    const { service, tx } = setup({ blockers: [credit.EXCHANGE_BLOCK_RESCHEDULED] });
    // ทางปกติ: checkEligibility (นอก tx) เห็นเหตุผลเดียวกันก่อน → "ไม่เข้าเกณฑ์: …" — ด่านใน tx ครอบทาง bypass (เทสถัดไป)
    await expect(service.execute(dto, MGR)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(dto, MGR)).rejects.toThrow(credit.EXCHANGE_BLOCK_RESCHEDULED);
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it('ทาง bypass (ข้าม checkEligibility): ด่านเงินใน tx ยังปฏิเสธด้วยข้อความเดียวกัน ก่อนปิดสัญญาเดิม', async () => {
    const { service, tx } = setup({ blockers: [credit.EXCHANGE_BLOCK_RESCHEDULED] });
    (tx as Record<string, unknown>).afterSalesCase = { findFirst: jest.fn().mockResolvedValue({ contractId: 'ct-old', outcome: 'SAME_MODEL_EXCHANGE', cancelledAt: null }) };
    await expect(
      service.execute({ ...(dto as object), bypassWindowCheck: true, originAfterSalesCaseId: '11111111-1111-4111-8111-111111111111' } as never, MGR),
    ).rejects.toThrow(credit.EXCHANGE_BLOCK_RESCHEDULED);
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it('ตรวจทาน 21-1106: บัญชีพักเพิ่มเกิน ข + Σ ใบ (รายการที่ไม่รู้จัก) → throw (GL ผิดปกติ) ไม่ลง ง', async () => {
    const { service, createAndPost } = setup({ receipts: [receiptRow], suspense: D(5000) });
    await expect(service.execute(dto, MGR)).rejects.toThrow(/21-1106/);
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('สัญญาเดิมเป็นลูกของการเปลี่ยนเครื่องครั้งก่อน (Review Focus 2): 21-1106 ก่อน = −1515.83 (Dr credit-in เดิม) หลัง = 0 ⇒ T = delta 1515.83', async () => {
    const { service, createAndPost } = setup({ receipts: [receiptRow], suspenseBefore: D('-1515.83'), suspense: D(0) });
    await service.execute(dto, MGR);
    expect(createAndPost.mock.calls[0][0].metadata.amount).toBe('1515.83');
  });
});
