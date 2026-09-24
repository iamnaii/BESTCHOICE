import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GfinSlotPicker from './GfinSlotPicker';
import { SLOT_ORDER } from './gfin';

const counts = Object.fromEntries(SLOT_ORDER.map((s) => [s, 0])) as Record<(typeof SLOT_ORDER)[number], number>;

describe('GfinSlotPicker', () => {
  it('lists the 9 primary slots with counts, reveals the optional ones on demand, and confirms the chosen slot', () => {
    const onPick = vi.fn();
    render(<GfinSlotPicker open onOpenChange={vi.fn()} counts={{ ...counts, INCOME: 5 }} onPick={onPick} />);
    expect(screen.getByText('ใส่ช่องไหนของใบยื่น GFIN?')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(9);
    expect(screen.getByRole('radio', { name: /สลิปเงินเดือน/ })).toHaveTextContent('5 → 6');
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มช่อง' }));
    expect(screen.getAllByRole('radio')).toHaveLength(13);
    fireEvent.click(screen.getByRole('radio', { name: /บัตรประชาชน/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ใส่ช่องนี้' }));
    expect(onPick).toHaveBeenCalledWith('ID_CARD');
  });
  it('confirm is disabled until a slot is chosen', () => {
    render(<GfinSlotPicker open onOpenChange={vi.fn()} counts={counts} onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'ใส่ช่องนี้' })).toBeDisabled();
  });
});
