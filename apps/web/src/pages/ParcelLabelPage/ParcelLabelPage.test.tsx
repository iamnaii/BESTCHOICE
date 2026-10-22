import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Outlet, Route, Routes } from 'react-router';
import ParcelLabelPage from './index';
import { PARCEL_LABEL_FORMAT_KEY } from './parcelLabel';

/**
 * หน้า /sales/:id/parcel-label — โหลดใบขาย + ลูกค้า + บริษัท แล้วเติมฟอร์ม · แก้แล้วตัวอย่างเปลี่ยน · เลือกขนส่ง · รูปแบบกระดาษจำต่อเครื่อง · ใบยกเลิกพิมพ์ไม่ได้
 * 🔴 hook ของ vitest ห้าม return ค่า (คร่อมปีกกาเสมอ)
 */

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error'),
}));

const sale = {
  id: 's1',
  saleNumber: 'S-20261022-0001',
  deletedAt: null as string | null,
  customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: '0811111111' },
  product: { id: 'p1', name: 'Apple iPhone 15 Pro Max 256GB ดำ', imeiSerial: '357200606382344', serialNumber: null },
  bundleProducts: [{ id: 'acc1', name: 'เคสใส' }],
};
/** ที่อยู่จากฟอร์มเว็บเก็บเป็น JSON (`serializeAddress`) — เส้นทางหลักของข้อมูลจริง */
const customer = {
  id: 'c1',
  prefix: 'นางสาว',
  name: 'สมหญิง ใจดี',
  phone: '0899999999',
  addressCurrent: JSON.stringify({
    houseNo: '99/1', moo: '2', village: '', soi: '', road: '',
    province: 'ลพบุรี', district: 'อำเภอเมืองลพบุรี', subdistrict: 'ตำบลท่าหิน', postalCode: '15000',
  }),
};
const sale2 = { ...sale, id: 's2', saleNumber: 'S-20261022-0002', customer: { id: 'c2', name: 'สมชาย รักดี', phone: '0822222222' } };
const customer2 = { id: 'c2', prefix: 'นาย', name: 'สมชาย รักดี', phone: '0822222222', addressCurrent: '45 หมู่ 3 ต.บางพลี จ.สมุทรปราการ 10540' };
const company = { shop: { nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด', address: '12 ถ.นารายณ์มหาราช', phone: '036-000000' }, finance: null };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/sales/s1/parcel-label']}>
        <Routes>
          <Route element={<><Link to="/sales/s2/parcel-label">ไปใบ s2</Link><Outlet /></>}>
            <Route path="/sales/:id/parcel-label" element={<ParcelLabelPage />} />
          </Route>
          <Route path="/sales" element={<div>หน้าประวัติการขาย</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const paper = () => screen.getByTestId('parcel-label');

beforeEach(() => {
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/sales/s1') return { data: sale };
    if (path === '/sales/s2') return { data: sale2 };
    if (path === '/customers/c1') return { data: customer };
    if (path === '/customers/c2') return { data: customer2 };
    if (path === '/company/public') return { data: company };
    throw new Error(`unexpected ${path}`);
  });
  try {
    window.localStorage.removeItem(PARCEL_LABEL_FORMAT_KEY);
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ParcelLabelPage', () => {
  it('เติมฟอร์มจากลูกค้าและใบขาย แล้วตัวอย่างแสดงตาม', async () => {
    renderPage();

    expect((await screen.findByLabelText('ชื่อผู้รับ')) as HTMLInputElement).toHaveValue('นางสาว สมหญิง ใจดี');
    expect(screen.getByLabelText('เบอร์โทร')).toHaveValue('0899999999');
    expect(screen.getByLabelText('ที่อยู่')).toHaveValue('99/1 หมู่ 2 ตำบลท่าหิน อำเภอเมืองลพบุรี');
    expect(screen.getByLabelText('จังหวัด')).toHaveValue('ลพบุรี');
    expect(screen.getByLabelText('รหัสไปรษณีย์')).toHaveValue('15000');
    expect(screen.getByLabelText('เก็บเงินปลายทาง')).toHaveValue('ไม่มี');
    expect(paper()).toHaveTextContent('Apple iPhone 15 Pro Max 256GB ดำ');
    expect(paper()).toHaveTextContent('+ เคสใส');
    expect(paper()).toHaveTextContent('บริษัท เบสท์ช้อยส์โฟน จำกัด');
    expect(within(paper()).getByRole('img', { name: 'QR เปิดใบขาย S-20261022-0001' })).toBeInTheDocument();
  });

  it('แก้ชื่อ/หมายเหตุ แล้วตัวอย่างเปลี่ยนตาม · เลือกขนส่งแล้วช่องติ๊ก', async () => {
    renderPage();
    const name = await screen.findByLabelText('ชื่อผู้รับ');

    fireEvent.change(name, { target: { value: 'คุณสมชาย รักดี' } });
    fireEvent.change(screen.getByLabelText('หมายเหตุถึงขนส่ง'), { target: { value: 'โทรก่อนส่ง' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kerry' }));

    expect(paper()).toHaveTextContent('คุณสมชาย รักดี');
    expect(paper()).toHaveTextContent('หมายเหตุถึงขนส่ง: โทรก่อนส่ง');
    expect(within(paper()).getByRole('img', { name: 'Kerry เลือกแล้ว' })).toBeInTheDocument();
    expect(within(paper()).getByRole('img', { name: 'Flash ยังไม่เลือก' })).toBeInTheDocument();
  });

  it('รูปแบบกระดาษเริ่มที่ A4 · เปลี่ยนเป็นฉลาก 100×150 แล้วจำไว้ที่เครื่องและ @page เปลี่ยน', async () => {
    renderPage();
    const format = (await screen.findByLabelText('รูปแบบกระดาษ')) as HTMLSelectElement;
    expect(format).toHaveValue('A4');
    expect(document.documentElement.textContent).toContain('size: A4');

    fireEvent.change(format, { target: { value: 'LABEL_100x150' } });

    expect(window.localStorage.getItem(PARCEL_LABEL_FORMAT_KEY)).toBe('LABEL_100x150');
    expect(document.documentElement.textContent).toContain('size: 100mm 150mm');
  });

  it('ปุ่มพิมพ์เรียก window.print', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /พิมพ์ใบปะหน้า/ }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it('ลูกค้าโหลดไม่ได้ (403) → ยังพิมพ์ได้ ใช้ชื่อ/เบอร์จากใบขาย ที่อยู่ว่างให้กรอกเอง', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/sales/s1') return { data: sale };
      if (path === '/customers/c1') throw new Error('Forbidden');
      if (path === '/company/public') return { data: company };
      throw new Error(`unexpected ${path}`);
    });
    renderPage();

    expect(await screen.findByLabelText('ชื่อผู้รับ')).toHaveValue('สมหญิง ใจดี');
    expect(screen.getByLabelText('เบอร์โทร')).toHaveValue('0811111111');
    expect(screen.getByLabelText('ที่อยู่')).toHaveValue('');
    expect(screen.getByRole('button', { name: /พิมพ์ใบปะหน้า/ })).toBeInTheDocument();
  });

  it('เปลี่ยนใบขายขณะหน้ายัง mount (back/forward) → ฟอร์มและ QR เป็นของใบใหม่ ไม่ค้างใบเก่า', async () => {
    renderPage();
    expect(await screen.findByLabelText('ชื่อผู้รับ')).toHaveValue('นางสาว สมหญิง ใจดี');

    fireEvent.click(screen.getByRole('link', { name: 'ไปใบ s2' }));

    await waitFor(() => expect(screen.getByLabelText('ชื่อผู้รับ')).toHaveValue('นาย สมชาย รักดี'));
    expect(screen.getByLabelText('จังหวัด')).toHaveValue('สมุทรปราการ');
    expect(within(paper()).getByRole('img', { name: 'QR เปิดใบขาย S-20261022-0002' })).toBeInTheDocument();
  });

  it('ใบขายที่ยกเลิกแล้ว → ไม่มีปุ่มพิมพ์ และบอกเหตุผล', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/sales/s1') return { data: { ...sale, deletedAt: '2026-10-21T03:00:00.000Z' } };
      if (path === '/customers/c1') return { data: customer };
      if (path === '/company/public') return { data: company };
      throw new Error(`unexpected ${path}`);
    });
    renderPage();

    expect(await screen.findByText(/ใบขายนี้ถูกยกเลิกแล้ว/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /พิมพ์ใบปะหน้า/ })).toBeNull());
  });
});
