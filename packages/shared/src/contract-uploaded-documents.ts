export interface UploadedContractDocumentReference {
  id: string;
  documentType: string;
  version: number;
  isLatest: boolean;
  isImmutable: boolean;
  createdAt: string;
  contentStatus: 'VERIFIED_UPLOAD' | 'UNVERIFIED';
}
export interface UploadedContractDocumentList {
  availability: 'available' | 'unavailable';
  data: UploadedContractDocumentReference[];
  total: number | null;
  page: number;
  limit: number;
}
export interface UploadedContractDocumentChecklist {
  availability: 'available' | 'unavailable';
  complete: boolean | null;
  requiresGuardian: boolean | null;
  checklist: Array<{
    type: string;
    label: string;
    autoGenerate: boolean;
    conditional?: boolean;
    present: boolean | null;
  }>;
}
export type UploadedContractDocumentActivity =
  | 'UPLOAD'
  | 'VIEW_INTENT'
  | 'DOWNLOAD_INTENT'
  | 'DELETE'
  | 'PRINT_INTENT'
  | 'HASH_MISMATCH'
  | 'CONTENT_RELEASE_AUTHORIZED';
export interface UploadedContractDocumentHistory {
  availability: 'available' | 'unavailable';
  total: number | null;
  data: Array<{
    action: UploadedContractDocumentActivity;
    createdAt: string;
    actorId: string | null;
    document: UploadedContractDocumentReference;
  }>;
}
