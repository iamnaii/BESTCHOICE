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

describe('ช่องติ๊กฟรีดาวน์ในกล่องเงินดาวน์', () => {
  it('แสดงพร้อมจำนวนเครื่อง และกดแล้วแจ้งกลับ', () => {
    const p = plan();
    show(p);
    const box = screen.getByRole('checkbox', { name: /ฟรีดาวน์/ });
    expect(box).not.toBeChecked();
    expect(screen.getByText('12 เครื่อง')).toBeInTheDocument();
    fireEvent.click(box);
    expect(p.onFreeDown).toHaveBeenCalledWith(true);
  });

  it('ไม่มีเครื่องฟรีดาวน์และไม่ได้ติ๊ก → ไม่แสดงช่องติ๊ก', () => {
    show(plan({ freeDownCount: 0 }));
    expect(screen.queryByRole('checkbox', { name: /ฟรีดาวน์/ })).not.toBeInTheDocument();
  });

  it('ติ๊กอยู่ → ยังแสดงแม้นับได้ 0 · ช่องเงินดาวน์ใช้ไม่ได้และแสดง 0 (ไม่มีแถบเลื่อนแล้ว) · เอาติ๊กออกได้', () => {
    const p = plan({ freeDown: true, freeDownCount: 0 });
    show(p);
    const box = screen.getByRole('checkbox', { name: /ฟรีดาวน์/ });
    expect(box).toBeChecked();
    expect(screen.getByLabelText('เงินดาวน์')).toBeDisabled();
    expect(screen.getByLabelText('เงินดาวน์')).toHaveValue('0');
    expect(screen.queryByLabelText('เลื่อนปรับเงินดาวน์')).not.toBeInTheDocument();
    expect(screen.getByText(/กำลังแสดงเฉพาะเครื่องที่ไม่ต้องวางดาวน์/)).toBeInTheDocument();
    fireEvent.click(box);
    expect(p.onFreeDown).toHaveBeenCalledWith(false);
  });

  it('ติ๊กอยู่ → ช่องจำนวนงวดใช้ไม่ได้ด้วย · ไม่ติ๊ก → ใช้ได้', () => {
    const { unmount } = show(plan({ freeDown: true }));
    expect(screen.getByLabelText('จำนวนงวด')).toBeDisabled();
    unmount();
    show(plan());
    expect(screen.getByLabelText('จำนวนงวด')).toBeEnabled();
  });
});
