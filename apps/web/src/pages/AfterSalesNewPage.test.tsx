import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import AfterSalesNewPage from './AfterSalesNewPage';
import type { LookupResult } from './after-sales/after-sales';

const auth = vi.hoisted(() => ({
  user: { id: 'u-sales', role: 'SALES', branchId: 'br-1' as string | null },
}));
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post },
  getErrorMessage: (error: Error) => error.message,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const IMEI = '356812345674412';

const foundResult: LookupResult = {
  found: true,
  source: 'INSTALLMENT_CONTRACT',
  product: {
    id: 'p1',
    brand: 'Apple',
    model: 'iPhone 13',
    storage: '128GB',
    imeiSerial: IMEI,
  },
  customer: { id: 'c1', name: 'คุณสมชาย ทดสอบ', phone: '0811112222' },
  contract: { id: 'ct1', contractNumber: 'CT-0001', status: 'ACTIVE' },
  sale: null,
  warranty: {
    status: 'IN_7DAY_DEFECT',
    daysRemainingIn7Day: 4,
    purchasedAt: '2026-09-20T00:00:00.000Z',
    shopWarrantyEndDate: '2027-09-20T00:00:00.000Z',
    manufacturerWarrantyEndDate: null,
    checkedAt: '2026-09-24T00:00:00.000Z',
  },
  purchasePhotos: {
    front: 'data:x',
    back: 'data:x',
    left: null,
    right: null,
    top: null,
    bottom: null,
  },
  openCase: null,
  outcomes: [
    { outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'SHOP' },
    {
      outcome: 'SAME_MODEL_EXCHANGE',
      enabled: true,
      implemented: false,
      note: 'เปลี่ยนรุ่นเดิมให้ลูกค้าทันที',
    },
    {
      outcome: 'PRICED_EXCHANGE',
      enabled: false,
      implemented: false,
      reason: 'ต้องผ่อนมาแล้วอย่างน้อย 3 งวด',
    },
  ],
};

const notFoundResult: LookupResult = {
  found: false,
  source: 'WALK_IN',
  product: null,
  customer: null,
  contract: null,
  sale: null,
  warranty: {
    status: 'WALK_IN',
    daysRemainingIn7Day: 0,
    purchasedAt: null,
    shopWarrantyEndDate: null,
    manufacturerWarrantyEndDate: null,
    checkedAt: '2026-09-24T00:00:00.000Z',
  },
  purchasePhotos: null,
  openCase: null,
  outcomes: [{ outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'CUSTOMER' }],
};

function mockGet(lookup: LookupResult) {
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/after-sales/lookup') return { data: lookup };
    if (url === '/branches') return { data: [{ id: 'branch-1', name: 'ลาดพร้าว' }] };
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderPage(initialPath: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/after-sales/new" element={<AfterSalesNewPage />} />
          <Route path="/after-sales/:id" element={<div>CASE PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u-sales', role: 'SALES', branchId: 'br-1' };
});

describe('AfterSalesNewPage — แจ้งปัญหาเครื่อง (3 ขั้นในหน้าเดียว)', () => {
  it('พบเครื่อง (สัญญาผ่อน ≤7 วัน): เห็นการ์ดขั้น 1 (ชื่อลูกค้า, ลูกค้ารับเครื่องไปเมื่อ, รูปตอนซื้อ 2 รูป) + ปุ่มทางออก 3 ปุ่ม + สรุปก่อนบันทึก', async () => {
    mockGet(foundResult);
    renderPage(`/after-sales/new?imei=${IMEI}`);

    expect(await screen.findByText('คุณสมชาย ทดสอบ')).toBeInTheDocument();
    expect(screen.getByText(/ลูกค้ารับเครื่องไปเมื่อ/)).toBeInTheDocument();
    expect(screen.getByText(/รูปตอนซื้อ — 6 มุม/)).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);

    expect(screen.getByRole('button', { name: /^ซ่อม/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /เปลี่ยนรุ่นเดิม/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /เปลี่ยนแบบมีราคา/ })).toBeInTheDocument();

    expect(screen.getByText('สรุปก่อนบันทึก')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกและเปิดเคส' })).toBeInTheDocument();
  });

  it('กดบันทึกโดยไม่มีรูป → toast error "ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป" และไม่เรียก API', async () => {
    mockGet(foundResult);
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    await userEvent.click(screen.getByRole('button', { name: 'บันทึกและเปิดเคส' }));

    expect(toast.error).toHaveBeenCalledWith('ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('ใส่อาการ ≥5 ตัว + แนบรูป 1 + ติ๊กปลดล็อก → POST /after-sales แบบ multipart ครบฟิลด์ + toast.success + ไปหน้าเคส', async () => {
    mockGet(foundResult);
    mocks.post.mockResolvedValue({
      data: { id: 'case-9', caseNumber: 'AS-20260924-0001', repairTicketId: 'rt-1' },
    });
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    await userEvent.type(screen.getByLabelText(/อาการที่ลูกค้าแจ้ง/), 'จอแตกมุมขวาบน');
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText(/ถ่ายเพิ่ม/), file);
    await userEvent.click(screen.getByRole('checkbox', { name: /ปิด Find My/ }));

    await userEvent.click(screen.getByRole('button', { name: 'บันทึกและเปิดเคส' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [url, form, config] = mocks.post.mock.calls[0];
    expect(url).toBe('/after-sales');
    expect(config).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } });
    const data = form as FormData;
    expect(data.get('outcome')).toBe('REPAIR');
    expect(data.get('imei')).toBe(IMEI);
    expect(data.get('branchId')).toBe('br-1');
    expect(data.get('symptom')).toBe('จอแตกมุมขวาบน');
    expect(data.get('unlockConfirmed')).toBe('true');
    expect(data.getAll('photos')).toHaveLength(1);
    expect((data.getAll('photos')[0] as File).name).toBe('a.jpg');

    expect(toast.success).toHaveBeenCalled();
    expect(await screen.findByText('CASE PAGE')).toBeInTheDocument();
  });

  it('lookup ไม่พบเครื่อง (walk-in): เห็น ContactCombobox + ช่องยี่ห้อ/รุ่น + ปุ่มทางออกมีแค่ "ซ่อม" (ลูกค้าจ่าย)', async () => {
    mockGet(notFoundResult);
    renderPage(`/after-sales/new?imei=${IMEI}`);

    // มี combobox 2 ตัวพร้อมกัน (ลูกค้า + ศูนย์ซ่อมของ OutcomePicker REPAIR ที่เลือกอัตโนมัติ)
    // — placeholder ของ ContactCombobox ตัวลูกค้าไม่ซ้ำใครในหน้านี้
    expect(await screen.findByText('เลือก/ค้นหาผู้ติดต่อ')).toBeInTheDocument();
    expect(screen.getByLabelText('ยี่ห้อ')).toBeInTheDocument();
    expect(screen.getByLabelText('รุ่น')).toBeInTheDocument();

    const outcomeButtons = screen.getAllByRole('button', { name: /^ซ่อม/ });
    expect(outcomeButtons).toHaveLength(1);
    expect(outcomeButtons[0]).toHaveTextContent('ลูกค้าจ่าย');
    expect(screen.queryByRole('button', { name: /เปลี่ยนรุ่นเดิม/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /เปลี่ยนแบบมีราคา/ })).not.toBeInTheDocument();
  });
});
