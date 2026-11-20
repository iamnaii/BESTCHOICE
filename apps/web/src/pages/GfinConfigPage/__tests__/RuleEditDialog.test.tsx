import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RuleEditDialog } from '../terms/RuleEditDialog';
import { buildModelTermsView } from '../terms/modelTerms';

const tables: GfinTables = {
  mappings: [
    { id: 'm1', gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '38900', modelMatchPattern: 'iPhone 17 Pro Max', isActive: true },
    { id: 'm2', gfinSeries: 'iPhone 12', gfinVariant: null, storage: '64GB', condition: 'HAND_2', maxPrice: '9000', modelMatchPattern: 'iPhone 12', isActive: true },
  ],
  rules: [{ id: 'r1', label: 'x', seriesPattern: 'iPhone 17 Pro Max', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true }],
  factors: [{ id: 'f15', months: 15, shopCommissionPct: 15, factor: '0.0921', feePerInstallment: '100', isActive: true }],
  settings: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } },
};
const view = buildModelTermsView(tables);
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('RuleEditDialog', () => {
  beforeEach(() => apiPost.mockReset().mockResolvedValue({ data: { created: 0, updated: 1 } }));

  it('ดาวน์ → ใช้ค่ากลาง: สรุป + ตัวอย่างก่อน→หลัง · บันทึก = bulk-upsert minDownPct null', async () => {
    const onClose = vi.fn();
    render(<RuleEditDialog rows={[view.rows.find((r) => r.key === 'iPhone 17 Pro Max|HAND_2')!]} tables={tables} onRemove={vi.fn()} onClose={onClose} />, { wrapper: wrap });
    expect(screen.getByText('ตอนนี้ 30% (ตั้งเฉพาะรุ่น)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /ใช้ค่ากลาง · 25%/ }));
    expect(screen.getByText('ดาวน์ 30% (ตั้งเฉพาะรุ่น) → 25% (ค่ากลาง)')).toBeInTheDocument();
    expect(screen.getByText(/ดาวน์ลูกค้า 12,300 → 10,300/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก 1 รุ่น' }));
    expect(apiPost).toHaveBeenCalledWith('/gfin-config/overprice-rules/bulk-upsert', {
      items: [{ series: 'iPhone 17 Pro Max', condition: 'HAND_2' }],
      minDownPct: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('มีแถวที่ยังไม่ตั้ง: "ไม่เปลี่ยน" ของ OVER/ผ่อนสูงสุดกดไม่ได้ · ต้องกรอกก่อนบันทึก', async () => {
    const noRule = view.rows.find((r) => r.key === 'iPhone 12|HAND_2')!;
    render(<RuleEditDialog rows={[noRule]} tables={tables} onRemove={vi.fn()} onClose={vi.fn()} />, { wrapper: wrap });
    expect(screen.getAllByRole('radio', { name: 'ไม่เปลี่ยน' })[0]).toBeDisabled();
    const save = screen.getByRole('button', { name: 'บันทึก 1 รุ่น' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('OVER (บาท)'), '0');
    await userEvent.click(screen.getByRole('radio', { name: '12 งวด' }));
    await userEvent.click(save);
    expect(apiPost).toHaveBeenCalledWith('/gfin-config/overprice-rules/bulk-upsert', {
      items: [{ series: 'iPhone 12', condition: 'HAND_2' }],
      allowance: 0,
      maxMonths: 12,
    });
  });

  it('ชิปรุ่นกดเอาออกได้', async () => {
    const onRemove = vi.fn();
    render(<RuleEditDialog rows={view.rows} tables={tables} onRemove={onRemove} onClose={vi.fn()} />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: 'เอา iPhone 12 มือ 2 ออก' }));
    expect(onRemove).toHaveBeenCalledWith('iPhone 12|HAND_2');
  });
});
