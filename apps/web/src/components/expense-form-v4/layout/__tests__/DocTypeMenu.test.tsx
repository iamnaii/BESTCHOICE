import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocTypeMenu, docTypeLabel } from '../DocTypeMenu';

const open = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /^เปลี่ยนประเภทเอกสาร/ }));
  return user;
};

describe('DocTypeMenu', () => {
  it('จ่ายทันทีและตั้งหนี้ใช้ชื่อเดียวกัน', () => {
    expect(docTypeLabel('EXPENSE_SAMEDAY')).toBe('บันทึกค่าใช้จ่าย');
    expect(docTypeLabel('EXPENSE_ACCRUAL')).toBe('บันทึกค่าใช้จ่าย');
  });

  it('แสดงครบ 5 รายการเมื่อเปิดทุกอย่าง', async () => {
    render(<DocTypeMenu value="EXPENSE_SAMEDAY" onChange={() => {}} />);
    await open();
    expect((await screen.findAllByRole('menuitemradio')).map((i) => i.textContent)).toEqual([
      'บันทึกค่าใช้จ่าย', 'จ่ายชำระเจ้าหนี้', 'เงินเดือน', 'ใบลดหนี้', 'เงินสดย่อย',
    ]);
  });

  // คำตัดสินเจ้าของ 2026-10-28 — ผู้จัดการสาขาไม่เห็น "เงินเดือน"
  it('ไม่มีเงินเดือนเมื่อ payrollEnabled=false และไม่มีเงินสดย่อยเมื่อปิด flag', async () => {
    render(<DocTypeMenu value="EXPENSE_SAMEDAY" onChange={() => {}} payrollEnabled={false} pettyCashEnabled={false} />);
    await open();
    expect(await screen.findByRole('menuitemradio', { name: 'ใบลดหนี้' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'เงินเดือน' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'เงินสดย่อย' })).not.toBeInTheDocument();
  });

  it('เลือกประเภทอื่นแล้วส่งค่า · เลือกบันทึกค่าใช้จ่ายจากประเภทอื่นได้จ่ายทันที', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<DocTypeMenu value="EXPENSE_SAMEDAY" onChange={onChange} />);
    let user = await open();
    await user.click(await screen.findByRole('menuitemradio', { name: 'ใบลดหนี้' }));
    expect(onChange).toHaveBeenLastCalledWith('CREDIT_NOTE');
    rerender(<DocTypeMenu value="CREDIT_NOTE" onChange={onChange} />);
    user = await open();
    await user.click(await screen.findByRole('menuitemradio', { name: 'บันทึกค่าใช้จ่าย' }));
    expect(onChange).toHaveBeenLastCalledWith('EXPENSE_SAMEDAY');
  });

  it('อยู่ที่ตั้งหนี้แล้วเลือกบันทึกค่าใช้จ่ายซ้ำ ไม่เปลี่ยนเป็นจ่ายทันที', async () => {
    const onChange = vi.fn();
    render(<DocTypeMenu value="EXPENSE_ACCRUAL" onChange={onChange} />);
    const user = await open();
    await user.click(await screen.findByRole('menuitemradio', { name: 'บันทึกค่าใช้จ่าย' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('locked แสดงชื่ออย่างเดียว ไม่มีปุ่มเปิดเมนู', () => {
    render(<DocTypeMenu value="PAYROLL" onChange={() => {}} locked />);
    expect(screen.getByRole('heading', { level: 1, name: 'เงินเดือน' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('locked: ชื่อเอกสารอยู่ใน span ในหัวเรื่อง (ขนาดเท่าตอนเลือกประเภทได้ ไม่ถูกกฎ h1 ทั่วทั้งหน้าทับ)', () => {
    render(<DocTypeMenu value="PAYROLL" onChange={() => {}} locked />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'เงินเดือน' });
    expect(h1).toHaveClass('m-0');
    expect(h1.firstElementChild?.tagName).toBe('SPAN');
  });

  it('ชื่อเอกสารเป็นหัวเรื่องระดับ 1 ของหน้า', () => {
    render(<DocTypeMenu value="EXPENSE_SAMEDAY" onChange={() => {}} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('บอกรายการที่เลือกอยู่ด้วย aria-checked', async () => {
    render(<DocTypeMenu value="CREDIT_NOTE" onChange={() => {}} />);
    await open();
    expect(await screen.findByRole('menuitemradio', { name: 'ใบลดหนี้' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'เงินเดือน' })).toHaveAttribute('aria-checked', 'false');
  });
});
