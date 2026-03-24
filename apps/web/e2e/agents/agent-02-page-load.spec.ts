import { test, expect } from '@playwright/test';
import {
  loginViaAPI,
  waitForPageReady,
  assertNoInfiniteSpinner,
  interceptApiCalls,
  getFirstContractId,
} from './helpers/contract-helpers';

// ============================================================================
// Agent Team 2: Page Load — Anti-Spin Detection
// ตรวจว่าทุกหน้า Contract โหลดสำเร็จภายใน timeout ไม่หมุนค้าง
// ถ้า test นี้ fail = หน้าหมุนอย่างเดียว (infinite loading)
// ============================================================================

test.describe('Agent 2: Contract Pages Anti-Spin', () => {
  let contractId: string | null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginViaAPI(page);
    contractId = await getFirstContractId(page);
    await page.close();
  });

  test('Contracts list page (/contracts) loads without spinning', async ({ page }) => {
    await loginViaAPI(page);
    const apiCalls = interceptApiCalls(page);

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Must see either table content or empty state
    const content = page.locator('table, text=ยังไม่มีสัญญา, text=เกิดข้อผิดพลาด').first();
    await expect(content).toBeVisible({ timeout: 5000 });

    // Check for failed API calls
    const failures = apiCalls.filter(c => c.status >= 500);
    if (failures.length > 0) {
      console.error('API failures:', JSON.stringify(failures, null, 2));
    }
    expect(failures).toHaveLength(0);
  });

  test('Contract detail page (/contracts/:id) loads without spinning', async ({ page }) => {
    test.skip(!contractId, 'No contracts in database');
    await loginViaAPI(page);
    const apiCalls = interceptApiCalls(page);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Must see contract number on page
    await assertNoInfiniteSpinner(page, 'ContractDetail');

    // Log slow API calls (>3s)
    const slow = apiCalls.filter(c => c.duration > 3000);
    if (slow.length > 0) {
      console.warn('Slow API calls:', JSON.stringify(slow, null, 2));
    }
  });

  test('Contract create page (/contracts/create) loads without spinning', async ({ page }) => {
    await loginViaAPI(page);
    const apiCalls = interceptApiCalls(page);

    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Should see step 1 title or product list
    await assertNoInfiniteSpinner(page, 'ContractCreate');

    // Verify step indicator is visible (wizard step text)
    const stepText = page.locator('text=เลือกสินค้า');
    await expect(stepText).toBeVisible({ timeout: 5000 });
  });

  test('Contract templates page (/contract-templates) loads without spinning', async ({ page }) => {
    await loginViaAPI(page);

    await page.goto('/contract-templates', { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);
    await assertNoInfiniteSpinner(page, 'ContractTemplates');
  });

  test('Contract detail preview tab does not spin forever', async ({ page }) => {
    test.skip(!contractId, 'No contracts in database');
    await loginViaAPI(page);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Click preview tab
    const previewTab = page.locator('button:has-text("Preview"), button:has-text("พรีวิว"), button:has-text("ตัวอย่าง")').first();
    if (await previewTab.isVisible().catch(() => false)) {
      await previewTab.click();
      // Preview loads lazily — wait for spinner to resolve
      await waitForPageReady(page, 20000);
    }
  });

  test('All API calls complete within timeout on contracts page', async ({ page }) => {
    await loginViaAPI(page);
    const apiCalls = interceptApiCalls(page);

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    // Wait for network to settle
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // Summarize API performance
    console.log('=== API Call Summary ===');
    for (const call of apiCalls) {
      const status = call.status >= 400 ? '❌' : '✅';
      const speed = call.duration > 3000 ? '🐢' : call.duration > 1000 ? '⚠️' : '⚡';
      console.log(`${status} ${speed} ${call.duration}ms ${call.url}`);
    }

    // No API call should take more than 10 seconds
    const timeouts = apiCalls.filter(c => c.duration > 10000);
    expect(timeouts).toHaveLength(0);
  });
});
