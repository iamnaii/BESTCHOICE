import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { voidReceiptInTx, storedTaxColumnsOf } from './receipt-void-core';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

const dec = (n: string | number) => new Prisma.Decimal(n);
const DAY_MS = 86_400_000;

function receiptRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'rcpt-1',
    receiptNumber: 'RT-202610-00031',
    contractId: 'ct-old',
    paymentId: 'pay-1',
    receiptType: 'INSTALLMENT',
    payerName: 'ลูกค้า',
    receiverName: 'พนักงาน',
    amount: dec('1515.83'),
    amountBeforeVat: dec('1416.66'),
    vatAmount: dec('99.17'),
    roundingAmount: dec('0'),
    lateFeeAmount: dec('0'),
    lateFeeWaivedAmount: dec('0'),
    advanceAmount: dec('0'),
    advanceVatAmount: dec('0'),
    installmentNo: 1,
    paymentMethod: 'BANK_TRANSFER',
    paidDate: new Date(Date.now() - 2 * DAY_MS),
    createdAt: new Date(Date.now() - 2 * DAY_MS),
    isVoided: false,
    deletedAt: null,
    ...overrides,
  } as never;
}

function setup(opts: { receiptEntries?: unknown[] } = {}) {
  const tx = {
    receipt: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, id: `cn-${String(data.receiptNumber)}` }),
      ),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ct-old', status: 'ACTIVE' }),
      update: jest.fn().mockResolvedValue({ advanceBalance: dec(0), rescheduleAdvanceBalance: dec(0) }),
    },
    journalEntry: {
      // 1) ด่าน advance-excess-income · 2) ใบรับชำระของ Payment · 3) reconstructPriorCleared
      findMany: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(opts.receiptEntries ?? [])
        .mockResolvedValueOnce([]),
    },
    payment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'pay-1', status: 'PAID', amountPaid: dec('1515.83'), amountDue: dec('1515.83'),
        dueDate: new Date(Date.now() + 20 * DAY_MS), contractId: 'ct-old', installmentNo: 1, deletedAt: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    installmentSchedule: { findUnique: jest.fn().mockResolvedValue({ id: 'inst-1' }) },
    loyaltyPoint: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
  };
  const reversal = {
    voidReceipt: jest.fn().mockResolvedValue({ entryNo: 'JE-VOID' }),
    voidAccrualPostedAtReceipt: jest.fn().mockResolvedValue({
      result: { reversed: true, entryNos: ['JE-RV'], accrualEntryNumbers: ['JE-2A'] },
      warnings: [],
    }),
  };
  const numbers = { generateReceiptNumber: jest.fn().mockResolvedValue('RT-202610-00044') };
  return { tx, reversal, numbers };
}

const REDIRECT = { accountPrefixes: ['11-11', '11-12'], to: '21-1106', description: 'โอนเป็นเครดิตเปลี่ยนเครื่อง' };

describe('voidReceiptInTx — นโยบายของเปลี่ยนเครื่องตำหนิ', () => {
  it('ใบลดหนี้ได้ cnSource · คัดลอกค่าที่เก็บ · กระจกรับชำระถูกเรียกพร้อม redirect', async () => {
    const { tx, reversal, numbers } = setup({
      receiptEntries: [{ id: 'je-receipt', metadata: { tag: 'receipt', paymentId: 'pay-1' }, lines: [] }],
    });
    const out = await voidReceiptInTx(tx as never, { reversal: reversal as never, numbers: numbers as never }, {
      receipt: receiptRow(),
      reason: 'เปลี่ยนเครื่องตำหนิภายใน 7 วัน → สัญญา CT-NEW',
      issuedById: 'mgr-1',
      approvedById: 'mgr-1',
      userRole: 'BRANCH_MANAGER',
      creditNoteMoney: storedTaxColumnsOf,
      policy: { skipAgeLimit: true, cnSource: 'DEFECT_EXCHANGE', redirect: REDIRECT },
    });
    const cnData = tx.receipt.create.mock.calls[0][0].data;
    expect(cnData.receiptType).toBe('CREDIT_NOTE');
    expect(cnData.cnSource).toBe('DEFECT_EXCHANGE');
    expect(cnData.voidedReceiptId).toBe('rcpt-1');
    expect((cnData.vatAmount as Prisma.Decimal).toFixed(2)).toBe('99.17');
    expect(reversal.voidReceipt).toHaveBeenCalledWith('je-receipt', tx, { redirect: REDIRECT });
    expect(out.creditNote.receiptNumber).toBe('RT-202610-00044');
    expect(out.accrualReversal).toEqual({ reversed: true, entryNos: ['JE-RV'], accrualEntryNumbers: ['JE-2A'] });
    expect(tx.auditLog.create.mock.calls.at(-1)[0].data.action).toBe('RECEIPT_VOID');
  });

  it('skipAgeLimit: ใบอายุ 45 วันยกเลิกได้ · ไม่ส่ง policy = ปฏิเสธเกิน 30 วันตามเดิม', async () => {
    const old = receiptRow({ createdAt: new Date(Date.now() - 45 * DAY_MS) });
    const base = { reason: 'x', issuedById: 'u', approvedById: 'u', creditNoteMoney: storedTaxColumnsOf };
    const a = setup();
    await expect(
      voidReceiptInTx(a.tx as never, { reversal: a.reversal as never, numbers: a.numbers as never }, { ...base, receipt: old, policy: { skipAgeLimit: true } }),
    ).resolves.toBeDefined();
    const b = setup();
    await expect(
      voidReceiptInTx(b.tx as never, { reversal: b.reversal as never, numbers: b.numbers as never }, { ...base, receipt: old }),
    ).rejects.toThrow(new BadRequestException('ไม่สามารถยกเลิกใบเสร็จที่ออกเกิน 30 วัน'));
  });

  it('สัญญาที่ปิดแล้ว → ปฏิเสธ · ข้อความชี้ฝ่ายบัญชี ไม่ส่งไประบบคืนเงิน (คืนเงินปิดด้วยกติกาเดียวกัน — คำตัดสินเจ้าของ 2026-10-31)', async () => {
    const { tx, reversal, numbers } = setup();
    tx.contract.findUnique.mockResolvedValue({ id: 'ct-old', status: 'COMPLETED' });
    const attempt = voidReceiptInTx(
      tx as never,
      { reversal: reversal as never, numbers: numbers as never },
      {
        reason: 'x',
        issuedById: 'u',
        approvedById: 'u',
        creditNoteMoney: storedTaxColumnsOf,
        receipt: receiptRow(),
      },
    );
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(/\(COMPLETED\).*ติดต่อฝ่ายบัญชี/);
    await expect(attempt).rejects.not.toThrow(/Refund|ใช้ระบบคืนเงิน/);
    expect(tx.receipt.create).not.toHaveBeenCalled();
    expect(reversal.voidReceipt).not.toHaveBeenCalled();
  });

  it('ไม่มี policy: กระจกถูกเรียก 2 อาร์กิวเมนต์ (พฤติกรรม void เดิม) และใบลดหนี้ไม่มี cnSource', async () => {
    const { tx, reversal, numbers } = setup({
      receiptEntries: [{ id: 'je-receipt', metadata: { tag: 'receipt', paymentId: 'pay-1' }, lines: [] }],
    });
    await voidReceiptInTx(tx as never, { reversal: reversal as never, numbers: numbers as never }, {
      receipt: receiptRow(), reason: 'x', issuedById: 'u', approvedById: 'a', creditNoteMoney: storedTaxColumnsOf,
    });
    expect(reversal.voidReceipt).toHaveBeenCalledWith('je-receipt', tx);
    expect(tx.receipt.create.mock.calls[0][0].data).not.toHaveProperty('cnSource');
  });
});
