import { useCallback, useMemo } from 'react';

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface ContractDraft {
  tradeInCreditId?: string;
  /** ของแถม (อุปกรณ์เสริม) ที่เลือกไว้ — เก็บแค่ id แล้วโหลดสถานะสดตอนกู้คืน */
  bundleProductIds?: string[];
  step: number;
  productId?: string;
  customerId?: string;
  fromRoom?: string;
  downPayment: number;
  downPaymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'QR_EWALLET';
  downPaymentReference?: string;
  totalMonths: number;
  paymentDueDay: number;
  notes: string;
  savedAt: string;
}

/** Drafts belong to the signed-in employee, including on shared shop computers. */
export function useDraftStorage(userId: string | undefined) {
  const key = userId ? `bestchoice-contract-draft:${userId}` : null;
  const clear = useCallback(() => {
    try { if (key) localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
  }, [key]);

  const save = useCallback((draft: Omit<ContractDraft, 'savedAt'>): boolean => {
    if (!key) return false;
    try {
      localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
      return true;
    } catch { return false; }
  }, [key]);

  const load = useCallback((): ContractDraft | null => {
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const draft = JSON.parse(raw) as ContractDraft;
      const age = Date.now() - Date.parse(draft.savedAt);
      const validId = (value: unknown) => value === undefined ||
        (typeof value === 'string' && /^[\w-]{1,128}$/.test(value));
      if (!Number.isFinite(age) || age < 0 || age > DRAFT_TTL_MS ||
        !Number.isInteger(draft.step) || draft.step < 0 || draft.step > 3 ||
        !Number.isFinite(draft.downPayment) || draft.downPayment < 0 ||
        !Number.isInteger(draft.totalMonths) || draft.totalMonths < 1 ||
        !Number.isInteger(draft.paymentDueDay) || draft.paymentDueDay < 1 || draft.paymentDueDay > 31 ||
        (draft.downPaymentMethod !== undefined && !['CASH', 'BANK_TRANSFER', 'QR_EWALLET'].includes(draft.downPaymentMethod)) ||
        (draft.downPaymentReference !== undefined && (typeof draft.downPaymentReference !== 'string' || draft.downPaymentReference.length > 128)) ||
        typeof draft.notes !== 'string' || !validId(draft.customerId) ||
        !validId(draft.productId) || !validId(draft.fromRoom) || !validId(draft.tradeInCreditId)) {
        clear();
        return null;
      }
      return draft;
    } catch {
      clear();
      return null;
    }
  }, [key, clear]);

  return useMemo(() => ({ save, load, clear }), [save, load, clear]);
}
