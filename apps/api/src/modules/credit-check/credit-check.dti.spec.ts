import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { CreditCheckService } from './credit-check.service';

/**
 * Characterization tests for CreditCheckService.calculateDtiRiskScore (Wave 3 backfill).
 *
 * The debt-to-income risk engine had no tests yet outputs LOW/MEDIUM/HIGH on
 * regulated installment lending (review finding D7). These lock the DTI bands
 * (<0.3 / <=0.5 / else → 0 / 1 / 2 points), the address factor (own −1 / rent +1),
 * the returning-customer history factors, the salary-fallback resolution, the
 * salary<=0 guard, and the suggested-due-day rule.
 */

const NON_RETURNING = {
  isReturningCustomer: false,
  completedContracts: 0,
  onTimeRate: 0,
  latePayments: 0,
  onTimePayments: 0,
};

const makePrisma = (creditCheck: unknown) =>
  ({
    creditCheck: {
      findUnique: jest.fn().mockResolvedValue(creditCheck),
      update: jest.fn().mockResolvedValue({}),
    },
  }) as unknown as PrismaService;

const run = (
  cc: unknown,
  data: { salaryVerified?: number; monthlyPayment?: number; addressCurrentType?: string },
  history: typeof NON_RETURNING = NON_RETURNING,
) => {
  const svc = new CreditCheckService(
    makePrisma(cc),
    {} as unknown as IntegrationConfigService,
    { record: jest.fn() } as unknown as AiUsageService,
  );
  // calculateDtiRiskScore + getCustomerHistory both live on the internally-constructed
  // CreditCheckRiskService sub-service (svc.risk); the DTI call resolves its history
  // dependency through that same instance, so the stub must target svc.risk.
  jest.spyOn(svc.risk as unknown as { getCustomerHistory: (id: string) => Promise<unknown> }, 'getCustomerHistory')
    .mockResolvedValue(history);
  return svc.calculateDtiRiskScore('cc-1', data);
};

const cc = (over: Record<string, unknown>) => ({
  deletedAt: null,
  salaryVerified: null,
  customer: { id: 'cu-1', salary: 30000, addressCurrentType: null, salaryPayDay: 25 },
  contract: { monthlyPayment: 6000 },
  ...over,
});

describe('CreditCheckService.calculateDtiRiskScore', () => {
  it('rates LOW for low DTI + own home', async () => {
    const r = await run(
      cc({ customer: { id: 'cu-1', salary: 30000, addressCurrentType: 'OWN', salaryPayDay: 25 }, contract: { monthlyPayment: 6000 } }),
      {},
    );
    expect(r.riskScore).toBe('LOW'); // DTI 0.2 → 0 pts, OWN → −1
    expect(r.debtToIncomeRatio).toBe(0.2);
    expect(r.details.riskPoints).toBe(-1);
    expect(r.suggestedDueDay).toBe(28); // min(28, 25 + 5)
  });

  it('rates MEDIUM for mid DTI + rented home', async () => {
    const r = await run(
      cc({ customer: { id: 'cu-1', salary: 30000, addressCurrentType: 'RENT', salaryPayDay: 1 }, contract: { monthlyPayment: 12000 } }),
      {},
    );
    expect(r.riskScore).toBe('MEDIUM'); // DTI 0.4 → 1, RENT → +1 = 2
    expect(r.debtToIncomeRatio).toBe(0.4);
    expect(r.suggestedDueDay).toBe(6); // 1 + 5
  });

  it('rates HIGH when DTI is high and home is rented', async () => {
    const r = await run(
      cc({ customer: { id: 'cu-1', salary: 30000, addressCurrentType: 'RENT', salaryPayDay: null }, contract: { monthlyPayment: 18000 } }),
      {},
    );
    expect(r.riskScore).toBe('HIGH'); // DTI 0.6 → 2, RENT → +1 = 3
    expect(r.suggestedDueDay).toBeNull();
  });

  it('credits a good returning customer down to LOW', async () => {
    const r = await run(
      cc({ customer: { id: 'cu-1', salary: 30000, addressCurrentType: null, salaryPayDay: 10 }, contract: { monthlyPayment: 12000 } }),
      {},
      { isReturningCustomer: true, completedContracts: 2, onTimeRate: 0.9, latePayments: 1, onTimePayments: 10 },
    );
    // DTI 0.4 → 1; returning: completed −1, onTimeRate>0.8 −1 = −1 → LOW
    expect(r.riskScore).toBe('LOW');
    expect(r.details.riskPoints).toBe(-1);
  });

  it('lets the data argument override stored values', async () => {
    const r = await run(
      cc({ customer: { id: 'cu-1', salary: 99999, addressCurrentType: 'OWN', salaryPayDay: 1 }, contract: { monthlyPayment: 1 } }),
      { salaryVerified: 30000, monthlyPayment: 12000, addressCurrentType: 'RENT' },
    );
    expect(r.riskScore).toBe('MEDIUM'); // uses data: DTI 0.4 → 1, RENT → +1 = 2
    expect(r.debtToIncomeRatio).toBe(0.4);
  });

  it('throws when no income can be resolved', async () => {
    await expect(
      run(cc({ salaryVerified: null, customer: { id: 'cu-1', salary: 0, addressCurrentType: null, salaryPayDay: null }, contract: null }), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
