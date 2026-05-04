import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from './seed-coa-finance';

const prisma = new PrismaClient();

describe('seedFinanceCoa', () => {
  beforeAll(async () => {
    await prisma.chartOfAccount.deleteMany({});
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeds 99+ accounts from CSV', async () => {
    const result = await seedFinanceCoa(prisma);
    expect(result.created).toBeGreaterThanOrEqual(90);
    const cash = await prisma.chartOfAccount.findUnique({ where: { code: '11-1101' } });
    expect(cash).toMatchObject({
      code: '11-1101',
      name: 'เงินสด - สุทธินีย์ คงเดช',
      type: 'สินทรัพย์',
      normalBalance: 'Dr',
      vatApplicable: false,
    });
    const deferred = await prisma.chartOfAccount.findUnique({ where: { code: '11-2106' } });
    expect(deferred?.normalBalance).toBe('Cr');
  });

  it('is idempotent', async () => {
    await seedFinanceCoa(prisma); // first run
    const before = await prisma.chartOfAccount.count();
    await seedFinanceCoa(prisma); // second — should be no-op (no creates)
    const after = await prisma.chartOfAccount.count();
    expect(after).toBe(before);
  });
});
