/**
 * Bookings page — page-load + status-filter smoke checks
 *
 * Verifies surfaces on /bookings without exercising the full
 * booking → deposit → convert lifecycle. Specifically:
 *
 *   1. SALES can load the page; create dialog opens with customer, device and expiry-chip fields.
 *   2. OWNER status select exposes the lifecycle views (open / expiring / pending / paid / closed).
 *   3. SALES clicking the KPI cards writes the status filter to the URL without crashing.
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

    // Create dialog — ฐานว่างจะเป็นหน้าว่างที่มีปุ่ม "สร้างใบจองแรก" แทนปุ่มหัวหน้า
    const createBtn = b.createBtn().or(page.getByRole('button', { name: 'สร้างใบจองแรก' }));
    await expect(createBtn.first()).toBeVisible({ timeout: 10000 });
    await createBtn.first().click();
    await expect(b.dialogTitle()).toBeVisible({ timeout: 5000 });

    // ฟอร์ม 4 ขั้น: ลูกค้า (combobox) · เครื่องในสต็อก · ชิปวันหมดอายุ
    await expect(page.getByRole('combobox', { name: 'ลูกค้า' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel('ค้นหาเครื่องในสาขา')).toBeVisible();
    await expect(page.getByRole('button', { name: '7 วัน' })).toBeVisible();

    await b.assertNoAppError();
  });

  test('OWNER: status select exposes lifecycle views', async ({ page }) => {
    await loginViaAPI(page);
    const b = new BookingPage(page);
    const ok = await b.goto();
    if (!ok) {
      throw new Error('/bookings failed to load — likely error boundary or auth issue');
    }

    await expect(b.heading()).toBeVisible({ timeout: 15000 });

    if (await b.isFirstUse()) return;

    // Open status select (aria-label "สถานะใบจอง")
    await b.statusFilterTrigger().click();

    // Radix SelectItem renders role="option"
    await expect(page.getByRole('option', { name: 'ทั้งหมด' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('option', { name: /ใกล้หมดอายุ/ })).toBeVisible();
    await expect(page.getByRole('option', { name: 'รอชำระมัดจำ' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'มัดจำแล้ว' })).toBeVisible();
    await expect(page.getByRole('option', { name: /ปิดแล้ว/ })).toBeVisible();

    // Close dropdown
    await page.keyboard.press('Escape');
    await b.assertNoAppError();
  });

  test('SALES: KPI card filters write status to URL and do not crash list view', async ({
    page,
  }) => {
    await loginAsRole(page, 'SALES');
    const b = new BookingPage(page);
    const ok = await b.goto();
    if (!ok) {
      throw new Error('/bookings failed to load — likely error boundary or auth issue');
    }

    await expect(b.heading()).toBeVisible({ timeout: 15000 });

    if (await b.isFirstUse()) return;

    await page.getByRole('button', { name: /ปิดแล้ว/ }).click();
    await expect(page).toHaveURL(/status=CLOSED/);

    // List should re-render without error boundary
    await b.assertNoAppError();
  });
});
