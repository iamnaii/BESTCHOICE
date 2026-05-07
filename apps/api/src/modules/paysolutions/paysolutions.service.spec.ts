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
import { PaymentReceipt2BTemplate } from '../journal/cpa-templates/payment-receipt-2b.template';
import { PaymentsService } from '../payments/payments.service';

// We don't care about the underlying Sentry transport during unit tests —
// captureException is spied on directly in the JE-failure test.
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('PaySolutionsService.handlePaymentCallback — payment JE (F-1-003)', () => {
  let service: PaySolutionsService;
  let prisma: any;
  let journalAuto: { createPaymentJournal: jest.Mock };
  let paymentReceiptTemplate: { execute: jest.Mock };
  const paymentId = 'pay-1';
  const contractId = 'ct-1';
  const linkId = 'link-1';

  beforeEach(async () => {
    // Reset shared Sentry mocks so assertions in one test don't leak.
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();

    // Tx mock surface used inside the $transaction callback. It must mirror
    // the Prisma client surface used in the production path: paymentLink
    // updateMany, payment findMany/update.
    const txMock = {
      paymentLink: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: paymentId,
            contractId,
            installmentNo: 1,
            amountDue: new Prisma.Decimal(1000),
            amountPaid: new Prisma.Decimal(0),
            lateFee: new Prisma.Decimal(0),
            lateFeeWaived: false,
            monthlyPrincipal: new Prisma.Decimal(800),
            monthlyInterest: new Prisma.Decimal(150),
            monthlyCommission: new Prisma.Decimal(50),
            vatAmount: new Prisma.Decimal(0),
          },
        ]),
        update: jest.fn().mockResolvedValue({
          id: paymentId,
          installmentNo: 1,
          amountPaid: new Prisma.Decimal(1000),
          monthlyPrincipal: new Prisma.Decimal(800),
          monthlyInterest: new Prisma.Decimal(150),
          monthlyCommission: new Prisma.Decimal(50),
          vatAmount: new Prisma.Decimal(0),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          paidDate: new Date(),
          status: 'PAID',
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      contract: {
        update: jest.fn().mockResolvedValue({ productId: null }),
      },
    };

    prisma = {
      paymentLink: {
        findFirst: jest.fn().mockResolvedValue({
          id: linkId,
          token: 'refno-1',
          status: 'ACTIVE',
          contractId,
          paymentId,
          amount: new Prisma.Decimal(1000),
          savingPlanId: null,
          payment: { id: paymentId },
        }),
        update: jest.fn(),
      },
      partialPaymentLink: {
        // Default: no partial-payment link exists for this refno (regular path).
        findUnique: jest.fn().mockResolvedValue(null),
      },
      companyInfo: {
        findFirst: jest.fn().mockImplementation((args: any) => {
          if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-shop' });
          if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-finance' });
          return Promise.resolve({ id: 'co-finance' });
        }),
      },
      // F-1-003 follow-up: real OWNER user resolution for JE.createdById FK.
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'user-system-1' }),
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          contractNumber: 'CT-2026-0001',
          branchId: 'br-1',
        }),
      },
      installmentSchedule: {
        findUnique: jest.fn().mockResolvedValue({ id: 'inst-sched-1' }),
      },
      // Both the main tx and the post-tx JE-only tx invoke the same callback
      // signature — txMock works for both since JE only needs a Prisma client
      // surface (the real JournalAutoService is mocked).
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
      __tx: txMock,
    };

    journalAuto = {
      createPaymentJournal: jest.fn().mockResolvedValue('je-1'),
    };

    const lineOa = {} as Partial<LineOaService>;
    const integrationConfig = {
      getValue: jest.fn().mockResolvedValue(''),
    } as Partial<IntegrationConfigService>;
    const config = {
      get: jest.fn().mockImplementation((_k: string, def?: string) => def ?? ''),
    } as Partial<ConfigService>;
    const saleAdapter = {} as Partial<OnlineOrderSaleAdapter>;
    const products = {
      transferOwnership: jest.fn().mockResolvedValue(undefined),
    } as Partial<ProductsService>;

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
        { provide: PaymentReceipt2BTemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) } },
        { provide: PaymentsService, useValue: { recordPayment: jest.fn() } },
      ],
    }).compile();

    paymentReceiptTemplate = mod.get(PaymentReceipt2BTemplate);
    service = mod.get<PaySolutionsService>(PaySolutionsService);
    // Suppress notification-side-effect logs/throws — we don't test those here.
    jest
      .spyOn<any, any>(service as any, 'sendPaymentSuccessNotification')
      .mockResolvedValue(undefined);
    jest
      .spyOn<any, any>(service as any, 'sendEarlyPayoffSuccessNotification')
      .mockResolvedValue(undefined);
  });

  it('posts payment JE on successful webhook callback (F-1-003)', async () => {
    await service.handlePaymentCallback({
      refno: 'refno-1',
      result_code: '00',
      order_no: 'order-1',
      transaction_id: 'tx-1',
      total: '1000',
    });

    // Phase A.4b: JE now posted via PaymentReceipt2BTemplate (not JournalAutoService)
    expect(paymentReceiptTemplate.execute).toHaveBeenCalledTimes(1);
    expect(paymentReceiptTemplate.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        installmentScheduleId: 'inst-sched-1',
        depositAccountCode: '11-1202',
        existingPaymentId: paymentId,
      }),
    );
  });

  it('JE failure does not roll back payment.update — tx-poisoning prevention (F-1-003 follow-up)', async () => {
    // The JE call lives AFTER the main tx commits (caught by try/catch per payment).
    // A JE rejection must NOT undo Payment.update to PAID.
    paymentReceiptTemplate.execute.mockRejectedValueOnce(
      new Error('JE failed'),
    );

    await service.handlePaymentCallback({
      refno: 'refno-1',
      result_code: '00',
      order_no: 'order-1',
      transaction_id: 'tx-1',
      total: '1000',
    });

    // Payment was committed to PAID despite the JE rejection.
    expect(prisma.__tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID' }),
      }),
    );
  });

  it('skips JE entirely when no OWNER user is present (FK-violation guard)', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await service.handlePaymentCallback({
      refno: 'refno-1',
      result_code: '00',
      order_no: 'order-1',
      transaction_id: 'tx-1',
      total: '1000',
    });

    // No JE was attempted — guard prevents FK violation that would otherwise
    // be swallowed by the inner try/catch.
    expect(paymentReceiptTemplate.execute).not.toHaveBeenCalled();
    // But payment was still committed (P2 — webhook MUST acknowledge).
    expect(prisma.__tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID' }),
      }),
    );
    // And Sentry was alerted via captureMessage (different from captureException).
    expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('no OWNER user'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('does not block payment processing if JE creation fails (F-1-003 P2 pattern)', async () => {
    paymentReceiptTemplate.execute.mockRejectedValueOnce(
      new Error('JE post failed'),
    );

    await expect(
      service.handlePaymentCallback({
        refno: 'refno-1',
        result_code: '00',
        order_no: 'order-1',
        transaction_id: 'tx-1',
        total: '1000',
      }),
    ).resolves.not.toThrow();

    // Payment.update was still called with PAID status — the JE failure
    // must NOT cause the webhook to abort. Customer paid real money via QR;
    // we acknowledge and reconcile the JE manually from Sentry alert.
    expect(prisma.__tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID' }),
      }),
    );

    expect(Sentry.captureException as jest.Mock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          module: 'paysolutions',
          event: 'webhook-je-failure',
        }),
      }),
    );
  });
});
