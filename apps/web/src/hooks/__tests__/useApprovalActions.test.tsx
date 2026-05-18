import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import React from 'react';

// --- mock sonner --------------------------------------------------------------
const toastCalls: { success: string[]; error: string[] } = { success: [], error: [] };
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => {
      toastCalls.success.push(m);
    },
    error: (m: string) => {
      toastCalls.error.push(m);
    },
  },
}));

// --- mock api -----------------------------------------------------------------
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    post: (...args: unknown[]) => apiPost(...args),
  },
  getErrorMessage: (err: unknown) => {
    if (err && typeof err === 'object' && 'message' in err) return String((err as Error).message);
    return 'unknown';
  },
}));

// Import AFTER mocks so the hook picks them up.
import { useApprovalActions, getApprovalReason, canApprove } from '../useApprovalActions';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper, invalidateSpy };
}

describe('useApprovalActions', () => {
  beforeEach(() => {
    toastCalls.success.length = 0;
    toastCalls.error.length = 0;
    apiPost.mockReset();
  });

  it('submitForApproval POSTs to the right endpoint + toasts + invalidates queries on success', async () => {
    apiPost.mockResolvedValue({ data: { id: 'ex-1', status: 'PENDING_APPROVAL' } });
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useApprovalActions(), { wrapper });

    await act(async () => {
      await result.current.submitForApproval.mutateAsync('ex-1');
    });

    expect(apiPost).toHaveBeenCalledWith('/expense-documents/ex-1/submit-for-approval');
    expect(toastCalls.success).toContain('ส่งขออนุมัติแล้ว');
    // Two invalidations: ['expenses'] + ['expenses-summary'].
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toContain('expenses');
    expect(keys).toContain('expenses-summary');
  });

  it('submitForApproval surfaces API error message via sonner.error', async () => {
    apiPost.mockRejectedValue(new Error('Approval workflow is disabled'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApprovalActions(), { wrapper });

    await act(async () => {
      try {
        await result.current.submitForApproval.mutateAsync('ex-2');
      } catch {
        /* expected */
      }
    });

    await waitFor(() => {
      expect(toastCalls.error).toContain('Approval workflow is disabled');
    });
    expect(toastCalls.success).toHaveLength(0);
  });

  it('approve POSTs to /:id/approve and toasts "อนุมัติแล้ว"', async () => {
    apiPost.mockResolvedValue({ data: { id: 'ex-3', status: 'APPROVED' } });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApprovalActions(), { wrapper });

    await act(async () => {
      await result.current.approve.mutateAsync('ex-3');
    });

    expect(apiPost).toHaveBeenCalledWith('/expense-documents/ex-3/approve');
    expect(toastCalls.success).toContain('อนุมัติแล้ว');
  });

  it('approve surfaces 403 (not authorized) via sonner.error and skips invalidation', async () => {
    apiPost.mockRejectedValue(new Error('คุณไม่มีสิทธิ์อนุมัติเอกสารนี้'));
    const { wrapper, invalidateSpy } = makeWrapper();
    invalidateSpy.mockClear();
    const { result } = renderHook(() => useApprovalActions(), { wrapper });

    await act(async () => {
      try {
        await result.current.approve.mutateAsync('ex-4');
      } catch {
        /* expected */
      }
    });

    await waitFor(() => {
      expect(toastCalls.error).toContain('คุณไม่มีสิทธิ์อนุมัติเอกสารนี้');
    });
    // No success-path invalidation should fire when the mutation rejects.
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).not.toContain('expenses');
  });
});

describe('getApprovalReason', () => {
  it('returns null when no threshold AND no doctype rule applies', () => {
    expect(
      getApprovalReason({
        totalAmount: 500,
        docType: 'EXPENSE',
        approvalThreshold: 10_000,
        approvalRequiredDocTypes: ['PAYROLL'],
      }),
    ).toBeNull();
  });

  it('flags threshold-only when amount >= threshold', () => {
    const reason = getApprovalReason({
      totalAmount: 50_000,
      docType: 'EXPENSE',
      approvalThreshold: 10_000,
      approvalRequiredDocTypes: ['PAYROLL'],
    });
    expect(reason).toContain('10,000');
    expect(reason).not.toContain('EXPENSE');
  });

  it('flags doctype-only when type is in required list (regardless of threshold)', () => {
    const reason = getApprovalReason({
      totalAmount: 500,
      docType: 'PAYROLL',
      approvalThreshold: 10_000,
      approvalRequiredDocTypes: ['PAYROLL'],
    });
    expect(reason).toContain('PAYROLL');
  });

  it('combines both reasons when both apply (OR composition)', () => {
    const reason = getApprovalReason({
      totalAmount: 50_000,
      docType: 'PAYROLL',
      approvalThreshold: 10_000,
      approvalRequiredDocTypes: ['PAYROLL'],
    });
    expect(reason).toContain('10,000');
    expect(reason).toContain('PAYROLL');
    expect(reason).toContain(' · ');
  });

  it('zero threshold = approve-every-doc message', () => {
    const reason = getApprovalReason({
      totalAmount: 0,
      docType: 'EXPENSE',
      approvalThreshold: 0,
      approvalRequiredDocTypes: [],
    });
    expect(reason).toContain('ทุกเอกสารต้องผ่านการอนุมัติ');
  });
});

describe('canApprove', () => {
  it('OWNER can always approve', () => {
    expect(canApprove({ userId: 'u-1', userRole: 'OWNER', approversList: [] })).toBe(true);
  });

  it('non-OWNER user in approversList can approve', () => {
    expect(canApprove({ userId: 'u-2', userRole: 'ACCOUNTANT', approversList: ['u-2', 'u-9'] })).toBe(true);
  });

  it('non-OWNER user NOT in approversList cannot approve', () => {
    expect(canApprove({ userId: 'u-3', userRole: 'ACCOUNTANT', approversList: ['u-1'] })).toBe(false);
  });

  it('missing userId returns false (defensive)', () => {
    expect(canApprove({ userId: null, userRole: 'OWNER', approversList: [] })).toBe(false);
  });
});
