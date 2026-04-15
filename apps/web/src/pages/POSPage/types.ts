// Shared types for POSPage sub-components

export interface TopProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  count: number;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  category: string;
  costPrice: string;
  branchId: string;
  branch: { id: string; name: string };
  prices: { id: string; label: string; amount: string; isDefault: boolean }[];
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  nationalId: string;
  _count: { contracts: number };
}

export interface PosConfig {
  interestRate: number;
  minDownPaymentPct: number;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
}
