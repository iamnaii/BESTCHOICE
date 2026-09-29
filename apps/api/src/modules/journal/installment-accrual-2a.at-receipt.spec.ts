import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
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
  }) {
    const inst = {
      id: 'inst-3',
      installmentNo: opts.installmentNo ?? 3,
      contractId: contract.id,
      dueDate: opts.dueDate ?? DUE_12_OCT,
      accrualJournalEntryId: opts.accrualJournalEntryId ?? null,
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

  it('รับเงินก่อนครบกำหนด → ลง 2A เต็มงวด ลงวันที่รับเงิน พร้อม trigger/receiptDate', async () => {
    const { tmpl, tx, createAndPost } = build({});

    const out = await tmpl.accrueAtReceipt('inst-3', RECEIPT_29_SEP, tx as never);

    expect(out).toEqual({ entryNo: 'JE-202609-00077', postedAt: RECEIPT_29_SEP });
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
    expect(tx.installmentSchedule.update).toHaveBeenCalledWith({
      where: { id: 'inst-3' },
      data: { accrualJournalEntryId: 'JE-202609-00077' },
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
});
