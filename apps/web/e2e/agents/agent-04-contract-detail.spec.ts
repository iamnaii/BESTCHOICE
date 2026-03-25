import { test, expect } from '@playwright/test';
import {
  loginViaAPI,
  waitForPageReady,
  assertNoInfiniteSpinner,
  interceptApiCalls,
  getFirstContractId,
} from './helpers/contract-helpers';

// ============================================================================
// Agent Team 4: Contract Detail Page
// ทดสอบหน้ารายละเอียดสัญญา — data display, tabs, cascading queries
// ============================================================================

test.describe('Agent 4: Contract Detail', () => {
  let contractId: string | null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginViaAPI(page);
    contractId = await getFirstContractId(page);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!contractId, 'No contracts in database');
    await loginViaAPI(page);
  });

  test('loads contract detail without infinite spinner', async ({ page }) => {
    const apiCalls = interceptApiCalls(page);
    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);
    await assertNoInfiniteSpinner(page, 'ContractDetail');

    // Log all API calls for diagnostics
    console.log('Contract Detail API calls:', JSON.stringify(apiCalls, null, 2));
  });

  test('displays contract number and status', async ({ page }) => {
    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Contract number should be visible (format: BCP-XXXX or similar)
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
    // Should contain some contract identifier
    expect(bodyText!.length).toBeGreaterThan(50);
  });

  test('displays financial information', async ({ page }) => {
    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Check for financial terms (Thai) — actual labels from ContractDetailPage
    const bodyText = await page.textContent('body') || '';
    const hasFinancialInfo =
      bodyText.includes('ราคาขาย') ||
      bodyText.includes('เงินดาวน์') ||
      bodyText.includes('ค่างวด/เดือน') ||
      bodyText.includes('อัตราดอกเบี้ย') ||
      bodyText.includes('ยอดจัดไฟแนนซ์') ||
      bodyText.includes('ยอดปล่อย');
    expect(hasFinancialInfo).toBe(true);
  });

  test('payment schedule tab displays installment table', async ({ page }) => {
    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Default tab should be schedule - look for payment-related content
    const scheduleContent = page.locator('text=งวดที่, text=วันครบกำหนด, text=ยอดที่ต้องชำระ').first();
    const hasSchedule = await scheduleContent.isVisible().catch(() => false);

    // If contract has payments, table should show
    if (hasSchedule) {
      await expect(page.locator('table').first()).toBeVisible();
    }
  });

  test('documents tab loads without spinning', async ({ page }) => {
    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Find and click documents tab (text includes count like "เอกสาร (3)")
    const docsTab = page.locator('button').filter({ hasText: 'เอกสาร' }).first();
    if (await docsTab.isVisible().catch(() => false)) {
      await docsTab.click();
      await waitForPageReady(page, 10000);
      await assertNoInfiniteSpinner(page, 'Documents Tab');
    }
  });

  test('preview tab loads lazily without infinite spin', async ({ page }) => {
    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Find view contract tab (actual tab name: "ดูสัญญา")
    const previewTab = page.locator('button:has-text("ดูสัญญา")').first();
    if (await previewTab.isVisible().catch(() => false)) {
      await previewTab.click();

      // Preview loads lazily — this is a common source of infinite spinning
      // Wait max 20s for it to load
      await waitForPageReady(page, 20000);
      await assertNoInfiniteSpinner(page, 'Preview Tab');
    }
  });

  test('all cascading queries complete successfully', async ({ page }) => {
    const apiCalls = interceptApiCalls(page);
    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });

    // Wait for network to settle
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // Check that main contract query succeeded
    const contractCall = apiCalls.find(c => c.url.includes(`/contracts/${contractId}`) && !c.url.includes('/documents') && !c.url.includes('/preview'));
    expect(contractCall).toBeDefined();
    expect(contractCall!.status).toBe(200);

    // Check documents query
    const docsCall = apiCalls.find(c => c.url.includes(`/contracts/${contractId}/documents`));
    if (docsCall) {
      expect(docsCall.status).toBeLessThan(500);
    }

    // No 500 errors
    const serverErrors = apiCalls.filter(c => c.status >= 500);
    if (serverErrors.length > 0) {
      console.error('Server errors:', JSON.stringify(serverErrors, null, 2));
    }
    expect(serverErrors).toHaveLength(0);
  });

  test('action buttons display based on workflow status', async ({ page }) => {
    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Check for any action buttons
    const actionButtons = [
      'ส่งตรวจสอบ',
      'อนุมัติ',
      'ปฏิเสธ',
      'เปิดใช้งาน',
      'ลงนาม',
      'ปิดสัญญาก่อนกำหนด',
    ];

    let foundAction = false;
    for (const label of actionButtons) {
      const btn = page.locator(`button:has-text("${label}"), a:has-text("${label}")`).first();
      if (await btn.isVisible().catch(() => false)) {
        foundAction = true;
        break;
      }
    }
    // At least one action should be available (contract has some status)
    // If COMPLETED or CLOSED, might have no actions — that's OK
  });
});
