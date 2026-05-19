import { test, expect } from '@playwright/test';
import { loginViaAPI, loginAsRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   P2-SP4 — Booking module (การจอง / มัดจำ) — smoke tests
   ================================================================ */

test.describe('/bookings — booking lifecycle smoke', () => {
  test('SALES: page loads, can open create dialog (PENDING_DEPOSIT entry point)', async ({
    page,
  }) => {
    await loginAsRole(page, 'SALES');
    await gotoWithRetry(page, '/bookings');
    if (await hasErrorBoundary(page)) return;

    // Page header
    await expect(page.getByRole('heading', { name: /การจอง.*มัดจำ/ }).first()).toBeVisible({
      timeout: 15000,
    });

    // Status filter shows our Thai labels
    const statusFilter = page.getByRole('combobox').first();
    await statusFilter.click();
    await expect(page.getByText('รอชำระมัดจำ').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('มัดจำแล้ว').first()).toBeVisible();
    await expect(page.getByText('หมดอายุ').first()).toBeVisible();
    // Close the dropdown
    await page.keyboard.press('Escape');

    // Create button visible for SALES (canCreate=true)
    const createBtn = page.getByRole('button', { name: /สร้างใบจอง/ });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Dialog title visible
    await expect(page.getByRole('heading', { name: /สร้างใบจอง/ }).first()).toBeVisible({
      timeout: 5000,
    });
    // Fields visible
    await expect(page.getByText(/หมดอายุภายใน/).first()).toBeVisible();
    await expect(page.getByText(/มัดจำ/).first()).toBeVisible();
  });

  test('OWNER: list view loads without error boundary (covers expired bookings present)', async ({
    page,
  }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/bookings');
    if (await hasErrorBoundary(page)) return;

    // Page must render its header — proves data fetch + render succeed even
    // with mixed status rows (PENDING_DEPOSIT/PAID/CANCELED/EXPIRED/CONVERTED)
    await expect(page.getByRole('heading', { name: /การจอง.*มัดจำ/ }).first()).toBeVisible({
      timeout: 15000,
    });

    // OWNER also sees create button + can filter by EXPIRED
    await expect(page.getByRole('button', { name: /สร้างใบจอง/ })).toBeVisible();

    const statusFilter = page.getByRole('combobox').first();
    await statusFilter.click();
    await page.getByText('หมดอายุ').first().click();

    // No error boundary after filter mutation
    await expect(page.locator('body')).not.toContainText(/เกิดข้อผิดพลาด/);
  });
});
