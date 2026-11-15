import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaymentSection } from '../PaymentSection';

const picker = <div>ตัวเลือกบัญชี</div>;
const content = <div>รายการปรับปรุง</div>;
const unpaid = (over: Partial<{ active: boolean; backdatedHint: boolean }> = {}) => ({
  active: false, backdatedHint: false, onMarkUnpaid: vi.fn(), onMarkPaid: vi.fn(), ...over,
});

describe('PaymentSection', () => {
  it('พื้นฐาน: เห็นตัวเลือกบัญชี ไม่เห็นรายการปรับปรุง · กดขั้นสูงแล้วเห็น', async () => {
    render(<PaymentSection picker={picker} advanced={{ hasData: false, onClear: vi.fn(), content }} />);
    expect(screen.getByText('ตัวเลือกบัญชี')).toBeInTheDocument();
    expect(screen.queryByText('รายการปรับปรุง')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'ขั้นสูง' }));
    expect(screen.getByText('รายการปรับปรุง')).toBeInTheDocument();
  });

  it('มีข้อมูลปรับปรุง: เปิดขั้นสูงเอง และกลับพื้นฐานไม่ได้จนกว่าจะล้าง', async () => {
    const onClear = vi.fn();
    render(<PaymentSection picker={picker} advanced={{ hasData: true, onClear, content }} />);
    expect(screen.getByText('รายการปรับปรุง')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'พื้นฐาน' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'ล้างรายการปรับปรุง' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('ไม่มี advanced: ไม่มีสวิตช์ พื้นฐาน/ขั้นสูง', () => {
    render(<PaymentSection picker={picker} footer={<p>หมายเหตุ</p>} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('หมายเหตุ')).toBeInTheDocument();
  });

  it('กดยังไม่ชำระเงินแล้วเรียก onMarkUnpaid', async () => {
    const u = unpaid();
    render(<PaymentSection picker={picker} unpaid={u} />);
    await userEvent.click(screen.getByRole('button', { name: 'ยังไม่ชำระเงิน (ตั้งหนี้ไว้ก่อน)' }));
    expect(u.onMarkUnpaid).toHaveBeenCalledTimes(1);
  });

  it('ยังไม่ชำระ: ย่อเหลือบรรทัดเดียว มีลิงก์กลับ และไม่มีตัวเลือกบัญชี', async () => {
    const u = unpaid({ active: true, backdatedHint: true });
    render(<PaymentSection picker={picker} unpaid={u} />);
    expect(screen.getByText('ยังไม่ชำระเงิน — ตั้งหนี้ไว้ก่อน')).toBeInTheDocument();
    expect(screen.getByText('วันที่ใบกำกับไม่ใช่วันนี้ — เอกสารนี้ตั้งหนี้ไว้ก่อน')).toBeInTheDocument();
    expect(screen.queryByText('ตัวเลือกบัญชี')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'เพิ่มข้อมูลชำระเงิน' }));
    expect(u.onMarkPaid).toHaveBeenCalledTimes(1);
  });

  it('ยังไม่ชำระแต่มีข้อมูลปรับปรุงค้าง: เตือนและมีปุ่มล้าง', async () => {
    const onClear = vi.fn();
    render(<PaymentSection picker={picker} unpaid={unpaid({ active: true })} advanced={{ hasData: true, onClear, content }} />);
    expect(screen.getByRole('status')).toHaveTextContent('มีรายการปรับปรุงที่กรอกไว้ ซึ่งจะถูกบันทึกไปด้วย');
    await userEvent.click(screen.getByRole('button', { name: 'ล้างรายการปรับปรุง' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
