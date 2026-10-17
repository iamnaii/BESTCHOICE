import type { Company } from './company-access';
export const CUSTOMER_ATTACHMENT_SOURCE_KINDS = [
  'CUSTOMER_ORIGIN',
  'SALE',
  'CONTRACT',
  'TRADE_IN',
  'REPAIR_TICKET',
  'BOOKING',
  'CHAT_ROOM',
] as const;
export type CustomerAttachmentSourceKind = (typeof CUSTOMER_ATTACHMENT_SOURCE_KINDS)[number];
export const CUSTOMER_ATTACHMENT_SENSITIVE_KEYS = [
  'sensitive.customer-identity.read',
  'sensitive.cost.read',
  'sensitive.profit.read',
  'sensitive.salary.read',
  'sensitive.seller-bank.read',
] as const;
export interface CustomerAttachmentSource {
  kind: CustomerAttachmentSourceKind;
  id: string;
  company: Company;
  branchId: string | null;
}
export interface CustomerAttachmentAcknowledgement {
  id: string;
  attachmentId: string;
}
export interface VerifiedCustomerAttachment {
  kind: 'verified';
  id: string;
  originCustomerId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  canRemove: boolean;
}
/** Legacy values remain unverified metadata, never a trusted URL or object key. */
export interface LegacyCustomerAttachment {
  kind: 'legacy';
  originCustomerId: string;
  reference: string;
  availability: 'unsupported';
}
export interface CustomerAttachmentList {
  availability: 'available' | 'partial' | 'unavailable';
  items: Array<VerifiedCustomerAttachment | LegacyCustomerAttachment> | null;
  uploadSources: CustomerAttachmentSource[];
}

/** POST multipart/form-data: these fields plus one file part named "file".
 * MIME and size come from the actual uploaded part; URL/key fields confer no authority. */
export interface CustomerAttachmentUploadFields {
  sourceKind: CustomerAttachmentSourceKind;
  sourceId: string;
}
/** DELETE existing /customers/:id/documents route; never a URL or storage key. */
export interface CustomerAttachmentRemoveRequest {
  attachmentId: string;
}
/** GET /customers/:id/documents/:attachmentId/content returns binary bytes.
 * Browser clients use authenticated responseType:'blob', then a temporary object URL;
 * never a persistent public/signed/local file URL. */
export type CustomerAttachmentContentMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf';
