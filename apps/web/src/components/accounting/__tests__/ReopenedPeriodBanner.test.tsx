import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReopenedPeriodBanner } from '../ReopenedPeriodBanner';

vi.mock('@/lib/accounting', () => ({
  accountingApi: {
    listReopenedPeriods: vi.fn(),
  },
}));

import { accountingApi } from '@/lib/accounting';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ReopenedPeriodBanner', () => {
  it('renders nothing when no periods are reopened', async () => {
    (accountingApi.listReopenedPeriods as any).mockResolvedValue([]);
    render(<ReopenedPeriodBanner />, { wrapper });
    expect(screen.queryByText(/ถูกเปิดชั่วคราว/)).not.toBeInTheDocument();
  });

  it('renders one banner per reopened period', async () => {
    (accountingApi.listReopenedPeriods as any).mockResolvedValue([
      {
        year: 2026,
        month: 4,
        reopenedAt: '2026-05-12T14:00:00Z',
        reopenedBy: { id: 'u1', name: 'สุทธินีย์' },
        reopenReason: 'WRONG_ENTRY: เอกสาร OI-26040015 ระบุลูกค้าผิด',
        taxFiled: true,
      },
    ]);
    render(<ReopenedPeriodBanner />, { wrapper });
    expect(await screen.findByText(/2026-04/)).toBeInTheDocument();
    expect(screen.getByText(/สุทธินีย์/)).toBeInTheDocument();
    expect(screen.getByText(/ภ.พ.30 ยื่นแล้ว/)).toBeInTheDocument();
  });

  it('omits tax-filed warning when taxFiled is false', async () => {
    (accountingApi.listReopenedPeriods as any).mockResolvedValue([
      { year: 2026, month: 3, reopenedAt: '2026-05-12T14:00:00Z', reopenedBy: { id: 'u1', name: 'สุทธินีย์' }, reopenReason: 'WRONG_ENTRY: ...', taxFiled: false },
    ]);
    render(<ReopenedPeriodBanner />, { wrapper });
    await screen.findByText(/2026-03/);
    expect(screen.queryByText(/ภ.พ.30 ยื่นแล้ว/)).not.toBeInTheDocument();
  });
});
