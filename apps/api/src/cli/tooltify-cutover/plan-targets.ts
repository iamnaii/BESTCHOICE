import { isReviewedZeroPriceGift, validAccessoryCompatibility } from './gift-accessory';
import { resolveStockSupplier } from './supplier-link';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasSellingPrice } from '../../modules/products/product-enter-stock.util';
import {
  assertProductNotHeld,
  type ProductHoldSubject,
} from '../../modules/products/product-hold.util';
import { findPricingTemplate, positiveDecimal } from '../../utils/pricing-template-match.util';
import { templateKeyOf } from '../../utils/product-finance-price.util';
import {
  CASH_LABEL,
  FINANCE_LABEL,
  isInstallmentPriceLabel,
} from '../../utils/product-price-sync.util';
import { hashImportValue as hash, receiptDigest } from './canonicalize';
import type { CanonicalSaleLine, PlannedItem, PlannedSalesItem, PlannedStockItem } from './types';

type Db = Prisma.TransactionClient;
const stockInclude = { prices: { orderBy: { id: 'asc' as const } } };
export function readStockTarget(db: Db, id: string) {
  return db.product.findUniqueOrThrow({ where: { id }, include: stockInclude });
}
export async function stockTargetFingerprint(db: Db, id: string) {
  return hash(await readStockTarget(db, id));
}
// Availability can change without changing a Product or its prices.
export async function stockEligibilityIssue(db: Db, target: ProductHoldSubject) {
  if (
    await db.contract.count({
      where: { OR: [{ productId: target.id }, { bundleProductIds: { has: target.id } }] },
    })
  )
    return 'REFERENCED_STOCK_TARGET';
  try {
    await assertProductNotHeld(db, target, 'STOCK_ADJUST');
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return 'HELD_STOCK_TARGET';
  }
  return null;
}
export async function salesTargetFingerprint(db: Db, id: string) {
  return hash(saleTargetSnapshot(await db.importedSale.findUniqueOrThrow({ where: { id } })));
}
// Keep occurrence=1 fingerprints compatible with receipts written before this additive migration.
export function saleTargetSnapshot<T extends { sourceOccurrence?: number }>(row: T): T {
  if (row.sourceOccurrence !== 1) return row;
  const { sourceOccurrence: _occurrence, ...legacy } = row;
  return legacy as T;
}
export function saleIdentity(
  row: { barcode: string; orderNumber: string; soldAt: Date },
  occurrence = 1,
) {
  const identity: unknown[] = ['TOOLTIFY', row.barcode, row.orderNumber, row.soldAt];
  if (occurrence !== 1) identity.push(occurrence);
  return hash(identity);
}
export function hasMultiplicityEvidence(item: PlannedSalesItem) {
  const row = item.payload,
    d = item.multiplicityEvidence;
  return (
    Number.isSafeInteger(row.occurrence) &&
    row.occurrence > 0 &&
    (row.occurrence === 1 ||
      !!(
        d &&
        d.action === 'DISTINCT_UNITS' &&
        d.reason.trim() &&
        d.evidenceRef.trim() &&
        d.fileSha256 === row.source.fileSha256 &&
        d.sourceRows.length >= row.occurrence &&
        d.sourceRows.includes(row.source.row)
      ))
  );
}
/** Verify the writer returned the target created for this exact canonical item before assigning reversal ownership. */
export async function assertCreatedTarget(db: Db, item: PlannedItem, id: string) {
  if (item.kind === 'STOCK') {
    const product = await db.product.findUniqueOrThrow({
      where: { id },
      select: { legacyProductCode: true, imeiSerial: true, branchId: true, category: true },
    });
    const expectedCode = 'TTFY-CUTOVER:' + item.batchId + ':' + item.sourceKey;
    if (
      product.legacyProductCode !== expectedCode ||
      product.branchId !== item.branchId ||
      product.category !== item.payload.category ||
      product.imeiSerial !== (item.payload.kind === 'DEVICE' ? item.payload.barcode : null)
    )
      throw Error('IMPORT_TARGET_OWNERSHIP_MISMATCH');
    return;
  }
  const sale = await db.importedSale.findUniqueOrThrow({ where: { id } });
  if (
    sale.source !== 'TOOLTIFY' ||
    sale.sourceOccurrence !== item.payload.occurrence ||
    sale.importBatch !== item.batchId ||
    hash(saleContent(sale)) !== hash(saleContent(item.payload))
  )
    throw Error('IMPORT_TARGET_OWNERSHIP_MISMATCH');
}

export function identityHash(item: PlannedItem): string {
  if (item.kind === 'SALES') return saleIdentity(item.payload, item.payload.occurrence);
  const row = item.payload;
  return row.kind === 'DEVICE'
    ? hash(['DEVICE', row.barcode])
    : hash(['ACCESSORY', row.branchId, row.barcode]);
}

export function sourceRefJson(ref: CanonicalSaleLine['source']) {
  return { fileSha256: ref.fileSha256, sheet: ref.sheet, row: ref.row, storeKey: ref.storeKey };
}

async function readBranch(db: Db, id: string) {
  return db.branch.findUnique({
    where: { id },
    select: {
      id: true,
      isActive: true,
      deletedAt: true,
      companyId: true,
      company: { select: { id: true, companyCode: true, isActive: true, deletedAt: true } },
    },
  });
}
function validBranch(branch: Awaited<ReturnType<typeof readBranch>>) {
  return (
    !!branch?.isActive &&
    !branch.deletedAt &&
    !!branch.company?.isActive &&
    !branch.company.deletedAt &&
    branch.company.companyCode === 'SHOP'
  );
}

async function findStockTargets(db: Db, item: PlannedStockItem) {
  const row = item.original;
  if (row.kind === 'DEVICE') {
    return db.product.findMany({
      where: { OR: [{ imeiSerial: row.barcode }, { legacyProductCode: 'TTFY-' + row.barcode }] },
      include: stockInclude,
      orderBy: { id: 'asc' },
    });
  }
  const mappedIds = (item.accessoryMapping?.assignments ?? []).flatMap((a) =>
    a.targetId ? [a.targetId] : [],
  );
  const prior = await db.tooltifyImportItem.findMany({
    where: {
      identityHash: identityHash(item),
      batchId: { not: item.batchId },
      batch: { deletedAt: null, status: { not: 'ROLLED_BACK' } },
      targetType: 'PRODUCT',
      deletedAt: null,
      reversedAt: null,
    },
    select: { targetId: true },
  });
  const knownIds = [...mappedIds, ...prior.flatMap((r) => (r.targetId ? [r.targetId] : []))];
  const prefix = 'TTFY-' + row.barcode + '-';
  const candidates = await db.product.findMany({
    where: {
      OR: [
        { id: { in: knownIds } },
        { branchId: row.branchId, legacyProductCode: { startsWith: prefix } },
      ],
    },
    include: stockInclude,
    orderBy: { id: 'asc' },
  });
  // Legacy accessories were numbered per SKU. SKU prefixes may themselves contain hyphens.
  return candidates.filter(
    (p) =>
      mappedIds.includes(p.id) ||
      (!p.deletedAt &&
        !['SOLD_CASH', 'SOLD_INSTALLMENT', 'SOLD_RESELL', 'LOST', 'WRITTEN_OFF'].includes(
          p.status,
        ) &&
        (knownIds.includes(p.id) ||
          (p.legacyProductCode?.startsWith(prefix) &&
            /^\d+$/.test(p.legacyProductCode.slice(prefix.length))))),
  );
}

async function evaluateStock(db: Db, item: PlannedStockItem): Promise<PlannedStockItem> {
  const { original: raw, decision, accessoryMapping } = item;
  const branch = await readBranch(db, raw.branchId);
  const payload = {
    ...raw,
    brand: decision?.accessoryCompatibility?.brand ?? raw.brand,
    model: decision?.accessoryCompatibility?.model ?? raw.model,
    desiredStatus: decision?.desiredStatus ?? null,
    deviceOrigin: decision?.deviceOrigin ?? raw.deviceOrigin,
    priceEvidence: decision?.evidenceRef ?? null,
  };
  let reason: string | null = null;
  if (!validBranch(branch)) reason = 'INVALID_SHOP_BRANCH';
  const template =
    decision?.pricing.mode === 'TEMPLATE'
      ? await findPricingTemplate(
          db,
          templateKeyOf({ ...payload, warrantyExpired: null, warrantyExpireDate: null }),
        )
      : null;
  const explicit = decision?.pricing.mode === 'EXPLICIT' ? decision.pricing : null;
  const templateCash = positiveDecimal(template?.cashPrice);
  // autofillProductPriceFromTemplate only writes installment alongside a positive template cash price.
  let supplierLink;
  let supplierIssue: string | null = null;
  try {
    supplierLink = await resolveStockSupplier(db, raw, decision);
  } catch (e) {
    supplierIssue = e instanceof Error ? e.message : 'SUPPLIER_LINK_REQUIRED';
  }
  const resolution = {
    ...(supplierLink ? { supplierLink } : {}),
    companyId: branch?.companyId ?? null,
    templateId: template?.id ?? null,
    cashPrice: explicit ? explicit.cashPrice : (templateCash?.toFixed(2) ?? null),
    installmentPrice: explicit
      ? explicit.installmentPrice
      : templateCash
        ? (positiveDecimal(template?.installmentBestchoicePrice)?.toFixed(2) ?? null)
        : null,
    financePrice: explicit
      ? explicit.financePrice
      : (positiveDecimal(template?.installmentFinancePrice)?.toFixed(2) ?? null),
  };
  Object.assign(payload, {
    cashPrice: resolution.cashPrice,
    installmentPrice: resolution.installmentPrice,
    financePrice: resolution.financePrice,
  });
  if (!decision || !['IN_STOCK', 'QC_PENDING'].includes(decision.desiredStatus))
    reason = 'UNRESOLVED_STOCK_STATUS';
  else if (
    !['EXPLICIT', 'TEMPLATE'].includes(decision.pricing.mode) ||
    (explicit &&
      [explicit.cashPrice, explicit.installmentPrice, explicit.financePrice].some(
        (v) => v !== null && (typeof v !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(v)),
      ))
  )
    reason = 'INVALID_STOCK_PRICING';
  else if (
    (raw.deviceOrigin && raw.deviceOrigin !== decision.deviceOrigin) ||
    ![null, 'THAI', 'IMPORTED'].includes(decision.deviceOrigin) ||
    (raw.kind === 'ACCESSORY' && decision.deviceOrigin !== null)
  )
    reason = 'INVALID_DEVICE_ORIGIN';
  else if (!validAccessoryCompatibility(raw, decision)) reason = 'INVALID_ACCESSORY_COMPATIBILITY';
  else if (decision.zeroPriceGift !== undefined && !isReviewedZeroPriceGift(raw, decision))
    reason = 'INVALID_ZERO_PRICE_GIFT';
  else if (
    payload.desiredStatus === 'IN_STOCK' &&
    !hasSellingPrice(payload) &&
    !isReviewedZeroPriceGift(raw, decision)
  )
    reason = 'MISSING_SELLING_PRICE';

  const observedTargets = await findStockTargets(db, item);
  const reviewed = decision?.reviewedArchivedTargetIds ?? [];
  const validArchivedReview =
    Array.isArray(reviewed) &&
    reviewed.length === new Set(reviewed).size &&
    reviewed.every(
      (id) => typeof id === 'string' && observedTargets.some((p) => p.id === id && p.deletedAt),
    );
  if (!validArchivedReview) reason = 'INVALID_ARCHIVED_STOCK_REVIEW';
  const targets = observedTargets.filter((p) => !reviewed.includes(p.id) || !p.deletedAt);
  for (const archived of observedTargets.filter((p) => reviewed.includes(p.id) && p.deletedAt)) {
    // The reviewed tombstone is never restored or modified. Check its status and all
    // financial/hold references without asking the mutation guard to restore a deleted row.
    const issue = await stockEligibilityIssue(db, { id: archived.id, status: archived.status });
    if (issue) reason = issue;
  }
  let target: (typeof targets)[number] | undefined = targets[0];
  let claimedIdentities: string[] = [];
  if (raw.kind === 'ACCESSORY') {
    const assignments = accessoryMapping?.assignments ?? [];
    const assigned = assignments.find((a) => a.row === raw.source.row);
    target = targets.find((p) => p.id === assigned?.targetId);
    if (target) {
      // Earlier Tooltify stock writes numbered units within a SKU, including SKUs containing hyphens.
      const legacySku = /^TTFY-(.+)-[0-9]+$/.exec(target.legacyProductCode ?? '')?.[1];
      const claims = await db.tooltifyImportItem.findMany({
        where: {
          targetId: target.id,
          targetType: 'PRODUCT',
          batch: { deletedAt: null, status: { not: 'ROLLED_BACK' } },
          reversedAt: null,
          deletedAt: null,
          disposition: { in: ['CREATE', 'MATCH'] },
        },
        distinct: ['identityHash'],
        select: { identityHash: true },
        orderBy: { identityHash: 'asc' },
      });
      claimedIdentities = claims.map((c) => c.identityHash);
      if (
        (legacySku !== undefined && legacySku !== raw.barcode) ||
        claimedIdentities.some((key) => key !== identityHash(item))
      )
        reason = 'ACCESSORY_TARGET_IDENTITY_CONFLICT';
    }
    if (
      !assigned ||
      (assigned.targetId && !target) ||
      targets.some((p) => !assignments.some((a) => a.targetId === p.id))
    )
      reason = 'ACCESSORY_MAPPING_CONFLICT';
  } else if (targets.length > 1) reason = 'AMBIGUOUS_STOCK_IDENTITY';

  if (target) {
    if (
      (supplierLink !== undefined && target.supplierId !== supplierLink.targetId) ||
      target.deletedAt ||
      target.branchId !== raw.branchId ||
      target.status !== payload.desiredStatus ||
      (target.ownedByCompanyId !== null && target.ownedByCompanyId !== branch?.companyId) ||
      target.category !== raw.category ||
      target.brand !== payload.brand ||
      target.model !== payload.model ||
      target.storage !== raw.storage ||
      target.color !== raw.color ||
      target.deviceOrigin !== payload.deviceOrigin ||
      (raw.kind === 'DEVICE' && target.imeiSerial !== raw.barcode) ||
      (raw.kind === 'ACCESSORY' && target.imeiSerial !== null) ||
      !target.costPrice.equals(raw.cost) ||
      (['cashPrice', 'installmentPrice', 'financePrice'] as const).some(
        (key) =>
          (target[key]?.toFixed(2) ?? null) !==
          (payload[key] === null ? null : new Prisma.Decimal(payload[key]).toFixed(2)),
      ) ||
      target.prices.some((price) => {
        if (price.deletedAt) return false;
        const column =
          price.label === FINANCE_LABEL
            ? 'financePrice'
            : isInstallmentPriceLabel(price.label)
              ? 'installmentPrice'
              : price.label === CASH_LABEL || price.isDefault
                ? 'cashPrice'
                : null;
        return (
          column !== null &&
          (payload[column] === null ||
            !price.amount.equals(payload[column]) ||
            (price.isDefault && column === 'financePrice'))
        );
      }) ||
      (payload.desiredStatus === 'IN_STOCK' &&
        !hasSellingPrice(target) &&
        !isReviewedZeroPriceGift(raw, decision))
    )
      reason = 'STOCK_TARGET_CONFLICT';
    if (!reason) reason = await stockEligibilityIssue(db, target);
  }
  if (!reason && supplierIssue) reason = supplierIssue;
  return {
    ...item,
    payload,
    resolution,
    reason,
    disposition: reason ? 'CONFLICT' : target ? 'MATCH' : 'CREATE',
    targetId: target?.id ?? null,
    dependencyFingerprint: hash({
      branch,
      template,
      targets: observedTargets,
      claimedIdentities,
      reason,
      resolution,
    }),
  };
}

const saleMoney = ['costTotal', 'listPrice', 'salePrice', 'profit'] as const;
export function saleContent(
  row: Pick<
    CanonicalSaleLine,
    | 'barcode'
    | 'productName'
    | 'category'
    | 'buyerLabel'
    | 'shopLabel'
    | 'orderNumber'
    | 'paymentType'
    | 'priceGroup'
    | 'saleChannel'
    | 'salespersonName'
    | 'soldAt'
  > &
    Record<(typeof saleMoney)[number], Prisma.Decimal | string>,
) {
  return {
    barcode: row.barcode,
    productName: row.productName,
    category: row.category,
    buyerLabel: row.buyerLabel,
    shopLabel: row.shopLabel,
    orderNumber: row.orderNumber,
    paymentType: row.paymentType,
    priceGroup: row.priceGroup,
    saleChannel: row.saleChannel,
    salespersonName: row.salespersonName,
    soldAt: row.soldAt,
    ...Object.fromEntries(saleMoney.map((k) => [k, new Prisma.Decimal(row[k]).toFixed(2)])),
  };
}

// Prisma adds binds for the receipt predicates in addition to the IN list.
const SALE_ORIGIN_ID_BATCH_SIZE = 10_000;

async function readSaleOriginBatches<Row>(
  ids: string[],
  findMany: (ids: string[]) => Promise<Row[]>,
): Promise<Row[]> {
  const uniqueIds = [...new Set(ids)];
  const rows: Row[] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += SALE_ORIGIN_ID_BATCH_SIZE) {
    const batch = uniqueIds.slice(offset, offset + SALE_ORIGIN_ID_BATCH_SIZE);
    for (const row of await findMany(batch)) rows.push(row);
  }
  return rows;
}

// ImportedSale has no branch column. Only its original active CREATE receipt and
// that owner's frozen file map can attribute the historical target.
export async function readSaleOrigins(
  db: Db,
  sales: {
    id: string;
    importBatch: string | null;
    sourceOccurrence?: number;
    barcode: string;
    orderNumber: string;
    soldAt: Date;
  }[],
) {
  const origins = new Map<string, { branchId: string; storeKey: string }>();
  if (!sales.length) return origins;
  const receipts = await readSaleOriginBatches(
    sales.map((s) => s.id),
    (ids) =>
      db.tooltifyImportItem.findMany({
        where: {
          targetType: 'IMPORTED_SALE',
          disposition: 'CREATE',
          targetId: { in: ids },
          deletedAt: null,
          reversedAt: null,
          batch: { kind: 'SALES', deletedAt: null, status: { not: 'ROLLED_BACK' } },
        },
        select: { targetId: true, batchId: true, sourceRefs: true, identityHash: true },
      }),
  );
  const owners = await readSaleOriginBatches(
    receipts.map((r) => r.batchId),
    (ids) =>
      db.tooltifyImportBatch.findMany({
        where: { id: { in: ids } },
        select: { id: true, reconciliationSnapshot: true },
      }),
  );
  // Verify once per owning batch in whole-plan and reconciliation reads. The row writer
  // rechecks its reviewed target/owner dependency in each serializable item transaction.
  const evidence = await readSaleOriginBatches(
    owners.map((b) => b.id),
    (ids) =>
      db.tooltifyImportItem.findMany({
        where: { batchId: { in: ids }, reversedAt: null, deletedAt: null },
        select: {
          batchId: true,
          sourceKey: true,
          disposition: true,
          payloadHash: true,
          identityHash: true,
          sourceRefs: true,
          targetId: true,
        },
      }),
  );
  const byOwner = new Map<string, typeof evidence>();
  for (const receipt of evidence) {
    const rows = byOwner.get(receipt.batchId) ?? [];
    rows.push(receipt);
    byOwner.set(receipt.batchId, rows);
  }
  const filesByOwner = new Map<string, Prisma.JsonArray>();
  for (const owner of owners) {
    const snapshot = owner.reconciliationSnapshot;
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      !Array.isArray(snapshot.files)
    )
      continue;
    if (receiptDigest(byOwner.get(owner.id) ?? []) !== snapshot.expectedReceiptsHash) continue;
    filesByOwner.set(owner.id, snapshot.files);
  }
  const targets = new Map(sales.map((s) => [s.id, s]));
  const seen = new Set<string>();
  for (const r of receipts) {
    const id = r.targetId!;
    if (seen.has(id)) {
      origins.delete(id);
      continue;
    }
    seen.add(id);
    const target = targets.get(id);
    if (
      !target ||
      target.importBatch !== r.batchId ||
      r.identityHash !== saleIdentity(target, target.sourceOccurrence ?? 1) ||
      !Array.isArray(r.sourceRefs) ||
      r.sourceRefs.length !== 1
    )
      continue;
    const ref = r.sourceRefs[0];
    if (
      !ref ||
      typeof ref !== 'object' ||
      Array.isArray(ref) ||
      typeof ref.storeKey !== 'string' ||
      !ref.storeKey ||
      typeof ref.fileSha256 !== 'string'
    )
      continue;
    const files = filesByOwner
      .get(r.batchId)
      ?.filter(
        (f) => f && typeof f === 'object' && !Array.isArray(f) && f.fileSha256 === ref.fileSha256,
      );
    const f = files?.length === 1 ? files[0] : null;
    if (
      f &&
      typeof f === 'object' &&
      !Array.isArray(f) &&
      typeof f.branchId === 'string' &&
      f.branchId
    )
      origins.set(id, { branchId: f.branchId, storeKey: ref.storeKey });
  }
  return origins;
}

export type SaleOrigins = Awaited<ReturnType<typeof readSaleOrigins>>;

// A bulk check is local to the transaction in which it is read. Item transactions
// start independently and must establish the complete owning receipt set again.
export async function readSaleOriginsFor(db: Db, where: Prisma.ImportedSaleWhereInput) {
  const sales = await db.importedSale.findMany({
    where,
    select: {
      id: true,
      importBatch: true,
      barcode: true,
      orderNumber: true,
      soldAt: true,
      sourceOccurrence: true,
    },
  });
  return readSaleOrigins(db, sales);
}

async function evaluateSales(
  db: Db,
  item: PlannedSalesItem,
  origins?: SaleOrigins,
): Promise<PlannedSalesItem> {
  const row = item.payload;
  const branch = await readBranch(db, item.branchId);
  const bill = await db.importedSale.findMany({
    where: { source: 'TOOLTIFY', orderNumber: row.orderNumber },
    select: { id: true, barcode: true, soldAt: true, sourceOccurrence: true },
  });
  const receipts = await db.tooltifyImportItem.findMany({
    where: {
      targetType: 'IMPORTED_SALE',
      targetId: { in: bill.map((b) => b.id) },
      reversedAt: null,
      deletedAt: null,
    },
    select: { sourceRefs: true, targetId: true },
  });
  const stores = new Set(
    receipts.flatMap((r) =>
      Array.isArray(r.sourceRefs) && r.sourceRefs.length
        ? r.sourceRefs.map((ref) =>
            ref && typeof ref === 'object' && !Array.isArray(ref) ? ref.storeKey : null,
          )
        : [null],
    ),
  );
  const existing = bill.find(
    (b) =>
      b.barcode === row.barcode &&
      b.soldAt.getTime() === row.soldAt.getTime() &&
      b.sourceOccurrence === row.occurrence,
  );
  const target = existing
    ? await db.importedSale.findUniqueOrThrow({ where: { id: existing.id } })
    : null;
  const origin = target ? (origins ?? (await readSaleOrigins(db, [target]))).get(target.id) : null;
  let reason: string | null = null;
  if (!validBranch(branch)) reason = 'INVALID_SHOP_BRANCH';
  else if (!hasMultiplicityEvidence(item)) reason = 'UNSUPPORTED_SALES_MULTIPLICITY';
  else if (bill.some((line) => !receipts.some((r) => r.targetId === line.id)))
    reason = 'UNPROVEN_LEGACY_SALE_STORE';
  else if ([...stores].some((store) => store !== row.sourceStoreKey))
    reason = 'SALES_STORE_COLLISION';
  else if (target && !origin) reason = 'UNPROVEN_SALE_ORIGIN';
  else if (origin && origin.branchId !== item.branchId) reason = 'SALE_ORIGIN_BRANCH_CONFLICT';
  else if (target && hash(saleContent(target)) !== hash(saleContent(row)))
    reason = 'SALE_TARGET_CONFLICT';
  // Other lines from this batch can legitimately add the same store to an existing bill.
  return {
    ...item,
    targetId: target?.id ?? null,
    reason,
    disposition: reason ? 'CONFLICT' : target ? 'MATCH' : 'CREATE',
    dependencyFingerprint: hash({
      branch,
      target: target ? saleTargetSnapshot(target) : null,
      origin,
      reason,
    }),
  };
}

export function evaluateItem(
  db: Db,
  item: PlannedItem,
  origins?: SaleOrigins,
): Promise<PlannedItem> {
  return item.kind === 'STOCK' ? evaluateStock(db, item) : evaluateSales(db, item, origins);
}
