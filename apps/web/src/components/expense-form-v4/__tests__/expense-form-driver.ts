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

/** จ่ายเจ้าหนี้ — รอให้รายการเอกสารตั้งหนี้โหลด (ระบบติ๊กให้เองตามค่าตั้ง) */
export async function waitForSettlementDoc(docNumber: string) {
  await screen.findByText(docNumber);
}

/** ใบลดหนี้โหมดอ้างอิง — ค้นเอกสารต้นฉบับแล้วเลือก */
export async function pickCreditNoteSource(user: UserEvent, search: string, docNumber: RegExp) {
  await user.type(screen.getByLabelText('ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)'), search);
  await user.click(await screen.findByRole('button', { name: docNumber }));
}

export async function chooseCreditNoteStandalone(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: /^ไม่มีเอกสารต้นทาง/ }));
}

export async function fillCreditNoteVendorName(user: UserEvent, name: string) {
  await user.type(screen.getByLabelText(/^ชื่อผู้ขาย/), name);
}

export async function fillCreditNoteReason(user: UserEvent, reason: string) {
  await user.type(await screen.findByLabelText(/^เหตุผล/), reason);
}

/** เงินสดย่อย — บรรทัดแรก: เลือกผู้ขาย (ปุ่มแทน VendorCombobox) · เลือกบัญชี 53-1101 (ปุ่มแทน AccountSearchDropdown) · กรอกยอด */
export async function fillPettyCashLine(user: UserEvent, line: { amount: string }) {
  await user.click(screen.getByRole('button', { name: 'เลือกผู้ขาย' }));
  await user.click(screen.getByRole('button', { name: 'หมวดบัญชี' }));
  await user.type(screen.getByLabelText('จำนวน'), line.amount);
}
