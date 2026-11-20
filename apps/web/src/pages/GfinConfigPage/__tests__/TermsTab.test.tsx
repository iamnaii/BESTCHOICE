import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';

const authState = vi.hoisted(() => ({ role: 'OWNER' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: authState.role } }) }));
const data: Record<string, unknown> = {
  '/gfin-config/max-prices': [
    { id: 'a', gfinSeries: 'iPhone 17', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '25000', modelMatchPattern: 'iPhone 17', isActive: true },
    { id: 'b', gfinSeries: 'iPhone 17 Pro', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '30000', modelMatchPattern: 'iPhone 17 Pro', isActive: true },
    { id: 'c', gfinSeries: 'iPhone 12', gfinVariant: null, storage: '64GB', condition: 'HAND_2', maxPrice: '9000', modelMatchPattern: 'iPhone 12', isActive: true },
  ],
  '/gfin-config/overprice-rules': [
    { id: 'r1', label: 'x', seriesPattern: 'iPhone 17', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true },
    { id: 'r2', label: 'y', seriesPattern: 'iPhone 17 Pro', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true },
  ],
  '/gfin-config/rate-factors': [{ id: 'f', months: 15, shopCommissionPct: 15, factor: '0.0921', feePerInstallment: '100', isActive: true }],
  '/gfin-config/settings': { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 }, sheetVersion: '6.5', sheetEffectiveDate: '2026-10-16' },
};
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (url: string) => Promise.resolve({ data: data[url] }), post: vi.fn(), patch: vi.fn() },
  getErrorMessage: String,
}));

import { TermsTab } from '../terms/TermsTab';

function renderAt(url = '/settings/finance/gfin?tab=terms') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<TermsTab />, { wrapper: wrap });
}

describe('TermsTab', () => {
  beforeEach(() => {
    authState.role = 'OWNER';
  });

  it('แถบส้มบอกแถวที่มีราคาแต่ยังไม่ตั้งเงื่อนไข + ปุ่มกรองเฉพาะแถวที่ต้องดู', async () => {
    renderAt();
    expect(await screen.findByText('1 แถวมีราคาแต่ยังไม่ตั้งเงื่อนไข — iPhone 12 มือ 2')).toBeInTheDocument();
    const table = screen.getByTestId('terms-table');
    expect(within(table).getAllByRole('checkbox')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'ดูเฉพาะแถวที่ต้องดู' }));
    expect(within(table).getAllByRole('checkbox')).toHaveLength(1);
  });

  it('เลือกมือ 2 ทั้งตระกูล → แถบเลือก → แก้เงื่อนไขพร้อมกัน เปิดกล่องพร้อมรุ่นที่เลือก', async () => {
    renderAt();
    const table = await screen.findByTestId('terms-table');
    await userEvent.click(within(table).getByRole('button', { name: 'เลือกมือ 2 ทั้งตระกูล iPhone 17' }));
    expect(screen.getByText('เลือก 2 แถว · มือ 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'แก้เงื่อนไขพร้อมกัน' }));
    expect(screen.getByRole('dialog', { name: /แก้เงื่อนไขพร้อมกัน · 2 รุ่น/ })).toBeInTheDocument();
  });

  it('?edit=<แถว> เปิดกล่องแก้ของแถวนั้น', async () => {
    renderAt('/settings/finance/gfin?tab=terms&edit=' + encodeURIComponent('iPhone 12|HAND_2'));
    expect(await screen.findByRole('dialog', { name: /แก้เงื่อนไข · 1 รุ่น · มือ 2/ })).toBeInTheDocument();
  });
});
