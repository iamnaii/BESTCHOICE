import * as Sentry from '@sentry/nestjs';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PaySolutionsService } from './paysolutions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { LineOaService } from '../line-oa/line-oa.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { OnlineOrderSaleAdapter } from '../shop-orders/online-order-sale.adapter';
import { ProductsService } from '../products/products.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { PaymentsService } from '../payments/payments.service';
import { BadDebtService } from '../accounting/bad-debt.service';
import { ReceiptsService } from '../receipts/receipts.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * เงินเข้าทางลิงก์ชำระ (LIFF / ลิงก์ /pay / ลิงก์ปิดยอดในไลน์) — PR3 (คำสั่งเจ้าของ 2026-09-30): ออกใบเสร็จต่องวดที่เงินนี้
 * จ่าย **หลัง** ธุรกรรม commit ผูกเลขที่รายการรับชำระของงวดนั้น · webhook ที่ส่งซ้ำต้องไม่ได้ใบที่สอง · เรียก
 * generateReceipt แบบเดียวกับหน้ารับชำระ (ข้อความใบเสร็จทาง LINE ตามกติกาเดิม — คำตอบเจ้าของ ถ4 2026-09-30)
 * นอกเหนือจาก "ชำระสำเร็จ" · ใบที่ออกไม่สำเร็จแจ้ง Sentry.
 * เดิมทางนี้ลงบัญชีครบแต่ไม่มีแถว Receipt เลย.
 */
describe('PaySolutionsService.handlePaymentCallback — ใบเสร็จของเงินที่เข้าทางลิงก์ชำระ', () => {
  const contractId = 'ct-1';
  const refno = 'refno-1';
  const state = { inTx: false };

  const row = (installmentNo: number) => ({
    id: `pay-${installmentNo}`,
    contractId,
    installmentNo,
    amountDue: new Prisma.Decimal(1000),
    amountPaid: new Prisma.Decimal(0),
    lateFee: new Prisma.Decimal(0),
    lateFeeWaived: false,
    status: 'PENDING',
    paidDate: null,
  });

  async function build(opts: {
    linkStatus?: string;
    claimCount?: number;
    owner?: { id: string } | null;
    total?: string;
  }) {
    const unpaid = [row(1), row(2), row(3)];
    const tx = {
      paymentLink: {
        updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue(unpaid),
        update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
          ...unpaid.find((r) => r.id === args.where.id)!,
          ...args.data,
        })),
        count: jest.fn().mockResolvedValue(1),
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
        update: jest.fn().mockResolvedValue({ productId: null }),
      },
      installmentSchedule: {
        count: jest.fn().mockResolvedValue(3),
        findUnique: jest.fn(
          async (args: { where: { contractId_installmentNo: { installmentNo: number } } }) => ({
            id: `inst-${args.where.contractId_installmentNo.installmentNo}`,
            vat60dayJournalEntryId: null,
          }),
        ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      partialPaymentLink: { findUnique: jest.fn().mockResolvedValue(null) },
      paymentLink: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'link-1',
          token: refno,
          status: opts.linkStatus ?? 'ACTIVE',
          contractId,
          paymentId: 'pay-1',
          amount: new Prisma.Decimal(opts.total ?? '2500'),
          savingPlanId: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'co-finance' }) },
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.owner === undefined ? { id: 'owner-1' } : opts.owner),
      },
      contract: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: contractId, contractNumber: 'CT-0001', branchId: 'br-1' }),
      },
      $transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => {
        state.inTx = true;
        try {
          return await cb(tx);
        } finally {
          state.inTx = false;
        }
      }),
    };
    let n = 0;
    const template = {
      execute: jest.fn(async () => ({
        entryNo: `JE-W-${++n}`,
        split: {},
        accrual: null,
        warnings: [],
      })),
    };
    const receiptCalls: { args: unknown[]; inTx: boolean }[] = [];
    const receipts = {
      generateReceipt: jest.fn(async (...args: unknown[]) => {
        receiptCalls.push({ args, inTx: state.inTx });
        return { id: `r-${receiptCalls.length}` };
      }),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PaySolutionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (_k: string, def?: string) => def ?? '' } },
        { provide: LineOaService, useValue: {} },
        {
          provide: IntegrationConfigService,
          useValue: { getValue: jest.fn().mockResolvedValue('') },
        },
        { provide: OnlineOrderSaleAdapter, useValue: {} },
        { provide: ProductsService, useValue: { transferOwnership: jest.fn() } },
        {
          provide: JournalAutoService,
          useValue: { createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-S-1' }) },
        },
        { provide: PaymentReceiptTemplate, useValue: template },
        { provide: Vat60dayReversalTemplate, useValue: { execute: jest.fn() } },
        { provide: PaymentsService, useValue: { recordPayment: jest.fn() } },
        { provide: BadDebtService, useValue: { reverseStageOnPayment: jest.fn() } },
        { provide: ReceiptsService, useValue: receipts },
      ],
    }).compile();
    const service = mod.get(PaySolutionsService);
    const notify = jest
      .spyOn(
        service as unknown as Record<string, () => Promise<void>>,
        'sendPaymentSuccessNotification',
      )
      .mockResolvedValue(undefined);
    return { service, receipts, receiptCalls, notify };
  }

  const callback = (total = '2500') => ({
    refno,
    result_code: '00',
    order_no: 'o-1',
    transaction_id: 'tx-1',
    total,
  });

  it('เงิน 2,500 จ่าย 3 งวด (1,000 · 1,000 · 500) → ใบเสร็จ 3 ใบหลังธุรกรรม commit · ช่องทาง ONLINE_GATEWAY · ผูกเลขที่รายการของงวดนั้น · เรียกแบบเดียวกับหน้ารับชำระ (ข้อความ LINE ตามกติกาเดิม)', async () => {
    const { service, receiptCalls, notify } = await build({});

    await service.handlePaymentCallback(callback());

    expect(receiptCalls.map((c) => c.inTx)).toEqual([false, false, false]);
    expect(receiptCalls.map((c) => c.args)).toEqual([
      [
        contractId,
        'pay-1',
        'INSTALLMENT',
        1000,
        1,
        'ONLINE_GATEWAY',
        'tx-1',
        'owner-1',
        expect.any(Date),
        'JE-W-1',
      ],
      [
        contractId,
        'pay-2',
        'INSTALLMENT',
        1000,
        2,
        'ONLINE_GATEWAY',
        'tx-1',
        'owner-1',
        expect.any(Date),
        'JE-W-2',
      ],
      [
        contractId,
        'pay-3',
        'INSTALLMENT',
        500,
        3,
        'ONLINE_GATEWAY',
        'tx-1',
        'owner-1',
        expect.any(Date),
        'JE-W-3',
      ],
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('webhook ส่งซ้ำหลังลิงก์ถูกใช้แล้ว (USED) → ไม่ออกใบเสร็จซ้ำ', async () => {
    const { service, receipts } = await build({ linkStatus: 'USED' });

    await service.handlePaymentCallback(callback());

    expect(receipts.generateReceipt).not.toHaveBeenCalled();
  });

  it('สองคำขอแย่งลิงก์เดียวกัน ฝ่ายที่แพ้ (claim 0) → ไม่ออกใบเสร็จ', async () => {
    const { service, receipts } = await build({ claimCount: 0 });

    await service.handlePaymentCallback(callback());

    expect(receipts.generateReceipt).not.toHaveBeenCalled();
  });

  it('ออกใบเสร็จไม่สำเร็จ → webhook ไม่ล้ม · แจ้ง Sentry พร้อมเลขที่รายการ · ยังออกใบถัดไปและแจ้งลูกค้าตามเดิม', async () => {
    const { service, receipts, notify } = await build({});
    const failure = new Error('ออกใบไม่ได้');
    receipts.generateReceipt.mockRejectedValueOnce(failure);
    (Sentry.captureException as jest.Mock).mockClear();

    await expect(service.handlePaymentCallback(callback())).resolves.toBeUndefined();
    expect(receipts.generateReceipt).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenCalledTimes(1);
    // final review I3(c): แจ้งเตือนมีทุกค่าที่ต้องใช้ออกใบซ้ำ — วันที่ = วันที่เดียวกับที่ส่งให้ generateReceipt (paidAt ของธุรกรรม)
    const paidAt = receipts.generateReceipt.mock.calls[0][8] as Date;
    expect(paidAt).toBeInstanceOf(Date);
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
      level: 'error',
      tags: {
        module: 'receipts',
        action: 'post-commit-receipt-failed',
        path: 'paysolutions-webhook',
      },
      extra: {
        path: 'paysolutions-webhook',
        contractId,
        paymentId: 'pay-1',
        installmentNo: 1,
        journalEntryNumber: 'JE-W-1',
        paymentMethod: 'ONLINE_GATEWAY',
        amount: '1000.00',
        transactionRef: 'tx-1',
        issuedById: 'owner-1',
        paidDate: paidAt.toISOString(),
      },
    });
  });

  it('ไม่มีผู้ใช้ OWNER (ไม่ได้ลงรายการรับชำระ) → ไม่ออกใบเสร็จ', async () => {
    const { service, receipts } = await build({ owner: null });

    await service.handlePaymentCallback(callback());

    expect(receipts.generateReceipt).not.toHaveBeenCalled();
  });
});
