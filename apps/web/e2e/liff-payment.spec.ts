import { test, expect } from '@playwright/test';
import { mockLiffSdk, mockLiffApi } from './helpers/liff-mock';

// public/sw.js re-issues every /api/* GET from inside the service worker
// (`event.respondWith(fetch(request))`), and Playwright's page.route cannot
// intercept service-worker-originated requests — mockLiffApi would never fire.
test.use({ serviceWorkers: 'block' });

const GATEWAY_URL = 'https://gateway.example.test/pay/GW-001';

const MOCK_PAYMENT_LINK = {
  valid: true,
  token: 'test-pay-token',
  amount: 2600,
  status: 'ACTIVE',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min from now
  contract: {
    id: 'con1',
    contractNumber: 'BC-2026-0001',
    customer: { name: 'สม*** จั***' },
  },
  payment: {
    installmentNo: 4,
    amountDue: 2500,
    lateFee: 100,
    dueDate: '2026-05-15',
  },
  promptPay: {
    qrDataUrl: null,
    accountName: 'BESTCHOICE',
    maskedId: '092-xxx-xxxx',
  },
};

test.describe('LIFF Payment Flow', () => {
  test('shows payment details for valid token', async ({ page }) => {
    await mockLiffSdk(page);
    await mockLiffApi(page, [
      { method: 'GET', path: '/line-oa/pay/test-pay-token', body: MOCK_PAYMENT_LINK },
    ]);

    await page.goto('/pay/test-pay-token');
    await expect(page.getByText('ชำระเงิน', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('BC-2026-0001')).toBeVisible();
    // exact: the hero amount. A loose match also hits the CTA label
    // ("สแกนจ่าย ฿2,600") and trips strict mode.
    await expect(page.getByText('2,600', { exact: true })).toBeVisible();
    // Expiry countdown should be visible
    await expect(page.getByText(/หมดอายุใน/)).toBeVisible();
  });

  test('shows error for expired token', async ({ page }) => {
    await mockLiffSdk(page);
    await mockLiffApi(page, [
      {
        method: 'GET',
        path: '/line-oa/pay/expired-token',
        body: { valid: false, status: 'EXPIRED' },
      },
    ]);

    await page.goto('/pay/expired-token');
    await expect(page.getByText('ลิงก์ชำระเงินหมดอายุแล้ว')).toBeVisible({ timeout: 10000 });
  });

  test('shows error for used token', async ({ page }) => {
    await mockLiffSdk(page);
    await mockLiffApi(page, [
      { method: 'GET', path: '/line-oa/pay/used-token', body: { valid: false, status: 'USED' } },
    ]);

    await page.goto('/pay/used-token');
    await expect(page.getByText('ลิงก์นี้ถูกใช้งานแล้ว')).toBeVisible({ timeout: 10000 });
  });

  test('shows scan-to-pay CTA with Pay Solutions trust badge', async ({ page }) => {
    await mockLiffSdk(page);
    await mockLiffApi(page, [
      { method: 'GET', path: '/line-oa/pay/test-pay-token', body: MOCK_PAYMENT_LINK },
    ]);

    await page.goto('/pay/test-pay-token');
    await expect(page.getByText(/ชำระผ่าน Pay Solutions/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /สแกนจ่าย.*2,600/ })).toBeVisible();
    // Slip-upload + "โอนเอง" tab are intentionally removed — customers
    // pay via gateway only.
    await expect(page.getByText('โอนเอง')).not.toBeVisible();
    await expect(page.getByText('แตะเพื่อเลือกรูปสลิป')).not.toBeVisible();
  });

  // "สแกนจ่าย" hands the customer off to the Pay Solutions gateway —
  // LiffPayment.tsx `onSuccess` does `window.location.href = result.paymentUrl`
  // whenever the intent carries a URL. There is no in-page path from the button
  // to the success screen, so this asserts the hand-off actually happens.
  test('hands off to the payment gateway after creating an intent', async ({ page }) => {
    await mockLiffSdk(page);
    await mockLiffApi(page, [
      { method: 'GET', path: '/line-oa/pay/test-pay-token', body: MOCK_PAYMENT_LINK },
      {
        method: 'POST',
        path: '/paysolutions/create-intent',
        body: { success: true, paymentId: 'pay1', paymentUrl: GATEWAY_URL, gatewayRef: 'GW-001' },
      },
    ]);

    // Stub the external gateway so the hand-off never leaves the test network
    await page.route('https://gateway.example.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>gateway</body></html>',
      }),
    );

    await page.goto('/pay/test-pay-token');
    await expect(page.getByRole('button', { name: /สแกนจ่าย.*2,600/ })).toBeVisible({
      timeout: 10000,
    });

    // Click scan-to-pay button
    await page.getByRole('button', { name: /สแกนจ่าย.*2,600/ }).click();

    await page.waitForURL(/gateway\.example\.test/, { timeout: 15000 });
  });
});
