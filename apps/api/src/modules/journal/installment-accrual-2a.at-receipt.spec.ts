import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  ACCRUAL_PORTION_PARTIAL,
  ACCRUAL_PORTION_REMAINDER,
  ACCRUAL_TRIGGER_RECEIPT,
  InstallmentAccrual2ATemplate,
} from './cpa-templates/installment-accrual-2a.template';

/**
 * ตั้งลูกหนี้งวด ณ วันรับเงิน (คำตัดสินฝ่ายบัญชี D2, 2026-09-28) — เทสแบบ mock ไม่ต่อฐานข้อมูล.
 * สัญญามาตรฐาน 17,000 / 12 งวด: 1,416.66 + VAT 99.17 = 1,515.83 · ดอกเบี้ยงวดละ 500.00
 * (ตัวเลขเดียวกับ installment-accrual-2a.template.golden.spec.ts)
 */
describe('InstallmentAccrual2ATemplate.accrueAtReceipt', () => {
  const dec = (v: string | number) => new Decimal(v);
  const DUE_12_OCT = new Date('2026-10-11T17:00:00.000Z'); // 12 ต.ค. 2569 00:00 เวลาไทย
  const RECEIPT_29_SEP = new Date('2026-09-29T03:00:00.000Z'); // 29 ก.ย. 2569 10:00 เวลาไทย

  const contract = {
    id: 'contract-1',
    contractNumber: 'CT-0001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
    // มีเงินรับล่วงหน้าทั้งสองถัง — โหมดแกนอย่างเดียวต้องไม่แตะ
    advanceBalance: dec('2000'),
    rescheduleAdvanceBalance: dec('354'),
  };

  type CapturedJe = {
    reference?: string;
    postedAt?: Date;
    metadata?: Record<string, unknown>;
    lines: { accountCode: string; dr: Decimal; cr: Decimal }[];
  };

  function build(opts: {
    installmentNo?: number;
    accrualJournalEntryId?: string | null;
    dueDate?: Date;
    periodStatus?: string | null;
    /** รายการที่ถือ `reference` = id ของแถวตารางงวดอยู่ (null = ยังไม่เคยมี 2A ของงวดนี้) */
    referenceHolder?: { metadata: Record<string, unknown> } | null;
    /** รายการ 2A ที่ตั้งใหม่หลังการกลับรายการครั้งก่อน ๆ — ตัวที่ n ถือ `<id>:re-accrual:<n>` */
    reAccruals?: { metadata: Record<string, unknown> }[];
    /** รายการ 2A บางส่วนที่มีอยู่แล้ว — ตัวที่ k ถือ `<id>:receipt-accrual:<k>` */
    receiptAccruals?: { metadata: Record<string, unknown> }[];
    /** ยอดที่ตั้งไปแล้วของงวด (คอลัมน์ accrued*) — ไม่ส่ง = 0 (ค่าเริ่มต้นของคอลัมน์) */
    accrued?: { amount: string; vat: string; interest: string };
  }) {
    const inst = {
      id: 'inst-3',
      installmentNo: opts.installmentNo ?? 3,
      contractId: contract.id,
      dueDate: opts.dueDate ?? DUE_12_OCT,
      accrualJournalEntryId: opts.accrualJournalEntryId ?? null,
      accruedAmount: dec(opts.accrued?.amount ?? '0'),
      accruedVat: dec(opts.accrued?.vat ?? '0'),
      accruedInterest: dec(opts.accrued?.interest ?? '0'),
    };
    const createAndPost = jest
      .fn()
      .mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202609-00077' });
    const tx = {
      installmentSchedule: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(inst),
        update: jest.fn().mockResolvedValue({}),
      },
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(contract),
        update: jest.fn(),
      },
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'finance-co' }) },
      accountingPeriod: {
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.periodStatus ? { status: opts.periodStatus } : null),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: '0' }) },
      payment: { findFirst: jest.fn(), update: jest.fn() },
      journalEntry: {
        // ตอบตาม reference ที่ถูกถามตรงตัว — แบบเดียวกับการอ่านด้วยค่าเท่ากันบน unique index
        findFirst: jest.fn(({ where }: { where: { referenceId: unknown } }) => {
          if (where.referenceId === 'inst-3') return Promise.resolve(opts.referenceHolder ?? null);
          const match = /^inst-3:re-accrual:(\d+)$/.exec(String(where.referenceId));
          if (match) return Promise.resolve(opts.reAccruals?.[Number(match[1]) - 1] ?? null);
          const part = /^inst-3:receipt-accrual:(\d+)$/.exec(String(where.referenceId));
          return Promise.resolve(
            part ? (opts.receiptAccruals?.[Number(part[1]) - 1] ?? null) : null,
          );
        }),
        // ห้ามค้นแบบกวาด (ขึ้นต้นด้วย …) ในธุรกรรมของการรับชำระ — ต้องไม่ถูกเรียกเลย
        findMany: jest.fn(),
      },
    };
    // client หลัก "มองไม่เห็น" ตารางงวด (จำลองแถวที่เพิ่งสร้างในธุรกรรมและยังไม่ commit)
    const rootPrisma = {
      installmentSchedule: {
        findUniqueOrThrow: jest.fn().mockRejectedValue(new Error('No InstallmentSchedule found')),
      },
    };
    const tmpl = new InstallmentAccrual2ATemplate({ createAndPost } as never, rootPrisma as never);
    return { tmpl, tx, rootPrisma, createAndPost };
  }

  const figures = (je: CapturedJe) =>
    je.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)]);
  /** อาร์กิวเมนต์ของการเขียนแถวตารางงวด — ยอด Decimal เป็นสตริง 2 ตำแหน่งเพื่อเทียบ */
  const scheduleUpdate = (
    update: jest.Mock,
  ): { where: Record<string, unknown>; data: Record<string, unknown> } => {
    const { where, data } = update.mock.calls[0][0] as {
      where: { id: string; accrualJournalEntryId: null; accruedAmount: Decimal };
      data: Record<string, unknown>;
    };
    const money = (v: unknown) => (v as Decimal).toFixed(2);
    return {
      where: { ...where, accruedAmount: money(where.accruedAmount) },
      data: {
        ...data,
        accruedAmount: money(data.accruedAmount),
        accruedVat: money(data.accruedVat),
        accruedInterest: money(data.accruedInterest),
      },
    };
  };

  it('รับเงินก่อนครบกำหนด → ลง 2A เต็มงวด ลงวันที่รับเงิน พร้อม trigger/receiptDate', async () => {
    const { tmpl, tx, createAndPost } = build({});

    const out = await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never);

    expect(out).toEqual({
      entryNo: 'JE-202609-00077',
      postedAt: RECEIPT_29_SEP,
      kind: 'FULL',
      amount: expect.any(Decimal),
      completes: true,
    });
    expect(out!.amount.toFixed(2)).toBe('1515.83');
    expect(createAndPost).toHaveBeenCalledTimes(1);
    const [je, passedTx] = createAndPost.mock.calls[0] as [CapturedJe, unknown];
    expect(passedTx).toBe(tx);
    expect(je.reference).toBe('inst-3');
    expect(je.postedAt).toBe(RECEIPT_29_SEP);
    expect(je.metadata).toEqual({
      tag: '2A',
      contractId: 'contract-1',
      installmentScheduleId: 'inst-3',
      trigger: ACCRUAL_TRIGGER_RECEIPT,
      receiptDate: '2026-09-29T03:00:00.000Z',
    });
    expect(je.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)])).toEqual([
      ['11-2103', '1515.83', '0.00'],
      ['21-2102', '99.17', '0.00'],
      ['11-2106', '500.00', '0.00'],
      ['11-2101', '0.00', '1416.66'],
      ['11-2105', '0.00', '99.17'],
      ['41-1101', '0.00', '500.00'],
      ['21-2101', '0.00', '99.17'],
    ]);
    // ยอดสะสม = ทั้งงวด + ลิงก์ (ตั้งครบ) — compare-and-set กับยอดที่อ่านมา (0)
    expect(scheduleUpdate(tx.installmentSchedule.update)).toEqual({
      where: { id: 'inst-3', accrualJournalEntryId: null, accruedAmount: '0.00' },
      data: {
        accruedAmount: '1515.83',
        accruedVat: '99.17',
        accruedInterest: '500.00',
        accrualJournalEntryId: 'JE-202609-00077',
      },
    });
  });

  it('แกนอย่างเดียว: ไม่หักเงินรับล่วงหน้าทั้งสองถัง และไม่แตะแถว Payment แม้เป็นงวดสุดท้าย', async () => {
    const { tmpl, tx, createAndPost } = build({ installmentNo: 12 });

    await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never);

    expect(createAndPost).toHaveBeenCalledTimes(1); // มีแต่รายการ 2A — ไม่มีรายการหัก 21-1103
    expect(tx.contract.update).not.toHaveBeenCalled();
    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    // งวดสุดท้ายรับเศษปัด: 1,416.74 + 99.13 = 1,515.87
    const je = createAndPost.mock.calls[0][0] as CapturedJe;
    expect(je.lines[0].dr.toFixed(2)).toBe('1515.87');
  });

  it('อ่านผ่านธุรกรรมที่ส่งเข้ามาเท่านั้น — ตารางงวดที่เพิ่งสร้างในธุรกรรมเดียวกันต้องใช้ได้', async () => {
    const { tmpl, tx, rootPrisma } = build({});

    await expect(
      tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never),
    ).resolves.not.toBeNull();

    expect(rootPrisma.installmentSchedule.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('รับเงินหลังครบกำหนด (รอบกลางคืนตกหล่น) → ลงวันครบกำหนด', async () => {
    const { tmpl, tx, createAndPost } = build({});
    const receipt = new Date('2026-10-15T03:00:00.000Z');

    const out = await tmpl.accrueAtReceipt('inst-3', receipt, tx as never);

    expect(out!.postedAt).toBe(DUE_12_OCT);
    const je = createAndPost.mock.calls[0][0] as CapturedJe;
    expect(je.postedAt).toBe(DUE_12_OCT);
    expect(je.metadata!.receiptDate).toBe('2026-10-15T03:00:00.000Z');
  });

  it('งวดที่ตั้งลูกหนี้ไปแล้ว → คืน null ไม่ลงรายการซ้ำ', async () => {
    const { tmpl, tx, createAndPost } = build({ accrualJournalEntryId: 'JE-202609-00001' });

    await expect(tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never)).resolves.toBeNull();

    expect(createAndPost).not.toHaveBeenCalled();
    expect(tx.installmentSchedule.update).not.toHaveBeenCalled();
  });

  it('วันที่ของ 2A อยู่ในงวดบัญชีที่ปิดแล้ว → ปฏิเสธด้วยข้อความไทยที่บอกเดือนที่ปิด ไม่ลงรายการ', async () => {
    // งวดครบกำหนด 12 ส.ค. 2569 รับเงิน 29 ก.ย. 2569 → 2A ต้องลง 12 ส.ค. ซึ่งงวด ส.ค. ปิดแล้ว
    // (period_grace_days = 0 และวันนี้เลย 31 ส.ค. แล้ว)
    const { tmpl, tx, createAndPost } = build({
      dueDate: new Date('2026-08-11T17:00:00.000Z'),
      periodStatus: 'CLOSED',
    });

    const call = tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never);

    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.toThrow(
      'ไม่สามารถรับชำระงวด #3 ได้ — ระบบต้องตั้งลูกหนี้งวดนี้ในงวดบัญชีเดือน 08/2569 ซึ่งปิดแล้ว ' +
        'กรุณาติดต่อฝ่ายบัญชีเพื่อขอเปิดงวดบัญชีเดือนดังกล่าว เมื่อเปิดงวดแล้วจึงบันทึกรับชำระอีกครั้ง',
    );
    expect(tx.accountingPeriod.findUnique).toHaveBeenCalledWith({
      where: { companyId_year_month: { companyId: 'finance-co', year: 2026, month: 8 } },
      select: { status: true },
    });
    expect(createAndPost).not.toHaveBeenCalled();
    expect(tx.installmentSchedule.update).not.toHaveBeenCalled();
  });

  it('งวดครบกำหนดวันที่ 1 รับเงินหลังวันนั้น งวดบัญชีปิด → ข้อความบอกเดือนเดียวกับที่ระบบตรวจ และไม่มีวันที่ระดับวันให้อ่านขัดกัน', async () => {
    // วันครบกำหนด 1 ก.ค. 2569 00:00 เวลาไทย = 30 มิ.ย. 17:00 UTC. validatePeriodOpen ตัดสินเดือนจาก
    // เวลาของเครื่อง: เครื่อง UTC ตรวจงวด 06/2569 · เครื่องเวลาไทยตรวจงวด 07/2569. ข้อความต้องบอก
    // เดือนที่ถูกตรวจจริง (อ่านจาก Date ตัวเดียวกันด้วย getter ชุดเดียวกัน) และต้องไม่มี "01/07/2569"
    const due = new Date('2026-06-30T17:00:00.000Z');
    const receipt = new Date('2026-07-05T02:00:00.000Z'); // 5 ก.ค. 09:00 เวลาไทย
    const { tmpl, tx, createAndPost } = build({ dueDate: due, periodStatus: 'CLOSED' });
    const checkedYear = due.getFullYear();
    const checkedMonth = due.getMonth() + 1;
    const closedMonth = `${String(checkedMonth).padStart(2, '0')}/${checkedYear + 543}`;

    const err = await tmpl.accrueAtReceipt('inst-3', receipt, tx as never).catch((e: Error) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe(
      `ไม่สามารถรับชำระงวด #3 ได้ — ระบบต้องตั้งลูกหนี้งวดนี้ในงวดบัญชีเดือน ${closedMonth} ซึ่งปิดแล้ว ` +
        'กรุณาติดต่อฝ่ายบัญชีเพื่อขอเปิดงวดบัญชีเดือนดังกล่าว เมื่อเปิดงวดแล้วจึงบันทึกรับชำระอีกครั้ง',
    );
    expect((err as Error).message).not.toContain('01/07/2569');
    expect((err as Error).message).not.toContain('ลงวันที่');
    expect(tx.accountingPeriod.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.accountingPeriod.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_year_month: { companyId: 'finance-co', year: checkedYear, month: checkedMonth },
      },
      select: { status: true },
    });
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it.each([
    ['00:30 ของวันที่ 1', '2026-09-30T17:30:00.000Z'],
    ['08:00 ของวันที่ 1', '2026-10-01T01:00:00.000Z'],
  ])(
    'รับเงิน %s ซึ่งเป็นวันครบกำหนด → 2A ลงวันครบกำหนด แต่ตรวจงวดบัญชีงวดเดียวกับที่ใบรับชำระถูกตรวจ',
    async (_label, receiptIso) => {
      const due = new Date('2026-09-30T17:00:00.000Z'); // 1 ต.ค. 2569 00:00 เวลาไทย
      const receipt = new Date(receiptIso);
      const { tmpl, tx, createAndPost } = build({ dueDate: due });

      const out = await tmpl.accrueAtReceipt('inst-3', receipt, tx as never);

      expect(out!.postedAt).toBe(due);
      expect((createAndPost.mock.calls[0][0] as CapturedJe).postedAt).toBe(due);
      // เส้นทางรับชำระเรียก validatePeriodOpen(prisma, <วันที่รับเงิน>, FINANCE) ซึ่งตัดสินปี/เดือนจาก
      // เวลาของเครื่อง — 2A ต้องถูกตัดสินด้วยปี/เดือนของ Date ตัวเดียวกัน ไม่ว่าเครื่องตั้งเขตเวลาใด
      expect(tx.accountingPeriod.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.accountingPeriod.findUnique).toHaveBeenCalledWith({
        where: {
          companyId_year_month: {
            companyId: 'finance-co',
            year: receipt.getFullYear(),
            month: receipt.getMonth() + 1,
          },
        },
        select: { status: true },
      });
    },
  );

  describe('reference ของรายการ 2A — งวดที่เคยถูกกลับรายการตั้งลูกหนี้งวด (ยกเลิกใบเสร็จ)', () => {
    const REVERSED = { metadata: { tag: '2A', reversed: true } };
    const ACTIVE = { metadata: { tag: '2A' } };
    const referenceOf = (createAndPost: jest.Mock) =>
      (createAndPost.mock.calls[0][0] as CapturedJe).reference;
    /** reference ที่ถูกถามตามลำดับ — ทุกครั้งต้องเป็นค่าเท่ากันตรงตัว ของรายการ AUTO ที่ยังไม่ถูกลบ */
    const probedReferences = (findFirst: jest.Mock) =>
      findFirst.mock.calls.map(([arg]) => {
        const { where, select } = arg as {
          where: Record<string, unknown>;
          select: Record<string, unknown>;
        };
        expect(where).toEqual({
          referenceType: 'AUTO',
          referenceId: expect.any(String),
          deletedAt: null,
        });
        expect(select).toEqual({ metadata: true });
        return where.referenceId;
      });

    it('งวดที่ไม่เคยมี 2A → reference เดิม (id ของแถวตารางงวด) อ่านรายการครั้งเดียว', async () => {
      const { tmpl, tx, createAndPost } = build({});

      await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never);

      expect(referenceOf(createAndPost)).toBe('inst-3');
      expect(probedReferences(tx.journalEntry.findFirst)).toEqual(['inst-3']);
      expect(tx.journalEntry.findMany).not.toHaveBeenCalled();
    });

    it('มีรายการที่ยังมีผลถือ reference เดิมอยู่ → ใช้ reference เดิม ให้ฐานข้อมูลเป็นผู้กันลงซ้ำ', async () => {
      const { tmpl, tx, createAndPost } = build({ referenceHolder: ACTIVE });

      await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never);

      expect(referenceOf(createAndPost)).toBe('inst-3');
      expect(probedReferences(tx.journalEntry.findFirst)).toEqual(['inst-3']);
      expect(tx.journalEntry.findMany).not.toHaveBeenCalled();
    });

    it('2A เดิมของงวดถูกกลับรายการแล้ว → 2A ใบใหม่ใช้ <id>:re-accrual:1 — ถาม reference ตรงตัวทีละค่า ไม่ค้นแบบกวาด', async () => {
      const { tmpl, tx, createAndPost } = build({ referenceHolder: REVERSED });

      await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never);

      expect(referenceOf(createAndPost)).toBe('inst-3:re-accrual:1');
      expect(probedReferences(tx.journalEntry.findFirst)).toEqual([
        'inst-3',
        'inst-3:re-accrual:1',
      ]);
      expect(tx.journalEntry.findMany).not.toHaveBeenCalled();
    });

    it('ถูกกลับมาแล้วสองครั้ง (ใบเดิม + ใบที่ตั้งใหม่ครั้งที่ 1) → <id>:re-accrual:2', async () => {
      const { tmpl, tx, createAndPost } = build({
        referenceHolder: REVERSED,
        reAccruals: [REVERSED],
      });

      await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never);

      expect(referenceOf(createAndPost)).toBe('inst-3:re-accrual:2');
      expect(probedReferences(tx.journalEntry.findFirst)).toEqual([
        'inst-3',
        'inst-3:re-accrual:1',
        'inst-3:re-accrual:2',
      ]);
      expect(tx.journalEntry.findMany).not.toHaveBeenCalled();
    });

    it('ใบที่ตั้งใหม่ครั้งที่ 1 ยังมีผลอยู่ → ได้ reference ของใบนั้น (ไม่ข้ามไปเลขถัดไป) ให้ฐานข้อมูลเป็นผู้กันลงซ้ำ', async () => {
      const { tmpl, tx, createAndPost } = build({
        referenceHolder: REVERSED,
        reAccruals: [ACTIVE],
      });

      await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never);

      expect(referenceOf(createAndPost)).toBe('inst-3:re-accrual:1');
      expect(probedReferences(tx.journalEntry.findFirst)).toEqual([
        'inst-3',
        'inst-3:re-accrual:1',
      ]);
    });
  });
  describe('ตั้งเท่ายอดที่รับ (คำตอบฝ่ายบัญชี ก1 "แบบ ข" 29/09/2569)', () => {
    const ACTIVE_PART = { metadata: { tag: '2A', portion: 'partial' } };
    const REVERSED_PART = { metadata: { tag: '2A', portion: 'partial', reversed: true } };

    it('รับบางส่วน 1,000 ก่อนครบกำหนด → 2A เท่ายอดที่รับ ลงวันที่รับเงิน reference `<id>:receipt-accrual:1` ยังไม่ประทับลิงก์', async () => {
      const { tmpl, tx, createAndPost } = build({});

      const out = await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never, dec('1000'));

      expect(out).toEqual({
        entryNo: 'JE-202609-00077',
        postedAt: RECEIPT_29_SEP,
        kind: 'PARTIAL',
        amount: expect.any(Decimal),
        completes: false,
      });
      const je = createAndPost.mock.calls[0][0] as CapturedJe & { description: string };
      expect(je.reference).toBe('inst-3:receipt-accrual:1');
      expect(je.postedAt).toBe(RECEIPT_29_SEP);
      expect(je.description).toBe('Accrual งวด #3 (ตั้งเท่ายอดที่รับ 1000.00) — สัญญา CT-0001');
      expect(je.metadata).toEqual({
        tag: '2A',
        contractId: 'contract-1',
        installmentScheduleId: 'inst-3',
        portion: ACCRUAL_PORTION_PARTIAL,
        trigger: ACCRUAL_TRIGGER_RECEIPT,
        receiptDate: '2026-09-29T03:00:00.000Z',
      });
      expect(figures(je)).toEqual([
        ['11-2103', '1000.00', '0.00'],
        ['21-2102', '65.42', '0.00'],
        ['11-2106', '329.85', '0.00'],
        ['11-2101', '0.00', '934.58'],
        ['11-2105', '0.00', '65.42'],
        ['41-1101', '0.00', '329.85'],
        ['21-2101', '0.00', '65.42'],
      ]);
      expect(scheduleUpdate(tx.installmentSchedule.update)).toEqual({
        where: { id: 'inst-3', accrualJournalEntryId: null, accruedAmount: '0.00' },
        data: { accruedAmount: '1000.00', accruedVat: '65.42', accruedInterest: '329.85' },
      });
      // หา reference ด้วยค่าเท่ากันตรงตัว — ไม่ถาม reference ของรายการที่ทำให้ครบ ไม่ค้นแบบกวาด
      expect(tx.journalEntry.findFirst.mock.calls.map(([a]) => a.where.referenceId)).toEqual([
        'inst-3:receipt-accrual:1',
      ]);
      expect(tx.journalEntry.findMany).not.toHaveBeenCalled();
    });

    it('มีรายการบางส่วนอยู่แล้ว 1 ใบ (และ 1 ใบที่ถูกกลับไปแล้ว) → ใบใหม่ได้ k ถัดจากทุกใบที่ถือ reference อยู่', async () => {
      const { tmpl, tx, createAndPost } = build({
        receiptAccruals: [REVERSED_PART, ACTIVE_PART],
        accrued: { amount: '500.00', vat: '32.71', interest: '164.93' },
      });

      await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never, dec('600'));

      const je = createAndPost.mock.calls[0][0] as CapturedJe;
      expect(je.reference).toBe('inst-3:receipt-accrual:3');
      expect(figures(je)).toEqual([
        ['11-2103', '600.00', '0.00'],
        ['21-2102', '39.25', '0.00'],
        ['11-2106', '197.91', '0.00'],
        ['11-2101', '0.00', '560.75'],
        ['11-2105', '0.00', '39.25'],
        ['41-1101', '0.00', '197.91'],
        ['21-2101', '0.00', '39.25'],
      ]);
      expect(scheduleUpdate(tx.installmentSchedule.update)).toEqual({
        where: { id: 'inst-3', accrualJournalEntryId: null, accruedAmount: '500.00' },
        data: { accruedAmount: '1100.00', accruedVat: '71.96', accruedInterest: '362.84' },
      });
    });

    it('ใบที่ทำให้งวดชำระครบหลังรับบางส่วน 1,000 → ส่วนที่เหลือ 515.83 · reference เดิม `<id>` · ประทับลิงก์', async () => {
      const { tmpl, tx, createAndPost } = build({
        receiptAccruals: [ACTIVE_PART],
        accrued: { amount: '1000.00', vat: '65.42', interest: '329.85' },
      });

      const out = await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never);

      expect(out!.kind).toBe('REMAINDER');
      expect(out!.completes).toBe(true);
      const je = createAndPost.mock.calls[0][0] as CapturedJe & { description: string };
      expect(je.reference).toBe('inst-3');
      expect(je.description).toBe('Accrual งวด #3 (ส่วนที่เหลือ 515.83) — สัญญา CT-0001');
      expect(je.metadata!.portion).toBe(ACCRUAL_PORTION_REMAINDER);
      expect(figures(je)).toEqual([
        ['11-2103', '515.83', '0.00'],
        ['21-2102', '33.75', '0.00'],
        ['11-2106', '170.15', '0.00'],
        ['11-2101', '0.00', '482.08'],
        ['11-2105', '0.00', '33.75'],
        ['41-1101', '0.00', '170.15'],
        ['21-2101', '0.00', '33.75'],
      ]);
      expect(scheduleUpdate(tx.installmentSchedule.update)).toEqual({
        where: { id: 'inst-3', accrualJournalEntryId: null, accruedAmount: '1000.00' },
        data: {
          accruedAmount: '1515.83',
          accruedVat: '99.17',
          accruedInterest: '500.00',
          accrualJournalEntryId: 'JE-202609-00077',
        },
      });
    });

    it('ยอดที่รับถึงส่วนที่เหลือของงวด (ใบบางส่วนของยอดเรียกเก็บ 1,516) → ตั้งทั้งงวด reference เดิม ประทับลิงก์ ไม่มีคีย์ portion', async () => {
      const { tmpl, tx, createAndPost } = build({});

      const out = await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never, dec('1515.83'));

      expect(out!.kind).toBe('FULL');
      expect(out!.completes).toBe(true);
      const je = createAndPost.mock.calls[0][0] as CapturedJe;
      expect(je.reference).toBe('inst-3');
      expect(je.metadata).not.toHaveProperty('portion');
      expect(scheduleUpdate(tx.installmentSchedule.update).data.accrualJournalEntryId).toBe(
        'JE-202609-00077',
      );
    });

    it('ยอดที่รับเป็น 0 → คืน null ไม่ลงรายการ ไม่เขียนแถว', async () => {
      const { tmpl, tx, createAndPost } = build({});

      await expect(
        tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never, dec('0')),
      ).resolves.toBeNull();
      expect(createAndPost).not.toHaveBeenCalled();
      expect(tx.installmentSchedule.update).not.toHaveBeenCalled();
    });

    it('แถวงวดถูกรายการอื่นเขียนแทรก (compare-and-set ไม่พบแถว → P2025) → error ผ่านออกไป ธุรกรรมของผู้เรียกล้ม', async () => {
      const { tmpl, tx } = build({});
      const notFound = new Prisma.PrismaClientKnownRequestError('Record to update not found', {
        code: 'P2025',
        clientVersion: 'test',
      });
      tx.installmentSchedule.update.mockRejectedValueOnce(notFound);

      await expect(
        tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never, dec('1000')),
      ).rejects.toBe(notFound);
    });

    it('งวดบัญชีของวันที่รับเงินปิด → ปฏิเสธด้วยข้อความเดิม ไม่ลงรายการบางส่วน', async () => {
      // รับเงิน 20 ส.ค. 2569 (ก่อนครบกำหนด 12 ต.ค.) → 2A บางส่วนลงวันที่รับเงิน ซึ่งงวด ส.ค. ปิดแล้ว
      // (period_grace_days = 0 และวันนี้เลย 31 ส.ค. แล้ว)
      const { tmpl, tx, createAndPost } = build({ periodStatus: 'CLOSED' });
      const receiptAug = new Date('2026-08-20T03:00:00.000Z');

      await expect(
        tmpl.accrueAtReceipt('inst-3', receiptAug, tx as never, dec('1000')),
      ).rejects.toThrow(
        'ไม่สามารถรับชำระงวด #3 ได้ — ระบบต้องตั้งลูกหนี้งวดนี้ในงวดบัญชีเดือน 08/2569 ซึ่งปิดแล้ว ' +
          'กรุณาติดต่อฝ่ายบัญชีเพื่อขอเปิดงวดบัญชีเดือนดังกล่าว เมื่อเปิดงวดแล้วจึงบันทึกรับชำระอีกครั้ง',
      );
      expect(createAndPost).not.toHaveBeenCalled();
      expect(tx.installmentSchedule.update).not.toHaveBeenCalled();
    });
  });
});
