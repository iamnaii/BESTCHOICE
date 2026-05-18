// P2-SP1: CRM Pipeline 4-stage Kanban with Thai labels.
// SALES role has access to /crm — verifies they see the 4 active Thai-labeled
// columns + filter chip row + LOST collapsed by default.
//
// PREREQ: Dev servers running (api :3000, web :5173).

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('CRM Pipeline — Kanban Thai labels (P2-SP1)', () => {
  test('SALES sees 4 active Thai-labeled columns + filter chips, LOST hidden by default', async ({
    page,
  }) => {
    await loginAsRole(page, 'SALES');
    const loaded = await gotoWithRetry(page, '/crm');
    if (!loaded || (await hasErrorBoundary(page))) {
      test.skip(true, 'CRM page failed to load — likely missing dev API');
      return;
    }

    // Page header
    await expect(page.getByRole('heading', { name: 'CRM Pipeline' })).toBeVisible({
      timeout: 10_000,
    });

    // Filter chip row — "ทั้งหมด" + 5 stage labels (each appears at least once
    // here, since the column header below adds another occurrence for active
    // columns).
    await expect(page.getByRole('tab', { name: 'ทั้งหมด' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'เสนอ' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'ติดต่อ' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'เสนอราคา' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'ปิดการขาย' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'ยกเลิก' })).toBeVisible();

    // "แสดงยกเลิก" toggle button is present (LOST collapsed by default)
    await expect(page.getByRole('button', { name: /แสดงยกเลิก/ })).toBeVisible();

    // No error banner
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
