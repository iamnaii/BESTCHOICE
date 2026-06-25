import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { loadLateFeeConfig, resolveLateFee } from '../../../utils/late-fee.util';

const prisma = new PrismaClient();

describe('loadLateFeeConfig + resolveLateFee against the live SystemConfig', () => {
  afterAll(async () => {
    await prisma.systemConfig.deleteMany({ where: { key: { in: ['late_fee_mode', 'late_fee_per_day_rate', 'late_fee_max_amount', 'late_fee_cap_pct'] } } });
    await prisma.$disconnect();
  });

  it('PER_DAY mode with configured values resolves the 5% cap', async () => {
    for (const [key, value] of [['late_fee_mode', 'PER_DAY'], ['late_fee_per_day_rate', '20'], ['late_fee_max_amount', '500'], ['late_fee_cap_pct', '5']] as const) {
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    const cfg = await loadLateFeeConfig(prisma);
    expect(cfg.mode).toBe('PER_DAY');
    expect(resolveLateFee(cfg, 10, new Prisma.Decimal('1515.83')).toString()).toBe('75.79');
  });
});
