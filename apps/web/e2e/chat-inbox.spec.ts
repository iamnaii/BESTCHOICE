import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Customer inbox and legacy /chat links', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('old chat link redirects without trapping browser back', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL((url) => url.pathname === '/profile');
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL((url) => url.pathname === '/inbox');
    await expect(page.getByRole('button', { name: /^รอตอบ/ })).toBeVisible();
    await expect(page.getByText('คุณไม่มีสิทธิ์เข้าถึงหน้านี้', { exact: true })).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === '/profile');
  });

  test('canonical inbox keeps conversation filters and empty panel', async ({ page }) => {
    await page.goto('/inbox', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('เลือกการสนทนา', { exact: true })).toBeVisible();
    const mine = page.getByRole('button', { name: /^ของฉัน/ });
    await mine.click();
    await expect(mine).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('combobox', { name: 'กรองตามช่องทาง' })).toBeVisible();
  });

  test('old chat link opens the mobile inbox without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL((url) => url.pathname === '/inbox');
    await expect(page.getByRole('button', { name: /^รอตอบ/ })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'กรองตามช่องทาง' })).toBeVisible();
    const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
  });
});
