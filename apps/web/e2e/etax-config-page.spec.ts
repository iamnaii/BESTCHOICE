import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

/**
 * P2-SP5 — ETaxConfigPage E2E smoke test.
 *
 * Verifies:
 *   - OWNER can navigate to /settings/e-tax-config and see the form
 *   - Disabled-mode warning banner is visible (mandatory pre-enable read)
 *   - "ทดสอบการเชื่อมต่อ" button is present
 *   - Submit Mode dropdown defaults to disabled
 */
test.describe('ETaxConfigPage (P2-SP5)', () => {
  test('OWNER sees disabled-mode state when no cert configured', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await page.goto('/settings/e-tax-config', { waitUntil: 'domcontentloaded' });

    // Header
    await expect(
      page.getByRole('heading', { name: /ตั้งค่า e-Tax Invoice/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Disabled-mode warning banner must surface to the OWNER
    const banner = page.getByTestId('etax-config-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/โหมด disabled/);

    // Form mounts after config query resolves
    await expect(page.getByTestId('etax-config-form')).toBeVisible({
      timeout: 10_000,
    });

    // Mode dropdown defaults to disabled
    const select = page.getByTestId('etax-mode-select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('disabled');

    // Action buttons
    await expect(page.getByTestId('etax-test-btn')).toBeVisible();
    await expect(page.getByTestId('etax-save-btn')).toBeVisible();
  });
});
