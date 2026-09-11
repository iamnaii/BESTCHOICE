import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { RateFactorsTab } from '../RateFactorsTab';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('RateFactorsTab — เรทต่อ (งวด, %คอม)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      data: [
        {
          id: 'f1',
          months: 12,
          shopCommissionPct: 15,
          factor: '0.179238',
          feePerInstallment: '100',
          isActive: true,
          updatedAt: '2026-09-11T03:00:00.000Z',
        },
        {
          id: 'f2',
          months: 12,
          shopCommissionPct: 5,
          factor: '0.160000',
          feePerInstallment: '100',
          isActive: true,
          updatedAt: '2026-09-11T03:00:00.000Z',
        },
      ],
    });
  });

  it('มีคอลัมน์ % คอมมิชชั่น และโชว์ค่าของแต่ละแถว', async () => {
    render(
      <Wrapper>
        <RateFactorsTab />
      </Wrapper>,
    );

    expect(await screen.findByRole('columnheader', { name: '% คอมมิชชั่น' })).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
  });
});
