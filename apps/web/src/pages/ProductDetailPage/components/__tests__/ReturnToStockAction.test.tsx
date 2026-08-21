import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ReturnToStockAction from '../ReturnToStockAction';

const BUTTON = 'นำเข้าคลังพร้อมขาย';

describe('ReturnToStockAction (Phase 5 T3)', () => {
  it('ไม่โผล่เมื่อสถานะไม่ใช่ REFURBISHED', () => {
    render(<ReturnToStockAction status="IN_STOCK" canManage isPending={false} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('ไม่โผล่เมื่อสิทธิ์ไม่ถึง (SALES/ACCOUNTANT) แม้สถานะจะ REFURBISHED', () => {
    render(
      <ReturnToStockAction status="REFURBISHED" canManage={false} isPending={false} onConfirm={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('REFURBISHED + สิทธิ์ผ่าน → กดแล้วขึ้น dialog ยืนยันภาษาไทยที่บอกผลลัพธ์', async () => {
    render(<ReturnToStockAction status="REFURBISHED" canManage isPending={false} onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));

    expect(await screen.findByText(/เครื่องจะพร้อมขายที่ POS/)).toBeTruthy();
  });

  it('ยืนยันแล้วส่ง note ที่กรอกกลับไปให้ผู้เรียก', async () => {
    const onConfirm = vi.fn();
    render(<ReturnToStockAction status="REFURBISHED" canManage isPending={false} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));
    await userEvent.type(await screen.findByLabelText(/หมายเหตุ/), 'ตรวจสภาพแล้ว');
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันนำเข้าคลัง' }));

    expect(onConfirm).toHaveBeenCalledWith('ตรวจสภาพแล้ว');
  });

  it('ไม่กรอกหมายเหตุก็ยืนยันได้ (ส่ง undefined)', async () => {
    const onConfirm = vi.fn();
    render(<ReturnToStockAction status="REFURBISHED" canManage isPending={false} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยันนำเข้าคลัง' }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });
});
