import { PrismaService } from '../../prisma/prisma.service';

export async function resolveBcConfig(
  prisma: Pick<PrismaService, 'interestConfig'>,
  category: string,
) {
  // Fix round 1 [C2]: `orderBy: { createdAt: 'asc' }` makes the pick
  // deterministic when a category has >1 active config — without it,
  // Postgres can return either row on different calls, and a customer
  // could see two different monthly-payment quotes for the same category
  // from the bot/web-shop (this resolver) vs the inbox picker
  // (`ProductQuoteService.getQuotes` in
  // apps/api/src/modules/staff-chat/services/product-quote.service.ts,
  // which uses the same `orderBy` + first-wins rule). Keep both in sync.
  const cfg = await prisma.interestConfig.findFirst({
    where: {
      productCategories: { has: category },
      deletedAt: null,
      isActive: true,
    },
    include: { rates: { where: { deletedAt: null } } },
    orderBy: { createdAt: 'asc' },
  });

  if (!cfg) {
    // Fallback: system defaults when no config matches the category
    return {
      minDownPct: 0.15,
      commissionPct: 0.1,
      vatPct: 0.07,
      ratePctByMonths: {} as Record<number, number>,
      allowedMonths: [] as number[],
    };
  }

  const ratePctByMonths: Record<number, number> = {};
  for (const r of cfg.rates) {
    ratePctByMonths[r.months] = Number(r.ratePct);
  }
  const allowedMonths = Object.keys(ratePctByMonths)
    .map(Number)
    .sort((a, b) => a - b);

  // If no per-month rates yet (Task 8 backfill hasn't been run), synthesize from
  // the scalar interestRate × months range stored on the config row.
  if (allowedMonths.length === 0) {
    const rate = Number(cfg.interestRate);
    for (let m = cfg.minInstallmentMonths; m <= cfg.maxInstallmentMonths; m++) {
      ratePctByMonths[m] = rate * m;
    }
    return {
      minDownPct: Number(cfg.minDownPaymentPct),
      commissionPct: Number(cfg.storeCommissionPct),
      vatPct: Number(cfg.vatPct),
      ratePctByMonths,
      allowedMonths: Array.from(
        { length: cfg.maxInstallmentMonths - cfg.minInstallmentMonths + 1 },
        (_, i) => cfg.minInstallmentMonths + i,
      ),
    };
  }

  return {
    minDownPct: Number(cfg.minDownPaymentPct),
    commissionPct: Number(cfg.storeCommissionPct),
    vatPct: Number(cfg.vatPct),
    ratePctByMonths,
    allowedMonths,
  };
}
