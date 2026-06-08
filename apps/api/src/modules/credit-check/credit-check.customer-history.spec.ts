import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { CreditCheckService } from './credit-check.service';

/**
 * Characterization (golden) tests for CreditCheckService.getCustomerHistory
 * (credit-check.service.ts ~lines 509-586) — the payment-history aggregator
 * that FEEDS the DTI engine. Wave 3 backfill (review finding D7).
 *
 * This pins the EXACT aggregation so a silent reweight or a moved status
 * predicate is caught:
 *   - not-found guard: customer === null OR (customer as {deletedAt}).deletedAt
 *     truthy -> NotFoundException('ไม่พบลูกค้า')
 *   - totalContracts     = contracts.length
 *   - completedContracts = count of status in { COMPLETED, EARLY_PAYOFF }
 *   - activeContracts    = count of status in { ACTIVE, OVERDUE }
 *   - currentOutstanding = sum over ACTIVE|OVERDUE contracts of
 *       max(0, totalMonths - paidCount) * Number(monthlyPayment),
 *       paidCount = payments with status PAID; final Math.round(x*100)/100
 *       (remaining floored at 0 — never subtracts from outstanding)
 *   - onTimePayments     = count of ALL payments with status PAID (every contract)
 *   - latePayments       = count of ALL payments with status OVERDUE
 *   - onTimeRate         = total>0 ? Math.round(onTime/total*100)/100 : 0
 *   - isReturningCustomer = totalContracts > 0
 *   - contracts[] maps { id, contractNumber, status, totalMonths,
 *       paidPayments, overduePayments } per contract
 *
 * Mock-only — no DB. The service is built with a jest-mocked PrismaService
 * (customer.findUnique + contract.findMany) and a stub IntegrationConfig.
 * Money is Prisma.Decimal in production; here Number(...) coerces it, so the
 * mock passes plain numbers (Number(1000) === 1000) which is faithful to the
 * exact coercion the implementation performs.
 */

type PaymentRow = { status: string };

type ContractRow = {
  id: string;
  contractNumber: string;
  status: string;
  totalMonths: number;
  monthlyPayment: number;
  payments: PaymentRow[];
};

type CustomerRow = {
  id: string;
  name: string;
  addressCurrentType?: string | null;
  salaryPayDay?: number | null;
  deletedAt?: Date | null;
} | null;

const makeService = (customer: CustomerRow, contracts: ContractRow[] = []): CreditCheckService => {
  const prisma = {
    customer: {
      findUnique: jest.fn().mockResolvedValue(customer),
    },
    contract: {
      findMany: jest.fn().mockResolvedValue(contracts),
    },
  } as unknown as PrismaService;
  return new CreditCheckService(prisma, {} as unknown as IntegrationConfigService);
};

const aCustomer: CustomerRow = {
  id: 'cu-1',
  name: 'ทดสอบ',
  addressCurrentType: 'OWN',
  salaryPayDay: 25,
};

const run = (contracts: ContractRow[] = [], customer: CustomerRow = aCustomer) =>
  makeService(customer, contracts).getCustomerHistory('cu-1');

const contract = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: over.id ?? 'ct-1',
  contractNumber: over.contractNumber ?? 'C-0001',
  status: over.status ?? 'ACTIVE',
  totalMonths: over.totalMonths ?? 12,
  monthlyPayment: over.monthlyPayment ?? 1000,
  payments: over.payments ?? [],
});

const pay = (n: number, status: string): PaymentRow[] =>
  Array.from({ length: n }, () => ({ status }));

describe('CreditCheckService.getCustomerHistory', () => {
  describe('not-found guard', () => {
    it('throws NotFoundException when the customer is missing (null)', async () => {
      await expect(makeService(null).getCustomerHistory('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException with Thai message when soft-deleted', async () => {
      const svc = makeService({ ...aCustomer, deletedAt: new Date() });
      await expect(svc.getCustomerHistory('cu-1')).rejects.toThrow('ไม่พบลูกค้า');
    });
  });

  describe('empty contracts', () => {
    it('returns all zeros, onTimeRate 0, isReturningCustomer false', async () => {
      const r = await run([]);
      expect(r).toEqual({
        customerId: 'cu-1',
        totalContracts: 0,
        completedContracts: 0,
        activeContracts: 0,
        currentOutstanding: 0,
        onTimePayments: 0,
        latePayments: 0,
        onTimeRate: 0,
        isReturningCustomer: false,
        contracts: [],
      });
    });
  });

  describe('contract status counters', () => {
    it('counts COMPLETED and EARLY_PAYOFF as completed', async () => {
      const r = await run([
        contract({ id: 'a', status: 'COMPLETED' }),
        contract({ id: 'b', status: 'EARLY_PAYOFF' }),
        contract({ id: 'c', status: 'ACTIVE' }),
      ]);
      expect(r.completedContracts).toBe(2);
    });

    it('counts ACTIVE and OVERDUE as active', async () => {
      const r = await run([
        contract({ id: 'a', status: 'ACTIVE' }),
        contract({ id: 'b', status: 'OVERDUE' }),
        contract({ id: 'c', status: 'COMPLETED' }),
      ]);
      expect(r.activeContracts).toBe(2);
    });

    it('totalContracts mirrors contracts.length even for other statuses', async () => {
      // DRAFT/CANCELLED count toward totalContracts but neither completed nor active.
      const r = await run([
        contract({ id: 'a', status: 'DRAFT' }),
        contract({ id: 'b', status: 'CANCELLED' }),
      ]);
      expect(r.totalContracts).toBe(2);
      expect(r.completedContracts).toBe(0);
      expect(r.activeContracts).toBe(0);
      expect(r.isReturningCustomer).toBe(true);
    });
  });

  describe('currentOutstanding (active/overdue only)', () => {
    it('sums (totalMonths - paidCount) * monthlyPayment over ACTIVE|OVERDUE only', async () => {
      // A: ACTIVE   12m @1000, paid 2 -> remaining 10 -> 10000
      // B: OVERDUE   6m  @500, paid 1 -> remaining  5 ->  2500
      // C: COMPLETED 10m @2000           -> SKIPPED (not active/overdue)
      // D: EARLY_PAYOFF 24m @900         -> SKIPPED
      const r = await run([
        contract({
          id: 'a',
          status: 'ACTIVE',
          totalMonths: 12,
          monthlyPayment: 1000,
          payments: [...pay(2, 'PAID'), ...pay(1, 'OVERDUE')],
        }),
        contract({
          id: 'b',
          status: 'OVERDUE',
          totalMonths: 6,
          monthlyPayment: 500,
          payments: [...pay(1, 'PAID'), ...pay(1, 'OVERDUE')],
        }),
        contract({
          id: 'c',
          status: 'COMPLETED',
          totalMonths: 10,
          monthlyPayment: 2000,
          payments: pay(2, 'PAID'),
        }),
        contract({
          id: 'd',
          status: 'EARLY_PAYOFF',
          totalMonths: 24,
          monthlyPayment: 900,
          payments: pay(1, 'PAID'),
        }),
      ]);
      // 10000 + 2500 = 12500
      expect(r.currentOutstanding).toBe(12500);
    });

    it('rounds the outstanding to 2 decimals (Math.round(x*100)/100)', async () => {
      // 1 remaining month @ 33.333 -> 33.333 -> round -> 33.33
      const r = await run([
        contract({
          id: 'a',
          status: 'ACTIVE',
          totalMonths: 1,
          monthlyPayment: 33.333,
          payments: [],
        }),
      ]);
      expect(r.currentOutstanding).toBe(33.33);
    });

    it('floors remaining at 0 when paidCount exceeds totalMonths (regression: never negative)', async () => {
      // ACTIVE, totalMonths 2 but 3 PAID payments -> remaining max(0, 2-3) = 0 -> 0.
      // Previously this returned -1000 (remaining went negative); now floored.
      const r = await run([
        contract({
          id: 'a',
          status: 'ACTIVE',
          totalMonths: 2,
          monthlyPayment: 1000,
          payments: pay(3, 'PAID'),
        }),
      ]);
      expect(r.currentOutstanding).toBe(0);
    });
  });

  describe('payment-history counters + onTimeRate rounding', () => {
    it('onTimePayments=PAID and latePayments=OVERDUE across ALL contracts', async () => {
      // Includes a COMPLETED contract whose PAID payments STILL count toward onTime.
      const r = await run([
        contract({
          id: 'a',
          status: 'ACTIVE',
          payments: [...pay(2, 'PAID'), ...pay(1, 'OVERDUE')],
        }),
        contract({
          id: 'b',
          status: 'OVERDUE',
          payments: [...pay(1, 'PAID'), ...pay(1, 'OVERDUE')],
        }),
        contract({ id: 'c', status: 'COMPLETED', payments: [...pay(2, 'PAID')] }),
        contract({ id: 'd', status: 'EARLY_PAYOFF', payments: [...pay(1, 'PAID')] }),
      ]);
      // PAID: 2 + 1 + 2 + 1 = 6 ; OVERDUE: 1 + 1 = 2
      expect(r.onTimePayments).toBe(6);
      expect(r.latePayments).toBe(2);
      // 6/8 = 0.75
      expect(r.onTimeRate).toBe(0.75);
    });

    it('onTimeRate rounds to 2 decimals: 2 PAID / 3 total -> 0.67', async () => {
      const r = await run([
        contract({ id: 'a', status: 'ACTIVE', payments: [...pay(2, 'PAID'), ...pay(1, 'OVERDUE')] }),
      ]);
      // Math.round((2/3)*100)/100 = Math.round(66.66) / 100 = 67/100 = 0.67
      expect(r.onTimeRate).toBe(0.67);
    });

    it('ignores non-PAID/non-OVERDUE payment statuses in the rate denominator (quirk)', async () => {
      // PENDING payments contribute to NEITHER onTime nor late, so totalPayments
      // (onTime+late) excludes them — the rate is over PAID+OVERDUE only.
      const r = await run([
        contract({
          id: 'a',
          status: 'ACTIVE',
          payments: [...pay(1, 'PAID'), ...pay(1, 'OVERDUE'), ...pay(5, 'PENDING')],
        }),
      ]);
      expect(r.onTimePayments).toBe(1);
      expect(r.latePayments).toBe(1);
      // denominator = 1 + 1 = 2 (PENDING excluded) -> 1/2 = 0.5
      expect(r.onTimeRate).toBe(0.5);
    });

    it('onTimeRate is 0 when there are zero PAID/OVERDUE payments', async () => {
      const r = await run([contract({ id: 'a', status: 'ACTIVE', payments: pay(3, 'PENDING') })]);
      expect(r.onTimePayments).toBe(0);
      expect(r.latePayments).toBe(0);
      expect(r.onTimeRate).toBe(0);
    });
  });

  describe('per-contract mapping', () => {
    it('maps id/contractNumber/status/totalMonths + paid/overdue payment counts', async () => {
      const r = await run([
        contract({
          id: 'ct-x',
          contractNumber: 'C-9999',
          status: 'OVERDUE',
          totalMonths: 8,
          monthlyPayment: 1500,
          payments: [...pay(3, 'PAID'), ...pay(2, 'OVERDUE'), ...pay(1, 'PENDING')],
        }),
      ]);
      expect(r.contracts).toEqual([
        {
          id: 'ct-x',
          contractNumber: 'C-9999',
          status: 'OVERDUE',
          totalMonths: 8,
          paidPayments: 3,
          overduePayments: 2,
        },
      ]);
    });

    it('isReturningCustomer is true whenever there is at least one contract', async () => {
      const r = await run([contract({ id: 'a', status: 'CANCELLED' })]);
      expect(r.isReturningCustomer).toBe(true);
    });
  });
});
