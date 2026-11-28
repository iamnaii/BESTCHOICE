import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StickerPrintPage from './index';
import type { StockProduct } from '@/pages/StockPage/types';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: () => 'โหลดไม่สำเร็จ',
}));

// ตารางดอกเบี้ยชุดเดียวกับที่ใช้ render หน้ารายการสินค้า/หน้าสินค้า — 19,900 → ดาวน์ 3,000 · 1,838.43 × 12
const bcConfig = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 12: 0.12 },
  allowedMonths: [12],
};
// ตาราง GFIN: iPhone 15 128GB มือ 1 ราคาส่ง 23,000 + OVER 1,000 → ดาวน์จริง 1,900 · 3,327 × 12 (ตรงหน้าสินค้า)
const gfin = {
  maxPrices: [
    { id: 'm1', gfinSeries: 'iPhone 15', gfinVariant: null, storage: '128GB', condition: 'HAND_1', maxPrice: '23000', modelMatchPattern: 'iPhone 15', isActive: true },
  ],
  rules: [
    { id: 'r1', label: 'iPhone 15 มือ 1', seriesPattern: 'iPhone 15', condition: 'HAND_1', allowance: '1000', maxMonths: 12, isActive: true },
  ],
  factors: [
    { id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.179238', feePerInstallment: '100', isActive: true },
  ],
  settings: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } },
};

function product(overrides: Partial<StockProduct>): StockProduct {
  return {
    id: 'p1',
    name: 'Apple iPhone 15 128GB Black',
    brand: 'Apple',
    model: 'iPhone 15',
    imeiSerial: '351000000007919',
    category: 'PHONE_NEW',
    deviceOrigin: 'THAI',
    costPrice: '15920',
    cashPrice: '19900',
    installmentPrice: '19900',
    status: 'IN_STOCK',
    color: 'ดำ',
    storage: '128GB',
    batteryHealth: null,
    hasBox: true,
    warrantyExpired: false,
    warrantyExpireDate: '2027-08-27T00:00:00.000Z',
    stockInDate: '2026-08-11T03:00:00.000Z',
    branch: { id: 'b1', name: 'ลพบุรี' },
    supplier: null,
    prices: [{ id: 'pr1', label: 'ราคาเงินสด', amount: '19900', isDefault: true }],
    ...overrides,
  };
}

// เรียงจากรับเข้าใหม่ → เก่า ตามที่ API ส่งกลับ (mock ไม่เรียงเอง — หน้าต้องขอ sortBy ให้ถูก)
const ROWS: StockProduct[] = [
  product({ id: 'p17', name: 'Apple iPhone 17 256GB', model: 'iPhone 17', imeiSerial: '351000000047514', color: 'ฟ้า', storage: '256GB', cashPrice: '31900', installmentPrice: '31900', stockInDate: '2026-09-15T03:00:00.000Z', prices: [], branch: { id: 'b2', name: 'สระบุรี' } }),
  product({}),
  product({ id: 's24', name: 'Samsung Galaxy S24 256GB', brand: 'Samsung', model: 'Galaxy S24', imeiSerial: '351000000055433', category: 'PHONE_USED', color: 'ม่วง', storage: '256GB', cashPrice: '14900', installmentPrice: '14900', batteryHealth: 91, hasBox: true, warrantyExpireDate: '2027-03-12T00:00:00.000Z', stockInDate: '2026-08-17T03:00:00.000Z', prices: [] }),
  product({ id: 'p14', name: 'Apple iPhone 14 128GB Blue', model: 'iPhone 14', imeiSerial: '351000000110866', category: 'PHONE_USED', color: 'น้ำเงิน', cashPrice: null, installmentPrice: null, prices: [], batteryHealth: 89, hasBox: false, stockInDate: '2026-09-10T03:00:00.000Z' }),
];

function toStickerData(row: StockProduct) {
  return {
    productId: row.id,
    name: row.name,
    brand: row.brand,
    model: row.model,
    category: row.category,
    status: row.status,
    color: row.color,
    storage: row.storage,
    deviceOrigin: row.deviceOrigin ?? null,
    batteryHealth: row.batteryHealth ?? null,
    hasBox: row.hasBox ?? null,
    warrantyExpireDate: row.warrantyExpireDate ? row.warrantyExpireDate.slice(0, 10) : null,
    imei: row.imeiSerial,
    stockInDate: row.stockInDate ?? null,
    cashPrice: row.cashPrice,
    installmentPrice: row.installmentPrice,
    prices: row.prices,
    templateTerms: termsById[row.id] ?? null,
  };
}

// เงื่อนไขผ่อนของราคากลางต่อเครื่อง (API แนบมากับข้อมูลสติกเกอร์) — ค่าเริ่มต้น: ไม่มีราคากลาง
let termsById: Record<string, unknown> = {};

// ธงจาก GET /settings/ui-flags — ค่าเริ่มต้น {} = เซิร์ฟเวอร์รุ่นก่อนที่ยังไม่ส่ง stickerSize/stickerShowQr
let uiFlags: Record<string, unknown> = {};

function mockApi() {
  mocks.get.mockImplementation(async (url: string, options?: { params?: Record<string, unknown> }) => {
    if (url === '/settings/ui-flags') return { data: uiFlags };
    if (url === '/products') return { data: { data: ROWS, total: 132, page: options?.params?.page ?? 1, totalPages: 7 } };
    if (url === '/products/brands') return { data: ['Apple', 'Samsung'] };
    if (url.startsWith('/sticker-templates/products/data')) {
      const ids = decodeURIComponent(url.split('ids=')[1] ?? '').split(',');
      const found = ids
        .map((key) => ROWS.find((row) => row.id === key || row.imeiSerial === key))
        .filter((row): row is StockProduct => !!row);
      return { data: [...new Map(found.map((row) => [row.id, toStickerData(row)])).values()] };
    }
    if (url.startsWith('/interest-configs/resolved')) return { data: bcConfig };
    if (url === '/gfin-config/max-prices') return { data: gfin.maxPrices };
    if (url === '/gfin-config/overprice-rules') return { data: gfin.rules };
    if (url === '/gfin-config/rate-factors') return { data: gfin.factors };
    if (url === '/gfin-config/settings') return { data: gfin.settings };
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderPage(path = '/stickers') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <StickerPrintPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const stockCalls = () => mocks.get.mock.calls.filter(([url]) => url === '/products');
const lastStockParams = () => {
  const calls = stockCalls();
  return calls[calls.length - 1]?.[1];
};

beforeEach(() => {
  mocks.get.mockReset();
  uiFlags = {};
  termsById = {};
  mockApi();
  window.localStorage.clear();
});

const pageStyles = () =>
  Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');

describe('หน้าพิมพ์สติกเกอร์ — ตารางเลือกเครื่อง', () => {
  it('ขอสินค้าพร้อมขายเรียงตามวันที่รับเข้า ใหม่ → เก่า เป็นค่าเริ่มต้น และแต่ละแถวมีแค่ข้อมูลที่ใช้หาเครื่อง', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('iPhone 17')).toBeInTheDocument());
    expect(stockCalls()[0][1]).toEqual({
      params: { status: 'IN_STOCK', page: 1, limit: 20, sortBy: 'stockInDate', sortDirection: 'desc' },
    });

    const table = screen.getByTestId('data-table');
    // แถว iPhone 15: รุ่น · สี/ความจุ · IMEI เต็ม · วันที่รับเข้า · เงินสด
    const row = within(table).getByText('351000000007919').closest('tr')!;
    expect(within(row).getByText('iPhone 15')).toBeInTheDocument();
    expect(within(row).getByText('ดำ · 128GB')).toBeInTheDocument();
    expect(within(row).getByText('11 ส.ค. 69')).toBeInTheDocument();
    expect(within(row).getByText('19,900')).toBeInTheDocument();
    // ค่างวด/ประกันไม่อยู่ในตารางแล้ว — ดูที่ตัวอย่างดวงในคิว (ตารางไม่คำนวณค่างวดเลย)
    expect(within(row).queryByText(/ดาวน์/)).not.toBeInTheDocument();
    expect(within(row).queryByText('27/08/27')).not.toBeInTheDocument();
    expect(mocks.get.mock.calls.some(([url]) => String(url).startsWith('/gfin-config'))).toBe(false);

    // มือสอง: ป้าย "มือสอง" · มือ 1 ไม่มีป้าย
    const used = within(table).getByText('351000000055433').closest('tr')!;
    expect(within(used).getByText('มือสอง')).toBeInTheDocument();
    expect(within(row).queryByText('มือ 1')).not.toBeInTheDocument();

    // ยังไม่ตั้งราคา
    const noPrice = within(table).getByText('351000000110866').closest('tr')!;
    expect(within(noPrice).getByText('ยังไม่ตั้งราคา')).toBeInTheDocument();
  });

  it('เลือกยี่ห้อจากช่องเลือกแล้วส่ง brand ไปกับคำขอ (กลับไปหน้า 1)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('iPhone 17')).toBeInTheDocument());

    fireEvent.change(await screen.findByRole('combobox', { name: 'ยี่ห้อ' }), { target: { value: 'Samsung' } });

    await waitFor(() =>
      expect(lastStockParams()).toEqual({
        params: { status: 'IN_STOCK', page: 1, limit: 20, sortBy: 'stockInDate', sortDirection: 'desc', brand: 'Samsung' },
      }),
    );
  });

  it('กดหัวคอลัมน์ "เงินสด" แล้วขอเรียงใหม่จากเซิร์ฟเวอร์', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('iPhone 17')).toBeInTheDocument());

    fireEvent.click(screen.getByText('เงินสด'));

    await waitFor(() =>
      expect(lastStockParams()).toEqual({
        params: { status: 'IN_STOCK', page: 1, limit: 20, sortBy: 'cashPrice', sortDirection: 'asc' },
      }),
    );
  });

  it('พิมพ์คำค้นแล้วส่ง search ไปกับคำขอ (กลับไปหน้า 1)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('iPhone 17')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: 'ค้นหารุ่น หรือ IMEI ในสต็อก' }), {
      target: { value: 'S24' },
    });

    await waitFor(() =>
      expect(lastStockParams()).toEqual({
        params: { status: 'IN_STOCK', page: 1, limit: 20, sortBy: 'stockInDate', sortDirection: 'desc', search: 'S24' },
      }),
    );
  });
});

describe('หน้าพิมพ์สติกเกอร์ — ค่าตั้งต้นจากราคากลาง (ตัวเลขเดียวกับหน้าราคาและบอท)', () => {
  it('ราคากลางตั้งดาวน์เรท 1 (ราคาผ่อนเท่าราคากลาง) → ดวงใช้ดาวน์ของราคากลาง', async () => {
    termsById = { p1: { bcPrice: '19900', rate1TermMonths: 12, rate1DownPayment: '5000', rate2TermMonths: null } };
    renderPage('/stickers?productIds=p1');

    const preview = await screen.findByTestId('sticker-preview');
    await waitFor(() => expect(within(preview).getByText('ดาวน์ 5,000')).toBeInTheDocument());
    const printSet = screen.getByTestId('print-set');
    expect(within(within(printSet).getAllByTestId('sticker')[0]).getByText('ดาวน์ 5,000')).toBeInTheDocument();
  });
});

describe('หน้าพิมพ์สติกเกอร์ — คิวพิมพ์และดวงที่พิมพ์', () => {
  it('รับ productIds จาก URL → ดวงพิมพ์ใช้ข้อมูลจากตัวเครื่อง (รุ่นอย่างเดียว ประกันศูนย์ ชิปมือสอง) และข้ามเครื่องที่ไม่มีราคา', async () => {
    renderPage('/stickers?productIds=p1,s24,p14');

    // ชุดพิมพ์จริง: p1 + s24 — p14 ไม่มีราคา ไม่พิมพ์ · ตัวอย่างโชว์ทีละดวง (ดวงแรกที่พิมพ์ได้)
    const printSet = screen.getByTestId('print-set');
    await waitFor(() => expect(within(printSet).getAllByTestId('sticker')).toHaveLength(2));
    const preview = screen.getByTestId('sticker-preview');
    expect(within(preview).getAllByTestId('sticker')).toHaveLength(1);
    expect(within(preview).getByText('iPhone 15')).toBeInTheDocument();
    const stickers = within(printSet).getAllByTestId('sticker');
    const first = stickers[0];
    expect(within(first).getByText('iPhone 15')).toBeInTheDocument();
    expect(within(first).queryByText(/apple/i)).not.toBeInTheDocument();
    expect(within(first).getByText('ประกันศูนย์ 27/08/27')).toBeInTheDocument();
    expect(within(first).getByText('19,900')).toBeInTheDocument();
    expect(within(first).getByText('351000000007919')).toBeInTheDocument();
    // แบบ ค (22/10): ชื่อร้านท้ายดวง + QR ของ IMEI · เซิร์ฟเวอร์ไม่ส่งธง = 60×40 + QR เปิด
    expect(within(first).getByText('BESTCHOICE')).toBeInTheDocument();
    expect(within(first).getByTestId('sticker-qr').querySelector('svg')).not.toBeNull();
    expect(first).toHaveClass('sticker--60x40');
    expect(pageStyles()).toContain('@page { size: 60mm 40mm; margin: 0; }');
    await waitFor(() => expect(within(first).getByText('ดาวน์ 3,000')).toBeInTheDocument());

    const used = stickers[1];
    expect(within(used).getByText('แบต 91%')).toBeInTheDocument();
    expect(within(used).getByText('มีกล่อง')).toBeInTheDocument();
    expect(within(used).getByText('ประกันศูนย์ 12/03/27')).toBeInTheDocument();

    // คิว: เครื่องไม่มีราคาถูกเตือน และปุ่มพิมพ์นับเฉพาะดวงที่พิมพ์ได้
    expect(screen.getByText('ยังไม่ตั้งราคา — ไม่พิมพ์')).toBeInTheDocument();
    const printButton = screen.getByRole('button', { name: /พิมพ์สติกเกอร์/ });
    expect(printButton).toHaveTextContent('2 ดวง');
    expect(printButton).toHaveTextContent('ข้าม 1 เครื่องที่ยังไม่ตั้งราคา');
    await waitFor(() => expect(printButton).toBeEnabled());
  });

  it('กดรายการในคิว → ตัวอย่างเปลี่ยนเป็นดวงนั้น', async () => {
    renderPage('/stickers?productIds=p1,s24');
    const queue = await screen.findByRole('list', { name: 'คิวพิมพ์' });
    await waitFor(() => expect(within(screen.getByTestId('sticker-preview')).getByText('iPhone 15')).toBeInTheDocument());

    fireEvent.click(within(queue).getByText('Galaxy S24'));

    const preview = screen.getByTestId('sticker-preview');
    await waitFor(() => expect(within(preview).getByText('Galaxy S24')).toBeInTheDocument());
    expect(within(preview).getByText('แบต 91%')).toBeInTheDocument();
  });

  it('ตั้งค่าม้วน 50×40 และปิด QR → @page เปลี่ยนตาม หัวหน้าบอกขนาด และดวงไม่มี QR', async () => {
    uiFlags = { stickerSize: '50x40', stickerShowQr: false };
    renderPage('/stickers?productIds=p1');

    await waitFor(() => expect(screen.getAllByTestId('sticker').length).toBeGreaterThan(0));
    const first = screen.getAllByTestId('sticker')[0];
    await waitFor(() => expect(first).toHaveClass('sticker--50x40'));
    expect(within(first).queryByTestId('sticker-qr')).toBeNull();
    expect(pageStyles()).toContain('@page { size: 50mm 40mm; margin: 0; }');
    expect(screen.getByText('ม้วน 50 × 40 มม. · ไม่มี QR')).toBeInTheDocument();
  });

  it('ยิงบาร์โค้ด IMEI ในช่องสแกน → ค้นด้วย IMEI ได้ตรง ๆ และเข้าคิว', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('iPhone 17')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /สแกน IMEI/ }));
    const input = screen.getByPlaceholderText(/ยิงบาร์โค้ด IMEI/);
    fireEvent.change(input, { target: { value: '351000000055433' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(
        mocks.get.mock.calls.some(([url]) => url === `/sticker-templates/products/data?ids=${encodeURIComponent('351000000055433')}`),
      ).toBe(true),
    );
    const queue = screen.getByRole('list', { name: 'คิวพิมพ์' });
    await waitFor(() => expect(within(queue).getByText('Galaxy S24')).toBeInTheDocument());
  });

  it('ปุ่ม "เพิ่ม" ในตารางเข้าคิว · +/− ที่คิวปรับจำนวนดวง · กด "ในคิว" อีกครั้งเอาออก', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('iPhone 17')).toBeInTheDocument());
    const row = screen.getByText('351000000047514').closest('tr')!;

    fireEvent.click(within(row).getByRole('button', { name: 'เพิ่ม' }));
    const queue = screen.getByRole('list', { name: 'คิวพิมพ์' });
    await waitFor(() => expect(within(queue).getByText('iPhone 17')).toBeInTheDocument());

    const printButton = screen.getByRole('button', { name: /พิมพ์สติกเกอร์/ });
    await waitFor(() => expect(printButton).toHaveTextContent('1 ดวง'));
    expect(within(queue).getByRole('button', { name: 'ลดจำนวนดวง' })).toBeDisabled();
    fireEvent.click(within(queue).getByRole('button', { name: 'เพิ่มจำนวนดวง' }));
    await waitFor(() => expect(printButton).toHaveTextContent('2 ดวง'));
    expect(within(row).getByRole('button', { name: 'เอา iPhone 17 ออกจากคิว' })).toHaveTextContent('ในคิว (2)');

    fireEvent.click(within(row).getByRole('button', { name: 'เอา iPhone 17 ออกจากคิว' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'คิวพิมพ์' })).not.toBeInTheDocument());
    expect(within(row).getByRole('button', { name: 'เพิ่ม' })).toBeInTheDocument();
  });
});
