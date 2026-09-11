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

import { OverpriceRulesTab } from '../OverpriceRulesTab';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('OverpriceRulesTab — ผ่อนสูงสุดต่อกฎ', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      data: [
        {
          id: 'r1',
          label: 'iPhone 16 มือ 1',
          seriesPattern: 'iPhone 16',
          condition: 'HAND_1',
          allowance: '2000',
          maxMonths: 15,
          isActive: true,
          updatedAt: '2026-09-11T03:00:00.000Z',
        },
        {
          id: 'r2',
          label: 'iPhone 12 มือ 2',
          seriesPattern: 'iPhone 12',
          condition: 'HAND_2',
          allowance: '0',
          maxMonths: null,
          isActive: true,
          updatedAt: '2026-09-11T03:00:00.000Z',
        },
      ],
    });
  });

  it('มีคอลัมน์ผ่อนสูงสุด: โชว์ "15 งวด" และ "ไม่จำกัด" เมื่อ null', async () => {
    render(
      <Wrapper>
        <OverpriceRulesTab />
      </Wrapper>,
    );

    expect(await screen.findByRole('columnheader', { name: 'ผ่อนสูงสุด' })).toBeInTheDocument();
    expect(screen.getByText('15 งวด')).toBeInTheDocument();
    expect(screen.getByText('ไม่จำกัด')).toBeInTheDocument();
  });
});
