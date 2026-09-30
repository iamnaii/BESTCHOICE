import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';
import { PaymentReceiptTemplate } from './cpa-templates/payment-receipt.template';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

/**
 * ใบกำกับภาษีตามบัญชี (PR3 — คำตัดสินฝ่ายบัญชี D3–D5) — PaymentReceiptTemplate ประทับค่าที่ใบเสร็จของรายการนี้
 * ต้องพิมพ์ลง metadata.receiptTax (generateReceipt คัดลอกลงแถว Receipt) และตรวจทานภาษีของแถวค่างวดกับภาษีขายของ 2A
 * ที่ลงพร้อมกัน. สัญญามาตรฐาน 17,000/12 → งวด 1,515.83 = 1,416.66 + VAT 99.17
 */
describe('PaymentReceiptTemplate — ใบกำกับภาษีตามบัญชี (receiptTax)', () => {
  const dec = (v: string | number) => new Decimal(v);
  const RECEIPT_DATE = new Date('2026-09-29T03:00:00.000Z');
  const MISMATCH_MESSAGE =
    '[receipt-tax] receipt VAT differs from the 2A output VAT posted with it';

  const contract = {
    id: 'contract-1',
    contractNumber: 'CT-0001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
    status: 'ACTIVE',
  };

  type CapturedJe = { metadata: Record<string, unknown> };

  function build(opts: {
    /** Cr 11-2103 ของรายการก่อนหน้าของงวด (reconstructPriorCleared อ่านจาก journalEntry.findMany) */
    prior?: string[];
    accrual?: { kind: string; amount: string; vat: string; completes: boolean } | null;
  }) {
    const tx = {
      installmentSchedule: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'inst-3',
          installmentNo: 3,
          contractId: contract.id,
          dueDate: new Date('2026-10-11T17:00:00.000Z'),
          accrualJournalEntryId: null,
          contract,
        }),
      },
      journalEntry: {
        findMany: jest.fn().mockResolvedValue(
          (opts.prior ?? []).map((credit) => ({
            metadata: { tag: 'receipt', installmentScheduleId: 'inst-3' },
            lines: [{ accountCode: '11-2103', debit: dec(0), credit: dec(credit) }],
          })),
        ),
      },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const createAndPost = jest
      .fn()
      .mockResolvedValue({ id: 'je-r', entryNumber: 'JE-202609-00078' });
    const accrueAtReceipt = jest.fn().mockResolvedValue(
      opts.accrual === null
        ? null
        : {
            entryNo: 'JE-202609-00077',
            postedAt: RECEIPT_DATE,
            kind: opts.accrual?.kind ?? 'FULL',
            amount: dec(opts.accrual?.amount ?? '1515.83'),
            vat: dec(opts.accrual?.vat ?? '99.17'),
            completes: opts.accrual?.completes ?? true,
          },
    );
    const rootPrisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const tpl = new PaymentReceiptTemplate(
      { createAndPost } as never,
      rootPrisma as never,
      undefined,
      { accrueAtReceipt } as never,
    );
    return { tpl, tx, createAndPost };
  }

  const stamped = (createAndPost: jest.Mock) =>
    (createAndPost.mock.calls[0][0] as CapturedJe).metadata.receiptTax;

  const base = {
    installmentScheduleId: 'inst-3',
    debitAccountCode: '11-1101',
    paymentId: 'pay-3',
    postedAt: RECEIPT_DATE,
  };

  beforeEach(() => jest.clearAllMocks());

  it('จ่ายเต็มงวด 1,515.83 → ประทับค่าที่ต้องพิมพ์ลง metadata และคืนค่าเดียวกันให้ผู้เรียก', async () => {
    const { tpl, tx, createAndPost } = build({});

    const out = await tpl.execute(
      { ...base, delta: dec('1515.83'), isFinalReceipt: true },
      tx as never,
    );

    const expected = {
      version: 1,
      amount: '1515.83',
      amountBeforeVat: '1416.66',
      vatAmount: '99.17',
      roundingAmount: '0.00',
      lateFeeAmount: '0.00',
      lateFeeWaivedAmount: '0.00',
      advanceAmount: '0.00',
      advanceVatAmount: '0.00',
    };
    expect(stamped(createAndPost)).toEqual(expected);
    expect(out.receiptTax).toEqual(expected);
    expect(out.warnings).toEqual([]);
  });

  it('ใบบางส่วนก่อนวันครบกำหนด 1,000 → VAT ของใบ 65.42 = ภาษีขายของ 2A ที่ลงพร้อมกัน → ไม่มีสัญญาณเตือน', async () => {
    const { tpl, tx, createAndPost } = build({
      accrual: { kind: 'PARTIAL', amount: '1000', vat: '65.42', completes: false },
    });

    const out = await tpl.execute(
      { ...base, delta: dec('1000'), isFinalReceipt: false },
      tx as never,
    );

    expect((stamped(createAndPost) as Record<string, string>).vatAmount).toBe('65.42');
    expect(out.warnings).toEqual([]);
  });

  it('VAT ของใบไม่เท่าภาษีขายของ 2A (งวดที่มีใบรับบางส่วนก่อน PR2ข) → ลงบัญชีตามปกติ + คืนสัญญาณเตือนให้ส่งหลัง commit', async () => {
    // ใบก่อนหน้า 1,000 ไม่เคยตั้งลูกหนี้งวด (คอลัมน์ = 0) → ใบนี้ทำให้งวดครบ: 2A ทั้งงวด VAT 99.17
    // แต่เอกสารแสดงไปแล้ว 65.42 → ใบนี้พิมพ์ 99.17 − 65.42 = 33.75
    const { tpl, tx, createAndPost } = build({
      prior: ['1000'],
      accrual: { kind: 'FULL', amount: '1515.83', vat: '99.17', completes: true },
    });

    const out = await tpl.execute(
      { ...base, delta: dec('515.83'), isFinalReceipt: true },
      tx as never,
    );

    expect(createAndPost).toHaveBeenCalledTimes(1);
    expect((stamped(createAndPost) as Record<string, string>).vatAmount).toBe('33.75');
    expect(out.warnings).toEqual([
      {
        message: MISMATCH_MESSAGE,
        tags: { module: 'journal', action: 'receipt-vat-accrual-mismatch' },
        extra: {
          contractId: 'contract-1',
          contractNumber: 'CT-0001',
          installmentScheduleId: 'inst-3',
          installmentNo: 3,
          paymentId: 'pay-3',
          accrualEntryNumber: 'JE-202609-00077',
          accrualVat: '99.17',
          receiptInstallmentVat: '33.75',
          principalCleared: '515.83',
        },
      },
    ]);
    // ธุรกรรมของผู้เรียก — template ไม่ส่ง Sentry เอง
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ใบบางส่วน 1,000 ตั้ง 2A ของตัวเองแล้ว → ใบที่ทำให้ครบ 515.83 ได้ 2A ส่วนที่เหลือ VAT 33.75 = VAT ของใบ 33.75 → ไม่มีสัญญาณเตือน', async () => {
    // ใบก่อนหน้า 1,000 ตั้ง 2A บางส่วน VAT 65.42 (ก1) → 2A ของใบนี้คือส่วนที่เหลือ 99.17 − 65.42 = 33.75 เท่ากับที่ใบพิมพ์ —
    // เคสปกติของใบรับบางส่วนก่อนวันครบกำหนด ห้ามเตือน (final review T3-1)
    const { tpl, tx, createAndPost } = build({
      prior: ['1000'],
      accrual: { kind: 'REMAINDER', amount: '515.83', vat: '33.75', completes: true },
    });

    const out = await tpl.execute(
      { ...base, delta: dec('515.83'), isFinalReceipt: true },
      tx as never,
    );

    expect((stamped(createAndPost) as Record<string, string>).vatAmount).toBe('33.75');
    expect(out.receiptTax.vatAmount).toBe('33.75');
    expect(out.warnings).toEqual([]);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('หักเงินรับล่วงหน้า 500 ในใบเดียวกัน → แถวค่างวด VAT 99.17 (= 2A) · แถวหัก −500.00 / −32.71 · ไม่มีสัญญาณเตือน', async () => {
    const { tpl, tx, createAndPost } = build({});

    const out = await tpl.execute(
      { ...base, delta: dec('1015.83'), advanceConsume: dec('500'), isFinalReceipt: true },
      tx as never,
    );

    expect(stamped(createAndPost)).toEqual(
      expect.objectContaining({
        amount: '1015.83',
        advanceAmount: '-500.00',
        advanceVatAmount: '-32.71',
        vatAmount: '66.46',
        amountBeforeVat: '949.37',
      }),
    );
    expect(out.warnings).toEqual([]);
  });

  it('ไม่มี 2A ในใบนี้ (งวดตั้งครบแล้ว) → ไม่ตรวจทาน', async () => {
    const { tpl, tx } = build({ prior: ['700'], accrual: null });

    const out = await tpl.execute(
      { ...base, delta: dec('815.83'), isFinalReceipt: true },
      tx as never,
    );

    expect(out.receiptTax.vatAmount).toBe('53.38'); // 99.17 − HALF_UP(700 × 7/107 = 45.79)
    expect(out.warnings).toEqual([]);
  });

  it('template ห่อธุรกรรมเอง → สัญญาณเตือนเรื่อง VAT ถูกส่งหลังธุรกรรมคืนค่า และคืนรายการว่าง', async () => {
    const { tpl } = build({
      prior: ['1000'],
      accrual: { kind: 'FULL', amount: '1515.83', vat: '99.17', completes: true },
    });

    const out = await tpl.execute({ ...base, delta: dec('515.83'), isFinalReceipt: true });

    expect(out.warnings).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      MISMATCH_MESSAGE,
      expect.objectContaining({
        level: 'warning',
        tags: { module: 'journal', action: 'receipt-vat-accrual-mismatch' },
      }),
    );
  });
});
