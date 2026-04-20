import { Test } from '@nestjs/testing';
import { CustomerTierService } from './customer-tier.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CustomerTierService — computeTierFromHistory', () => {
  let service: CustomerTierService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CustomerTierService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    service = mod.get(CustomerTierService);
  });

  const h = (over: Partial<Parameters<typeof service.computeTierFromHistory>[0]>) => ({
    totalContracts: 0,
    closedContracts: 0,
    activeContracts: 0,
    onTimePayments: 0,
    latePayments: 0,
    maxOverdueDays: 0,
    currentOutstanding: 0,
    hasBadDebt: false,
    hasRepossession: false,
    activeContractsAllOnTime: false,
    activeContractsPaidCount: 0,
    ...over,
  });

  it('returns BLACKLIST when hasBadDebt=true', () => {
    const r = service.computeTierFromHistory(h({ hasBadDebt: true }));
    expect(r.tier).toBe('BLACKLIST');
    expect(r.reasons.map((x) => x.code)).toContain('BAD_DEBT');
  });

  it('returns BLACKLIST when hasRepossession=true', () => {
    const r = service.computeTierFromHistory(h({ hasRepossession: true }));
    expect(r.tier).toBe('BLACKLIST');
    expect(r.reasons.map((x) => x.code)).toContain('REPOSSESSED');
  });

  it('returns RISKY when maxOverdueDays > 30 and no bad debt', () => {
    const r = service.computeTierFromHistory(
      h({ closedContracts: 1, onTimePayments: 10, latePayments: 2, maxOverdueDays: 45 }),
    );
    expect(r.tier).toBe('RISKY');
    expect(r.reasons.map((x) => x.code)).toContain('OVERDUE_OVER_30');
  });

  it('returns GOLD when closedContracts >= 2 and onTime 100%', () => {
    const r = service.computeTierFromHistory(
      h({ closedContracts: 2, totalContracts: 2, onTimePayments: 24, latePayments: 0 }),
    );
    expect(r.tier).toBe('GOLD');
  });

  it('returns GOOD when onTime >= 90% and closedContracts >= 1', () => {
    const r = service.computeTierFromHistory(
      h({ closedContracts: 1, totalContracts: 1, onTimePayments: 11, latePayments: 1 }),
    );
    expect(r.tier).toBe('GOOD');
  });

  it('returns GOOD when active contract all on-time and >= 3 payments', () => {
    const r = service.computeTierFromHistory(
      h({ activeContracts: 1, totalContracts: 1, activeContractsAllOnTime: true, activeContractsPaidCount: 3, onTimePayments: 3, latePayments: 0 }),
    );
    expect(r.tier).toBe('GOOD');
  });

  it('returns NEW when no history', () => {
    const r = service.computeTierFromHistory(h({}));
    expect(r.tier).toBe('NEW');
  });

  it('returns NEW when has contract but not enough on-time data', () => {
    const r = service.computeTierFromHistory(
      h({ activeContracts: 1, totalContracts: 1, activeContractsAllOnTime: true, activeContractsPaidCount: 1 }),
    );
    expect(r.tier).toBe('NEW');
  });
});
