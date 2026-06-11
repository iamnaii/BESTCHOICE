export interface Review {
  id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  verified: boolean;
  createdAt: string;
  customer: { name: string };
  /** Present on GET /shop/reviews/recent (cross-product feed); absent on per-product lists */
  product?: { brand: string; model: string } | null;
  photoUrl?: string | null;
}

export interface ReviewSummary {
  total: number;
  average: number;
}
