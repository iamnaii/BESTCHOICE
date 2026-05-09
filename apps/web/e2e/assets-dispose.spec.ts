// E2E: Asset Module Phase 2 — dispose flow (SALE + WRITE_OFF)
// Login as FINANCE_MANAGER → create + POST asset → dispose (SALE or WRITE_OFF)
// → verify JE entry created + status=DISPOSED/WRITTEN_OFF
//
// Pattern follows assets-create-post.spec.ts: API-driven with UI smoke verification.

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Asset — dispose', () => {
  test.beforeEach(async ({ page }) => {
    // Asset disposal requires OWNER or FINANCE_MANAGER
    await loginAsRole(page, 'FINANCE_MANAGER');
  });

  test('dispose POSTED asset via SALE (produces JE)', async ({ page }) => {
    // Create DRAFT asset
    const createRes = await page.request.post(`${API_URL}/api/assets`, {
      data: {
        name: `E2E Dispose Sale Test ${Date.now()}`,
        category: 'EQUIPMENT',
        basePrice: 30000,
        usefulLifeMonths: 36,
        purchaseDate: new Date().toISOString().slice(0, 10),
        paymentAccount: '11-1201',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('DRAFT');

    // POST the asset (DRAFT → POSTED)
    const postRes = await page.request.post(`${API_URL}/api/assets/${created.id}/post`);
    expect(postRes.ok()).toBeTruthy();

    // Verify POSTED
    const afterPost = await page.request.get(`${API_URL}/api/assets/${created.id}`);
    expect(afterPost.ok()).toBeTruthy();
    const posted = await afterPost.json();
    expect(posted.status).toBe('POSTED');

    // Now dispose via SALE
    const disposeRes = await page.request.post(`${API_URL}/api/assets/${created.id}/dispose`, {
      data: {
        disposalType: 'SALE',
        disposalDate: new Date().toISOString().slice(0, 10),
        proceeds: 25000,
        depositAccountCode: '11-1201',
        reason: 'E2E test sale disposal',
      },
    });
    expect(disposeRes.ok()).toBeTruthy();
    const disposed = await disposeRes.json();

    // Verify JE was created
    expect(disposed.entryNo).toBeTruthy();
    expect(disposed.entryNo).toMatch(/^JE-/);

    // Verify asset status is now DISPOSED
    const afterDispose = await page.request.get(`${API_URL}/api/assets/${created.id}`);
    expect(afterDispose.ok()).toBeTruthy();
    const detail = await afterDispose.json();
    expect(detail.status).toBe('DISPOSED');
    expect(detail.disposedAt).toBeTruthy();

    // UI smoke: detail page renders disposed asset with status badge
    const ok = await gotoWithRetry(page, `/assets/${created.id}`);
    if (!ok) return;

    // Status badge should show 'จำหน่ายแล้ว' (DISPOSED in Thai)
    await expect(page.getByText('จำหน่ายแล้ว').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('WRITE_OFF asset (no proceeds)', async ({ page }) => {
    // Create DRAFT asset
    const createRes = await page.request.post(`${API_URL}/api/assets`, {
      data: {
        name: `E2E Write-Off Test ${Date.now()}`,
        category: 'EQUIPMENT',
        basePrice: 5000,
        usefulLifeMonths: 12,
        purchaseDate: new Date().toISOString().slice(0, 10),
        paymentAccount: '11-1201',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // POST it
    const postRes = await page.request.post(`${API_URL}/api/assets/${created.id}/post`);
    expect(postRes.ok()).toBeTruthy();

    // Write off (no proceeds, no account code required)
    const writeOffRes = await page.request.post(`${API_URL}/api/assets/${created.id}/dispose`, {
      data: {
        disposalType: 'WRITE_OFF',
        disposalDate: new Date().toISOString().slice(0, 10),
        reason: 'E2E test write-off — เครื่องเสีย',
      },
    });
    expect(writeOffRes.ok()).toBeTruthy();
    const result = await writeOffRes.json();
    expect(result.entryNo).toBeTruthy();

    // Verify WRITTEN_OFF status
    const afterDispose = await page.request.get(`${API_URL}/api/assets/${created.id}`);
    expect(afterDispose.ok()).toBeTruthy();
    const detail = await afterDispose.json();
    expect(detail.status).toBe('WRITTEN_OFF');
    expect(detail.disposedAt).toBeTruthy();

    // UI smoke
    const ok = await gotoWithRetry(page, `/assets/${created.id}`);
    if (!ok) return;

    // Status badge should show 'เลิกใช้แล้ว' (WRITTEN_OFF in Thai)
    await expect(page.getByText('เลิกใช้แล้ว').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
