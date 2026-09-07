export interface ContractSummaryItem {
  id: string;
  contractNumber: string;
  status: string;
  product?: { name?: string; brand?: string; model?: string; warrantyExpireDate?: string };
  serialNumber?: string;
  paidInstallments: number;
  totalInstallments: number;
  monthlyPayment: number | string;
  nextDueDate?: string;
  mdmLockedAt?: string;
  shopWarrantyEndDate?: string;
}

export interface PaymentPartial {
  id: string;
  receiptNumber: string;
  amount: number | string;
  paidDate: string;
  paymentMethod: string | null;
}

export interface PaymentSummaryItem {
  id: string;
  contract?: { contractNumber: string };
  installmentNo: number;
  amountDue: number | string;
  amountPaid: number | string;
  status: string;
  partials: PaymentPartial[];
}
