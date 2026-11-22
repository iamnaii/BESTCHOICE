import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashSourceDecisions } from '../canonicalize';
import { readImportDatabaseIdentity } from '../plan';
import type { CanonicalInput, CanonicalStockUnit, PlannedItem, SourceDecisions } from '../types';
import { stockTargetFingerprint } from '../plan';
import type { Prisma } from '@prisma/client';

const sha = 'a'.repeat(64);
const cutoverAt = '2026-11-19T18:00:00+07:00';

export async function stockInput(db: PrismaClient, count = 1) {
  const company = await db.companyInfo.upsert({
    where: { companyCode: 'SHOP' },
    update: {},
    create: {
      companyCode: 'SHOP',
      nameTh: 'fixture',
      address: '',
      taxId: 'fixture',
      directorName: '',
    },
  });
  const branch = await db.branch.create({ data: { name: 'fixture', companyId: company.id } });
  const storeKey = randomUUID();
  const rows: CanonicalStockUnit[] = Array.from({ length: count }, (_, i) => {
    const barcode = BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12))
      .toString()
      .padStart(15, '0');
    const sourceKey = createHash('sha256')
      .update(JSON.stringify([storeKey, barcode]))
      .digest('hex');
    return {
      sourceKey,
      source: { fileSha256: sha, row: i + 3, storeKey, sheet: 'Worksheet' },
      kind: 'DEVICE',
      category: 'PHONE_NEW',
      deviceOrigin: null,
      barcode,
      name: 'Fixture phone',
      brand: 'Acme',
      model: 'Alpha',
      storage: null,
      color: null,
      cost: '100.00',
      cashPrice: null,
      installmentPrice: null,
      financePrice: null,
      branchId: branch.id,
      sourceStatus: null,
      desiredStatus: null,
      importedAt: '2026-11-18T00:00:00+07:00',
      priceEvidence: null,
    };
  });
  const base = {
    fileSha256: sha,
    sourceRows: rows.map((r) => r.source.row),
    reason: 'synthetic fixture',
    evidenceRef: 'fixture-count',
  };
  const decisions: SourceDecisions = {
    entries: [
      { ...base, action: 'SELECT_SNAPSHOT', asOf: cutoverAt, storeKey, branchId: branch.id },
      {
        ...base,
        action: 'RESOLVE_STOCK',
        desiredStatus: 'IN_STOCK',
        deviceOrigin: null,
        pricing: {
          mode: 'EXPLICIT',
          cashPrice: '200.00',
          installmentPrice: null,
          financePrice: null,
        },
      },
    ],
  };
  return {
    kind: 'STOCK' as const,
    rows,
    decisions,
    issues: [],
    excluded: [],
    expectedDbIdentity: (await readImportDatabaseIdentity(db)).fingerprint,
    codeRevision: 'fixture-rev',
    manifest: {
      version: 1 as const,
      companyCode: 'SHOP' as const,
      cutoverAt,
      canonicalSetId: randomUUID(),
      decisionsSha256: hashSourceDecisions(decisions),
      files: [
        {
          path: 'fixture.xlsx',
          sha256: sha,
          storeKey,
          branchId: branch.id,
          kind: 'STOCK_SNAPSHOT' as const,
          reportFrom: cutoverAt.slice(0, 10),
          reportTo: cutoverAt.slice(0, 10),
        },
      ],
    },
  } satisfies CanonicalInput;
}

export function productData(row: CanonicalStockUnit) {
  return {
    name: row.name,
    model: row.model,
    brand: row.brand,
    category: row.category,
    branchId: row.branchId,
    imeiSerial: row.barcode,
    costPrice: row.cost,
    cashPrice: '200.00',
  };
}

export async function createFixtureTarget(tx: Prisma.TransactionClient, item: PlannedItem) {
  if (item.kind !== 'STOCK') throw Error('expected stock');
  const product = await tx.product.create({
    data: {
      ...productData(item.payload),
      legacyProductCode: 'TTFY-CUTOVER:' + item.batchId + ':' + item.sourceKey,
    },
  });
  return {
    targetType: 'PRODUCT' as const,
    targetId: product.id,
    created: true,
    afterFingerprint: await stockTargetFingerprint(tx, product.id),
  };
}
