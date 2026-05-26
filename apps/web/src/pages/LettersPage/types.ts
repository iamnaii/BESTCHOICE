export type LetterStatus =
  | 'PENDING_DISPATCH'
  | 'PDF_GENERATED'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'UNDELIVERABLE'
  | 'CANCELLED';

export type LetterType = 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D';

export interface LetterRow {
  id: string;
  letterNumber: string;
  letterType: LetterType;
  status: LetterStatus;
  triggeredAt: string;
  pdfUrl: string | null;
  pdfGeneratedAt: string | null;
  dispatchedAt: string | null;
  trackingNumber: string | null;
  evidencePhotoUrl?: string | null;
  deliveredAt: string | null;
  cancelledAt?: string | null;
  cancelReason: string | null;
  dispatchedBy?: { name: string } | null;
  contract: {
    id: string;
    contractNumber: string;
    customer: {
      id: string;
      name: string;
      phone: string;
      addressCurrent: string | null;
    };
    branch: { id: string; name: string };
  };
}

export interface LettersListResponse {
  data: LetterRow[];
  total: number;
  page: number;
  limit: number;
}

export interface LettersListFilters {
  status?: LetterStatus;
  letterType?: LetterType;
  branchId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
}
