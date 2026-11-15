// apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts
import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/** ประเภทเอกสารในมุมของผู้ใช้ — วิธีเลือกบนจออยู่ในไฟล์นี้ไฟล์เดียว */
export type Kind = 'EXPENSE_PAID' | 'EXPENSE_UNPAID' | 'VENDOR_SETTLEMENT' | 'CREDIT_NOTE' | 'PETTY_CASH';

const CHIP: Record<Kind, RegExp> = {
  EXPENSE_PAID: /^จ่ายทันที/,
  EXPENSE_UNPAID: /^ตั้งหนี้/,
  VENDOR_SETTLEMENT: /^จ่ายเจ้าหนี้/,
  CREDIT_NOTE: /^ใบลดหนี้/,
  PETTY_CASH: /^เงินสดย่อย/,
};

export async function chooseKind(user: UserEvent, kind: Kind) {
  await user.click(screen.getByRole('button', { name: CHIP[kind] }));
}

export async function fillExpenseLine(
  user: UserEvent,
  line: { account: string; unitPrice: string },
  index = 0,
) {
  // ตัวเลือกบัญชีโหลดจาก query — รอให้มีตัวเลือกก่อนเลือก
  await waitFor(() => {
    const select = screen.getAllByLabelText('บัญชีค่าใช้จ่าย')[index] as HTMLSelectElement;
    expect(Array.from(select.options).some((o) => o.value === line.account)).toBe(true);
  });
  await user.selectOptions(screen.getAllByLabelText('บัญชีค่าใช้จ่าย')[index], line.account);
  const price = screen.getAllByLabelText('ราคา/หน่วย')[index];
  await user.clear(price);
  await user.type(price, line.unitPrice);
}

/** เปิดส่วนที่มีช่อง "ยอดที่จ่ายจริง" — หน้าจอปัจจุบันแสดงอยู่แล้วเมื่อเป็นจ่ายทันที */
export async function openAdjustments(_user: UserEvent) {
  await screen.findByLabelText('ยอดที่จ่ายจริง');
}

export async function saveDraft(user: UserEvent) {
  const button = screen.getByRole('button', { name: 'บันทึกร่าง' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}
