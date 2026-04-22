export interface Review {
  id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  verified: boolean;
  createdAt: string;
  customer: { name: string };
  photoUrl?: string | null;
}

export interface ReviewSummary {
  total: number;
  average: number;
}
