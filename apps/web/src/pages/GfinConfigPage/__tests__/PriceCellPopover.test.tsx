import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiPatch = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { patch: (...a: unknown[]) => apiPatch(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PriceCellPopover } from '../terms/PriceCellPopover';
import type { ModelTermsRow } from '../terms/modelTerms';

const row: ModelTermsRow = {
  key: 'iPhone 17 Pro Max|HAND_1', series: 'iPhone 17 Pro Max', family: '17', condition: 'HAND_1',
  cells: [], rule: null, allowance: 2000, maxMonths: 15, downPct: 30, downSource: 'MODEL', hasActivePrice: true, needsRule: false,
};
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('PriceCellPopover', () => {
  beforeEach(() => {
    apiPatch.mockReset().mockResolvedValue({ data: {} });
    apiPost.mockReset().mockResolvedValue({ data: {} });
  });

  it('แก้ราคา: บรรทัดราคาส่ง = ราคา + OVER · บันทึก = PATCH maxPrice + isActive', async () => {
    render(<PriceCellPopover row={row} cell={{ storage: '1TB', mappingId: 'm1', price: 59900 }} canEdit />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: /iPhone 17 Pro Max 1TB มือ 1 ราคา 59,900/ }));
    expect(screen.getByText('ราคาส่ง GFIN = ราคานี้ + OVER 2,000 = 61,900')).toBeInTheDocument();
    const input = screen.getByLabelText('ราคาสูงสุดที่ GFIN รับ (บาท)');
    await userEvent.clear(input);
    await userEvent.type(input, '58900');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(apiPatch).toHaveBeenCalledWith('/gfin-config/max-prices/m1', { maxPrice: 58900, isActive: true });
  });

  it('GFIN ไม่รับแล้ว (ปิด) = PATCH isActive false', async () => {
    render(<PriceCellPopover row={row} cell={{ storage: '1TB', mappingId: 'm1', price: 59900 }} canEdit />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: /ราคา 59,900/ }));
    await userEvent.click(screen.getByRole('button', { name: 'GFIN ไม่รับแล้ว (ปิด)' }));
    expect(apiPatch).toHaveBeenCalledWith('/gfin-config/max-prices/m1', { isActive: false });
  });

  it('ช่อง "—" ที่ไม่เคยมีแถว = POST แถวใหม่', async () => {
    render(<PriceCellPopover row={row} cell={{ storage: '2TB', mappingId: null, price: null }} canEdit />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: /2TB มือ 1 ไม่มีราคา/ }));
    await userEvent.type(screen.getByLabelText('ราคาสูงสุดที่ GFIN รับ (บาท)'), '69900');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(apiPost).toHaveBeenCalledWith('/gfin-config/max-prices', {
      gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '2TB', condition: 'HAND_1',
      maxPrice: 69900, modelMatchPattern: 'iPhone 17 Pro Max', isActive: true,
    });
  });

  it('ราคาทศนิยมเกิน 2 ตำแหน่ง = ปุ่มบันทึกกดไม่ได้', async () => {
    render(<PriceCellPopover row={row} cell={{ storage: '2TB', mappingId: null, price: null }} canEdit />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: /2TB มือ 1 ไม่มีราคา/ }));
    await userEvent.type(screen.getByLabelText('ราคาสูงสุดที่ GFIN รับ (บาท)'), '100.123');
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDisabled();
  });

  it('ไม่ใช่เจ้าของ = ข้อความเฉย ๆ ไม่มีปุ่ม', () => {
    render(<PriceCellPopover row={row} cell={{ storage: '1TB', mappingId: 'm1', price: 59900 }} canEdit={false} />, { wrapper: wrap });
    expect(screen.getByText('59,900')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
