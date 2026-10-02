import { consumePaymentApproval } from '../payments/services/payment-approval-request.util';
jest.mock('../payments/services/payment-approval-request.util', () => ({
  ...jest.requireActual('../payments/services/payment-approval-request.util'),
  consumePaymentApproval: jest.fn(),
}));
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import { ContractPaymentService } from './contract-payment.service';
import { EarlyPayoffDto } from './dto/contract.dto';
import { ledgerLines } from '../journal/__tests__/ledger-lines-mock';

/**
 * PR5ข — ปิดยอดก่อนกำหนดหักเงินรับล่วงหน้าถังรวม (`Contract.advanceBalance` · 21-1103 — ลูกค้าจ่ายเกินงวดก่อน รอหักงวดถัดไป)
 * แบบเดียวกับเงินพักค่าปรับดิว (เจ้าของเคาะ 01/10/2569 · กติกาเจ้าของ 23/09: หักก่อนคิดส่วนลด + ลดต้นทุนตามสัดส่วน) ผ่าน
 * ContractPaymentService จริง (preview `getEarlyPayoffQuote` + รายการที่ลง `earlyPayoff`):
 *   - ยอดปิดหักถังรวม · JP4 ลง Dr 21-1103 บรรทัดของถังรวม (ไม่มีคำอธิบาย) แยกจากบรรทัดเงินพัก · preview === posted
 *   - คอลัมน์ถังรวมลดเท่าบรรทัดที่ลง (ส่วนที่ยอดปิดหักไม่หมดคงค้าง = ยอดในบัญชี)
 *   - คำขออนุมัติที่ส่งก่อน PR5ข (quote เดิมไม่มี `advanceBalanceApplied`) → 409 ข้อความเดิม
 *
 * Fixture: สัญญาตัวอย่างของฝ่ายบัญชี 17,000/12 งวดละ 1,515.83 (ขายสด 12,000 ดาวน์ 2,000 ค่าคอม 1,000 · ดอกเบี้ย 6,000
 * VAT 1,190) ยังไม่จ่ายเลย — ยอดในบัญชีหลังรายการเปิดสัญญา 11-2101 17,000.00 · 11-2105 1,190.00 · 11-2106 6,000.00 ·
 * 21-2102 1,190.00 + เงินของลูกค้าตามคอลัมน์ (21-1103 = ถังรวม + ถังพัก · 21-5101 = เครดิต) เว้นแต่เทสจะกำหนดเอง
 */
const OPENED = {
  '11-2101': '17000.00',
  '11-2105': '1190.00',
  '11-2106': '6000.00',
  '21-2102': '1190.00',
};

describe('ContractPaymentService — ปิดยอดหักเงินรับล่วงหน้าถังรวมแบบเงินพักค่าปรับดิว (PR5ข)', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  const makeContract = (cols: { credit: string; advance: string; park: string }) => ({
    id: 'contract-ep-advance-1',
    contractNumber: 'CT-EP-ADVANCE-001',
    status: 'ACTIVE',
    deletedAt: null,
    productId: 'product-ep-advance-1',
    totalMonths: 12,
    monthlyPayment: dec('1515.83'),
    creditBalance: dec(cols.credit),
    advanceBalance: dec(cols.advance),
    rescheduleAdvanceBalance: dec(cols.park),
    vatPct: dec('0.07'),
    sellingPrice: dec('12000'),
    downPayment: dec('2000'),
    storeCommission: dec('1000'),
    financedAmount: dec('17000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190.00'),
    payments: Array.from({ length: 12 }, (_, i) => ({
      installmentNo: i + 1,
      status: 'PENDING',
      amountPaid: dec('0'),
      amountDue: dec('1515.83'),
      lateFee: dec('0'),
      lateFeeWaived: false,
    })),
  });

  type CapturedLine = {
    accountCode: string;
    dr: Prisma.Decimal;
    cr: Prisma.Decimal;
    description: string;
  };
  type CapturedJe = { metadata: Record<string, unknown>; lines: CapturedLine[] };

  const build = (
    opts: {
      credit?: string;
      advance?: string;
      park?: string;
      /** ยอดในบัญชีของสัญญา (ไม่ส่ง = รายการเปิดสัญญา + เงินของลูกค้าเท่าคอลัมน์) */
      ledger?: Record<string, string>;
    } = {},
  ) => {
    const cols = {
      credit: opts.credit ?? '0',
      advance: opts.advance ?? '0',
      park: opts.park ?? '0',
    };
    const contract = makeContract(cols);
    const ledger = ledgerLines(
      opts.ledger ?? {
        ...OPENED,
        '21-1103': dec(cols.advance).plus(cols.park).toFixed(2),
        '21-5101': dec(cols.credit).toFixed(2),
      },
    );
    const schedules = Array.from({ length: 12 }, (_, i) => ({ installmentNo: i + 1 }));
    const contractUpdates: Array<Record<string, unknown>> = [];
    const auditRows: Array<Record<string, unknown>> = [];
    const paymentUpdates: Array<Record<string, unknown>> = [];
    const createAndPost = jest
      .fn()
      .mockResolvedValue({ id: 'je-ep-advance', entryNumber: 'JE-EP-ADVANCE-0001' });

    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(contract),
        findUniqueOrThrow: jest.fn().mockResolvedValue(contract),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          contractUpdates.push(data);
          return Promise.resolve({ productId: contract.productId });
        }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 12 }, (_, i) => ({
            id: `pay-${i + 1}`,
            installmentNo: i + 1,
            status: 'PENDING',
            amountDue: dec('1515.83'),
            amountPaid: dec('0'),
            lateFee: dec('0'),
            lateFeeWaived: false,
            evidenceUrl: null,
            gatewayRef: null,
          })),
        ),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          paymentUpdates.push(data);
          return Promise.resolve({});
        }),
      },
      auditLog: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          auditRows.push(data);
          return Promise.resolve(data);
        }),
      },
      installmentSchedule: { findMany: jest.fn().mockResolvedValue(schedules) },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: { findMany: jest.fn(ledger) },
      badDebtProvision: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      installmentSchedule: { findMany: jest.fn().mockResolvedValue(schedules) },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: { findMany: jest.fn(ledger) },
      companyInfo: {
        findFirst: jest
          .fn()
          .mockImplementation((args: { where: { companyCode: string } }) =>
            Promise.resolve({ id: `co-${args.where.companyCode}` }),
          ),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };

    const service = new ContractPaymentService(
      prisma as never,
      { transferOwnership: jest.fn().mockResolvedValue(undefined) } as never,
      { createAndPost } as never,
      {} as never,
      {} as never,
      { generateReceipt: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-ECL-1' }) } as never,
    );
    return { service, createAndPost, contractUpdates, auditRows, paymentUpdates };
  };

  const sig = (je: CapturedJe) =>
    je.lines.map((l) => `${l.accountCode}:${l.dr.toFixed(2)}:${l.cr.toFixed(2)}`);
  const previewSig = (quote: Awaited<ReturnType<ContractPaymentService['getEarlyPayoffQuote']>>) =>
    quote.journalPreview.lines.map((l) => `${l.accountCode}:${l.debit}:${l.credit}`);
  const decrementOf = (updates: Array<Record<string, unknown>>, column: string) =>
    updates
      .filter((u) => column in u)
      .map((u) => (u[column] as { decrement: Prisma.Decimal }).decrement.toFixed(2));
  const baseDto: EarlyPayoffDto = { paymentMethod: 'CASH' };
  const ID = 'contract-ep-advance-1';

  beforeEach(() => {
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it('ตัวอย่างที่เจ้าของเคาะ — เครดิต 300 + ถังรวม 500 (ส่วนลด 50%) → ยอดปิด 14,612.63 (เดิม 15,030.17) · Dr 21-1103 500.00 ไม่มีคำอธิบาย · Dr 21-5101 300.00 · 52-1106 2,777.37 · ถังรวมลด 500.00 · preview === posted', async () => {
    const h = build({ credit: '300', advance: '500' });
    const quote = await h.service.getEarlyPayoffQuote(ID);
    expect(quote.totalRemaining).toBe(18189.96);
    expect(quote.advancePayment).toBe(300);
    expect(quote.rescheduleAdvanceApplied).toBe(0);
    expect(quote.advanceBalanceApplied).toBe(500);
    expect(quote.remainingBalance).toBe(17389.96);
    expect(quote.remainingCost).toBe(10697.64);
    expect(quote.discountAmount).toBe(2777.33);
    expect(quote.totalPayoff).toBe(14612.63);
    const previewAdvance = quote.journalPreview.lines.find((l) => l.accountCode === '21-1103');
    expect(previewAdvance).toMatchObject({ debit: '500.00', description: '' });
    expect(quote.journalPreview.isBalanced).toBe(true);

    await approvedEarlyPayoff(h.service, ID, 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(sig(je)).toEqual([
      '11-1201:14612.63:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:2777.37:0.00',
      '21-1103:500.00:0.00',
      '21-5101:300.00:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
    ]);
    expect(previewSig(quote)).toEqual(sig(je));
    expect(je.lines.find((l) => l.accountCode === '21-1103')!.description).toBe('');
    expect(je.metadata).toMatchObject({
      cashReceived: '14612.63',
      receivableCleared: '18190.00',
      discount: '2777.37',
      quoteDiscountAmount: '2777.33',
      advanceRelief: '500.00',
      creditRelief: '300.00',
    });
    expect(je.metadata.parkRelief).toBeUndefined();
    // เงินที่รับกระจายลงแถวงวดเท่ายอดปิด
    expect(
      h.paymentUpdates.reduce((s, u) => s.plus(u.amountPaid as Prisma.Decimal), dec(0)).toFixed(2),
    ).toBe('14612.63');
    expect(decrementOf(h.contractUpdates, 'advanceBalance')).toEqual(['500.00']);
    expect(decrementOf(h.contractUpdates, 'rescheduleAdvanceBalance')).toEqual([]);
    expect(h.contractUpdates).toContainEqual(
      expect.objectContaining({ status: 'EARLY_PAYOFF', creditBalance: 0 }),
    );
    expect(h.auditRows.map((r) => r.action)).not.toContain('RESCHEDULE_ADVANCE_CONSUMED');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('เงินพัก 354 + ถังรวม 500 → หักเงินพักก่อน: Dr 21-1103 สองบรรทัด (เงินพักคำอธิบายเดิม · ถังรวมไม่มีคำอธิบาย) · ถังพักลด 354 + audit เดิม · ถังรวมลด 500', async () => {
    const h = build({ advance: '500', park: '354' });
    const quote = await h.service.getEarlyPayoffQuote(ID);
    expect(quote.rescheduleAdvanceApplied).toBe(354);
    expect(quote.advanceBalanceApplied).toBe(500);
    expect(quote.totalPayoff).toBe(14476.83);
    expect(
      quote.journalPreview.lines
        .filter((l) => l.accountCode === '21-1103')
        .map((l) => [l.debit, l.description]),
    ).toEqual([
      ['354.00', 'หักเงินพักปรับดิว 354.00'],
      ['500.00', ''],
    ]);

    await approvedEarlyPayoff(h.service, ID, 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(
      je.lines
        .filter((l) => l.accountCode === '21-1103')
        .map((l) => [l.dr.toFixed(2), l.description]),
    ).toEqual([
      ['354.00', 'หักเงินพักปรับดิว (ปิดสัญญาก่อนกำหนด)'],
      ['500.00', ''],
    ]);
    expect(je.lines.find((l) => l.accountCode === '52-1106')!.dr.toFixed(2)).toBe('2859.17');
    expect(previewSig(quote)).toEqual(sig(je));
    expect(je.metadata).toMatchObject({ parkRelief: '354.00', advanceRelief: '500.00' });
    expect(decrementOf(h.contractUpdates, 'rescheduleAdvanceBalance')).toEqual(['354.00']);
    expect(decrementOf(h.contractUpdates, 'advanceBalance')).toEqual(['500.00']);
    expect(h.auditRows.find((r) => r.action === 'RESCHEDULE_ADVANCE_CONSUMED')!.newValue).toEqual({
      parkRelief: '354.00',
      beforeParkBalance: '354.00',
      afterParkBalance: '0.00',
      source: 'EARLY_PAYOFF_PARK_RELIEF',
    });
  });

  it('ถังรวม 50,000 ใหญ่กว่ายอดค้าง → ยอดปิด 0.00 · Dr 21-1103 18,189.96 · 52-1106 0.04 · ถังรวมลด 18,189.96 (เหลือ 31,810.04 = ยอดในบัญชี) · ไม่มีสัญญาณ', async () => {
    const h = build({ advance: '50000' });
    const quote = await h.service.getEarlyPayoffQuote(ID);
    expect(quote.totalPayoff).toBe(0);
    expect(quote.advanceBalanceApplied).toBe(18189.96);
    expect(quote.discountAmount).toBe(0);

    await approvedEarlyPayoff(h.service, ID, 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(sig(je)).toEqual([
      '11-1201:0.00:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:0.04:0.00',
      '21-1103:18189.96:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
    ]);
    expect(decrementOf(h.contractUpdates, 'advanceBalance')).toEqual(['18189.96']);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('คอลัมน์ถังรวม 500 แต่ 21-1103 ในบัญชีไม่มียอด → ยอดปิดหัก 500 (14,772.45) · ไม่มีบรรทัด 21-1103 · 52-1106 3,417.55 · คอลัมน์ไม่ลด · สัญญาณเตือนสองตัวหลัง commit', async () => {
    const h = build({ advance: '500', ledger: OPENED });
    await approvedEarlyPayoff(h.service, ID, 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(je.lines[0].dr.toFixed(2)).toBe('14772.45');
    expect(je.lines.find((l) => l.accountCode === '21-1103')).toBeUndefined();
    // 18,190.00 − 14,772.45 = 3,417.55 (ส่วนลดบนจอ 2,917.51 + ถังรวมที่ไม่มีในบัญชี 500.00 + เศษ 0.04)
    expect(je.lines.find((l) => l.accountCode === '52-1106')!.dr.toFixed(2)).toBe('3417.55');
    expect(je.metadata.advanceRelief).toBeUndefined();
    expect(decrementOf(h.contractUpdates, 'advanceBalance')).toEqual([]);
    expect((Sentry.captureMessage as jest.Mock).mock.calls.map(([, c]) => c.tags.action)).toEqual([
      'close-advance-ledger-mismatch',
      'early-payoff-discount-vs-quote',
    ]);
    expect((Sentry.captureMessage as jest.Mock).mock.calls[1][1].extra).toMatchObject({
      difference: '500.04',
      advanceRelief: '0.00',
    });
  });

  it('คำขออนุมัติที่ส่งก่อน PR5ข (quote เดิมไม่มี advanceBalanceApplied) → 409 "ยอดปิดสัญญาเปลี่ยนแล้ว กรุณาส่งขออนุมัติใหม่" · ไม่ลงรายการ', async () => {
    const h = build();
    const requested = await h.service.getEarlyPayoffQuote(ID);
    const { advanceBalanceApplied, ...beforePr5b } = JSON.parse(JSON.stringify(requested));
    expect(advanceBalanceApplied).toBe(0);
    (consumePaymentApproval as jest.Mock).mockReset();
    (consumePaymentApproval as jest.Mock).mockResolvedValueOnce({
      requestedById: 'user-1',
      approverId: 'test-approver',
      payload: baseDto,
      reviewSummary: beforePr5b,
    });

    await expect(
      h.service.earlyPayoff(ID, 'user-1', baseDto, {
        requestId: 'payoff-request',
        actorId: 'test-approver',
      }),
    ).rejects.toThrow('ยอดปิดสัญญาเปลี่ยนแล้ว กรุณาส่งขออนุมัติใหม่');
    expect(h.createAndPost).not.toHaveBeenCalled();
  });
});

/** Money tests run an already-approved action; the kernel's own suites test authority and stale snapshots. */
async function approvedEarlyPayoff(
  service: ContractPaymentService,
  id: string,
  userId: string,
  dto: Parameters<ContractPaymentService['earlyPayoff']>[2],
) {
  (consumePaymentApproval as jest.Mock).mockReset();
  const originalQuote = service.getEarlyPayoffQuote.bind(service);
  let approvedQuote: Awaited<ReturnType<ContractPaymentService['getEarlyPayoffQuote']>>;
  const quoteSpy = jest
    .spyOn(service, 'getEarlyPayoffQuote')
    .mockImplementation(async (...args) => {
      if (args[3]) return approvedQuote;
      const quote = await originalQuote(...args);
      approvedQuote = quote;
      (consumePaymentApproval as jest.Mock).mockResolvedValueOnce({
        requestedById: userId,
        approverId: 'test-approver',
        payload: dto,
        reviewSummary: quote,
      });
      return quote;
    });
  try {
    return await service.earlyPayoff(id, userId, dto, {
      requestId: 'payoff-request',
      actorId: 'test-approver',
    });
  } finally {
    quoteSpy.mockRestore();
  }
}
