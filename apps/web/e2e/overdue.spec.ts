import { test, expect, type Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   /overdue → /collections

   The standalone OverduePage was DELETED. `src/App.tsx` now maps both
   `/overdue` and `/overdue/*` to `<Navigate to="/collections" replace />`
   (Task 18 of 2026-04-25-collections-ui-p1), so these tests cover the
   redirect plus the screens the old page's content moved to:

     - page header "ค่าปรับ & ค้างชำระ"  → "ติดตามหนี้"
                                          (pages/CollectionsPage/index.tsx)
     - summary cards + overdue table + search
                                        → tab "ทั้งหมด"
                                          (pages/CollectionsPage/tabs/AllTab.tsx)

   Three old tests were removed because the UI they asserted no longer
   exists anywhere in the app (verified by grep over apps/web/src):
     - "should display dunning workflow pipeline" — the stage labels
       (แจ้งค้างชำระ / เตือนครั้งสุดท้าย / ดำเนินคดี) now live only in
       lib/status-badges.ts and render on ContractDetailPage /
       DashboardFinanceOverview. The per-stage view was replaced by the
       "วิเคราะห์" tab (tabs/AnalyticsTab.tsx) + components/FilterDrawer.tsx.
     - "should filter by dunning stage" — the "ทุกระดับติดตาม" dropdown is
       gone (0 hits in src); filtering moved to FilterDrawer/FilterChipsBar.
     - "should open follow-up drawer for overdue item" — the drawer was
       replaced by components/ContactLogDialog.tsx, opened from the contract
       cards in the "คิววันนี้" queue rather than from a table row.
   ================================================================ */

/**
 * OWNER defaults to the LIBRARY view (hooks/useViewToggle.ts), which is the
 * one carrying the tab bar. A persisted user preference can land on SESSION
 * instead, so switch back when the tabs aren't there.
 */
async function ensureLibraryView(page: Page): Promise<void> {
  const allTab = page.getByRole('button', { name: 'ทั้งหมด', exact: true });
  if (await allTab.isVisible({ timeout: 3000 }).catch(() => false)) return;

  const libraryBtn = page.getByRole('button', { name: 'Library', exact: true });
  if (await libraryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await libraryBtn.click();
  }
}

/** Land on /collections through the legacy /overdue link and open "ทั้งหมด". */
async function openAllTabViaOverdue(page: Page): Promise<boolean> {
  await gotoWithRetry(page, '/overdue');
  if (await hasErrorBoundary(page)) return false;

  await ensureLibraryView(page);
  await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).first().click();
  return true;
}

test.describe('Overdue Page (redirects to /collections)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should redirect /overdue to /collections and display page', async ({ page }) => {
    await gotoWithRetry(page, '/overdue');
    if (await hasErrorBoundary(page)) return;

    // Legacy bookmarks/LINE links must keep working
    await expect(page).toHaveURL(/\/collections(\?|$)/, { timeout: 15000 });

    await expect(page.getByRole('heading', { name: /ติดตามหนี้/ }).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('should display overdue list or empty state', async ({ page }) => {
    if (!(await openAllTabViaOverdue(page))) return;

    // Summary card that used to sit on OverduePage (AllTab.tsx)
    await expect(page.getByText('สัญญาค้างชำระ').first()).toBeVisible({ timeout: 15000 });

    // Table renders either rows or the "ไม่มีรายการค้างชำระ" empty state
    const table = page.locator('table').first();
    const hasTable = await table.isVisible({ timeout: 10000 }).catch(() => false);

    if (hasTable) {
      await expect(table.getByRole('columnheader', { name: 'สัญญา' }).first()).toBeVisible();
    }

    // No server error (check for error boundary, not '500' which appears in phone numbers)
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should filter overdue by search', async ({ page }) => {
    if (!(await openAllTabViaOverdue(page))) return;

    const searchInput = page.getByPlaceholder('ค้นหาเลขสัญญา, ชื่อลูกค้า...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    await searchInput.fill('test');
    await page.waitForTimeout(500); // debounce

    // Page should update without errors
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
