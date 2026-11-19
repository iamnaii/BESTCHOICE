import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import api from '@/lib/api';
import { pickComboOption } from '@/test/combobox';
import ProductCreatePage from '../index';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TEMPLATE = {
  cashPrice: '25900.00',
  installmentBestchoicePrice: '25900.00',
  installmentFinancePrice: '25900.00',
  rate1TermMonths: null,
  rate1DownPayment: null,
  rate2TermMonths: null,
};
let template: unknown = TEMPLATE;

beforeEach(() => {
  vi.clearAllMocks();
  template = TEMPLATE;
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/branches') return { data: [{ id: 'branch-1', name: 'สาขาหลัก' }] };
    if (url === '/suppliers') return { data: { data: [] } };
    if (url.startsWith('/pricing-templates/lookup?')) return { data: template };
    if (url.startsWith('/interest-configs/resolved?')) {
      return { data: { minDownPct: 0.15, commissionPct: 0.1, vatPct: 0.07, ratePctByMonths: { 10: 0.5, 12: 0.5 }, allowedMonths: [10, 12] } };
    }
    if (url === '/gfin-config/max-prices') {
      return { data: [{ id: 'm15', gfinSeries: 'iPhone 15', gfinVariant: null, storage: '128GB', condition: 'HAND_1', maxPrice: '24900', modelMatchPattern: 'iPhone 15', isActive: true }] };
    }
    if (url === '/gfin-config/overprice-rules') {
      return { data: [{ id: 'r15', label: 'iPhone 15 มือ 1', seriesPattern: 'iPhone 15', condition: 'HAND_1', allowance: '1000', maxMonths: 12, minDownPct: null, isActive: true }] };
    }
    if (url === '/gfin-config/rate-factors') {
      return { data: [{ id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.17', feePerInstallment: '100', isActive: true }] };
    }
    if (url === '/gfin-config/settings') {
      return { data: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'product-1' } });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ProductCreatePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** ตัวอย่างจากชีต (สเปคข้อ 4.5): iPhone 15 128GB มือ 1 เครื่องไทย ทุน 25,800 */
async function fillIphone15(user: UserEvent, storage = '128GB') {
  await user.selectOptions(await screen.findByLabelText('ยี่ห้อ *'), 'Apple');
  await pickComboOption(user, 'รุ่น *', 'iPhone 15');
  await user.click(screen.getByRole('button', { name: storage }));
  await user.selectOptions(screen.getByLabelText('เครื่องไทย / เครื่องนอก'), 'THAI');
  await user.selectOptions(screen.getByLabelText('สาขา *'), 'branch-1');
  await user.type(screen.getByLabelText('ราคาทุน (บาท) *'), '25800');
}

const paragraph = (text: string) => (_: string, el: Element | null) => el?.tagName === 'P' && el.textContent === text;
const BADGE = 'ตามตารางราคากลาง · iPhone 15 128GB มือ 1';

describe('ProductCreatePage — การ์ดราคาขาย (แบบ D)', () => {
  it('เลือกรุ่น + ความจุ → เติม 3 ราคาจากราคากลาง และขึ้นดาวน์ / ค่างวด / กำไรตามชีต', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    expect(await screen.findByText(BADGE)).toBeInTheDocument();
    expect(screen.getByLabelText('ราคาเงินสด')).toHaveValue('25,900');
    expect(screen.getByLabelText('ราคาผ่อน BESTCHOICE')).toHaveValue('25,900');
    expect(screen.getByLabelText('ราคาขาย GFIN')).toHaveValue('25,900');
    expect(await screen.findByText(paragraph('ดาวน์ 3,900 · ผ่อน 3,139 × 12 งวด'))).toBeInTheDocument();
    expect(screen.getByText(paragraph('ดาวน์ 6,500 · ผ่อน 3,403 × 12 งวด'))).toBeInTheDocument();
    for (const t of ['กำไร 100', 'กำไร 2,300', 'กำไร 2,938']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.queryByText('+ เพิ่มราคา')).not.toBeInTheDocument();
    expect(screen.queryByText('ค่าเริ่มต้น')).not.toBeInTheDocument();
  });

  it('บันทึก → ส่งราคาเป็นคอลัมน์ cashPrice / installmentPrice / financePrice ไม่ส่ง prices[]', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    await screen.findByText(BADGE);
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, payload] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/products');
    expect(payload).toMatchObject({ cashPrice: 25900, installmentPrice: 25900, financePrice: 25900, deviceOrigin: 'THAI' });
    expect(payload).not.toHaveProperty('prices');
  });

  it('แก้ราคาเอง → คิดใหม่ทันที · กรอบเตือน + "ราคากลาง X" · "ใช้ราคากลางทั้งหมด" กลับไปราคากลาง', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    await screen.findByText(BADGE);
    const bc = screen.getByLabelText('ราคาผ่อน BESTCHOICE');
    await user.clear(bc);
    await user.type(bc, '27000');
    expect(await screen.findByText('ราคากลาง 25,900')).toBeInTheDocument();
    expect(screen.getByText('แก้ 1 ราคาจากตารางราคากลาง')).toBeInTheDocument();
    // 27,000 × 15% = 4,050 → 4,100 · ยอดจัด 22,900 → (22,900 + 2,290 + 11,450) × 1.07 / 12 = 3,267.07 → 3,268
    expect(screen.getByText(paragraph('ดาวน์ 4,100 · ผ่อน 3,268 × 12 งวด'))).toBeInTheDocument();
    // ราคา 2 = 4,100 + 22,900 × 1.1 = 29,290 − ทุน 25,800
    expect(screen.getByText('กำไร 3,490')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ใช้ราคากลางทั้งหมด' }));
    expect(bc).toHaveValue('25,900');
    expect(screen.queryByText('ราคากลาง 25,900')).not.toBeInTheDocument();
  });

  it('ไม่พบรุ่นในราคากลาง → ช่องว่าง + ข้อความ · ไม่กรอกราคาเลย → บันทึกไม่ได้', async () => {
    template = '';
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    expect(await screen.findByText('ไม่พบรุ่นนี้ในตารางราคากลาง — กรอกราคาเอง')).toBeInTheDocument();
    expect(screen.getByLabelText('ราคาเงินสด')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));
    expect(toast.error).toHaveBeenCalledWith('กรุณากรอกราคาขายอย่างน้อย 1 ราคา');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('รุ่นที่ไม่มีในใบราคา GFIN → ช่อง GFIN ปิด + ข้อความ · บันทึก financePrice เป็น null', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user, '256GB');
    expect(await screen.findByText('ตามตารางราคากลาง · iPhone 15 256GB มือ 1')).toBeInTheDocument();
    const finance = screen.getByLabelText('ราคาขาย GFIN');
    expect(finance).toBeDisabled();
    expect(finance).toHaveValue('');
    expect(screen.getByText('GFIN ไม่รับรุ่นนี้ — ขายได้แค่เงินสดและผ่อน BESTCHOICE')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ cashPrice: 25900, installmentPrice: 25900, financePrice: null });
  });

  it('อุปกรณ์เสริม → ช่องเดียว "ราคาขาย" ส่งเฉพาะ cashPrice', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText('ประเภท *'), 'ACCESSORY');
    await user.selectOptions(screen.getByLabelText('ประเภทอุปกรณ์ *'), 'ฟิล์ม');
    await user.selectOptions(screen.getByLabelText('สาขา *'), 'branch-1');
    await user.type(screen.getByLabelText('ราคาทุน (บาท) *'), '25');
    await user.type(screen.getByLabelText('ราคาขาย'), '290');
    expect(screen.queryByLabelText('ราคาผ่อน BESTCHOICE')).not.toBeInTheDocument();
    expect(await screen.findByText('กำไร 265')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.post).mock.calls[0][1];
    expect(payload).toMatchObject({ category: 'ACCESSORY', cashPrice: 290 });
    expect(payload).not.toHaveProperty('installmentPrice');
    expect(payload).not.toHaveProperty('financePrice');
  });
});
