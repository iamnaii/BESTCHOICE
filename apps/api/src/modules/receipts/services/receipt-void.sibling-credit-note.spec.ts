import { consumePaymentApproval } from '../../payments/services/payment-approval-request.util';
jest.mock('../../payments/services/payment-approval-request.util', () => ({ ...jest.requireActual('../../payments/services/payment-approval-request.util'), consumePaymentApproval: jest.fn() }));
/**
 * Voiding one receipt of a MULTI-RECEIPT installment must issue a ใบลดหนี้
 * (credit note) for EVERY receipt it voids — not only the one the user clicked.
 *
 * Found on prod contract TEST-20260809-004 (2026-08-18): installment 4 had two
 * receipts (1,771 partial + 2,000 completion). Voiding the 2,000 one voided both
 * (correct — un-pay is per-Payment, see the service's "Un-pay semantics" note)
 * and reversed BOTH receipt JEs (correct — `originalEntries` is a findMany over
 * every JE sharing metadata.paymentId), but created exactly ONE credit note, for
 * 2,000. The 1,771 receipt — printed as "ใบเสร็จรับเงิน / ใบกำกับภาษี" whenever
 * VAT applies (receipt-pdf.service.ts) — was cancelled with no cancelling
 * document, i.e. a ม.86/10 gap for a VAT-registered entity (FINANCE).
 *
 * Jest unit spec (mocked prisma) — the DB-level flow lives in
 * park-void-restore.integration.spec.ts, which jest ignores by config.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptNumberService } from './receipt-number.service';
import { ReceiptVoidService } from './receipt-void.service';

const dec = (n: number) => new Prisma.Decimal(n);

const TARGET_ID = 'rcpt-2000';
const SIBLING_ID = 'rcpt-1771';
const PAYMENT_ID = 'pay-inst-4';
const CONTRACT_ID = 'contract-1';

function makeReceipt(over: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    receiptNumber: 'RT-202608-00007',
    contractId: CONTRACT_ID,
    paymentId: PAYMENT_ID,
    receiptType: 'INSTALLMENT',
    payerName: 'ทดสอบ ค้าง 3 งวด',
    receiverName: 'เอกนรินทร์ คงเดช',
    amount: dec(2000),
    installmentNo: 4,
    paymentMethod: 'CASH',
    paidDate: new Date('2026-08-16T00:00:00.000Z'),
    createdAt: new Date('2026-08-16T00:00:00.000Z'),
    isVoided: false,
    deletedAt: null,
    ...over,
  };
}

function setup(
  opts: {
    /** ช่องเพิ่มของใบเป้าหมาย / ใบพี่น้อง (เช่น ค่าที่เก็บ ณ ตอนออกใบของ PR3) */
    target?: Record<string, unknown>;
    sibling?: Record<string, unknown>;
    /** ตัวอ่านใบแบบเดียวกับ PDF (PR3) — ไม่ส่ง = ใบลดหนี้ของใบเก่าคงรูปเดิม */
    query?: { getReceipt: jest.Mock };
    events?: string[];
  } = {},
) {
  const siblingRows = [
    {
      id: SIBLING_ID,
      receiptNumber: 'RT-202608-00006',
      contractId: CONTRACT_ID,
      paymentId: PAYMENT_ID,
      receiptType: 'INSTALLMENT',
      payerName: 'ทดสอบ ค้าง 3 งวด',
      receiverName: 'เอกนรินทร์ คงเดช',
      amount: dec(1771),
      installmentNo: 4,
      paymentMethod: 'CASH',
      paidDate: new Date('2026-08-16T00:00:00.000Z'),
      ...opts.sibling,
    },
  ];
  const target = makeReceipt(opts.target);

  const receiptCreate = jest.fn(({ data }: any) => Promise.resolve({ ...data, id: `cn-${data.receiptNumber}` }));

  const tx = {
    receipt: {
      findUnique: jest.fn().mockResolvedValue(target),
      findMany: jest.fn().mockResolvedValue(siblingRows),
      create: receiptCreate,
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: siblingRows.length }),
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ id: CONTRACT_ID, status: 'ACTIVE' }),
      update: jest.fn().mockResolvedValue({}),
    },
    // No POSTED receipt JEs in this fixture → the ledger-reversal loop is a
    // graceful no-op (documented behaviour for legacy no-JE payments). The
    // credit-note obligation is independent of it.
    journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
    payment: {
      findUnique: jest.fn().mockResolvedValue({
        id: PAYMENT_ID,
        status: 'PAID',
        amountPaid: dec(3771),
        amountDue: dec(3671),
        dueDate: new Date('2026-08-09T00:00:00.000Z'),
        contractId: CONTRACT_ID,
        installmentNo: 4,
        deletedAt: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    installmentSchedule: { findUnique: jest.fn().mockResolvedValue(null) },
    loyaltyPoint: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    // PR3: อ่านใบเป้าหมาย + ใบพี่น้องก่อนเปิดธุรกรรม (เฉพาะเมื่อมีตัวอ่านใบ)
    receipt: {
      findUnique: jest.fn().mockResolvedValue(target),
      findMany: jest.fn().mockResolvedValue([target, ...siblingRows]),
    },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'approver-1', role: 'OWNER', isActive: true, deletedAt: null }),
    },
    // FINANCE not configured in this fixture → validatePeriodOpen is a
    // documented no-op without a companyId.
    companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
    systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((cb: any) => {
      opts.events?.push('transaction');
      return cb(tx);
    }),
  } as unknown as PrismaService;

  let seq = 13;
  const numbers = {
    generateReceiptNumber: jest.fn(() =>
      Promise.resolve(`RT-202608-${String(++seq).padStart(5, '0')}`),
    ),
  } as unknown as ReceiptNumberService;

  const reversal = { voidReceipt: jest.fn() } as unknown as ReceiptVoidReversalTemplate;
  const service = new ReceiptVoidService(prisma, reversal, numbers, opts.query as never);
  return { service, tx, receiptCreate };
}

const creditNotesFrom = (createMock: jest.Mock) =>
  createMock.mock.calls
    .map(([{ data }]: any) => data)
    .filter((d: any) => d.receiptType === 'CREDIT_NOTE');

// ใบเสร็จใน fixture ออกวันที่ 2026-08-16 และ W-006 ปฏิเสธการยกเลิกใบที่ออกเกิน 30 วัน
// (เทียบกับ Date.now()) ⇒ ต้องปักนาฬิกาไว้ ไม่งั้นเทสพังเองตั้งแต่ 2026-09-16
// ค่านี้คือวันที่พบบั๊กบน prod (2026-08-18) — 2 วันหลังออกใบ
const FIXTURE_NOW = new Date('2026-08-18T03:00:00.000Z');

describe('ReceiptVoidService — credit note per voided receipt', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(FIXTURE_NOW); });
  afterEach(() => { jest.useRealTimers(); });
  beforeEach(() => { (consumePaymentApproval as jest.Mock).mockReset().mockResolvedValue({ requestedById: 'maker-1', approverId: 'approver-1', payload: {} }); });
  it('issues a credit note for the sibling receipt voided alongside the target', async () => {
    const { service, receiptCreate } = setup();

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER', { requestId: 'void-request', actorId: 'approver-1' });

    const cns = creditNotesFrom(receiptCreate as jest.Mock);
    expect(cns).toHaveLength(2);
    expect(cns.map((c: any) => c.voidedReceiptId).sort()).toEqual([SIBLING_ID, TARGET_ID].sort());
  });

  it('credit-note total equals the money actually cancelled (2,000 + 1,771)', async () => {
    const { service, receiptCreate } = setup();

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER', { requestId: 'void-request', actorId: 'approver-1' });

    const total = creditNotesFrom(receiptCreate as jest.Mock).reduce(
      (acc: Prisma.Decimal, c: any) => acc.plus(new Prisma.Decimal(c.amount)),
      new Prisma.Decimal(0),
    );
    expect(total.toFixed(2)).toBe('3771.00');
  });

  it('each credit note carries its own source receipt amount and installment', async () => {
    const { service, receiptCreate } = setup();

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER', { requestId: 'void-request', actorId: 'approver-1' });

    const bySource = new Map(
      creditNotesFrom(receiptCreate as jest.Mock).map((c: any) => [c.voidedReceiptId, c]),
    );
    expect(new Prisma.Decimal(bySource.get(TARGET_ID).amount).toFixed(2)).toBe('2000.00');
    expect(new Prisma.Decimal(bySource.get(SIBLING_ID).amount).toFixed(2)).toBe('1771.00');
    expect(bySource.get(SIBLING_ID).installmentNo).toBe(4);
    expect(bySource.get(SIBLING_ID).receiptType).toBe('CREDIT_NOTE');
  });

  it('records every credit note in the RECEIPT_VOID audit trail', async () => {
    const { service, tx } = setup();

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER', { requestId: 'void-request', actorId: 'approver-1' });

    const audit = (tx.auditLog.create as jest.Mock).mock.calls[0][0].data;
    expect(audit.action).toBe('RECEIPT_VOID');
    expect(audit.newValue.siblingCreditNoteNumbers).toHaveLength(1);
  });

  // ── PR3 (ม.86/10 · คำถาม Q5): ใบลดหนี้แสดงตัวเลขทุกบรรทัดเท่าใบที่ยกเลิก ─────────────────────────
  const STORED_2000 = {
    amountBeforeVat: dec(1869.16),
    vatAmount: dec(130.84),
    roundingAmount: dec(0),
    lateFeeAmount: dec(0),
    lateFeeWaivedAmount: dec(0),
    advanceAmount: dec(0),
    advanceVatAmount: dec(0),
  };
  const STORED_1771 = {
    amountBeforeVat: dec(1605.14),
    vatAmount: dec(115.86),
    roundingAmount: dec(0),
    lateFeeAmount: dec(50),
    lateFeeWaivedAmount: dec(0),
    advanceAmount: dec(0),
    advanceVatAmount: dec(0),
  };
  const money = (cn: Record<string, unknown>) =>
    [
      'amountBeforeVat',
      'vatAmount',
      'roundingAmount',
      'lateFeeAmount',
      'lateFeeWaivedAmount',
      'advanceAmount',
      'advanceVatAmount',
    ].map((k) => (cn[k] == null ? null : new Prisma.Decimal(String(cn[k])).toFixed(2)));

  it('PR3: ใบที่เก็บค่าแล้ว → ใบลดหนี้ของใบเป้าหมายและใบพี่น้องคัดลอกค่าทั้ง 7 ช่องตรงตัว', async () => {
    const { service, receiptCreate } = setup({ target: STORED_2000, sibling: STORED_1771 });

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER', { requestId: 'void-request', actorId: 'approver-1' });

    const bySource = new Map(
      creditNotesFrom(receiptCreate as jest.Mock).map((c) => [c.voidedReceiptId, c]),
    );
    expect(money(bySource.get(TARGET_ID))).toEqual(['1869.16', '130.84', '0.00', '0.00', '0.00', '0.00', '0.00']);
    expect(money(bySource.get(SIBLING_ID))).toEqual(['1605.14', '115.86', '0.00', '50.00', '0.00', '0.00', '0.00']);
  });

  it('PR3: ใบเก่า (ไม่มีค่าที่เก็บ) → อ่านใบก่อนเปิดธุรกรรม แล้วใบลดหนี้เก็บตัวเลขที่ใบเดิมพิมพ์ (ตรรกะเดิมของ PDF)', async () => {
    const events: string[] = [];
    const legacyView = (amount: number) => ({
      receiptType: 'INSTALLMENT',
      amount: dec(amount),
      installmentNo: 4,
      lateFeeCollected: '0.00',
      lateFeeWaivedThisReceipt: '0.00',
      hasReceiptFeeHistory: true,
      installmentAllocations: [{ installmentNo: 4, amount: dec(amount).toFixed(2), kind: 'INSTALLMENT' }],
      contract: null,
    });
    const query = {
      getReceipt: jest.fn(async (id: string) => {
        events.push(`read ${id}`);
        return legacyView(id === TARGET_ID ? 2000 : 1771);
      }),
    };
    const { service, receiptCreate } = setup({ query, events });

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER', { requestId: 'void-request', actorId: 'approver-1' });

    expect(events).toEqual([`read ${TARGET_ID}`, `read ${SIBLING_ID}`, 'transaction']);
    const bySource = new Map(
      creditNotesFrom(receiptCreate as jest.Mock).map((c) => [c.voidedReceiptId, c]),
    );
    // ตรรกะเดิม: ยอดไม่เท่าค่างวด → ×100/107
    expect(money(bySource.get(TARGET_ID))).toEqual(['1869.16', '130.84', '0.00', '0.00', '0.00', '0.00', '0.00']);
    expect(money(bySource.get(SIBLING_ID))).toEqual(['1655.14', '115.86', '0.00', '0.00', '0.00', '0.00', '0.00']);
  });

  it('PR3: ตรรกะเดิมพิมพ์ใบเก่าไม่ได้ → ใบลดหนี้คงรูปเดิม (ยอดอย่างเดียว) และการยกเลิกไม่ล้ม', async () => {
    const query = { getReceipt: jest.fn().mockRejectedValue(new Error('ประวัติไม่พอ')) };
    const { service, receiptCreate } = setup({ query });

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER', { requestId: 'void-request', actorId: 'approver-1' });

    const cns = creditNotesFrom(receiptCreate as jest.Mock);
    expect(cns).toHaveLength(2);
    expect(cns.map((c) => money(c))).toEqual([
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
    ]);
  });

  it('single-receipt installment still issues exactly one credit note', async () => {
    const { service, tx, receiptCreate } = setup();
    (tx.receipt.findMany as jest.Mock).mockResolvedValue([]);
    (tx.receipt.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await service.voidReceipt(TARGET_ID, 'คีย์ยอดผิด', 'maker-1', 'approver-1', 'OWNER', { requestId: 'void-request', actorId: 'approver-1' });

    expect(creditNotesFrom(receiptCreate as jest.Mock)).toHaveLength(1);
  });
});
