import { expect, type Page } from '@playwright/test';
import { loginAsRole, getRoleAuthHeaders } from './auth';
import { unwrapResponse } from './api-utils';
const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';
export async function openPromiseFixture(page: Page, id: string, tab: 'คิววันนี้' | 'นัดชำระ') {
  await loginAsRole(page, 'BRANCH_MANAGER');
  await page.goto('/collections');
  await page.getByRole('button', { name: 'คลังข้อมูล', exact: true }).click();
  await page.getByRole('button', { name: tab, exact: true }).click();
  const card = page.locator(`[data-collections-card-id="${id}"]`);
  await expect(card).toBeVisible();
  return card;
}
export async function readPromiseFixture(page: Page, id: string) {
  const r = await page.request.get(`${API_URL}/api/overdue/contracts/${id}/queue-row`, {
    headers: getRoleAuthHeaders('BRANCH_MANAGER'),
  });
  expect(r.status()).toBe(200);
  return unwrapResponse(await r.json());
}
export async function savePromise(
  page: Page,
  id: string,
  slots: Array<{ date: string; amount: string }>,
  supersede: boolean,
) {
  await page
    .locator(`[data-collections-card-id="${id}"]`)
    .getByRole('button', { name: 'บันทึกผลการโทร', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: /^บันทึกผล —/ });
  await dialog.getByRole('button', { name: /^นัดชำระ/ }).click();
  for (let i = 0; i < slots.length; i++) {
    if (i > 0) await dialog.getByRole('button', { name: /\+ เพิ่ม/ }).click();
    await dialog.getByRole('button', { name: slots[i].date, exact: true }).nth(i).click();
    await dialog.locator('input[data-numeric-input]').nth(i).fill(slots[i].amount);
  }
  const expectedDates = await dialog
    .locator('input[type=date]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
  if (supersede) {
    const confirm = page.getByRole('dialog', { name: /ยืนยันการเลื่อนนัด/ });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('ไม่นับผิดนัด');
    await confirm.getByRole('button', { name: /ยืนยันเลื่อนนัด/ }).click();
    await expect(confirm).toHaveCount(0);
  }
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'ข้อมูลลูกค้า 360' })).toHaveCount(0);
  return expectedDates;
}
export async function readPromiseLogs(page: Page, id: string) {
  const r = await page.request.get(`${API_URL}/api/overdue/contracts/${id}/call-logs`, {
    headers: getRoleAuthHeaders('BRANCH_MANAGER'),
  });
  expect(r.status()).toBe(200);
  return unwrapResponse(await r.json()).data;
}
