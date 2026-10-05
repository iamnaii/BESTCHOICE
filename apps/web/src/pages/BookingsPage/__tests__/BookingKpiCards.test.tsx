import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BookingKpiCards, { bookingKpiCards } from '../components/BookingKpiCards';

const summary = {
  total: 8,
  open: 5,
  pendingDeposit: 1,
  paid: 4,
  paidDepositHeld: '33900.00',
  expiringWithin3Days: 3,
  closed: { converted: 1, canceled: 1, expired: 1, total: 3 },
  forfeitedThisMonth: '3000.00',
};

describe('BookingKpiCards', () => {
  it('6 ใบ: 5 ใบกดกรองได้ และใบ "ริบเดือนนี้" เป็นตัวเลขอย่างเดียว', () => {
    const specs = bookingKpiCards(summary);
    expect(specs.map((s) => s.key)).toEqual([
      'open',
      'pendingDeposit',
      'paid',
      'expiring',
      'closed',
      'forfeited',
    ]);
    expect(specs.filter((s) => s.params)).toHaveLength(5);
    expect(specs.find((s) => s.key === 'paid')).toMatchObject({
      value: '4',
      sub: 'ถือมัดจำอยู่ ฿33,900',
    });
    expect(specs.find((s) => s.key === 'forfeited')).toMatchObject({
      value: '฿3,000',
      params: undefined,
    });
  });

  it('ทุกใบที่กดได้เขียนทับ status/expiring/all ครบ (กดต่อกันแล้วไม่ซ้อน)', () => {
    for (const spec of bookingKpiCards(summary).filter((s) => s.params)) {
      expect(Object.keys(spec.params!).sort()).toEqual(['all', 'expiring', 'status']);
    }
    expect(bookingKpiCards(summary).find((s) => s.key === 'open')!.params).toEqual({
      status: '',
      expiring: '',
      all: '',
    });
    expect(bookingKpiCards(summary).find((s) => s.key === 'expiring')!.params).toEqual({
      status: '',
      expiring: '3',
      all: '',
    });
    expect(bookingKpiCards(summary).find((s) => s.key === 'closed')!.params).toEqual({
      status: 'CLOSED',
      expiring: '',
      all: '',
    });
  });

  it('กดใบ "ใกล้หมดอายุ" ส่ง params ของใบนั้น และใบที่ active มี aria-pressed', async () => {
    const onPick = vi.fn();
    render(<BookingKpiCards summary={summary} activeKey="open" onPick={onPick} />);
    expect(screen.getByRole('button', { name: /ที่ยังเปิดอยู่/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: /ใกล้หมดอายุ/ }));
    expect(onPick).toHaveBeenCalledWith({ status: '', expiring: '3', all: '' });
    expect(screen.queryByRole('button', { name: /ริบเดือนนี้/ })).toBeNull();
  });

  it('ยังไม่มีสรุป → แสดง 0 ไม่พัง', () => {
    render(<BookingKpiCards activeKey="" onPick={() => {}} />);
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });
});
