import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterSidebar, type PlanControls } from './FilterSidebar';

function plan(over: Partial<PlanControls> = {}): PlanControls {
  return {
    down: null,
    months: null,
    monthsOptions: [10, 12],
    onDown: vi.fn(),
    onMonths: vi.fn(),
    freeDown: false,
    freeDownCount: 12,
    onFreeDown: vi.fn(),
    ...over,
  };
}
const show = (p: PlanControls) =>
  render(<FilterSidebar filters={{}} onChange={vi.fn()} models={[]} plan={p} />);

describe('กล่องเงินดาวน์เป็นบาท', () => {
  it('ช่องพิมพ์เป็นบาท — ไม่มีแถบเลื่อน ไม่มี % ไม่มีคำว่า "เรท"', () => {
    const { container } = show(plan({ down: 5000 }));
    expect(screen.getByLabelText('เงินดาวน์')).toHaveValue('5,000');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('%');
    expect(container.textContent).not.toContain('เรท');
    expect(screen.getByText(/ใส่เงินดาวน์ที่มี/)).toBeInTheDocument();
  });

  it('ออกจากช่องแล้วแจ้งจำนวนบาทกลับ', () => {
    const p = plan();
    show(p);
    const input = screen.getByLabelText('เงินดาวน์');
    fireEvent.change(input, { target: { value: '3000' } });
    fireEvent.blur(input);
    expect(p.onDown).toHaveBeenCalledWith(3000);
  });

  it('ไม่มี plan (โหมดซื้อสด) → ไม่มีกล่องเงินดาวน์', () => {
    render(<FilterSidebar filters={{}} onChange={vi.fn()} models={[]} />);
    expect(screen.queryByLabelText('เงินดาวน์')).not.toBeInTheDocument();
  });
});
