import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';
import {
  RECEIPT_ACCRUAL_VOID_FLOW,
  ReceiptVoidReversalTemplate,
} from './cpa-templates/receipt-void-reversal.template';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

const dec = (v: string | number) => new Decimal(v);

type CapturedJe = {
  description: string;
  reference?: string;
  postedAt?: Date;
  metadata: Record<string, unknown>;
  lines: { accountCode: string; dr: Decimal; cr: Decimal; description: string }[];
};

const figures = (je: CapturedJe) =>
  je.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)]);

/**
 * กลับรายการตั้งลูกหนี้งวดที่ลง ณ วันรับเงิน เมื่อยกเลิกใบเสร็จ (คำตอบฝ่ายบัญชี 29/09/2569 ข้อ 4
 * ทางเลือก 1 · คำตัดสินผู้คุมงาน R10 + R13) — เทสแบบ mock ไม่ต่อฐานข้อมูล.
 * รายการกลับ = กระจกของบรรทัดที่ลงไว้จริง (ยอดมาจากสมุดบัญชี) — ตัวสร้างบรรทัดของ 2A ใช้ตรวจทานเท่านั้น
 * การยกเลิกใบเสร็จไม่ถูกปฏิเสธเพราะยอดที่ลงไว้ต่างจากยอดที่คำนวณจากสัญญา.
 * สัญญามาตรฐาน 17,000 / 12 งวด: 1,416.66 + VAT 99.17 = 1,515.83 · ดอกเบี้ยงวดละ 500.00
 */
describe('ReceiptVoidReversalTemplate.voidAccrualPostedAtReceipt', () => {
  const DUE_12_OCT = new Date('2026-10-11T17:00:00.000Z'); // 12 ต.ค. 2569 00:00 เวลาไทย
  const VOID_25_SEP = new Date('2026-09-25T04:00:00.000Z'); // 25 ก.ย. 2569 11:00 เวลาไทย

  const contract = {
    id: 'contract-1',
    contractNumber: 'CT-0001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
  };

  const ACCRUAL_META = {
    tag: '2A',
    contractId: 'contract-1',
    installmentScheduleId: 'inst-3',
    trigger: 'receipt',
    receiptDate: '2026-09-22T03:00:00.000Z',
  };

  /** บรรทัดของ 2A ตามที่เก็บในฐานข้อมูล (debit / credit) — ลำดับและคำอธิบายตามที่ 2A ลง */
  const postedLines = (amounts: { total: string; vat: string; exclVat: string }) => [
    {
      accountCode: '11-2103',
      debit: dec(amounts.total),
      credit: dec(0),
      description: 'ลูกหนี้ค้างชำระ (Accrual)',
    },
    {
      accountCode: '21-2102',
      debit: dec(amounts.vat),
      credit: dec(0),
      description: 'ล้าง ภาษีขายรอเรียกเก็บ',
    },
    {
      accountCode: '11-2106',
      debit: dec('500.00'),
      credit: dec(0),
      description: 'ล้าง รายได้รอตัดบัญชี-ดอกเบี้ย',
    },
    {
      accountCode: '11-2101',
      debit: dec(0),
      credit: dec(amounts.exclVat),
      description: 'ลูกหนี้ Gross (ลด excl.VAT)',
    },
    {
      accountCode: '11-2105',
      debit: dec(0),
      credit: dec(amounts.vat),
      description: 'ลูกหนี้ภาษีขายรอฯ (ล้าง)',
    },
    {
      accountCode: '41-1101',
      debit: dec(0),
      credit: dec('500.00'),
      description: 'รายได้ดอกเบี้ย (รับรู้)',
    },
    {
      accountCode: '21-2101',
      debit: dec(0),
      credit: dec(amounts.vat),
      description: 'ภาษีขาย ภ.พ.30',
    },
  ];
  const NORMAL = { total: '1515.83', vat: '99.17', exclVat: '1416.66' };
  const LAST = { total: '1515.87', vat: '99.13', exclVat: '1416.74' };
  /** ยอดที่ลงไว้ต่างจากที่ตัวสร้างให้สำหรับสัญญานี้ (เช่น กติกาปัดเศษถูกแก้หลังวันที่ลงรายการ) */
  const DRIFTED = { total: '1515.84', vat: '99.17', exclVat: '1416.67' };

  const accrualEntry = (lines: ReturnType<typeof postedLines>) => ({
    id: 'je-2a',
    entryNumber: 'JE-202609-00077',
    status: 'POSTED',
    metadata: ACCRUAL_META,
    lines,
  });

  function build(
    opts: {
      installmentNo?: number;
      dueDate?: Date;
      accrualJournalEntryId?: string | null;
      /** undefined = 2A ปกติที่ลง ณ วันรับเงิน · null = หารายการไม่เจอ */
      accrual?: Record<string, unknown> | null;
      /** แทนบางช่องของสัญญา (ใช้จำลองข้อมูลสัญญาที่ตัวสร้างคำนวณไม่ได้) */
      contractOverride?: Record<string, unknown>;
      createAndPost?: jest.Mock;
    } = {},
  ) {
    const inst = {
      id: 'inst-3',
      installmentNo: opts.installmentNo ?? 3,
      contractId: contract.id,
      dueDate: opts.dueDate ?? DUE_12_OCT,
      accrualJournalEntryId:
        opts.accrualJournalEntryId === undefined ? 'JE-202609-00077' : opts.accrualJournalEntryId,
      contract: { ...contract, ...opts.contractOverride },
    };
    const accrual = opts.accrual === undefined ? accrualEntry(postedLines(NORMAL)) : opts.accrual;
    const tx = {
      installmentSchedule: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(inst),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(accrual),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const createAndPost =
      opts.createAndPost ??
      jest.fn().mockResolvedValue({ id: 'je-rev', entryNumber: 'JE-202609-00091' });
    // client หลักต้องไม่ถูกใช้เลย — ทุกอย่างต้องอยู่ในธุรกรรมของการยกเลิกใบเสร็จ
    const rootPrisma = {
      installmentSchedule: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      journalEntry: { findFirst: jest.fn(), update: jest.fn() },
    };
    const tpl = new ReceiptVoidReversalTemplate({ createAndPost } as never, rootPrisma as never);
    return { tpl, tx, rootPrisma, createAndPost };
  }

  const expectNothingWritten = (b: ReturnType<typeof build>) => {
    expect(b.createAndPost).not.toHaveBeenCalled();
    expect(b.tx.journalEntry.update).not.toHaveBeenCalled();
    expect(b.tx.installmentSchedule.update).not.toHaveBeenCalled();
  };

  /** รายการกลับถูกลง รายการเดิมถูกประทับ และลิงก์ของงวดถูกล้าง */
  const expectReversalWritten = (b: ReturnType<typeof build>) => {
    expect(b.createAndPost).toHaveBeenCalledTimes(1);
    expect(b.tx.journalEntry.update).toHaveBeenCalledWith({
      where: { id: 'je-2a' },
      data: {
        metadata: {
          ...ACCRUAL_META,
          reversed: true,
          reversedByEntryNumber: 'JE-202609-00091',
        },
      },
    });
    expect(b.tx.installmentSchedule.update).toHaveBeenCalledWith({
      where: { id: 'inst-3' },
      data: { accrualJournalEntryId: null, accruedAmount: 0, accruedVat: 0, accruedInterest: 0 },
    });
  };

  beforeEach(() => jest.clearAllMocks());

  it('ยกเลิกก่อนวันครบกำหนด → ลงกระจกของบรรทัดที่ลงไว้ ในธุรกรรมเดียวกัน ประทับรายการเดิม ล้างลิงก์ของงวด', async () => {
    const b = build();

    const out = await b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP);

    expect(out).toEqual({
      reversed: true,
      entryNo: 'JE-202609-00091',
      accrualEntryNumber: 'JE-202609-00077',
    });
    expect(b.tx.journalEntry.findFirst).toHaveBeenCalledWith({
      where: { entryNumber: 'JE-202609-00077', deletedAt: null },
      include: { lines: true },
    });
    const [je, passedTx] = b.createAndPost.mock.calls[0] as [CapturedJe, unknown];
    expect(passedTx).toBe(b.tx);
    expect(je.description).toBe(
      '[ยกเลิกใบเสร็จ] กลับรายการตั้งลูกหนี้งวด #3 — สัญญา CT-0001 (JE-202609-00077)',
    );
    expect(je.reference).toBe('je-2a:accrual-void');
    expect(je.postedAt).toBeUndefined(); // ลงวันที่ยกเลิก เหมือนรายการกลับใบรับชำระ
    // ทุกบัญชีของงวดกลับไปเท่าก่อนรับเงิน: แต่ละบรรทัดที่ลงไว้ถูกกลับด้วยยอดเดิม เรียงตามรูปที่เสนอฝ่ายบัญชี
    expect(figures(je)).toEqual([
      ['11-2101', '1416.66', '0.00'],
      ['11-2105', '99.17', '0.00'],
      ['21-2101', '99.17', '0.00'],
      ['41-1101', '500.00', '0.00'],
      ['11-2103', '0.00', '1515.83'],
      ['21-2102', '0.00', '99.17'],
      ['11-2106', '0.00', '500.00'],
    ]);
    expect(je.lines.map((l) => l.description)).toEqual([
      '[กลับรายการ] ลูกหนี้ Gross (ลด excl.VAT)',
      '[กลับรายการ] ลูกหนี้ภาษีขายรอฯ (ล้าง)',
      '[กลับรายการ] ภาษีขาย ภ.พ.30',
      '[กลับรายการ] รายได้ดอกเบี้ย (รับรู้)',
      '[กลับรายการ] ลูกหนี้ค้างชำระ (Accrual)',
      '[กลับรายการ] ล้าง ภาษีขายรอเรียกเก็บ',
      '[กลับรายการ] ล้าง รายได้รอตัดบัญชี-ดอกเบี้ย',
    ]);
    expectReversalWritten(b);
  });

  it('metadata ของรายการกลับมีเฉพาะคีย์ที่กำหนด — ไม่มีตัวระบุงวด/การชำระที่ผู้อ่านใบรับชำระใช้', async () => {
    const b = build();

    await b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP);

    const je = b.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(RECEIPT_ACCRUAL_VOID_FLOW).toBe('receipt-accrual-void');
    expect(je.metadata).toEqual({
      tag: 'REVERSAL',
      flow: 'receipt-accrual-void',
      idempotencyKey: 'receipt-accrual-void:je-2a',
      originalEntryId: 'je-2a',
      originalEntryNumber: 'JE-202609-00077',
      contractId: 'contract-1',
    });
    for (const forbidden of ['installmentScheduleId', 'paymentId', 'trigger', 'receiptDate']) {
      expect(je.metadata).not.toHaveProperty(forbidden);
    }
  });

  it('งวดสุดท้าย → กลับด้วยยอดของงวดสุดท้ายตามที่ลงไว้ (1,515.87 / 99.13 / 1,416.74)', async () => {
    const b = build({ installmentNo: 12, accrual: accrualEntry(postedLines(LAST)) });

    const out = await b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP);

    expect(out.reversed).toBe(true);
    expect(figures(b.createAndPost.mock.calls[0][0] as CapturedJe)).toEqual([
      ['11-2101', '1416.74', '0.00'],
      ['11-2105', '99.13', '0.00'],
      ['21-2101', '99.13', '0.00'],
      ['41-1101', '500.00', '0.00'],
      ['11-2103', '0.00', '1515.87'],
      ['21-2102', '0.00', '99.13'],
      ['11-2106', '0.00', '500.00'],
    ]);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ไม่ระบุวันที่ยกเลิก → ตัดสินจากตอนนี้', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const yesterday = new Date(Date.now() - 86_400_000);

    const notDue = build({ dueDate: tomorrow });
    expect(
      (await notDue.tpl.voidAccrualPostedAtReceipt('inst-3', notDue.tx as never)).reversed,
    ).toBe(true);

    const due = build({ dueDate: yesterday });
    expect(await due.tpl.voidAccrualPostedAtReceipt('inst-3', due.tx as never)).toEqual({
      reversed: false,
      reason: 'DUE_DATE_REACHED',
    });
  });

  describe('ตรวจทานกับตัวสร้างบรรทัดของ 2A — ไม่ใช่ด่าน: การยกเลิกไม่ถูกปฏิเสธ', () => {
    it('บรรทัดที่ลงไว้ตรงกับที่ตัวสร้างให้ → กลับรายการ ไม่มีสัญญาณเตือน', async () => {
      const b = build();

      const out = await b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP);

      expect(out.reversed).toBe(true);
      expectReversalWritten(b);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('บรรทัดที่ลงไว้ต่างจากที่ตัวสร้างให้ → ยังกลับรายการตามบรรทัดที่ลงไว้จริง + สัญญาณเตือนของตัวเอง', async () => {
      const b = build({ accrual: accrualEntry(postedLines(DRIFTED)) });

      const out = await b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP);

      expect(out).toEqual({
        reversed: true,
        entryNo: 'JE-202609-00091',
        accrualEntryNumber: 'JE-202609-00077',
      });
      // ยอดของรายการกลับ = ยอดที่ลงไว้ในสมุดบัญชี (1,515.84 / 1,416.67) ไม่ใช่ยอดที่คำนวณจากสัญญา
      expect(figures(b.createAndPost.mock.calls[0][0] as CapturedJe)).toEqual([
        ['11-2101', '1416.67', '0.00'],
        ['11-2105', '99.17', '0.00'],
        ['21-2101', '99.17', '0.00'],
        ['41-1101', '500.00', '0.00'],
        ['11-2103', '0.00', '1515.84'],
        ['21-2102', '0.00', '99.17'],
        ['11-2106', '0.00', '500.00'],
      ]);
      expectReversalWritten(b);
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        '[receipt-accrual-void] posted 2A lines differ from the builder — reversal mirrors the posted lines',
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({ action: 'receipt-accrual-void-crosscheck' }),
          extra: expect.objectContaining({
            installmentScheduleId: 'inst-3',
            accrualEntryNumber: 'JE-202609-00077',
            reversalEntryNumber: 'JE-202609-00091',
            mirrored: expect.arrayContaining(['11-2103:0.00:1515.84', '11-2101:1416.67:0.00']),
            expected: expect.arrayContaining(['11-2103:0.00:1515.83', '11-2101:1416.66:0.00']),
          }),
        }),
      );
    });

    it('ตัวสร้างคำนวณไม่ได้ (ข้อมูลสัญญาผิดรูป) → ยังกลับรายการตามบรรทัดที่ลงไว้จริง + สัญญาณเตือน ไม่ throw', async () => {
      const b = build({ contractOverride: { financedAmount: { toString: () => 'ไม่ใช่ตัวเลข' } } });

      const out = await b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP);

      expect(out.reversed).toBe(true);
      expect(figures(b.createAndPost.mock.calls[0][0] as CapturedJe)).toContainEqual([
        '11-2103',
        '0.00',
        '1515.83',
      ]);
      expectReversalWritten(b);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({ action: 'receipt-accrual-void-crosscheck-failed' }),
          extra: expect.objectContaining({ accrualEntryNumber: 'JE-202609-00077' }),
        }),
      );
    });
  });

  describe('กรณีที่ไม่กลับรายการ — ไม่ลงรายการ ไม่แก้อะไร', () => {
    it('งวดยังไม่ได้ตั้งลูกหนี้ → NOT_ACCRUED และไม่อ่านรายการบัญชี', async () => {
      const b = build({ accrualJournalEntryId: null });

      await expect(
        b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP),
      ).resolves.toEqual({ reversed: false, reason: 'NOT_ACCRUED' });

      expect(b.tx.journalEntry.findFirst).not.toHaveBeenCalled();
      expectNothingWritten(b);
    });

    const VOID_DATES: { label: string; voidIso: string; reversed: boolean }[] = [
      { label: 'วันก่อนวันครบกำหนด 23:30', voidIso: '2026-10-11T16:30:00.000Z', reversed: true },
      { label: 'วันครบกำหนดเอง 00:30', voidIso: '2026-10-11T17:30:00.000Z', reversed: false },
      { label: 'วันครบกำหนดเอง 20:00', voidIso: '2026-10-12T13:00:00.000Z', reversed: false },
      { label: 'หลังวันครบกำหนด 3 วัน', voidIso: '2026-10-15T03:00:00.000Z', reversed: false },
    ];

    it.each(VOID_DATES)(
      'ยกเลิก$label (เวลาไทย) → กลับรายการ = $reversed',
      async ({ voidIso, reversed }) => {
        const b = build();

        const out = await b.tpl.voidAccrualPostedAtReceipt(
          'inst-3',
          b.tx as never,
          new Date(voidIso),
        );

        expect(out.reversed).toBe(reversed);
        if (!reversed) {
          expect(out).toEqual({ reversed: false, reason: 'DUE_DATE_REACHED' });
          expect(b.tx.journalEntry.findFirst).not.toHaveBeenCalled();
          expectNothingWritten(b);
        }
      },
    );

    it('2A ที่รอบกลางคืนลง (ไม่มี trigger) → NOT_POSTED_AT_RECEIPT', async () => {
      const b = build({
        accrual: {
          ...accrualEntry(postedLines(NORMAL)),
          metadata: { tag: '2A', contractId: 'contract-1', installmentScheduleId: 'inst-3' },
        },
      });

      await expect(
        b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP),
      ).resolves.toEqual({ reversed: false, reason: 'NOT_POSTED_AT_RECEIPT' });

      expectNothingWritten(b);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    const UNRESOLVABLE: { label: string; accrual: Record<string, unknown> | null }[] = [
      { label: 'หารายการที่ลิงก์ของงวดชี้ไม่เจอ', accrual: null },
      {
        label: 'รายการที่ลิงก์ชี้ไม่ได้อยู่ในสถานะ POSTED',
        accrual: { ...accrualEntry(postedLines(NORMAL)), status: 'DRAFT' },
      },
      {
        label: 'รายการที่ลิงก์ชี้ไม่ใช่รายการตั้งลูกหนี้งวด',
        accrual: {
          ...accrualEntry(postedLines(NORMAL)),
          id: 'je-x',
          metadata: { tag: 'receipt', contractId: 'contract-1' },
        },
      },
      { label: 'รายการที่ลิงก์ชี้ไม่มีบรรทัดให้กลับ', accrual: accrualEntry([]) },
    ];

    it.each(UNRESOLVABLE)('$label → ACCRUAL_NOT_FOUND + สัญญาณเตือน', async ({ accrual }) => {
      const b = build({ accrual });

      await expect(
        b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP),
      ).resolves.toEqual({ reversed: false, reason: 'ACCRUAL_NOT_FOUND' });

      expectNothingWritten(b);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        '[receipt-accrual-void] accrual link does not resolve to a reversible 2A entry — not reversed',
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({ action: 'receipt-accrual-void-skipped' }),
          extra: expect.objectContaining({
            reason: 'ACCRUAL_NOT_FOUND',
            installmentScheduleId: 'inst-3',
            accrualJournalEntryId: 'JE-202609-00077',
          }),
        }),
      );
    });

    it('รายการที่ลิงก์ชี้เป็น 2A ที่ลง ณ วันรับเงินของงวดอื่น → ACCRUAL_NOT_FOUND + สัญญาณเตือน ไม่กลับรายการของงวดอื่น', async () => {
      // POSTED · tag 2A · trigger receipt · มีบรรทัด — ต่างเพียง installmentScheduleId เป็นของงวดอื่น
      const b = build({
        accrual: {
          ...accrualEntry(postedLines(NORMAL)),
          metadata: { ...ACCRUAL_META, installmentScheduleId: 'inst-4' },
        },
      });

      await expect(
        b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP),
      ).resolves.toEqual({ reversed: false, reason: 'ACCRUAL_NOT_FOUND' });

      expectNothingWritten(b);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        '[receipt-accrual-void] accrual link does not resolve to a reversible 2A entry — not reversed',
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({ action: 'receipt-accrual-void-skipped' }),
          extra: expect.objectContaining({
            reason: 'ACCRUAL_NOT_FOUND',
            installmentScheduleId: 'inst-3',
            accrualJournalEntryId: 'JE-202609-00077',
          }),
        }),
      );
    });

    it('รายการตั้งลูกหนี้งวดถูกกลับไปแล้ว → ALREADY_REVERSED + สัญญาณเตือน ไม่ลงซ้ำ', async () => {
      const b = build({
        accrual: {
          ...accrualEntry(postedLines(NORMAL)),
          metadata: { ...ACCRUAL_META, reversed: true, reversedByEntryNumber: 'JE-202609-00091' },
        },
      });

      await expect(
        b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP),
      ).resolves.toEqual({ reversed: false, reason: 'ALREADY_REVERSED' });

      expectNothingWritten(b);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        '[receipt-accrual-void] accrual link does not resolve to a reversible 2A entry — not reversed',
        expect.objectContaining({
          extra: expect.objectContaining({ reason: 'ALREADY_REVERSED' }),
        }),
      );
    });
  });

  it.each(['P2002', 'P2034'])(
    'ชนกับรายการกลับอีกรายการ (%s) → error ของฐานข้อมูลผ่านออกไปตามเดิม ไม่ถูกแปลง ไม่ประทับ ไม่ล้างลิงก์ ไม่มีสัญญาณเตือนของการตรวจทาน',
    async (code) => {
      const conflict = new Prisma.PrismaClientKnownRequestError('conflict', {
        code,
        clientVersion: 'test',
      });
      const b = build({
        accrual: accrualEntry(postedLines(DRIFTED)),
        createAndPost: jest.fn().mockRejectedValue(conflict),
      });

      await expect(
        b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP),
      ).rejects.toBe(conflict);

      expect(b.tx.journalEntry.update).not.toHaveBeenCalled();
      expect(b.tx.installmentSchedule.update).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    },
  );

  it('อ่านและเขียนผ่านธุรกรรมที่ส่งเข้ามาเท่านั้น', async () => {
    const b = build();

    await b.tpl.voidAccrualPostedAtReceipt('inst-3', b.tx as never, VOID_25_SEP);

    expect(b.rootPrisma.installmentSchedule.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(b.rootPrisma.installmentSchedule.update).not.toHaveBeenCalled();
    expect(b.rootPrisma.journalEntry.findFirst).not.toHaveBeenCalled();
    expect(b.rootPrisma.journalEntry.update).not.toHaveBeenCalled();
  });
});

/**
 * `voidReceipt` (รายการกลับใบรับชำระ) ใช้ตัวช่วยสร้างบรรทัดกระจกตัวเดียวกับข้างบน (R13) —
 * ปักว่าบรรทัดที่ได้เท่ากับของเดิมทุกตัวอักษร: ลำดับเดิม ยอดเดิมสลับฝั่ง คำอธิบายขึ้นต้นด้วย [VOID].
 */
describe('ReceiptVoidReversalTemplate.voidReceipt — บรรทัดกระจกคงเดิม', () => {
  beforeEach(() => jest.clearAllMocks());

  it('สลับ debit/credit ทีละบรรทัด ตามลำดับที่ลงไว้ คำอธิบายขึ้นต้นด้วย [VOID]', async () => {
    const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-202609-00092' });
    const tx = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'je-2b',
          entryNumber: 'JE-202609-00078',
          status: 'POSTED',
          metadata: { tag: 'receipt', contractId: 'contract-1' },
          lines: [
            {
              accountCode: '11-1101',
              debit: dec('1515.83'),
              credit: dec(0),
              description: 'รับเงิน',
            },
            { accountCode: '11-2103', debit: dec(0), credit: dec('1515.83'), description: null },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const tpl = new ReceiptVoidReversalTemplate({ createAndPost } as never, {} as never);

    await expect(tpl.voidReceipt('je-2b', tx as never)).resolves.toEqual({
      entryNo: 'JE-202609-00092',
    });

    const je = createAndPost.mock.calls[0][0] as CapturedJe;
    expect(
      je.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2), l.description]),
    ).toEqual([
      ['11-1101', '0.00', '1515.83', '[VOID] รับเงิน'],
      ['11-2103', '1515.83', '0.00', '[VOID]'],
    ]);
  });
});
