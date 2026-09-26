import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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
  // Task 8 — ลูกค้าคนนี้ผูก LINE ไว้แล้ว (เคสทั่วไปในเทสต์ชุดนี้)
  lineLinked: true,
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
  // Task 10 — API (Tasks 1-8 บนสาขานี้) คืน implemented: true ให้ทั้งสองทางออกเปลี่ยนเครื่องแล้ว
  // เมื่อสัญญาอยู่ในกรอบ 7 วัน (คงเดิมเฉพาะ CASH — ดู cashSaleResult ด้านล่าง)
  outcomes: [
    { outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'SHOP' },
    {
      outcome: 'SAME_MODEL_EXCHANGE',
      enabled: true,
      implemented: true,
      note: 'ผจก.สาขา ต้องยืนยัน',
    },
    {
      outcome: 'PRICED_EXCHANGE',
      enabled: true,
      implemented: true,
      note: 'มีขั้นอนุมัติตามราคารับซื้อ',
    },
  ],
};

// (a)/(b) — สัญญาที่ยืนยันเปลี่ยนรุ่นเดิมได้แต่ "นอกกรอบ 7 วัน" (managerUp branch ของ
// computeOutcomes) เพื่อทดสอบข้อความ "ข้ามกรอบ 7 วัน" แยกจาก foundResult (ในกรอบ)
const outOfWindowResult: LookupResult = {
  ...foundResult,
  outcomes: [
    foundResult.outcomes[0],
    {
      outcome: 'SAME_MODEL_EXCHANGE',
      enabled: true,
      implemented: true,
      note: 'ข้ามกรอบ 7 วัน — ผจก. ต้องยืนยัน',
    },
    foundResult.outcomes[2],
  ],
};

// (e) — เครื่องมาจากการขายสด: "เปลี่ยนรุ่นเดิม (ขายสด)" enabled=false/implemented=false เสมอ
// ในรอบนี้ (ไม่เปลี่ยนจาก PR 1) พร้อม reason จาก API
const cashSaleResult: LookupResult = {
  ...foundResult,
  source: 'CASH_SALE',
  contract: null,
  sale: { id: 'sale-1', saleType: 'CASH' },
  outcomes: [
    { outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'CUSTOMER' },
    {
      outcome: 'CASH_SAME_MODEL_EXCHANGE',
      enabled: false,
      implemented: false,
      reason: 'เกินกรอบ 7 วันแล้ว',
    },
  ],
};

const twoReplacementProducts = [
  {
    id: 'rp-1',
    brand: 'Apple',
    model: 'iPhone 13',
    storage: '128GB',
    color: 'ดำ',
    imeiSerial: '111222333',
    cashPrice: '15000.00',
    branchId: 'branch-1',
  },
  {
    id: 'rp-2',
    brand: 'Apple',
    model: 'iPhone 13',
    storage: '128GB',
    color: 'ขาว',
    imeiSerial: '444555666',
    cashPrice: '15500.00',
    branchId: 'branch-1',
  },
];

const pricedReplacementProducts = [
  {
    id: 'rp-9',
    brand: 'Samsung',
    model: 'Galaxy S23',
    storage: '256GB',
    color: null,
    imeiSerial: '999888777',
    cashPrice: '20000.00',
    branchId: 'branch-1',
  },
];

const previewReview = {
  mode: 'PRICED' as const,
  tier: 'REVIEW' as const,
  ncv: '9000.00',
  marketMin: '8000.00',
  expectedPl: '500.00',
  blockers: { overdueBlocked: false, advanceBlocked: false },
  hasUnpaidLateFee: false,
  plan: null,
};

const notFoundResult: LookupResult = {
  found: false,
  source: 'WALK_IN',
  // Task 8 — walk-in ไม่มีลูกค้าให้ผูก LINE เลย
  lineLinked: false,
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

interface MockExtras {
  replacementProducts?: unknown;
  preview?: unknown;
}

function mockGet(lookup: LookupResult, extra?: MockExtras) {
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/after-sales/lookup') return { data: lookup };
    if (url === '/branches') return { data: [{ id: 'branch-1', name: 'ลาดพร้าว' }] };
    if (url === '/after-sales/replacement-products' && extra?.replacementProducts !== undefined) {
      return { data: extra.replacementProducts };
    }
    if (url === '/after-sales/exchange/preview' && extra?.preview !== undefined) {
      return { data: extra.preview };
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

function CaseProbe() {
  const location = useLocation();
  return (
    <>
      <div>CASE PAGE</div>
      <div data-testid="case-search">{location.search}</div>
    </>
  );
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
          <Route path="/after-sales/:id" element={<CaseProbe />} />
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

  it('Task 8: พบเครื่อง + ลูกค้าผูก LINE (lineLinked=true) → สรุปก่อนบันทึกมี "จะส่ง LINE แจ้งลูกค้าเมื่อบันทึก"', async () => {
    mockGet(foundResult);
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    expect(screen.getByText(/จะส่ง LINE แจ้งลูกค้าเมื่อบันทึก/)).toBeInTheDocument();
    expect(screen.queryByText(/ลูกค้าไม่ผูก LINE/)).not.toBeInTheDocument();
  });

  it('Task 8: walk-in ไม่มีลูกค้า (lineLinked=false) → สรุปก่อนบันทึกมี "ลูกค้าไม่ผูก LINE — โทรแจ้งเอง"', async () => {
    mockGet(notFoundResult);
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('สรุปก่อนบันทึก');

    expect(screen.getByText(/ลูกค้าไม่ผูก LINE — โทรแจ้งเอง/)).toBeInTheDocument();
    expect(screen.queryByText(/จะส่ง LINE แจ้งลูกค้าเมื่อบันทึก/)).not.toBeInTheDocument();
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
    expect(screen.getByTestId('case-search')).toBeEmptyDOMElement();
  });

  it('ปุ่มรอง "บันทึก + พิมพ์ใบรับฝาก" → POST เดียวกัน แล้วไปหน้าเคสพร้อม ?print=receipt · ปุ่มหลักไปแบบไม่มีพารามิเตอร์', async () => {
    mockGet(foundResult);
    mocks.post.mockResolvedValue({
      data: { id: 'case-9', caseNumber: 'AS-20260924-0001', repairTicketId: 'rt-1' },
    });
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');
    await userEvent.type(screen.getByLabelText(/อาการที่ลูกค้าแจ้ง/), 'จอแตกมุมขวาบน');
    await userEvent.upload(
      screen.getByLabelText(/ถ่ายเพิ่ม/),
      new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /ปิด Find My/ }));

    await userEvent.click(screen.getByRole('button', { name: 'บันทึก + พิมพ์ใบรับฝาก' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0][0]).toBe('/after-sales');
    expect(await screen.findByTestId('case-search')).toHaveTextContent('?print=receipt');
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

  it('มี openCase ในผล lookup: แสดงคำเตือน + เลขเคส + ลิงก์ไปเคสนั้น และปุ่ม "บันทึกและเปิดเคส" ถูกปิด', async () => {
    mockGet({
      ...foundResult,
      openCase: { id: 'as-9', caseNumber: 'AS-20260901-0009', stage: 'IN_REPAIR' },
    });
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    expect(
      await screen.findByText(/เครื่องนี้มีเคสที่ยังไม่ปิด AS-20260901-0009/),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'เปิดดูเคสนี้' });
    expect(link).toHaveAttribute('href', '/after-sales/as-9');
    expect(screen.getByRole('button', { name: 'บันทึกและเปิดเคส' })).toBeDisabled();
  });

  it('(a) เปลี่ยนรุ่นเดิม (ในกรอบ 7 วัน): เลือกเครื่องทดแทน → สรุปมีข้อความ "รอ ผจก.สาขา ยืนยัน" + submit multipart มี replacementProductId ไม่มี payer/repairSupplierId', async () => {
    mockGet(foundResult, { replacementProducts: twoReplacementProducts });
    mocks.post.mockResolvedValue({
      data: { id: 'case-10', caseNumber: 'AS-20260924-0002', repairTicketId: null },
    });
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    await userEvent.type(screen.getByLabelText(/อาการที่ลูกค้าแจ้ง/), 'จอแตกทั้งแผ่น');
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText(/ถ่ายเพิ่ม/), file);

    await userEvent.click(screen.getByRole('button', { name: /^เปลี่ยนรุ่นเดิม/ }));

    // sameModel=true ต้องถูกส่งไปเป็น '1' ตามสเปกอินเทอร์เฟซของ picker
    await waitFor(() => {
      const call = mocks.get.mock.calls.find(
        ([url]) => url === '/after-sales/replacement-products',
      );
      expect(call?.[1]?.params).toEqual({ imei: IMEI, sameModel: '1' });
    });

    const cards = await screen.findAllByRole('button', { name: /Apple iPhone 13/ });
    expect(cards).toHaveLength(2);
    // "ข้ามกรอบ 7 วัน" ไม่ควรโผล่ในเคสนี้ (สัญญาอยู่ในกรอบ — option.note = 'ผจก.สาขา ต้องยืนยัน')
    expect(screen.queryByText(/ข้ามกรอบ 7 วัน/)).not.toBeInTheDocument();
    expect(
      screen.getByText('ผจก.สาขา ต้องยืนยันก่อนเปลี่ยน · ราคาเท่าเดิม ไม่มีเงินเปลี่ยนมือ'),
    ).toBeInTheDocument();
    await userEvent.click(cards[0]);

    expect(
      screen.getByText(/ทางออก "เปลี่ยนรุ่นเดิม" · รอ ผจก\.สาขา ยืนยัน · เครื่องทดแทน/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกและเปิดเคส' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'บันทึกและเปิดเคส' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [, form] = mocks.post.mock.calls[0];
    const data = form as FormData;
    expect(data.get('outcome')).toBe('SAME_MODEL_EXCHANGE');
    expect(data.get('replacementProductId')).toBe('rp-1');
    expect(data.has('payer')).toBe(false);
    expect(data.has('repairSupplierId')).toBe(false);
  });

  it('(a2) เปลี่ยนรุ่นเดิมนอกกรอบ 7 วัน: กล่องข้อความเพิ่ม "ข้ามกรอบ 7 วัน — ต้องให้ ผจก. ยืนยัน"', async () => {
    mockGet(outOfWindowResult, { replacementProducts: twoReplacementProducts });
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    await userEvent.click(screen.getByRole('button', { name: /^เปลี่ยนรุ่นเดิม/ }));

    expect(await screen.findByText('ข้ามกรอบ 7 วัน — ต้องให้ ผจก. ยืนยัน')).toBeInTheDocument();
  });

  it('(b) เปลี่ยนรุ่นเดิมแต่ยังไม่เลือกเครื่องทดแทน → ปุ่มบันทึกปิด + ข้อความใต้ปุ่ม', async () => {
    mockGet(foundResult, { replacementProducts: twoReplacementProducts });
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    await userEvent.click(screen.getByRole('button', { name: /^เปลี่ยนรุ่นเดิม/ }));
    await screen.findAllByRole('button', { name: /Apple iPhone 13/ });

    expect(screen.getByRole('button', { name: 'บันทึกและเปิดเคส' })).toBeDisabled();
    expect(screen.getByText('ต้องเลือกเครื่องทดแทนก่อนบันทึก')).toBeInTheDocument();
  });

  it('(c) เปลี่ยนแบบมีราคา: เลือกเครื่องทดแทน (sameModel=0) + กรอกฟอร์ม → ป้าย "ผจก.สาขาอนุมัติ" (tier REVIEW) + submit มีฟิลด์ราคาครบ (rate = pct/100)', async () => {
    mockGet(foundResult, {
      replacementProducts: pricedReplacementProducts,
      preview: previewReview,
    });
    mocks.post.mockResolvedValue({
      data: { id: 'case-11', caseNumber: 'AS-20260924-0003', repairTicketId: null },
    });
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    await userEvent.type(screen.getByLabelText(/อาการที่ลูกค้าแจ้ง/), 'จอแตกทั้งแผ่น');
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText(/ถ่ายเพิ่ม/), file);

    await userEvent.click(screen.getByRole('button', { name: /^เปลี่ยนแบบมีราคา/ }));

    const card = await screen.findByRole('button', { name: /Samsung Galaxy S23/ });
    await waitFor(() => {
      const call = mocks.get.mock.calls.find(
        ([url]) => url === '/after-sales/replacement-products',
      );
      expect(call?.[1]?.params).toEqual({ imei: IMEI, sameModel: '0' });
    });
    await userEvent.click(card);

    await userEvent.type(screen.getByLabelText(/ราคารับซื้อเครื่องเดิม/), '9500');
    await userEvent.clear(screen.getByLabelText(/จำนวนงวดสัญญาใหม่/));
    await userEvent.type(screen.getByLabelText(/จำนวนงวดสัญญาใหม่/), '10');
    await userEvent.type(screen.getByLabelText(/อัตราดอกเบี้ย/), '8');

    expect(await screen.findByText('ผจก.สาขาอนุมัติ')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'บันทึกและเปิดเคส' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [, form] = mocks.post.mock.calls[0];
    const data = form as FormData;
    expect(data.get('outcome')).toBe('PRICED_EXCHANGE');
    expect(data.get('replacementProductId')).toBe('rp-9');
    expect(data.get('buybackPrice')).toBe('9500');
    expect(data.get('deviceCondition')).toBe('B');
    expect(data.get('newTotalMonths')).toBe('10');
    expect(data.get('newInterestRate')).toBe('0.08');
  });

  it('(d) preview บอก overdueBlocked → ปุ่มบันทึกปิด + ข้อความเหตุผล', async () => {
    mockGet(foundResult, {
      replacementProducts: pricedReplacementProducts,
      preview: { ...previewReview, blockers: { overdueBlocked: true, advanceBlocked: false } },
    });
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    await userEvent.click(screen.getByRole('button', { name: /^เปลี่ยนแบบมีราคา/ }));
    const card = await screen.findByRole('button', { name: /Samsung Galaxy S23/ });
    await userEvent.click(card);

    expect(await screen.findByText(/มีงวดค้างชำระ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกและเปิดเคส' })).toBeDisabled();
    expect(
      screen.getByText('มีรายการค้างที่ต้องแก้ก่อนเปลี่ยนเครื่อง — ดูเหตุผลด้านบน'),
    ).toBeInTheDocument();
  });

  it('(c2) เปลี่ยนแบบมีราคา + mode MEMO (รุ่นเดิม+ราคาเดิม): submit ไม่มี buybackPrice/deviceCondition/newTotalMonths/newInterestRate', async () => {
    mockGet(foundResult, {
      replacementProducts: pricedReplacementProducts,
      preview: {
        mode: 'MEMO',
        tier: null,
        ncv: '9000.00',
        marketMin: null,
        expectedPl: null,
        blockers: { overdueBlocked: false, advanceBlocked: false },
        hasUnpaidLateFee: false,
        plan: null,
      },
    });
    mocks.post.mockResolvedValue({
      data: { id: 'case-12', caseNumber: 'AS-20260924-0004', repairTicketId: null },
    });
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    await userEvent.type(screen.getByLabelText(/อาการที่ลูกค้าแจ้ง/), 'จอแตกทั้งแผ่น');
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText(/ถ่ายเพิ่ม/), file);

    await userEvent.click(screen.getByRole('button', { name: /^เปลี่ยนแบบมีราคา/ }));
    const card = await screen.findByRole('button', { name: /Samsung Galaxy S23/ });
    await userEvent.click(card);

    expect(await screen.findByText('ราคาเท่าเดิม (MEMO)')).toBeInTheDocument();
    expect(screen.queryByLabelText(/ราคารับซื้อเครื่องเดิม/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'บันทึกและเปิดเคส' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [, form] = mocks.post.mock.calls[0];
    const data = form as FormData;
    expect(data.get('outcome')).toBe('PRICED_EXCHANGE');
    expect(data.get('replacementProductId')).toBe('rp-9');
    expect(data.has('buybackPrice')).toBe(false);
    expect(data.has('deviceCondition')).toBe(false);
    expect(data.has('newTotalMonths')).toBe(false);
    expect(data.has('newInterestRate')).toBe(false);
  });

  it('(e) เครื่องมาจากขายสด: ปุ่ม "เปลี่ยนรุ่นเดิม (ขายสด)" ปิดพร้อม reason จาก API (ไม่เปลี่ยนจาก PR 1)', async () => {
    mockGet(cashSaleResult);
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');

    const button = screen.getByRole('button', { name: /เปลี่ยนรุ่นเดิม/ });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('เกินกรอบ 7 วันแล้ว');
  });
});
