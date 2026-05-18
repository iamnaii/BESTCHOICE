/**
 * Bookings page — page-load + status-filter smoke checks
 *
 * Verifies surfaces on /bookings without exercising the full
 * booking → deposit → convert lifecycle. Specifically:
 *
 *   1. SALES can load the page; create dialog opens with deposit + expiry fields.
 *   2. OWNER status filter exposes all 5 lifecycle labels in its dropdown.
 *   3. SALES filtering by "หมดอายุ" does not crash the list view.
 *
 * A real flow spec (create → mark deposit paid → convert → POS) needs seeded
 * products + a real branch to attach the booking to — deferred to a future
 * PR that adds product/branch seeding helpers.
 */
import { test, expect } from '@playwright/test';
import { loginAsRole, loginViaAPI } from '../helpers/auth';
import { BookingPage } from '../pom/BookingPage';
import { hasErrorBoundary } from '../helpers/navigation';

test.describe.configure({ timeout: 60_000 });

test.describe('Bookings — page-load + status filter', () => {
  test('SALES: /bookings loads, create dialog opens with deposit + expiry fields', async ({
    page,
  }) => {
    await loginAsRole(page, 'SALES');
    const b = new BookingPage(page);
    const ok = await b.goto();
    if (!ok) {
      throw new Error('/bookings failed to load — likely error boundary or auth issue');
    }
    if (await hasErrorBoundary(page)) {
      throw new Error('Error boundary on /bookings — page rendered an unhandled exception');
    }

    await expect(b.heading()).toBeVisible({ timeout: 15000 });

    // Create dialog
    await expect(b.createBtn()).toBeVisible({ timeout: 10000 });
    await b.createBtn().click();
    await expect(b.dialogTitle()).toBeVisible({ timeout: 5000 });

    // Dialog should show deposit + expiry fields per BookingsPage spec
    await expect(page.getByText(/หมดอายุภายใน/).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/มัดจำ/).first()).toBeVisible();

    await b.assertNoAppError();
  });

  test('OWNER: status filter exposes all 5 lifecycle states', async ({ page }) => {
    await loginViaAPI(page);
    const b = new BookingPage(page);
    const ok = await b.goto();
    if (!ok) {
      throw new Error('/bookings failed to load — likely error boundary or auth issue');
    }

    await expect(b.heading()).toBeVisible({ timeout: 15000 });

    // Open status filter
    const filter = b.statusFilterTrigger();
    await filter.click();

    // All 5 states should be available in the dropdown — Radix SelectItem
    // renders with role="option" so we use getByRole to avoid matching the
    // table header / row content with the same text.
    await expect(page.getByRole('option', { name: 'รอชำระมัดจำ' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('option', { name: 'มัดจำแล้ว' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'หมดอายุ' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'ขายแล้ว' })).toBeVisible();
    // CANCELED label — at least one of these matches per BookingsPage STATUS_LABEL
    await expect(page.getByRole('option', { name: /ยกเลิก/ })).toBeVisible();

    // Close dropdown
    await page.keyboard.press('Escape');
    await b.assertNoAppError();
  });

  test('SALES: filtering by EXPIRED status does not crash list view', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    const b = new BookingPage(page);
    const ok = await b.goto();
    if (!ok) {
      throw new Error('/bookings failed to load — likely error boundary or auth issue');
    }

    await expect(b.heading()).toBeVisible({ timeout: 15000 });

    const filter = b.statusFilterTrigger();
    await filter.click();
    await page.getByRole('option', { name: 'หมดอายุ' }).click();

    // List should re-render without error boundary
    await b.assertNoAppError();
  });
});
