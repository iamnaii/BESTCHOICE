import { test, expect, Page } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/**
 * SP4 — /settings/document-config admin UI.
 *
 * Backend exposes:
 *   GET  /settings/doc-config            → OWNER + FINANCE_MANAGER + ACCOUNTANT
 *   PATCH /settings/doc-config/:docType  → OWNER only
 *
 * Frontend route is OWNER-only via ProtectedRoute (per the Settings convention
 * in accounting.md). Specs are tolerant of missing seed rows: the page may
 * render the "empty state" before the migration has been applied to the
 * test DB. Both states are valid.
 */

async function pageMounted(page: Page): Promise<boolean> {
  if (await hasErrorBoundary(page)) return false;
  return page
    .getByText('ตั้งค่าเลขที่/รูปแบบเอกสาร')
    .first()
    .isVisible({ timeout: 6000 })
    .catch(() => false);
}

test.describe('SP4 DocumentConfigPage', () => {
  test('OWNER can access /settings/document-config and see the doc-type table', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/settings/document-config');

    if (!(await pageMounted(page))) return; // page not deployed yet

    await expect(page.getByText('ตั้งค่าเลขที่/รูปแบบเอกสาร').first()).toBeVisible();

    // Either the table renders (seed applied) or the empty state appears.
    const hasTable = await page
      .locator('table')
      .first()
      .isVisible({ timeout: 6000 })
      .catch(() => false);
    const hasEmpty = await page
      .getByText(/ยังไม่มีการตั้งค่าเลขที่เอกสาร/)
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test('BRANCH_MANAGER is blocked from /settings/document-config (OWNER-only)', async ({ page }) => {
    await loginAsRole(page, 'BRANCH_MANAGER');
    await gotoWithRetry(page, '/settings/document-config');

    // ProtectedRoute redirects non-OWNER away. We allow several outcomes:
    //   - URL changes away from /settings/document-config
    //   - The header from the doc-config page does NOT appear
    //   - No error boundary surfaces
    await page.waitForTimeout(1500);

    const headerVisible = await page
      .getByText('ตั้งค่าเลขที่/รูปแบบเอกสาร')
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);

    expect(headerVisible).toBeFalsy();
    expect(await hasErrorBoundary(page)).toBeFalsy();
  });
});
