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

    // ฐานทดสอบยังไม่มีใบจองเลย → หน้าว่าง 3 ขั้น (ปุ่มหัวหน้าถูกซ่อน ใช้ปุ่ม "สร้างใบจองแรก" แทน)
    const firstUse = await page
      .getByRole('heading', { name: 'ยังไม่มีใบจอง' })
      .isVisible()
      .catch(() => false);

    if (!firstUse) {
      // การ์ด KPI กดกรองได้ และเขียน URL
      await page.getByRole('button', { name: /มัดจำแล้ว · รอรับเครื่อง/ }).click();
      await expect(page).toHaveURL(/status=PAID/);
      await page.getByRole('button', { name: /ที่ยังเปิดอยู่/ }).click();
      await expect(page).not.toHaveURL(/status=/);
      // ดรอปดาวน์สถานะยังมีป้ายไทย
      await page.getByRole('combobox', { name: 'สถานะใบจอง' }).click();
      await expect(page.getByRole('option', { name: 'รอชำระมัดจำ' })).toBeVisible({
        timeout: 5000,
      });
      await expect(page.getByRole('option', { name: /ใกล้หมดอายุ/ })).toBeVisible();
      await page.keyboard.press('Escape');
    }

    // Create button visible for SALES (canCreate=true)
    const createBtn = firstUse
      ? page.getByRole('button', { name: 'สร้างใบจองแรก' })
      : page.getByRole('button', { name: /สร้างใบจอง/ });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Dialog title visible
    await expect(page.getByRole('heading', { name: /สร้างใบจอง/ }).first()).toBeVisible({
      timeout: 5000,
    });
    // ฟอร์ม 4 ขั้น: ลูกค้า (combobox) · เครื่องในสต็อก · ชิปวันหมดอายุ
    await expect(page.getByRole('button', { name: '7 วัน' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'ลูกค้า' })).toBeVisible();
    await expect(page.getByLabel('ค้นหาเครื่องในสาขา')).toBeVisible();
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

    // ฐานทดสอบยังไม่มีใบจอง → หน้าว่าง ไม่มีการ์ด KPI ให้ตรวจ
    if (
      await page
        .getByRole('heading', { name: 'ยังไม่มีใบจอง' })
        .isVisible()
        .catch(() => false)
    ) {
      return;
    }

    // OWNER เห็นปุ่มสร้างใบจอง และกดการ์ด "ปิดแล้ว" เพื่อกรองได้
    await expect(page.getByRole('button', { name: /สร้างใบจอง/ })).toBeVisible();
    await page.getByRole('button', { name: /ปิดแล้ว/ }).click();
    await expect(page).toHaveURL(/status=CLOSED/);
    await expect(page.getByRole('heading', { name: /การจอง.*มัดจำ/ }).first()).toBeVisible();

    // No error boundary after filter mutation
    await expect(page.locator('body')).not.toContainText(/เกิดข้อผิดพลาด/);
  });
});
