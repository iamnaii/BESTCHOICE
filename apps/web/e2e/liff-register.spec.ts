import { test, expect } from '@playwright/test';
import { mockLiffSdk, mockLiffApi, MOCK_DISPLAY_NAME } from './helpers/liff-mock';

// public/sw.js re-issues every /api/* GET from inside the service worker
// (`event.respondWith(fetch(request))`), and Playwright's page.route cannot
// intercept service-worker-originated requests — mockLiffApi would never fire.
test.use({ serviceWorkers: 'block' });

test.describe('LIFF Register Flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockLiffSdk(page);
  });

  test('shows phone input form when not linked', async ({ page }) => {
    await mockLiffApi(page, [
      // Check contracts → 404 = not linked yet
      { method: 'GET', path: '/line-oa/liff/contracts', status: 404, body: { message: 'ไม่พบ' } },
    ]);

    await page.goto('/liff/register');
    await expect(page.getByText('ลงทะเบียนผูก LINE')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(MOCK_DISPLAY_NAME)).toBeVisible();
    await expect(page.getByPlaceholder('0812345678')).toBeVisible();
  });

  test('shows already linked state when contracts exist', async ({ page }) => {
    await mockLiffApi(page, [
      {
        method: 'GET',
        path: '/line-oa/liff/contracts',
        body: { customer: { name: 'สมชาย' }, contracts: [] },
      },
    ]);

    await page.goto('/liff/register');
    await expect(page.getByText('ลงทะเบียนแล้ว')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('ดูสัญญาของฉัน')).toBeVisible();
  });

  test('lookup by phone → confirm → success', async ({ page }) => {
    await mockLiffApi(page, [
      { method: 'GET', path: '/line-oa/liff/contracts', status: 404, body: { message: 'ไม่พบ' } },
      {
        method: 'POST',
        path: '/line-oa/liff/register/lookup',
        body: { customerId: 'cust1', maskedName: 'สม*** จั***' },
      },
      {
        method: 'POST',
        path: '/line-oa/liff/register/confirm',
        body: { success: true, message: 'ลงทะเบียนสำเร็จ' },
      },
    ]);

    await page.goto('/liff/register');
    await expect(page.getByPlaceholder('0812345678')).toBeVisible({ timeout: 10000 });

    // Enter phone
    await page.getByPlaceholder('0812345678').fill('0812345678');
    await page.getByRole('button', { name: 'ค้นหาบัญชี' }).click();

    // Confirm step
    await expect(page.getByText('สม*** จั***')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /ยืนยัน/ }).click();

    // Success
    await expect(page.getByText('ลงทะเบียนสำเร็จ')).toBeVisible({ timeout: 5000 });
  });

  test('blocks lookup while the phone number is incomplete', async ({ page }) => {
    await mockLiffApi(page, [
      { method: 'GET', path: '/line-oa/liff/contracts', status: 404, body: { message: 'ไม่พบ' } },
    ]);

    await page.goto('/liff/register');
    await expect(page.getByPlaceholder('0812345678')).toBeVisible({ timeout: 10000 });

    // LiffRegister.tsx disables the button until 10 digits are entered
    // (`disabled={phone.length < 10 || submitting}`), so a short number can
    // never reach handlePhoneLookup — the guard IS the disabled button.
    await page.getByPlaceholder('0812345678').fill('123');
    await expect(page.getByRole('button', { name: 'ค้นหาบัญชี' })).toBeDisabled();
  });

  test('shows error for invalid phone format', async ({ page }) => {
    await mockLiffApi(page, [
      { method: 'GET', path: '/line-oa/liff/contracts', status: 404, body: { message: 'ไม่พบ' } },
    ]);

    await page.goto('/liff/register');
    await expect(page.getByPlaceholder('0812345678')).toBeVisible({ timeout: 10000 });

    // 10 digits enables the button, but /^0\d{8,9}$/ still rejects it
    // (does not start with 0) → handlePhoneLookup sets the inline error.
    await page.getByPlaceholder('0812345678').fill('1234567890');
    await page.getByRole('button', { name: 'ค้นหาบัญชี' }).click();
    await expect(page.getByText('กรุณากรอกเบอร์โทรให้ถูกต้อง')).toBeVisible();
  });
});
