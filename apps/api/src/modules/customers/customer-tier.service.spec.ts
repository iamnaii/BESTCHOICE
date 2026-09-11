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

describe('CustomerTierService — batched list/detail parity', () => {
  it('computes the same tiers from batched history and individual detail reads', async () => {
    const paid = { status: 'PAID', dueDate: new Date('2025-01-01'), paidAt: new Date('2025-01-01') };
    const base = { totalMonths: 6, monthlyPayment: '1000' };
    const contracts = [
      { ...base, id: 'g1', customerId: 'gold', status: 'COMPLETED', payments: [paid] },
      { ...base, id: 'g2', customerId: 'gold', status: 'COMPLETED', payments: [paid] },
      { ...base, id: 'a1', customerId: 'good', status: 'ACTIVE', payments: [paid, paid, paid] },
      { ...base, id: 'r1', customerId: 'risky', status: 'OVERDUE', payments: [{ ...paid, status: 'OVERDUE', paidAt: new Date('2025-03-01') }] },
    ];
    const db = {
      customer: { findFirst: jest.fn(async (args: any) => ({ id: args.where.id })) },
      contract: { findMany: jest.fn(async (args: any) => contracts.filter(contract => typeof args.where.customerId === 'string'
        ? contract.customerId === args.where.customerId : args.where.customerId.in.includes(contract.customerId))) },
      repossession: {
        findMany: jest.fn().mockResolvedValue([{ contract: { customerId: 'blacklist' } }]),
        count: jest.fn(async (args: any) => args.where.contract.customerId === 'blacklist' ? 1 : 0),
      },
    };
    const service = new CustomerTierService(db as unknown as PrismaService);
    const ids = ['gold', 'good', 'risky', 'blacklist', 'new'];
    const batched = await service.getCustomerTiers(ids);
    expect(db.contract.findMany).toHaveBeenCalledTimes(1);
    expect(db.repossession.findMany).toHaveBeenCalledTimes(1);
    for (const id of ids) expect(batched.get(id)).toEqual(await service.getCustomerTier(id));
    expect(ids.map(id => batched.get(id)?.tier)).toEqual(['GOLD', 'GOOD', 'RISKY', 'BLACKLIST', 'NEW']);
  });
});
