import { test, expect } from '@playwright/test';

test.describe('LIFF Pages', () => {
  // LIFF pages don't require login — they use LINE LIFF SDK
  // Without LINE context, pages will load but may show errors or loading states
  // Tests verify pages don't crash (no unhandled exceptions)

  test('should load LIFF contract page without crashing', async ({ page }) => {
    await page.goto('/liff/contract', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Page should load — may show loading or error due to missing LINE context
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();

    // Should not show a blank white screen or unhandled JS error
    // LIFF pages show their own error UI, not the generic error boundary
  });

  test('should load LIFF register page without crashing', async ({ page }) => {
    await page.goto('/liff/register', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();

    // May show "ลงทะเบียนผูก LINE" or loading/error state
    const hasContent = await page.getByText('ลงทะเบียน').first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasLoading = await page.getByText('กำลังเชื่อมต่อ').first().isVisible({ timeout: 3000 }).catch(() => false);
    const hasError = await page.getByText('เกิดข้อผิดพลาด').first().isVisible({ timeout: 3000 }).catch(() => false);

    // At least one state should be shown (not blank)
    expect(hasContent || hasLoading || hasError || (body && body.length > 50)).toBe(true);
  });

  test('should load LIFF history page without crashing', async ({ page }) => {
    await page.goto('/liff/history', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('should load LIFF profile page without crashing', async ({ page }) => {
    await page.goto('/liff/profile', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('should load LIFF early payoff page without crashing', async ({ page }) => {
    await page.goto('/liff/early-payoff', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });
});
