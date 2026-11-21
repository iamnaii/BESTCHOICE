import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasSellingPrice } from '../../modules/products/product-enter-stock.util';
import { assertProductNotHeld } from '../../modules/products/product-hold.util';
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
export async function stockTargetFingerprint(db: Db, id: string) {
  const target = await db.product.findUniqueOrThrow({ where: { id }, include: stockInclude });
  return hash(target);
}
export async function salesTargetFingerprint(db: Db, id: string) {
  return hash(await db.importedSale.findUniqueOrThrow({ where: { id } }));
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
    sale.importBatch !== item.batchId ||
    hash(saleContent(sale)) !== hash(saleContent(item.payload))
  )
    throw Error('IMPORT_TARGET_OWNERSHIP_MISMATCH');
}

export function identityHash(item: PlannedItem): string {
  if (item.kind === 'SALES')
    return hash(['TOOLTIFY', item.payload.barcode, item.payload.orderNumber, item.payload.soldAt]);
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
  const resolution = {
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
  else if (payload.desiredStatus === 'IN_STOCK' && !hasSellingPrice(payload))
    reason = 'MISSING_SELLING_PRICE';

  const targets = await findStockTargets(db, item);
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
      target.deletedAt ||
      target.branchId !== raw.branchId ||
      target.status !== payload.desiredStatus ||
      (target.ownedByCompanyId !== null && target.ownedByCompanyId !== branch?.companyId) ||
      target.category !== raw.category ||
      target.brand !== raw.brand ||
      target.model !== raw.model ||
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
      (payload.desiredStatus === 'IN_STOCK' && !hasSellingPrice(target))
    )
      reason = 'STOCK_TARGET_CONFLICT';
    if (!reason) {
      // Even a stale IN_STOCK flag must not release a unit referenced by a contract, reservation or order.
      if (await db.contract.count({ where: { productId: target.id } }))
        reason = 'REFERENCED_STOCK_TARGET';
      try {
        await assertProductNotHeld(db, target, 'STOCK_ADJUST');
      } catch (e) {
        if (!(e instanceof BadRequestException)) throw e;
        reason = 'HELD_STOCK_TARGET';
      }
    }
  }
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
      targets,
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

// ImportedSale has no branch column. Only its original active CREATE receipt and
// that owner's frozen file map can attribute the historical target.
export async function readSaleOrigins(
  db: Db,
  sales: {
    id: string;
    importBatch: string | null;
    barcode: string;
    orderNumber: string;
    soldAt: Date;
  }[],
  verifyFrozen = false,
) {
  const origins = new Map<string, { branchId: string; storeKey: string }>();
  if (!sales.length) return origins;
  const receipts = await db.tooltifyImportItem.findMany({
    where: {
      targetType: 'IMPORTED_SALE',
      disposition: 'CREATE',
      targetId: { in: sales.map((s) => s.id) },
      deletedAt: null,
      reversedAt: null,
      batch: { kind: 'SALES', deletedAt: null, status: { not: 'ROLLED_BACK' } },
    },
    select: { targetId: true, batchId: true, sourceRefs: true, identityHash: true },
  });
  const owners = await db.tooltifyImportBatch.findMany({
    where: { id: { in: [...new Set(receipts.map((r) => r.batchId))] } },
    select: { id: true, reconciliationSnapshot: true },
  });
  // Verify once per owning batch in whole-plan and reconciliation reads. The row writer
  // rechecks its reviewed target/owner dependency in each serializable item transaction.
  const evidence = verifyFrozen
    ? await db.tooltifyImportItem.findMany({
        where: { batchId: { in: owners.map((b) => b.id) }, reversedAt: null, deletedAt: null },
        select: {
          batchId: true,
          sourceKey: true,
          disposition: true,
          payloadHash: true,
          identityHash: true,
          sourceRefs: true,
          targetId: true,
        },
      })
    : [];
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
    if (
      verifyFrozen &&
      receiptDigest(byOwner.get(owner.id) ?? []) !== snapshot.expectedReceiptsHash
    )
      continue;
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
      r.identityHash !== hash(['TOOLTIFY', target.barcode, target.orderNumber, target.soldAt]) ||
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

async function evaluateSales(db: Db, item: PlannedSalesItem): Promise<PlannedSalesItem> {
  const row = item.payload;
  const branch = await readBranch(db, item.branchId);
  const bill = await db.importedSale.findMany({
    where: { source: 'TOOLTIFY', orderNumber: row.orderNumber },
    select: { id: true, barcode: true, soldAt: true },
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
    (b) => b.barcode === row.barcode && b.soldAt.getTime() === row.soldAt.getTime(),
  );
  const target = existing
    ? await db.importedSale.findUniqueOrThrow({ where: { id: existing.id } })
    : null;
  const origin = target ? (await readSaleOrigins(db, [target])).get(target.id) : null;
  let reason: string | null = null;
  if (!validBranch(branch)) reason = 'INVALID_SHOP_BRANCH';
  else if (row.occurrence !== 1) reason = 'UNSUPPORTED_SALES_MULTIPLICITY';
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
    dependencyFingerprint: hash({ branch, target, origin, reason }),
  };
}

export function evaluateItem(db: Db, item: PlannedItem): Promise<PlannedItem> {
  return item.kind === 'STOCK' ? evaluateStock(db, item) : evaluateSales(db, item);
}
