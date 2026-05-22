import { PrismaClient, Prisma } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  const configs = await prisma.interestConfig.findMany({
    where: { deletedAt: null },
    include: { rates: true },
  });

  let inserted = 0;
  let skipped = 0;

  for (const cfg of configs) {
    for (let m = cfg.minInstallmentMonths; m <= cfg.maxInstallmentMonths; m++) {
      const exists = cfg.rates.some(r => r.months === m && !r.deletedAt);
      if (exists) {
        skipped++;
        continue;
      }
      const ratePct = new Prisma.Decimal(cfg.interestRate).mul(m).toDecimalPlaces(4);
      await prisma.interestConfigRate.create({
        data: { configId: cfg.id, months: m, ratePct },
      });
      inserted++;
    }
  }

  console.log(JSON.stringify({ configs: configs.length, inserted, skipped }, null, 2));
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
