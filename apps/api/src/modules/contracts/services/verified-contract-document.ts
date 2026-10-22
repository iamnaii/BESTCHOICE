import { Response } from 'express';

/** This proof describes current authority and immutable upload identity, not a
 * permanent grant or a certification of the caller's documentType label. */
export interface VerifiedContractDocumentSource {
  documentId: string;
  contractId: string;
  customerId: string;
  branchId: string;
  currentCompany: 'SHOP' | 'FINANCE';
  identityId: string;
}
/** Returned only AFTER current authorization and required release evidence commit.
 * Generated child3 must supply its own verified identity/source implementation. */
export interface VerifiedContractDocumentBuffer {
  kind: 'verified-upload' | 'verified-generated';
  source: VerifiedContractDocumentSource;
  bytes: Buffer;
  contentType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  filename: string;
}
export function sendVerifiedContractDocument(res: Response, file: VerifiedContractDocumentBuffer) {
  if (res.destroyed || res.writableEnded) return;
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.bytes.length),
    'Content-Disposition': `attachment; filename="${file.filename}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  res.end(file.bytes);
}
