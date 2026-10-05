import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BookingFilterBar, {
  BOOKING_SEARCH_PLACEHOLDER,
  statusPatch,
  statusSelectValue,
} from '../components/BookingFilterBar';

function renderBar(over: Partial<React.ComponentProps<typeof BookingFilterBar>> = {}) {
  const props = {
    search: '',
    setSearch: vi.fn(),
    view: 'open' as const,
    status: '',
    branchId: '',
    from: '',
    to: '',
    branches: [{ id: 'b1', name: 'ลาดพร้าว' }],
    canFilterBranch: true,
    setFilters: vi.fn(),
    ...over,
  };
  render(<BookingFilterBar {...props} />);
  return props;
}

describe('BookingFilterBar', () => {
  it('พิมพ์ค้นหาแล้วเรียก setSearch', async () => {
    const props = renderBar();
    const input = screen.getByPlaceholderText(BOOKING_SEARCH_PLACEHOLDER);
    await userEvent.type(input, 'ก');
    expect(props.setSearch).toHaveBeenCalledWith('ก');
  });

  it('แสดงดรอปดาวน์สถานะ สาขา และช่วงวันที่ — ซ่อนสาขาเมื่อไม่มีสิทธิ์', () => {
    renderBar();
    expect(screen.getByLabelText('สถานะใบจอง')).toBeInTheDocument();
    expect(screen.getByLabelText('สาขา')).toBeInTheDocument();
    expect(screen.getByText('ทั้งหมด', { selector: 'button' })).toBeInTheDocument();
  });

  it('ไม่แสดงสาขาเมื่อ canFilterBranch = false', () => {
    renderBar({ canFilterBranch: false });
    expect(screen.queryByLabelText('สาขา')).not.toBeInTheDocument();
  });

  it('ค่าดรอปดาวน์ ↔ มุมมองใน URL', () => {
    expect(statusSelectValue('open', '')).toBe('OPEN');
    expect(statusSelectValue('expiring', '')).toBe('OPEN');
    expect(statusSelectValue('all', '')).toBe('ALL');
    expect(statusSelectValue('status', 'PAID')).toBe('PAID');
  });

  it('ทุกการเลือกเขียนทับ status/all/expiring ครบในครั้งเดียว', () => {
    expect(statusPatch('OPEN')).toEqual({ all: '', status: '', expiring: '' });
    expect(statusPatch('ALL')).toEqual({ all: '1', status: '', expiring: '' });
    expect(statusPatch('PAID')).toEqual({ status: 'PAID', all: '', expiring: '' });
    expect(statusPatch('CLOSED')).toEqual({ status: 'CLOSED', all: '', expiring: '' });
  });
});
