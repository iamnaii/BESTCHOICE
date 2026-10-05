import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BookingTable, { BookingCardList, toApiSort, toColumnSort } from '../components/BookingTable';
import { BOOKING_COLUMN_WIDTHS, bookingColumns } from '../components/bookingColumns';
import type { Booking } from '../types';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const NOW = new Date('2026-10-05T03:00:00.000Z').getTime();
const row = (over: Partial<Booking>): Booking => ({
  id: 'bk-1',
  bookingNumber: 'BK-20261005-0002',
  status: 'PAID',
  depositAmount: '5000',
  totalAmount: '42900',
  expireDate: '2026-10-11T17:00:00.000Z',
  depositPaidAt: '2026-10-05T03:55:00Z',
  createdAt: '2026-10-05T03:42:00Z',
  customer: { id: 'c1', name: 'สมชาย ใจดี', phone: '0812345678' },
  branch: { id: 'br-1', name: 'ลาดพร้าว' },
  createdBy: { id: 'u1', name: 'น้ำ' },
  items: [
    {
      id: 'i1',
      productId: 'p1',
      description: 'iPhone 16 Pro 256GB · ดำไทเทเนียม',
      quantity: 1,
      unitPrice: '42900',
      amount: '42900',
      product: {
        id: 'p1',
        name: 'iPhone 16 Pro 256GB',
        status: 'IN_STOCK',
        branchId: 'br-1',
        imeiSerial: '354912070045218',
      },
    },
  ],
  ...over,
});
const actions = {
  onOpen: vi.fn(),
  onCollectDeposit: vi.fn(),
  onCancel: vi.fn(),
  canMutate: true,
};
const tableProps = {
  total: 2,
  page: 1,
  onPageChange: vi.fn(),
  sort: null,
  onSortChange: vi.fn(),
  isLoading: false,
  nowMs: NOW,
  actions,
  hasActiveFilters: false,
  onClearFilters: vi.fn(),
};

describe('bookingColumns', () => {
  it('9 คอลัมน์ กว้างรวม 1,120 px พอดีจอ 1440 (งบโซน shop) และทุกคอลัมน์ตั้ง width', () => {
    const cols = bookingColumns(NOW, actions);
    expect(cols).toHaveLength(9);
    expect(Object.values(BOOKING_COLUMN_WIDTHS).reduce((a, b) => a + b, 0)).toBe(1120);
    expect(cols.every((c) => typeof c.width === 'string' && c.width.endsWith('px'))).toBe(true);
    expect(cols.map((c) => c.label)).toEqual([
      'เลขที่ / สร้างเมื่อ',
      'ลูกค้า',
      'สินค้าที่จอง',
      'สาขา',
      'มัดจำ',
      'คงเหลือ',
      'สถานะ',
      'หมดอายุ',
      '',
    ]);
    expect(cols.filter((c) => c.sortable).map((c) => c.sortKey ?? c.key)).toEqual([
      'createdAt',
      'expireDate',
    ]);
  });
});

describe('BookingTable', () => {
  it('แสดงมัดจำ "จาก ยอดรวม" คงเหลือ และวันคงเหลือสีเตือนเมื่อหมดอายุวันนี้', () => {
    render(
      <BookingTable
        {...tableProps}
        rows={[
          row({}),
          row({
            id: 'bk-2',
            bookingNumber: 'BK-20261002-0001',
            expireDate: '2026-10-05T17:00:00.000Z',
            depositAmount: '10000',
            totalAmount: '29900',
          }),
        ]}
      />,
    );
    const first = screen.getByText('BK-20261005-0002').closest('tr')!;
    expect(within(first).getByText('5,000')).toBeInTheDocument();
    expect(within(first).getByText('จาก 42,900')).toBeInTheDocument();
    expect(within(first).getByText('37,900')).toBeInTheDocument();
    expect(within(first).getByText('อีก 6 วัน')).toBeInTheDocument();
    const second = screen.getByText('BK-20261002-0001').closest('tr')!;
    expect(within(second).getByText('วันนี้')).toHaveClass('text-warning-strong');
  });

  it('ใบปิดแล้ว: คงเหลือเป็น — และคอลัมน์หมดอายุบอกเหตุการณ์', () => {
    render(
      <BookingTable
        {...tableProps}
        rows={[row({ status: 'CONVERTED', convertedAt: '2026-10-01T07:20:00Z' })]}
      />,
    );
    const tr = screen.getByText('BK-20261005-0002').closest('tr')!;
    expect(within(tr).getByText('—')).toBeInTheDocument();
    expect(within(tr).getAllByText('ขายแล้ว').length).toBeGreaterThanOrEqual(2); // ป้ายสถานะ + คอลัมน์หมดอายุ
  });

  it('กดแถวเปิดแผง · เมนู ⋯ ของใบรอมัดจำมี "รับมัดจำ" และไม่พาไปเปิดแผงซ้ำ', async () => {
    const onOpen = vi.fn();
    const onCollectDeposit = vi.fn();
    render(
      <BookingTable
        {...tableProps}
        actions={{ ...actions, onOpen, onCollectDeposit }}
        rows={[row({ status: 'PENDING_DEPOSIT', depositPaidAt: null })]}
      />,
    );
    await userEvent.click(screen.getByText('สมชาย ใจดี'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /การกระทำ BK-20261005-0002/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'รับมัดจำ' }));
    expect(onCollectDeposit).toHaveBeenCalledWith(expect.objectContaining({ id: 'bk-1' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('ผลกรองว่าง → ปุ่มล้างตัวกรอง', async () => {
    const onClearFilters = vi.fn();
    render(
      <BookingTable
        {...tableProps}
        rows={[]}
        total={0}
        hasActiveFilters
        onClearFilters={onClearFilters}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    expect(onClearFilters).toHaveBeenCalled();
  });
});

describe('การแปลงคีย์เรียง (DataTable ส่ง col.key แต่ API รู้จัก createdAt/expireDate)', () => {
  it('bookingNumber ↔ createdAt · expireDate คงเดิม · null ผ่าน', () => {
    expect(toApiSort({ key: 'bookingNumber', direction: 'asc' })).toEqual({
      key: 'createdAt',
      direction: 'asc',
    });
    expect(toColumnSort({ key: 'createdAt', direction: 'desc' })).toEqual({
      key: 'bookingNumber',
      direction: 'desc',
    });
    expect(toApiSort({ key: 'expireDate', direction: 'asc' })).toEqual({
      key: 'expireDate',
      direction: 'asc',
    });
    expect(toApiSort(null)).toBeNull();
  });
});

describe('BookingCardList (จอโทรศัพท์)', () => {
  it('การ์ดต่อใบ แสดงเลขที่ ชื่อ มัดจำ คงเหลือ และกดเปิดได้', async () => {
    const onOpen = vi.fn();
    render(<BookingCardList rows={[row({})]} nowMs={NOW} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /BK-20261005-0002/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'bk-1' }));
    expect(screen.getByText(/คงเหลือ/)).toBeInTheDocument();
  });
});
