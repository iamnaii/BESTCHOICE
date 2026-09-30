import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import { PaymentReceiptOrchestrator } from './payment-receipt-orchestrator';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * ใบเสร็จของทุกทางที่รับเงิน (PR3 — X5 + คำสั่งเจ้าของ 2026-09-30):
 *   - กระจายเงินอัตโนมัติ: ใบเสร็จออก**หลัง**ธุรกรรมเงิน commit และผูกเลขที่รายการรับชำระของงวดนั้น
 *     (เดิมออกในธุรกรรมผ่าน client หลัก — เห็นสถานะงวดก่อนแก้ ไม่ผูกรายการ ค้างเป็นใบกำพร้าเมื่อธุรกรรมล้ม)
 *   - ใช้เครดิตชำระ: ออกใบเสร็จต่องวด ช่องทาง CREDIT_BALANCE (เดิมไม่มีใบเสร็จเลย)
 *   - ทั้งสองทางเรียก generateReceipt แบบเดียวกับหน้ารับชำระ (10 อาร์กิวเมนต์ ไม่มีตัวเลือกปิดข้อความ) → ข้อความใบเสร็จทาง
 *     LINE ตามกติกาเดิมของ generateReceipt (คำตอบเจ้าของ ถ4 2026-09-30)
 *   - ใบที่ออกไม่สำเร็จหลัง commit → แจ้ง Sentry พร้อมเลขที่รายการสำหรับออกใบซ้ำ
 * สัญญา 2 งวดค้าง งวดละ 1,515.83
 */
describe('PaymentReceiptOrchestrator — ใบเสร็จหลังธุรกรรม commit', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  const payments = [
    {
      id: 'p-1',
      installmentNo: 1,
      amountDue: dec('1515.83'),
      amountPaid: dec(0),
      lateFee: dec(0),
      lateFeeWaived: false,
      status: 'PENDING',
      notes: null,
    },
    {
      id: 'p-2',
      installmentNo: 2,
      amountDue: dec('1515.83'),
      amountPaid: dec(0),
      lateFee: dec(0),
      lateFeeWaived: false,
      status: 'PENDING',
      notes: null,
    },
  ];

  function build(opts: { creditBalance?: string; templateImpl?: jest.Mock } = {}) {
    const state = { inTx: false };
    const receiptCalls: { args: unknown[]; inTx: boolean }[] = [];
    const prisma = {
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'co-FINANCE' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ defaultCashAccountCode: '11-1101' }) },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ct-1',
          status: 'ACTIVE',
          deletedAt: null,
          creditBalance: dec(opts.creditBalance ?? '0'),
          payments,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: {
        update: jest.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
            ...payments.find((p) => p.id === where.id)!,
            ...data,
            depositAccountCode: '11-1101',
          }),
        ),
        count: jest.fn().mockResolvedValue(1),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      installmentSchedule: {
        count: jest.fn().mockResolvedValue(12),
        findUnique: jest.fn(
          async ({
            where,
          }: {
            where: { contractId_installmentNo: { installmentNo: number } };
          }) => ({
            id: `inst-${where.contractId_installmentNo.installmentNo}`,
            vat60dayJournalEntryId: null,
          }),
        ),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        state.inTx = true;
        try {
          return await cb(prisma);
        } finally {
          state.inTx = false;
        }
      }),
    };
    let n = 0;
    const template = {
      execute:
        opts.templateImpl ??
        jest.fn(async () => ({ entryNo: `JE-R-${++n}`, split: {}, accrual: null, warnings: [] })),
    };
    const receiptsService = {
      generateReceipt: jest.fn(async (...args: unknown[]) => {
        receiptCalls.push({ args, inTx: state.inTx });
        return { id: `r-${receiptCalls.length}` };
      }),
    };
    const noop = async () => {};
    const orchestrator = new PaymentReceiptOrchestrator(
      prisma as never,
      receiptsService as never,
      { logPaymentEvent: noop, log: noop } as never,
      { createAndPost: jest.fn() } as never,
      { transferOwnership: noop } as never,
      { reverseStageOnPayment: noop } as never,
      template as never,
      { execute: noop } as never,
      {
        awardLoyaltyPoints: noop,
        sendPaymentSuccessLine: noop,
        runMdmAutoUnlock: noop,
        checkPromiseAfterPayment: noop,
      },
    );
    return { orchestrator, receiptsService, receiptCalls, template };
  }

  it('กระจายเงิน 2,000 → ใบเสร็จสองใบออกหลังธุรกรรม commit · ผูกเลขที่รายการรับชำระของแต่ละงวด', async () => {
    const { orchestrator, receiptCalls } = build();

    await orchestrator.autoAllocatePayment('ct-1', 2000, 'CASH', 'u-1');

    expect(receiptCalls.map((c) => c.inTx)).toEqual([false, false]);
    expect(receiptCalls.map((c) => c.args)).toEqual([
      ['ct-1', 'p-1', 'INSTALLMENT', 1515.83, 1, 'CASH', null, 'u-1', undefined, 'JE-R-1'],
      ['ct-1', 'p-2', 'INSTALLMENT', 484.17, 2, 'CASH', null, 'u-1', undefined, 'JE-R-2'],
    ]);
  });

  it('ธุรกรรมเงินล้ม (รายการรับชำระงวด 2 ลงไม่ผ่าน) → ไม่มีใบเสร็จเลย', async () => {
    const templateImpl = jest
      .fn()
      .mockResolvedValueOnce({ entryNo: 'JE-R-1', split: {}, accrual: null, warnings: [] })
      .mockRejectedValueOnce(new Error('ลงรายการไม่ผ่าน'));
    const { orchestrator, receiptsService } = build({ templateImpl });

    await expect(orchestrator.autoAllocatePayment('ct-1', 2000, 'CASH', 'u-1')).rejects.toThrow(
      'ลงรายการไม่ผ่าน',
    );
    expect(receiptsService.generateReceipt).not.toHaveBeenCalled();
  });

  it('ออกใบเสร็จใบแรกไม่สำเร็จ → การรับเงินที่ commit แล้วไม่ล้ม · แจ้ง Sentry พร้อมเลขที่รายการ · ยังออกใบถัดไป', async () => {
    const { orchestrator, receiptsService } = build();
    const failure = new Error('ออกใบไม่ได้');
    receiptsService.generateReceipt.mockRejectedValueOnce(failure);
    (Sentry.captureException as jest.Mock).mockClear();
    const before = Date.now();

    const out = await orchestrator.autoAllocatePayment('ct-1', 2000, 'CASH', 'u-1');

    const after = Date.now();
    expect(out.totalAllocated).toBe(2000);
    expect(receiptsService.generateReceipt).toHaveBeenCalledTimes(2);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    // final review I3(c): แจ้งเตือนมีทุกค่าที่ต้องใช้ออกใบซ้ำ — ช่องทางของการกระจายเงินอยู่ที่นี่และ payments.payment_method เท่านั้น
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
      level: 'error',
      tags: { module: 'receipts', action: 'post-commit-receipt-failed', path: 'auto-allocate' },
      extra: {
        path: 'auto-allocate',
        contractId: 'ct-1',
        paymentId: 'p-1',
        installmentNo: 1,
        journalEntryNumber: 'JE-R-1',
        paymentMethod: 'CASH',
        amount: '1515.83',
        transactionRef: null,
        issuedById: 'u-1',
        paidDate: expect.any(String),
      },
    });
    // ทางนี้ไม่ส่งวันที่ให้ generateReceipt (ใบลงวันที่ตอนออก = หลัง commit ทันที) — แจ้งเตือนใช้เวลาเดียวกันนั้น
    const { paidDate } = (Sentry.captureException as jest.Mock).mock.calls[0][1].extra;
    expect(new Date(paidDate).toISOString()).toBe(paidDate);
    expect(Date.parse(paidDate)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(paidDate)).toBeLessThanOrEqual(after);
  });

  it('ใช้เครดิต 2,000 ชำระ → ใบเสร็จช่องทาง "ใช้ยอดเครดิตในสัญญา" ต่องวด หลังธุรกรรม พร้อมเลขที่รายการ · เรียกแบบเดียวกับหน้ารับชำระ (ข้อความ LINE ตามกติกาเดิม)', async () => {
    const { orchestrator, receiptCalls } = build({ creditBalance: '2000' });

    await orchestrator.applyCreditBalance('ct-1', 'u-1');

    expect(receiptCalls.map((c) => c.inTx)).toEqual([false, false]);
    expect(receiptCalls.map((c) => c.args)).toEqual([
      [
        'ct-1',
        'p-1',
        'INSTALLMENT',
        1515.83,
        1,
        'CREDIT_BALANCE',
        null,
        'u-1',
        undefined,
        'JE-R-1',
      ],
      ['ct-1', 'p-2', 'INSTALLMENT', 484.17, 2, 'CREDIT_BALANCE', null, 'u-1', undefined, 'JE-R-2'],
    ]);
  });
});
