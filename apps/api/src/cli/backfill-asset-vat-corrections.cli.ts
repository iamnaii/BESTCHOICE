/**
 * Backfill asset VAT input corrections for assets POSTED before CRITICAL #2 fix
 * (PR #792 · 2569-05-09 · ม.82/3 — VAT input creditable regardless of inclusive/exclusive).
 *
 * Before the fix, asset-purchase.template.ts gated `Dr 11-4101` on
 * `!asset.vatInclusive`, so VAT-inclusive purchases lost the input credit
 * (cash Cr was understated by vatAmount, and 11-4101 never accumulated).
 *
 * This CLI scans for affected assets and posts a correction JE per asset:
 *   Dr 11-4101 vatAmount
 *   Cr 12-2XXX vatAmount  (the asset cost account, taken from coaCostAccount snapshot)
 *
 * Net effect: NBV unchanged (cost reduced + VAT credit recognized), and the
 * remaining depreciation schedule continues from the corrected NBV.
 *
 * Idempotency: writes a metadata.flow='asset-vat-backfill' marker on each
 * correction JE keyed to the assetId. Re-running the CLI skips already-corrected
 * assets.
 *
 * Guards:
 *   - DRY_RUN=true → only reports affected assets, doesn't write JEs (default)
 *   - DRY_RUN=false → actually posts correction JEs (requires explicit opt-in)
 *   - EXPECTED_DB_NAME must match current_database()
 *
 * Production invocation (DRY RUN):
 *   gcloud run jobs execute backfill-asset-vat --region=asia-southeast1 \
 *     --project=bestchoice-prod \
 *     --update-env-vars=EXPECTED_DB_NAME=bestchoice_prod,DRY_RUN=true \
 *     --wait
 *
 * Production invocation (LIVE):
 *   ... DRY_RUN=false ALLOW_PROD_BACKFILL=YES_I_AM_SURE
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

interface AffectedAsset {
  id: string;
  assetCode: string;
  vatAmount: Decimal;
  coaCostAccount: string | null;
  entryNumber: string;
  postedAt: Date;
}

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    process.exit(1);
  }

  const dryRun = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

  const prisma = new PrismaClient();
  const [{ current_database: actualDb }] = await prisma.$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}"`);
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!dryRun && actualDb === 'bestchoice_prod') {
    if (process.env.ALLOW_PROD_BACKFILL !== 'YES_I_AM_SURE') {
      console.error(
        'ERROR: production live run requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE',
      );
      await prisma.$disconnect();
      process.exit(1);
    }
    console.warn(
      '[backfill] LIVE prod run starting in 5s — Ctrl+C to abort.',
    );
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log(`[backfill] Mode: ${dryRun ? 'DRY_RUN' : 'LIVE'}`);
  console.log(`[backfill] Connected to "${actualDb}". Scanning VAT-inclusive POSTED assets...`);

  // Find assets that are vatInclusive=true + hasVat=true + status=POSTED
  // and whose original purchase JE doesn't include a Dr 11-4101 line.
  const candidates = await prisma.fixedAsset.findMany({
    where: {
      vatInclusive: true,
      hasVat: true,
      status: { in: ['POSTED', 'DISPOSED', 'WRITTEN_OFF'] },
      deletedAt: null,
      vatAmount: { gt: 0 },
    },
    select: {
      id: true,
      assetCode: true,
      vatAmount: true,
      coaCostAccount: true,
    },
  });

  console.log(`[backfill] Found ${candidates.length} candidate asset(s) with vatInclusive=true.`);

  const affected: AffectedAsset[] = [];
  for (const asset of candidates) {
    // Skip if a backfill correction was already posted
    const alreadyCorrected = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-vat-backfill' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
        deletedAt: null,
      },
    });
    if (alreadyCorrected) continue;

    // Find the original purchase JE for this asset
    const originalPurchase = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-purchase' } as any },
          { metadata: { path: ['assetId'], equals: asset.id } as any },
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    if (!originalPurchase) continue;

    // Skip if the original already had Dr 11-4101 (already-correct or already-fixed assets)
    const hasVatLine = originalPurchase.lines.some(
      (l) => l.accountCode === '11-4101' && new Decimal(l.debit.toString()).gt(0),
    );
    if (hasVatLine) continue;

    affected.push({
      id: asset.id,
      assetCode: asset.assetCode,
      vatAmount: new Decimal(asset.vatAmount.toString()),
      coaCostAccount: asset.coaCostAccount,
      entryNumber: originalPurchase.entryNumber,
      postedAt: originalPurchase.postedAt ?? originalPurchase.createdAt,
    });
  }

  console.log(`[backfill] ${affected.length} asset(s) need correction.`);
  if (affected.length === 0) {
    console.log('[backfill] Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  for (const a of affected) {
    console.log(
      `  - ${a.assetCode} (id=${a.id}) — original JE ${a.entryNumber}, vatAmount=${a.vatAmount.toFixed(2)}`,
    );
  }

  if (dryRun) {
    console.log('[backfill] DRY_RUN — no JEs posted. Set DRY_RUN=false to apply.');
    await prisma.$disconnect();
    return;
  }

  // Resolve FINANCE company + system user (required for JournalEntry FKs)
  const financeCompany = await prisma.companyInfo.findFirst({
    where: { companyCode: 'FINANCE' },
    select: { id: true },
  });
  if (!financeCompany) {
    console.error('ERROR: FINANCE company not found in CompanyInfo');
    await prisma.$disconnect();
    process.exit(1);
  }
  const systemUser = await prisma.user.findFirst({
    where: { email: 'admin@bestchoice.com' },
    select: { id: true },
  });
  if (!systemUser) {
    console.error('ERROR: admin@bestchoice.com user not found (needed for createdById FK)');
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log('[backfill] Posting correction JEs...');
  let posted = 0;
  let skipped = 0;

  for (const a of affected) {
    if (!a.coaCostAccount) {
      console.warn(
        `  [skip] ${a.assetCode}: missing coaCostAccount snapshot — cannot determine credit account`,
      );
      skipped++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Re-check inside tx to prevent double-post on concurrent runs
        const racing = await tx.journalEntry.findFirst({
          where: {
            AND: [
              { metadata: { path: ['flow'], equals: 'asset-vat-backfill' } as any },
              { metadata: { path: ['assetId'], equals: a.id } as any },
            ],
            deletedAt: null,
          },
        });
        if (racing) {
          skipped++;
          return;
        }

        const seq = await tx.$queryRaw<{ next: bigint }[]>`
          SELECT nextval('journal_entry_seq') as next
        `;
        const entryNumber = `JEB-${new Date().toISOString().slice(0, 7).replace('-', '')}-${String(seq[0].next).padStart(5, '0')}`;

        // Post correction: Dr 11-4101 / Cr <coaCostAccount>
        const now = new Date();
        await tx.journalEntry.create({
          data: {
            entryNumber,
            companyId: financeCompany.id,
            entryDate: now,
            description: `แก้ไขภาษีซื้อ inclusive - ${a.assetCode} (CRITICAL #2 backfill)`,
            referenceType: 'ASSET',
            referenceId: `${a.id}:asset-vat-backfill`,
            status: 'POSTED',
            postedAt: now,
            postedById: systemUser.id,
            createdById: systemUser.id,
            metadata: {
              tag: 'ASSET_VAT_BACKFILL',
              flow: 'asset-vat-backfill',
              assetId: a.id,
              assetCode: a.assetCode,
              originalEntryNumber: a.entryNumber,
              vatAmount: a.vatAmount.toFixed(2),
              reason: 'CRITICAL #2 ม.82/3 — recover VAT input on inclusive purchase',
            } as Prisma.InputJsonValue,
            lines: {
              create: [
                {
                  accountCode: '11-4101',
                  debit: a.vatAmount,
                  credit: new Decimal(0),
                  description: `ภาษีซื้อ (backfill) - ${a.assetCode}`,
                },
                {
                  accountCode: a.coaCostAccount!,
                  debit: new Decimal(0),
                  credit: a.vatAmount,
                  description: `กลับราคาทุน (extracted VAT) - ${a.assetCode}`,
                },
              ],
            },
          },
        });

        // Reduce the asset's purchaseCost + netBookValue by vatAmount (VAT belongs in 11-4101 not 12-2XXX)
        const asset = await tx.fixedAsset.findUnique({ where: { id: a.id } });
        if (asset) {
          const newPurchaseCost = new Decimal(asset.purchaseCost.toString()).minus(a.vatAmount);
          const newNbv = newPurchaseCost.minus(new Decimal(asset.accumulatedDepr.toString()));
          await tx.fixedAsset.update({
            where: { id: a.id },
            data: {
              purchaseCost: newPurchaseCost,
              netBookValue: newNbv.gt(0) ? newNbv : new Decimal(0),
            },
          });
        }

        posted++;
      });
    } catch (err) {
      console.error(`  [error] ${a.assetCode}: ${(err as Error).message}`);
      skipped++;
    }
  }

  console.log(`[backfill] Done. posted=${posted} skipped=${skipped}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[backfill] FATAL:', err);
  process.exit(1);
});
