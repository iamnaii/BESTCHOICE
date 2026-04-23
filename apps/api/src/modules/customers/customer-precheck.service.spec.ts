import { Test } from '@nestjs/testing';
import { CustomerPreCheckService } from './customer-precheck.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTierService } from './customer-tier.service';

describe('CustomerPreCheckService — decideOutcome (pure)', () => {
  let service: CustomerPreCheckService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: {} },
        { provide: CustomerTierService, useValue: {} },
      ],
    }).compile();
    service = mod.get(CustomerPreCheckService);
  });

  it('BLACKLIST always FAIL', () => {
    expect(service.decideOutcome('BLACKLIST', undefined).decision).toBe('FAIL');
  });
  it('RISKY always REVIEW', () => {
    expect(service.decideOutcome('RISKY', 80).decision).toBe('REVIEW');
  });
  it('GOLD always PASS — even without AI', () => {
    expect(service.decideOutcome('GOLD', undefined).decision).toBe('PASS');
  });
  it('GOOD with AI >= 50 PASS', () => {
    expect(service.decideOutcome('GOOD', 65).decision).toBe('PASS');
  });
  it('GOOD with AI 40-49 REVIEW', () => {
    expect(service.decideOutcome('GOOD', 45).decision).toBe('REVIEW');
  });
  it('GOOD with AI < 40 FAIL', () => {
    expect(service.decideOutcome('GOOD', 35).decision).toBe('FAIL');
  });
  it('GOOD without AI PASS', () => {
    expect(service.decideOutcome('GOOD', undefined).decision).toBe('PASS');
  });
  it('NEW with AI >= 50 PASS', () => {
    expect(service.decideOutcome('NEW', 60).decision).toBe('PASS');
  });
  it('NEW with AI 40-49 REVIEW', () => {
    expect(service.decideOutcome('NEW', 45).decision).toBe('REVIEW');
  });
  it('NEW with AI < 40 FAIL', () => {
    expect(service.decideOutcome('NEW', 30).decision).toBe('FAIL');
  });
  it('NEW without AI REVIEW', () => {
    expect(service.decideOutcome('NEW', undefined).decision).toBe('REVIEW');
  });
});

describe('CustomerPreCheckService — runPreCheck soft-delete revival', () => {
  let service: CustomerPreCheckService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      creditCheck: { create: jest.fn() },
    };
    const tierService = {
      getCustomerTier: jest.fn().mockResolvedValue({ tier: 'NEW', reasons: [] }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerTierService, useValue: tierService },
      ],
    }).compile();
    service = mod.get(CustomerPreCheckService);
  });

  it('revives a soft-deleted customer with the same nationalId instead of throwing P2002', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-dead',
      deletedAt: new Date('2026-04-22'),
    });

    const result = await service.runPreCheck({
      nationalId: '1234567890123',
      phone: '0812345678',
    });

    // Must NOT call create() — that's the line that blows up with P2002
    expect(prisma.customer.create).not.toHaveBeenCalled();
    // Must clear deletedAt so the customer is usable again
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-dead' },
        data: expect.objectContaining({ deletedAt: null }),
      }),
    );
    expect(result.customerId).toBe('cust-dead');
    expect(result.isNewCustomer).toBe(false);
  });

  it('creates a fresh customer when no row exists at all', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.customer.create.mockResolvedValue({ id: 'cust-new' });

    const result = await service.runPreCheck({
      nationalId: '2222222222222',
      phone: '0898765432',
    });

    expect(prisma.customer.create).toHaveBeenCalled();
    expect(result.customerId).toBe('cust-new');
    expect(result.isNewCustomer).toBe(true);
  });

  it('uses the active customer without touching update() when one already exists', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-live',
      deletedAt: null,
    });

    const result = await service.runPreCheck({
      nationalId: '3333333333333',
      phone: '0811111111',
    });

    expect(prisma.customer.create).not.toHaveBeenCalled();
    // update() is still called at the end of runPreCheck to set creditCheckStatus,
    // so assert we did NOT try to clear deletedAt (the revive-only path).
    const updateCalls = prisma.customer.update.mock.calls;
    expect(
      updateCalls.every((call: [unknown]) => !('deletedAt' in (call[0] as { data: object }).data)),
    ).toBe(true);
    expect(result.customerId).toBe('cust-live');
    expect(result.isNewCustomer).toBe(false);
  });
});
