import type { ContractReadAvailability } from './contract-read';

/** Serialized managed responses. UNAVAILABLE fields are null; aggregate scopes
 * describe the authorized contributor set, never a whole-company completeness claim. */
export interface ContractDerivedCustomer {
  id: string;
  name: string;
  phone: string | null;
}
export interface ContractDerivedProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
}
export interface ContractExportRead {
  scope: 'authorized-sources';
  total: number;
  asOf: string;
  data: Array<{
    id: string;
    contractNumber: string;
    customer: ContractDerivedCustomer | null;
    product: ContractDerivedProduct | null;
    salesperson: { id: string; name: string } | null;
    sellingPrice: string;
    monthlyPayment: string;
    status: string | null;
    branch: { id: string; name: string };
    createdAt: string;
    availability: Record<
      'customer' | 'product' | 'salesperson' | 'payments',
      ContractReadAvailability
    >;
  }>;
}
export interface ContractDocumentDashboardRead {
  scope: 'authorized-sources';
  categoryScope: 'authorized-sources';
  availability: Record<'documents' | 'documentHistory' | 'payments', ContractReadAvailability>;
  totalContracts: number;
  documentContracts: number | null;
  paymentContracts: number | null;
  fullyDocumented: number | null;
  pendingDocuments: number | null;
  pendingSignatures: number | null;
  pendingApproval: number;
  overdueContracts: number | null;
  byBranch: Array<{
    branchId: string;
    branchName: string;
    total: number;
    documentContracts: number | null;
    documented: number | null;
    pendingDocs: number | null;
    pendingSigs: number | null;
  }>;
  recentActivity: Array<{
    id: string;
    contractNumber: string;
    customerName: string | null;
    action: string;
    createdAt: string;
    branchName: string;
  }> | null;
  slaAlerts: Array<{
    id: string;
    contractNumber: string;
    customerName: string | null;
    workflowStatus: string;
    hoursWaiting: number;
    branchName: string;
  }>;
}
export interface ContractMilestonesRead {
  scope: 'authorized-sources';
  totalScope: 'authorized-sources';
  previewLimit: 5;
  availability: Record<'newThisMonth' | 'completingThisMonth', ContractReadAvailability>;
  newThisMonth: { count: number | null; totalAmount: number | null };
  completingThisMonth: { count: number | null; totalAmount: number | null };
  recentNewContracts: Array<{
    id: string;
    contractNumber: string;
    customerName: string | null;
    financedAmount: number;
    createdAt: string;
  }> | null;
  finalInstallmentsThisMonth: Array<{
    paymentId: string;
    contractId: string;
    contractNumber: string;
    customerName: string | null;
    dueDate: string;
    amountDue: number;
    installmentNo: number;
    totalMonths: number;
  }> | null;
}
export interface ContractSnapshotRead {
  scope: 'authorized-sources';
  categoryScope: 'authorized-sources';
  contractId: string;
  contractNumber: string;
  status: string | null;
  customer: ContractDerivedCustomer | null;
  product: { name: string } | null;
  totals: {
    totalAmount: number;
    outstanding: number;
    installmentsTotal: number;
    installmentsRemaining: number;
  } | null;
  lastPromise: { settlementDate: string; result: string; notes: string | null } | null;
  lastLine: { timestamp: string; read: boolean } | null;
  lastCollectorComment: { text: string; truncated: boolean; by: null; at: string } | null;
  availability: Record<
    | 'customer'
    | 'product'
    | 'payments'
    | 'collectionContacts'
    | 'paymentPromises'
    | 'promiseNotes'
    | 'chat',
    ContractReadAvailability
  >;
}
