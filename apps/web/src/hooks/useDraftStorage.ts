import { useCallback } from 'react';

const DRAFT_KEY = 'bestchoice-contract-draft';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ContractDraft {
  step: number;
  productId?: string;
  customerId?: string;
  downPayment: number;
  totalMonths: number;
  paymentDueDay: number;
  notes: string;
  savedAt: string;
}

export function useDraftStorage() {
  const save = useCallback((draft: Omit<ContractDraft, 'savedAt'>) => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  }, []);

  const load = useCallback((): ContractDraft | null => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    try {
      const draft = JSON.parse(raw) as ContractDraft;
      // Expire drafts older than 24 hours
      if (new Date().getTime() - new Date(draft.savedAt).getTime() > DRAFT_TTL_MS) {
        localStorage.removeItem(DRAFT_KEY);
        return null;
      }
      return draft;
    } catch {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
  }, []);

  return { save, load, clear };
}
