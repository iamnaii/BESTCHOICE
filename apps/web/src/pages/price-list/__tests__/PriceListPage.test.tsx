import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PriceListPage from '../../PriceListPage';
import type { PriceQuoteRow } from '../types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), mobile: false }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: () => 'โหลดไม่สำเร็จ',
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.mobile }));

const URL = '/pricing-templates/quotes';
const UPDATED_AT = '2026-10-16T07:30:00.000Z'; // 14:30 เวลาไทย

function row(
  o: Partial<PriceQuoteRow> & Pick<PriceQuoteRow, 'model' | 'storage' | 'category'>,
): PriceQuoteRow {
  return {
    key: `Apple|${o.model}|${o.storage}|${String(o.hasWarranty ?? null)}`,
    brand: 'Apple',
    hasWarranty: null,
    cashPrice: null,
    rate1: null,
    rate2: { unavailable: 'GFIN ไม่รับรุ่นนี้' },
    ...o,
  };
}

// ตัวเลขจาก mockup staff-price-page.html — หน้าเว็บแสดงตามที่ API ส่ง ไม่คิดเอง
// (แถวเครื่องนอก + iPhone 13 ไม่มีประกัน เป็นตัวเลขสมมุติสำหรับเทสต์)
const DATA: Record<string, PriceQuoteRow[]> = {
  'PHONE_NEW|THAI': [
    row({
      model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW', cashPrice: 25900,
      rate1: { downAmount: 3900, monthly: 3139, months: 12 },
      rate2: { downAmount: 6500, monthly: 3403, months: 12 },
    }),
    row({
      model: 'iPhone 17 Pro', storage: '256GB', category: 'PHONE_NEW', cashPrice: 39000,
      rate1: { downAmount: 15000, monthly: 3424, months: 12 },
      rate2: { downAmount: 9700, monthly: 4403, months: 15 },
    }),
  ],
  'PHONE_NEW|IMPORTED': [
    row({
      model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW', cashPrice: 25900,
      rate1: { downAmount: 3900, monthly: 3139, months: 12 },
      rate2: { downAmount: 7400, monthly: 3330, months: 12 },
    }),
  ],
  'PHONE_USED|THAI': [
    row({
      model: 'iPhone 12', storage: '64GB', category: 'PHONE_USED', cashPrice: 8900,
      rate1: { downAmount: 1100, monthly: 1011, months: 10 },
      rate2: { unavailable: 'GFIN ไม่รับรุ่นนี้' },
    }),
    row({
      model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED', hasWarranty: true, cashPrice: 12500,
      rate1: { downAmount: 1600, monthly: 1227, months: 12 },
      rate2: { downAmount: 0, monthly: 1745, months: 12 },
    }),
    row({
      model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED', hasWarranty: false, cashPrice: 11900,
      rate1: { downAmount: 1500, monthly: 1168, months: 12 },
      rate2: { downAmount: 0, monthly: 1662, months: 12 },
    }),
  ],
};

function serve() {
  mocks.get.mockImplementation(async (url: string, options?: { params?: Record<string, string> }) => {
    if (url !== URL) throw new Error(`unexpected ${url}`);
    const p = options?.params ?? {};
    const q = (p.q ?? '').toLowerCase();
    const rows = (DATA[`${p.category}|${p.origin}`] ?? []).filter(
      (r) => !q || r.model.toLowerCase().includes(q),
    );
    return { data: { updatedAt: UPDATED_AT, rows } };
  });
}

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PriceListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** ข้อความในทุกช่อง `<td>` ของแถวตารางที่มีชื่อรุ่นนี้ */
function cellsOf(title: string) {
  const tr = within(screen.getByRole('table')).getByText(title).closest('tr');
  if (!tr) throw new Error(`no row for ${title}`);
  return Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim());
}

const params = (p: Record<string, string>) => expect.objectContaining({ params: p });

describe('PriceListPage — หน้า "ราคาและเรทผ่อน"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mobile = false;
  });

  it('ค่าเริ่มต้น มือ 1 + เครื่องไทย · หัวหน้า · ราคาอัปเดตล่าสุดตามเวลาไทย', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    expect(mocks.get).toHaveBeenCalledWith(URL, params({ category: 'PHONE_NEW', origin: 'THAI' }));
    expect(screen.getByRole('heading', { level: 1, name: 'ราคาและเรทผ่อน' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'มือ 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'เครื่องไทย' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('ราคาอัปเดตล่าสุด 16 ต.ค. 2569 14:30 น.')).toBeInTheDocument();
  });

  it('จอกว้าง: ตาราง หนึ่งแถวต่อรุ่น + ความจุ — เงินสด · เรท 1 · เรท 2', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    expect(cellsOf('iPhone 15 · 128GB')).toEqual([
      'iPhone 15 · 128GB', '25,900', '3,900', '3,139', '12', '6,500', '3,403', '12',
    ]);
    expect(cellsOf('iPhone 17 Pro · 256GB')).toEqual([
      'iPhone 17 Pro · 256GB', '39,000', '15,000', '3,424', '12', '9,700', '4,403', '15',
    ]);
  });

  it('ไม่แสดงทุน กำไร หรือราคาส่ง GFIN', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    expect(document.body).not.toHaveTextContent(/ทุน|กำไร|ราคาส่ง/);
  });

  it('มือ 2: รุ่นที่ GFIN ไม่รับ · แยกแถวมีประกัน / ไม่มีประกันพร้อมป้าย', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
    await screen.findByText('iPhone 12 · 64GB');
    expect(mocks.get).toHaveBeenLastCalledWith(URL, params({ category: 'PHONE_USED', origin: 'THAI' }));
    expect(screen.getByRole('button', { name: 'มือ 2' })).toHaveAttribute('aria-pressed', 'true');

    expect(cellsOf('iPhone 12 · 64GB')).toEqual([
      'iPhone 12 · 64GB', '8,900', '1,100', '1,011', '10', 'GFIN ไม่รับรุ่นนี้',
    ]);
    const tr12 = within(screen.getByRole('table')).getByText('iPhone 12 · 64GB').closest('tr')!;
    expect(tr12).not.toHaveTextContent(/ประกัน/);

    const rows13 = within(screen.getByRole('table'))
      .getAllByText('iPhone 13 · 128GB')
      .map((el) => el.closest('tr')!);
    expect(rows13).toHaveLength(2);
    expect(rows13[0]).toHaveTextContent('มีประกัน');
    expect(rows13[0]).not.toHaveTextContent('ไม่มีประกัน');
    expect(rows13[0]).toHaveTextContent('12,500');
    expect(rows13[1]).toHaveTextContent('ไม่มีประกัน');
    expect(rows13[1]).toHaveTextContent('11,900');
  });

  it('เครื่องนอก: ขอ API ด้วย origin=IMPORTED แล้วเรท 2 เปลี่ยน', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    fireEvent.click(screen.getByRole('button', { name: 'เครื่องนอก' }));
    await waitFor(() =>
      expect(cellsOf('iPhone 15 · 128GB')).toEqual([
        'iPhone 15 · 128GB', '25,900', '3,900', '3,139', '12', '7,400', '3,330', '12',
      ]),
    );
    expect(mocks.get).toHaveBeenLastCalledWith(URL, params({ category: 'PHONE_NEW', origin: 'IMPORTED' }));
    expect(screen.getByRole('button', { name: 'เครื่องนอก' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ค้นรุ่นไม่พบ → ข้อความตามสเปคข้อ 6 ทั้งมือ 1 และมือ 2', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหารุ่น' }), { target: { value: 'iPhone 11' } });
    expect(
      await screen.findByText(
        'ไม่พบ "iPhone 11" ในตารางราคา มือ 1 — ลองสลับเป็นมือ 2 หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้',
      ),
    ).toBeInTheDocument();
    expect(mocks.get).toHaveBeenLastCalledWith(
      URL,
      params({ category: 'PHONE_NEW', origin: 'THAI', q: 'iPhone 11' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
    expect(
      await screen.findByText(
        'ไม่พบ "iPhone 11" ในตารางราคา มือ 2 — ลองสลับเป็นมือ 1 หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้',
      ),
    ).toBeInTheDocument();
  });

  it('จอแคบ: การ์ดแทนตาราง แต่ละการ์ดมีเงินสดและสองเรท', async () => {
    mocks.mobile = true;
    serve();
    open();
    const card = await screen.findByRole('article', { name: 'iPhone 15 · 128GB' });
    expect(screen.queryByRole('table')).toBeNull();
    expect(card).toHaveTextContent('เงินสด 25,900');
    expect(within(card).getByRole('group', { name: 'เรท 1 · ผ่อนกับ BESTCHOICE' })).toHaveTextContent(
      'ดาวน์ 3,900 · ผ่อน 3,139 × 12 งวด',
    );
    expect(within(card).getByRole('group', { name: 'เรท 2 · ผ่อนกับ GFIN' })).toHaveTextContent(
      'ดาวน์ 6,500 · ผ่อน 3,403 × 12 งวด',
    );
  });

  it('จอแคบ มือ 2: การ์ดแยกตามประกันมีชื่อไม่ซ้ำ และรุ่นที่ GFIN ไม่รับบอกในช่องเรท 2', async () => {
    mocks.mobile = true;
    serve();
    open();
    await screen.findByRole('article', { name: 'iPhone 15 · 128GB' });
    fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
    const withWarranty = await screen.findByRole('article', { name: 'iPhone 13 · 128GB (มีประกัน)' });
    expect(withWarranty).toHaveTextContent('เงินสด 12,500');
    expect(screen.getByRole('article', { name: 'iPhone 13 · 128GB (ไม่มีประกัน)' })).toHaveTextContent('เงินสด 11,900');
    const card12 = screen.getByRole('article', { name: 'iPhone 12 · 64GB' });
    expect(within(card12).getByRole('group', { name: 'เรท 2 · ผ่อนกับ GFIN' })).toHaveTextContent('GFIN ไม่รับรุ่นนี้');
  });

  it('กำลังโหลดครั้งแรก → skeleton', () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    open();
    expect(screen.getByRole('status', { name: 'กำลังโหลด' })).toBeInTheDocument();
  });

  it('โหลดไม่สำเร็จ → ข้อความ + ปุ่มลองใหม่ที่โหลดได้จริง', async () => {
    mocks.get.mockRejectedValueOnce({ response: { status: 500 } });
    open();
    expect(await screen.findByText('โหลดราคาไม่สำเร็จ')).toBeInTheDocument();
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(await screen.findByText('iPhone 15 · 128GB')).toBeInTheDocument();
  });

  it('สลับเครื่องนอกแล้วรอผล → ไม่เห็นราคาชุดเก่า แสดง skeleton', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    mocks.get.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'เครื่องนอก' }));
    expect(await screen.findByRole('status', { name: 'กำลังโหลด' })).toBeInTheDocument();
    expect(screen.queryByText('iPhone 15 · 128GB')).toBeNull();
    expect(screen.queryByText('3,403')).toBeNull();
  });

  it('ไม่พบ แล้วเปลี่ยนคำค้นและรอผล → ไม่แสดงข้อความไม่พบของคำใหม่', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหารุ่น' }), { target: { value: 'iPhone 11' } });
    await screen.findByText(/ไม่พบ "iPhone 11"/);
    mocks.get.mockReturnValue(new Promise(() => {}));
    fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหารุ่น' }), { target: { value: 'iPhone 99' } });
    await waitFor(() => expect(mocks.get).toHaveBeenLastCalledWith(URL, params({ category: 'PHONE_NEW', origin: 'THAI', q: 'iPhone 99' })));
    expect(screen.queryByText(/ไม่พบ "iPhone 99"/)).toBeNull();
  });

  it('ตารางมี caption และ scope ของหัวคอลัมน์', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    expect(screen.getByRole('table', { name: 'ตารางราคาและเรทผ่อน' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { name: /^เรท/ })[0]).toHaveAttribute('scope', 'colgroup');
  });

  it('ข้อความไม่พบอยู่ใน role=status', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหารุ่น' }), { target: { value: 'iPhone 11' } });
    const msg = await screen.findByText(/ไม่พบ "iPhone 11"/);
    expect(msg.closest('[role="status"]')).not.toBeNull();
  });
});
