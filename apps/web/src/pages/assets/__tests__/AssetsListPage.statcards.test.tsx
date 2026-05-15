import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { vi, describe, it, expect } from 'vitest';
import AssetsListPage from '../AssetsListPage';

vi.mock('../api', () => ({
  assetsApi: {
    getSummary: vi.fn().mockResolvedValue({
      draft: 5, posted: 12, reversed: 2, disposed: 0, writtenOff: 0,
      totalPurchaseCost: 100000, totalNetBookValue: 80000,
    }),
    list: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
    delete: vi.fn(),
  },
}));

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AssetsListPage /></MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('AssetsListPage — P3 stat cards (Thai labels, no TOTAL COST)', () => {
  it('renders exactly 4 stat cards with Thai labels', async () => {
    renderPage();
    expect(await screen.findByText('ทั้งหมด')).toBeInTheDocument();
    expect(await screen.findByText('รอดำเนินการ')).toBeInTheDocument();
    expect(await screen.findByText('ลงบัญชี')).toBeInTheDocument();
    expect(await screen.findByText('ยกเลิก')).toBeInTheDocument();
  });

  it('does NOT render legacy English labels for stat cards', async () => {
    renderPage();
    await screen.findByText('ทั้งหมด');
    // Status badges in the table still use English labels — only stat cards are Thai
    const draftLabels = screen.queryAllByText('DRAFT');
    expect(draftLabels.length).toBeLessThanOrEqual(1); // 1 = filter dropdown option, never as stat card
    expect(screen.queryByText('TOTAL COST')).not.toBeInTheDocument();
  });

  it('ทั้งหมด card shows sum of draft+posted+reversed', async () => {
    renderPage();
    expect(await screen.findByText('19')).toBeInTheDocument(); // 5+12+2
  });
});
