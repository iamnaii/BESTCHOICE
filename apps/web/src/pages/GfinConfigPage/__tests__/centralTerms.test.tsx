import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { GfinTables, RateFactorApi } from '@/pages/ProductDetailPage/utils/gfinQuote';

const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { patch: (...a: unknown[]) => apiPatch(...a), get: vi.fn(() => Promise.resolve({ data: [] })) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { commissionOptions, formatSheetDate, rateChips, settingsPatch, sheetVersionText } from '../terms/centralTerms';
import { CentralTermsCard } from '../terms/CentralTermsCard';
import { SheetVersionCard } from '../terms/SheetVersionCard';

const factor = (months: number, pct: number, f: string, isActive = true): RateFactorApi => ({
  id: `${months}-${pct}`, months, shopCommissionPct: pct, factor: f, feePerInstallment: '100', isActive,
});
const settings = {
  minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100,
  commissionPctByCategory: { PHONE: 15, TABLET: 5 }, sheetVersion: '6.5', sheetEffectiveDate: '2026-10-16',
};
const tables: GfinTables = {
  mappings: [], rules: [], settings,
  factors: [factor(12, 15, '0.1105'), factor(10, 15, '0.1286'), factor(12, 12, '0.1080'), factor(15, 10, '0.09', false)],
};
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('centralTerms helpers', () => {
  it('commissionOptions = % ที่มีตารางค่างวดเปิดอยู่ เรียงน้อย→มาก', () => {
    expect(commissionOptions(tables.factors)).toEqual([12, 15]);
  });
  it('rateChips = ceil(10,000 × factor) + ค่าธรรมเนียม เรียงตามงวด', () => {
    expect(rateChips(tables.factors, 15)).toEqual([
      { months: 10, monthly: 1386 },
      { months: 12, monthly: 1205 },
    ]);
  });
  it('sheetVersionText / formatSheetDate', () => {
    expect(formatSheetDate('2026-10-16')).toBe('16/10/2026');
    expect(sheetVersionText(settings)).toBe('ใบเงื่อนไข G Finn Version 6.5 · ใช้ตั้งแต่ 16/10/2026');
    expect(sheetVersionText({ ...settings, sheetVersion: null, sheetEffectiveDate: null })).toBe('ยังไม่ได้ระบุเวอร์ชันใบเงื่อนไข');
  });
  it('settingsPatch ส่งเฉพาะช่องที่เปลี่ยน · ไม่ส่งค่าคอม iPad เด็ดขาด', () => {
    expect(settingsPatch(settings, { minDownPct: '25', commissionPhone: '12', contractFee: '100' }, [12, 15])).toEqual({
      ok: true, body: { commissionPhone: 12 },
    });
    expect(settingsPatch(settings, { minDownPct: '85', commissionPhone: '15', contractFee: '100' }, [12, 15])).toEqual({
      ok: false, message: 'ดาวน์ขั้นต่ำต้องเป็นจำนวนเต็ม 0–80%',
    });
    expect(settingsPatch(settings, { minDownPct: '25', commissionPhone: '15', contractFee: '100' }, [12, 15])).toEqual({
      ok: false, message: 'ยังไม่ได้เปลี่ยนอะไร',
    });
  });
  it('settingsPatch ปฏิเสธช่องว่าง · ค่าคอมที่ไม่มีตาราง · ทศนิยมเกิน 2 ตำแหน่ง', () => {
    const ok = { minDownPct: '25', commissionPhone: '15', contractFee: '100' };
    expect(settingsPatch(settings, { ...ok, minDownPct: '' }, [12, 15])).toEqual({ ok: false, message: 'กรุณากรอกเงินดาวน์ขั้นต่ำ' });
    expect(settingsPatch(settings, { ...ok, minDownPct: '  ' }, [12, 15])).toEqual({ ok: false, message: 'กรุณากรอกเงินดาวน์ขั้นต่ำ' });
    expect(settingsPatch(settings, { ...ok, contractFee: '' }, [12, 15])).toEqual({ ok: false, message: 'กรุณากรอกค่าทำสัญญา' });
    expect(settingsPatch(settings, { ...ok, commissionPhone: '10' }, [12, 15])).toEqual({ ok: false, message: 'ค่าคอมนี้ยังไม่มีตารางค่างวด' });
    expect(settingsPatch(settings, { ...ok, commissionPhone: 'x' }, [12, 15])).toEqual({ ok: false, message: 'ค่าคอมนี้ยังไม่มีตารางค่างวด' });
    expect(settingsPatch(settings, { ...ok, contractFee: '100.123' }, [12, 15])).toEqual({
      ok: false, message: 'ค่าทำสัญญามีทศนิยมได้ไม่เกิน 2 ตำแหน่ง',
    });
  });
});

describe('CentralTermsCard / SheetVersionCard', () => {
  beforeEach(() => apiPatch.mockReset().mockResolvedValue({ data: settings }));

  it('แสดงชิปค่างวดของคอมที่เลือก · แก้ดาวน์แล้วบันทึก = PATCH เฉพาะ minDownPct', async () => {
    render(<CentralTermsCard tables={tables} canEdit />, { wrapper: wrap });
    expect(screen.getByText('1,386')).toBeInTheDocument();
    const down = screen.getByLabelText('เงินดาวน์ขั้นต่ำ (%)');
    await userEvent.clear(down);
    await userEvent.type(down, '30');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกค่ากลาง' }));
    expect(apiPatch).toHaveBeenCalledWith('/gfin-config/settings', { minDownPct: 30 });
  });

  it('ไม่ใช่เจ้าของ = อ่านอย่างเดียว ไม่มีปุ่มบันทึก', () => {
    render(<CentralTermsCard tables={tables} canEdit={false} />, { wrapper: wrap });
    expect(screen.queryByRole('button', { name: 'บันทึกค่ากลาง' })).toBeNull();
  });

  it('การ์ดเวอร์ชัน: แสดงเวอร์ชัน · เปลี่ยนเวอร์ชันใหม่ส่ง sheetVersion + sheetEffectiveDate', async () => {
    render(<SheetVersionCard settings={settings} canEdit />, { wrapper: wrap });
    expect(screen.getByText('ใบเงื่อนไข G Finn Version 6.5 · ใช้ตั้งแต่ 16/10/2026')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นเวอร์ชันใหม่' }));
    const v = screen.getByLabelText('เวอร์ชัน');
    await userEvent.clear(v);
    await userEvent.type(v, '6.6');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกเวอร์ชัน' }));
    expect(apiPatch).toHaveBeenCalledWith('/gfin-config/settings', { sheetVersion: '6.6', sheetEffectiveDate: '2026-10-16' });
  });

  it('การ์ดเวอร์ชัน: ไม่มีวันที่ = ปุ่มบันทึกถูกปิด', async () => {
    render(<SheetVersionCard settings={{ ...settings, sheetEffectiveDate: null }} canEdit />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นเวอร์ชันใหม่' }));
    expect(screen.getByRole('button', { name: 'บันทึกเวอร์ชัน' })).toBeDisabled();
  });
});
