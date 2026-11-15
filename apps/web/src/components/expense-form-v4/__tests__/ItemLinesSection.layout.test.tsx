// apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.layout.test.tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

// ผังบัญชี: ขอแบบกรอง type = เฉพาะค่าใช้จ่าย · ขอทั้งหมด = มีบัญชีรายได้ปนมา
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn((_path: string, config?: { params?: { type?: string } }) =>
      Promise.resolve({
        data: {
          groups: [
            {
              category: 'ค่าใช้จ่าย',
              accounts: [{ code: '53-1101', name: 'ค่าไฟฟ้า' }, { code: '53-1102', name: 'ค่าน้ำประปา' }],
            },
            ...(config?.params?.type
              ? []
              : [{ category: 'รายได้', accounts: [{ code: '41-1101', name: 'รายได้ดอกเบี้ย' }] }]),
          ],
        },
      }),
    ),
  },
}));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ whtRates: [{ rate: 0, label: 'ไม่หัก' }] }) }));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }));

import { ItemLinesSection } from '../ItemLinesSection';
import { newLine } from '../types';

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ItemLinesSection lines={[newLine(), newLine()]} onChange={() => {}} priceTypeLabel="ราคาไม่รวม VAT" />
    </QueryClientProvider>,
  );

beforeEach(() => { mobile.value = false; });
beforeAll(() => {
  // jsdom ไม่มี scrollIntoView — ตัวเลือกบัญชีเลื่อนแถวที่ไฮไลต์เข้ามาในจอ
  HTMLElement.prototype.scrollIntoView ??= () => {};
});

describe('ItemLinesSection — ตารางและการ์ด', () => {
  it('จอใหญ่เป็นตารางเดียว หัวคอลัมน์ "จำนวนเงิน" และทุกช่องมีชื่อ', () => {
    mount();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getByRole('columnheader', { name: 'จำนวนเงิน' })).toBeInTheDocument();
    // ลำดับคอลัมน์ตามหน้า PEAK
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '#', 'บัญชีค่าใช้จ่าย / คำอธิบาย', 'จำนวน', 'ราคา/หน่วย', 'ส่วนลด', 'VAT%', 'จำนวนเงิน', 'WHT%', 'ลบ',
    ]);
    // ปุ่ม WHT% แสดงข้อความสั้น — คำอธิบายเต็มอยู่ในรายการที่เปิดออกมา
    expect(screen.getAllByRole('combobox', { name: 'WHT%' })[0]).toHaveTextContent('ไม่หัก');
    expect(screen.queryByText('ก่อนภาษี')).not.toBeInTheDocument();
    for (const name of ['บัญชีค่าใช้จ่าย', 'คำอธิบาย', 'จำนวน', 'ราคา/หน่วย', 'ส่วนลด', 'VAT%', 'WHT%']) {
      expect(screen.getAllByLabelText(name)).toHaveLength(2);
    }
    expect(screen.getAllByRole('button', { name: 'ลบรายการ' })).toHaveLength(2);
  });

  it('จอเล็กเป็นการ์ดต่อบรรทัด ไม่มีตาราง และช่องยังมีชื่อเดิม', () => {
    mobile.value = true;
    mount();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('ราคา/หน่วย')).toHaveLength(2);
    expect(screen.getAllByText('จำนวนเงิน')).toHaveLength(2);
  });

  it('ตัวเลือกบัญชีพิมพ์ค้นหาได้ และมีเฉพาะบัญชีค่าใช้จ่าย', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getAllByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' })[0]);
    expect(await screen.findByRole('option', { name: '53-1101 - ค่าไฟฟ้า' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /รายได้ดอกเบี้ย/ })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('ค้นหารหัส หรือ ชื่อบัญชี'), 'ประปา');
    expect(screen.getByRole('option', { name: /ค่าน้ำประปา/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /ค่าไฟฟ้า/ })).not.toBeInTheDocument();
  });

  it('ช่องที่ชื่อเดียวกันมี id ไม่ซ้ำ', () => {
    mount();
    const ids = screen.getAllByLabelText('ราคา/หน่วย').map((n) => n.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
