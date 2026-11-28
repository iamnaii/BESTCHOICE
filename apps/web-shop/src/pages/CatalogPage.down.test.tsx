import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import CatalogPage from './CatalogPage';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
// แบนเนอร์หัวหน้าถามยอดดาวน์ตามสต๊อกจาก /api/shop/products ด้วย (คำขอเดียวกับแถบโปรใน ShopLayout ที่จำลองไว้ข้างล่าง)
// — ไฟล์นี้นับเฉพาะคำขอรายการสินค้าของตัวกรอง จึงถอดแบนเนอร์ออกเหมือนกัน (เทสต์ของแบนเนอร์อยู่ที่ CatalogBanner.test.tsx)
vi.mock('@/components/catalog/CatalogBanner', () => ({ CatalogBanner: () => null }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const unit = {
  id: 'u1',
  kind: 'UNIT',
  brand: 'Apple',
  model: 'iPhone 16 Pro Max',
  storage: '256GB',
  condition: 'USED',
  minPrice: 29900,
  stockCount: 1,
  monthlyPaymentFrom: 2890,
  downAmount: 4485,
  installmentMonths: 12,
  rate2: { down: 0, monthly: 4061, months: 15 },
  stock: { display: 'พร้อมขาย', tone: 'normal' },
  images: [],
  tags: [],
};
const page = (over: Record<string, unknown> = {}) => ({
  data: {
    data: [unit],
    total: 1,
    page: 1,
    limit: 12,
    minDownPct: 15,
    monthsOptions: [10, 12],
    freeDownCount: 3,
    overBudgetCount: 0,
    nextDownFrom: null,
    ...over,
  },
});

let lastSearch = '';
function Probe() {
  lastSearch = useLocation().search;
  return null;
}
function open(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Probe />
        <CatalogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const listCalls = () =>
  get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/shop/products'));
const paramsOf = (url: string) => new URL(url, 'https://shop.test').searchParams;
const lastParams = () => {
  const calls = listCalls();
  return paramsOf(calls[calls.length - 1]);
};
const urlParams = () => new URLSearchParams(lastSearch);
/** ช่องเงินดาวน์ช่องแรกในหน้า (แถบข้าง) */
const downInput = async () =>
  (await screen.findAllByLabelText('เงินดาวน์'))[0] as HTMLInputElement;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.clearAllMocks();
  lastSearch = '';
  get.mockImplementation((url: string) =>
    url.startsWith('/api/shop/models') ? Promise.resolve({ data: [] }) : Promise.resolve(page()),
  );
});

it('ไม่ใส่เงินดาวน์ → คำขอไม่มี downAmount และเว็บเลิกส่ง downPct', async () => {
  open('/products');
  expect(await downInput()).toHaveValue('');
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  await pause(400);
  for (const url of listCalls()) {
    expect(paramsOf(url).has('downAmount')).toBe(false);
    expect(paramsOf(url).has('downPct')).toBe(false);
  }
});

it('ลิงก์ ?down=5000 → คำขอแรกส่ง downAmount=5000 และช่องแสดง 5,000', async () => {
  open('/products?down=5000');
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  expect(paramsOf(listCalls()[0]).get('downAmount')).toBe('5000');
  expect(await downInput()).toHaveValue('5,000');
});

it('ระหว่างพิมพ์ยังไม่ยิงคำขอ · ออกจากช่องแล้ว ?down= เข้า URL และคำขอใหม่ส่ง downAmount', async () => {
  open('/products');
  const input = await downInput();
  await waitFor(() => expect(listCalls().length).toBe(1));
  fireEvent.change(input, { target: { value: '3000' } });
  await pause(400);
  expect(listCalls().length).toBe(1);
  expect(urlParams().has('down')).toBe(false);
  fireEvent.blur(input);
  await waitFor(() => expect(urlParams().get('down')).toBe('3000'));
  await waitFor(() => expect(lastParams().get('downAmount')).toBe('3000'));
});

it('พิมพ์ 0 = ติ๊กฟรีดาวน์: URL เป็น freeDown=1 ไม่มี down · คำขอส่ง freeDown=true · ช่องเงินดาวน์ใช้ไม่ได้', async () => {
  open('/products');
  const input = await downInput();
  fireEvent.change(input, { target: { value: '0' } });
  fireEvent.blur(input);
  await waitFor(() => expect(urlParams().get('freeDown')).toBe('1'));
  expect(urlParams().has('down')).toBe(false);
  await waitFor(() => expect(lastParams().get('freeDown')).toBe('true'));
  expect(lastParams().has('downAmount')).toBe(false);
  for (const box of screen.getAllByRole('checkbox', { name: /ฟรีดาวน์/ })) expect(box).toBeChecked();
  expect(await downInput()).toBeDisabled();
});

it('มีเงินดาวน์แล้วติ๊กฟรีดาวน์ → down หายจาก URL · เอาติ๊กออก → กลับสถานะไม่ใส่อะไร', async () => {
  open('/products?down=5000');
  const boxes = await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  fireEvent.click(boxes[0]);
  await waitFor(() => expect(urlParams().get('freeDown')).toBe('1'));
  expect(urlParams().has('down')).toBe(false);
  fireEvent.click(screen.getAllByRole('checkbox', { name: /ฟรีดาวน์/ })[0]);
  await waitFor(() => expect(urlParams().has('freeDown')).toBe(false));
  expect(urlParams().has('down')).toBe(false);
  await waitFor(() => {
    const p = lastParams();
    expect(p.has('freeDown')).toBe(false);
    expect(p.has('downAmount')).toBe(false);
  });
  expect(await downInput()).toHaveValue('');
});

it('สลับเป็นซื้อสด → down หายจาก URL และจากคำขอ · ไม่มีช่องเงินดาวน์', async () => {
  open('/products?down=5000');
  await downInput();
  fireEvent.click(screen.getByRole('button', { name: 'ซื้อสด' }));
  await waitFor(() => expect(urlParams().has('down')).toBe(false));
  await waitFor(() => expect(lastParams().has('downAmount')).toBe(false));
  expect(screen.queryByLabelText('เงินดาวน์')).not.toBeInTheDocument();
});

it('ลิงก์ ?down=0 = ฟรีดาวน์', async () => {
  open('/products?down=0');
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  expect(paramsOf(listCalls()[0]).get('freeDown')).toBe('true');
  expect(paramsOf(listCalls()[0]).has('downAmount')).toBe(false);
});

it('ลิงก์ ?down= ที่ไม่ใช่จำนวนเต็มบาท → ไม่ใช้', async () => {
  open('/products?down=abc');
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  expect(paramsOf(listCalls()[0]).has('downAmount')).toBe(false);
  expect(await downInput()).toHaveValue('');
});

it('สถานะ ②: บรรทัดสรุป + บรรทัดท้ายรายการ · กด "ดูทั้งหมด" ล้างเงินดาวน์', async () => {
  get.mockImplementation((url: string) =>
    url.startsWith('/api/shop/models')
      ? Promise.resolve({ data: [] })
      : Promise.resolve(page({ total: 21, limit: 50, overBudgetCount: 8, nextDownFrom: 5400 })),
  );
  open('/products?down=5000');
  expect(await screen.findByText('พบ 21 เครื่องที่ดาวน์ได้ด้วยเงิน ฿5,000')).toBeInTheDocument();
  expect(
    screen.getByText(/อีก 8 เครื่องต้องดาวน์มากกว่า ฿5,000 \(เริ่มที่ ฿5,400\)/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ดูทั้งหมด' }));
  await waitFor(() => expect(urlParams().has('down')).toBe(false));
  await waitFor(() => expect(screen.queryByText(/ต้องดาวน์มากกว่า/)).not.toBeInTheDocument());
});

it('สถานะ ② ไม่มีเครื่องเข้าเงื่อนไข → กด "ดูเครื่องฟรีดาวน์" แล้วเป็นสถานะติ๊กฟรีดาวน์', async () => {
  get.mockImplementation((url: string) =>
    url.startsWith('/api/shop/models')
      ? Promise.resolve({ data: [] })
      : Promise.resolve(page({ data: [], total: 0, overBudgetCount: 5, nextDownFrom: 1000 })),
  );
  open('/products?down=500');
  expect(await screen.findByText('เงินดาวน์ ฿500 ยังไม่พอ')).toBeInTheDocument();
  expect(screen.getByText('ดาวน์ต่ำสุดเริ่มที่ ฿1,000')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ดูเครื่องฟรีดาวน์' }));
  await waitFor(() => expect(urlParams().get('freeDown')).toBe('1'));
  expect(urlParams().has('down')).toBe(false);
});

it('"ล้างตัวกรองทั้งหมด" ล้างเงินดาวน์และตัวกรองอื่นในครั้งเดียว (คำค้นหายังอยู่)', async () => {
  open('/products?down=5000&condition=USED&model=iPhone+15&search=โปร');
  await downInput();
  fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' }));
  await waitFor(() => expect(urlParams().has('down')).toBe(false));
  expect(urlParams().has('condition')).toBe(false);
  expect(urlParams().has('model')).toBe(false);
  expect(urlParams().get('search')).toBe('โปร');
  await waitFor(() => {
    const p = lastParams();
    expect(p.has('downAmount')).toBe(false);
    expect(p.has('condition')).toBe(false);
    expect(p.has('model')).toBe(false);
    expect(p.get('search')).toBe('โปร');
  });
});

it('"ล้างตัวกรองทั้งหมด" เอาติ๊กฟรีดาวน์ออกด้วย', async () => {
  open('/products?freeDown=1');
  await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' }));
  await waitFor(() => expect(urlParams().has('freeDown')).toBe(false));
  await waitFor(() => expect(lastParams().has('freeDown')).toBe(false));
});

it('มือถือ: แถวเงินดาวน์ + ช่องติ๊กฟรีดาวน์อยู่นอกแผงตัวกรอง ใช้ได้เลย', async () => {
  open('/products');
  await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  const fields = screen.getAllByLabelText('เงินดาวน์');
  expect(fields.map((el) => el.id).sort()).toEqual(['filter-down', 'toolbar-down']);
  const toolbar = fields.find((el) => el.id === 'toolbar-down') as HTMLInputElement;
  const row = toolbar.closest('[data-mobile-plan]') as HTMLElement;
  expect(row.className).toContain('lg:hidden');
  expect(within(row).getByRole('checkbox', { name: /ฟรีดาวน์/ })).toBeInTheDocument();
  fireEvent.change(toolbar, { target: { value: '4000' } });
  fireEvent.blur(toolbar);
  await waitFor(() => expect(urlParams().get('down')).toBe('4000'));
  await waitFor(() => expect(lastParams().get('downAmount')).toBe('4000'));
});

it('โหมดซื้อสด: ไม่มีแถวเงินดาวน์บนมือถือ', async () => {
  open('/products?mode=cash');
  await waitFor(() => expect(get).toHaveBeenCalled());
  expect(document.querySelector('[data-mobile-plan]')).toBeNull();
});

it('ลิงก์ของการ์ดพา ?down= เฉพาะสถานะ ② — ไม่พาในสถานะไม่ใส่อะไรและสถานะฟรีดาวน์', async () => {
  const cardLinks = () =>
    screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/products/u1'));

  const second = open('/products?down=5000');
  await screen.findByText('iPhone 16 Pro Max');
  expect(cardLinks().length).toBeGreaterThan(0);
  for (const href of cardLinks()) expect(href).toBe('/products/u1?down=5000');
  second.unmount();

  const first = open('/products');
  await screen.findByText('iPhone 16 Pro Max');
  for (const href of cardLinks()) expect(href).toBe('/products/u1');
  first.unmount();

  open('/products?freeDown=1');
  await screen.findByText('iPhone 16 Pro Max');
  for (const href of cardLinks()) expect(href).toBe('/products/u1');
});

it('พิมพ์เงินดาวน์แล้วแตะปุ่มกรองอื่นทันที (blur + click ใน task เดียว) → ทั้งสองค่าอยู่ใน URL และคำขอ', async () => {
  open('/products');
  await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  const toolbar = document.getElementById('toolbar-down') as HTMLInputElement;
  const used = screen
    .getAllByRole('button', { name: 'มือ 2' })
    .find((b) => b.parentElement?.className.includes('lg:hidden')) as HTMLElement;
  fireEvent.change(toolbar, { target: { value: '3000' } });
  act(() => {
    fireEvent.blur(toolbar);
    fireEvent.click(used);
  });
  await waitFor(() => expect(urlParams().get('down')).toBe('3000'));
  expect(urlParams().get('condition')).toBe('USED');
  await waitFor(() => {
    const p = lastParams();
    expect(p.get('downAmount')).toBe('3000');
    expect(p.get('condition')).toBe('USED');
  });
});

it('พิมพ์ 0 แล้วแตะปุ่มเครื่องไทยทันที → freeDown=1 และ deviceOrigin อยู่ใน URL', async () => {
  open('/products');
  await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  const toolbar = document.getElementById('toolbar-down') as HTMLInputElement;
  const thai = screen.getAllByRole('button', { name: 'เครื่องไทย' })[0];
  fireEvent.change(toolbar, { target: { value: '0' } });
  act(() => {
    fireEvent.blur(toolbar);
    fireEvent.click(thai);
  });
  await waitFor(() => expect(urlParams().get('freeDown')).toBe('1'));
  expect(urlParams().get('deviceOrigin')).toBe('THAI');
});

it('API ที่ไม่ส่ง overBudgetCount (รุ่นเก่า) → ไม่อ้างว่ากรองด้วยเงิน: สรุปทั่วไป · ลิงก์การ์ดไม่มี ?down=', async () => {
  get.mockImplementation((url: string) =>
    url.startsWith('/api/shop/models')
      ? Promise.resolve({ data: [] })
      : Promise.resolve(page({ total: 4, overBudgetCount: undefined })),
  );
  open('/products?down=5000');
  expect(await screen.findByText('พบ 4 รายการ')).toBeInTheDocument();
  expect(screen.queryByText(/ที่ดาวน์ได้ด้วยเงิน/)).not.toBeInTheDocument();
  for (const a of screen.getAllByRole('link')) {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('/products/u1')) expect(href).toBe('/products/u1');
  }
});

it('แถวเงินดาวน์บนมือถือห่อบรรทัดได้ และช่องมีความกว้างขั้นต่ำ', async () => {
  open('/products');
  await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  const toolbar = document.getElementById('toolbar-down') as HTMLInputElement;
  const row = toolbar.closest('[data-mobile-plan]') as HTMLElement;
  expect(row.className).toContain('flex-wrap');
  expect(toolbar.closest('div.rounded-full')?.className).toContain('min-w-40');
});

it('หน่วง 250ms: commit แล้วยังไม่ยิงคำขอที่มี downAmount จนครบ 250ms · commit ซ้ำในช่วงนั้นใช้ค่าหลังสุดค่าเดียว', async () => {
  open('/products');
  const input = await downInput();
  await waitFor(() => expect(listCalls().length).toBe(1));
  vi.useFakeTimers();
  try {
    fireEvent.change(input, { target: { value: '3000' } });
    fireEvent.blur(input);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(listCalls().filter((u) => paramsOf(u).has('downAmount'))).toHaveLength(0);

    // commit ครั้งที่สองก่อนครบ 250ms → ตัวจับเวลาของครั้งแรกถูกแทนที่
    fireEvent.change(input, { target: { value: '4000' } });
    fireEvent.blur(input);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(listCalls().filter((u) => paramsOf(u).has('downAmount'))).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const withDown = listCalls().filter((u) => paramsOf(u).has('downAmount'));
    expect(withDown).toHaveLength(1);
    expect(paramsOf(withDown[0]).get('downAmount')).toBe('4000');
  } finally {
    vi.useRealTimers();
  }
});

it('มือถือ: ติ๊กฟรีดาวน์ในแถว data-mobile-plan → ?freeDown=1 และช่องเงินดาวน์ของแถวนั้นใช้ไม่ได้', async () => {
  open('/products');
  await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  const row = document.querySelector('[data-mobile-plan]') as HTMLElement;
  fireEvent.click(within(row).getByRole('checkbox', { name: /ฟรีดาวน์/ }));
  await waitFor(() => expect(urlParams().get('freeDown')).toBe('1'));
  expect(urlParams().has('down')).toBe(false);
  expect(within(row).getByLabelText('เงินดาวน์')).toBeDisabled();
  expect(within(row).getByRole('checkbox', { name: /ฟรีดาวน์/ })).toBeChecked();
});

it('แผงตัวกรองบนมือถือมีคำอธิบายของ dialog (ไม่มีคำเตือน Missing Description)', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    open('/products');
    await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
    fireEvent.click(screen.getByRole('button', { name: 'ตัวกรอง' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleDescription('เลือกเงื่อนไขเพื่อกรองรายการสินค้า');
    const logged = [...warn.mock.calls, ...error.mock.calls].map((c) => String(c[0]));
    expect(logged.filter((m) => m.includes('Description'))).toEqual([]);
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
});
