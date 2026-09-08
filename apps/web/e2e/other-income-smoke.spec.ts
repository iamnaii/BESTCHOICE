import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';
import { unwrapResponse } from './helpers/api-utils';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Other Income Module — smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('create + post + view', async ({ page }) => {
    const create = await page.request.post(`${API_URL}/api/other-income`, {
      headers: getAuthHeaders(),
      data: {
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        counterpartyName: 'ทดสอบ KBank E2E',
        items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
      },
    });
    expect(create.ok()).toBeTruthy();
    // ทุก response ถูกครอบด้วย envelope { success, data, timestamp } จาก interceptor กลาง
    // ⇒ อ่าน draft.docNumber ตรง ๆ ได้ undefined เสมอ (ตกมาตั้งแต่ก่อนงานชุดนี้)
    const draft = unwrapResponse(await create.json());
    expect(draft.docNumber).toMatch(/^OI-/);

    const post = await page.request.post(`${API_URL}/api/other-income/${draft.id}/post`, {
      headers: getAuthHeaders(),
    });
    expect(post.ok()).toBeTruthy();
    const posted = unwrapResponse(await post.json());
    expect(posted.status).toBe('POSTED');
    expect(posted.journalEntryId).toBeTruthy();

    const ok = await gotoWithRetry(page, `/other-income/${posted.id}`);
    if (!ok) return;

    // เจาะจงเลขเอกสารในหัวการ์ด "ข้อมูลเอกสาร" (OtherIncomeViewPage.tsx:481)
    // — `getByText(docNumber)` เปล่า ๆ แมตช์ 3 ที่พร้อมกันแล้วชน strict mode:
    // ข้อความ toast "เอกสาร <เลข> ลงบัญชีเรียบร้อย", หัวการ์ดนี้ และตัวอย่างใน
    // iframe ใบเสร็จ (data-testid="icab-frame")
    await expect(
      page.locator('span.font-mono').filter({ hasText: posted.docNumber }).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('POSTED').first()).toBeVisible({ timeout: 10000 });
  });

  test('list page renders', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/other-income');
    if (!ok) return;

    await expect(page.getByRole('heading', { name: /รายได้อื่น/, level: 1 })).toBeVisible({ timeout: 10000 });
  });

  test('daily sheet renders', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/other-income/daily-sheet');
    if (!ok) return;

    await expect(page.getByRole('heading', { name: /สรุปรายได้อื่น/ })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('รายได้รวม')).toBeVisible({ timeout: 10000 });
  });
});
