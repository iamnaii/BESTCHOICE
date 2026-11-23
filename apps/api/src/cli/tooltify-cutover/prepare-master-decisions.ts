import type { DeviceOrigin } from '@prisma/client';
import type { CanonicalStockUnit, SourceDecisions } from './types';

/** Explicit owner evidence supplies only missing origins; never infer Thai from the brand/model. */
export function prepareMasterDecisions(
  rows: CanonicalStockUnit[],
  decisions: SourceDecisions,
  policy: {
    storeKey: string;
    defaultOrigin: DeviceOrigin;
    evidenceRef: string;
    evidenceSha256: string;
  },
): SourceDecisions {
  if (
    !policy.storeKey.trim() ||
    !policy.evidenceRef.trim() ||
    !/^[a-f0-9]{64}$/.test(policy.evidenceSha256) ||
    !['THAI', 'IMPORTED'].includes(policy.defaultOrigin)
  )
    throw Error('REVIEWED_ORIGIN_POLICY_REQUIRED');
  const entries: SourceDecisions['entries'] = [];
  for (const decision of decisions.entries) {
    if (decision.action !== 'RESOLVE_STOCK' || decision.desiredStatus !== 'IN_STOCK') {
      entries.push(decision);
      continue;
    }
    const phones = rows.filter(
      (r) =>
        r.source.fileSha256 === decision.fileSha256 &&
        decision.sourceRows.includes(r.source.row) &&
        ['PHONE_NEW', 'PHONE_USED'].includes(r.category),
    );
    const remaining = decision.sourceRows.filter((n) => !phones.some((r) => r.source.row === n));
    if (remaining.length) entries.push({ ...decision, sourceRows: remaining });
    for (const row of phones) {
      if (row.source.storeKey !== policy.storeKey) throw Error('ORIGIN_POLICY_STORE_MISMATCH');
      if (row.deviceOrigin && decision.deviceOrigin && row.deviceOrigin !== decision.deviceOrigin)
        throw Error('SOURCE_ORIGIN_CONFLICT');
      if (decision.pricing.mode === 'TEMPLATE') throw Error('EVIDENCED_CASH_PRICE_REQUIRED');
      const deviceOrigin = row.deviceOrigin ?? decision.deviceOrigin ?? policy.defaultOrigin;
      entries.push({
        ...decision,
        sourceRows: [row.source.row],
        deviceOrigin,
        pricing: { mode: 'MASTER_INSTALLMENTS', cashPrice: decision.pricing.cashPrice },
        reason:
          decision.pricing.mode === 'MASTER_INSTALLMENTS' && decision.deviceOrigin === deviceOrigin
            ? decision.reason
            : `${decision.reason}; master installment prices; origin policy: ${policy.evidenceRef} sha256=${policy.evidenceSha256}`,
      });
    }
  }
  return { entries };
}
