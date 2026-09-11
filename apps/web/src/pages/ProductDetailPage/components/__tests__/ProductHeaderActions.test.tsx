import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copy: vi.fn().mockResolvedValue(true), copied: false, error: null }),
}));

import ProductHeaderActions from '../ProductHeaderActions';

const contract = {
  id: 'c-1',
  contractNumber: 'CT-2026-09-0123',
  status: 'ACTIVE',
  createdAt: '2026-09-05T03:00:00.000Z',
  customerName: 'วรรณา สุขใจ',
  salespersonName: 'เอ',
  sellingPrice: '19900',
  downPayment: '2985',
  totalMonths: 12,
  monthlyPayment: '1838.26',
  paidInstallments: 1,
  nextDueDate: null,
};

function renderActions(props: Partial<Parameters<typeof ProductHeaderActions>[0]> = {}) {
  const onEdit = vi.fn();
  const onTransfer = vi.fn();
  render(
    <BrowserRouter>
      <ProductHeaderActions
        product={{ id: 'p1', status: 'IN_STOCK', activeContract: null }}
        isManager
        isReady
        summaryText="สรุป"
        shareUrl="https://shop/x"
        canTransfer
        onEdit={onEdit}
        onTransfer={onTransfer}
        returnToStock={null}
        {...props}
      />
    </BrowserRouter>,
  );
  return { onEdit, onTransfer };
}

describe('ProductHeaderActions — ปุ่มหัวหน้าตามสถานะเครื่อง', () => {
  it('พร้อมขาย (manager): ปุ่มหลักคัดลอกสรุป · คัดลอกลิงก์ · แก้ไขข้อมูล · เมนู ⋯ มีโอนสาขา · ไม่มีปุ่ม "กลับ"', async () => {
    const { onEdit, onTransfer } = renderActions();
    expect(screen.getByRole('button', { name: /คัดลอกสรุปส่งลูกค้า/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /คัดลอกลิงก์/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'กลับ' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/ }));
    expect(onEdit).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'เมนูเพิ่มเติม' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /โอนสาขา/ }));
    expect(onTransfer).toHaveBeenCalled();
  });

  it('ยังไม่ขึ้นเว็บ → ปุ่มคัดลอกลิงก์ disabled', () => {
    renderActions({ isReady: false });
    expect(screen.getByRole('button', { name: /คัดลอกลิงก์/ })).toBeDisabled();
  });

  it('ขายผ่อนแล้ว: ปุ่มหลัก "เปิดสัญญา CT-…" ไปหน้าสัญญา · ไม่มีคัดลอกสรุป/ลิงก์', () => {
    renderActions({
      product: { id: 'p1', status: 'SOLD_INSTALLMENT', activeContract: contract },
      canTransfer: false,
    });
    expect(screen.getByRole('link', { name: /เปิดสัญญา CT-2026-09-0123/ })).toHaveAttribute(
      'href',
      '/contracts/c-1',
    );
    expect(screen.queryByRole('button', { name: /คัดลอกสรุปส่งลูกค้า/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /คัดลอกลิงก์/ })).toBeNull();
  });

  it('SALES (ไม่ใช่ manager): ไม่มีแก้ไขข้อมูล และไม่มีเมนู ⋯ เมื่อไม่มีรายการ', () => {
    renderActions({ isManager: false, canTransfer: false });
    expect(screen.queryByRole('button', { name: /แก้ไขข้อมูล/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'เมนูเพิ่มเติม' })).toBeNull();
    expect(screen.getByRole('button', { name: /คัดลอกสรุปส่งลูกค้า/ })).toBeInTheDocument();
  });

  it('ซ่อมแล้ว (REFURBISHED): ปุ่มนำเข้าคลังที่ส่งมาแสดงก่อนปุ่มอื่น', () => {
    renderActions({
      product: { id: 'p1', status: 'REFURBISHED', activeContract: null },
      returnToStock: <button type="button">นำเข้าคลังพร้อมขาย</button>,
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('นำเข้าคลังพร้อมขาย');
  });
});
