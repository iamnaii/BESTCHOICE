// apps/web/src/pages/CollectionsPage/types/letter.ts
export type LetterType = 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D';

export type LetterStatus =
  | 'PENDING_DISPATCH'
  | 'PDF_GENERATED'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'UNDELIVERABLE'
  | 'CANCELLED';

export interface LetterRow {
  id: string;
  contractId: string;
  letterType: LetterType;
  letterNumber: string;
  status: LetterStatus;
  triggeredAt: string;
  pdfUrl: string | null;
  pdfGeneratedAt: string | null;
  dispatchedAt: string | null;
  trackingNumber: string | null;
  evidencePhotoUrl: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
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
