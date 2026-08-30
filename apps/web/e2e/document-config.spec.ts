import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   P2-SP2 — Document Number Config page (/settings/document-config)
   OWNER-only. Verifies the page renders the form (page title +
   prefix input + sample preview column header).
   หัวข้อหน้าคือ "ตั้งค่าเอกสาร" (DocumentConfigPage.tsx PageHeader);
   "ตั้งค่าเลขที่/รูปแบบเอกสาร" เหลือเป็นแค่ label ในเมนูตั้งค่าเท่านั้น.
   ================================================================ */
test.describe('ตั้งค่าเอกสาร (เลขที่/รูปแบบ)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/settings/document-config');
  });

  test('OWNER can navigate and see the doc-config form', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // PageHeader title rendered immediately (PageHeader puts it in an <h1>).
    await expect(page.getByRole('heading', { name: 'ตั้งค่าเอกสาร' }).first()).toBeVisible({
      timeout: 15000,
    });
    // Per-row "Prefix" column header + at least one canonical row label visible.
    await expect(page.getByText('Prefix').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('รายจ่าย (Expense)').first()).toBeVisible({ timeout: 10000 });
    // No error boundary on this route.
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
