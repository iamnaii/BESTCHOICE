import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
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

// Same Sentry-transport stub the sibling spec uses — captureMessage /
// captureException are asserted directly in the not-found / orphan tests.
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * CHARACTERIZATION (golden) spec for the three SECONDARY PaySolutions webhook
 * callbacks. The MAIN installment JE path is pinned in
 * paysolutions.service.spec.ts — this file pins the idempotency gates +
 * money/link math of:
 *   - handlePartialPaymentCallback (~1503)
 *   - confirmOnlineOrderPayment   (~1603)
 *   - confirmSavingPlanPayment    (~1726)
 *
 * Expected values are computed from the real implementation; we assert CURRENT
 * behavior only. Money is Prisma.Decimal — compared via .toString().
 */
describe('PaySolutionsService — secondary webhook callbacks (characterization)', () => {
  let service: PaySolutionsService;
  let prisma: any;
  let lineOa: { sendFlexMessage: jest.Mock };
  let saleAdapter: { createForOnlineOrder: jest.Mock };
  let payments: { recordPayment: jest.Mock };

  // Helper: build a fresh service with a given prisma mock surface, re-wiring
  // the shared collaborator mocks each time so per-test overrides are isolated.
  async function buildService(): Promise<void> {
    lineOa = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    saleAdapter = { createForOnlineOrder: jest.fn().mockResolvedValue(undefined) };
    payments = { recordPayment: jest.fn().mockResolvedValue(undefined) };

    const integrationConfig = {
      getValue: jest.fn().mockResolvedValue(''),
    } as Partial<IntegrationConfigService>;
    const config = {
      get: jest.fn().mockImplementation((_k: string, def?: string) => def ?? ''),
    } as Partial<ConfigService>;
    const products = {
      transferOwnership: jest.fn().mockResolvedValue(undefined),
    } as Partial<ProductsService>;
    const journalAuto = {
      createPaymentJournal: jest.fn().mockResolvedValue('je-1'),
    } as Partial<JournalAutoService>;

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PaySolutionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: LineOaService, useValue: lineOa },
        { provide: IntegrationConfigService, useValue: integrationConfig },
        { provide: OnlineOrderSaleAdapter, useValue: saleAdapter },
        { provide: ProductsService, useValue: products },
        { provide: JournalAutoService, useValue: journalAuto },
        { provide: PaymentReceiptTemplate, useValue: { execute: jest.fn() } },
        { provide: Vat60dayReversalTemplate, useValue: { execute: jest.fn() } },
        { provide: PaymentsService, useValue: payments },
      ],
    }).compile();

    service = mod.get<PaySolutionsService>(PaySolutionsService);
  }

  beforeEach(() => {
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  // ---------------------------------------------------------------------------
  // 1) handlePartialPaymentCallback
  // ---------------------------------------------------------------------------
  describe('handlePartialPaymentCallback', () => {
    const refno = 'PP-REFNO-1';
    const paymentId = 'pay-partial-1';
    const linkId = 'pplink-1';

    function makeLink(overrides: Record<string, any> = {}) {
      return {
        id: linkId,
        status: 'ACTIVE',
        paymentId,
        amount: new Prisma.Decimal(2500),
        gatewayRef: null,
        ...overrides,
      } as any;
    }

    beforeEach(async () => {
      prisma = {
        partialPaymentLink: {
          update: jest.fn().mockResolvedValue({}),
        },
        user: {
          findFirst: jest.fn().mockResolvedValue({ id: 'owner-1' }),
        },
        paymentMethodConfig: {
          // No QR default configured → handler falls back to '11-1201'.
          findFirst: jest.fn().mockResolvedValue(null),
        },
        payment: {
          findUnique: jest.fn().mockResolvedValue({
            contractId: 'ct-partial-1',
            installmentNo: 3,
          }),
        },
      };
      await buildService();
    });

    it('idempotency: a non-ACTIVE link (already PAID) is a no-op — no mutation, no recordPayment', async () => {
      const link = makeLink({ status: 'PAID' });

      await service.handlePartialPaymentCallback(link, {
        refno,
        result_code: '00',
        transaction_id: 'tx-1',
      });

      // Duplicate webhook short-circuits before ANY write or side effect.
      expect(prisma.partialPaymentLink.update).not.toHaveBeenCalled();
      expect(payments.recordPayment).not.toHaveBeenCalled();
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });

    it('failure (result_code != 00): flips link to CANCELLED and does NOT record a payment', async () => {
      const link = makeLink();

      await service.handlePartialPaymentCallback(link, {
        refno,
        result_code: '99',
        transaction_id: 'tx-fail',
      });

      expect(prisma.partialPaymentLink.update).toHaveBeenCalledTimes(1);
      const arg = prisma.partialPaymentLink.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: linkId });
      expect(arg.data.status).toBe('CANCELLED');
      expect(arg.data.cancelledAt).toBeInstanceOf(Date);
      // No money moves on a gateway failure.
      expect(payments.recordPayment).not.toHaveBeenCalled();
    });

    it('success: marks link PAID first, then recordPayment credits Number(amount) with the right keys', async () => {
      const link = makeLink();

      await service.handlePartialPaymentCallback(link, {
        refno,
        result_code: '00',
        transaction_id: 'tx-success',
      });

      // (a) Link flipped to PAID *before* recordPayment, stamping gatewayRef.
      expect(prisma.partialPaymentLink.update).toHaveBeenCalledWith({
        where: { id: linkId },
        data: expect.objectContaining({
          status: 'PAID',
          paidAt: expect.any(Date),
          gatewayRef: 'tx-success',
        }),
      });

      // (b) recordPayment called once with the positional args the impl uses.
      expect(payments.recordPayment).toHaveBeenCalledTimes(1);
      const args = payments.recordPayment.mock.calls[0];
      // contractId, installmentNo from the looked-up Payment row
      expect(args[0]).toBe('ct-partial-1');
      expect(args[1]).toBe(3);
      // amount = Number(link.amount) — credits the full link amount
      expect(args[2]).toBe(2500);
      // method = 'ONLINE_GATEWAY'
      expect(args[3]).toBe('ONLINE_GATEWAY');
      // recordedById = systemUser.id
      expect(args[4]).toBe('owner-1');
      // transactionRef = refno
      expect(args[7]).toBe(refno);
      // depositAccountCode = fallback '11-1201' (no QR default configured)
      expect(args[8]).toBe('11-1201');
      // mode = 'PARTIAL'
      expect(args[10]).toBe('PARTIAL');
    });

    it('success: uses the configured QR default account code when present', async () => {
      prisma.paymentMethodConfig.findFirst.mockResolvedValueOnce({
        accountCode: '11-1202',
      });
      const link = makeLink();

      await service.handlePartialPaymentCallback(link, {
        refno,
        result_code: '00',
        transaction_id: 'tx-success',
      });

      expect(payments.recordPayment.mock.calls[0][8]).toBe('11-1202');
    });

    it('not-found Payment: warns via Sentry, does NOT recordPayment (but link is already PAID)', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(null);
      const link = makeLink();

      await expect(
        service.handlePartialPaymentCallback(link, {
          refno,
          result_code: '00',
          transaction_id: 'tx-orphan',
        }),
      ).resolves.toBeUndefined();

      // Link was still flipped to PAID before the orphan check.
      expect(prisma.partialPaymentLink.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
      // No double-credit — recordPayment never runs.
      expect(payments.recordPayment).not.toHaveBeenCalled();
      // Orphan alarm raised.
      expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining('payment not found'),
        expect.objectContaining({ level: 'fatal' }),
      );
    });

    it('no OWNER user: warns via Sentry and returns without recordPayment', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(null);
      const link = makeLink();

      await service.handlePartialPaymentCallback(link, {
        refno,
        result_code: '00',
        transaction_id: 'tx-noowner',
      });

      expect(payments.recordPayment).not.toHaveBeenCalled();
      expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining('no OWNER user'),
        expect.objectContaining({ level: 'fatal' }),
      );
    });

    it('recordPayment throws: swallowed (no re-throw) and captured to Sentry (return 200 to gateway)', async () => {
      payments.recordPayment.mockRejectedValueOnce(new Error('boom'));
      const link = makeLink();

      await expect(
        service.handlePartialPaymentCallback(link, {
          refno,
          result_code: '00',
          transaction_id: 'tx-throw',
        }),
      ).resolves.toBeUndefined();

      expect(Sentry.captureException as jest.Mock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ level: 'fatal' }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2) confirmOnlineOrderPayment
  // ---------------------------------------------------------------------------
  describe('confirmOnlineOrderPayment', () => {
    const orderId = 'oo-1';

    function makeOrder(overrides: Record<string, any> = {}) {
      return {
        id: orderId,
        orderNumber: 'OO-2026-0001',
        status: 'PENDING',
        reservationId: 'resv-1',
        totalAmount: new Prisma.Decimal(9990),
        customer: { lineIdShop: null },
        product: { name: 'iPhone 15' },
        reservation: { id: 'resv-1' },
        ...overrides,
      } as any;
    }

    let txMock: any;

    beforeEach(async () => {
      txMock = {
        onlineOrder: { update: jest.fn().mockResolvedValue({}) },
        productReservation: { update: jest.fn().mockResolvedValue({}) },
      };
      prisma = {
        onlineOrder: {
          findUnique: jest.fn().mockResolvedValue(makeOrder()),
        },
        $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
        __tx: txMock,
      };
      await buildService();
    });

    it('not-found order: warns and returns without opening a transaction or creating a Sale', async () => {
      prisma.onlineOrder.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' }),
      ).resolves.toBeUndefined();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
    });

    it.each(['PAID', 'PACKING', 'SHIPPED'])(
      'idempotency: an already-confirmed order (status=%s) is a no-op — no tx, no Sale',
      async (status) => {
        prisma.onlineOrder.findUnique.mockResolvedValueOnce(makeOrder({ status }));

        await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
        expect(txMock.onlineOrder.update).not.toHaveBeenCalled();
      },
    );

    it('success: flips order PAID + reservation CONSUMED in one tx, stamps paymentRef, then creates Sale', async () => {
      await service.confirmOnlineOrderPayment(orderId, {
        transaction_id: 'tx-success',
        refno: 'refno-fallback',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Order → PAID with paymentRef = transaction_id (preferred over refno).
      expect(txMock.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({
          status: 'PAID',
          paidAt: expect.any(Date),
          paymentRef: 'tx-success',
        }),
      });
      // Reservation → CONSUMED, linked back to the order.
      expect(txMock.productReservation.update).toHaveBeenCalledWith({
        where: { id: 'resv-1' },
        data: { status: 'CONSUMED', consumedById: orderId },
      });
      // Sale created from the paid order.
      expect(saleAdapter.createForOnlineOrder).toHaveBeenCalledWith(orderId);
    });

    it('success: paymentRef falls back to refno when transaction_id is absent', async () => {
      await service.confirmOnlineOrderPayment(orderId, { refno: 'refno-only' });

      expect(txMock.onlineOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentRef: 'refno-only' }),
        }),
      );
    });

    it('success: Sale-adapter failure is swallowed (logged + Sentry), not re-thrown', async () => {
      saleAdapter.createForOnlineOrder.mockRejectedValueOnce(new Error('sale failed'));

      await expect(
        service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' }),
      ).resolves.toBeUndefined();

      expect(Sentry.captureException as jest.Mock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ level: 'error' }),
      );
    });

    it('success: sends LINE flex when customer has lineIdShop', async () => {
      prisma.onlineOrder.findUnique.mockResolvedValueOnce(
        makeOrder({ customer: { lineIdShop: 'U-line-shop' } }),
      );

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
      expect(lineOa.sendFlexMessage).toHaveBeenCalledWith(
        'U-line-shop',
        expect.objectContaining({ type: 'flex' }),
        'line-shop',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3) confirmSavingPlanPayment
  // ---------------------------------------------------------------------------
  describe('confirmSavingPlanPayment', () => {
    const planId = 'sp-1';
    const paymentLinkId = 'splink-1';

    function makePlan(overrides: Record<string, any> = {}) {
      return {
        id: planId,
        planNumber: 'SP-2026-0001',
        totalSaved: new Prisma.Decimal(1000),
        targetAmount: new Prisma.Decimal(5000),
        nextPaymentDueAt: new Date('2026-06-01T00:00:00.000Z'),
        status: 'ACTIVE',
        customer: { lineIdShop: null },
        payments: [],
        ...overrides,
      } as any;
    }

    let txMock: any;

    beforeEach(async () => {
      txMock = {
        savingPlanPayment: { create: jest.fn().mockResolvedValue({}) },
        savingPlan: { update: jest.fn().mockResolvedValue({}) },
      };
      prisma = {
        savingPlan: {
          findUnique: jest.fn().mockResolvedValue(makePlan()),
        },
        savingPlanPayment: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
        __tx: txMock,
      };
      await buildService();
    });

    it('not-found plan: warns and returns without idempotency lookup or tx', async () => {
      prisma.savingPlan.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.confirmSavingPlanPayment(planId, paymentLinkId, { total: '500' }),
      ).resolves.toBeUndefined();

      expect(prisma.savingPlanPayment.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('idempotency: an existing SavingPlanPayment for this paymentLinkId is a no-op — no tx', async () => {
      prisma.savingPlanPayment.findFirst.mockResolvedValueOnce({ id: 'existing-pay' });

      await service.confirmSavingPlanPayment(planId, paymentLinkId, { total: '500' });

      expect(prisma.savingPlanPayment.findFirst).toHaveBeenCalledWith({
        where: { paymentLinkId },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(txMock.savingPlanPayment.create).not.toHaveBeenCalled();
    });

    it('success (below target): creates payment for total, adds to totalSaved, stays ACTIVE, bumps nextPaymentDueAt +1 month', async () => {
      await service.confirmSavingPlanPayment(planId, paymentLinkId, {
        total: '500',
        transaction_id: 'tx-sp',
      });

      // (a) SavingPlanPayment.create — amount = Decimal(total), method PROMPTPAY,
      //     paymentRef = transaction_id, linked to paymentLinkId.
      expect(txMock.savingPlanPayment.create).toHaveBeenCalledTimes(1);
      const createArg = txMock.savingPlanPayment.create.mock.calls[0][0];
      expect(createArg.data.savingPlanId).toBe(planId);
      expect(createArg.data.amount.toString()).toBe('500');
      expect(createArg.data.paymentMethod).toBe('PROMPTPAY');
      expect(createArg.data.paymentRef).toBe('tx-sp');
      expect(createArg.data.paymentLinkId).toBe(paymentLinkId);

      // (b) Plan.update — totalSaved = 1000 + 500 = 1500 (< 5000 target → ACTIVE),
      //     nextPaymentDueAt advanced one month from 2026-06-01 → 2026-07-01.
      expect(txMock.savingPlan.update).toHaveBeenCalledTimes(1);
      const updArg = txMock.savingPlan.update.mock.calls[0][0];
      expect(updArg.where).toEqual({ id: planId });
      expect(updArg.data.totalSaved.toString()).toBe('1500');
      expect(updArg.data.status).toBe('ACTIVE');
      expect(updArg.data.completedAt).toBeNull();
      expect(updArg.data.nextPaymentDueAt).toBeInstanceOf(Date);
      expect((updArg.data.nextPaymentDueAt as Date).getMonth()).toBe(6); // July (0-indexed)
    });

    it('success (reaches target): flips status COMPLETED, sets completedAt, clears nextPaymentDueAt', async () => {
      // totalSaved 1000 + total 4000 = 5000 >= target 5000 → COMPLETED.
      await service.confirmSavingPlanPayment(planId, paymentLinkId, { total: '4000' });

      const updArg = txMock.savingPlan.update.mock.calls[0][0];
      expect(updArg.data.totalSaved.toString()).toBe('5000');
      expect(updArg.data.status).toBe('COMPLETED');
      expect(updArg.data.completedAt).toBeInstanceOf(Date);
      expect(updArg.data.nextPaymentDueAt).toBeNull();
    });

    it('missing/NaN total: defaults amount to Decimal(0) and credits nothing extra', async () => {
      await service.confirmSavingPlanPayment(planId, paymentLinkId, {});

      const createArg = txMock.savingPlanPayment.create.mock.calls[0][0];
      expect(createArg.data.amount.toString()).toBe('0');

      const updArg = txMock.savingPlan.update.mock.calls[0][0];
      // totalSaved unchanged: 1000 + 0 = 1000.
      expect(updArg.data.totalSaved.toString()).toBe('1000');
      expect(updArg.data.status).toBe('ACTIVE');
    });

    it('success: sends LINE flex with the new cumulative total when customer has lineIdShop', async () => {
      prisma.savingPlan.findUnique.mockResolvedValueOnce(
        makePlan({ customer: { lineIdShop: 'U-sp-line' } }),
      );

      await service.confirmSavingPlanPayment(planId, paymentLinkId, { total: '500' });

      expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
      expect(lineOa.sendFlexMessage).toHaveBeenCalledWith(
        'U-sp-line',
        expect.objectContaining({ type: 'flex' }),
        'line-shop',
      );
    });
  });
});
