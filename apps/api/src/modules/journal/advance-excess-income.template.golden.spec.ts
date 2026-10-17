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
describe('AdvanceExcessIncomeTemplate (golden G6 / G9 / 22.2 · mock-based)', () => {
  const dec = (v: string) => new Decimal(v);
  type Line = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
  type Posted = {
    reference?: string;
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
    /** รายการ flow advance-excess-income ที่มีอยู่แล้วของสัญญา (รวมที่ถูกกลับ) — POSTED ที่ list เห็น */
    existing?: Array<Record<string, unknown>>;
    /** จำนวนแถวของ flow ทุกสถานะ (รวม VOIDED/ลบ) ที่ `journalEntry.count` คืน — ไม่ส่ง = existing.length */
    flowRowCount?: number;
    /** บรรทัดของต้นฉบับที่ `reverse()` อ่านผ่าน findUniqueOrThrow (เรียงตามที่ลง) */
    originalLines?: Array<{
      accountCode: string;
      debit: string;
      credit: string;
      description?: string;
    }>;
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
        count: jest.fn(async () => opts.flowRowCount ?? (opts.existing ?? []).length),
        findUniqueOrThrow: jest.fn(async (args: { where: { id: string } }) => {
          const i = Number(args.where.id.replace('je-x-', ''));
          return {
            id: args.where.id,
            entryNumber: `JE-X-${i}`,
            companyId: 'fin-1',
            description: 'รับรู้เงินพักส่วนเกินเป็นรายได้ (42-1106) — สัญญา CT-0001',
            metadata: (opts.existing ?? [])[i],
            lines: (opts.originalLines ?? []).map((l, k) => ({
              id: `ln-${k}`,
              accountCode: l.accountCode,
              debit: dec(l.debit),
              credit: dec(l.credit),
              description: l.description ?? null,
            })),
          };
        }),
        update: jest.fn().mockResolvedValue({}),
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

  it('final review I2: ต้นฉบับที่ถูก JournalService.void (VOIDED — list ไม่เห็น) ยังถือ key เดิม ⇒ seq นับทุกแถวของ flow ไม่กรองสถานะ → key :2', async () => {
    const { template, posted } = build({
      ledger: { '21-1103': '500.00' },
      existing: [],
      flowRowCount: 1,
    });
    const r = await template.execute('contract-1', {
      postedAt: new Date('2026-10-12T00:40:00+07:00'),
    });
    expect(r.outcome).toBe('POSTED');
    expect(posted().metadata.idempotencyKey).toBe('advance-excess-income:contract-1:2');
    expect(posted().reference).toBe('contract-1:advance-excess-income:2');
  });

  describe('reverse() — กลับรายการกวาดแบบกระจก (final review I2)', () => {
    const ACTIVE = {
      tag: 'ADVANCE_EXCESS',
      flow: 'advance-excess-income',
      idempotencyKey: 'advance-excess-income:contract-1',
      contractId: 'contract-1',
      contractNumber: 'CT-0001',
      amount: '1622.13',
      advance: '1322.13',
      credit: '300.00',
      income: '1516.01',
      vat: '106.12',
      advanceBalanceBefore: '1322.13',
      rescheduleAdvanceBalanceBefore: '0.00',
      creditBalanceBefore: '300.00',
      advanceVatConsume: '106.12',
    };
    const LINES = [
      {
        accountCode: '21-1103',
        debit: '1322.13',
        credit: '0',
        description: 'รับรู้เงินพักส่วนเกินเป็นรายได้ (เงินพักค่าปรับดิวสะสมเกิน)',
      },
      {
        accountCode: '21-5101',
        debit: '300.00',
        credit: '0',
        description: 'รับรู้เครดิตที่เหลือหลังปิดสัญญาเป็นรายได้ (เงินพักค่าปรับดิวสะสมเกิน)',
      },
      {
        accountCode: '42-1106',
        debit: '0',
        credit: '1516.01',
        description: 'รับรู้เงินพักส่วนเกินเป็นรายได้ (เงินพักค่าปรับดิวสะสมเกิน)',
      },
      {
        accountCode: '21-2102',
        debit: '0',
        credit: '106.12',
        description: ADVANCE_VAT_CONSUME_DESCRIPTION,
      },
    ];

    it('กระจกทุกบรรทัด (Cr 21-1103 / Cr 21-5101 / Dr 42-1106 / Dr 21-2102) · tag REVERSAL · flow advance-excess-income-reverse · key ต่อต้นฉบับ · ไม่ copy stamp consume · stamp reversed บนต้นฉบับ · คืนคอลัมน์ทั้งสาม (รวม creditBalance — 22.2) จาก *Before · audit ADVANCE_EXCESS_REVERSED', async () => {
      const createAndPost = jest
        .fn()
        .mockResolvedValue({ id: 'je-rev', entryNumber: 'JE-REV-0001' });
      const { template, tx, prisma } = build({
        ledger: { '21-1103': '0' },
        existing: [ACTIVE],
        originalLines: LINES,
        createAndPost,
      });
      const r = await template.reverse('contract-1', {
        reason: 'ฝ่ายบัญชีสั่งคืนเงินลูกค้า — ตรวจแล้ว',
        actorUserId: 'acc-1',
      });
      expect(r.outcome).toBe('REVERSED');
      if (r.outcome !== 'REVERSED') throw new Error('unreachable');
      expect(r.entryNo).toBe('JE-REV-0001');
      expect(r.reversedEntryNo).toBe('JE-X-0');
      expect(r.amount.toFixed(2)).toBe('1622.13');
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });

      const p = createAndPost.mock.calls[0][0] as Posted;
      expect(tuples(p.lines)).toEqual([
        '21-1103 0.00 1322.13',
        '21-5101 0.00 300.00',
        '42-1106 1516.01 0.00',
        '21-2102 106.12 0.00',
      ]);
      expect(p.companyId).toBe('fin-1');
      expect(p.reference).toBe('je-x-0:advance-excess-income-reverse');
      expect(p.metadata).toMatchObject({
        tag: 'REVERSAL',
        flow: 'advance-excess-income-reverse',
        idempotencyKey: 'advance-excess-income-reverse:je-x-0',
        originalEntryId: 'je-x-0',
        reversesEntryId: 'je-x-0',
        originalEntryNumber: 'JE-X-0',
        contractId: 'contract-1',
        contractNumber: 'CT-0001',
        reason: 'ฝ่ายบัญชีสั่งคืนเงินลูกค้า — ตรวจแล้ว',
        amount: '1622.13',
      });
      expect(p.metadata).not.toHaveProperty(ADVANCE_VAT_META.consume);
      expect(p.metadata).not.toHaveProperty(ADVANCE_VAT_META.park);

      expect(tx.journalEntry.update).toHaveBeenCalledWith({
        where: { id: 'je-x-0' },
        data: { metadata: { ...ACTIVE, reversed: true, reversedByEntryNumber: 'JE-REV-0001' } },
      });
      const colUpdate = tx.contract.update.mock.calls[0][0];
      expect(colUpdate.where).toEqual({ id: 'contract-1' });
      expect(colUpdate.data.advanceBalance.toString()).toBe('1322.13');
      expect(colUpdate.data.rescheduleAdvanceBalance.toString()).toBe('0');
      expect(colUpdate.data.creditBalance.toString()).toBe('300');

      const audit = tx.auditLog.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({
        action: 'ADVANCE_EXCESS_REVERSED',
        entity: 'contract',
        entityId: 'contract-1',
        userId: 'acc-1',
      });
      expect(audit.newValue).toMatchObject({
        entryNumber: 'JE-REV-0001',
        reversedEntryNumber: 'JE-X-0',
        amount: '1622.13',
        reason: 'ฝ่ายบัญชีสั่งคืนเงินลูกค้า — ตรวจแล้ว',
      });
      expect(audit.newValue.restoredColumns).toEqual({
        advanceBalance: '1322.13',
        rescheduleAdvanceBalance: '0.00',
        creditBalance: '300.00',
      });
    });

    it('ไม่มีรายการที่มีผล (ถูกกลับไปแล้ว / ไม่เคยกวาด) → NOTHING_TO_REVERSE ไม่ post ไม่แตะคอลัมน์', async () => {
      const createAndPost = jest.fn();
      const { template, tx } = build({
        ledger: { '21-1103': '0' },
        existing: [{ ...ACTIVE, reversed: true, reversedByEntryNumber: 'JE-REV-0000' }],
        createAndPost,
      });
      const r = await template.reverse('contract-1', { reason: 'ทดสอบเหตุผลยาวพอสิบตัว' });
      expect(r.outcome).toBe('NOTHING_TO_REVERSE');
      expect(createAndPost).not.toHaveBeenCalled();
      expect(tx.contract.update).not.toHaveBeenCalled();
    });

    it('P2002 (สองคนกดพร้อมกัน — key ต่อต้นฉบับชน) → ALREADY_REVERSED', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      });
      const createAndPost = jest.fn().mockRejectedValue(err);
      const { template } = build({
        ledger: { '21-1103': '0' },
        existing: [ACTIVE],
        originalLines: LINES,
        createAndPost,
      });
      const r = await template.reverse('contract-1', { reason: 'ทดสอบเหตุผลยาวพอสิบตัว' });
      expect(r.outcome).toBe('ALREADY_REVERSED');
    });

    it('หลังกลับรายการ รอบกวาดครั้งถัดไปลงใหม่ได้ด้วย key :2 (ต้นฉบับยัง POSTED แต่ reversed)', async () => {
      const { template, posted } = build({
        ledger: { '21-1103': '1322.13' },
        existing: [{ ...ACTIVE, reversed: true, reversedByEntryNumber: 'JE-REV-0001' }],
      });
      const r = await template.execute('contract-1', {
        postedAt: new Date('2026-10-13T00:40:00+07:00'),
      });
      expect(r.outcome).toBe('POSTED');
      expect(posted().metadata.idempotencyKey).toBe('advance-excess-income:contract-1:2');
    });
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
      data: { advanceBalance: 0, rescheduleAdvanceBalance: 0, creditBalance: 0 },
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

  it('22.2 (ฝ่ายบัญชี 16/10/2569): มี 21-5101 300 ค้าง (ภาษี 19.63) → กวาดทั้ง 21-1103 500 และ 21-5101 300 ในรายการเดียว · ภาษีค้างทั้งก้อน 52.34 · creditBalance = 0', async () => {
    const { template, tx, posted } = build({
      ledger: { '21-1103': '500.00', '21-5101': '300.00' },
      stamps: [{ [ADVANCE_VAT_META.park]: '32.71' }, { [ADVANCE_VAT_META.park]: '19.63' }],
      columns: { advanceBalance: '500.00', creditBalance: '300.00' },
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('POSTED');
    if (result.outcome !== 'POSTED') throw new Error('unreachable');
    expect(result.amount.toFixed(2)).toBe('800.00');
    expect(result.advance.toFixed(2)).toBe('500.00');
    expect(result.credit.toFixed(2)).toBe('300.00');
    expect(result.columnsMismatch).toBe(false);
    expect(tuples(posted().lines)).toEqual([
      '21-1103 500.00 0.00',
      '21-5101 300.00 0.00',
      '42-1106 0.00 747.66',
      '21-2102 0.00 52.34',
    ]);
    expect(posted().lines[1].description).toBe(
      'รับรู้เครดิตที่เหลือหลังปิดสัญญาเป็นรายได้ (เงินพักค่าปรับดิวสะสมเกิน)',
    );
    expect(posted().metadata[ADVANCE_VAT_META.consume]).toBe('52.34');
    expect(posted().metadata).toMatchObject({
      amount: '800.00',
      advance: '500.00',
      credit: '300.00',
      income: '747.66',
      vat: '52.34',
      ledger21_1103: '500.00',
      ledger21_5101: '300.00',
      creditBalanceBefore: '300.00',
    });
    // รายการนี้ล้างทั้งสองบัญชี ⇒ คอลัมน์ทั้งสามเป็น 0
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: 'contract-1' },
      data: { advanceBalance: 0, rescheduleAdvanceBalance: 0, creditBalance: 0 },
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('22.2 / X2: มีเฉพาะ 21-5101 2,000 (21-1103 = 0 · คอลัมน์ creditBalance 0 — ลิงก์ชำระตั้ง 0 โดยไม่มีรายการ) → Dr 21-5101 2,000 / Cr 42-1106 1,869.16 / Cr 21-2102 130.84 + columnsMismatch', async () => {
    const { template, tx, posted } = build({
      ledger: { '21-5101': '2000.00' },
      stamps: [{ [ADVANCE_VAT_META.park]: '130.84' }],
      status: 'EARLY_PAYOFF',
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('POSTED');
    if (result.outcome !== 'POSTED') throw new Error('unreachable');
    expect(result.advance.toFixed(2)).toBe('0.00');
    expect(result.credit.toFixed(2)).toBe('2000.00');
    expect(result.columnsMismatch).toBe(true);
    expect(tuples(posted().lines)).toEqual([
      '21-5101 2000.00 0.00',
      '42-1106 0.00 1869.16',
      '21-2102 0.00 130.84',
    ]);
    expect(posted().metadata).toMatchObject({ columnsMismatch: true, ledger21_1103: '0.00' });
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: 'contract-1' },
      data: { advanceBalance: 0, rescheduleAdvanceBalance: 0, creditBalance: 0 },
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      CLOSE_ADVANCE_MISMATCH_MESSAGE,
      expect.objectContaining({ tags: expect.objectContaining({ flow: 'excess-income' }) }),
    );
  });

  it('ไม่มี stamp (เงินก่อน PR4): ภาษี 0 → ไม่มีบรรทัด 21-2102 · รายได้ = ทั้งยอด · ไม่ stamp consume', async () => {
    const { template, posted } = build({ ledger: { '21-1103': '354.00' } });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('POSTED');
    expect(tuples(posted().lines)).toEqual(['21-1103 354.00 0.00', '42-1106 0.00 354.00']);
    expect(posted().metadata.vat).toBe('0.00');
    expect(posted().metadata[ADVANCE_VAT_META.consume]).toBeUndefined();
  });

  it('มีรายการ advance-excess-income ที่มีผลอยู่แล้วและบัญชีเป็น 0 (รันซ้ำ) → ALREADY_POSTED ไม่ลงซ้ำ ไม่แตะคอลัมน์', async () => {
    const { template, tx, createAndPost } = build({
      ledger: {},
      existing: [
        { flow: ADVANCE_EXCESS_INCOME_FLOW, idempotencyKey: 'advance-excess-income:contract-1' },
      ],
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('ALREADY_POSTED');
    expect(createAndPost).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it('final review I1: รายการกวาดยุคก่อน 22.2 ยังมีผล (ล้างเฉพาะ 21-1103) แต่ 21-5101 ยังค้าง 300 → ลงรายการที่สอง key :2 Dr 21-5101 300 / Cr 42-1106 280.37 / Cr 21-2102 19.63 — ไม่ใช่ ALREADY_POSTED เงียบ', async () => {
    const { template, tx, posted } = build({
      ledger: { '21-5101': '300.00' },
      stamps: [{ [ADVANCE_VAT_META.park]: '52.34' }, { [ADVANCE_VAT_META.consume]: '32.71' }],
      columns: { creditBalance: '300.00' },
      existing: [
        {
          flow: ADVANCE_EXCESS_INCOME_FLOW,
          idempotencyKey: 'advance-excess-income:contract-1',
          amount: '500.00',
          creditBalanceBefore: '300.00',
        },
      ],
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('POSTED');
    if (result.outcome !== 'POSTED') throw new Error('unreachable');
    expect(result.advance.toFixed(2)).toBe('0.00');
    expect(result.credit.toFixed(2)).toBe('300.00');
    expect(tuples(posted().lines)).toEqual([
      '21-5101 300.00 0.00',
      '42-1106 0.00 280.37',
      '21-2102 0.00 19.63',
    ]);
    expect(posted().metadata.idempotencyKey).toBe('advance-excess-income:contract-1:2');
    expect(posted().reference).toBe('contract-1:advance-excess-income:2');
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: 'contract-1' },
      data: { advanceBalance: 0, rescheduleAdvanceBalance: 0, creditBalance: 0 },
    });
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
    expect(result.creditBalance.toFixed(2)).toBe('0.00');
    expect(createAndPost).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      CLOSE_ADVANCE_MISMATCH_MESSAGE,
      expect.objectContaining({ tags: expect.objectContaining({ flow: 'excess-income' }) }),
    );
  });

  it('22.2: บัญชี 21-1103 / 21-5101 = 0 แต่คอลัมน์ creditBalance 50 → COLUMNS_ONLY (creditBalance 50.00) ไม่ลงรายการ', async () => {
    const { template, tx, createAndPost } = build({
      ledger: {},
      columns: { creditBalance: '50.00' },
    });
    const result = await template.execute('contract-1');
    expect(result.outcome).toBe('COLUMNS_ONLY');
    if (result.outcome !== 'COLUMNS_ONLY') throw new Error('unreachable');
    expect(result.creditBalance.toFixed(2)).toBe('50.00');
    expect(result.advanceBalance.toFixed(2)).toBe('0.00');
    expect(createAndPost).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it('บัญชี 21-1103 / 21-5101 = 0 และคอลัมน์ = 0 → NOTHING', async () => {
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
