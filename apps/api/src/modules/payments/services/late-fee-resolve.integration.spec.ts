import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadLateFeeConfig, resolveLateFee } from '../../../utils/late-fee.util';

const prisma = new PrismaClient();

describe('loadLateFeeConfig + resolveLateFee against the live SystemConfig', () => {
  afterAll(async () => {
    await prisma.systemConfig.deleteMany({
      where: { key: { in: ['late_fee_tier1_amount', 'late_fee_tier2_amount', 'late_fee_tier2_min_days'] } },
    });
    await prisma.$disconnect();
  });

  it('flat-bracket config with configured values resolves tier2 at the boundary', async () => {
    for (const [key, value] of [
      ['late_fee_tier1_amount', '50'],
      ['late_fee_tier2_amount', '100'],
      ['late_fee_tier2_min_days', '3'],
    ] as const) {
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    const cfg = await loadLateFeeConfig(prisma);
    expect(cfg.tier1Amount).toBe(50);
    expect(cfg.tier2Amount).toBe(100);
    expect(cfg.tier2MinDays).toBe(3);
    expect(resolveLateFee(cfg, 10).toString()).toBe('100');
  });
});
