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
 * PR5 — ปิดยอดก่อนกำหนด (JP4) ล้างตามยอดในบัญชี (คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 5.1–5.4 · 29/09/2569) ผ่าน
 * ContractPaymentService จริง (preview `getEarlyPayoffQuote` + รายการที่ลง `earlyPayoff`):
 *   - เงินสดในรายการ = เงินที่ลูกค้าจ่าย · 52-1106 = ลูกหนี้ตามบัญชี − เงินที่รับ − เงินของลูกค้าที่หัก
 *   - เงินเกินของลูกค้า 21-5101 = min(คอลัมน์ที่ยอดปิดหักให้, ยอดในบัญชี) (X2) · คอลัมน์ไม่ตรงบัญชี → สัญญาณเตือนหลัง commit
 *   - 52-1106 ต่างจากส่วนลดบนหน้าจอเกิน 1.00 → สัญญาณเตือนหลัง commit
 *   - เงินที่รับ + เงินของลูกค้าที่ยอดปิดหักให้ เกินลูกหนี้ตามบัญชีเกิน 1.00 → ปฏิเสธ (ไม่ลงรายการ)
 *   - คำขออนุมัติเทียบเฉพาะตัวเงินของ quote — รอบตั้งลูกหนี้งวดที่ลงระหว่างส่งคำขอกับอนุมัติไม่ทำให้ต้องส่งใหม่
 *
 * Fixture: สัญญา 12 งวด งวดละ 1,926 (ยอดจัด 18,000 · ค่าคอม 1,800 · ดอกเบี้ย 1,800 · VAT 1,512) จ่ายแล้ว 6 งวด
 * ยอดในบัญชีตั้งต้น 11-2101 10,800.00 · 11-2105 756.00 · 11-2106 900.00 · 21-2102 756.00 (แต่ละเทสปรับได้)
 */
const LEDGER_AFTER_SIX_PAID = {
  '11-2101': '10800.00',
  '11-2105': '756.00',
  '11-2106': '900.00',
  '21-2102': '756.00',
};
/** หลังรอบกลางคืนตั้งลูกหนี้งวด 7 (2A: Dr 11-2103 1,926 / Cr 11-2101 1,800 · 11-2105 126 · ดอกเบี้ย 150 · ภาษี 126) */
const LEDGER_AFTER_NIGHTLY_2A = {
  '11-2101': '9000.00',
  '11-2103': '1926.00',
  '11-2105': '630.00',
  '11-2106': '750.00',
  '21-2102': '630.00',
};

describe('ContractPaymentService — ปิดยอดก่อนกำหนดตามยอดในบัญชี (PR5)', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  const makeContract = (creditBalance: string) => ({
    id: 'contract-ep-ledger-1',
    contractNumber: 'CT-EP-LEDGER-001',
    status: 'ACTIVE',
    deletedAt: null,
    productId: 'product-ep-ledger-1',
    totalMonths: 12,
    monthlyPayment: dec('1926.00'),
    creditBalance: dec(creditBalance),
    advanceBalance: dec('0'),
    rescheduleAdvanceBalance: dec('0'),
    vatPct: dec('0.07'),
    sellingPrice: dec('20000'),
    downPayment: dec('2000'),
    storeCommission: dec('1800'),
    financedAmount: dec('18000'),
    interestTotal: dec('1800'),
    vatAmount: dec('1512.00'),
    payments: [
      ...Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 1,
        status: 'PAID',
        amountPaid: dec('1926.00'),
        amountDue: dec('1926.00'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 7,
        status: 'PENDING',
        amountPaid: dec('0'),
        amountDue: dec('1926.00'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
    ],
  });

  type CapturedLine = { accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal };
  type CapturedJe = { metadata: Record<string, unknown>; lines: CapturedLine[] };

  const build = (
    opts: {
      creditBalance?: string;
      ledger?: Record<string, string>;
      /** ยอดในบัญชีที่ธุรกรรมของการทำรายการเห็น (ไม่ส่ง = ชุดเดียวกับ preview) */
      txLedger?: Record<string, string>;
    } = {},
  ) => {
    const contract = makeContract(opts.creditBalance ?? '0');
    const ledger = ledgerLines(opts.ledger ?? LEDGER_AFTER_SIX_PAID);
    const txLedger = ledgerLines(opts.txLedger ?? opts.ledger ?? LEDGER_AFTER_SIX_PAID);
    const schedules = Array.from({ length: 12 }, (_, i) => ({ installmentNo: i + 1 }));
    const contractUpdates: Array<Record<string, unknown>> = [];
    const auditRows: Array<Record<string, unknown>> = [];
    const events: string[] = [];
    const createAndPost = jest.fn().mockImplementation(() => {
      events.push('createAndPost');
      return Promise.resolve({ id: 'je-ep-ledger', entryNumber: 'JE-EP-LEDGER-0001' });
    });

    const tx = {
      contract: {
        // แถวเต็ม — ใช้ทั้ง quote ในธุรกรรม (findOne) และการตรวจสถานะก่อนลงรายการ
        findUnique: jest.fn().mockResolvedValue(contract),
        findUniqueOrThrow: jest.fn().mockResolvedValue(contract),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          contractUpdates.push(data);
          return Promise.resolve({ productId: contract.productId });
        }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 6 }, (_, i) => ({
            id: `pay-${i + 7}`,
            installmentNo: i + 7,
            status: 'PENDING',
            amountDue: dec('1926.00'),
            amountPaid: dec('0'),
            lateFee: dec('0'),
            lateFeeWaived: false,
            evidenceUrl: null,
            gatewayRef: null,
          })),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          auditRows.push(data);
          return Promise.resolve(data);
        }),
      },
      installmentSchedule: { findMany: jest.fn().mockResolvedValue(schedules) },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: { findMany: jest.fn(txLedger) },
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
      $transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => {
        const r = await cb(tx);
        events.push('commit');
        return r;
      }),
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
    return { service, createAndPost, contractUpdates, auditRows, events, contract };
  };

  const sig = (je: CapturedJe) =>
    je.lines.map((l) => `${l.accountCode}:${l.dr.toFixed(2)}:${l.cr.toFixed(2)}`);
  const previewSig = (quote: Awaited<ReturnType<ContractPaymentService['getEarlyPayoffQuote']>>) =>
    quote.journalPreview.lines.map((l) => `${l.accountCode}:${l.debit}:${l.credit}`);
  const baseDto: EarlyPayoffDto = { paymentMethod: 'CASH' };

  beforeEach(() => {
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it('ข้อ 5.4 / X2: เงินเกินของลูกค้า 500 (ยอดปิดหักแล้ว) → Dr 21-5101 500.00 แทนเงินสด · เงินสด 10,839.65 = เงินที่รับ · 52-1106 216.35 · คอลัมน์ creditBalance = 0', async () => {
    const h = build({
      creditBalance: '500',
      ledger: { ...LEDGER_AFTER_SIX_PAID, '21-5101': '500.00' },
    });
    const quote = await h.service.getEarlyPayoffQuote('contract-ep-ledger-1');
    expect(quote.totalPayoff).toBe(10839.65);
    expect(quote.discountAmount).toBe(216.35);

    await approvedEarlyPayoff(h.service, 'contract-ep-ledger-1', 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(sig(je)).toEqual([
      '11-1201:10839.65:0.00',
      '11-2106:900.00:0.00',
      '21-2102:756.00:0.00',
      '52-1106:216.35:0.00',
      '21-5101:500.00:0.00',
      '11-2101:0.00:10800.00',
      '11-2105:0.00:756.00',
      '41-1101:0.00:900.00',
      '21-2101:0.00:756.00',
    ]);
    expect(je.metadata).toMatchObject({
      creditRelief: '500.00',
      cashReceived: '10839.65',
      receivableCleared: '11556.00',
      quoteDiscountAmount: '216.35',
      discount: '216.35',
    });
    expect(h.contractUpdates).toContainEqual(
      expect.objectContaining({ status: 'EARLY_PAYOFF', creditBalance: 0 }),
    );
    // preview ที่เห็นก่อนกด = รายการที่ลงทุกบรรทัด
    expect(previewSig(quote)).toEqual(sig(je));
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ข้อ 5.1 + 5.2: งวด 7–11 ตั้งลูกหนี้แล้วค้าง (11-2103 9,630.00) เหลือยังไม่ถึงกำหนด 1 งวด → Cr 11-2103 ตามบัญชี · ดอกเบี้ยรับรู้เฉพาะ 150.00 · 52-1106 450.00 เกินฐานข้อ 5.2 (50% × 150.00) อยู่ 375.00 (บันทึกใน metadata) · preview === posted', async () => {
    const h = build({
      ledger: {
        '11-2101': '1800.00',
        '11-2103': '9630.00',
        '11-2105': '126.00',
        '11-2106': '150.00',
        '21-2102': '126.00',
      },
    });
    const quote = await h.service.getEarlyPayoffQuote('contract-ep-ledger-1');
    await approvedEarlyPayoff(h.service, 'contract-ep-ledger-1', 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(sig(je)).toEqual([
      '11-1201:11106.00:0.00',
      '11-2106:150.00:0.00',
      '21-2102:126.00:0.00',
      '52-1106:450.00:0.00',
      '11-2103:0.00:9630.00',
      '11-2101:0.00:1800.00',
      '11-2105:0.00:126.00',
      '41-1101:0.00:150.00',
      '21-2101:0.00:126.00',
    ]);
    expect(je.metadata.discountBeyondDeferredBase).toBe('375.00');
    expect(previewSig(quote)).toEqual(sig(je));
  });

  it('เครดิตในคอลัมน์ 500 แต่ 21-5101 ในบัญชีไม่มียอด → ไม่มีบรรทัด 21-5101 (52-1106 รวม 500 ที่ยอดปิดหักให้) · สัญญาณเตือนสองตัว (คอลัมน์ไม่ตรงบัญชี + 52-1106 ต่างจากส่วนลดบนจอ 500.00) ส่งหลัง commit', async () => {
    const h = build({ creditBalance: '500' });
    (Sentry.captureMessage as jest.Mock).mockImplementation(() => h.events.push('warning'));

    await approvedEarlyPayoff(h.service, 'contract-ep-ledger-1', 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(je.lines.find((l) => l.accountCode === '21-5101')).toBeUndefined();
    // 11,556.00 − 10,839.65 = 716.35 (ส่วนลด 216.35 + เครดิตที่ไม่มีในบัญชี 500.00)
    expect(je.lines.find((l) => l.accountCode === '52-1106')!.dr.toFixed(2)).toBe('716.35');
    expect(je.metadata.creditRelief).toBeUndefined();

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    const [message, context] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(message).toBe(
      '[contract-close] advance/credit columns differ from the ledger cleared at close',
    );
    expect(context).toMatchObject({
      level: 'warning',
      tags: { module: 'journal', action: 'close-advance-ledger-mismatch', flow: 'early-payoff' },
      extra: { contractId: 'contract-ep-ledger-1', ledger21_5101: '0.00', creditBalance: '500.00' },
    });
    const [message2, context2] = (Sentry.captureMessage as jest.Mock).mock.calls[1];
    expect(message2).toBe(
      '[early-payoff] 52-1106 differs from the payoff-screen discount by more than 1.00',
    );
    expect(context2).toMatchObject({
      level: 'warning',
      tags: { module: 'journal', action: 'early-payoff-discount-vs-quote', flow: 'early-payoff' },
      extra: { discount: '716.35', quoteDiscountAmount: '216.35', difference: '500.00' },
    });
    expect(h.events).toEqual(['createAndPost', 'commit', 'warning', 'warning']);
  });

  it('ธุรกรรมล้มหลังอ่านยอด (ลงรายการไม่สำเร็จ) → ไม่ส่งสัญญาณเตือน', async () => {
    const h = build({ creditBalance: '500' });
    h.createAndPost.mockRejectedValueOnce(new Error('db down'));

    await expect(
      approvedEarlyPayoff(h.service, 'contract-ep-ledger-1', 'user-1', baseDto),
    ).rejects.toThrow('db down');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('21-5101 ในบัญชี 2,000 แต่คอลัมน์ 0 (ยอดปิดไม่ได้หักให้) → ไม่หัก · ไม่มีบรรทัด 21-5101 · 52-1106 450.00 = ส่วนลดบนจอ · 2,000 ค้างเป็นเงินของลูกค้า + สัญญาณเตือนคอลัมน์ไม่ตรงบัญชีหลัง commit', async () => {
    const h = build({ ledger: { ...LEDGER_AFTER_SIX_PAID, '21-5101': '2000.00' } });
    const quote = await h.service.getEarlyPayoffQuote('contract-ep-ledger-1');
    expect(quote.journalPreview.isBalanced).toBe(true);

    await approvedEarlyPayoff(h.service, 'contract-ep-ledger-1', 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(sig(je)).toEqual([
      '11-1201:11106.00:0.00',
      '11-2106:900.00:0.00',
      '21-2102:756.00:0.00',
      '52-1106:450.00:0.00',
      '11-2101:0.00:10800.00',
      '11-2105:0.00:756.00',
      '41-1101:0.00:900.00',
      '21-2101:0.00:756.00',
    ]);
    expect(je.metadata.creditRelief).toBeUndefined();
    expect(previewSig(quote)).toEqual(sig(je));
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect((Sentry.captureMessage as jest.Mock).mock.calls[0][1]).toMatchObject({
      tags: { action: 'close-advance-ledger-mismatch', flow: 'early-payoff' },
      extra: { ledger21_5101: '2000.00', creditBalance: '0.00' },
    });
  });

  it('เครดิต 12,000 (คอลัมน์ = บัญชี) มากกว่าลูกหนี้ตามบัญชี 11,556 → ยอดปิด 0.00 · เงินของลูกค้าที่ยอดปิดหักให้เกินหนี้ 444.00 → preview ไม่สมดุล · ปฏิเสธ ไม่ลงรายการ ไม่ปิดสัญญา ไม่ส่งสัญญาณเตือน', async () => {
    const h = build({
      creditBalance: '12000',
      ledger: { ...LEDGER_AFTER_SIX_PAID, '21-5101': '12000.00' },
    });
    const quote = await h.service.getEarlyPayoffQuote('contract-ep-ledger-1');
    expect(quote.totalPayoff).toBe(0);
    expect(quote.journalPreview.isBalanced).toBe(false);
    expect(quote.journalPreview.lines.find((l) => l.accountCode === '52-1106')).toBeUndefined();

    await expect(
      approvedEarlyPayoff(h.service, 'contract-ep-ledger-1', 'user-1', baseDto),
    ).rejects.toThrow('exceed the contract ledger receivable by 444.00 (> 1.00) — not posted');
    expect(h.createAndPost).not.toHaveBeenCalled();
    expect(h.contractUpdates.some((d) => d.status === 'EARLY_PAYOFF')).toBe(false);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ลูกหนี้ในบัญชีมากกว่ายอดค้างตามงวด 1,926.00 (เช่นแถวงวดถูกตั้ง PAID โดยไม่มีรายการรับชำระ) → ลงได้ · 52-1106 2,376.00 · สัญญาณเตือน early-payoff-discount-vs-quote หลัง commit ครั้งเดียว', async () => {
    const h = build({
      ledger: {
        '11-2101': '12600.00',
        '11-2105': '882.00',
        '11-2106': '1050.00',
        '21-2102': '882.00',
      },
    });
    (Sentry.captureMessage as jest.Mock).mockImplementation(() => h.events.push('warning'));

    await approvedEarlyPayoff(h.service, 'contract-ep-ledger-1', 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(je.lines.find((l) => l.accountCode === '52-1106')!.dr.toFixed(2)).toBe('2376.00');
    expect(je.metadata).toMatchObject({ discount: '2376.00', quoteDiscountAmount: '450.00' });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect((Sentry.captureMessage as jest.Mock).mock.calls[0][1]).toMatchObject({
      level: 'warning',
      tags: { module: 'journal', action: 'early-payoff-discount-vs-quote', flow: 'early-payoff' },
      extra: {
        contractId: 'contract-ep-ledger-1',
        discount: '2376.00',
        quoteDiscountAmount: '450.00',
        difference: '1926.00',
      },
    });
    expect(h.events).toEqual(['createAndPost', 'commit', 'warning']);
  });

  it('คำขออนุมัติคร่อมรอบตั้งลูกหนี้งวดกลางคืน (งวด 7 ครบกำหนด) — ตัวเงินของ quote เท่าเดิม → ไม่ต้องส่งใหม่ · รายการที่ลง = ยอดในบัญชีตอนทำรายการ (Cr 11-2103 1,926.00 · ดอกเบี้ย 750.00)', async () => {
    const h = build({ ledger: LEDGER_AFTER_SIX_PAID, txLedger: LEDGER_AFTER_NIGHTLY_2A });
    const requested = await h.service.getEarlyPayoffQuote('contract-ep-ledger-1');
    (consumePaymentApproval as jest.Mock).mockReset();
    (consumePaymentApproval as jest.Mock).mockResolvedValueOnce({
      requestedById: 'user-1',
      approverId: 'test-approver',
      payload: baseDto,
      // คำขอเก็บ quote ตอนส่ง (JSON) — preview ตอนนั้นยังไม่มี 11-2103
      reviewSummary: JSON.parse(JSON.stringify(requested)),
    });

    await h.service.earlyPayoff('contract-ep-ledger-1', 'user-1', baseDto, {
      requestId: 'payoff-request',
      actorId: 'test-approver',
    });
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(sig(je)).toEqual([
      '11-1201:11106.00:0.00',
      '11-2106:750.00:0.00',
      '21-2102:630.00:0.00',
      '52-1106:450.00:0.00',
      '11-2103:0.00:1926.00',
      '11-2101:0.00:9000.00',
      '11-2105:0.00:630.00',
      '41-1101:0.00:750.00',
      '21-2101:0.00:630.00',
    ]);
    expect(previewSig(requested)).not.toEqual(sig(je));
    expect(je.metadata).toMatchObject({ cashReceived: '11106.00', discount: '450.00' });
  });

  it('คำขออนุมัติที่ตัวเงินไม่ตรง quote ตอนทำรายการ → 409 "ยอดปิดสัญญาเปลี่ยนแล้ว กรุณาส่งขออนุมัติใหม่" · ไม่ลงรายการ', async () => {
    const h = build();
    const requested = await h.service.getEarlyPayoffQuote('contract-ep-ledger-1');
    (consumePaymentApproval as jest.Mock).mockReset();
    (consumePaymentApproval as jest.Mock).mockResolvedValueOnce({
      requestedById: 'user-1',
      approverId: 'test-approver',
      payload: baseDto,
      reviewSummary: { ...JSON.parse(JSON.stringify(requested)), totalPayoff: 11000 },
    });

    await expect(
      h.service.earlyPayoff('contract-ep-ledger-1', 'user-1', baseDto, {
        requestId: 'payoff-request',
        actorId: 'test-approver',
      }),
    ).rejects.toThrow('ยอดปิดสัญญาเปลี่ยนแล้ว กรุณาส่งขออนุมัติใหม่');
    expect(h.createAndPost).not.toHaveBeenCalled();
  });

  it('ส่วนลด 0% ลูกค้าจ่าย 11,556.00 แต่ลูกหนี้ตามบัญชี 11,555.94 → Cr 53-1503 0.06 (เศษสตางค์) · ไม่มี 52-1106', async () => {
    const h = build({ ledger: { ...LEDGER_AFTER_SIX_PAID, '11-2101': '10799.94' } });
    await approvedEarlyPayoff(h.service, 'contract-ep-ledger-1', 'user-1', {
      paymentMethod: 'CASH',
      discountPct: 0,
    });
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(je.lines.find((l) => l.accountCode === '52-1106')).toBeUndefined();
    expect(je.lines.find((l) => l.accountCode === '53-1503')!.cr.toFixed(2)).toBe('0.06');
    expect(je.metadata.roundingGain).toBe('0.06');
    expect(je.metadata.discount).toBe('0.00');
  });

  it('หน้าร้านรับแทน → Dr 11-2107 = เงินที่ลูกค้าจ่าย 11,106.00 · audit SHOP_COLLECT_PAYOFF เก็บยอดเดียวกัน', async () => {
    const h = build();
    await approvedEarlyPayoff(h.service, 'contract-ep-ledger-1', 'user-1', {
      paymentMethod: 'CASH',
      collectedByShop: true,
    });
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    expect(je.lines[0].accountCode).toBe('11-2107');
    expect(je.lines[0].dr.toFixed(2)).toBe('11106.00');
    expect(je.metadata).toMatchObject({
      collectedByShop: true,
      shopReceivableType: 'SHOP_COLLECT',
    });
    const audit = h.auditRows.find((r) => r.action === 'SHOP_COLLECT_PAYOFF');
    expect(audit!.newValue).toEqual({
      shopReceivable: '11-2107',
      shopReceivableType: 'SHOP_COLLECT',
      cashReceived: '11106.00',
      lateFees: '0.00',
      unpaidInstallments: 6,
    });
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
