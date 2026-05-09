// E2E: Asset Module Phase 1 — create + post flow
// Login as FINANCE_MANAGER → create draft via API → POST → verify status=POSTED
// + UI smoke: list page renders, detail page shows code + status badge.
//
// Pattern follows other-income-smoke.spec.ts: drive heavy lifting through
// page.request (auth header set by loginAsRole) so we exercise the full
// HTTP stack without flaky form-fill selectors. UI assertions confirm the
// frontend renders the persisted record correctly.

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Asset — create + POST', () => {
  test.beforeEach(async ({ page }) => {
    // Asset POST requires OWNER or FINANCE_MANAGER (see asset.controller.ts)
    await loginAsRole(page, 'FINANCE_MANAGER');
  });

  test('list page renders', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/assets');
    if (!ok) return;

    await expect(
      page.getByRole('heading', { name: /สินทรัพย์/ }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('create draft via API → POST → verify POSTED in UI', async ({ page }) => {
    // Create DRAFT asset via API. Auth header is already set by loginAsRole.
    const create = await page.request.post(`${API_URL}/api/assets`, {
      data: {
        name: `เครื่องคอมพ์ทดสอบ E2E ${Date.now()}`,
        category: 'EQUIPMENT',
        basePrice: 30000,
        usefulLifeMonths: 36,
        purchaseDate: new Date().toISOString().slice(0, 10),
        paymentAccount: '11-1201',
      },
    });

    if (!create.ok()) {
      // Backend may not be wired in some local CI configs; fail loud with body
      const body = await create.text();
      throw new Error(`POST /api/assets failed (${create.status()}): ${body}`);
    }

    const draft = await create.json();
    expect(draft.id).toBeTruthy();
    expect(draft.status).toBe('DRAFT');
    expect(draft.assetCode).toMatch(/^[A-Z]{2,4}-/);

    // POST it (DRAFT → POSTED)
    const post = await page.request.post(`${API_URL}/api/assets/${draft.id}/post`);
    expect(post.ok()).toBeTruthy();
    const posted = await post.json();
    expect(posted.entryNo).toBeTruthy();

    // Re-fetch to confirm status flipped
    const after = await page.request.get(`${API_URL}/api/assets/${draft.id}`);
    expect(after.ok()).toBeTruthy();
    const afterAsset = await after.json();
    expect(afterAsset.status).toBe('POSTED');
    expect(afterAsset.postedAt).toBeTruthy();

    // UI sanity: detail page renders posted asset with code + Thai status label
    const ok = await gotoWithRetry(page, `/assets/${draft.id}`);
    if (!ok) return;

    await expect(page.getByText(draft.assetCode).first()).toBeVisible({ timeout: 15000 });
    // assetStatusMap.POSTED.label = 'ลงบัญชีแล้ว'
    await expect(page.getByText('ลงบัญชีแล้ว').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('entry page (/assets/new) renders form sections', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/assets/new');
    if (!ok) return;

    // Section titles from AssetEntrySection1Info / Section2Cost
    await expect(page.getByText('1. ข้อมูลสินทรัพย์').first()).toBeVisible({ timeout: 15000 });
    // The "บันทึก & POST" sticky button should be present
    await expect(
      page.getByRole('button', { name: /บันทึก.*POST/ }).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
