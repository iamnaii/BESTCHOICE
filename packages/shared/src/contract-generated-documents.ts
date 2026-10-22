/** Staff delivery always requires a fresh authenticated API request. Never a public share URL. */
export interface AuthenticatedGeneratedDocumentDelivery {
  kind: 'authenticated';
  url: string;
  expiresIn: 0;
}
export interface GeneratedDocumentTemplateChoice {
  templateSource?: 'BUILTIN';
  templateId?: string;
}
export interface GeneratedContractDocumentReference {
  id: string;
  documentType: 'CONTRACT' | 'PDPA_CONSENT' | null;
  createdAt: string;
  contentStatus: 'VERIFIED_GENERATED' | 'UNVERIFIED';
  templateSource: 'BUILTIN' | 'CUSTOM' | null;
}
export interface GeneratedContractDocumentList {
  availability: 'available' | 'unavailable';
  data: GeneratedContractDocumentReference[];
  total: number | null;
  page: number;
  limit: number;
}
export interface GeneratedContractDocumentAcknowledgement {
  id: string;
  documentType: 'CONTRACT' | 'PDPA_CONSENT';
  pdfGenerated: true;
  templateSource: 'BUILTIN' | 'CUSTOM';
}
export type GeneratedStageFailure =
  | 'UNAVAILABLE'
  | 'SOURCE_CHANGED'
  | 'GENERATION_FAILED'
  | 'NOT_ATTEMPTED';
export interface GeneratedSignedDocumentsResult {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  contract?: GeneratedContractDocumentAcknowledgement;
  pdpa?: GeneratedContractDocumentAcknowledgement;
  errors?: GeneratedStageFailure[];
}
/** Task4 canonical signature transaction must retain BOTH actual choices. This
 * describes retained evidence, not an authorization token or a minting API. */
export interface CommittedSignedDocumentPlan {
  sourceRevision: string;
  signatureIds: string[];
  contract: {
    template: { kind: 'BUILTIN' | 'CUSTOM'; id: string | null; revision: string };
    dependencyRevision: string;
  };
  pdpa: {
    template: { kind: 'BUILTIN' | 'CUSTOM'; id: string | null; revision: string };
    dependencyRevision: string;
  };
}
/** Staff UI: use authenticated axios GET with responseType:'blob' on this URL,
 * preserve selected company, and revoke any created object URL. Do not cache a
 * provider URL. Task7 must explicitly present BUILTIN versus owner custom terms. */
export type GeneratedStaffDelivery = AuthenticatedGeneratedDocumentDelivery;
