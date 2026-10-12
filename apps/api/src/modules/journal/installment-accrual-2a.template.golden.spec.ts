import { Decimal } from '@prisma/client/runtime/library';
import { ledgerLines } from './__tests__/ledger-lines-mock';
import { InstallmentAccrual2ATemplate } from './cpa-templates/installment-accrual-2a.template';

/**
 * Fast (mock-based, NO DB) golden for InstallmentAccrual2ATemplate — pins that
 * the per-installment legs come from the shared computeInstallmentBreakdown
 * (1416.66 / 500.00 / 99.17 for 17K/12M) AND that the LAST-installment residual
 * true-up still absorbs the rounding remainder (1416.74 / 99.13 / 500.00).
 *
 * Mirrors the DB-backed vitest golden installment-accrual-2a.template.spec.ts.
 */
describe('InstallmentAccrual2ATemplate.execute (golden · mock-based)', () => {
  const dec = (v: string | number) => new Decimal(v);

  const contract = {
    id: 'contract-2a-1',
    contractNumber: 'CT-2A-001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
    advanceBalance: dec('0'), // skip the advance-consume sub-flow
  };

  type CapturedLine = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
  type CapturedJe = { metadata?: Record<string, unknown>; lines: CapturedLine[] };

  let createAndPost: jest.Mock;
  let tmpl: InstallmentAccrual2ATemplate;
  let scheduleUpdate: jest.Mock;
  let paymentUpdate: jest.Mock;
  let contractUpdate: jest.Mock;

  /** เงินรับล่วงหน้า / ถังพัก + แถว Payment + ใบรับชำระก่อนหน้า (ยอด Cr 11-2103) ของงวด */
  type AdvanceFixture = {
    advanceBalance?: string;
    rescheduleAdvanceBalance?: string;
    payment: { amountDue: string; amountPaid: string };
    priorReceiptCredits: string[];
    /** PR4: ยอดในบัญชีของสัญญา (glContractBalance → journalLine.findMany) */
    ledger?: Record<string, string>;
    /** PR4: metadata ของรายการของสัญญา (advanceVatOutstanding) */
    stamps?: Record<string, unknown>[];
  };

  const buildFor = (
    installmentNo: number,
    accrued?: { amount: string; vat: string; interest: string },
    advance?: AdvanceFixture,
  ) => {
    createAndPost = jest
      .fn()
      .mockResolvedValueOnce({ id: 'je-2a', entryNumber: 'JE-2A-0001' })
      .mockResolvedValue({ id: 'je-consume', entryNumber: 'JE-2B-0002' });
    scheduleUpdate = jest.fn().mockResolvedValue({});
    paymentUpdate = jest.fn().mockResolvedValue({});
    contractUpdate = jest.fn().mockResolvedValue({});
    const inst = {
      id: `inst-2a-${installmentNo}`,
      installmentNo,
      contractId: contract.id,
      dueDate: new Date('2026-01-01'),
      accrualJournalEntryId: null as string | null,
      // คอลัมน์ยอดสะสมมีทุกแถวจริง (ค่าเริ่มต้น 0) — accruedSoFarOf ไม่อ่านช่องที่หายเป็น 0
      accruedAmount: dec(accrued?.amount ?? '0'),
      accruedVat: dec(accrued?.vat ?? '0'),
      accruedInterest: dec(accrued?.interest ?? '0'),
    };
    const contractRow = {
      ...contract,
      advanceBalance: dec(advance?.advanceBalance ?? '0'),
      rescheduleAdvanceBalance: dec(advance?.rescheduleAdvanceBalance ?? '0'),
    };
    // $transaction must pass the tx client into the callback. We use the same
    // prisma stub as the tx so the mock calls resolve correctly.
    const prismaStub: Record<string, unknown> = {
      installmentSchedule: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(inst),
        update: scheduleUpdate,
      },
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(contractRow),
        update: contractUpdate,
      },
      journalEntry: {
        // ยังไม่เคยมีรายการ 2A ของงวดนี้ → reference เดิม (id ของแถวตารางงวด)
        findFirst: jest.fn().mockResolvedValue(null),
        // reconstructPriorCleared — ใบรับชำระก่อนหน้าของงวด · PR4: advanceVatOutstanding ค้นด้วย metadata.contractId
        findMany: jest.fn().mockImplementation(async (args: { where?: { metadata?: { path?: string[] } } }) => {
          if (args?.where?.metadata?.path?.[0] === 'contractId') {
            return (advance?.stamps ?? []).map((metadata) => ({ metadata }));
          }
          return (advance?.priorReceiptCredits ?? []).map((credit) => ({
            metadata: { tag: 'receipt', installmentScheduleId: inst.id },
            lines: [{ accountCode: '11-2103', debit: '0', credit }],
          }));
        }),
      },
      journalLine: { findMany: jest.fn(ledgerLines(advance?.ledger ?? {})) },
      payment: {
        findFirst: jest.fn().mockResolvedValue(
          advance
            ? {
                id: `pay-${installmentNo}`,
                amountDue: dec(advance.payment.amountDue),
                amountPaid: dec(advance.payment.amountPaid),
                lateFee: dec('0'),
                lateFeeWaived: false,
              }
            : null,
        ),
        update: paymentUpdate,
      },
    };
    prismaStub.$transaction = jest.fn().mockImplementation(
      (cb: (tx: unknown) => Promise<unknown>) => cb(prismaStub),
    );
    const journal = { createAndPost } as unknown;
    tmpl = new InstallmentAccrual2ATemplate(journal as never, prismaStub as never);
    return inst;
  };

  const run = async (
    installmentNo: number,
    accrued?: { amount: string; vat: string; interest: string },
    advance?: AdvanceFixture,
  ) => {
    const inst = buildFor(installmentNo, accrued, advance);
    await tmpl.execute(inst.id);
    return createAndPost.mock.calls[0][0] as CapturedJe;
  };
  const lineFor = (je: CapturedJe, code: string) => je.lines.find((l) => l.accountCode === code);
  const balanced = (je: CapturedJe) => {
    const dr = je.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const cr = je.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    return dr.toFixed(2) === cr.toFixed(2);
  };

  it('normal installment → base legs 1416.66 / 500.00 / 99.17 (installmentTotal 1515.83)', async () => {
    const je = await run(1);
    expect(lineFor(je, '11-2103')!.dr.toFixed(2)).toBe('1515.83'); // installmentTotal
    expect(lineFor(je, '21-2102')!.dr.toFixed(2)).toBe('99.17');
    expect(lineFor(je, '11-2106')!.dr.toFixed(2)).toBe('500.00');
    expect(lineFor(je, '11-2101')!.cr.toFixed(2)).toBe('1416.66');
    expect(lineFor(je, '11-2105')!.cr.toFixed(2)).toBe('99.17');
    expect(lineFor(je, '41-1101')!.cr.toFixed(2)).toBe('500.00');
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('99.17');
    expect(balanced(je)).toBe(true);
    expect((je.metadata as Record<string, string>).tag).toBe('2A');
  });

  it('LAST installment → residual true-up: 1416.74 / 99.13 / 500.00 (installmentTotal 1515.87)', async () => {
    const je = await run(12);
    // installmentExclVat = 17000 − 1416.66×11 = 1416.74
    expect(lineFor(je, '11-2101')!.cr.toFixed(2)).toBe('1416.74');
    // vatPerInst = 1190 − 99.17×11 = 99.13
    expect(lineFor(je, '21-2102')!.dr.toFixed(2)).toBe('99.13');
    expect(lineFor(je, '11-2105')!.cr.toFixed(2)).toBe('99.13');
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('99.13');
    // interestPerInst = 6000 − 500×11 = 500.00
    expect(lineFor(je, '41-1101')!.cr.toFixed(2)).toBe('500.00');
    expect(lineFor(je, '11-2106')!.dr.toFixed(2)).toBe('500.00');
    // installmentTotal = 1416.74 + 99.13 = 1515.87
    expect(lineFor(je, '11-2103')!.dr.toFixed(2)).toBe('1515.87');
    expect(balanced(je)).toBe(true);
  });
  it('งวดที่ใบรับชำระบางส่วนตั้งไปแล้ว 1,000 (ก1) → รอบกลางคืนตั้งส่วนที่เหลือ 515.83 / 482.08 / 33.75 / 170.15 ลงวันครบกำหนด และประทับลิงก์', async () => {
    const je = await run(3, { amount: '1000.00', vat: '65.42', interest: '329.85' });

    expect(lineFor(je, '11-2103')!.dr.toFixed(2)).toBe('515.83');
    expect(lineFor(je, '21-2102')!.dr.toFixed(2)).toBe('33.75');
    expect(lineFor(je, '11-2106')!.dr.toFixed(2)).toBe('170.15');
    expect(lineFor(je, '11-2101')!.cr.toFixed(2)).toBe('482.08');
    expect(lineFor(je, '11-2105')!.cr.toFixed(2)).toBe('33.75');
    expect(lineFor(je, '41-1101')!.cr.toFixed(2)).toBe('170.15');
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('33.75');
    expect(balanced(je)).toBe(true);
    expect((je.metadata as Record<string, string>).portion).toBe('remainder');
    expect((je.metadata as Record<string, string>).trigger).toBeUndefined();
    const { where, data } = scheduleUpdate.mock.calls[0][0] as {
      where: { accruedAmount: Decimal };
      data: Record<string, Decimal | string>;
    };
    expect(where.accruedAmount.toFixed(2)).toBe('1000.00');
    expect((data.accruedAmount as Decimal).toFixed(2)).toBe('1515.83');
    expect(data.accrualJournalEntryId).toBe('JE-2A-0001');
  });

  // คำตัดสินผู้คุมงาน 2026-09-30 (B5): เพดานการหักเงินรับล่วงหน้า = min(ยอดค้างบนแถว Payment,
  // ยอดลูกหนี้ของงวดที่ยังไม่ถูกล้างในบัญชี) — ยอดเรียกเก็บปัดเลขกลม 1,516.00 ต้องไม่ทำให้ล้างเกิน 1,515.83
  it('ยอดเรียกเก็บ 1,516.00 รับไว้ 1,000 ก่อนครบกำหนด ลูกค้ามีเงินรับล่วงหน้า 2,000 → รอบกลางคืนหัก 515.83 (ไม่ใช่ 516.00) แถวงวดค้าง 0.17', async () => {
    await run(3, { amount: '1000.00', vat: '65.42', interest: '329.85' }, {
      advanceBalance: '2000',
      payment: { amountDue: '1516.00', amountPaid: '1000.00' },
      priorReceiptCredits: ['1000.00'],
    });

    expect(createAndPost).toHaveBeenCalledTimes(2);
    const consume = createAndPost.mock.calls[1][0] as CapturedJe;
    expect((consume.metadata as Record<string, string>).flow).toBe('advance-consume-on-accrual');
    expect(lineFor(consume, '21-1103')!.dr.toFixed(2)).toBe('515.83');
    expect(lineFor(consume, '11-2103')!.cr.toFixed(2)).toBe('515.83');
    expect(contractUpdate).toHaveBeenCalledWith({
      where: { id: contract.id },
      data: { advanceBalance: { decrement: expect.any(Decimal) } },
    });
    const decrement = (contractUpdate.mock.calls[0][0] as {
      data: { advanceBalance: { decrement: Decimal } };
    }).data.advanceBalance.decrement;
    expect(decrement.toFixed(2)).toBe('515.83');
    const paid = paymentUpdate.mock.calls[0][0] as {
      data: { amountPaid: Decimal; status: string };
    };
    expect(paid.data.amountPaid.toFixed(2)).toBe('1515.83');
    expect(paid.data.status).toBe('PARTIALLY_PAID'); // ค้าง 0.17 ของยอดเรียกเก็บ
  });

  it('งวดสุดท้าย: ยอดเรียกเก็บ 1,516.00 รับไว้ 1,000 มีเงินพักค่าปรับดิว 1,000 → รอบกลางคืนหักถังพัก 515.87 (ไม่ใช่ 516.00)', async () => {
    await run(12, { amount: '1000.00', vat: '65.42', interest: '329.83' }, {
      rescheduleAdvanceBalance: '1000',
      payment: { amountDue: '1516.00', amountPaid: '1000.00' },
      priorReceiptCredits: ['1000.00'],
    });

    expect(createAndPost).toHaveBeenCalledTimes(2);
    const park = createAndPost.mock.calls[1][0] as CapturedJe;
    expect((park.metadata as Record<string, string>).flow).toBe('reschedule-park-consume');
    expect(lineFor(park, '21-1103')!.dr.toFixed(2)).toBe('515.87');
    expect(lineFor(park, '11-2103')!.cr.toFixed(2)).toBe('515.87');
    const paid = paymentUpdate.mock.calls[0][0] as {
      data: { amountPaid: Decimal; status: string };
    };
    expect(paid.data.amountPaid.toFixed(2)).toBe('1515.87');
    expect(paid.data.status).toBe('PARTIALLY_PAID');
  });

  // PR4 ต3(ข)/ต4/ต5 — ขากลับของรอบกลางคืน: ถังรวม + ถังพัก · ใบสุดท้ายรับเศษ · stamp
  it('G2 งวดสุดท้าย หักเงินพัก 1,419 (ถังหมด · ยังค้าง 92.83) → รายการพักมี Dr 21-2101 / Cr 21-2102 92.83 + stamp · 2A ยังลงภาษีเต็มงวด 99.13', async () => {
    await run(12, undefined, {
      rescheduleAdvanceBalance: '1419',
      payment: { amountDue: '1515.87', amountPaid: '0' },
      priorReceiptCredits: [],
      ledger: { '21-1103': '1419.00' },
      stamps: [{ advanceVatPark: '92.83' }],
    });
    expect(createAndPost).toHaveBeenCalledTimes(2);
    const core = createAndPost.mock.calls[0][0] as CapturedJe;
    expect(lineFor(core, '21-2101')!.cr.toFixed(2)).toBe('99.13');
    expect((core.metadata as Record<string, unknown>).advanceVatConsume).toBeUndefined();
    const park = createAndPost.mock.calls[1][0] as CapturedJe;
    expect((park.metadata as Record<string, string>).flow).toBe('reschedule-park-consume');
    expect(lineFor(park, '21-1103')!.dr.toFixed(2)).toBe('1419.00');
    expect(lineFor(park, '21-2101')!.dr.toFixed(2)).toBe('92.83');
    expect(lineFor(park, '21-2102')!.cr.toFixed(2)).toBe('92.83');
    expect((park.metadata as Record<string, string>).advanceVatConsume).toBe('92.83');
    expect(balanced(park)).toBe(true);
  });

  it('G3 ถังรวม 500 หักเข้างวด 250 (ถังไม่หมด) → ขากลับ 16.36 · รอบถัดไปหัก 250 ที่เหลือ (ค้าง 16.35) → 16.35 ไม่ใช่ 16.36', async () => {
    await run(3, { amount: '1265.83', vat: '82.82', interest: '417.42' }, {
      advanceBalance: '500',
      payment: { amountDue: '1515.83', amountPaid: '1265.83' },
      priorReceiptCredits: ['1265.83'],
      ledger: { '21-1103': '500.00' },
      stamps: [{ advanceVatPark: '32.71' }],
    });
    const first = createAndPost.mock.calls[1][0] as CapturedJe;
    expect(lineFor(first, '21-1103')!.dr.toFixed(2)).toBe('250.00');
    expect(lineFor(first, '21-2101')!.dr.toFixed(2)).toBe('16.36');
    expect((first.metadata as Record<string, string>).advanceVatConsume).toBe('16.36');

    await run(4, { amount: '1265.83', vat: '82.82', interest: '417.42' }, {
      advanceBalance: '250',
      payment: { amountDue: '1515.83', amountPaid: '1265.83' },
      priorReceiptCredits: ['1265.83'],
      ledger: { '21-1103': '250.00' },
      stamps: [{ advanceVatPark: '32.71' }, { advanceVatConsume: '16.36' }],
    });
    const second = createAndPost.mock.calls[1][0] as CapturedJe;
    expect(lineFor(second, '21-1103')!.dr.toFixed(2)).toBe('250.00');
    expect(lineFor(second, '21-2101')!.dr.toFixed(2)).toBe('16.35');
    expect((second.metadata as Record<string, string>).advanceVatConsume).toBe('16.35');
    expect(balanced(second)).toBe(true);
  });

  it('งวดสุดท้ายที่หักทั้งถังรวม 300 และถังพัก (ถังยังไม่หมด) → ขากลับทีละรายการตามยอดที่ออก 19.63 / 79.54 ไม่กินเกินยังค้าง', async () => {
    await run(12, undefined, {
      advanceBalance: '300',
      rescheduleAdvanceBalance: '1419',
      payment: { amountDue: '1515.87', amountPaid: '0' },
      priorReceiptCredits: [],
      ledger: { '21-1103': '1719.00' },
      stamps: [{ advanceVatPark: '92.83' }, { advanceVatPark: '19.63' }],
    });
    expect(createAndPost).toHaveBeenCalledTimes(3);
    const generic = createAndPost.mock.calls[1][0] as CapturedJe;
    const park = createAndPost.mock.calls[2][0] as CapturedJe;
    expect((generic.metadata as Record<string, string>).flow).toBe('advance-consume-on-accrual');
    expect(lineFor(generic, '21-1103')!.dr.toFixed(2)).toBe('300.00');
    expect(lineFor(generic, '21-2101')!.dr.toFixed(2)).toBe('19.63');
    expect((generic.metadata as Record<string, string>).advanceVatConsume).toBe('19.63');
    expect((park.metadata as Record<string, string>).flow).toBe('reschedule-park-consume');
    expect(lineFor(park, '21-1103')!.dr.toFixed(2)).toBe('1215.87');
    expect(lineFor(park, '21-2101')!.dr.toFixed(2)).toBe('79.54');
    expect((park.metadata as Record<string, string>).advanceVatConsume).toBe('79.54');
    // คอลัมน์/แถวงวดยังเดินเหมือนเดิม: ถังรวม −300 · ถังพัก −1,215.87 · amountPaid 1,515.87 PAID
    const paid = paymentUpdate.mock.calls[paymentUpdate.mock.calls.length - 1][0] as {
      data: { amountPaid: Decimal; status: string };
    };
    expect(paid.data.amountPaid.toFixed(2)).toBe('1515.87');
    expect(paid.data.status).toBe('PAID');
  });

  it('ไม่มีเงินรับล่วงหน้าและไม่มีถังพัก → ไม่อ่านใบรับชำระก่อนหน้าเลย (ไม่มีคำค้นเพิ่มในรอบกลางคืนปกติ)', async () => {
    buildFor(5);
    const inst5 = 'inst-2a-5';
    await tmpl.execute(inst5);
    const stub = (tmpl as unknown as { prisma: { journalEntry: { findMany: jest.Mock } } }).prisma;
    expect(stub.journalEntry.findMany).not.toHaveBeenCalled();
    expect(createAndPost).toHaveBeenCalledTimes(1);
  });
});
