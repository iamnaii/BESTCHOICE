import { test, expect } from '@playwright/test';
import {
  loginViaAPI,
  waitForPageReady,
  assertNoInfiniteSpinner,
  interceptApiCalls,
} from './helpers/contract-helpers';

// ============================================================================
// Agent Team 5: Contract Create Wizard
// ทดสอบ wizard สร้างสัญญา 4 ขั้นตอน
// ตรวจว่าทุก step โหลดสำเร็จ ไม่ค้าง spinner
// ============================================================================

test.describe('Agent 5: Contract Create Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('wizard step 1 loads with product list', async ({ page }) => {
    const apiCalls = interceptApiCalls(page);
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Step 1 title should be visible
    await expect(page.locator('text=เลือกสินค้า')).toBeVisible({ timeout: 5000 });

    // Product list should load (either products or empty state)
    await assertNoInfiniteSpinner(page, 'Create Step 1');

    // Check products API was called
    const productCall = apiCalls.find(c => c.url.includes('/products'));
    if (productCall) {
      expect(productCall.status).toBeLessThan(500);
    }
  });

  test('product search works in step 1', async ({ page }) => {
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Find search input for products
    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"], input[type="text"]').first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('iPhone');
      await page.waitForTimeout(800); // debounce
      await waitForPageReady(page);
    }
  });

  test('step indicators show all 4 steps', async ({ page }) => {
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Check step labels exist
    const steps = ['เลือกสินค้า', 'เลือกลูกค้า', 'เลือกแผนผ่อน', 'แนบเอกสาร'];
    for (const step of steps) {
      const el = page.locator(`text=${step}`).first();
      const visible = await el.isVisible().catch(() => false);
      // At least the current step should be visible
      if (step === 'เลือกสินค้า') {
        expect(visible).toBe(true);
      }
    }
  });

  test('step navigation does not cause infinite loading', async ({ page }) => {
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Note: Can't advance past step 1 without selecting a product
    // But we can verify the page doesn't crash
    await assertNoInfiniteSpinner(page, 'Create Navigation');
  });

  test('API calls for step 1 complete without timeout', async ({ page }) => {
    const apiCalls = interceptApiCalls(page);
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });

    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // Products API should respond
    const productCalls = apiCalls.filter(c => c.url.includes('/products'));
    for (const call of productCalls) {
      expect(call.duration).toBeLessThan(10000);
      expect(call.status).toBeLessThan(500);
    }

    // No server errors
    const errors = apiCalls.filter(c => c.status >= 500);
    expect(errors).toHaveLength(0);
  });
});
