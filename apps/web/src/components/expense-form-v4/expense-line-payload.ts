import type { ExpenseLineForm } from './types';

export function buildExpenseLinePayload(l: ExpenseLineForm) {
  return {
    category: l.category,
    description: l.description || undefined,
    quantity: parseFloat(l.quantity) || 1,
    unitPrice: parseFloat(l.unitPrice) || 0,
    discount: parseFloat(l.discount) || 0,
    vatPercent: parseFloat(l.vatPercent) || 0,
    whtPercent: parseFloat(l.whtPercent) || 0,
  };
}
