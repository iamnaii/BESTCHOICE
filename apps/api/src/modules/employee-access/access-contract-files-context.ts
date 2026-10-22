import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';

export const UPLOADED_DOCUMENT_OPERATIONS = [
  'findByContract',
  'getDocumentChecklist',
  'getDocumentAuditTrail',
  'upload',
  'recordView',
  'content',
  'recordDownload',
  'remove',
] as const;
export type UploadedDocumentOperation = (typeof UPLOADED_DOCUMENT_OPERATIONS)[number];
export const uploadedDocumentHandlers = new WeakMap<
  object,
  ReadonlyMap<object, UploadedDocumentOperation>
>();
export interface UploadedDocumentProof {
  contractId: string;
  customerId: string;
  branchId: string;
  company: 'SHOP' | 'FINANCE';
  visible: boolean;
  requiresGuardian: boolean | null;
}
export const uploadedDocumentRequest = new AsyncLocalStorage<{
  actorId: string;
  operation: UploadedDocumentOperation;
  proof?: UploadedDocumentProof;
  legacyClient?: Prisma.TransactionClient;
  release?: <T>(handler: () => Promise<T>) => Promise<T>;
}>();
