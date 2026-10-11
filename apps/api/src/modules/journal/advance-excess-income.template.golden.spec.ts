import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';
import { AdvanceExcessIncomeTemplate } from './cpa-templates/advance-excess-income.template';
import { ledgerLines } from './__tests__/ledger-lines-mock';
import { ADVANCE_VAT_CONSUME_DESCRIPTION, ADVANCE_VAT_META } from './advance-vat';
import {
  ADVANCE_EXCESS_INCOME_ACCOUNT,
  ADVANCE_EXCESS_INCOME_FLOW,
} from './advance-excess-income.util';
import { CLOSE_ADVANCE_MISMATCH_MESSAGE } from './contract-close-advances';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

/**
 * รอบกวาดเงินพักส่วนเกิน → รายได้ 42-1106 (PR4 ต6 — คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 3, 29/09/2569). jest แบบ mock —
 * ยอดในบัญชีผ่าน journalLine.findMany (`ledgerLines`) · stamp ภาษีผ่าน journalEntry.findMany.
 *
 * G6 (แผน): ปรับดิว 2 ครั้ง 1,419.00 × 2 (ภาษีรับรู้ 92.83 × 2 = 185.66) · รอบกลางคืนงวด 12 หัก 1,515.87 ขากลับ 99.17 ⇒
 * 21-1103 เหลือ 1,322.13 · ภาษียังค้าง 86.49 ⇒ `Dr 21-1103 1,322.13 / Cr 42-1106 1,235.64 / Cr 21-2102 86.49`
 */
describe('AdvanceExcessIncomeTemplate (golden G6 / G9 / ต4 · mock-based)', () => {
  const dec = (v: string) => new Decimal(v);
  type Line = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
  type Posted = {
    description: string;
    metadata: Record<string, unknown>;
    lines: Line[];
    postedAt?: Date;
    companyId?: string;
  };

  const G6_STAMPS = [
    { [ADVANCE_VAT_META.park]: '92.83' },
    { [ADVANCE_VAT_META.park]: '92.83' },
    { [ADVANCE_VAT_META.consume]: '99.17' },
  ];

  function build(opts: {
    ledger: Record<string, string>;
    stamps?: Array<Record<string, unknown>>;
    columns?: {
      advanceBalance?: string;
      rescheduleAdvanceBalance?: string;
      creditBalance?: string;
    };
    /** รายการ flow advance-excess-income ที่มีอยู่แล้วของสัญญา (รวมที่ถูกกลับ) */
    existing?: Array<Record<string, unknown>>;
    createAndPost?: jest.Mock;
    systemUser?: { id: string } | null;
    status?: string;
  }) {
    const contract = {
      id: 'contract-1',
      contractNumber: 'CT-0001',
      status: opts.status ?? 'ACTIVE',
      advanceBalance: dec(opts.columns?.advanceBalance ?? '0'),
      rescheduleAdvanceBalance: dec(opts.columns?.rescheduleAdvanceBalance ?? '0'),
      creditBalance: dec(opts.columns?.creditBalance ?? '0'),
    };
    const tx = {
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(contract),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: {
        findMany: jest.fn(async (args: { where: Record<string, unknown> }) =>
          // probe รายการ flow ใช้ where.AND · advanceVatOutstanding ใช้ where.metadata (contractId)
          args.where.AND
            ? (opts.existing ?? []).map((metadata, i) => ({
                id: `je-x-${i}`,
                entryNumber: `JE-X-${i}`,
                metadata,
              }))
            : (opts.stamps ?? []).map((metadata) => ({ metadata })),
        ),
      },
      journalLine: { findMany: jest.fn(ledgerLines(opts.ledger)) },
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.systemUser === undefined ? { id: 'sys-1' } : opts.systemUser),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const createAndPost =
      opts.createAndPost ?? jest.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-AEI-0001' });
    const companyResolver = { getFinanceCompanyId: jest.fn().mockResolvedValue('fin-1') };
    const template = new AdvanceExcessIncomeTemplate(
      { createAndPost } as never,
      prisma as never,
      companyResolver as never,
    );
    const posted = (): Posted => createAndPost.mock.calls[0][0] as Posted;
    return { template, tx, prisma, createAndPost, posted, companyResolver };
  }
  const tuples = (lines: Line[]) =>
    lines.map((l) => `${l.accountCode} ${l.dr.toFixed(2)} ${l.cr.toFixed(2)}`);

  beforeEach(() => {
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it('G6: 21-1103 1,322.13 · ภาษีค้าง 86.49 → Dr 21-1103 1,322.13 / Cr 42-1106 1,235.64 / Cr 21-2102 86.49 + stamp consume + คอลัมน์ = 0 + audit', async () => {
    const { template, tx, prisma, posted } = build({
      ledger: { '21-1103': '1322.13' },
      stamps: G6_STAMPS,
      columns: { rescheduleAdvanceBalance: '1322.13' },
    });

    const result = await template.execute('contract-1');

    expect(result.outcome).toBe('POSTED');
    if (result.outcome !== 'POSTED') throw new Error('unreachable');
    expect(result.entryNo).toBe('JE-AEI-0001');
    expect(result.amount.toFixed(2)).toBe('1322.13');
    expect(result.income.toFixed(2)).toBe('1235.64');
    expect(result.vat.toFixed(2)).toBe('86.49');
    expect(result.columnsMismatch).toBe(false);

    const je = posted();
    expect(tuples(je.lines)).toEqual([
      '21-1103 1322.13 0.00',
      `${ADVANCE_EXCESS_INCOME_ACCOUNT} 0.00 1235.64`,
      '21-2102 0.00 86.49',
    ]);
    expect(ADVANCE_EXCESS_INCOME_ACCOUNT).toBe('42-1106');
    expect(je.lines[2].description).toBe(ADVANCE_VAT_CONSUME_DESCRIPTION);
    expect(je.description).toContain('CT-0001');
    expect(je.metadata).toMatchObject({
      tag: 'ADVANCE_EXCESS',
      flow: ADVANCE_EXCESS_INCOME_FLOW,
      idempotencyKey: 'advance-excess-income:contract-1',
      contractId: 'contract-1',
      contractNumber: 'CT-0001',
      amount: '1322.13',
      income: '1235.64',
      vat: '86.49',
      [ADVANCE_VAT_META.consume]: '86.49',
      advanceBalanceBefore: '0.00',
      rescheduleAdvanceBalanceBefore: '1322.13',
    });
    expect(je.metadata[ADVANCE_VAT_META.park]).toBeUndefined();
    expect(je.companyId).toBe('fin-1');

    // ธุรกรรมของตัวเอง — Serializable (อ่าน stamp + ยอดบัญชี แล้วลง ในชุดเดียว)
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: 'contract-1' },
      data: { advanceBalance: 0, rescheduleAdvanceBalance: 0 },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      action: 'ADVANCE_EXCESS_RECOGNIZED',
      entity: 'contract',
      entityId: 'contract-1',
      userId: 'sys-1',
    });
    expect(audit.newValue).toMatchObject({
      entryNumber: 'JE-AEI-0001',
      amount: '1322.13',
      income: '1235.64',
      vat: '86.49',
      advanceBalanceBefore: '0.00',
      rescheduleAdvanceBalanceBefore: '1322.13',
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('G9 (EARLY_PAYOFF ถังใหญ่กว่ายอดปิด): 21-1103 500 · stamp พัก 130.84 กลับ 98.13 → Cr 21-2102 32.71 · Cr 42-1106 467.29', async () => {
    const { template, posted } = build({
      ledger: { '21-1103': '500.00', '21-2102': '-32.71' },
      stamps: [{ [ADVANCE_VAT_META.park]: '130.84' }, { [ADVANCE_VAT_META.consume]: '98.13' }],
      status: 'EARLY_PAYOFF',
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('POSTED');
    expect(tuples(posted().lines)).toEqual([
      '21-1103 500.00 0.00',
      '42-1106 0.00 467.29',
      '21-2102 0.00 32.71',
    ]);
  });

  it('ต4: มี 21-5101 300 ค้าง (ภาษี 19.63) → ขากลับใช้ HALF_UP ของ 21-1103 (32.71) ไม่กินภาษีของเครดิต · ไม่แตะ 21-5101/creditBalance', async () => {
    const { template, tx, posted } = build({
      ledger: { '21-1103': '500.00', '21-5101': '300.00' },
      stamps: [{ [ADVANCE_VAT_META.park]: '32.71' }, { [ADVANCE_VAT_META.park]: '19.63' }],
      columns: { advanceBalance: '500.00', creditBalance: '300.00' },
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('POSTED');
    expect(tuples(posted().lines)).toEqual([
      '21-1103 500.00 0.00',
      '42-1106 0.00 467.29',
      '21-2102 0.00 32.71',
    ]);
    expect(posted().metadata[ADVANCE_VAT_META.consume]).toBe('32.71');
    expect(posted().metadata.ledger21_5101).toBe('300.00');
    // คอลัมน์ถังทั้งสองเป็น 0 — creditBalance ไม่ถูกแตะ (ถ3)
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: 'contract-1' },
      data: { advanceBalance: 0, rescheduleAdvanceBalance: 0 },
    });
  });

  it('ไม่มี stamp (เงินก่อน PR4): ภาษี 0 → ไม่มีบรรทัด 21-2102 · รายได้ = ทั้งยอด · ไม่ stamp consume', async () => {
    const { template, posted } = build({ ledger: { '21-1103': '354.00' } });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('POSTED');
    expect(tuples(posted().lines)).toEqual(['21-1103 354.00 0.00', '42-1106 0.00 354.00']);
    expect(posted().metadata.vat).toBe('0.00');
    expect(posted().metadata[ADVANCE_VAT_META.consume]).toBeUndefined();
  });

  it('มีรายการ advance-excess-income ที่มีผลอยู่แล้ว → ALREADY_POSTED ไม่ลงซ้ำ ไม่แตะคอลัมน์', async () => {
    const { template, tx, createAndPost } = build({
      ledger: { '21-1103': '1322.13' },
      existing: [
        { flow: ADVANCE_EXCESS_INCOME_FLOW, idempotencyKey: 'advance-excess-income:contract-1' },
      ],
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('ALREADY_POSTED');
    expect(createAndPost).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it('รายการเดิมถูกฝ่ายบัญชีกลับแล้ว (reversed) และ 21-1103 กลับมามียอด → ลงใหม่ด้วย idempotencyKey ลำดับ :2', async () => {
    const { template, posted } = build({
      ledger: { '21-1103': '200.00' },
      existing: [{ flow: ADVANCE_EXCESS_INCOME_FLOW, reversed: true }],
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('POSTED');
    expect(posted().metadata.idempotencyKey).toBe('advance-excess-income:contract-1:2');
  });

  it('บัญชี 21-1103 = 0 แต่คอลัมน์ถัง > 0 → COLUMNS_ONLY (ไม่ลงรายการ ไม่แตะคอลัมน์) + สัญญาณเตือนคอลัมน์ไม่ตรงบัญชี', async () => {
    const { template, tx, createAndPost } = build({
      ledger: {},
      columns: { rescheduleAdvanceBalance: '100.00' },
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('COLUMNS_ONLY');
    if (result.outcome !== 'COLUMNS_ONLY') throw new Error('unreachable');
    expect(result.advanceBalance.toFixed(2)).toBe('0.00');
    expect(result.rescheduleAdvanceBalance.toFixed(2)).toBe('100.00');
    expect(createAndPost).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      CLOSE_ADVANCE_MISMATCH_MESSAGE,
      expect.objectContaining({ tags: expect.objectContaining({ flow: 'excess-income' }) }),
    );
  });

  it('บัญชี 21-1103 = 0 และคอลัมน์ = 0 → NOTHING', async () => {
    const { template, createAndPost } = build({ ledger: {} });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('NOTHING');
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('คอลัมน์ไม่ตรงบัญชี (คอลัมน์ 0 แต่บัญชี 1,322.13) → ลงตามบัญชี · columnsMismatch + Sentry warning หลัง commit', async () => {
    const { template } = build({ ledger: { '21-1103': '1322.13' }, stamps: G6_STAMPS });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('POSTED');
    if (result.outcome !== 'POSTED') throw new Error('unreachable');
    expect(result.columnsMismatch).toBe(true);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      CLOSE_ADVANCE_MISMATCH_MESSAGE,
      expect.objectContaining({ tags: expect.objectContaining({ flow: 'excess-income' }) }),
    );
  });

  it('P2002 จาก idempotency index (รอบซ้อนกัน) → ALREADY_POSTED ไม่โยน', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { template } = build({
      ledger: { '21-1103': '100.00' },
      createAndPost: jest.fn().mockRejectedValue(dup),
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('ALREADY_POSTED');
  });

  it('ไม่มีผู้ใช้ SYSTEM/admin → ยังลงรายการและตั้งคอลัมน์ แต่ข้าม audit + Sentry warning', async () => {
    const { template, tx, createAndPost } = build({
      ledger: { '21-1103': '100.00' },
      systemUser: null,
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('POSTED');
    expect(createAndPost).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });
});
