import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { ExpenseFormState, JePreviewResponse } from './types';

interface CreateExpensePayload {
  documentType: 'EXPENSE';
  branchId: string;
  documentDate: string;
  priceType: 'EXCLUSIVE' | 'INCLUSIVE';
  paymentMethod?: string;
  depositAccountCode?: string;
  whtFormType?: 'PND3' | 'PND53';
  lines: Array<{
    category: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    vatPercent: number;
    whtPercent: number;
  }>;
}

function buildPayload(state: ExpenseFormState): CreateExpensePayload | null {
  const validLines = state.lines.filter((l) => l.category && parseFloat(l.unitPrice) > 0);
  if (validLines.length === 0) return null;
  return {
    documentType: 'EXPENSE',
    branchId: state.branchId,
    documentDate: state.documentDate,
    priceType: state.priceType,
    paymentMethod: state.paymentMethod || undefined,
    depositAccountCode: state.depositAccountCode || undefined,
    whtFormType: (state.whtFormType || undefined) as 'PND3' | 'PND53' | undefined,
    lines: validLines.map((l) => ({
      category: l.category,
      description: l.description || undefined,
      quantity: parseFloat(l.quantity) || 1,
      unitPrice: parseFloat(l.unitPrice) || 0,
      discount: parseFloat(l.discount) || 0,
      vatPercent: parseFloat(l.vatPercent) || 0,
      whtPercent: parseFloat(l.whtPercent) || 0,
    })),
  };
}

/** Debounced server-side JE preview. Re-runs ~300ms after the form stops changing. */
export function useFormCompute(state: ExpenseFormState): {
  preview: JePreviewResponse | null;
  loading: boolean;
  error: string | null;
} {
  const [preview, setPreview] = useState<JePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const payload = buildPayload(state);
    if (!payload) {
      setPreview(null);
      return;
    }
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.post<JePreviewResponse>(
          '/expense-documents/preview-je',
          payload,
        );
        setPreview(data);
      } catch (e) {
        setError((e as Error).message ?? 'preview failed');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [state]);

  return { preview, loading, error };
}
