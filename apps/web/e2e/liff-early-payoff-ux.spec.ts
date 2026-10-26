import { test, expect } from '@playwright/test';
import { mockLiffSdk, mockLiffApi } from './helpers/liff-mock';
test.use({ serviceWorkers: 'block' });

test('login failure is never presented as all contracts paid', async ({ page }) => {
  await page.goto('/liff/early-payoff?login_error=true');
  await expect(page.getByText('ไม่สามารถเข้าสู่ระบบ LINE ได้ กรุณาลองใหม่')).toBeVisible();
  await expect(page.getByText('ทุกสัญญาชำระครบแล้ว')).toHaveCount(0);
});
test('failed contract list is not a successful empty portfolio', async ({ page }) => {
  await mockLiffSdk(page);
  await mockLiffApi(page, [{ method: 'GET', path: '/line-oa/liff/contracts', status: 500, body: { message: 'ทดสอบระบบไม่พร้อม' } }]);
  await page.goto('/liff/early-payoff');
  await expect(page.getByText('ไม่สามารถดำเนินการได้')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('ทุกสัญญาชำระครบแล้ว')).toHaveCount(0);
});
for (const path of ['/liff', '/contract', '/history', '/early-payoff', '/liff/old-bookmark']) {
  test(`legacy LINE path ${path} preserves the login result`, async ({ page }) => {
    await page.goto(`${path}?login_error=true`);
    await expect(page.getByText('ไม่สามารถเข้าสู่ระบบ LINE ได้ กรุณาลองใหม่')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('login_error')).toBe('true');
  });
}
