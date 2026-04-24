import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

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

const ACTIVE_STATUSES: LetterStatus[] = ['PENDING_DISPATCH', 'PDF_GENERATED', 'DISPATCHED'];

async function fetchLettersByStatus(status: LetterStatus): Promise<LetterRow[]> {
  const { data } = await api.get<LetterRow[]>('/overdue/letters', { params: { status } });
  return data;
}

/**
 * Fetches letters in all 3 active statuses in parallel and merges into a
 * single sorted list (newest triggeredAt first).
 */
export function useLetterQueue() {
  return useQuery<LetterRow[]>({
    queryKey: ['letter-queue'],
    queryFn: async () => {
      const results = await Promise.all(ACTIVE_STATUSES.map(fetchLettersByStatus));
      const merged = results.flat();
      merged.sort(
        (a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime(),
      );
      return merged;
    },
    staleTime: 30_000,
  });
}
