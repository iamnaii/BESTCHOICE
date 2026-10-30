import { test, expect } from '@playwright/test';
import { mockLiffSdk, mockLiffApi, MOCK_DISPLAY_NAME } from './helpers/liff-mock';

// public/sw.js re-issues every /api/* GET from inside the service worker
// (`event.respondWith(fetch(request))`), and Playwright's page.route cannot
// intercept service-worker-originated requests — mockLiffApi would never fire.
test.use({ serviceWorkers: 'block' });

/**
 * Task 19 — /liff/register (ผูก LINE การเงินด้วยเบอร์อย่างเดียว ไม่มี OTP) ปิดแล้ว.
 * URL เดิมพาไป /liff/finance-verify (เบอร์ + OTP SMS) โดยคง query string และไม่เรียก
 * API เดิม `line-oa/liff/register/lookup|confirm` (ตอบ 410) อีกเลย.
 */
test.describe('LIFF Register → OTP verification', () => {
  test.beforeEach(async ({ page }) => {
    await mockLiffSdk(page);
  });

  test('redirects /liff/register to /liff/finance-verify keeping the query string', async ({
    page,
  }) => {
    await mockLiffApi(page, [
      { method: 'GET', path: '/chatbot/finance/liff/status', body: { linked: false } },
    ]);

    await page.goto('/liff/register?src=sms1');
    await expect(page).toHaveURL(/\/liff\/finance-verify\?src=sms1$/);
    await expect(page.getByText('ยืนยันตัวตน', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(MOCK_DISPLAY_NAME)).toBeVisible();
    await expect(page.getByPlaceholder('0812345678')).toBeVisible();
  });

  test('already linked LINE sees the verified state', async ({ page }) => {
    await mockLiffApi(page, [
      {
        method: 'GET',
        path: '/chatbot/finance/liff/status',
        body: { linked: true, customerName: 'สมชาย' },
      },
    ]);

    await page.goto('/liff/register');
    await expect(page.getByText('ยืนยันแล้ว', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('คุณสมชาย')).toBeVisible();
  });

  test('phone → OTP → linked, without touching the retired register API', async ({ page }) => {
    const retired: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/line-oa/liff/register/')) retired.push(req.url());
    });
    await mockLiffApi(page, [
      { method: 'GET', path: '/chatbot/finance/liff/status', body: { linked: false } },
      {
        method: 'POST',
        path: '/chatbot/finance/liff/request-otp',
        body: { maskedPhone: '081-xxx-5678', expiresInSeconds: 300 },
      },
      {
        method: 'POST',
        path: '/chatbot/finance/liff/verify-otp',
        body: { customerId: 'cust1', customerName: 'สมชาย' },
      },
    ]);

    await page.goto('/liff/register');
    await page.getByPlaceholder('0812345678').fill('0812345678');
    await page.getByRole('button', { name: 'ส่งรหัส OTP' }).click();

    await expect(page.getByText('081-xxx-5678')).toBeVisible({ timeout: 5000 });
    await page.getByPlaceholder('000000').fill('123456');
    await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click();

    await expect(page.getByText('ยืนยันสำเร็จ', { exact: true })).toBeVisible({ timeout: 5000 });
    expect(retired).toEqual([]);
  });

  test('blocks OTP request while the phone number is incomplete', async ({ page }) => {
    await mockLiffApi(page, [
      { method: 'GET', path: '/chatbot/finance/liff/status', body: { linked: false } },
    ]);

    await page.goto('/liff/register');
    await expect(page.getByPlaceholder('0812345678')).toBeVisible({ timeout: 10000 });

    // LiffFinanceVerify disables the button until 10 digits are entered
    await page.getByPlaceholder('0812345678').fill('123');
    await expect(page.getByRole('button', { name: 'ส่งรหัส OTP' })).toBeDisabled();
  });
});
