export type ContractSignatureType = 'CUSTOMER' | 'COMPANY' | 'WITNESS_1' | 'WITNESS_2' | 'GUARDIAN';
export type SignatureProductionStatus =
  | 'NOT_COMPLETE'
  | 'UNAVAILABLE'
  | 'PENDING'
  | 'SUCCESS'
  | 'PARTIAL'
  | 'FAILED';
export interface ContractSignatureAcknowledgement {
  id: string;
  signerType: ContractSignatureType;
  signedAt: string;
  status: 'CAPTURED';
  production: SignatureProductionStatus;
}
export interface ContractSignaturePresence {
  id: string;
  signerType: ContractSignatureType;
  signedAt: string;
  evidenceStatus: 'CAPTURED' | 'VERIFIED' | 'UNVERIFIED';
  signatureImage?: string;
  signerName?: string | null;
}
export interface ContractSignatureList {
  availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNVERIFIED';
  data: ContractSignaturePresence[] | null;
  total: number | null;
  page: number;
  limit: number;
}
