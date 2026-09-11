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

// ตารางดอกเบี้ยชุดเดียวกับที่ใช้ render หน้ารายการสินค้า/หน้าสินค้า — 19,900 → ดาวน์ 2,985 · 1,840.07 × 12
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
    batteryHealth: row.batteryHealth ?? null,
    hasBox: row.hasBox ?? null,
    warrantyExpireDate: row.warrantyExpireDate ? row.warrantyExpireDate.slice(0, 10) : null,
    imei: row.imeiSerial,
    stockInDate: row.stockInDate ?? null,
    cashPrice: row.cashPrice,
    installmentPrice: row.installmentPrice,
    prices: row.prices,
  };
}

function mockApi() {
  mocks.get.mockImplementation(async (url: string, options?: { params?: Record<string, unknown> }) => {
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
  mockApi();
  window.localStorage.clear();
});

describe('หน้าพิมพ์สติกเกอร์ — ตารางเลือกเครื่อง', () => {
  it('ขอสินค้าพร้อมขายเรียงตามวันที่รับเข้า ใหม่ → เก่า เป็นค่าเริ่มต้น และโชว์ข้อมูลชุดเดียวกับสติกเกอร์ในแต่ละแถว', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('iPhone 17')).toBeInTheDocument());
    expect(stockCalls()[0][1]).toEqual({
      params: { status: 'IN_STOCK', page: 1, limit: 20, sortBy: 'stockInDate', sortDirection: 'desc' },
    });

    const table = screen.getByTestId('data-table');
    // แถว iPhone 15: IMEI เต็ม · สเปก · ประกันศูนย์ · เงินสด · เรท 1 = ผ่อนกับร้าน · เรท 2 = ตาราง GFIN · วันที่รับเข้า
    const row = within(table).getByText('351000000007919').closest('tr')!;
    expect(within(row).getByText('ดำ · 128GB')).toBeInTheDocument();
    expect(within(row).getByText('27/08/27')).toBeInTheDocument();
    expect(within(row).getByText('19,900')).toBeInTheDocument();
    await waitFor(() => expect(within(row).getByText('1,840.07')).toBeInTheDocument());
    expect(within(row).getByText('ดาวน์ 2,985')).toBeInTheDocument();
    expect(within(row).getByText('3,327')).toBeInTheDocument();
    expect(within(row).getByText('ดาวน์ 1,900')).toBeInTheDocument();
    expect(within(row).getByText('11/08/2569')).toBeInTheDocument();

    // มือสอง: %แบต + กล่อง · รุ่นที่ไม่มีในตาราง GFIN บอกตรง ๆ
    const used = within(table).getByText('351000000055433').closest('tr')!;
    expect(within(used).getByText('91%')).toBeInTheDocument();
    expect(within(used).getByText('มีกล่อง')).toBeInTheDocument();
    await waitFor(() => expect(within(used).getByText('ไม่มีใน GFIN')).toBeInTheDocument());

    // ยังไม่ตั้งราคา
    const noPrice = within(table).getByText('351000000110866').closest('tr')!;
    expect(within(noPrice).getByText('ยังไม่ตั้งราคา')).toBeInTheDocument();
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

    fireEvent.change(screen.getByPlaceholderText('ค้นหาแบรนด์ / รุ่น / IMEI ในสต็อก…'), {
      target: { value: 'S24' },
    });

    await waitFor(() =>
      expect(lastStockParams()).toEqual({
        params: { status: 'IN_STOCK', page: 1, limit: 20, sortBy: 'stockInDate', sortDirection: 'desc', search: 'S24' },
      }),
    );
  });
});

describe('หน้าพิมพ์สติกเกอร์ — คิวพิมพ์และดวงที่พิมพ์', () => {
  it('รับ productIds จาก URL → ดวงพิมพ์ใช้ข้อมูลจากตัวเครื่อง (รุ่นอย่างเดียว ประกันศูนย์ ชิปมือสอง) และข้ามเครื่องที่ไม่มีราคา', async () => {
    renderPage('/stickers?productIds=p1,s24,p14');

    await waitFor(() => expect(screen.getAllByTestId('sticker').length).toBeGreaterThan(0));
    // ดวงที่พิมพ์: p1 + s24 (พรีวิว + ชุดพิมพ์อย่างละชุด) — p14 ไม่มีราคา ไม่พิมพ์
    await waitFor(() => expect(screen.getAllByTestId('sticker')).toHaveLength(4));
    const stickers = screen.getAllByTestId('sticker');
    const first = stickers[0];
    expect(within(first).getByText('iPhone 15')).toBeInTheDocument();
    expect(within(first).queryByText(/apple/i)).not.toBeInTheDocument();
    expect(within(first).getByText('ประกันศูนย์ 27/08/27')).toBeInTheDocument();
    expect(within(first).getByText('19,900')).toBeInTheDocument();
    expect(within(first).getByText('351000000007919')).toBeInTheDocument();
    expect(within(first).queryByText(/estchoice/i)).not.toBeInTheDocument();
    await waitFor(() => expect(within(first).getByText('ดาวน์ 2,985')).toBeInTheDocument());

    const used = stickers[1];
    expect(within(used).getByText('แบต 91%')).toBeInTheDocument();
    expect(within(used).getByText('มีกล่อง')).toBeInTheDocument();
    expect(within(used).getByText('ประกันศูนย์ 12/03/27')).toBeInTheDocument();

    // คิว: เครื่องไม่มีราคาถูกเตือน และปุ่มพิมพ์นับเฉพาะดวงที่พิมพ์ได้
    expect(screen.getByText(/ยังไม่ตั้งราคา — จะไม่ถูกพิมพ์/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /พิมพ์สติกเกอร์/ })).toHaveTextContent('2 ดวง');
    expect(screen.getByRole('button', { name: /พิมพ์สติกเกอร์/ })).toHaveTextContent('ข้าม 1 เครื่องที่ยังไม่ตั้งราคา');
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

  it('ปุ่ม "เพิ่ม" ในตารางเข้าคิว และ +/− ปรับจำนวนดวง', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('iPhone 17')).toBeInTheDocument());
    const row = screen.getByText('351000000047514').closest('tr')!;

    fireEvent.click(within(row).getByRole('button', { name: 'เพิ่ม' }));
    const queue = screen.getByRole('list', { name: 'คิวพิมพ์' });
    await waitFor(() => expect(within(queue).getByText('iPhone 17')).toBeInTheDocument());

    fireEvent.click(within(row).getByRole('button', { name: 'เพิ่มจำนวนดวง' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /พิมพ์สติกเกอร์/ })).toHaveTextContent('2 ดวง'));
  });
});
