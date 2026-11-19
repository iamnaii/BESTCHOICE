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
type Get = (url: string) => Promise<{ data: unknown }>;
const BC_CONFIG = { minDownPct: 0.15, commissionPct: 0.1, vatPct: 0.07, ratePctByMonths: { 10: 0.5, 12: 0.5 }, allowedMonths: [10, 12] };
const GFIN_SETTINGS = { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } };
let lookup: Get;
let bcConfig: Get;
let gfinSettings: Get;

beforeEach(() => {
  vi.clearAllMocks();
  template = TEMPLATE;
  lookup = async () => ({ data: template });
  bcConfig = async () => ({ data: BC_CONFIG });
  gfinSettings = async () => ({ data: GFIN_SETTINGS });
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/branches') return { data: [{ id: 'branch-1', name: 'สาขาหลัก' }] };
    if (url === '/suppliers') return { data: { data: [] } };
    if (url.startsWith('/pricing-templates/lookup?')) return lookup(url);
    if (url.startsWith('/interest-configs/resolved?')) return bcConfig(url);
    if (url === '/gfin-config/max-prices') {
      return { data: [{ id: 'm15', gfinSeries: 'iPhone 15', gfinVariant: null, storage: '128GB', condition: 'HAND_1', maxPrice: '24900', modelMatchPattern: 'iPhone 15', isActive: true }] };
    }
    if (url === '/gfin-config/overprice-rules') {
      return { data: [{ id: 'r15', label: 'iPhone 15 มือ 1', seriesPattern: 'iPhone 15', condition: 'HAND_1', allowance: '1000', maxMonths: 12, minDownPct: null, isActive: true }] };
    }
    if (url === '/gfin-config/rate-factors') {
      return { data: [{ id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.17', feePerInstallment: '100', isActive: true }] };
    }
    if (url === '/gfin-config/settings') return gfinSettings(url);
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
    expect(screen.getByLabelText('เงินสด')).toHaveValue('25,900');
    expect(screen.getByLabelText('ผ่อน BESTCHOICE')).toHaveValue('25,900');
    expect(screen.getByLabelText('ผ่อน GFIN ราคาขาย')).toHaveValue('25,900');
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
    const bc = screen.getByLabelText('ผ่อน BESTCHOICE');
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
    expect(screen.getByLabelText('เงินสด')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));
    expect(toast.error).toHaveBeenCalledWith('กรุณากรอกราคาเงินสดหรือราคาผ่อน BESTCHOICE อย่างน้อย 1 ราคา');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('รุ่นที่ไม่มีในใบราคา GFIN → ช่อง GFIN ปิด + ข้อความ · บันทึก financePrice เป็น null', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user, '256GB');
    expect(await screen.findByText('ตามตารางราคากลาง · iPhone 15 256GB มือ 1')).toBeInTheDocument();
    const finance = screen.getByLabelText('ผ่อน GFIN ราคาขาย');
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
    expect(screen.queryByLabelText('ผ่อน BESTCHOICE')).not.toBeInTheDocument();
    expect(await screen.findByText('กำไร 265')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.post).mock.calls[0][1];
    expect(payload).toMatchObject({ category: 'ACCESSORY', cashPrice: 290 });
    expect(payload).not.toHaveProperty('installmentPrice');
    expect(payload).not.toHaveProperty('financePrice');
  });

  it('เปลี่ยนความจุ → ล้างราคาอัตโนมัติเดิมทันที (ช่องที่แก้เองคงไว้) · รอราคากลางชุดใหม่ → บันทึกไม่ได้', async () => {
    let release!: () => void;
    const TPL_256 = { ...TEMPLATE, cashPrice: '29900.00', installmentBestchoicePrice: '29900.00', installmentFinancePrice: '29900.00' };
    lookup = (url) =>
      url.includes('256GB')
        ? new Promise((resolve) => {
            release = () => resolve({ data: TPL_256 });
          })
        : Promise.resolve({ data: TEMPLATE });
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    await screen.findByText(BADGE);
    const bc = screen.getByLabelText('ผ่อน BESTCHOICE');
    await user.clear(bc);
    await user.type(bc, '27000');
    await user.click(screen.getByRole('button', { name: '256GB' }));
    expect(await screen.findByText('กำลังโหลดราคากลาง…')).toBeInTheDocument();
    expect(screen.getByLabelText('เงินสด')).toHaveValue('');
    expect(bc).toHaveValue('27,000');
    const save = screen.getByRole('button', { name: 'บันทึกสินค้า' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(api.post).not.toHaveBeenCalled();
    release();
    expect(await screen.findByText('แก้ 1 ราคาจากตารางราคากลาง')).toBeInTheDocument();
    expect(screen.getByLabelText('เงินสด')).toHaveValue('29,900');
    expect(bc).toHaveValue('27,000');
    expect(screen.queryByText('กำลังโหลดราคากลาง…')).not.toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it('ตาราง GFIN ยังโหลดไม่เสร็จ → บันทึกไม่ได้ + บอกกำลังโหลด', async () => {
    gfinSettings = () => new Promise(() => {});
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    await screen.findByText(BADGE);
    expect(screen.getByText('กำลังโหลดราคากลาง…')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'บันทึกสินค้า' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('แท็บเล็ต → แถวผ่อน BESTCHOICE คิดดาวน์และค่างวดด้วย (ตั้งค่าดอกเบี้ยหมวด TABLET)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText('ประเภท *'), 'TABLET');
    await user.selectOptions(screen.getByLabelText('ยี่ห้อ *'), 'Apple');
    await pickComboOption(user, 'รุ่น *', 'iPad Pro 11" (M4)', { search: 'iPad Pro 11' });
    expect(await screen.findByText(paragraph('ดาวน์ 3,900 · ผ่อน 3,139 × 12 งวด'))).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/interest-configs/resolved?category=TABLET');
    expect(screen.queryByText(/ยังไม่มีตั้งค่าดอกเบี้ย/)).not.toBeInTheDocument();
  });

  it('ค้นราคากลางไม่สำเร็จ → "โหลดราคากลางไม่สำเร็จ — ลองใหม่" (ไม่ใช่ไม่พบรุ่น) · ช่องคงเดิม · ลองใหม่แล้วเติมช่องว่าง', async () => {
    let fail = true;
    lookup = async () => {
      if (fail) throw new Error('500');
      return { data: TEMPLATE };
    };
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    expect(await screen.findByText(paragraph('โหลดราคากลางไม่สำเร็จ — ลองใหม่'))).toBeInTheDocument();
    expect(screen.queryByText('ไม่พบรุ่นนี้ในตารางราคากลาง — กรอกราคาเอง')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('เงินสด'), '30000');
    expect(screen.getByRole('button', { name: 'บันทึกสินค้า' })).toBeEnabled();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await waitFor(() => expect(screen.getByLabelText('ผ่อน BESTCHOICE')).toHaveValue('25,900'));
    expect(screen.getByLabelText('เงินสด')).toHaveValue('30,000');
    expect(screen.queryByText(paragraph('โหลดราคากลางไม่สำเร็จ — ลองใหม่'))).not.toBeInTheDocument();
  });

  it('โหลดตั้งค่าดอกเบี้ยไม่สำเร็จ → บอกโหลดไม่สำเร็จ ไม่ใช่ "ยังไม่มีตั้งค่าดอกเบี้ย"', async () => {
    bcConfig = async () => {
      throw new Error('500');
    };
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    await screen.findByText(BADGE);
    expect(await screen.findByText(paragraph('โหลดตั้งค่าดอกเบี้ยไม่สำเร็จ — ลองใหม่'))).toBeInTheDocument();
    expect(screen.queryByText(/ยังไม่มีตั้งค่าดอกเบี้ย/)).not.toBeInTheDocument();
  });

  it('ตั้งค่าดอกเบี้ยมีแต่ไม่มีงวดที่มีอัตรา → "ยังไม่มีตั้งค่าดอกเบี้ยของหมวดนี้" ไม่ใช่ "กรอกราคาเพื่อดู…"', async () => {
    bcConfig = async () => ({ data: { ...BC_CONFIG, ratePctByMonths: {}, allowedMonths: [] } });
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    await screen.findByText(BADGE);
    expect(await screen.findByText('ยังไม่มีตั้งค่าดอกเบี้ยของหมวดนี้ — คิดค่างวดไม่ได้')).toBeInTheDocument();
    expect(screen.queryByText('กรอกราคาเพื่อดูดาวน์และค่างวด')).not.toBeInTheDocument();
  });

  it('โหลดตาราง GFIN ไม่สำเร็จ → ช่อง GFIN ปิด + ลองใหม่ · บันทึกได้ (ราคาขาย GFIN เป็น null) · ลองใหม่แล้วช่องกลับมา', async () => {
    let fail = true;
    gfinSettings = async () => {
      if (fail) throw new Error('500');
      return { data: GFIN_SETTINGS };
    };
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    await screen.findByText(BADGE);
    expect(await screen.findByText(paragraph('โหลดตาราง GFIN ไม่สำเร็จ — ลองใหม่'))).toBeInTheDocument();
    const finance = screen.getByLabelText('ผ่อน GFIN ราคาขาย');
    expect(finance).toBeDisabled();
    const save = screen.getByRole('button', { name: 'บันทึกสินค้า' });
    expect(save).toBeEnabled();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await waitFor(() => expect(screen.getByLabelText('ผ่อน GFIN ราคาขาย')).toBeEnabled());
    expect(screen.getByLabelText('ผ่อน GFIN ราคาขาย')).toHaveValue('25,900');
    expect(screen.queryByText(paragraph('โหลดตาราง GFIN ไม่สำเร็จ — ลองใหม่'))).not.toBeInTheDocument();
  });

  it('โหลดตาราง GFIN ไม่สำเร็จแล้วบันทึกเลย → ส่ง financePrice: null (ไม่ส่งราคากลางของรุ่นที่ GFIN อาจไม่รับ)', async () => {
    gfinSettings = async () => {
      throw new Error('500');
    };
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    await screen.findByText(BADGE);
    await screen.findByText(paragraph('โหลดตาราง GFIN ไม่สำเร็จ — ลองใหม่'));
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ cashPrice: 25900, installmentPrice: 25900, financePrice: null });
  });

  it('สลับเข้า/ออกอุปกรณ์เสริม → ล้างราคาที่กรอกไว้', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('เงินสด'), '12345');
    await user.selectOptions(screen.getByLabelText('ประเภท *'), 'ACCESSORY');
    expect(screen.getByLabelText('ราคาขาย')).toHaveValue('');
    await user.type(screen.getByLabelText('ราคาขาย'), '290');
    await user.selectOptions(screen.getByLabelText('ประเภท *'), 'PHONE_NEW');
    expect(screen.getByLabelText('เงินสด')).toHaveValue('');
  });
});
