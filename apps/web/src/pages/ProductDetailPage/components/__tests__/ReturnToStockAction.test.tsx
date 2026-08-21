import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ReturnToStockAction from '../ReturnToStockAction';

const BUTTON = 'นำเข้าคลังพร้อมขาย';
const CONFIRM = 'ยืนยันนำเข้าคลัง';

const base = {
  status: 'REFURBISHED',
  canManage: true,
  isPending: false,
  currentCashPrice: 15900,
  currentInstallmentPrice: null as number | null,
};

describe('ReturnToStockAction (Phase 5 T3 + fix round 1)', () => {
  it('ไม่โผล่เมื่อสถานะไม่ใช่ REFURBISHED', () => {
    render(<ReturnToStockAction {...base} status="IN_STOCK" onConfirm={vi.fn()} />);
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('ไม่โผล่เมื่อสิทธิ์ไม่ถึง (SALES/ACCOUNTANT) แม้สถานะจะ REFURBISHED', () => {
    render(<ReturnToStockAction {...base} canManage={false} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('REFURBISHED + สิทธิ์ผ่าน → กดแล้วขึ้น dialog ยืนยันภาษาไทยที่บอกผลลัพธ์', async () => {
    render(<ReturnToStockAction {...base} onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));

    expect(await screen.findByText(/เครื่องจะพร้อมขายที่ POS/)).toBeTruthy();
  });

  // fix round 1 [Important 2] — ราคาที่ค้างอยู่บนเครื่องคือราคาจากตอนขายครั้งก่อน
  // (ไม่มี flow ไหนล้างคอลัมน์ราคา) ⇒ ต้องเตือนคนกด ไม่ใช่ปล่อยผ่านเงียบ ๆ
  it('เติมราคาปัจจุบันให้ล่วงหน้า พร้อมป้ายบอกว่าเป็นราคาจากตอนขายครั้งก่อน', async () => {
    render(<ReturnToStockAction {...base} onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));

    expect(await screen.findByText(/ราคาจากตอนขายครั้งก่อน/)).toBeTruthy();
    expect(((await screen.findByLabelText(/ราคาเงินสด/)) as HTMLInputElement).value).toBe('15900');
  });

  it('ยืนยันโดยไม่แก้ราคา → ส่งราคาเดิมกลับไป (ผ่านตาคนแล้ว ถือว่ายืนยัน)', async () => {
    const onConfirm = vi.fn();
    render(<ReturnToStockAction {...base} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));
    await userEvent.click(await screen.findByRole('button', { name: CONFIRM }));

    expect(onConfirm).toHaveBeenCalledWith({
      cashPrice: 15900,
      installmentPrice: undefined,
      note: undefined,
    });
  });

  it('แก้ราคาแล้วยืนยัน → ส่งราคาใหม่ + note', async () => {
    const onConfirm = vi.fn();
    render(<ReturnToStockAction {...base} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));

    const cash = await screen.findByLabelText(/ราคาเงินสด/);
    await userEvent.clear(cash);
    await userEvent.type(cash, '9900');
    await userEvent.type(await screen.findByLabelText(/หมายเหตุ/), 'ตรวจสภาพแล้ว');
    await userEvent.click(screen.getByRole('button', { name: CONFIRM }));

    expect(onConfirm).toHaveBeenCalledWith({
      cashPrice: 9900,
      installmentPrice: undefined,
      note: 'ตรวจสภาพแล้ว',
    });
  });

  it('ล้างราคาจนว่างทั้งสองช่อง → ปุ่มยืนยันกดไม่ได้ + บอกเหตุผล', async () => {
    const onConfirm = vi.fn();
    render(<ReturnToStockAction {...base} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));
    await userEvent.clear(await screen.findByLabelText(/ราคาเงินสด/));

    expect(await screen.findByText(/ต้องระบุราคาอย่างน้อยหนึ่งช่อง/)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: CONFIRM });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('เครื่องที่ไม่เคยมีราคา → ช่องว่าง ไม่มีป้ายราคาเก่า', async () => {
    render(
      <ReturnToStockAction
        {...base}
        currentCashPrice={null}
        currentInstallmentPrice={null}
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));

    expect(((await screen.findByLabelText(/ราคาเงินสด/)) as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/ราคาจากตอนขายครั้งก่อน/)).toBeNull();
  });
});
