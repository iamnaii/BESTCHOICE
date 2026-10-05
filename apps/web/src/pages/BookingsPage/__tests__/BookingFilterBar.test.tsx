import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import BookingFilterBar, {
  BOOKING_SEARCH_PLACEHOLDER,
  statusPatch,
  statusSelectValue,
} from '../components/BookingFilterBar';

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
});

function renderBar(over: Partial<React.ComponentProps<typeof BookingFilterBar>> = {}) {
  const props = {
    search: '',
    setSearch: vi.fn(),
    view: 'open' as const,
    status: '',
    branchId: '',
    from: '',
    to: '',
    branches: [
      { id: 'br-1', name: 'ลาดพร้าว' },
      { id: 'br-2', name: 'ลพบุรี' },
    ],
    canFilterBranch: true,
    setFilters: vi.fn(),
    ...over,
  };
  render(<BookingFilterBar {...props} />);
  return props;
}

async function pick(trigger: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: trigger }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('BookingFilterBar', () => {
  it('พิมพ์ค้นหาแล้วเรียก setSearch', async () => {
    const props = renderBar();
    await userEvent.type(screen.getByPlaceholderText(BOOKING_SEARCH_PLACEHOLDER), 'ก');
    expect(props.setSearch).toHaveBeenCalledWith('ก');
  });

  it('มีดรอปดาวน์สถานะและสาขา — ซ่อนสาขาเมื่อไม่มีสิทธิ์', () => {
    renderBar();
    expect(screen.getByRole('combobox', { name: 'สถานะใบจอง' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'สาขา' })).toBeInTheDocument();
  });

  it('ไม่แสดงสาขาเมื่อ canFilterBranch = false', () => {
    renderBar({ canFilterBranch: false });
    expect(screen.queryByRole('combobox', { name: 'สาขา' })).not.toBeInTheDocument();
  });

  it('เลือก "ทั้งหมด" ผ่าน select จริง → all=1', async () => {
    const props = renderBar();
    await pick('สถานะใบจอง', 'ทั้งหมด');
    expect(props.setFilters).toHaveBeenCalledTimes(1);
    expect(props.setFilters).toHaveBeenCalledWith({ all: '1', status: '', expiring: '' });
  });

  it('เลือก "ใกล้หมดอายุ" ผ่าน select จริง → expiring=3', async () => {
    const props = renderBar();
    await pick('สถานะใบจอง', 'ใกล้หมดอายุ (≤3 วัน)');
    expect(props.setFilters).toHaveBeenCalledTimes(1);
    expect(props.setFilters).toHaveBeenCalledWith({ expiring: '3', status: '', all: '' });
  });

  it('เลือก "ที่ยังเปิดอยู่" (placeholder) → ล้างทั้งสามคีย์', async () => {
    const props = renderBar({ view: 'all' });
    await pick('สถานะใบจอง', 'ที่ยังเปิดอยู่');
    expect(props.setFilters).toHaveBeenCalledWith({ all: '', status: '', expiring: '' });
  });

  it('trigger แสดงมุมมองปัจจุบัน', () => {
    renderBar({ view: 'expiring' });
    expect(screen.getByRole('combobox', { name: 'สถานะใบจอง' })).toHaveTextContent(
      'ใกล้หมดอายุ (≤3 วัน)',
    );
  });

  it('view=open → "ที่ยังเปิดอยู่"', () => {
    renderBar({ view: 'open' });
    expect(screen.getByRole('combobox', { name: 'สถานะใบจอง' })).toHaveTextContent(
      'ที่ยังเปิดอยู่',
    );
  });

  it('เปลี่ยนสาขา → setFilters({ branchId })', async () => {
    const props = renderBar();
    await pick('สาขา', 'ลพบุรี');
    expect(props.setFilters).toHaveBeenCalledWith({ branchId: 'br-2' });
  });

  it('เปลี่ยนช่วงวันที่ → setFilters({ from, to })', async () => {
    const props = renderBar({ from: '2026-10-01', to: '2026-10-31' });
    await userEvent.click(screen.getByRole('radio', { name: 'ทั้งหมด' }));
    expect(props.setFilters).toHaveBeenCalledWith({ from: '', to: '' });
  });

  it('ค่าดรอปดาวน์ ↔ มุมมองใน URL', () => {
    expect(statusSelectValue('open', '')).toBe('');
    expect(statusSelectValue('all', '')).toBe('ALL_STATUSES');
    expect(statusSelectValue('expiring', '')).toBe('EXPIRING');
    expect(statusSelectValue('status', 'CLOSED')).toBe('CLOSED');
  });

  it.each(['CONVERTED', 'CANCELED', 'EXPIRED'])(
    'ลิงก์ ?status=%s (สถานะปิดเดี่ยว) → ดรอปดาวน์โชว์ "ปิดแล้ว" ไม่ใช่ช่องว่าง',
    (status) => {
      expect(statusSelectValue('status', status)).toBe('CLOSED');
    },
  );

  it('ทุกการเลือกเขียนทับ status/all/expiring ครบ', () => {
    expect(statusPatch('')).toEqual({ all: '', status: '', expiring: '' });
    expect(statusPatch('ALL_STATUSES')).toEqual({ all: '1', status: '', expiring: '' });
    expect(statusPatch('EXPIRING')).toEqual({ expiring: '3', status: '', all: '' });
    expect(statusPatch('PAID')).toEqual({ status: 'PAID', all: '', expiring: '' });
    expect(statusPatch('CLOSED')).toEqual({ status: 'CLOSED', all: '', expiring: '' });
  });
});
