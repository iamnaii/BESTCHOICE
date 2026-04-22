export interface Review {
  id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  verified: boolean;
  createdAt: string;
  customer: { name: string };
}

export interface ReviewSummary {
  total: number;
  average: number;
}
