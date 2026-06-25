import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
describe('11-2107 ลูกหนี้-หน้าร้าน seeded into FINANCE chart', () => {
  beforeAll(async () => { await seedFinanceCoa(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });
  it('exists as an active Dr asset account', async () => {
    const acc = await prisma.chartOfAccount.findUnique({ where: { code: '11-2107' } });
    expect(acc).not.toBeNull();
    expect(acc!.normalBalance).toBe('Dr');
  });
});
