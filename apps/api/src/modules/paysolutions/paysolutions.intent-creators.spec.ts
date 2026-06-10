import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { InternalServerErrorException } from '@nestjs/common';
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

// Same Sentry-transport stub the sibling specs use — captureException is
// asserted directly in the orphan tests.
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * CHARACTERIZATION (golden) spec — gap-fill for the FOUR previously-untested
 * PaySolutions intent creators (the decompose plan flagged these as the only
 * uncovered surface before extracting the GatewayClient/Intent seam):
 *
 *   - createOnlineOrderIntent
 *   - createEarlyPayoffQR
 *   - createPartialPaymentQR
 *   - createSavingPlanIntent
 *
 * (createPaymentIntent is already exercised by paysolutions.intent-and-failed.)
 *
 * Pins, for each: the gateway request payload (merchantId / referenceNo /
 * amount / channel / postbackUrl / terminalId), the DB tracking write that
 * follows a successful gateway call, and the orphan-Sentry path (gateway OK
 * then DB write throws → Sentry.captureException with the call-site critical
 * tag + InternalServerErrorException). Run BEFORE the GatewayClient/Intent
 * extraction (pins current behaviour) and must stay green AFTER.
 *
 * Expected values are hand-traced from the implementation; CURRENT behaviour
 * only. Gateway is driven via a global.fetch spy returning a v2 success body.
 */
describe('PaySolutionsService — intent creators (characterization)', () => {
  let service: PaySolutionsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let fetchSpy: jest.SpyInstance;

  // A canonical Pay Solutions v2 success body.
  function gatewayOk(redirectUrl = 'https://pay.example/redirect') {
    return {
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        redirectUrl,
        transactionId: 'GW-TX-1',
        refNo: 'GW-REF-1',
        status: 'success',
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  async function buildService(): Promise<void> {
    const lineOa = {
      sendFlexMessage: jest.fn().mockResolvedValue(undefined),
      pushMessage: jest.fn().mockResolvedValue(undefined),
    } as Partial<LineOaService>;
    // merchantId/terminalId resolve through IntegrationConfigService — return a
    // stable non-empty value so the payload assertions can pin them.
    const integrationConfig = {
      getValue: jest.fn().mockImplementation((_ns: string, key: string) => {
        const map: Record<string, string> = {
          merchantId: 'MID-123',
          secretKey: 'SK-123',
          apiKey: 'AK-123',
          apiUrl: 'https://apis.paysolutions.test',
          terminalId: 'TID-XYZ',
        };
        return Promise.resolve(map[key] ?? '');
      }),
    } as Partial<IntegrationConfigService>;
    const config = {
      get: jest.fn().mockImplementation((_k: string, def?: string) => def ?? ''),
    } as Partial<ConfigService>;
    const saleAdapter = {} as Partial<OnlineOrderSaleAdapter>;
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
        { provide: PaymentsService, useValue: { recordPayment: jest.fn() } },
      ],
    }).compile();

    service = mod.get<PaySolutionsService>(PaySolutionsService);
  }

  /** Parse the JSON body the service POSTed to the gateway in the latest fetch. */
  function lastGatewayPayload(): Record<string, unknown> {
    const body = fetchSpy.mock.calls[0][1].body as string;
    return JSON.parse(body) as Record<string, unknown>;
  }

  beforeEach(() => {
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  // ===========================================================================
  // createOnlineOrderIntent
  // ===========================================================================
  describe('createOnlineOrderIntent', () => {
    const onlineOrderId = 'oo-1';

    function buildPrisma(overrides: Record<string, unknown> = {}): void {
      prisma = {
        onlineOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: onlineOrderId,
            orderNumber: 'OO-2026-0001',
            paymentLinkId: null,
            customer: { email: 'cust@example.com', name: 'ลูกค้า' },
            ...overrides,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        paymentLink: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'pl-new-1' }),
        },
      };
    }

    it('reuses an existing ACTIVE PaymentLink without calling the gateway', async () => {
      buildPrisma({ paymentLinkId: 'pl-existing' });
      prisma.paymentLink.findUnique.mockResolvedValueOnce({ id: 'pl-existing', status: 'ACTIVE' });
      await buildService();
      fetchSpy = jest.spyOn(global, 'fetch');

      const res = await service.createOnlineOrderIntent({
        onlineOrderId,
        amount: 9990,
        description: 'iPhone 15',
        channel: 'PROMPTPAY_QR',
      });

      expect(res).toEqual({ paymentLinkId: 'pl-existing', paymentUrl: '' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(prisma.paymentLink.create).not.toHaveBeenCalled();
    });

    it('PROMPTPAY_QR success: gateway payload (Qrcode/Promptpay + amount + postbackUrl) + creates PaymentLink + links order', async () => {
      buildPrisma();
      await buildService();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

      const res = await service.createOnlineOrderIntent({
        onlineOrderId,
        amount: 9990,
        description: 'iPhone 15',
        channel: 'PROMPTPAY_QR',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const payload = lastGatewayPayload();
      expect(payload.merchantId).toBe('MID-123');
      expect(payload.amount).toBe(9990);
      expect(payload.description).toBe('iPhone 15');
      expect(payload.paymentChannel).toBe('Qrcode');
      expect(payload.paymentGateway).toBe('Promptpay');
      expect(payload.terminalId).toBe('TID-XYZ');
      expect(payload.postbackUrl).toContain('/api/paysolutions/webhook');
      expect(typeof payload.referenceNo).toBe('string');

      // Tracking write: PaymentLink created, order linked back to it.
      expect(prisma.paymentLink.create).toHaveBeenCalledTimes(1);
      expect(prisma.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: onlineOrderId },
        data: { paymentLinkId: 'pl-new-1' },
      });
      expect(res).toEqual({
        paymentLinkId: 'pl-new-1',
        paymentUrl: 'https://pay.example/redirect',
      });
    });

    it('CREDIT_DEBIT_CARD: payment channel CreditDebit, no paymentGateway', async () => {
      buildPrisma();
      await buildService();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

      await service.createOnlineOrderIntent({
        onlineOrderId,
        amount: 5000,
        description: 'card pay',
        channel: 'CREDIT_DEBIT_CARD',
      });

      const payload = lastGatewayPayload();
      expect(payload.paymentChannel).toBe('CreditDebit');
      expect(payload.paymentGateway).toBeUndefined();
    });

    it('orphan path: gateway OK then PaymentLink.create throws → Sentry critical=paysolutions-online-orphan + InternalServerError', async () => {
      buildPrisma();
      prisma.paymentLink.create.mockRejectedValueOnce(new Error('DB down'));
      await buildService();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

      await expect(
        service.createOnlineOrderIntent({
          onlineOrderId,
          amount: 9990,
          description: 'iPhone 15',
          channel: 'PROMPTPAY_QR',
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      expect(Sentry.captureException as jest.Mock).toHaveBeenCalledTimes(1);
      const opts = (Sentry.captureException as jest.Mock).mock.calls[0][1];
      expect(opts.level).toBe('fatal');
      expect(opts.tags.critical).toBe('paysolutions-online-orphan');
    });
  });

  // ===========================================================================
  // createEarlyPayoffQR
  // ===========================================================================
  describe('createEarlyPayoffQR', () => {
    const contractId = 'ct-payoff-1';

    function buildPrisma(): void {
      prisma = {
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: contractId,
            deletedAt: null,
            contractNumber: 'CT-2026-0007',
            customer: { email: 'c@example.com', name: 'ลูกค้า', lineIdFinance: null },
          }),
        },
        paymentLink: {
          create: jest.fn().mockResolvedValue({ id: 'pl-payoff-1' }),
        },
      };
    }

    it('success: Qrcode/Promptpay payload + creates PaymentLink with contractId, returns orderRef + sentToLine=false (no lineId)', async () => {
      buildPrisma();
      await buildService();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

      const res = await service.createEarlyPayoffQR({
        contractId,
        amount: 12345,
        description: 'ปิดยอด',
      });

      const payload = lastGatewayPayload();
      expect(payload.amount).toBe(12345);
      expect(payload.paymentChannel).toBe('Qrcode');
      expect(payload.paymentGateway).toBe('Promptpay');
      expect(payload.description).toBe('ปิดยอด');

      // PaymentLink created WITH the contractId (so the webhook auto-closes it).
      expect(prisma.paymentLink.create).toHaveBeenCalledTimes(1);
      const linkData = prisma.paymentLink.create.mock.calls[0][0].data;
      expect(linkData.contractId).toBe(contractId);
      expect(linkData.amount).toBe(12345);
      expect(linkData.status).toBe('ACTIVE');

      expect(res.paymentLinkId).toBe('pl-payoff-1');
      expect(res.paymentUrl).toBe('https://pay.example/redirect');
      expect(typeof res.orderRef).toBe('string');
      // No lineIdFinance + no quoteContext → nothing pushed to LINE.
      expect(res.sentToLine).toBe(false);
    });

    it('orphan path: gateway OK then PaymentLink.create throws → Sentry critical=paysolutions-payoff-orphan + InternalServerError', async () => {
      buildPrisma();
      prisma.paymentLink.create.mockRejectedValueOnce(new Error('DB down'));
      await buildService();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

      await expect(
        service.createEarlyPayoffQR({ contractId, amount: 100, description: 'x' }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      const opts = (Sentry.captureException as jest.Mock).mock.calls[0][1];
      expect(opts.level).toBe('fatal');
      expect(opts.tags.critical).toBe('paysolutions-payoff-orphan');
    });
  });

  // ===========================================================================
  // createPartialPaymentQR
  // ===========================================================================
  describe('createPartialPaymentQR', () => {
    const paymentId = 'pay-partial-1';

    function buildPrisma(): void {
      prisma = {
        payment: {
          findUnique: jest.fn().mockResolvedValue({
            id: paymentId,
            deletedAt: null,
            status: 'PENDING',
            installmentNo: 4,
            contractId: 'ct-pp-1',
            amountDue: new Prisma.Decimal(2000),
            contract: {
              contractNumber: 'CT-2026-0008',
              customer: { id: 'cust-1', email: 'c@example.com', name: 'ลูกค้า', lineIdFinance: null },
            },
          }),
          count: jest.fn().mockResolvedValue(6),
        },
        partialPaymentLink: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({ id: 'ppl-1' }),
        },
      };
    }

    it('cancels prior ACTIVE links, then gateway Qrcode payload + creates PartialPaymentLink (24h) with gatewayRef from refNo', async () => {
      buildPrisma();
      await buildService();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

      const res = await service.createPartialPaymentQR({
        paymentId,
        amount: 700,
        description: 'แบ่งชำระ',
      });

      // Single-outstanding-QR rule: cancel earlier ACTIVE links first.
      expect(prisma.partialPaymentLink.updateMany).toHaveBeenCalledWith({
        where: { paymentId, status: 'ACTIVE' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });

      const payload = lastGatewayPayload();
      expect(payload.amount).toBe(700);
      expect(payload.paymentChannel).toBe('Qrcode');
      expect(payload.paymentGateway).toBe('Promptpay');
      expect(payload.description).toBe('แบ่งชำระ');

      // PartialPaymentLink created, carrying gatewayRef from gatewayResponse.refNo.
      expect(prisma.partialPaymentLink.create).toHaveBeenCalledTimes(1);
      const linkData = prisma.partialPaymentLink.create.mock.calls[0][0].data;
      expect(linkData.paymentId).toBe(paymentId);
      expect(linkData.contractId).toBe('ct-pp-1');
      expect(linkData.customerId).toBe('cust-1');
      expect(linkData.amount).toBe(700);
      expect(linkData.gatewayRef).toBe('GW-REF-1');
      expect(linkData.status).toBe('ACTIVE');

      expect(res.partialPaymentLinkId).toBe('ppl-1');
      expect(res.paymentUrl).toBe('https://pay.example/redirect');
      expect(typeof res.orderRef).toBe('string');
      expect(res.sentToLine).toBe(false);
    });

    it('orphan path: gateway OK then PartialPaymentLink.create throws → Sentry critical=paysolutions-partial-orphan + InternalServerError', async () => {
      buildPrisma();
      prisma.partialPaymentLink.create.mockRejectedValueOnce(new Error('DB down'));
      await buildService();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

      await expect(
        service.createPartialPaymentQR({ paymentId, amount: 700 }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      const opts = (Sentry.captureException as jest.Mock).mock.calls[0][1];
      expect(opts.level).toBe('fatal');
      expect(opts.tags.critical).toBe('paysolutions-partial-orphan');
    });
  });

  // ===========================================================================
  // createSavingPlanIntent
  // ===========================================================================
  describe('createSavingPlanIntent', () => {
    const savingPlanId = 'sp-1';

    function buildPrisma(): void {
      prisma = {
        savingPlan: {
          findUnique: jest.fn().mockResolvedValue({
            id: savingPlanId,
            customer: { email: 'c@example.com', name: 'ลูกค้า' },
          }),
        },
        paymentLink: {
          create: jest.fn().mockResolvedValue({ id: 'pl-sp-1' }),
        },
      };
    }

    it('success: Qrcode/Promptpay payload + creates PaymentLink carrying savingPlanId', async () => {
      buildPrisma();
      await buildService();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

      const res = await service.createSavingPlanIntent({
        savingPlanId,
        amount: 1000,
        description: 'ออมดาวน์',
      });

      const payload = lastGatewayPayload();
      expect(payload.amount).toBe(1000);
      expect(payload.paymentChannel).toBe('Qrcode');
      expect(payload.paymentGateway).toBe('Promptpay');
      expect(payload.description).toBe('ออมดาวน์');

      // PaymentLink created WITH savingPlanId (the webhook saving-plan route key).
      expect(prisma.paymentLink.create).toHaveBeenCalledTimes(1);
      const linkData = prisma.paymentLink.create.mock.calls[0][0].data;
      expect(linkData.savingPlanId).toBe(savingPlanId);
      expect(linkData.amount).toBe(1000);
      expect(linkData.status).toBe('ACTIVE');

      expect(res).toEqual({
        paymentLinkId: 'pl-sp-1',
        paymentUrl: 'https://pay.example/redirect',
      });
    });

    it('orphan path: gateway OK then PaymentLink.create throws → Sentry critical=paysolutions-saving-plan-orphan + InternalServerError', async () => {
      buildPrisma();
      prisma.paymentLink.create.mockRejectedValueOnce(new Error('DB down'));
      await buildService();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

      await expect(
        service.createSavingPlanIntent({ savingPlanId, amount: 1000, description: 'x' }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      const opts = (Sentry.captureException as jest.Mock).mock.calls[0][1];
      expect(opts.level).toBe('fatal');
      expect(opts.tags.critical).toBe('paysolutions-saving-plan-orphan');
    });
  });
});
