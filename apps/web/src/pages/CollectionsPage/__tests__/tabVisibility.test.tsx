import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CollectionsPage from '../index';

// Mock auth context
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock view toggle so the page renders Library mode (the tabbed view) for the
// test, regardless of role default. The toggle's persistence is tested elsewhere.
vi.mock('../hooks/useViewToggle', () => ({
  useViewToggle: () => ({ view: 'LIBRARY', setView: vi.fn() }),
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
  it('OWNER sees 5 tabs including ภาพรวมทีม + วิเคราะห์', () => {
    renderWith('OWNER');
    const labels = getTabLabels();
    expect(labels).toEqual(
      expect.arrayContaining(['คิววันนี้', 'นัดชำระ', 'ทั้งหมด', 'ภาพรวมทีม', 'วิเคราะห์']),
    );
    expect(labels).toHaveLength(5);
  });

  it('FINANCE_MANAGER sees ภาพรวมทีม + วิเคราะห์', () => {
    renderWith('FINANCE_MANAGER');
    const labels = getTabLabels();
    expect(labels).toContain('วิเคราะห์');
    expect(labels).toContain('ภาพรวมทีม');
  });

  it('BRANCH_MANAGER does NOT see วิเคราะห์ or ภาพรวมทีม', () => {
    renderWith('BRANCH_MANAGER');
    const labels = getTabLabels();
    expect(labels).not.toContain('วิเคราะห์');
    expect(labels).not.toContain('ภาพรวมทีม');
  });

  it('SALES sees 3 tabs (no analytics, no ภาพรวมทีม)', () => {
    renderWith('SALES');
    const labels = getTabLabels();
    expect(labels).toEqual(['คิววันนี้', 'นัดชำระ', 'ทั้งหมด']);
    expect(labels).not.toContain('วิเคราะห์');
    expect(labels).not.toContain('ภาพรวมทีม');
  });

  it('ACCOUNTANT sees 3 tabs (no analytics, no ภาพรวมทีม)', () => {
    renderWith('ACCOUNTANT');
    const labels = getTabLabels();
    expect(labels).toHaveLength(3);
    expect(labels).not.toContain('วิเคราะห์');
    expect(labels).not.toContain('ภาพรวมทีม');
  });
});
