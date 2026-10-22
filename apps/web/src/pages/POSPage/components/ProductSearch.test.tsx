import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { Product } from '../types';
import type { ScanOutcome } from '../scanOutcome';
import ProductSearch from './ProductSearch';

/**
 * ยิง QR / IMEI ที่หน้าขาย (A4 · 2026-10-22) — Enter ในช่องค้นหา = ค้นค่าเท่ากันผ่าน GET /products/scan
 * 🔴 hook ของ vitest ห้าม return ค่า (คร่อมปีกกาเสมอ) · reject ด้วย mockImplementation ตอนถูกเรียกเท่านั้น
 */

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error'),
}));

const CODE = '351000000007919';

const product: Product = {
  id: 'p1',
  name: 'Apple iPhone 15 128GB',
  brand: 'Apple',
  model: 'iPhone 15',
  imeiSerial: CODE,
  legacyProductCode: null,
  category: 'PHONE_NEW',
  costPrice: '0',
  branchId: 'b1',
  branch: { id: 'b1', name: 'ลาดพร้าว' },
  prices: [{ id: 'cash', label: 'ราคาเงินสด', amount: '19900', isDefault: true }],
};

function outcome(overrides: Partial<ScanOutcome>): ScanOutcome {
  return {
    code: CODE,
    reason: 'SELLABLE',
    sellable: true,
    product,
    branch: { id: 'b1', name: 'ลาดพร้าว' },
    booking: null,
    contract: null,
    sale: null,
    reservation: null,
    ...overrides,
  };
}

const BOOKED = outcome({
  code: '358504126918951',
  reason: 'BOOKED',
  sellable: false,
  product: { ...product, id: 'p2', imeiSerial: '358504126918951' },
  booking: { id: 'bk1', bookingNumber: 'BK-20261020-0003', customerName: 'สมหญิง', expireDate: '2026-10-25T12:00:00.000Z' },
});

/** หน้าขายจริงเก็บ selectedProduct ไว้ข้างนอก — harness ทำแบบเดียวกันเพื่อให้สาขา "เลือกแล้ว" render ได้ */
function Harness({ onSelectProduct }: { onSelectProduct: (p: Product) => void }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  return (
    <ProductSearch
      productSearch={search}
      setProductSearch={setSearch}
      selectedProduct={selected}
      onSelectProduct={(p) => {
        onSelectProduct(p);
        setSelected(p);
        setSearch('');
      }}
      onClearProduct={() => setSelected(null)}
      bundleProductIds={[]}
    />
  );
}

function renderSearch() {
  const onSelectProduct = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness onSelectProduct={onSelectProduct} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onSelectProduct;
}

const input = () => screen.getByLabelText('ค้นหาสินค้า รุ่น หรือ IMEI') as HTMLInputElement;

function typeAndEnter(value: string) {
  fireEvent.change(input(), { target: { value } });
  fireEvent.keyDown(input(), { key: 'Enter', code: 'Enter' });
}

const scanCalls = () => mocks.get.mock.calls.filter(([path]) => path === '/products/scan');

let scanResponse: () => Promise<{ data: ScanOutcome }>;
let listRows: Product[];

beforeEach(() => {
  mocks.get.mockReset();
  listRows = [];
  scanResponse = async () => ({ data: outcome({}) });
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/products/scan') return scanResponse();
    return { data: { data: listRows } };
  });
});

describe('ProductSearch — ยิง QR / IMEI แล้วกด Enter', () => {
  it('ยิงเจอเครื่องพร้อมขาย → เลือกให้ทันที + แถบเขียวบอกว่ายิงแล้วพร้อม IMEI', async () => {
    const onSelectProduct = renderSearch();

    typeAndEnter(CODE);

    await waitFor(() => expect(onSelectProduct).toHaveBeenCalledWith(product));
    expect(scanCalls()).toEqual([['/products/scan', { params: { code: CODE } }]]);
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('ยิงแล้ว · เลือกเครื่องให้แล้ว');
    expect(status).toHaveTextContent(`IMEI ${CODE}`);
  });

  it('กด "เปลี่ยน" แล้วแถบเขียวหาย กลับมาที่ช่องค้นหา', async () => {
    renderSearch();
    typeAndEnter(CODE);
    await screen.findByRole('status');

    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยน' }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(input()).toBeInTheDocument();
  });

  it('ยิงแล้วขายไม่ได้ → แถบแดงบอกเหตุผล + ปุ่มพาไปใบจอง + คงรหัสไว้ในช่อง · "ยิงเครื่องอื่น" ล้างทั้งคู่', async () => {
    scanResponse = async () => ({ data: BOOKED });
    const onSelectProduct = renderSearch();

    typeAndEnter('358504126918951');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('เครื่องนี้ขายไม่ได้ตอนนี้ · จองไว้แล้ว');
    expect(alert).toHaveTextContent('ใบจอง BK-20261020-0003 ของคุณสมหญิง หมดอายุ 25 ต.ค.');
    expect(screen.getByRole('link', { name: 'เปิดใบจอง BK-20261020-0003' })).toHaveAttribute(
      'href',
      '/bookings?bookingId=bk1',
    );
    expect(onSelectProduct).not.toHaveBeenCalled();
    expect(input().value).toBe('358504126918951');

    fireEvent.click(screen.getByRole('button', { name: 'ยิงเครื่องอื่น' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(input().value).toBe('');
    expect(input()).toHaveFocus();
  });

  it('Enter บนข้อความที่มีช่องว่าง (ชื่อรุ่น) ไม่ใช่การยิง — ไม่เรียก /products/scan', async () => {
    renderSearch();

    typeAndEnter('iPhone 15');

    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(scanCalls()).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ตรวจรหัสไม่สำเร็จ (เครือข่าย/500) → แถบแดงบอกว่าตรวจไม่สำเร็จพร้อมข้อความระบบ', async () => {
    scanResponse = async () => {
      throw new Error('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    };
    renderSearch();

    typeAndEnter(CODE);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ตรวจรหัสไม่สำเร็จ');
    expect(alert).toHaveTextContent('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('เลือกเครื่องจากรายการหลังยิงไม่ผ่าน → แถบแดงหายไปพร้อมกัน', async () => {
    scanResponse = async () => ({ data: BOOKED });
    listRows = [product];
    const onSelectProduct = renderSearch();

    typeAndEnter('358504126918951');
    await screen.findByRole('alert');

    fireEvent.click(await screen.findByRole('button', { name: /Apple iPhone 15/ }));

    expect(onSelectProduct).toHaveBeenCalledWith(product);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('ระหว่างรอผล Enter ซ้ำไม่ยิงซ้ำ', async () => {
    let resolve!: (value: { data: ScanOutcome }) => void;
    scanResponse = () => new Promise((r) => { resolve = r; });
    renderSearch();

    typeAndEnter(CODE);
    await screen.findByText('กำลังตรวจรหัส…');
    fireEvent.keyDown(input(), { key: 'Enter', code: 'Enter' });

    expect(scanCalls()).toHaveLength(1);
    resolve({ data: outcome({}) });
    await screen.findByRole('status');
  });
});
