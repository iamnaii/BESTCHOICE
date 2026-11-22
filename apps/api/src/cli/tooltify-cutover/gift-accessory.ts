import type { CanonicalStockUnit, SourceDecision } from './types';

type Decision = Extract<SourceDecision, { action: 'RESOLVE_STOCK' }>;
/** Owner-reviewed exception bound to source rows, manifest hash and durable receipt. */
export function isReviewedZeroPriceGift(
  row: Pick<CanonicalStockUnit, 'kind' | 'category'>,
  decision: Decision | null,
): boolean {
  return (
    row.kind === 'ACCESSORY' &&
    row.category === 'ACCESSORY' &&
    decision?.zeroPriceGift === true &&
    decision.pricing.mode === 'EXPLICIT' &&
    [
      decision.pricing.cashPrice,
      decision.pricing.installmentPrice,
      decision.pricing.financePrice,
    ].every((value) => typeof value === 'string' && /^0{1,10}(\.0{1,2})?$/.test(value)) &&
    !!decision.reason.trim() &&
    !!decision.evidenceRef.trim()
  );
}

export function validAccessoryCompatibility(
  row: Pick<CanonicalStockUnit, 'kind' | 'category'>,
  decision: Decision | null,
): boolean {
  const fit = decision?.accessoryCompatibility;
  return (
    fit === undefined ||
    (!!fit &&
      typeof fit === 'object' &&
      !Array.isArray(fit) &&
      Object.keys(fit).every((key) => ['brand', 'model'].includes(key)) &&
      row.kind === 'ACCESSORY' &&
      row.category === 'ACCESSORY' &&
      typeof fit?.brand === 'string' &&
      !!fit.brand.trim() &&
      fit.brand === fit.brand.trim() &&
      typeof fit.model === 'string' &&
      !!fit.model.trim() &&
      fit.model === fit.model.trim() &&
      fit.model.split(',').every((model) => !!model.trim()))
  );
}
