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
