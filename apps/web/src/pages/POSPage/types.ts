// Shared types for POSPage sub-components

export interface TopProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  count: number;
}

export interface Product {
  deviceOrigin?: 'THAI' | 'IMPORTED' | null;
  shopWarrantyDays?: number | null;
  effectiveShopWarrantyDays?: number | null;
  warrantyTerms?: string | null;
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
  cashPrice?: string | number | null;
  installmentPrice?: string | number | null;
}

export interface Customer {
  id: string;
  name: string;
  /** null = ผู้สนใจจากแชทที่ยังไม่มีเบอร์ (GET /customers/search คืน null ได้) */
  phone: string | null;
  nationalId: string;
  _count: { contracts: number };
  /** ผู้สนใจอัตโนมัติจากแชทที่ยังไม่มีเบอร์ — ธงจาก GET /customers/search (เว็บห้าม derive เอง) */
  chatPlaceholder?: boolean;
}
