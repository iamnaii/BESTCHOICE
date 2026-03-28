// Shared Receipt Types
export interface Branch {
  id: string;
  name: string;
  location: string | null;
  phone: string | null;
}

export interface Product {
  id: string;
  name: string;
  imeiSerial: string | null;
  serialNumber: string | null;
}

export interface CompanyInfo {
  nameTh: string;
  nameEn: string | null;
  taxId: string;
  address: string;
  phone: string | null;
  logoUrl: string | null;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  contractId: string;
  paymentId: string | null;
  receiptType: string;
  payerName: string;
  receiverName: string;
  amount: string;
  subtotal?: string | null;
  vatRate?: string | null;
  vatAmount?: string | null;
  installmentNo: number | null;
  remainingBalance: string | null;
  remainingMonths: number | null;
  paymentMethod: string | null;
  transactionRef: string | null;
  paidDate: string;
  isVoided: boolean;
  voidReason: string | null;
  voidedReceiptId: string | null;
  createdAt: string;
  contract?: {
    contractNumber: string;
    customer: { name: string };
    branch: Branch;
    product: Product;
  };
  company?: CompanyInfo | null;
}
