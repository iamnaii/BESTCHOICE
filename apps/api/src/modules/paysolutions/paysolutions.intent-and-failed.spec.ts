import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
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

// Same Sentry-transport stub the sibling specs use — captureException /
// captureMessage are asserted directly in the orphan-intent test.
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * CHARACTERIZATION (golden) spec — Wave 3 MED gap-fill for PaySolutionsService.
 *
 * Pins CURRENT behaviour of shipped code that the existing specs
 * (paysolutions.service.spec.ts / .callbacks / .callback-money) DO NOT exercise:
 *
 *   A. handlePaymentCallback FAILED path (result_code != '00', 1319-1338)
 *        - paymentLink.paymentId set → payment.update gatewayStatus:'FAILED'
 *          ONLY (amountPaid/status UNTOUCHED — no credit), gatewayResponse stored
 *        - paymentLink.update status:'EXPIRED'
 *        - NO JE (paymentReceipt2BTemplate.execute), NO $transaction, NO
 *          success notification
 *        - paymentId null → payment.update SKIPPED, link still EXPIRED
 *   B. routing pre-checks in handlePaymentCallback (916-1028)
 *        - partialPaymentLink found → handlePartialPaymentCallback invoked,
 *          regular PaymentLink distribution NOT run
 *        - savingPlanId + '00' → confirmSavingPlanPayment + link → USED
 *        - savingPlanId + '99' → link → EXPIRED, confirmSavingPlanPayment NOT run
 *   C. createPaymentIntent amount-match guards (141-159)
 *        - installment already PAID → BadRequest 'ชำระเรียบร้อยแล้ว'
 *        - amount != amountDue+lateFee-amountPaid → BadRequest 'ยอดชำระไม่ตรง'
 *        - exact match (within 0.01 dClose tolerance) → passes the guard
 *   D. orphan-intent Sentry (262-308)
 *        - gateway call OK, then DB $transaction throws → Sentry.captureException
 *          tags.critical='paysolutions-orphan-intent' carrying gatewayRef,
 *          then InternalServerErrorException
 *
 * Expected values are hand-traced from the implementation; we assert CURRENT
 * behaviour only. Money is Prisma.Decimal — compared via .toString().
 */
describe('PaySolutionsService — intent guards + FAILED/routing callbacks (characterization)', () => {
  let service: PaySolutionsService;
  // Hand-mocked Prisma surface — only the members the path under test touches.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let template2B: { execute: jest.Mock };
  let payments: { recordPayment: jest.Mock };

  /**
   * Build a fresh service around the current `prisma` mock, re-wiring the
   * collaborator mocks each time so per-test overrides stay isolated.
   */
  async function buildService(): Promise<void> {
    template2B = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) };
    payments = { recordPayment: jest.fn().mockResolvedValue(undefined) };

    const lineOa = {
      sendFlexMessage: jest.fn().mockResolvedValue(undefined),
      pushMessage: jest.fn().mockResolvedValue(undefined),
    } as Partial<LineOaService>;
    const integrationConfig = {
      getValue: jest.fn().mockResolvedValue(''),
    } as Partial<IntegrationConfigService>;
    const config = {
      get: jest
        .fn()
        .mockImplementation((_k: string, def?: string) => def ?? ''),
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
        { provide: PaymentReceipt2BTemplate, useValue: template2B },
        { provide: PaymentsService, useValue: payments },
      ],
    }).compile();

    service = mod.get<PaySolutionsService>(PaySolutionsService);
  }

  beforeEach(() => {
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  // ===========================================================================
  // A) handlePaymentCallback — FAILED path (result_code != '00', 1319-1338)
  // ===========================================================================
  describe('handlePaymentCallback — FAILED path', () => {
    const refno = 'refno-fail-1';
    const linkId = 'link-fail-1';
    const paymentId = 'pay-fail-1';
    const contractId = 'ct-fail-1';

    function buildFailPrisma(
      linkOverrides: Record<string, unknown> = {},
    ): void {
      prisma = {
        partialPaymentLink: {
          // No partial-payment link for this refno → falls through to the
          // regular PaymentLink path.
          findUnique: jest.fn().mockResolvedValue(null),
        },
        paymentLink: {
          findFirst: jest.fn().mockResolvedValue({
            id: linkId,
            token: refno,
            status: 'ACTIVE',
            contractId,
            paymentId,
            amount: new Prisma.Decimal(1000),
            savingPlanId: null,
            payment: { id: paymentId },
            ...linkOverrides,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        payment: {
          update: jest.fn().mockResolvedValue({}),
        },
        // Present so an accidental success-path read would be observable; the
        // FAILED path must NEVER open a transaction.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $transaction: jest.fn().mockImplementation(async (cb: any) => cb({})),
      };
    }

    it("result_code='99' with paymentId: payment.update sets gatewayStatus FAILED ONLY (no credit), link EXPIRED, no JE/notification", async () => {
      buildFailPrisma();
      await buildService();
      const sendSuccessSpy = jest
        .spyOn(
          service as unknown as Record<string, () => Promise<void>>,
          'sendPaymentSuccessNotification',
        )
        .mockResolvedValue(undefined);

      await service.handlePaymentCallback({
        refno,
        result_code: '99',
        order_no: 'o-1',
        transaction_id: 'tx-fail',
        total: '1000',
      });

      // (a) Payment row touched exactly once, marking only the gateway status.
      expect(prisma.payment.update).toHaveBeenCalledTimes(1);
      const payArg = prisma.payment.update.mock.calls[0][0];
      expect(payArg.where).toEqual({ id: paymentId });
      expect(payArg.data.gatewayStatus).toBe('FAILED');
      // QUIRK / contract: the failed webhook DOES NOT credit anything — no
      // amountPaid, no status, no paidDate keys are written.
      expect('amountPaid' in payArg.data).toBe(false);
      expect('status' in payArg.data).toBe(false);
      expect('paidDate' in payArg.data).toBe(false);
      expect('paidAt' in payArg.data).toBe(false);
      // The raw webhook payload is persisted for audit.
      expect(payArg.data.gatewayResponse).toEqual(
        expect.objectContaining({ result_code: '99', refno }),
      );

      // (b) Link flipped to EXPIRED so the customer can retry.
      expect(prisma.paymentLink.update).toHaveBeenCalledTimes(1);
      expect(prisma.paymentLink.update).toHaveBeenCalledWith({
        where: { id: linkId },
        data: { status: 'EXPIRED' },
      });

      // (c) No success machinery ran.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(template2B.execute).not.toHaveBeenCalled();
      expect(sendSuccessSpy).not.toHaveBeenCalled();
    });

    it("result_code='99' with paymentId NULL: payment.update SKIPPED, link still EXPIRED", async () => {
      buildFailPrisma({ paymentId: null, payment: null });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '99',
        order_no: 'o-1',
        transaction_id: 'tx-fail',
        total: '1000',
      });

      // No paymentId → the conditional payment.update is skipped entirely.
      expect(prisma.payment.update).not.toHaveBeenCalled();
      // Link is still expired regardless.
      expect(prisma.paymentLink.update).toHaveBeenCalledWith({
        where: { id: linkId },
        data: { status: 'EXPIRED' },
      });
    });
  });

  // ===========================================================================
  // B) handlePaymentCallback — routing pre-checks (916-1028)
  // ===========================================================================
  describe('handlePaymentCallback — routing pre-checks', () => {
    it('partialPaymentLink found → routes to handlePartialPaymentCallback, regular distribution NOT run', async () => {
      const refno = 'refno-partial-route';
      const partialLink = {
        id: 'pplink-route-1',
        status: 'ACTIVE',
        paymentId: 'pay-pp-1',
        amount: new Prisma.Decimal(500),
        gatewayRef: null,
      };
      prisma = {
        partialPaymentLink: {
          findUnique: jest.fn().mockResolvedValue(partialLink),
        },
        // If the regular path were (wrongly) taken this would be consulted.
        paymentLink: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      await buildService();

      // Stub the delegate so we only assert the ROUTING decision here.
      const partialSpy = jest
        .spyOn(service, 'handlePartialPaymentCallback')
        .mockResolvedValue(undefined);

      const webhook = {
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '500',
      };
      await service.handlePaymentCallback(webhook);

      // Delegated to the partial handler with the found link + raw webhook.
      expect(partialSpy).toHaveBeenCalledTimes(1);
      expect(partialSpy).toHaveBeenCalledWith(partialLink, webhook);
      // Regular PaymentLink distribution short-circuited (return after route).
      expect(prisma.paymentLink.findFirst).not.toHaveBeenCalled();
    });

    it("savingPlanId + result_code='00' → confirmSavingPlanPayment then link → USED", async () => {
      const refno = 'refno-sp-success';
      const linkId = 'splink-route-1';
      prisma = {
        partialPaymentLink: { findUnique: jest.fn().mockResolvedValue(null) },
        paymentLink: {
          findFirst: jest.fn().mockResolvedValue({
            id: linkId,
            token: refno,
            status: 'ACTIVE',
            contractId: null,
            paymentId: null,
            amount: new Prisma.Decimal(2000),
            savingPlanId: 'sp-route-1',
            payment: null,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      await buildService();
      const confirmSpy = jest
        .spyOn(service, 'confirmSavingPlanPayment')
        .mockResolvedValue(undefined);

      const webhook = {
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-sp',
        total: '2000',
      };
      await service.handlePaymentCallback(webhook);

      // Saving-plan confirm runs with (planId, linkId, webhook).
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy).toHaveBeenCalledWith('sp-route-1', linkId, webhook);
      // Link consumed.
      expect(prisma.paymentLink.update).toHaveBeenCalledWith({
        where: { id: linkId },
        data: expect.objectContaining({ status: 'USED', usedAt: expect.any(Date) }),
      });
    });

    it("savingPlanId + result_code='99' → link → EXPIRED, confirmSavingPlanPayment NOT run", async () => {
      const refno = 'refno-sp-fail';
      const linkId = 'splink-route-2';
      prisma = {
        partialPaymentLink: { findUnique: jest.fn().mockResolvedValue(null) },
        paymentLink: {
          findFirst: jest.fn().mockResolvedValue({
            id: linkId,
            token: refno,
            status: 'ACTIVE',
            contractId: null,
            paymentId: null,
            amount: new Prisma.Decimal(2000),
            savingPlanId: 'sp-route-2',
            payment: null,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      await buildService();
      const confirmSpy = jest
        .spyOn(service, 'confirmSavingPlanPayment')
        .mockResolvedValue(undefined);

      await service.handlePaymentCallback({
        refno,
        result_code: '99',
        order_no: 'o-1',
        transaction_id: 'tx-sp',
        total: '2000',
      });

      // No saving-plan confirm on failure.
      expect(confirmSpy).not.toHaveBeenCalled();
      // Link expired (NOT used).
      expect(prisma.paymentLink.update).toHaveBeenCalledWith({
        where: { id: linkId },
        data: { status: 'EXPIRED' },
      });
    });
  });

  // ===========================================================================
  // C) createPaymentIntent — amount-match guards (141-159)
  // ===========================================================================
  describe('createPaymentIntent — amount guards', () => {
    const contractId = 'ct-intent-1';
    const lineId = 'U-line-finance-1';
    const installmentNo = 2;

    function buildIntentPrisma(
      paymentRow: Record<string, unknown> | null,
    ): void {
      prisma = {
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: contractId,
            deletedAt: null,
            contractNumber: 'CT-2026-0009',
            customer: {
              name: 'ลูกค้า ทดสอบ',
              phone: '0800000000',
              email: 'cust@example.com',
              lineIdFinance: lineId,
            },
          }),
        },
        payment: {
          findUnique: jest.fn().mockResolvedValue(paymentRow),
        },
      };
    }

    it("installment already PAID → BadRequest 'ชำระเรียบร้อยแล้ว' (before any gateway call)", async () => {
      buildIntentPrisma({
        id: 'pay-paid-1',
        status: 'PAID',
        amountDue: new Prisma.Decimal(1000),
        lateFee: new Prisma.Decimal(0),
        amountPaid: new Prisma.Decimal(1000),
      });
      await buildService();

      await expect(
        service.createPaymentIntent(
          contractId,
          1000,
          undefined,
          lineId,
          installmentNo,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining('ชำระเรียบร้อยแล้ว'),
      });
    });

    it("amount mismatch → BadRequest 'ยอดชำระไม่ตรง' (expected = amountDue + lateFee - amountPaid)", async () => {
      // expected = 1000 + 50 - 200 = 850. We send 800 → mismatch.
      buildIntentPrisma({
        id: 'pay-mismatch-1',
        status: 'PENDING',
        amountDue: new Prisma.Decimal(1000),
        lateFee: new Prisma.Decimal(50),
        amountPaid: new Prisma.Decimal(200),
      });
      await buildService();

      await expect(
        service.createPaymentIntent(
          contractId,
          800,
          undefined,
          lineId,
          installmentNo,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        // Thai message embeds both the sent amount and the real outstanding.
        message: expect.stringContaining('ยอดชำระไม่ตรง'),
      });
    });

    it('exact match within 0.01 tolerance → passes the amount guard (reaches the gateway call, not a BadRequest)', async () => {
      // expected = 1000 + 50 - 200 = 850. Send 850 → dClose true → no throw.
      buildIntentPrisma({
        id: 'pay-match-1',
        status: 'PENDING',
        amountDue: new Prisma.Decimal(1000),
        lateFee: new Prisma.Decimal(50),
        amountPaid: new Prisma.Decimal(200),
      });
      await buildService();

      // Make the gateway call fail fast AFTER the guards so we can prove the
      // guard passed without standing up the full happy-path DB surface. A
      // BadRequestException would mean the amount guard rejected; an
      // InternalServerError (connection failed) means we got past the guard.
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('network down'));

      await expect(
        service.createPaymentIntent(
          contractId,
          850,
          undefined,
          lineId,
          installmentNo,
        ),
      ).rejects.toMatchObject({ constructor: InternalServerErrorException });

      // Proof we passed the guard and actually reached the gateway fetch.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    });
  });

  // ===========================================================================
  // D) createPaymentIntent — orphan-intent Sentry (262-308)
  // ===========================================================================
  describe('createPaymentIntent — orphan-intent Sentry on DB failure after gateway success', () => {
    const contractId = 'ct-orphan-1';
    const lineId = 'U-line-finance-orphan';

    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
      fetchSpy?.mockRestore();
    });

    it("gateway OK then $transaction throws → Sentry.captureException tags critical='paysolutions-orphan-intent' carrying gatewayRef, then InternalServerError", async () => {
      const dbError = new Error('DB write failed mid-tx');
      prisma = {
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: contractId,
            deletedAt: null,
            contractNumber: 'CT-2026-0011',
            customer: {
              name: 'ลูกค้า ออร์แฟน',
              phone: '0810000000',
              email: 'orphan@example.com',
              lineIdFinance: lineId,
            },
          }),
        },
        // No installmentNo passed → payment lookup skipped (paymentRecord null).
        // The orphan path is the $transaction that creates the PaymentLink.
        $transaction: jest.fn().mockRejectedValue(dbError),
      };
      await buildService();

      // Gateway call SUCCEEDS — transactionId becomes the gatewayRef carried
      // into the Sentry tag.
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          redirectUrl: 'https://pay.example/redirect',
          transactionId: 'GATEWAY-REF-XYZ',
          status: 'success',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await expect(
        // No installmentNo → goes straight to the orphan-prone $transaction.
        service.createPaymentIntent(contractId, 1234, 'ปิดยอด', lineId),
      ).rejects.toMatchObject({
        constructor: InternalServerErrorException,
        message: expect.stringContaining('ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ'),
      });

      // The gateway intent already minted → orphan alarm with the gatewayRef.
      expect(Sentry.captureException as jest.Mock).toHaveBeenCalledTimes(1);
      const [capturedErr, capturedOpts] = (
        Sentry.captureException as jest.Mock
      ).mock.calls[0];
      expect(capturedErr).toBe(dbError);
      expect(capturedOpts.level).toBe('fatal');
      expect(capturedOpts.tags.critical).toBe('paysolutions-orphan-intent');
      // gatewayRef = gatewayResponse.transactionId (the live gateway intent id).
      expect(capturedOpts.tags.gatewayRef).toBe('GATEWAY-REF-XYZ');
      // orderRef is the numeric ref; extra carries contract + amount for ops.
      expect(capturedOpts.tags.orderRef).toEqual(expect.any(String));
      expect(capturedOpts.extra).toEqual(
        expect.objectContaining({ contractId, amount: 1234 }),
      );
    });
  });
});
