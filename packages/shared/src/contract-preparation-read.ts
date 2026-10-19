import type { ContractReadAvailability } from './contract-read';

/** Wire contract for the explicit SHOP view. It is never a FINANCE Contract or
 * evidence of edit/sign/submit/approval authority. Consumers must separate caches. */
export interface ContractPreparationRead {
  view: 'SHOP_PREPARATION';
  applicationState: 'PRE_ACTIVATION';
  id: string;
  contractNumber: string;
  branchId: string;
  branch: { id: string; name: string };
  salespersonId: string;
  createdAt: string;
  updatedAt: string;
  workflowStatus: 'CREATING' | 'REJECTED' | 'PENDING_REVIEW' | 'APPROVED';
  planType: string;
  sellingPrice: string;
  downPayment: string;
  interestRate: string;
  totalMonths: number;
  interestTotal: string;
  financedAmount: string;
  monthlyPayment: string;
  paymentDueDay: number | null;
  hasNamedTerms: boolean;
  hasOwnershipClause: boolean;
  hasRepossessionClause: boolean;
  hasEarlyPayoffClause: boolean;
  hasNoTransferClause: boolean;
  hasAcknowledgement: boolean;
  customer: { id: string; name: string; phone: string | null; nationalId: string | null } | null;
  product: PreparationProduct | null;
  bundleProducts: PreparationProduct[] | null;
  signatures: Array<{ id: string; signerType: string; signedAt: string }> | null;
  eDocuments: Array<{ id: string; documentType: string; createdAt: string }> | null;
  contractDocuments: Array<{
    id: string;
    documentType: string;
    version: number;
    isLatest: boolean;
    createdAt: string;
  }> | null;
  /** These dependencies remain in their independently authorized owning units. */
  credit: null;
  kyc: null;
  pdpa: null;
  lessor: null;
  availability: Record<
    | 'customer'
    | 'product'
    | 'bundles'
    | 'signatures'
    | 'eDocuments'
    | 'contractDocuments'
    | 'credit'
    | 'kyc'
    | 'pdpa'
    | 'lessor',
    ContractReadAvailability
  >;
}
export interface PreparationProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  imeiSerial: string | null;
  serialNumber: string | null;
  color: string | null;
  storage: string | null;
}
export interface ContractPreparationList {
  view: 'SHOP_PREPARATION';
  scope: 'authorized-preactivation-applications';
  data: ContractPreparationRead[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
