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
 * Task 39 — เงินเข้าทางลิงก์ `/pay/:token` ที่ไม่ใช่ลิงก์งวด (`PAYOFF` / `AMOUNT`):
 * - webhook สำเร็จ → ลิงก์ต้นทาง (`sourceLinkId` ของแถวติดตาม intent) เป็น `USED` ในธุรกรรมเดียวกับการรับเงิน (จ่ายซ้ำจากลิงก์เดิมไม่ได้) ·
 *   ไม่สำเร็จ / ส่งซ้ำ / แพ้การแย่งสิทธิ์ = ไม่แตะลิงก์ต้นทาง (รีวิว 4ข)
 * - ลูกค้าได้ "ชำระเงินสำเร็จ" ทาง OA การเงินเหมือนลิงก์งวด — แถวติดตามไม่มี `paymentId` ⇒ ใช้งวดสุดท้ายที่เงินไปถึง + ยอดที่โอนจริง
 *   (เดิม `sendPaymentSuccessNotification(contractId, null)` จบเงียบ — รีวิว I-2) · ลิงก์งวดส่งแบบเดิม
 * - ไม่มีการปลดล็อกเครื่องจากทางนี้ (คำสั่งเจ้าของ: ห้ามแตะการเชื่อม MDM)
 */
describe('PaySolutionsService.handlePaymentCallback — ลิงก์ /pay/:token ที่ไม่ใช่ลิงก์งวด', () => {
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
      // คำตัดสินเจ้าของ #45 — บัญชีรับเงินของ Pay Solutions (`resolvePaySolutionsDepositAccount`) · ไม่มีค่าตั้ง = 11-1201
      paymentMethodConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      partialPaymentLink: { findUnique: jest.fn().mockResolvedValue(null) },
      paymentLink: {
        findFirst: jest.fn().mockResolvedValue(tracking),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
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

  describe('ลิงก์ต้นทางเป็น USED เมื่อเงินเข้าเท่านั้น', () => {
    it('สำเร็จ → claim แถวติดตาม แล้วตั้งลิงก์ต้นทาง ACTIVE → USED ในธุรกรรมเดียวกัน', async () => {
      const { service, tx } = await build({});

      await service.handlePaymentCallback(callback());

      expect(tx.paymentLink.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.paymentLink.updateMany.mock.calls[1][0]).toEqual({
        where: { id: 'src-1', status: 'ACTIVE' },
        data: { status: 'USED', usedAt: expect.any(Date) },
      });
    });

    it('แถวติดตามไม่มีลิงก์ต้นทาง (ลิงก์งวด · LiffEarlyPayoff) → แตะเฉพาะแถวติดตาม', async () => {
      const { service, tx } = await build({ tracking: { sourceLinkId: null, paymentId: 'pay-2' } });

      await service.handlePaymentCallback(callback());

      expect(tx.paymentLink.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.paymentLink.updateMany.mock.calls[0][0].where).toEqual({
        id: 'track-1',
        status: 'ACTIVE',
      });
    });

    it('ชำระไม่สำเร็จ → แถวติดตาม EXPIRED · ลิงก์ต้นทางไม่ถูกแตะ (ลูกค้ากดจ่ายใหม่ได้)', async () => {
      const { service, tx, prisma } = await build({});

      await service.handlePaymentCallback(callback('99'));

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.paymentLink.updateMany).not.toHaveBeenCalled();
      expect(prisma.paymentLink.updateMany).not.toHaveBeenCalled();
      expect(prisma.paymentLink.update).toHaveBeenCalledWith({
        where: { id: 'track-1' },
        data: { status: 'EXPIRED' },
      });
    });

    it('webhook ส่งซ้ำ (แถวติดตาม USED แล้ว) → ไม่เปิดธุรกรรม ไม่แตะลิงก์ต้นทางซ้ำ', async () => {
      const { service, prisma } = await build({ tracking: { status: 'USED' } });

      await service.handlePaymentCallback(callback());

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('แพ้การแย่งสิทธิ์ (claim 0) → ไม่แตะลิงก์ต้นทาง', async () => {
      const { service, tx } = await build({ claimCount: 0 });

      await service.handlePaymentCallback(callback());

      expect(tx.paymentLink.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('ข้อความ "ชำระเงินสำเร็จ" ทาง OA การเงิน', () => {
    it('ไม่มีงวดบนแถวติดตาม · สัญญายังเดิน → ส่งด้วยงวดสุดท้ายที่เงินไปถึง (งวด 2) + ยอดที่โอนจริง 1,615.83', async () => {
      const { service, notify } = await build({});

      await service.handlePaymentCallback(callback());

      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0]).toEqual([contractId, 'pay-2', new Prisma.Decimal('1615.83')]);
    });

    it('ลิงก์งวด (มีงวดบนแถวติดตาม) → ส่งแบบเดิม (งวดนั้น ไม่ส่งยอด)', async () => {
      const { service, notify } = await build({ tracking: { sourceLinkId: null, paymentId: 'pay-2' } });

      await service.handlePaymentCallback(callback('00', '1515.83'));

      expect(notify.mock.calls[0]).toEqual([contractId, 'pay-2']);
    });
  });
});

describe('PaySolutionsService.sendPaymentSuccessNotification — ยอดที่โอนจริงของลิงก์ที่ไม่ใช่ลิงก์งวด', () => {
  async function build() {
    const lineOa = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          contractNumber: 'CT-0001',
          customer: { name: 'สมชาย', lineLinks: [{ lineUserId: 'U-fin' }] },
          payments: [
            { id: 'pay-1', installmentNo: 1, status: 'PAID', amountPaid: new Prisma.Decimal('1615.83') },
            { id: 'pay-2', installmentNo: 2, status: 'PAID', amountPaid: new Prisma.Decimal('1515.83') },
            { id: 'pay-3', installmentNo: 3, status: 'PENDING', amountPaid: new Prisma.Decimal('0') },
          ],
        }),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PaySolutionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (_k: string, def?: string) => def ?? '' } },
        { provide: LineOaService, useValue: lineOa },
        { provide: IntegrationConfigService, useValue: { getValue: jest.fn() } },
        { provide: OnlineOrderSaleAdapter, useValue: {} },
        { provide: ProductsService, useValue: {} },
        { provide: JournalAutoService, useValue: {} },
        { provide: PaymentReceiptTemplate, useValue: {} },
        { provide: Vat60dayReversalTemplate, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: BadDebtService, useValue: {} },
      ],
    }).compile();
    const service = mod.get(PaySolutionsService) as unknown as {
      sendPaymentSuccessNotification(
        contractId: string,
        paymentId: string | null,
        paidAmount?: Prisma.Decimal,
      ): Promise<void>;
    };
    return { service, lineOa };
  }

  const altText = (lineOa: { sendFlexMessage: jest.Mock }) =>
    (lineOa.sendFlexMessage.mock.calls[0][1] as { altText: string }).altText;

  it('ส่งยอดที่โอนมา → การ์ดบอกยอดนั้น (ไม่ใช่ยอดสะสมของงวด) · งวดที่เงินไปถึง', async () => {
    const { service, lineOa } = await build();

    await service.sendPaymentSuccessNotification('ct-1', 'pay-2', new Prisma.Decimal('1615.83'));

    expect(lineOa.sendFlexMessage).toHaveBeenCalledWith('U-fin', expect.anything(), 'line-finance');
    expect(altText(lineOa)).toBe('ชำระเงินสำเร็จ: งวดที่ 2 จำนวน ฿1,615.83');
  });

  it('ไม่ส่งยอด (ลิงก์งวด) → ยอดสะสมของงวดแบบเดิม', async () => {
    const { service, lineOa } = await build();

    await service.sendPaymentSuccessNotification('ct-1', 'pay-2');

    expect(altText(lineOa)).toBe('ชำระเงินสำเร็จ: งวดที่ 2 จำนวน ฿1,515.83');
  });
});
