// Seed GFIN tables on production from a fixture passed via env GFIN_FIXTURE_JSON.
// Runs inside the API image (node -e "eval(process.env.SEED_JS)") — no upsert on the
// nullable compound unique (gfin_variant NULL never matches), so rows are matched with
// findFirst + update/create, which is idempotent on re-runs.
const { PrismaClient, Prisma } = require('@prisma/client');
const data = JSON.parse(process.env.GFIN_FIXTURE_JSON);
const prisma = new PrismaClient();
const summary = { mappings: { created: 0, updated: 0 }, rules: { created: 0, updated: 0 }, factors: { created: 0, updated: 0 } };

(async () => {
  for (const mp of data.maxPrices) {
    const existing = await prisma.gfinModelMapping.findFirst({
      where: { gfinSeries: mp.gfinSeries, gfinVariant: mp.gfinVariant, storage: mp.storage, condition: mp.condition, deletedAt: null },
    });
    if (existing) {
      await prisma.gfinModelMapping.update({
        where: { id: existing.id },
        data: { maxPrice: new Prisma.Decimal(mp.maxPrice), modelMatchPattern: mp.modelMatchPattern, isActive: true },
      });
      summary.mappings.updated++;
    } else {
      await prisma.gfinModelMapping.create({
        data: { gfinSeries: mp.gfinSeries, gfinVariant: mp.gfinVariant, storage: mp.storage, condition: mp.condition, maxPrice: new Prisma.Decimal(mp.maxPrice), modelMatchPattern: mp.modelMatchPattern },
      });
      summary.mappings.created++;
    }
  }

  for (const rule of data.overpriceRules) {
    const existing = await prisma.gfinOverpriceRule.findFirst({ where: { label: rule.label, deletedAt: null } });
    const fields = { seriesPattern: rule.seriesPattern, condition: rule.condition, allowance: new Prisma.Decimal(rule.allowance), maxMonths: rule.maxMonths ?? null, isActive: true };
    if (existing) {
      await prisma.gfinOverpriceRule.update({ where: { id: existing.id }, data: fields });
      summary.rules.updated++;
    } else {
      await prisma.gfinOverpriceRule.create({ data: { label: rule.label, ...fields } });
      summary.rules.created++;
    }
  }

  for (const rf of data.rateFactors) {
    const shopCommissionPct = rf.shopCommissionPct ?? 15;
    const existing = await prisma.gfinRateFactor.findFirst({ where: { months: rf.months, shopCommissionPct, deletedAt: null } });
    if (existing) {
      await prisma.gfinRateFactor.update({
        where: { id: existing.id },
        data: { factor: new Prisma.Decimal(rf.factor), feePerInstallment: new Prisma.Decimal(rf.feePerInstallment), isActive: true },
      });
      summary.factors.updated++;
    } else {
      await prisma.gfinRateFactor.create({
        data: { months: rf.months, shopCommissionPct, factor: new Prisma.Decimal(rf.factor), feePerInstallment: new Prisma.Decimal(rf.feePerInstallment) },
      });
      summary.factors.created++;
    }
  }

  // The fixture is the full intended set: soft-delete mappings/rules that are no longer in it
  // (e.g. a series that was split/renamed) so stale rows cannot shadow the new ones.
  // Rate factors are NOT pruned (a rate added by hand must survive a re-seed).
  const mappingKey = (m) => [m.gfinSeries, m.gfinVariant ?? '', m.storage, m.condition].join('|');
  const wantedMappings = new Set(data.maxPrices.map(mappingKey));
  const liveMappings = await prisma.gfinModelMapping.findMany({ where: { deletedAt: null } });
  const staleMappingIds = liveMappings.filter((m) => !wantedMappings.has(mappingKey(m))).map((m) => m.id);
  if (staleMappingIds.length) {
    await prisma.gfinModelMapping.updateMany({ where: { id: { in: staleMappingIds } }, data: { deletedAt: new Date(), isActive: false } });
  }
  const wantedRules = new Set(data.overpriceRules.map((r) => r.label));
  const liveRules = await prisma.gfinOverpriceRule.findMany({ where: { deletedAt: null } });
  const staleRuleIds = liveRules.filter((r) => !wantedRules.has(r.label)).map((r) => r.id);
  if (staleRuleIds.length) {
    await prisma.gfinOverpriceRule.updateMany({ where: { id: { in: staleRuleIds } }, data: { deletedAt: new Date(), isActive: false } });
  }
  summary.pruned = { mappings: staleMappingIds.length, rules: staleRuleIds.length };

  const counts = {
    mappings: await prisma.gfinModelMapping.count({ where: { deletedAt: null } }),
    rules: await prisma.gfinOverpriceRule.count({ where: { deletedAt: null } }),
    factors: await prisma.gfinRateFactor.count({ where: { deletedAt: null } }),
  };
  console.log('SEED_GFIN_RESULT ' + JSON.stringify({ snapshotDate: data.snapshotDate, summary, counts }));
  await prisma.$disconnect();
})().catch((err) => { console.error('SEED_GFIN_FAILED', err); process.exit(1); });
