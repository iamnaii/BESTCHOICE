// apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts
import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/** ประเภทเอกสารในมุมของผู้ใช้ — วิธีเลือกบนจออยู่ในไฟล์นี้ไฟล์เดียว */
export type Kind = 'EXPENSE_PAID' | 'EXPENSE_UNPAID' | 'VENDOR_SETTLEMENT' | 'CREDIT_NOTE' | 'PETTY_CASH';

export async function fillExpenseLine(
  user: UserEvent,
  line: { account: string; unitPrice: string },
  index = 0,
) {
  // เทสต์ที่ใช้ driver นี้แทน AccountSearchDropdown ด้วยปุ่มที่เลือก 53-1101 เสมอ
  expect(line.account).toBe('53-1101');
  await user.click(screen.getAllByRole('button', { name: 'บัญชีค่าใช้จ่าย' })[index]);
  const price = screen.getAllByLabelText('ราคา/หน่วย')[index];
  await user.clear(price);
  await user.type(price, line.unitPrice);
}

const MENU_ITEM: Partial<Record<Kind, string>> = {
  VENDOR_SETTLEMENT: 'จ่ายชำระเจ้าหนี้',
  CREDIT_NOTE: 'ใบลดหนี้',
  PETTY_CASH: 'เงินสดย่อย',
};

export async function chooseKind(user: UserEvent, kind: Kind) {
  if (kind === 'EXPENSE_PAID') {
    // หน้าเปิดมาเป็นจ่ายแล้ว — กดเฉพาะเมื่ออยู่ที่ "ยังไม่ชำระ"
    const addPayment = screen.queryByRole('button', { name: 'เพิ่มข้อมูลชำระเงิน' });
    if (addPayment) await user.click(addPayment);
    return;
  }
  if (kind === 'EXPENSE_UNPAID') {
    await user.click(screen.getByRole('button', { name: 'ยังไม่ชำระเงิน (ตั้งหนี้ไว้ก่อน)' }));
    return;
  }
  await user.click(screen.getByRole('button', { name: /^เปลี่ยนประเภทเอกสาร/ }));
  await user.click(await screen.findByRole('menuitem', { name: MENU_ITEM[kind]! }));
}

export async function openAdjustments(user: UserEvent) {
  await user.click(screen.getByRole('radio', { name: 'ขั้นสูง' }));
  await screen.findByLabelText('ยอดที่จ่ายจริง');
}

export async function saveDraft(user: UserEvent) {
  const button = screen.getByRole('button', { name: 'บันทึกร่าง' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}
