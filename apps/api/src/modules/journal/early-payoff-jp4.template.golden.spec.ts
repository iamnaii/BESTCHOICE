import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EarlyPayoffJP4Template } from './cpa-templates/early-payoff-jp4.template';
import { ledgerLines } from './__tests__/ledger-lines-mock';

/**
 * Fast (mock-based, NO DB) golden for EarlyPayoffJP4Template.execute().
 *
 * The canonical CPA golden for JP4 is the DB-backed vitest suite
 * early-payoff-jp4.template.spec.ts (case-4: 17K/12M · 6 unpaid · 50% discount →
 * customer pays 7,594.98 · totalDr 12,690.00). That suite needs a live Postgres and
 * cannot run in every environment. This jest spec mirrors its assertions on the
 * SAME case-4 fixture so the template's posted JE is guarded by the standard
 * `npm run test --workspace=apps/api` run too.
 *
 * PR5 (คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 5.1–5.4): ขาล้างอ่านยอดในบัญชีหลัง 6 งวดที่ตั้งลูกหนี้งวด + รับครบ —
 * 11-2101 17,000 − 6 × 1,416.66 = 8,500.04 · 11-2105 / 21-2102 1,190 − 6 × 99.17 = 594.98 · 11-2106 3,000.00
 * (งวดสุดท้ายถือเศษของสัญญา — CSV case-4 นับ 6 × ยอดต่องวด = 8,499.96 / 595.02) · เงินสด = เงินที่รับ (ผู้เรียกส่ง) ·
 * 52-1106 = ลูกหนี้ตามบัญชี 9,095.02 − เงินที่รับ
 */
const LEDGER_AFTER_SIX_PAID = {
  '11-2101': '8500.04',
  '11-2105': '594.98',
  '11-2106': '3000.00',
  '21-2102': '594.98',
};

describe('EarlyPayoffJP4Template.execute (case-4 golden · mock-based)', () => {
  const dec = (v: string | number) => new Decimal(v);

  // case-4 contract: financed 10000 + commission 1000 + interest 6000 = 17000
  // grossExclVat; vat 1190; totalMonths 12.
  const contract = {
    id: 'contract-jp4-1',
    contractNumber: 'CT-JP4-001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
  };

  // 12 installment schedules; first 6 covered by a PAID Payment row → 6 unpaid.
  const installments = Array.from({ length: 12 }, (_, i) => ({
    id: `inst-${i + 1}`,
    installmentNo: i + 1,
    dueDate: new Date('2026-01-01'),
    amountDue: dec('1515.83'),
    vat60dayJournalEntryId: null as string | null,
  }));
  const paidPayments = Array.from({ length: 6 }, (_, i) => ({ installmentNo: i + 1 }));

  type CapturedLine = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
  type CapturedJe = { description: string; reference?: string; metadata?: Record<string, unknown>; lines: CapturedLine[] };

  let createAndPost: jest.Mock;
  let tmpl: EarlyPayoffJP4Template;

  const build = (
    opts: { rescheduleAdvanceBalance?: string; ledger?: Record<string, string> } = {},
  ) => {
    createAndPost = jest.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-JP4-0001' });
    // ยอดในบัญชีอ่านในธุรกรรมของการลงรายการ (tx) เท่านั้น — prisma ไม่มี journalLine
    const tx = {
      payment: { create: jest.fn().mockResolvedValue({}) },
      contract: { update: jest.fn().mockResolvedValue({}) },
      journalLine: { findMany: jest.fn(ledgerLines(opts.ledger ?? LEDGER_AFTER_SIX_PAID)) },
    };
    const prisma = {
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...contract,
          rescheduleAdvanceBalance: dec(opts.rescheduleAdvanceBalance ?? '0'),
        }),
      },
      installmentSchedule: { findMany: jest.fn().mockResolvedValue(installments) },
      payment: { findMany: jest.fn().mockResolvedValue(paidPayments) },
      $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const journal = { createAndPost } as unknown;
    const vat60Reversal = { execute: jest.fn() } as unknown;
    tmpl = new EarlyPayoffJP4Template(
      journal as never,
      prisma as never,
      vat60Reversal as never,
    );
  };

  const run = async (interestDiscountPercent: string, cashReceived: string) => {
    await tmpl.execute({
      contractId: contract.id,
      depositAccountCode: '11-1101',
      cashReceived: new Prisma.Decimal(cashReceived),
      interestDiscountPercent: new Prisma.Decimal(interestDiscountPercent),
    });
    return createAndPost.mock.calls[0][0] as CapturedJe;
  };
  const lineFor = (je: CapturedJe, code: string) => je.lines.find((l) => l.accountCode === code);

  beforeEach(() => build());

  it('ลูกค้าจ่าย 7,594.98 (case-4 ส่วนลด 50%) → 8 lines ตามยอดในบัญชี · 52-1106 1,500.04 · balanced 12,690.00 (Policy A)', async () => {
    const je = await run('50', '7594.98');

    expect(je.lines.map((l) => l.accountCode)).toEqual([
      '11-1101', '11-2106', '21-2102', '52-1106', '11-2101', '11-2105', '41-1101', '21-2101',
    ]);
    expect(lineFor(je, '11-1101')!.dr.toFixed(2)).toBe('7594.98'); // เงินที่รับจริง
    expect(lineFor(je, '11-2106')!.dr.toFixed(2)).toBe('3000.00');
    expect(lineFor(je, '21-2102')!.dr.toFixed(2)).toBe('594.98');
    expect(lineFor(je, '52-1106')!.dr.toFixed(2)).toBe('1500.04'); // 9,095.02 − 7,594.98
    expect(lineFor(je, '11-2101')!.cr.toFixed(2)).toBe('8500.04');
    expect(lineFor(je, '11-2105')!.cr.toFixed(2)).toBe('594.98');
    expect(lineFor(je, '41-1101')!.cr.toFixed(2)).toBe('3000.00');
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('594.98'); // Policy A — full deferred VAT

    const totalDr = je.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const totalCr = je.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe('12690.00');
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    const meta = je.metadata as Record<string, string>;
    expect(meta.policy).toBe('A');
    expect(meta.settleVat).toBe('594.98');
    expect(meta.discount).toBe('1500.04');
    expect(meta.cashReceived).toBe('7594.98');
    expect(meta.vatCreditBackOnDiscount).toBeUndefined();
  });

  it('ลูกค้าจ่ายเท่าลูกหนี้ตามบัญชี 9,095.02 (ไม่มีส่วนลด) → omits 52-1106 (7 lines), Cr 21-2101 still full', async () => {
    const je = await run('0', '9095.02');
    expect(lineFor(je, '52-1106')).toBeUndefined();
    expect(je.lines).toHaveLength(7);
    expect(lineFor(je, '11-1101')!.dr.toFixed(2)).toBe('9095.02'); // 8500.04 + 594.98
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('594.98');
  });

  it('ลูกค้าจ่าย 6,095.02 → 52-1106 3,000.00 · Cr 21-2101 still full (Policy A)', async () => {
    const je = await run('100', '6095.02');
    expect(lineFor(je, '52-1106')!.dr.toFixed(2)).toBe('3000.00');
    expect(lineFor(je, '11-1101')!.dr.toFixed(2)).toBe('6095.02');
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('594.98');
  });

  it('เงินที่รับเกินลูกหนี้ตามบัญชีเกิน 1.00 → throw ไม่ลงรายการ', async () => {
    await expect(run('0', '9096.03')).rejects.toThrow(
      'exceed the contract ledger receivable by 1.01 (> 1.00) — not posted',
    );
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('เงินพัก 354 (คอลัมน์ 354) แต่ยอด 21-1103 ในบัญชี 200 → Dr 21-1103 200.00 (clamp ด้วยยอดในบัญชีแบบเส้นทางจริง) · 52-1106 รับส่วนที่ขาด', async () => {
    build({
      rescheduleAdvanceBalance: '354',
      ledger: { ...LEDGER_AFTER_SIX_PAID, '21-1103': '200.00' },
    });
    await tmpl.execute({
      contractId: contract.id,
      depositAccountCode: '11-1101',
      cashReceived: new Prisma.Decimal('7240.98'),
      interestDiscountPercent: new Prisma.Decimal('50'),
      parkRelief: new Prisma.Decimal('354.00'),
    });
    const je = createAndPost.mock.calls[0][0] as CapturedJe;
    expect(lineFor(je, '21-1103')!.dr.toFixed(2)).toBe('200.00');
    // 9,095.02 − 7,240.98 − 200.00
    expect(lineFor(je, '52-1106')!.dr.toFixed(2)).toBe('1654.04');
    const meta = je.metadata as Record<string, string>;
    expect(meta.parkRelief).toBe('200.00');
    // 52-1106 เกินฐานข้อ 5.2 (50% × 3,000.00) เกิน 1.00 → บันทึกใน metadata
    expect(meta.discountBeyondDeferredBase).toBe('154.04');
  });
});
