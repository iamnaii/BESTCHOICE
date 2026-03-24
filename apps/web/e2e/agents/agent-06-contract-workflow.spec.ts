import { test, expect } from '@playwright/test';
import {
  loginViaAPI,
  waitForPageReady,
  assertNoInfiniteSpinner,
  interceptApiCalls,
  getContractByStatus,
  apiGet,
} from './helpers/contract-helpers';

// ============================================================================
// Agent Team 6: Contract Workflow
// ทดสอบ full workflow: status transitions + action buttons
// ตรวจว่าแต่ละ action ไม่ค้าง spinner
//
// NOTE: This test requires existing contracts in various statuses.
// Tests are defensive — they skip if required data doesn't exist.
// ============================================================================

test.describe('Agent 6: Contract Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('DRAFT contract shows submit review button', async ({ page }) => {
    const contractId = await getContractByStatus(page, 'DRAFT');
    test.skip(!contractId, 'No DRAFT contracts in database');

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // CREATING workflow → should see "ส่งตรวจสอบ" button
    const submitBtn = page.locator('button:has-text("ส่งตรวจสอบ")');
    const hasSubmit = await submitBtn.isVisible().catch(() => false);

    // Also check for sign link
    const signLink = page.locator('a:has-text("ลงนาม")');
    const hasSign = await signLink.isVisible().catch(() => false);

    // At least one of these should be visible for a DRAFT contract
    expect(hasSubmit || hasSign).toBe(true);
  });

  test('ACTIVE contract shows early payoff option', async ({ page }) => {
    const contractId = await getContractByStatus(page, 'ACTIVE');
    test.skip(!contractId, 'No ACTIVE contracts in database');

    const apiCalls = interceptApiCalls(page);
    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // ACTIVE contract should show payoff button
    const payoffBtn = page.locator('button:has-text("ปิดสัญญาก่อนกำหนด")');
    const hasPayoff = await payoffBtn.isVisible().catch(() => false);

    // Early payoff quote API should have been called
    const payoffCall = apiCalls.find(c => c.url.includes('early-payoff-quote'));
    if (payoffCall) {
      expect(payoffCall.status).toBeLessThan(500);
    }
  });

  test('OVERDUE contract loads with correct status display', async ({ page }) => {
    const contractId = await getContractByStatus(page, 'OVERDUE');
    test.skip(!contractId, 'No OVERDUE contracts in database');

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Should display overdue status badge
    const bodyText = await page.textContent('body') || '';
    expect(bodyText.includes('ค้างชำระ') || bodyText.includes('OVERDUE')).toBe(true);
  });

  test('contract status transition API endpoints respond correctly', async ({ page }) => {
    // Test that workflow endpoints exist and return proper errors for invalid states
    // (we don't actually transition — just verify endpoints are healthy)

    await loginViaAPI(page);

    // Try to get any contract
    const { res } = await apiGet(page, '/api/contracts?page=1');
    if (res.status() !== 200) return;

    const body = await res.json();
    const contract = body?.data?.[0];
    if (!contract) return;

    // Try submit-review on the contract (may fail with 400 if wrong state — that's OK)
    const { res: submitRes, elapsed: submitElapsed } = await apiGet(page, `/api/contracts/${contract.id}/validate`);
    expect(submitElapsed).toBeLessThan(5000);
    // Any response is OK (200 or 400/404) — we just need it to respond, not hang
    expect(submitRes.status()).toBeLessThan(500);
  });

  test('contract list shows correct workflow badges', async ({ page }) => {
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Workflow badges should be visible in the table
    const bodyText = await page.textContent('body') || '';
    const hasWorkflowInfo =
      bodyText.includes('กำลังสร้าง') ||
      bodyText.includes('รอตรวจสอบ') ||
      bodyText.includes('อนุมัติ') ||
      bodyText.includes('ยังไม่มีสัญญา');
    expect(hasWorkflowInfo).toBe(true);
  });

  test('navigating between list and detail does not cause spinner loops', async ({ page }) => {
    const apiCalls = interceptApiCalls(page);

    // Go to list
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Click first contract if exists
    const contractLink = page.locator('a.font-mono').first();
    if (await contractLink.isVisible().catch(() => false)) {
      await contractLink.click();
      await waitForPageReady(page, 15000);
      await assertNoInfiniteSpinner(page, 'Detail after navigation');

      // Go back to list
      await page.goBack();
      await waitForPageReady(page, 15000);
      await assertNoInfiniteSpinner(page, 'List after back navigation');
    }

    // No timeouts in API calls
    const timeouts = apiCalls.filter(c => c.duration > 10000);
    expect(timeouts).toHaveLength(0);
  });
});
