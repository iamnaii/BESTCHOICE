export interface ShopProduct {
  id: string;
  name: string;
  sellingPrice: number;
  gallery: string[];
  gallery360?: string[];
  conditionGrade: 'A' | 'B' | 'C' | null;
  brand?: string;
  model?: string;
}

export interface ProductUnit {
  id: string;
  conditionGrade: string;
  batteryHealth?: number;
  hasBox?: boolean;
  shopWarrantyDays?: number;
  color?: string;
  cashPrice: number;
  installmentPrice: number | null;
  imeiPartial?: string;
  gallery: string[];
  gallery360: string[];
}
