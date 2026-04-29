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
  const paymentId = 'pay-1';
  const contractId = 'ct-1';
  const linkId = 'link-1';

  beforeEach(async () => {
    // Reset shared Sentry mock so assertions in one test don't leak.
    (Sentry.captureException as jest.Mock).mockClear();

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
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'co-finance' }),
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          contractNumber: 'CT-2026-0001',
          branchId: 'br-1',
        }),
      },
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
      ],
    }).compile();

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

    expect(journalAuto.createPaymentJournal).toHaveBeenCalledTimes(1);
    expect(journalAuto.createPaymentJournal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: 'co-finance',
        payment: expect.objectContaining({ id: paymentId, installmentNo: 1 }),
        contract: expect.objectContaining({
          contractNumber: 'CT-2026-0001',
          branchId: 'br-1',
        }),
        userId: 'paysolutions-webhook',
      }),
    );
  });

  it('does not block payment processing if JE creation fails (F-1-003 P2 pattern)', async () => {
    journalAuto.createPaymentJournal.mockRejectedValueOnce(
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
