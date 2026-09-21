import type { DeviceOrigin } from '@/lib/device-origin';

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

export interface QcCheckItem {
  item: string;
  passed: boolean;
}

export interface ProductUnit {
  warrantyTerms?: string;
  deviceOrigin?: DeviceOrigin | null;
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
  branchName?: string;
  accessories?: string[];
  cosmeticNotes?: string;
  qcChecklist?: QcCheckItem[];
}
