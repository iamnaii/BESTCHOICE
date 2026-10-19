import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LimitDialog } from '../components/LimitDialog';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

type Props = Parameters<typeof LimitDialog>[0];
function renderDialog(over: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    limit: { value: '20000.00', source: 'SET', updatedAt: '2026-10-10T07:00:00.000Z' },
    balance: '6514.00',
    pending: false,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...over,
  };
  render(<LimitDialog {...props} />);
  return props;
}

describe('LimitDialog — ตั้งวงเงินเงินสดย่อย (mockup กระดาน 4)', () => {
  it('ค่าเริ่มต้นในช่อง = วงเงินปัจจุบัน · ปุ่มลัด 4 ค่า · ส่งตัวเลข', () => {
    const p = renderDialog();
    const input = screen.getByRole('spinbutton', { name: 'วงเงินเงินสดย่อย (บาท)' }) as HTMLInputElement;
    expect(input.value).toBe('20,000.00');
    fireEvent.click(screen.getByRole('button', { name: '30,000' }));
    expect(input.value).toBe('30,000.00');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกวงเงิน' }));
    expect(p.onSubmit).toHaveBeenCalledWith(30000);
  });

  it('ติดลบ / ทศนิยมเกิน 2 / เกิน 1,000,000 → ข้อความ + ปุ่มปิด · ตั้งต่ำกว่าคงเหลือได้แต่เตือน', () => {
    renderDialog();
    const input = screen.getByRole('spinbutton', { name: 'วงเงินเงินสดย่อย (บาท)' });
    const submit = screen.getByRole('button', { name: 'บันทึกวงเงิน' });
    fireEvent.change(input, { target: { value: '-1' } });
    expect(screen.getByText('วงเงินต้องเป็น 0 ขึ้นไป')).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: '12.345' } });
    expect(screen.getByText('ทศนิยมได้ไม่เกิน 2 ตำแหน่ง')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '2000000' } });
    expect(screen.getByText('วงเงินต้องไม่เกิน 1,000,000 บาท')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '5000' } });
    expect(screen.getByText(/ต่ำกว่ายอดคงเหลือ 6,514\.00 บาท/)).toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it('ยังไม่เคยตั้ง (DEFAULT) → บอกว่าใช้ค่าเริ่มต้นอยู่', () => {
    renderDialog({ limit: { value: '20000.00', source: 'DEFAULT', updatedAt: null } });
    expect(screen.getByText(/ยังไม่เคยตั้ง — ใช้ค่าเริ่มต้น 20,000\.00 บาท/)).toBeInTheDocument();
  });
});
