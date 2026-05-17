import { IsEnum, IsISO8601 } from 'class-validator';
import { DocumentType } from '@prisma/client';

/**
 * D1.1.2.5 — payload for `POST /settings/doc-number/reset`.
 *
 * `docType`: DocumentType enum value (EXPENSE / CREDIT_NOTE / PAYROLL /
 *   VENDOR_SETTLEMENT / PETTY_CASH_REIMBURSEMENT).
 * `periodStart`: ISO 8601 date string identifying the BKK period whose
 *   sequence should be reset. Currently informational — `DocNumberService`
 *   computes `lastSeq` from `MAX(docNumber)` at every call, so the sequence
 *   resets implicitly when documents in that period are deleted. The
 *   endpoint exists as a future-proofing stub for a possible migration to
 *   the `DocumentSequence` model (see D1.1.2.4).
 */
export class ResetDocNumberDto {
  @IsEnum(DocumentType, {
    message: 'docType ต้องเป็น DocumentType ที่รองรับ',
  })
  docType!: DocumentType;

  @IsISO8601(
    {},
    { message: 'periodStart ต้องเป็น ISO 8601 date (เช่น 2026-05-01)' },
  )
  periodStart!: string;
}
