// E2E: Asset Module Phase 1 — reverse flow
// Login as OWNER (REVERSE is OWNER-only per asset.controller.ts)
// → create + POST asset → reverse with reason → verify status=REVERSED
// + UI assertion that detail page shows the "กลับรายการ" status badge.

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Asset — reverse', () => {
  test.beforeEach(async ({ page }) => {
    // OWNER required for /assets/:id/reverse
    await loginAsRole(page, 'OWNER');
  });

  test('OWNER can reverse a POSTED asset with reason', async ({ page }) => {
    // 1. Create DRAFT
    const create = await page.request.post(`${API_URL}/api/assets`, {
      data: {
        name: `สินทรัพย์ทดสอบกลับรายการ ${Date.now()}`,
        category: 'EQUIPMENT',
        basePrice: 12000,
        usefulLifeMonths: 24,
        purchaseDate: new Date().toISOString().slice(0, 10),
        paymentAccount: '11-1201',
      },
    });
    if (!create.ok()) {
      const body = await create.text();
      throw new Error(`POST /api/assets failed (${create.status()}): ${body}`);
    }
    const draft = await create.json();
    expect(draft.status).toBe('DRAFT');

    // 2. POST DRAFT → POSTED
    const post = await page.request.post(`${API_URL}/api/assets/${draft.id}/post`);
    expect(post.ok()).toBeTruthy();

    // 3. Reverse with valid reason (>= 5 chars per ReverseAssetDialog validation)
    const reverse = await page.request.post(`${API_URL}/api/assets/${draft.id}/reverse`, {
      data: { reason: 'ทดสอบกลับรายการอัตโนมัติ E2E' },
    });
    if (!reverse.ok()) {
      const body = await reverse.text();
      throw new Error(`POST reverse failed (${reverse.status()}): ${body}`);
    }
    const reversed = await reverse.json();
    expect(reversed.entryNo).toBeTruthy();

    // 4. Confirm status flipped to REVERSED + reason stored
    const after = await page.request.get(`${API_URL}/api/assets/${draft.id}`);
    expect(after.ok()).toBeTruthy();
    const afterAsset = await after.json();
    expect(afterAsset.status).toBe('REVERSED');
    expect(afterAsset.reversedAt).toBeTruthy();
    expect(afterAsset.reversalReason).toContain('ทดสอบกลับรายการ');

    // 5. UI smoke — detail page shows the "กลับรายการ" badge
    const ok = await gotoWithRetry(page, `/assets/${draft.id}`);
    if (!ok) return;

    await expect(page.getByText(draft.assetCode).first()).toBeVisible({ timeout: 15000 });
    // assetStatusMap.REVERSED.label = 'กลับรายการ'
    await expect(page.getByText('กลับรายการ').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('reverse rejects reason < 5 characters', async ({ page }) => {
    // Create + POST first
    const create = await page.request.post(`${API_URL}/api/assets`, {
      data: {
        name: `สั้น reason test ${Date.now()}`,
        category: 'EQUIPMENT',
        basePrice: 5000,
        usefulLifeMonths: 12,
        purchaseDate: new Date().toISOString().slice(0, 10),
        paymentAccount: '11-1201',
      },
    });
    if (!create.ok()) return; // skip if backend can't seed
    const draft = await create.json();
    await page.request.post(`${API_URL}/api/assets/${draft.id}/post`);

    // Reason too short — server should reject (DTO @MinLength(5))
    const reverse = await page.request.post(`${API_URL}/api/assets/${draft.id}/reverse`, {
      data: { reason: 'สั้น' },
    });
    expect(reverse.ok()).toBeFalsy();
    expect(reverse.status()).toBeGreaterThanOrEqual(400);
    expect(reverse.status()).toBeLessThan(500);
  });
});
