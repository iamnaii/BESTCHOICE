import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InterestConfigPage from './InterestConfigPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    put: mocks.put,
    patch: mocks.patch,
    delete: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

function open() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <InterestConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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

describe('InterestConfigPage — ตารางดอกเบี้ยรายงวด', () => {
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

  it('การ์ดแสดงอัตราตามตาราง', async () => {
    open();
    await screen.findByText('มือ 2');
    expect(screen.getByText('ตามตารางรายงวด')).toBeInTheDocument();
    expect(screen.getByText('10 งวด 50%')).toBeInTheDocument();
    expect(screen.getByText('12 งวด 50%')).toBeInTheDocument();
  });

  it('แก้ไข: แสดงแถวเดิม เพิ่มงวด ลบแถว แล้วบันทึกเป็นเศษส่วน', async () => {
    open();
    await screen.findByText('มือ 2');
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[1]);

    const monthInputs = await screen.findAllByLabelText('จำนวนงวด');
    expect(monthInputs.map((el) => (el as HTMLInputElement).value)).toEqual(['10', '12']);

    fireEvent.click(screen.getByRole('button', { name: 'ลบแถว 10 งวด' }));
    fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มงวด' }));
    const after = screen.getAllByLabelText('จำนวนงวด');
    fireEvent.change(after[after.length - 1], { target: { value: '8' } });
    const rates = screen.getAllByLabelText('ดอกเบี้ยรวม (%)');
    fireEvent.change(rates[rates.length - 1], { target: { value: '45' } });

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(mocks.put.mock.calls[0][1].rates).toEqual([
      { months: 12, ratePct: 0.5 },
      { months: 8, ratePct: 0.45 },
    ]);
  });

  it('งวดซ้ำ → แสดงข้อความ และไม่บันทึก', async () => {
    open();
    await screen.findByText('มือ 2');
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[1]);
    await screen.findAllByLabelText('จำนวนงวด');
    fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มงวด' }));
    const after = screen.getAllByLabelText('จำนวนงวด');
    fireEvent.change(after[after.length - 1], { target: { value: '12' } });
    const rates = screen.getAllByLabelText('ดอกเบี้ยรวม (%)');
    fireEvent.change(rates[rates.length - 1], { target: { value: '40' } });

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('จำนวนงวดซ้ำกัน: 12 งวด')).toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('ตัวอย่างคำนวณในการ์ดใช้เครื่องคิดเลขกลาง (12 งวด 50%)', async () => {
    open();
    await screen.findByText('มือ 2');
    // ดาวน์ 15% ของ 12,900 = 1,935 → ปัดขึ้นร้อย 2,000 · ดอกเบี้ย 5,450 · ค่างวด 1,555.06 (ตัวเลขเดียวกับสัญญา)
    expect(screen.getByText('ตัวอย่างคำนวณ (ราคา 12,900 บาท / 12 งวด)')).toBeInTheDocument();
    expect(screen.getByText('2,000 ฿')).toBeInTheDocument();
    expect(screen.getByText('5,450 ฿')).toBeInTheDocument();
    expect(screen.getByText('1,555.06 ฿')).toBeInTheDocument();
  });

  it('ฟอร์ม: ตัวอย่างคำนวณตรงกับการ์ด และแสดงค่าคอมจริง', async () => {
    open();
    await screen.findByText('มือ 2');
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[1]);
    await screen.findAllByLabelText('จำนวนงวด');
    expect(screen.getByText(/ค่าคอม 10%/)).toBeInTheDocument();
    expect(screen.getAllByText('1,555.06 ฿').length).toBeGreaterThan(1);
  });

  it('+ เพิ่มงวด: ได้งวดว่างตัวเล็กสุดในช่วง ดอกเบี้ย 0 (ต้องกรอกเอง) และบันทึกไม่ได้', async () => {
    open();
    await screen.findByText('มือ 2');
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[1]);
    await screen.findAllByLabelText('จำนวนงวด');
    fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มงวด' }));
    const months = screen.getAllByLabelText('จำนวนงวด').map((el) => (el as HTMLInputElement).value);
    expect(months).toEqual(['10', '12', '6']);
    const rates = screen.getAllByLabelText('ดอกเบี้ยรวม (%)').map((el) => (el as HTMLInputElement).value);
    expect(rates[2]).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('ดอกเบี้ยรวมต้องมากกว่า 0% และไม่เกิน 999.99%')).toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
