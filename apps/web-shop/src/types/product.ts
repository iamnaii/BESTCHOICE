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
