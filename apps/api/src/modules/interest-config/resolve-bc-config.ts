import { PrismaService } from '../../prisma/prisma.service';
import { resolveInstallmentVat } from '../../utils/config.util';

/** VAT = บริษัท FINANCE (`resolveInstallmentVat`) ทั้งกรณีมีและไม่มี config — คำตัดสินเจ้าของ #22 ไม่อ่าน `interest_configs.vat_pct` */
export async function resolveBcConfig(
  prisma: Pick<PrismaService, 'interestConfig' | 'companyInfo' | 'systemConfig'>,
  category: string,
) {
  // Oldest active definition wins; the ID tie-break matches category lookup,
  // ContractQuoteService and ProductQuoteService without changing calculations.
  const cfg = await prisma.interestConfig.findFirst({
    where: {
      productCategories: { has: category },
      deletedAt: null,
      isActive: true,
    },
    include: { rates: { where: { deletedAt: null } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const { vatPct } = await resolveInstallmentVat(prisma);

  if (!cfg) {
    // Fallback: system defaults when no config matches the category
    return {
      minDownPct: 0.15,
      commissionPct: 0.1,
      vatPct,
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
      vatPct,
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
    vatPct,
    ratePctByMonths,
    allowedMonths,
  };
}
