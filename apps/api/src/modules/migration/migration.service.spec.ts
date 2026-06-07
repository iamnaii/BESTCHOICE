import { Test } from '@nestjs/testing';
import { MigrationService } from './migration.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportContractDto } from './dto/import.dto';

/**
 * #17 — importContracts must write Product + Contract + Payments atomically
 * per row, so a mid-row failure leaves no orphan Product / Contract / partial
 * schedule. These tests assert the writes go through a single $transaction
 * (the tx client), not this.prisma directly.
 */
describe('MigrationService.importContracts — per-row atomicity (#17)', () => {
  let service: MigrationService;
  let prisma: any;
  let txClient: any;

  const dto: ImportContractDto = {
    customerNationalId: '1234567890123',
    productName: 'iPhone 13',
    branchName: 'สาขาหลัก',
    salespersonEmail: 'sales@bestchoice.com',
    sellingPrice: 10000,
    downPayment: 1000,
    interestRate: 0.1,
    totalMonths: 12,
    status: 'ACTIVE',
  } as ImportContractDto;

  beforeEach(async () => {
    txClient = {
      product: { create: jest.fn().mockResolvedValue({ id: 'prod-1' }) },
      contract: {
        create: jest.fn().mockResolvedValue({ id: 'ct-1' }),
        findFirst: jest.fn().mockResolvedValue(null), // generateContractNumber lookup
      },
      payment: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 12 }),
      },
    };

    prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 'cust-1' }) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'br-1' }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'sales-1' }) },
      $transaction: jest.fn(async (cb: any) => cb(txClient)),
      // Direct (non-tx) write methods — these MUST NOT be used (would orphan).
      product: { create: jest.fn() },
      contract: { create: jest.fn(), findFirst: jest.fn() },
      payment: { create: jest.fn(), createMany: jest.fn() },
    };

    const mod = await Test.createTestingModule({
      providers: [MigrationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(MigrationService);
  });

  it('commits a row through a single $transaction (writes use the tx client, not this.prisma)', async () => {
    const res = await service.importContracts([dto]);

    expect(res.success).toBe(1);
    expect(res.failed).toBe(0);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // All writes went through the tx client...
    expect(txClient.product.create).toHaveBeenCalledTimes(1);
    expect(txClient.contract.create).toHaveBeenCalledTimes(1);
    expect(txClient.payment.createMany).toHaveBeenCalledTimes(1); // no payments[] → auto-gen
    // ...never via the bare prisma client (which would not roll back).
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.contract.create).not.toHaveBeenCalled();
  });

  it('rolls the whole row back (failed++, error captured) when a write inside the tx throws', async () => {
    txClient.contract.create.mockRejectedValueOnce(new Error('FK violation'));

    const res = await service.importContracts([dto]);

    expect(res.success).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.errors[0].message).toMatch(/FK violation/);
    // The product.create that preceded the failure was on the tx client, so a
    // real DB rolls it back — no orphan leaks via the bare prisma client.
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('uses one $transaction PER ROW (not a single tx around the whole import)', async () => {
    const res = await service.importContracts([dto, { ...dto }, { ...dto }]);
    expect(res.success).toBe(3);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});
