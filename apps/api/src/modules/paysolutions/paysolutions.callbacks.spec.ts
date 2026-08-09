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
import { BadDebtService } from '../accounting/bad-debt.service';

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
  let payments: { recordPayment: jest.Mock; rescheduleWithCollect: jest.Mock };

  // Helper: build a fresh service with a given prisma mock surface, re-wiring
  // the shared collaborator mocks each time so per-test overrides are isolated.
  async function buildService(): Promise<void> {
    lineOa = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    saleAdapter = { createForOnlineOrder: jest.fn().mockResolvedValue(undefined) };
    payments = {
      recordPayment: jest.fn().mockResolvedValue(undefined),
      // ปรับดิว QR (2026-07-02): purpose=RESCHEDULE links route here on paid webhook.
      rescheduleWithCollect: jest.fn().mockResolvedValue({ success: true }),
    };

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
        {
          provide: BadDebtService,
          useValue: { reverseStageOnPayment: jest.fn().mockResolvedValue(null) },
        },
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

    // Review W2 (2026-07-02): SUCCESS webhook landing on an EXPIRED link = the
    // customer's money reached the gateway but the hourly cron expired the link
    // first — nothing was recorded. Must alarm fatal; ops reconciles manually.
    it('EXPIRED link + SUCCESS webhook: fatal Sentry alarm, no link mutation, no recordPayment', async () => {
      const link = makeLink({ status: 'EXPIRED' });

      await service.handlePartialPaymentCallback(link, {
        refno,
        result_code: '00',
        transaction_id: 'tx-expired-paid',
      });

      expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining('EXPIRED'),
        expect.objectContaining({
          level: 'fatal',
          tags: expect.objectContaining({ critical: 'paysolutions-expired-paid', refno }),
        }),
      );
      // Still the idempotent skip path — nothing is written or credited.
      expect(prisma.partialPaymentLink.update).not.toHaveBeenCalled();
      expect(payments.recordPayment).not.toHaveBeenCalled();
      expect(payments.rescheduleWithCollect).not.toHaveBeenCalled();
    });

    it('EXPIRED + SUCCESS on a purpose=RESCHEDULE link: alarms and does NOT execute the reschedule', async () => {
      const link = makeLink({
        status: 'EXPIRED',
        purpose: 'RESCHEDULE',
        metadata: {
          daysToShift: 7,
          splitMode: 'SPLIT',
          rescheduleFee: '1044',
          lateFee: '100',
          collectAmount: '1144',
        },
      });

      await service.handlePartialPaymentCallback(link, {
        refno,
        result_code: '00',
        transaction_id: 'tx-expired-resched',
      });

      expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining('EXPIRED'),
        expect.objectContaining({
          level: 'fatal',
          tags: expect.objectContaining({ critical: 'paysolutions-expired-paid' }),
        }),
      );
      // ดิวไม่เลื่อน — the due-date shift must never run off an expired link.
      expect(payments.rescheduleWithCollect).not.toHaveBeenCalled();
      expect(payments.recordPayment).not.toHaveBeenCalled();
      expect(prisma.partialPaymentLink.update).not.toHaveBeenCalled();
    });

    it('EXPIRED link + FAILURE webhook (result_code != 00): silent idempotent skip — no alarm', async () => {
      const link = makeLink({ status: 'EXPIRED' });

      await service.handlePartialPaymentCallback(link, {
        refno,
        result_code: '99',
        transaction_id: 'tx-expired-fail',
      });

      // No money was captured → no alarm, and nothing else happens either.
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      expect(prisma.partialPaymentLink.update).not.toHaveBeenCalled();
      expect(payments.recordPayment).not.toHaveBeenCalled();
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

    it('ปรับดิว: purpose=RESCHEDULE link routes to rescheduleWithCollect with the frozen quote — recordPayment NOT called', async () => {
      const link = makeLink({
        purpose: 'RESCHEDULE',
        amount: new Prisma.Decimal(1144),
        metadata: {
          daysToShift: 7,
          splitMode: 'SPLIT',
          rescheduleFee: '1044',
          lateFee: '100',
          collectAmount: '1144',
          requestedById: 'cashier-1',
        },
      });

      await service.handlePartialPaymentCallback(link, {
        refno,
        result_code: '00',
        transaction_id: 'tx-resched',
      });

      // Link flipped PAID first (same as the partial path).
      expect(prisma.partialPaymentLink.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: linkId },
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
      expect(payments.rescheduleWithCollect).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'ct-partial-1',
          installmentNo: 3,
          daysToShift: 7,
          splitMode: 'SPLIT',
          amount: 1144,
          paymentMethod: 'ONLINE_GATEWAY',
          recordedById: 'owner-1',
          transactionRef: refno,
          fixedQuote: { rescheduleFee: '1044', lateFee: '100', collectAmount: '1144' },
        }),
      );
      expect(payments.recordPayment).not.toHaveBeenCalled();
    });

    it('ปรับดิว: rescheduleWithCollect failure → Sentry fatal, no throw (PaySolutions gets 200)', async () => {
      payments.rescheduleWithCollect.mockRejectedValueOnce(new Error('period closed'));
      const link = makeLink({
        purpose: 'RESCHEDULE',
        metadata: {
          daysToShift: 7,
          splitMode: 'SINGLE',
          rescheduleFee: '1044',
          lateFee: '100',
          collectAmount: '100',
        },
      });

      await expect(
        service.handlePartialPaymentCallback(link, {
          refno,
          result_code: '00',
          transaction_id: 'tx-r2',
        }),
      ).resolves.toBeUndefined();

      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({ critical: 'paysolutions-reschedule-exec-fail' }),
        }),
      );
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
        productId: 'p1',
        customerId: 'cust-1',
        reservationId: 'resv-1',
        totalAmount: new Prisma.Decimal(9990),
        customer: { lineIdShop: null },
        product: { name: 'iPhone 15' },
        reservation: { id: 'resv-1' },
        paymentChannel: 'PROMPTPAY_QR',
        ...overrides,
      } as any;
    }

    let txMock: any;

    beforeEach(async () => {
      txMock = {
        onlineOrder: {
          update: jest.fn().mockResolvedValue({}),
          // F2 (final-review forward-flag, closed here): CAS claim inside the tx —
          // default = this webhook wins the race (count 1). Race-lost tests below
          // override to {count: 0}.
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        productReservation: {
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          count: jest.fn().mockResolvedValue(0), // hold CONSUMED อื่นบนเครื่องเดียวกัน
        },
        // consumeOrderHoldInTx locks via a conditional updateMany (not a plain read) —
        // default = lock succeeds (product IS IN_STOCK). findUnique is the reporting-only
        // fallback the util reads when the lock's WHERE doesn't match any row.
        product: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ status: 'IN_STOCK' }),
        },
      };
      prisma = {
        onlineOrder: {
          findUnique: jest.fn().mockResolvedValue(makeOrder()),
          // ใช้ตอน catch ของ saleAdapter (re-read สถานะเครื่อง) + อัปเดตเข้าคิวคืนเงิน
          update: jest.fn().mockResolvedValue({}),
        },
        product: { findUnique: jest.fn().mockResolvedValue({ status: 'SOLD_CASH' }) },
        // fix round 1/5 [Important 1]: catch-block re-check for "did this order's own
        // Sale already commit before the post-sale linkback failed" — default = no.
        sale: { findFirst: jest.fn().mockResolvedValue(null) },
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

    it('success: flips order PAID + consume hold แบบมีเงื่อนไข (ห้าม update by id เปล่าๆ)', async () => {
      await service.confirmOnlineOrderPayment(orderId, {
        transaction_id: 'tx-success',
        refno: 'refno-fallback',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({
          status: 'PAID',
          paidAt: expect.any(Date),
          paymentRef: 'tx-success',
        }),
      });
      expect(txMock.productReservation.updateMany).toHaveBeenCalledWith({
        where: { id: 'resv-1', status: { in: ['ACTIVE', 'EXPIRED'] } },
        data: { status: 'CONSUMED', consumedById: orderId },
      });
      expect(txMock.productReservation.update).not.toHaveBeenCalled();
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

    it('unfulfillable: เครื่องถูกขายหน้าร้านไปแล้ว → order = PAYMENT_RECEIVED_UNFULFILLABLE, ไม่สร้าง Sale', async () => {
      // consumeOrderHoldInTx locks via product.updateMany({where:{status:'IN_STOCK'}}) —
      // sold-at-store means that conditional write matches 0 rows, so the lock fails
      // and the util falls back to product.findUnique purely for reporting.
      txMock.product.updateMany.mockResolvedValue({ count: 0 });
      txMock.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(txMock.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({
          status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
          paymentRef: 'tx-1',
        }),
      });
      expect(txMock.productReservation.updateMany).not.toHaveBeenCalled();
      expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
      expect(Sentry.captureException as jest.Mock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({ critical: 'online-order-unfulfillable' }),
        }),
      );
    });

    it('unfulfillable: hold โดน PREEMPTED ก่อน (count=0) → unfulfillable แม้เครื่องยัง IN_STOCK', async () => {
      txMock.productReservation.updateMany.mockResolvedValue({ count: 0 });

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(txMock.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({ status: 'PAYMENT_RECEIVED_UNFULFILLABLE' }),
      });
      expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
    });

    it('unfulfillable: ส่ง LINE แจ้งลูกค้าคนละแบบกับ flex ชำระสำเร็จ', async () => {
      prisma.onlineOrder.findUnique.mockResolvedValueOnce(
        makeOrder({ customer: { lineIdShop: 'U-line-shop' } }),
      );
      txMock.product.updateMany.mockResolvedValue({ count: 0 });
      txMock.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
      const [, flex, channel] = lineOa.sendFlexMessage.mock.calls[0];
      expect(channel).toBe('line-shop');
      expect(JSON.stringify(flex)).toContain('คืนเงิน');
    });

    it('unfulfillable: เครื่องยัง IN_STOCK แต่มี hold CONSUMED ของออเดอร์อื่นอยู่ → เข้าคิวคืนเงิน', async () => {
      // เคส adapter เคยพังเมื่อออเดอร์ก่อนหน้า: เงินเข้าแล้ว hold=CONSUMED แต่เครื่องไม่เคย
      // ถูก flip เป็น SOLD_CASH → ถ้าเช็คแค่ IN_STOCK จะเก็บเงินคนที่ 2 บนเครื่องเดียวกัน
      txMock.productReservation.count.mockResolvedValue(1);

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(txMock.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({ status: 'PAYMENT_RECEIVED_UNFULFILLABLE' }),
      });
      expect(txMock.productReservation.updateMany).not.toHaveBeenCalled();
      expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
    });

    it('adapter ล้ม + เครื่องหลุดมือไปแล้ว → ออเดอร์ถูกย้ายเข้าคิวคืนเงิน (ไม่ค้าง PAID เงียบ)', async () => {
      saleAdapter.createForOnlineOrder.mockRejectedValueOnce(new Error('sale failed'));
      prisma.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(prisma.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({ status: 'PAYMENT_RECEIVED_UNFULFILLABLE' }),
      });
    });

    it('adapter ล้ม แต่เครื่องยัง IN_STOCK → คงสถานะ PAID เหมือนเดิม (แอดมินสร้าง Sale เองได้)', async () => {
      saleAdapter.createForOnlineOrder.mockRejectedValueOnce(new Error('sale failed'));
      prisma.product.findUnique.mockResolvedValue({ status: 'IN_STOCK' });

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(prisma.onlineOrder.update).not.toHaveBeenCalled();
      expect(Sentry.captureException as jest.Mock).toHaveBeenCalled();
    });

    it.each(['PAYMENT_RECEIVED_UNFULFILLABLE', 'REFUNDED', 'DELIVERED', 'COMPLETED'])(
      'idempotency: webhook ซ้ำหลังเข้าคิวคืนเงิน/ส่งของแล้ว (status=%s) = no-op',
      async (status) => {
        prisma.onlineOrder.findUnique.mockResolvedValueOnce(makeOrder({ status }));

        await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
      },
    );

    it('adapter ล้ม แต่ Sale ของออเดอร์นี้ถูกสร้างไปแล้วจริง (แค่ post-sale linkback ล้ม) → คง PAID ไม่คืนเงินซ้อน', async () => {
      // fix round 1/5 [Important 1]: SalesService.create already committed Sale +
      // product→SOLD_CASH in its own tx before the adapter's post-sale linkback
      // (sale.update / onlineOrder.update saleId+PACKING) threw. The device really
      // did go to THIS customer — must not be treated as "sold to someone else".
      saleAdapter.createForOnlineOrder.mockRejectedValueOnce(new Error('linkback failed'));
      prisma.sale.findFirst.mockResolvedValue({ id: 'sale-99' });
      prisma.onlineOrder.findUnique.mockResolvedValueOnce(
        makeOrder({ customer: { lineIdShop: 'U-line-shop' } }),
      );

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      // fix round 2/5: must filter deletedAt: null (backend.md soft-delete convention) —
      // a soft-deleted Sale row must not false-positive as "fulfilled".
      expect(prisma.sale.findFirst).toHaveBeenCalledWith({
        where: { productId: 'p1', customerId: 'cust-1', deletedAt: null },
        select: { id: true },
      });
      // Order was already flipped PAID inside the tx — must NOT be re-flipped to
      // PAYMENT_RECEIVED_UNFULFILLABLE (that would refund a sale that already happened).
      expect(prisma.onlineOrder.update).not.toHaveBeenCalled();
      expect(Sentry.captureException as jest.Mock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({
            critical: 'online-order-post-sale-linkback-failed',
          }),
        }),
      );
      // Fulfilled → paid flex, not the refund flex.
      expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
      const [, flex] = lineOa.sendFlexMessage.mock.calls[0];
      expect(JSON.stringify(flex)).not.toContain('คืนเงิน');
    });

    it('adapter ล้ม + เครื่องหลุดมือ + ลูกค้ามี lineIdShop → ส่งเฉพาะ flex คืนเงิน ไม่ส่ง flex ชำระสำเร็จซ้อน', async () => {
      // fix round 1/5 [Important 2]: the catch-block unfulfillable branch previously had
      // no return/flag, so execution fell through to the "paid" flex send right after —
      // customer got 2 contradictory LINE messages. Regression-guards the fix by being
      // the first test in this describe to set lineIdShop on this exact code path.
      saleAdapter.createForOnlineOrder.mockRejectedValueOnce(new Error('sale failed'));
      prisma.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });
      prisma.onlineOrder.findUnique.mockResolvedValueOnce(
        makeOrder({ customer: { lineIdShop: 'U-line-shop' } }),
      );

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(prisma.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({ status: 'PAYMENT_RECEIVED_UNFULFILLABLE' }),
      });
      expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
      const [, flex] = lineOa.sendFlexMessage.mock.calls[0];
      expect(JSON.stringify(flex)).toContain('คืนเงิน');
    });

    // ── F2 (final-review forward-flag, closed here) — CAS-claim the gateway webhook ──
    // Mirrors ShopOrdersService.confirmBankTransfer's CAS claim (shop-orders.service.ts
    // ~103): the already-confirmed status check above reads via findUnique OUTSIDE the
    // $transaction — 2 concurrent webhooks for the SAME order (PaySolutions retries up
    // to 3x, or 2 webhook deliveries racing) can both pass it. Without an in-tx claim,
    // the winner flips PAID; the loser's consumeOrderHoldInTx legitimately count=0's on
    // the already-CONSUMED hold → fulfillable=false → its unconditional
    // tx.onlineOrder.update OVERWRITES the winner's PAID with
    // PAYMENT_RECEIVED_UNFULFILLABLE (customer paid + device available, yet flagged for
    // refund). Claim predicate: status MUST still be PENDING_PAYMENT (the only status a
    // gateway order legitimately sits at when this webhook fires — shop-checkout.service.ts
    // always creates at PENDING_PAYMENT; PENDING_BANK_REVIEW is BANK_TRANSFER-only and
    // structurally unreachable here since those orders never get a paymentLinkId) AND
    // paymentChannel must be a gateway channel (blocks a BANK_TRANSFER order from ever
    // being claimed by this path, mirroring confirmBankTransfer's Minor fix in reverse).
    describe('F2: CAS claim (gateway webhook race)', () => {
      it('race loser: a concurrent webhook already flipped the order PAID before this claim runs (CAS claim count=0) → idempotent skip, no consume-hold, no status overwrite', async () => {
        // Pre-tx read still sees the stale PENDING_PAYMENT state — this is the exact
        // TOCTOU gap the outer status skip-list alone cannot catch; only the in-tx CAS
        // claim closes it.
        prisma.onlineOrder.findUnique.mockResolvedValueOnce(
          makeOrder({ status: 'PENDING_PAYMENT' }),
        );
        txMock.onlineOrder.updateMany.mockResolvedValue({ count: 0 }); // lost the race

        await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-loser' });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(txMock.onlineOrder.updateMany).toHaveBeenCalledWith({
          where: {
            id: orderId,
            status: { in: ['PENDING_PAYMENT'] },
            paymentChannel: { in: ['PROMPTPAY_QR', 'CREDIT_DEBIT_CARD'] },
          },
          data: { updatedAt: expect.any(Date) },
        });
        // Must NOT touch the hold or overwrite the winner's already-committed status.
        expect(txMock.onlineOrder.update).not.toHaveBeenCalled();
        expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
        expect(lineOa.sendFlexMessage).not.toHaveBeenCalled();
        expect(Sentry.captureException as jest.Mock).not.toHaveBeenCalled();
      });

      it('race loser: CAS claim count=0 → returns without ever invoking consumeOrderHoldInTx (no product lock, no reservation count/consume)', async () => {
        txMock.onlineOrder.updateMany.mockResolvedValue({ count: 0 });

        await service.confirmOnlineOrderPayment(orderId, { refno: 'refno-loser' });

        // consumeOrderHoldInTx's internals (the product row-lock + CONSUMED-elsewhere
        // count + the reservation status flip) must never run for a claim loser.
        expect(txMock.product.updateMany).not.toHaveBeenCalled();
        expect(txMock.productReservation.count).not.toHaveBeenCalled();
        expect(txMock.productReservation.updateMany).not.toHaveBeenCalled();
        expect(txMock.onlineOrder.update).not.toHaveBeenCalled();
      });

      it('winner path: CAS claim runs first with the PENDING_PAYMENT + gateway-channel predicate, then proceeds to consume hold + PAID exactly as before', async () => {
        await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-winner' });

        expect(txMock.onlineOrder.updateMany).toHaveBeenCalledWith({
          where: {
            id: orderId,
            status: { in: ['PENDING_PAYMENT'] },
            paymentChannel: { in: ['PROMPTPAY_QR', 'CREDIT_DEBIT_CARD'] },
          },
          data: { updatedAt: expect.any(Date) },
        });
        // Claim succeeds (default mock count:1) → rest of the winner flow proceeds
        // byte-identical to the pre-F2 'success' tests above.
        expect(txMock.onlineOrder.update).toHaveBeenCalledWith({
          where: { id: orderId },
          data: expect.objectContaining({ status: 'PAID' }),
        });
        expect(saleAdapter.createForOnlineOrder).toHaveBeenCalledWith(orderId);
      });
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
