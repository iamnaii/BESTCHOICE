import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({ noFactors: false }));
vi.mock('@/pages/ProductDetailPage/hooks/useGfinTables', async () => {
  const { calcTables } = await import('./fixtures/calcTables');
  return {
    useGfinTables: () => ({
      tables: state.noFactors ? { ...calcTables, factors: [] } : calcTables,
      isLoading: false,
      isError: false,
      retry: vi.fn(),
    }),
  };
});

import { CalcTab } from '../calc/CalcTab';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.search}</p>;
}
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/settings/finance/gfin?tab=calc']}>
      {children}
      <Where />
    </MemoryRouter>
  </QueryClientProvider>
);

describe('CalcTab', () => {
  it('เลือกรุ่นที่มีเงื่อนไข → ดาวน์ลูกค้า + ตารางค่างวดไม่เกินผ่อนสูงสุด', async () => {
    render(<CalcTab />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: 'iPhone 17 Pro Max' }));
    expect(screen.getAllByText('12,300').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('cell', { name: '15 งวด' })).toBeInTheDocument();
  });

  it('รุ่นที่ยังไม่ตั้งเงื่อนไข → เหตุผล + ลิงก์แก้รุ่นนี้ ไปแท็บเงื่อนไขพร้อม edit', async () => {
    render(<CalcTab />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: 'iPhone 12' }));
    expect(screen.getByText('ยังไม่ตั้งเงื่อนไข GFIN ของรุ่นนี้ — ตั้งในแท็บ เงื่อนไข & ราคา')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'แก้รุ่นนี้' }));
    expect(screen.getByTestId('where').textContent).toBe('?tab=terms&edit=iPhone+12%7CHAND_2');
  });

  it('ไม่มีตารางค่างวด (no_factor) → บอกเหตุผล แต่ไม่มีปุ่มแก้รุ่นนี้', async () => {
    state.noFactors = true;
    try {
      render(<CalcTab />, { wrapper: wrap });
      await userEvent.click(screen.getByRole('button', { name: 'iPhone 17 Pro Max' }));
      expect(screen.getByText(/ไม่มีตารางค่างวดของคอม/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'แก้รุ่นนี้' })).not.toBeInTheDocument();
    } finally {
      state.noFactors = false;
    }
  });

  it('ราคาขาย 0 หรือติดลบ นับเป็นเว้นว่าง (ขายเท่าราคาส่ง) ไม่ใช่คำนวณจากเลขนั้น', async () => {
    render(<CalcTab />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: 'iPhone 17 Pro Max' }));
    const before = document.body.textContent;
    await userEvent.type(screen.getByLabelText(/ราคาขาย GFIN/), '-5');
    expect(document.body.textContent?.replace('-5', '')).toBe(before?.replace('-5', ''));
  });
});
