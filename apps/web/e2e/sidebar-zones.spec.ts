import { test, expect, type Page } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

/**
 * SP1 — Sidebar redesign E2E tests
 *
 * Covers Task 16 from the SP1 implementation plan:
 *   - Zone pill visibility per role (OWNER both, SALES none, ACC none)
 *   - GearButton (ตั้งค่ากลาง) visibility per role
 *   - Zone switching by clicking pills
 *   - Persistence of selected zone (localStorage `bc.sidebar.lastZone`)
 *     NOTE: clicking a pill navigates to `ZONE_LANDING[zone]` (menu.ts) — the
 *     `?zone=` param LayoutContext writes is dropped by that navigate(), so the
 *     assertion is on the landing path, not the query string. `?zone=` is still
 *     READ on boot (deep links keep working), just never written by a pill click.
 *   - Auto-switch pill when navigating to a path in a different zone
 *   - Cross-zone access guard: SALES navigating to FIN-only path → redirect
 *     to `/` with toast "คุณไม่มีสิทธิ์เข้าถึงหน้านี้" (see MainLayout.tsx:102)
 *   - SP1 placeholder routes render `ComingSoonPage` with feature + tracking SP
 *
 * Selectors reflect the real implementation:
 *   - PillSwitcher uses role="tab" + aria-selected (PillSwitcher.tsx)
 *   - GearButton has aria-label="ตั้งค่ากลาง" (GearButton.tsx)
 *   - Sidebar.tsx renders Expanded/Collapsed/Mobile variants — pills/gear
 *     live in the expanded variant so we force expanded state per test.
 *
 * Auth: reuses `loginAsRole` from helpers/auth which API-logs-in via cached
 * token (avoids ThrottlerGuard rate limit). Tests run serially within
 * each file by default in this project's playwright.config (workers: 2).
 */

async function loginAndExpandSidebar(page: Page, role: 'OWNER' | 'SALES' | 'ACCOUNTANT') {
  // Force expanded sidebar so pills/gear labels are visible (default is
  // a collapsed icon rail — same pattern used by login.spec.ts).
  await page.addInitScript(() => {
    localStorage.setItem('sidebar_collapse', 'false');
  });
  await loginAsRole(page, role);
  // Wait for sidebar to mount.
  await expect(page.locator('.sidebar').first()).toBeVisible({ timeout: 15_000 });
}

test.describe('SP1 — Sidebar zones', () => {
  test('OWNER sees both pills + gear, can switch zones', async ({ page }) => {
    await loginAndExpandSidebar(page, 'OWNER');

    const shopPill = page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานหน้าร้าน' }).first();
    const finPill = page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานการเงิน' }).first();
    const gearBtn = page.getByRole('button', { name: 'ตั้งค่ากลาง' }).first();

    await expect(shopPill).toBeVisible();
    await expect(finPill).toBeVisible();
    await expect(gearBtn).toBeVisible();

    // Switch to ไฟแนนซ์ pill.
    await finPill.click();
    await expect(finPill).toHaveAttribute('aria-selected', 'true');
    // PillSwitcher navigates to ZONE_LANDING.fin ('/finance-portfolio').
    await expect(page).toHaveURL(/\/finance-portfolio/);
  });

  test('SALES sees no pill switcher and no gear', async ({ page }) => {
    await loginAndExpandSidebar(page, 'SALES');

    // Pill switcher is hidden when role has <2 zones (PillSwitcher.tsx:19).
    await expect(page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานหน้าร้าน' })).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานการเงิน' })).toHaveCount(0);
    // Gear is hidden when zoneConfig.showSettingsGear === false.
    await expect(page.getByRole('button', { name: 'ตั้งค่ากลาง' })).toHaveCount(0);
  });

  test('ACCOUNTANT sees no pills (FIN-only role)', async ({ page }) => {
    await loginAndExpandSidebar(page, 'ACCOUNTANT');

    // ACCOUNTANT's zoneConfig has only ['fin'] → PillSwitcher renders null.
    await expect(page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานหน้าร้าน' })).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานการเงิน' })).toHaveCount(0);
  });

  test('OWNER zone selection persists across reload', async ({ page }) => {
    await loginAndExpandSidebar(page, 'OWNER');

    await page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานการเงิน' }).first().click();
    await expect(page).toHaveURL(/\/finance-portfolio/);

    // Re-inject sidebar_collapse so it survives the reload (addInitScript
    // already does this for navigations, but reload triggers a fresh boot).
    await page.reload({ waitUntil: 'domcontentloaded' });

    const finPill = page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานการเงิน' }).first();
    await expect(finPill).toBeVisible({ timeout: 10_000 });
    await expect(finPill).toHaveAttribute('aria-selected', 'true');
  });

  test('OWNER navigating to FIN path auto-switches pill', async ({ page }) => {
    await loginAndExpandSidebar(page, 'OWNER');

    // Force into SHOP zone first.
    await page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานหน้าร้าน' }).first().click();
    await expect(page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานหน้าร้าน' }).first()).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // MainLayout.tsx:88 useEffect resolves zone from pathname and auto-switches.
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });
    const finPill = page.getByRole('tablist', { name: 'หมวดงาน' }).getByRole('tab', { name: 'งานการเงิน' }).first();
    await expect(finPill).toBeVisible({ timeout: 10_000 });
    await expect(finPill).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
  });

  test('SALES navigating to FIN-only path is redirected with toast', async ({ page }) => {
    await loginAndExpandSidebar(page, 'SALES');

    // /overdue belongs to FIN zone; SALES has no access → MainLayout.tsx:101
    // fires toast + navigate('/', { replace: true }).
    await page.goto('/overdue', { waitUntil: 'domcontentloaded' });

    // Wait for the redirect away from /overdue.
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 8_000 }).not.toBe('/overdue');

    // Sonner toast container has data-sonner-toast attribute.
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
  });

  // The old placeholder /quotes was removed from App.tsx (the quotes model was
  // dropped from the schema — see docs/accounting/factory-reset-runbook-2026-08.md)
  // so it now falls through to the catch-all and lands on the Dashboard. This test
  // keeps its original intent — "a placeholder route renders ComingSoonPage with its
  // tracking SP + ETA" — on a route that still exists: /settings/brands (OWNER-only,
  // resolves to the 'settings' zone so MainLayout doesn't bounce it).
  test('Placeholder /settings/brands renders ComingSoonPage with SP5 + ETA', async ({ page }) => {
    await loginAndExpandSidebar(page, 'OWNER');

    await page.goto('/settings/brands', { waitUntil: 'domcontentloaded' });

    // ComingSoonPage.tsx renders <h1>{feature}</h1> + tracking SP description.
    await expect(page.getByRole('heading', { name: 'จัดการแบรนด์สินค้า' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/SP5/).first()).toBeVisible();
    await expect(page.getByText('ภายในไตรมาส 3/2026')).toBeVisible();
  });
});
