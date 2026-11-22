import { isReviewedZeroPriceGift } from './gift-accessory';
import type { Prisma } from '@prisma/client';
import { hasSellingPrice } from '../../modules/products/product-enter-stock.util';
import { autofillProductPriceFromTemplate } from '../../utils/product-price-autofill.util';
import {
  fillFinancePriceFromTemplate,
  templateKeyOf,
} from '../../utils/product-finance-price.util';
import { syncPriceRowsFromColumns } from '../../utils/product-price-sync.util';
import { stockTargetFingerprint } from './plan-targets';
import type { PlannedStockItem, TargetWriteResult } from './types';

/** applyBatch owns dependency checks, the durable batch ID, the item transaction and its receipt. */
export async function writeStockItem(
  tx: Prisma.TransactionClient,
  item: PlannedStockItem,
): Promise<TargetWriteResult> {
  const { payload, resolution, decision } = item;
  if (item.reason) throw Error(item.reason);
  if (item.disposition !== 'CREATE' || item.targetId !== null)
    throw Error('IMPORT_CREATE_REQUIRED');
  if (
    !resolution.companyId ||
    !decision ||
    (payload.desiredStatus !== 'IN_STOCK' && payload.desiredStatus !== 'QC_PENDING')
  )
    throw Error('UNRESOLVED_STOCK_DECISION');

  const explicit = decision.pricing.mode === 'EXPLICIT';
  const product = await tx.product.create({
    data: {
      supplierId: resolution.supplierLink?.targetId ?? null,
      name: payload.name,
      brand: payload.brand,
      model: payload.model,
      storage: payload.storage,
      color: payload.color,
      category: payload.category,
      deviceOrigin: payload.deviceOrigin,
      imeiSerial: payload.kind === 'DEVICE' ? payload.barcode : null,
      branchId: item.branchId,
      ownedByCompanyId: resolution.companyId,
      costPrice: payload.cost,
      cashPrice: explicit ? resolution.cashPrice : null,
      installmentPrice: explicit ? resolution.installmentPrice : null,
      financePrice: explicit ? resolution.financePrice : null,
      status: 'QC_PENDING',
      stockInDate: new Date(payload.importedAt),
      legacyProductCode: 'TTFY-CUTOVER:' + item.batchId + ':' + item.sourceKey,
    },
  });

  if (explicit) {
    await syncPriceRowsFromColumns(tx, product.id, product);
  } else if (resolution.templateId) {
    const key = templateKeyOf(product);
    const filled = await autofillProductPriceFromTemplate(tx, {
      ...key,
      productId: product.id,
      currentCashPrice: product.cashPrice,
    });
    if (filled.filled && filled.templateId !== resolution.templateId)
      throw Error('IMPORT_DEPENDENCY_CHANGED');
    await fillFinancePriceFromTemplate(tx, product.id, key);
  }

  const priced = await tx.product.findUniqueOrThrow({
    where: { id: product.id },
    include: { prices: { where: { deletedAt: null } } },
  });
  if (
    payload.desiredStatus === 'IN_STOCK' &&
    !hasSellingPrice(priced) &&
    !isReviewedZeroPriceGift(payload, decision)
  )
    throw Error('MISSING_SELLING_PRICE');
  for (const column of ['cashPrice', 'installmentPrice', 'financePrice'] as const) {
    const expected = resolution[column];
    if (expected === null ? priced[column] !== null : !priced[column]?.equals(expected))
      throw Error('IMPORT_DEPENDENCY_CHANGED');
  }
  if (payload.desiredStatus === 'IN_STOCK')
    await tx.product.update({ where: { id: product.id }, data: { status: 'IN_STOCK' } });

  return {
    targetType: 'PRODUCT',
    targetId: product.id,
    created: true,
    afterFingerprint: await stockTargetFingerprint(tx, product.id),
  };
}
