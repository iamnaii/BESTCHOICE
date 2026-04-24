import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CollectionsPage from '../index';

// Mock auth context
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock hooks that fire network requests so the page renders without errors
vi.mock('../hooks/useCollectionsKpi', () => ({
  useCollectionsKpi: () => ({ data: null, isLoading: false }),
}));

vi.mock('../hooks/useCollectionsQueue', () => ({
  useCollectionsQueue: () => ({
    data: { data: [], total: 0, page: 1, limit: 50, truncated: false },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useApprovalQueues', () => ({
  useApprovalQueues: () => ({ data: null, isLoading: false }),
  usePendingMdm: () => ({ data: [], isLoading: false }),
  usePendingLetters: () => ({ data: [], isLoading: false }),
  usePendingExchanges: () => ({ data: [], isLoading: false }),
  usePendingRepossessions: () => ({ data: [], isLoading: false }),
  usePendingWriteOffs: () => ({ data: [], isLoading: false }),
  useApproveMdm: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectMdm: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlockMdm: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveLetter: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectLetter: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveExchange: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectExchange: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveRepossession: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectRepossession: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveWriteOff: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectWriteOff: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/useCollectionsAnalytics', () => ({
  useCollectionsAnalytics: () => ({ data: null, isLoading: false }),
}));

import { useAuth } from '@/contexts/AuthContext';

function renderWith(role: string) {
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: 'u1', email: 'x@y.com', name: 'T', role, branchId: null },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** helper: get tab buttons from the CollectionsTabs bar (buttons with border-b-2) */
function getTabLabels(): string[] {
  return Array.from(document.querySelectorAll('button.border-b-2')).map(
    (btn) => btn.textContent?.trim() ?? '',
  );
}

describe('CollectionsPage tab visibility by role', () => {
  it('OWNER sees all 6 tabs including อนุมัติ + วิเคราะห์', () => {
    renderWith('OWNER');
    const labels = getTabLabels();
    expect(labels).toEqual(
      expect.arrayContaining(['คิววันนี้', 'ตามต่อ', 'นัดชำระ', 'อนุมัติ', 'ทั้งหมด', 'วิเคราะห์']),
    );
    expect(labels).toHaveLength(6);
  });

  it('FINANCE_MANAGER sees approval and analytics', () => {
    renderWith('FINANCE_MANAGER');
    const labels = getTabLabels();
    expect(labels).toEqual(
      expect.arrayContaining(['อนุมัติ', 'วิเคราะห์']),
    );
  });

  it('BRANCH_MANAGER sees approval but NOT analytics', () => {
    renderWith('BRANCH_MANAGER');
    const labels = getTabLabels();
    expect(labels).toContain('อนุมัติ');
    expect(labels).not.toContain('วิเคราะห์');
  });

  it('SALES sees 4 tabs (no approval, no analytics)', () => {
    renderWith('SALES');
    const labels = getTabLabels();
    expect(labels).toEqual(['คิววันนี้', 'ตามต่อ', 'นัดชำระ', 'ทั้งหมด']);
    expect(labels).not.toContain('อนุมัติ');
    expect(labels).not.toContain('วิเคราะห์');
  });

  it('ACCOUNTANT sees 4 tabs (no approval, no analytics)', () => {
    renderWith('ACCOUNTANT');
    const labels = getTabLabels();
    expect(labels).not.toContain('อนุมัติ');
    expect(labels).not.toContain('วิเคราะห์');
    expect(labels).toHaveLength(4);
  });
});
