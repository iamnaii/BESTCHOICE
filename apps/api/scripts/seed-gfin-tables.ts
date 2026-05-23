import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

interface Fixture {
  snapshotDate: string;
  maxPrices: Array<{
    gfinSeries: string;
    gfinVariant: string | null;
    storage: string;
    condition: 'HAND_1' | 'HAND_2';
    maxPrice: number;
    modelMatchPattern: string;
  }>;
  overpriceRules: Array<{
    label: string;
    seriesPattern: string;
    condition: 'HAND_1' | 'HAND_2';
    allowance: number;
  }>;
  rateFactors: Array<{ months: number; factor: number; feePerInstallment: number }>;
}

async function main() {
  const prisma = new PrismaClient();
  const fixturePath = path.join(__dirname, '..', 'prisma', 'fixtures', 'gfin-2026-05-22.json');
  const data = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as Fixture;

  for (const mp of data.maxPrices) {
    await prisma.gfinModelMapping.upsert({
      where: {
        gfinSeries_gfinVariant_storage_condition: {
          gfinSeries: mp.gfinSeries,
          gfinVariant: mp.gfinVariant,
          storage: mp.storage,
          condition: mp.condition,
        },
      },
      create: { ...mp, maxPrice: new Prisma.Decimal(mp.maxPrice) },
      update: { maxPrice: new Prisma.Decimal(mp.maxPrice), modelMatchPattern: mp.modelMatchPattern },
    });
  }

  for (const rule of data.overpriceRules) {
    const existing = await prisma.gfinOverpriceRule.findFirst({
      where: { label: rule.label, deletedAt: null },
    });
    if (existing) {
      await prisma.gfinOverpriceRule.update({
        where: { id: existing.id },
        data: { allowance: new Prisma.Decimal(rule.allowance), seriesPattern: rule.seriesPattern, condition: rule.condition },
      });
    } else {
      await prisma.gfinOverpriceRule.create({
        data: { ...rule, allowance: new Prisma.Decimal(rule.allowance) },
      });
    }
  }

  for (const rf of data.rateFactors) {
    await prisma.gfinRateFactor.upsert({
      where: { months: rf.months },
      create: {
        months: rf.months,
        factor: new Prisma.Decimal(rf.factor),
        feePerInstallment: new Prisma.Decimal(rf.feePerInstallment),
      },
      update: {
        factor: new Prisma.Decimal(rf.factor),
        feePerInstallment: new Prisma.Decimal(rf.feePerInstallment),
      },
    });
  }

  console.log(JSON.stringify({
    snapshotDate: data.snapshotDate,
    maxPrices: data.maxPrices.length,
    overpriceRules: data.overpriceRules.length,
    rateFactors: data.rateFactors.length,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
