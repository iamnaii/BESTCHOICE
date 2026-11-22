import type { SourceDecision, SourceRef } from './types';
export type LegacySaleEvidence = Extract<SourceDecision, { action: 'RETAIN_LEGACY_SALE' }>;
export function validLegacySaleEvidence(
  d: LegacySaleEvidence,
  source: SourceRef,
  barcode: string,
  name: string,
  category: string,
) {
  return (
    d.action === 'RETAIN_LEGACY_SALE' &&
    d.fileSha256 === source.fileSha256 &&
    d.sourceRows.length === 1 &&
    d.sourceRows[0] === source.row &&
    !!d.reason.trim() &&
    !!d.evidenceRef.trim() &&
    !!barcode &&
    !!name &&
    d.expectedBarcode === barcode &&
    d.expectedName === name &&
    d.expectedCategory === category
  );
}
