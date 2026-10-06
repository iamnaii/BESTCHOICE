import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BookingTable, { toApiSort, toColumnSort } from '../components/BookingTable';
import { bookingColumns } from '../components/bookingColumns';
import type { Booking } from '../types';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => true }));

const NOW = new Date('2026-10-05T03:00:00.000Z').getTime();
const row = (over: Partial<Booking> = {}): Booking => ({
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
      description: 'iPhone 16 Pro',
      quantity: 1,
      unitPrice: '42900',
      amount: '42900',
    },
  ],
  ...over,
});
const actions = { onOpen: vi.fn(), onCollectDeposit: vi.fn(), onCancel: vi.fn(), canMutate: true };
const base = {
  rows: [row()],
  total: 1,
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

describe('BookingTable มือถือ', () => {
  it('แบ่งหน้า: หน้า 2/3 · ถัดไป=3 · ก่อนหน้า=1', async () => {
    const onPageChange = vi.fn();
    render(<BookingTable {...base} total={120} page={2} onPageChange={onPageChange} />);
    expect(screen.getByText('หน้า 2/3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: 'ก่อนหน้า' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('ผลกรองว่าง → ล้างตัวกรอง', async () => {
    const onClearFilters = vi.fn();
    render(
      <BookingTable
        {...base}
        rows={[]}
        total={0}
        hasActiveFilters
        onClearFilters={onClearFilters}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('กำลังโหลดและยังไม่มีแถว → ไม่โชว์ "ไม่พบใบจอง"', () => {
    render(<BookingTable {...base} rows={[]} total={0} isLoading />);
    expect(screen.queryByText('ไม่พบใบจอง')).not.toBeInTheDocument();
  });
});

describe('เมนู ⋯ ตามสถานะ', () => {
  const menuOf = (b: Booking, canMutate = true) => {
    const col = bookingColumns(NOW, { ...actions, canMutate }).find((c) => c.key === 'menu')!;
    render(<>{col.render!(b, col, 0)}</>);
    return userEvent.click(screen.getByRole('button', { name: /การกระทำ/ }));
  };
  it('PAID: ยกเลิกใบจอง ไม่มีรับมัดจำ', async () => {
    await menuOf(row());
    expect(await screen.findByRole('menuitem', { name: 'ยกเลิกใบจอง' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'รับมัดจำ' })).not.toBeInTheDocument();
  });
  it('CONVERTED: เฉพาะเปิด', async () => {
    await menuOf(row({ status: 'CONVERTED' }));
    expect(await screen.findByRole('menuitem', { name: 'เปิด' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  });
  it('เลยกำหนดแต่ cron ยังไม่ปิด: เมนูเหลือ "เปิด" อย่างเดียว (ใช้เมทริกซ์เดียวกับแผง)', async () => {
    await menuOf(row({ status: 'PENDING_DEPOSIT', expireDate: '2000-01-01T17:00:00.000Z' }));
    expect(await screen.findByRole('menuitem', { name: 'เปิด' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  });
  it('canMutate=false ซ่อนรายการแก้ไข', async () => {
    await menuOf(row({ status: 'PENDING_DEPOSIT' }), false);
    expect(await screen.findByRole('menuitem', { name: 'เปิด' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  });
});

describe('sort round-trip', () => {
  it('createdAt / expireDate / คีย์แปลก', () => {
    for (const key of ['createdAt', 'expireDate', 'weird']) {
      const s = { key, direction: 'desc' as const };
      expect(toApiSort(toColumnSort(s))).toEqual(s);
    }
  });
});
