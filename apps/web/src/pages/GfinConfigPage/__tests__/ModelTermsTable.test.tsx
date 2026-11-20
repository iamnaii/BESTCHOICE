import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';

vi.mock('@/lib/api', () => ({ __esModule: true, default: {}, getErrorMessage: String }));

import { ModelTermsTable } from '../terms/ModelTermsTable';
import { ModelTermsCards } from '../terms/ModelTermsCards';
import { buildModelTermsView } from '../terms/modelTerms';

const tables: GfinTables = {
  mappings: [
    { id: 'a', gfinSeries: 'iPhone 17', gfinVariant: null, storage: '256GB', condition: 'HAND_1', maxPrice: '30000', modelMatchPattern: 'iPhone 17', isActive: true },
    { id: 'b', gfinSeries: 'iPhone 17', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '25000', modelMatchPattern: 'iPhone 17', isActive: true },
    { id: 'c', gfinSeries: 'iPhone 12', gfinVariant: null, storage: '64GB', condition: 'HAND_2', maxPrice: '9000', modelMatchPattern: 'iPhone 12', isActive: true },
  ],
  rules: [
    { id: 'r1', label: 'x', seriesPattern: 'iPhone 17', condition: 'HAND_1', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true },
    { id: 'r2', label: 'y', seriesPattern: 'iPhone 17', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: null, isActive: true },
  ],
  factors: [],
  settings: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } },
};
const view = buildModelTermsView(tables);
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
const props = () => ({
  families: view.families,
  storageColumns: view.storageColumns,
  selected: new Set<string>(['iPhone 17|HAND_2']),
  collapsed: new Set<string>(),
  canEdit: true,
  onToggleRow: vi.fn(),
  onSelectFamilyHand: vi.fn(),
  onToggleFamily: vi.fn(),
  onEdit: vi.fn(),
});

describe('ModelTermsTable', () => {
  it('หัวคอลัมน์ความจุ + ดาวน์ตั้งเฉพาะรุ่นตัวหนา / ค่ากลางสีเทา + ช่องส้มของแถวที่ยังไม่ตั้ง', async () => {
    const p = props();
    render(<ModelTermsTable {...p} />, { wrapper: wrap });
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: '64GB' })).toBeInTheDocument();
    expect(within(table).getByText('30%')).toHaveClass('font-semibold');
    expect(within(table).getByText('25%')).toHaveClass('text-muted-foreground');
    expect(within(table).getByText('ยังไม่ตั้งเงื่อนไข · ยังคิดผ่อนไม่ได้')).toBeInTheDocument();
    await userEvent.click(within(table).getByRole('button', { name: 'ตั้งเงื่อนไข iPhone 12 มือ 2' }));
    expect(p.onEdit).toHaveBeenCalledWith(['iPhone 12|HAND_2']);
  });

  it('เลือกแถว · เลือกมือ 2 ทั้งตระกูล · พับตระกูล', async () => {
    const p = props();
    render(<ModelTermsTable {...p} />, { wrapper: wrap });
    expect(screen.getByRole('checkbox', { name: 'เลือก iPhone 17 มือ 2' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'เลือก iPhone 17 มือ 1' }));
    expect(p.onToggleRow).toHaveBeenCalledWith('iPhone 17|HAND_1');
    await userEvent.click(screen.getByRole('button', { name: 'เลือกมือ 2 ทั้งตระกูล iPhone 17' }));
    expect(p.onSelectFamilyHand).toHaveBeenCalledWith(view.families[1], 'HAND_2');
    await userEvent.click(screen.getByRole('button', { name: 'พับ iPhone 17' }));
    expect(p.onToggleFamily).toHaveBeenCalledWith('17');
  });
});

describe('ModelTermsCards', () => {
  it('การ์ดทีละรุ่น บล็อกมือ 1/มือ 2 + ปุ่มแก้', async () => {
    const p = props();
    render(<ModelTermsCards {...p} />, { wrapper: wrap });
    const card = screen.getByRole('article', { name: 'iPhone 17' });
    expect(within(card).getByText('มือ 1')).toBeInTheDocument();
    expect(within(card).getAllByText('OVER +2,000 · ผ่อน 15 งวด · ดาวน์')).toHaveLength(2); // มือ 1 และมือ 2 มีเงื่อนไขเดียวกันใน fixture
    await userEvent.click(within(card).getByRole('button', { name: 'แก้ iPhone 17 มือ 1' }));
    expect(p.onEdit).toHaveBeenCalledWith(['iPhone 17|HAND_1']);
  });
});
