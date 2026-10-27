import { Request } from 'express';
import { PermissionKey } from '@installment/shared';
export const GENERATED_DOCUMENT_OPERATIONS = [
  'generateDocument',
  'generatePdpaDocument',
  'generateSignedDocuments',
  'previewContract',
  'downloadPdf',
  'regenerateSignedContractPdfs',
  'getDocument',
  'getDocuments',
  'downloadDocument',
  'getSignedUrl',
] as const;
export type GeneratedDocumentOperation = (typeof GENERATED_DOCUMENT_OPERATIONS)[number];
export type GeneratedRequest = Pick<Request, 'params' | 'query' | 'headers' | 'body'> & {
  user?: { id?: string; role?: string; branchId?: string | null };
};
export const generatedDocumentHandlers = new WeakMap<
  object,
  ReadonlyMap<object, GeneratedDocumentOperation>
>();
export const generationOperation = (op: GeneratedDocumentOperation) =>
  [
    'generateDocument',
    'generatePdpaDocument',
    'generateSignedDocuments',
    'regenerateSignedContractPdfs',
  ].includes(op);
export const generatedPermission = (op: GeneratedDocumentOperation): PermissionKey =>
  generationOperation(op) && op !== 'regenerateSignedContractPdfs'
    ? 'documents.create'
    : ['downloadPdf', 'downloadDocument', 'getSignedUrl', 'regenerateSignedContractPdfs'].includes(
          op,
        )
      ? 'documents.export'
      : 'documents.read';
export const generatedSensitive: PermissionKey[] = [
  'sensitive.customer-identity.read',
  'sensitive.cost.read',
  'sensitive.profit.read',
  'sensitive.salary.read',
  'sensitive.seller-bank.read',
];
