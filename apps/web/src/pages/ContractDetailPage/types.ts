/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Payment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string | null;
  lateFee: string;
  status: string;
  paidDate: string | null;
  paymentMethod: string | null;
}

export interface ContractDetail {
  id: string;
  contractNumber: string;
  status: string;
  workflowStatus: string;
  planType: string;
  sellingPrice: string;
  downPayment: string;
  interestRate: string;
  totalMonths: number;
  interestTotal: string;
  financedAmount: string;
  monthlyPayment: string;
  paymentDueDay: number | null;
  notes: string | null;
  reviewNotes: string | null;
  contractHash: string | null;
  pdpaConsentId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  salespersonId: string;
  customer: { id: string; name: string; phone: string; nationalId: string };
  customerSnapshot: { name: string; phone: string; nationalId?: string; prefix?: string; nickname?: string; occupation?: string; salary?: string } | null;
  product: { id: string; name: string; brand: string; model: string; category: string; color: string | null; storage: string | null; serialNumber: string | null; imeiSerial: string | null; costPrice: string; batteryHealth: number | null; warrantyExpired: boolean | null; warrantyExpireDate: string | null; hasBox: boolean | null; accessoryType: string | null; accessoryBrand: string | null };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  interestConfig: { id: string; name: string; storeCommissionPct?: string; vatPct?: string } | null;
  creditBalance: string | null;
  dunningStage: string | null;
  payments: Payment[];
  signatures: { id: string; signerType: string; signedAt: string }[];
  contractDocuments: any[];
  creditCheck: any;
}

export interface EarlyPayoffQuote {
  remainingMonths: number;
  remainingPrincipal: number;
  remainingInterest: number;
  discount: number;
  unpaidLateFees: number;
  totalPayoff: number;
}

export { CONTRACT_STATUS_LABELS as statusLabels, PAYMENT_STATUS_LABELS as paymentStatusLabels } from '@/constants/statusLabels';
