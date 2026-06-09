import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
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
import { buildEarlyPayoffSuccessFlex } from '../line-oa/flex-messages/early-payoff-success.flex';

// The early-payoff flex builder is a plain module import (not an injected dep),
// so we mock the module to capture the EXACT { originalAmount, savings,
// amountPaid } numbers the service computes and hands to it. The returned
// sentinel is then asserted to flow through to lineOaService.sendFlexMessage.
jest.mock('../line-oa/flex-messages/early-payoff-success.flex', () => ({
  buildEarlyPayoffSuccessFlex: jest.fn(() => ({ __flex: 'early-payoff' })),
}));

/**
 * CHARACTERIZATION (golden) spec — Wave 3 LOW gap-fill for PaySolutionsService.
 *
 * Pins CURRENT behaviour of two shipped methods the sibling specs
 * (paysolutions.service.spec.ts / .callbacks / .callback-money /
 * .intent-and-failed) DO NOT exercise:
 *
 *   1. getPaymentStatus (1434-1485) — status-derivation precedence:
 *        Payment branch (row found by id):
 *          - payment.status === 'PAID'                 → 'PAID'
 *          - else gatewayStatus === 'FAILED'           → 'FAILED'
 *          - else                                      → 'PENDING'
 *        PaymentLink branch (token lookup when no Payment row):
 *          - no link                                   → NotFoundException
 *          - link USED + link.payment PAID             → 'PAID'
 *          - link EXPIRED                              → 'FAILED'
 *          - else                                      → 'PENDING'
 *        QUIRK: the Payment branch's PAID check wins even when gatewayStatus is
 *        also 'FAILED' (status precedes gatewayStatus). amount in the Payment
 *        branch comes from payment.amountDue; in the link branch from link.amount.
 *
 *   2. sendEarlyPayoffSuccessNotification savings arithmetic (1391-1429):
 *        originalAmount = Σ over contract.payments of
 *          amountDue + (lateFeeWaived ? 0 : lateFee)   [Prisma.Decimal ops]
 *        savings = Decimal.max(originalAmount - paidAmount, 0)  (clamped >= 0)
 *        These (Number()-ified) plus amountPaid=Number(paidAmount) are passed to
 *        buildEarlyPayoffSuccessFlex, whose result is sent via
 *        lineOaService.sendFlexMessage(lineIdFinance, flex, 'line-finance').
 *        Display-only (not a regulated JE) — but the arithmetic is pinned here.
 *        QUIRK: no lineIdFinance → early return, NOTHING sent. The method also
 *        swallows any error (try/catch logs only) — webhook never fails on it.
 *
 * Expected values are hand-traced from the implementation; CURRENT behaviour
 * only. Money is Prisma.Decimal — the flex receives Number()-coerced values.
 */
describe('PaySolutionsService — getPaymentStatus + early-payoff savings (characterization)', () => {
  let service: PaySolutionsService;
  // Hand-mocked Prisma surface — only the members the path under test touches.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let lineOa: { sendFlexMessage: jest.Mock; pushMessage: jest.Mock };

  /** Typed accessor for the private notification method under test. */
  type WithPrivate = {
    sendEarlyPayoffSuccessNotification(
      contractId: string,
      paidAmount: Prisma.Decimal,
    ): Promise<void>;
  };

  /**
   * Build a fresh service around the current `prisma` mock, re-wiring the
   * collaborator mocks each time so per-test overrides stay isolated.
   */
  async function buildService(): Promise<void> {
    lineOa = {
      sendFlexMessage: jest.fn().mockResolvedValue(undefined),
      pushMessage: jest.fn().mockResolvedValue(undefined),
    };
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
    const journalAuto = {
      createPaymentJournal: jest.fn().mockResolvedValue('je-1'),
    } as Partial<JournalAutoService>;
    const template = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE' }) };
    const vat60Reversal = { execute: jest.fn().mockResolvedValue(null) };
    const payments = { recordPayment: jest.fn().mockResolvedValue(undefined) };

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
        { provide: PaymentReceiptTemplate, useValue: template },
        { provide: Vat60dayReversalTemplate, useValue: vat60Reversal },
        { provide: PaymentsService, useValue: payments },
      ],
    }).compile();

    service = mod.get<PaySolutionsService>(PaySolutionsService);
  }

  beforeEach(() => {
    (buildEarlyPayoffSuccessFlex as jest.Mock).mockClear();
  });

  // ===========================================================================
  // 1) getPaymentStatus — Payment branch (row found by id)
  // ===========================================================================
  describe('getPaymentStatus — Payment row found by id', () => {
    function buildPaymentPrisma(payment: Record<string, unknown>): void {
      prisma = {
        payment: { findUnique: jest.fn().mockResolvedValue(payment) },
        // Should never be consulted once a Payment row is found.
        paymentLink: { findFirst: jest.fn().mockResolvedValue(null) },
      };
    }

    it("payment.status === 'PAID' → 'PAID' (amount from amountDue, paidAt passthrough)", async () => {
      const paidAt = new Date('2026-06-08T03:00:00.000Z');
      buildPaymentPrisma({
        id: 'pay-1',
        status: 'PAID',
        gatewayStatus: 'SUCCESS',
        gatewayRef: 'gw-1',
        amountDue: new Prisma.Decimal('1515.83'),
        paidAt,
      });
      await buildService();

      const res = await service.getPaymentStatus('pay-1');

      expect(res).toEqual({
        paymentId: 'pay-1',
        status: 'PAID',
        gatewayRef: 'gw-1',
        gatewayStatus: 'SUCCESS',
        amount: 1515.83,
        paidAt,
      });
      // Link path never reached.
      expect(prisma.paymentLink.findFirst).not.toHaveBeenCalled();
    });

    it("status='PAID' WINS even when gatewayStatus='FAILED' (status precedes gatewayStatus)", async () => {
      buildPaymentPrisma({
        id: 'pay-paid-failed',
        status: 'PAID',
        gatewayStatus: 'FAILED',
        gatewayRef: 'gw-2',
        amountDue: new Prisma.Decimal('1000'),
        paidAt: null,
      });
      await buildService();

      const res = await service.getPaymentStatus('pay-paid-failed');

      // QUIRK: even though gatewayStatus is FAILED, the PAID status short-circuits.
      expect(res.status).toBe('PAID');
      // paidAt null → coerced to undefined by `|| undefined`.
      expect(res.paidAt).toBeUndefined();
      expect(res.gatewayStatus).toBe('FAILED');
      expect(res.amount).toBe(1000);
    });

    it("not PAID + gatewayStatus='FAILED' → 'FAILED'", async () => {
      buildPaymentPrisma({
        id: 'pay-failed',
        status: 'PENDING',
        gatewayStatus: 'FAILED',
        gatewayRef: 'gw-3',
        amountDue: new Prisma.Decimal('500'),
        paidAt: null,
      });
      await buildService();

      const res = await service.getPaymentStatus('pay-failed');

      expect(res.status).toBe('FAILED');
      expect(res.amount).toBe(500);
    });

    it("not PAID + gatewayStatus not FAILED → 'PENDING' (null gatewayRef/gatewayStatus → undefined)", async () => {
      buildPaymentPrisma({
        id: 'pay-pending',
        status: 'PENDING',
        gatewayStatus: null,
        gatewayRef: null,
        amountDue: new Prisma.Decimal('250.50'),
        paidAt: null,
      });
      await buildService();

      const res = await service.getPaymentStatus('pay-pending');

      expect(res).toEqual({
        paymentId: 'pay-pending',
        status: 'PENDING',
        gatewayRef: undefined,
        gatewayStatus: undefined,
        amount: 250.5,
        paidAt: undefined,
      });
    });
  });

  // ===========================================================================
  // 1b) getPaymentStatus — PaymentLink branch (no Payment row → token lookup)
  // ===========================================================================
  describe('getPaymentStatus — PaymentLink token branch', () => {
    function buildLinkPrisma(link: Record<string, unknown> | null): void {
      prisma = {
        payment: { findUnique: jest.fn().mockResolvedValue(null) },
        paymentLink: { findFirst: jest.fn().mockResolvedValue(link) },
      };
    }

    it('no Payment row and no PaymentLink → NotFoundException', async () => {
      buildLinkPrisma(null);
      await buildService();

      await expect(service.getPaymentStatus('missing-token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getPaymentStatus('missing-token')).rejects.toThrow(
        'ไม่พบรายการชำระเงิน',
      );
    });

    it("link USED + link.payment.status='PAID' → 'PAID' (amount from link.amount, ids from link.payment)", async () => {
      const paidAt = new Date('2026-06-07T10:00:00.000Z');
      buildLinkPrisma({
        id: 'link-1',
        token: 'tok-used',
        status: 'USED',
        amount: new Prisma.Decimal('3000'),
        payment: {
          id: 'pay-of-link',
          status: 'PAID',
          gatewayRef: 'gw-link',
          gatewayStatus: 'SUCCESS',
          paidAt,
        },
      });
      await buildService();

      const res = await service.getPaymentStatus('tok-used');

      expect(res).toEqual({
        paymentId: 'pay-of-link',
        status: 'PAID',
        gatewayRef: 'gw-link',
        gatewayStatus: 'SUCCESS',
        amount: 3000,
        paidAt,
      });
    });

    it("link USED but link.payment.status NOT 'PAID' → falls through to 'PENDING' (paymentId = link.id)", async () => {
      // QUIRK: USED alone is not enough — the joined payment must also be PAID.
      // Since the link is neither EXPIRED, it lands in the final PENDING branch,
      // which reports the LINK id (not the payment id).
      buildLinkPrisma({
        id: 'link-used-unpaid',
        token: 'tok-used-unpaid',
        status: 'USED',
        amount: new Prisma.Decimal('1200'),
        payment: { id: 'pay-x', status: 'PENDING' },
      });
      await buildService();

      const res = await service.getPaymentStatus('tok-used-unpaid');

      expect(res).toEqual({
        paymentId: 'link-used-unpaid',
        status: 'PENDING',
        amount: 1200,
      });
    });

    it("link EXPIRED → 'FAILED' (paymentId = link.id, no gateway fields)", async () => {
      buildLinkPrisma({
        id: 'link-expired',
        token: 'tok-expired',
        status: 'EXPIRED',
        amount: new Prisma.Decimal('800'),
        payment: null,
      });
      await buildService();

      const res = await service.getPaymentStatus('tok-expired');

      expect(res).toEqual({
        paymentId: 'link-expired',
        status: 'FAILED',
        amount: 800,
      });
    });

    it("link ACTIVE (not USED-PAID, not EXPIRED) → 'PENDING' (paymentId = link.id)", async () => {
      buildLinkPrisma({
        id: 'link-active',
        token: 'tok-active',
        status: 'ACTIVE',
        amount: new Prisma.Decimal('999.99'),
        payment: null,
      });
      await buildService();

      const res = await service.getPaymentStatus('tok-active');

      expect(res).toEqual({
        paymentId: 'link-active',
        status: 'PENDING',
        amount: 999.99,
      });
    });

    it("link status='USED' with NULL payment → PENDING (optional-chain guards the PAID check)", async () => {
      // link.payment?.status with payment=null is undefined !== 'PAID', so the
      // USED-PAID branch is skipped; not EXPIRED → final PENDING.
      buildLinkPrisma({
        id: 'link-used-nopay',
        token: 'tok-used-nopay',
        status: 'USED',
        amount: new Prisma.Decimal('100'),
        payment: null,
      });
      await buildService();

      const res = await service.getPaymentStatus('tok-used-nopay');

      expect(res).toEqual({
        paymentId: 'link-used-nopay',
        status: 'PENDING',
        amount: 100,
      });
    });
  });

  // ===========================================================================
  // 2) sendEarlyPayoffSuccessNotification — savings arithmetic
  // ===========================================================================
  describe('sendEarlyPayoffSuccessNotification — originalAmount / savings', () => {
    function buildContractPrisma(contract: Record<string, unknown> | null): void {
      prisma = {
        contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      };
    }

    async function invoke(contractId: string, paidAmount: Prisma.Decimal): Promise<void> {
      await (service as unknown as WithPrivate).sendEarlyPayoffSuccessNotification(
        contractId,
        paidAmount,
      );
    }

    it('originalAmount = Σ(amountDue + lateFee); waived late fee excluded; savings = original - paid', async () => {
      // Three installments:
      //   p1: 1000 + 50 (not waived)           = 1050
      //   p2: 1000 + 80 (WAIVED → lateFee 0)   = 1000
      //   p3:  500 +  0                          =  500
      // originalAmount = 2550 ; paid = 2000 ; savings = 550
      buildContractPrisma({
        id: 'ct-1',
        contractNumber: 'CT-0001',
        customer: { name: 'สมชาย ใจดี', lineIdFinance: 'Ufinance1' },
        payments: [
          {
            amountDue: new Prisma.Decimal('1000'),
            lateFee: new Prisma.Decimal('50'),
            lateFeeWaived: false,
          },
          {
            amountDue: new Prisma.Decimal('1000'),
            lateFee: new Prisma.Decimal('80'),
            lateFeeWaived: true,
          },
          {
            amountDue: new Prisma.Decimal('500'),
            lateFee: new Prisma.Decimal('0'),
            lateFeeWaived: false,
          },
        ],
      });
      await buildService();

      await invoke('ct-1', new Prisma.Decimal('2000'));

      expect(buildEarlyPayoffSuccessFlex).toHaveBeenCalledTimes(1);
      const arg = (buildEarlyPayoffSuccessFlex as jest.Mock).mock.calls[0][0];
      expect(arg.originalAmount).toBe(2550);
      expect(arg.savings).toBe(550);
      expect(arg.amountPaid).toBe(2000);
      expect(arg.customerName).toBe('สมชาย ใจดี');
      expect(arg.contractNumber).toBe('CT-0001');

      // The built flex sentinel is forwarded on the FINANCE channel.
      expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
      expect(lineOa.sendFlexMessage).toHaveBeenCalledWith(
        'Ufinance1',
        { __flex: 'early-payoff' },
        'line-finance',
      );
    });

    it('savings clamps to 0 when paidAmount > originalAmount (Decimal.max guard)', async () => {
      // originalAmount = 1000 ; paid = 1500 → raw diff -500 → clamped to 0.
      buildContractPrisma({
        id: 'ct-2',
        contractNumber: 'CT-0002',
        customer: { name: 'A', lineIdFinance: 'Uf2' },
        payments: [
          {
            amountDue: new Prisma.Decimal('1000'),
            lateFee: new Prisma.Decimal('0'),
            lateFeeWaived: false,
          },
        ],
      });
      await buildService();

      await invoke('ct-2', new Prisma.Decimal('1500'));

      const arg = (buildEarlyPayoffSuccessFlex as jest.Mock).mock.calls[0][0];
      expect(arg.originalAmount).toBe(1000);
      expect(arg.amountPaid).toBe(1500);
      // QUIRK: never negative — Decimal.max(diff, 0).
      expect(arg.savings).toBe(0);
    });

    it('fractional late fees sum precisely (Decimal arithmetic, not float)', async () => {
      // p1: 1416.66 + 0.17 = 1416.83 ; p2: 1416.66 + 0.18 = 1416.84
      // originalAmount = 2833.67 ; paid = 2800.00 ; savings = 33.67
      buildContractPrisma({
        id: 'ct-3',
        contractNumber: 'CT-0003',
        customer: { name: 'B', lineIdFinance: 'Uf3' },
        payments: [
          {
            amountDue: new Prisma.Decimal('1416.66'),
            lateFee: new Prisma.Decimal('0.17'),
            lateFeeWaived: false,
          },
          {
            amountDue: new Prisma.Decimal('1416.66'),
            lateFee: new Prisma.Decimal('0.18'),
            lateFeeWaived: false,
          },
        ],
      });
      await buildService();

      await invoke('ct-3', new Prisma.Decimal('2800.00'));

      const arg = (buildEarlyPayoffSuccessFlex as jest.Mock).mock.calls[0][0];
      expect(arg.originalAmount).toBe(2833.67);
      expect(arg.savings).toBe(33.67);
    });

    it('no lineIdFinance → early return, NOTHING built or sent', async () => {
      buildContractPrisma({
        id: 'ct-4',
        contractNumber: 'CT-0004',
        customer: { name: 'C', lineIdFinance: null },
        payments: [
          {
            amountDue: new Prisma.Decimal('1000'),
            lateFee: new Prisma.Decimal('0'),
            lateFeeWaived: false,
          },
        ],
      });
      await buildService();

      await invoke('ct-4', new Prisma.Decimal('900'));

      expect(buildEarlyPayoffSuccessFlex).not.toHaveBeenCalled();
      expect(lineOa.sendFlexMessage).not.toHaveBeenCalled();
    });

    it('contract not found → early return (guarded by ?.customer optional chain), NOTHING sent', async () => {
      buildContractPrisma(null);
      await buildService();

      // Should not throw — the `contract?.customer.lineIdFinance` guard returns.
      await invoke('ct-missing', new Prisma.Decimal('100'));

      expect(buildEarlyPayoffSuccessFlex).not.toHaveBeenCalled();
      expect(lineOa.sendFlexMessage).not.toHaveBeenCalled();
    });

    it('empty payments → originalAmount 0; savings clamped 0; still sends when lineIdFinance present', async () => {
      buildContractPrisma({
        id: 'ct-5',
        contractNumber: 'CT-0005',
        customer: { name: 'D', lineIdFinance: 'Uf5' },
        payments: [],
      });
      await buildService();

      await invoke('ct-5', new Prisma.Decimal('0'));

      const arg = (buildEarlyPayoffSuccessFlex as jest.Mock).mock.calls[0][0];
      expect(arg.originalAmount).toBe(0);
      expect(arg.savings).toBe(0);
      expect(arg.amountPaid).toBe(0);
      expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
    });

    it('sender error is swallowed (try/catch) — method resolves, never rejects', async () => {
      buildContractPrisma({
        id: 'ct-6',
        contractNumber: 'CT-0006',
        customer: { name: 'E', lineIdFinance: 'Uf6' },
        payments: [
          {
            amountDue: new Prisma.Decimal('1000'),
            lateFee: new Prisma.Decimal('0'),
            lateFeeWaived: false,
          },
        ],
      });
      await buildService();
      lineOa.sendFlexMessage.mockRejectedValueOnce(new Error('LINE down'));

      // QUIRK: the whole body is wrapped in try/catch (logs only) so a webhook
      // is never failed by a notification error.
      await expect(invoke('ct-6', new Prisma.Decimal('900'))).resolves.toBeUndefined();
    });
  });
});
