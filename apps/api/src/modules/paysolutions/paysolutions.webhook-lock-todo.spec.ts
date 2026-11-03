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

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * Task 42 — เงินของลิงก์แจ้งล็อก (`AMOUNT` · `sourceEvent = DEVICE_LOCKED`) เข้าแล้ว ⇒ webhook สร้างงานให้เจ้าหน้าที่ตรวจยอดแล้วปลดล็อค
 * **หลังธุรกรรมรับเงิน commit** (ไม่อยู่ในธุรกรรม — `tx` ไม่มี `todo`) · งานเดียวต่อลิงก์ · พังแล้ว webhook ไม่ล้ม · ไม่มีการปลดล็อคจากทางนี้
 */
describe('PaySolutionsService.handlePaymentCallback — งานปลดล็อคหลังเงินของลิงก์แจ้งล็อกเข้า', () => {
  const contractId = 'ct-1';
  const refno = '793686721395';

  const row = (installmentNo: number, lateFee = '0') => ({
    id: `pay-${installmentNo}`,
    contractId,
    installmentNo,
    amountDue: new Prisma.Decimal('1515.83'),
    amountPaid: new Prisma.Decimal(installmentNo === 1 ? '1515.83' : '0'),
    lateFee: new Prisma.Decimal(lateFee),
    lateFeeWaived: false,
    status: installmentNo === 1 ? 'PARTIALLY_PAID' : 'OVERDUE',
    paidDate: null,
  });

  async function build(opts: {
    tracking?: Record<string, unknown>;
    claimCount?: number;
    sourceEvent?: string | null;
  }) {
    // งวด 1 เหลือค่าปรับ 100 · งวด 2 ค้าง 1,515.83 · งวด 3 ยังไม่ถึงกำหนด ⇒ ลิงก์แจ้งล็อก 1,615.83 ปิดงวด 1 + 2
    const unpaid = [row(1, '100'), row(2), row(3)];
    const tx = {
      paymentLink: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: opts.claimCount ?? 1 })
          .mockResolvedValue({ count: 1 }),
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
        findUnique: jest.fn().mockResolvedValue({ status: 'DEFAULT' }),
        update: jest.fn().mockResolvedValue({ productId: null }),
      },
      installmentSchedule: {
        count: jest.fn().mockResolvedValue(3),
        findUnique: jest.fn(async () => ({ id: 'inst', vat60dayJournalEntryId: null })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const tracking = {
      id: 'track-1',
      token: refno,
      status: 'ACTIVE',
      contractId,
      paymentId: null,
      amount: new Prisma.Decimal('1615.83'),
      purpose: 'AMOUNT',
      sourceLinkId: 'src-1',
      savingPlanId: null,
      ...opts.tracking,
    };
    const prisma = {
      partialPaymentLink: { findUnique: jest.fn().mockResolvedValue(null) },
      paymentLink: {
        findFirst: jest.fn().mockResolvedValue(tracking),
        // ลิงก์ต้นทางของแถวติดตาม (ลิงก์ /pay/:token ที่ข้อความทวงแนบ)
        findUnique: jest.fn().mockResolvedValue({
          id: 'src-1',
          purpose: 'AMOUNT',
          sourceEvent: opts.sourceEvent === undefined ? 'DEVICE_LOCKED' : opts.sourceEvent,
          contract: { id: contractId, contractNumber: 'CT-0001', branchId: 'br-1' },
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
      todo: { upsert: jest.fn().mockResolvedValue({ id: 'todo-1' }) },
      payment: { update: jest.fn() },
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'co-finance' }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'owner-1' }) },
      contract: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: contractId, contractNumber: 'CT-0001', branchId: 'br-1' }),
      },
      $transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
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
        {
          provide: PaymentReceiptTemplate,
          useValue: { execute: jest.fn(async () => ({ entryNo: 'JE-W', warnings: [] })) },
        },
        { provide: Vat60dayReversalTemplate, useValue: { execute: jest.fn() } },
        { provide: PaymentsService, useValue: { recordPayment: jest.fn() } },
        { provide: BadDebtService, useValue: { reverseStageOnPayment: jest.fn() } },
      ],
    }).compile();
    const service = mod.get(PaySolutionsService);
    const notify = jest
      .spyOn(
        service as unknown as Record<string, () => Promise<void>>,
        'sendPaymentSuccessNotification',
      )
      .mockResolvedValue(undefined);
    return { service, tx, prisma, notify };
  }

  const callback = (resultCode = '00', total = '1615.83') => ({
    refno,
    result_code: resultCode,
    order_no: 'o-1',
    transaction_id: 'tx-1',
    total,
  });

  it('สำเร็จ → งานปลดล็อคหนึ่งงานของลิงก์ต้นทาง หลังธุรกรรมรับเงินจบ', async () => {
    const { service, prisma, tx } = await build({});

    await service.handlePaymentCallback(callback('00', '2231.66'));

    expect(prisma.todo.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.todo.upsert.mock.calls[0][0]).toMatchObject({
      where: { requestKey: 'lock-paid-unlock:src-1' },
      update: {},
      create: { priority: 'HIGH', branchId: 'br-1' },
    });
    expect(prisma.todo.upsert.mock.calls[0][0].create.description).toContain('2,231.66 บาท');
    // หลัง commit: ธุรกรรมรับเงินคืนค่าแล้วก่อนเขียนงาน · ธุรกรรมไม่มีช่องทางเขียนงาน
    const txDone = (prisma.$transaction.mock.results[0].value as Promise<unknown>).then(() => Date.now());
    await expect(txDone).resolves.toEqual(expect.any(Number));
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.todo.upsert.mock.invocationCallOrder[0],
    );
    expect((tx as Record<string, unknown>).todo).toBeUndefined();
  });

  it.each([
    ['ชำระไม่สำเร็จ', {}, '99'],
    ['webhook ส่งซ้ำ (แถวติดตาม USED)', { tracking: { status: 'USED' } }, '00'],
    ['แพ้การแย่งสิทธิ์ (claim 0)', { claimCount: 0 }, '00'],
    ['ลิงก์ยอดนัด', { sourceEvent: 'CALL_ANSWERED_PROMISE' }, '00'],
    ['แถวติดตามไม่มีลิงก์ต้นทาง (ลิงก์งวด)', { tracking: { sourceLinkId: null, paymentId: 'pay-2' } }, '00'],
  ] as const)('%s → ไม่สร้างงาน', async (_label, opts, resultCode) => {
    const { service, prisma } = await build(opts as never);

    await service.handlePaymentCallback(callback(resultCode));

    expect(prisma.todo.upsert).not.toHaveBeenCalled();
  });

  it('เขียนงานไม่สำเร็จ → webhook ไม่ล้ม · ลูกค้ายังได้ข้อความชำระสำเร็จ', async () => {
    const { service, prisma, notify } = await build({});
    prisma.todo.upsert.mockRejectedValue(new Error('db down'));

    await expect(service.handlePaymentCallback(callback())).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledTimes(1);
  });
});
