import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InterestConfigPage from './InterestConfigPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, put: mocks.put, patch: mocks.patch, delete: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));

const configWithRates = {
  id: 'ic-1',
  name: 'มือ 2',
  productCategories: ['PHONE_USED'],
  interestRate: '0.05',
  minDownPaymentPct: '0.15',
  storeCommissionPct: '0.10',
  vatPct: '0.07',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  rates: [
    { months: 10, ratePct: '0.5' },
    { months: 12, ratePct: '0.5' },
  ],
};

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <InterestConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function editConfig() {
  open();
  await screen.findByText('มือ 2');
  // ปุ่ม "แก้ไข" ตัวแรกเป็นของค่าตั้งต้นระบบ — ตัวที่สองคือการ์ดตั้งค่านี้ (แบบเดียวกับ InterestConfigPage.rates.test.tsx)
  fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[1]);
  await screen.findAllByLabelText('จำนวนงวด');
}

describe('InterestConfigPage — ดอกเบี้ยต่อเดือนเว้นได้เมื่อมีตารางรายงวด', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/settings') return { data: [] };
      if (url === '/interest-configs') return { data: [configWithRates] };
      if (url === '/companies')
        return { data: [{ id: 'f', companyCode: 'FINANCE', vatRegistered: true, vatRate: '0.0700' }] };
      throw new Error(`unexpected ${url}`);
    });
    mocks.put.mockResolvedValue({ data: configWithRates });
  });

  it('มีตาราง + ดอกเบี้ยต่อเดือน 0 → บันทึกได้ ส่ง interestRate 0 พร้อมแถวเดิม', async () => {
    await editConfig();
    fireEvent.change(screen.getByLabelText('ดอกเบี้ยต่อเดือน (%)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(mocks.put.mock.calls[0][1]).toMatchObject({
      interestRate: 0,
      rates: [
        { months: 10, ratePct: 0.5 },
        { months: 12, ratePct: 0.5 },
      ],
    });
  });

  it('มีตาราง + ช่องว่าง → บันทึกเป็น 0', async () => {
    await editConfig();
    fireEvent.change(screen.getByLabelText('ดอกเบี้ยต่อเดือน (%)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(mocks.put.mock.calls[0][1].interestRate).toBe(0);
  });

  it('มีตาราง + ดอกเบี้ยต่อเดือน 0 → ตัวอย่างคำนวณในฟอร์มยังแสดง (ตามแถว 12 งวด 50%)', async () => {
    await editConfig();
    fireEvent.change(screen.getByLabelText('ดอกเบี้ยต่อเดือน (%)'), { target: { value: '0' } });
    // การ์ด 1 ที่ + ตัวอย่างในฟอร์ม 1 ที่
    expect(screen.getAllByText('1,555.06 ฿').length).toBeGreaterThan(1);
  });

  it('ไม่มีตาราง + ดอกเบี้ยต่อเดือน 0 → ข้อความ และไม่บันทึก', async () => {
    await editConfig();
    fireEvent.click(screen.getByRole('button', { name: 'ลบแถว 10 งวด' }));
    fireEvent.click(screen.getByRole('button', { name: 'ลบแถว 12 งวด' }));
    fireEvent.change(screen.getByLabelText('ดอกเบี้ยต่อเดือน (%)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(
      await screen.findByText('ดอกเบี้ยต่อเดือนต้องมากกว่า 0 — หรือใส่ตารางดอกเบี้ยรายงวดอย่างน้อย 1 แถว'),
    ).toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
