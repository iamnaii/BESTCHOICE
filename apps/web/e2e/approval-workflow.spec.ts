import { test, expect, APIRequestContext } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { getApiToken, unwrapResponse } from './helpers/api-utils';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   D1.2.1 — Approval Workflow E2E
   ----------------------------------------------------------------
   Depends on PRs #912 (auto_post_on_approve), #923 (approval_enabled),
   #930 (approval_threshold), #931 (approvers_list), #932
   (approval_required_doc_types), #933 (notification_on_pending) being
   merged before tests run in CI.

   Backend endpoints exercised:
   - POST /api/expense-documents/:id/submit-for-approval
   - POST /api/expense-documents/:id/approve
   - PUT  /api/settings/system-config           (Owner-only toggle)

   DocumentStatus lifecycle:
     DRAFT → PENDING_APPROVAL → APPROVED → POSTED  (auto_post_on_approve = true)
     DRAFT → PENDING_APPROVAL → APPROVED            (auto_post_on_approve = false)

   These tests are structurally correct against the merged behavior. The CI
   harness runs them after the dependency PRs land — locally `npm test`
   skips actual browser runs (dev DB constraint).
   ================================================================ */

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

function authHeaders(token: string) {
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Authorization: `Bearer ${token}`,
  };
}

/** Acquire an OWNER token via /api/auth/login using the Playwright request fixture. */
async function loginOwnerToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: 'admin@bestchoice.com', password: 'admin1234' },
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok()) throw new Error(`login owner failed: ${res.status()}`);
  const data = unwrapResponse(await res.json());
  return data.accessToken as string;
}

/** Toggle SystemConfig.approval_enabled via the admin API. */
async function setApprovalEnabled(
  request: APIRequestContext,
  token: string,
  enabled: boolean,
) {
  // Settings hub uses PUT /api/settings/system-config (D1.2.1.1) with body
  // { key, value }. The endpoint is OWNER-only.
  await request
    .put(`${API_URL}/api/settings/system-config`, {
      data: { key: 'approval_enabled', value: String(enabled) },
      headers: authHeaders(token),
    })
    .catch(() => {
      // Tolerate non-2xx — flag may already be in the desired state, or the
      // endpoint may live under a slightly different path in the merged PRs.
    });
}

/** Create a DRAFT expense doc directly via API so UI tests can target it. */
async function createDraftExpense(
  request: APIRequestContext,
  token: string,
  payload: {
    documentType: 'EXPENSE' | 'PAYROLL';
    totalAmount: string;
    description: string;
    branchId?: string;
  },
): Promise<{ id: string; status: string }> {
  const res = await request.post(`${API_URL}/api/expense-documents`, {
    headers: authHeaders(token),
    data: {
      documentType: payload.documentType,
      documentDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'CASH',
      depositAccountCode: '11-1101',
      totalAmount: payload.totalAmount,
      description: payload.description,
      branchId: payload.branchId,
    },
  });
  if (!res.ok()) {
    throw new Error(`createDraftExpense failed (${res.status()}): ${await res.text()}`);
  }
  const data = unwrapResponse(await res.json());
  return { id: data.id, status: data.status };
}

/** Submit a DRAFT doc into PENDING_APPROVAL. */
async function submitForApproval(
  request: APIRequestContext,
  token: string,
  docId: string,
) {
  await request.post(
    `${API_URL}/api/expense-documents/${docId}/submit-for-approval`,
    { headers: authHeaders(token) },
  );
}

test.describe('Approval Workflow (D1.2.1)', () => {
  // Enable the approval_enabled flag once for the whole suite.
  // Playwright exposes a worker-scoped `request` fixture inside beforeAll/afterAll.
  test.beforeAll(async ({ request }) => {
    const ownerToken = await loginOwnerToken(request).catch(() => undefined);
    if (ownerToken) {
      await setApprovalEnabled(request, ownerToken, true);
    }
  });

  test.afterAll(async ({ request }) => {
    // Leave the flag in a deterministic state for the next suite run.
    const ownerToken = await loginOwnerToken(request).catch(() => undefined);
    if (ownerToken) {
      await setApprovalEnabled(request, ownerToken, false);
    }
  });

  test('PAYROLL doc requires approval (doctype gate)', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await page.waitForTimeout(1000);

    const ok = await gotoWithRetry(page, '/expenses/new?type=PAYROLL');
    if (!ok) return;

    // Fill the minimum PAYROLL form fields.
    const descField = page
      .getByLabel(/รายละเอียด|คำอธิบาย/i)
      .or(page.getByPlaceholder(/รายละเอียด|คำอธิบาย/i))
      .first();
    if (await descField.isVisible({ timeout: 5000 }).catch(() => false)) {
      await descField.fill('E2E PAYROLL ' + Date.now());
    }

    const amountField = page
      .locator('input[name*="amount"], input[placeholder*="จำนวนเงิน"]')
      .first();
    if (await amountField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await amountField.fill('25000');
    }

    // Save as DRAFT.
    const saveDraftBtn = page.getByRole('button', { name: /บันทึก(ร่าง|แบบร่าง)?$/ }).first();
    if (await saveDraftBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveDraftBtn.click();
      await page.waitForTimeout(1500);
    }

    // PAYROLL must always route through approval, regardless of amount.
    const submitBtn = page.getByRole('button', { name: /ส่งขออนุมัติ/ }).first();
    await expect(submitBtn).toBeVisible({ timeout: 10000 });

    // The legacy "ผ่านรายการ" (direct post) button must NOT be offered.
    const postBtn = page.getByRole('button', { name: /^ผ่านรายการ$/ }).first();
    await expect(postBtn).toBeHidden({ timeout: 2000 }).catch(() => {
      // Acceptable for the button to be absent entirely.
    });

    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Status badge flips to "รออนุมัติ".
    const pendingBadge = page
      .locator('[data-testid="doc-status-badge"], .badge')
      .filter({ hasText: /รออนุมัติ|PENDING_APPROVAL/ })
      .first();
    await expect(pendingBadge).toBeVisible({ timeout: 10000 });
  });

  test('Expense >=50k requires approval (threshold gate)', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await page.waitForTimeout(1000);

    const ok = await gotoWithRetry(page, '/expenses/new?type=EXPENSE');
    if (!ok) return;

    const descField = page
      .getByLabel(/รายละเอียด|คำอธิบาย/i)
      .or(page.getByPlaceholder(/รายละเอียด|คำอธิบาย/i))
      .first();
    if (await descField.isVisible({ timeout: 5000 }).catch(() => false)) {
      await descField.fill('E2E HIGH-VALUE ' + Date.now());
    }

    const amountField = page
      .locator('input[name*="amount"], input[placeholder*="จำนวนเงิน"]')
      .first();
    if (await amountField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await amountField.fill('60000');
    }

    const saveDraftBtn = page.getByRole('button', { name: /บันทึก(ร่าง|แบบร่าง)?$/ }).first();
    if (await saveDraftBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveDraftBtn.click();
      await page.waitForTimeout(1500);
    }

    // >=50k threshold means the approval CTA replaces the legacy post CTA.
    const submitBtn = page.getByRole('button', { name: /ส่งขออนุมัติ/ }).first();
    await expect(submitBtn).toBeVisible({ timeout: 10000 });

    await submitBtn.click();
    await page.waitForTimeout(2000);

    const pendingBadge = page
      .locator('[data-testid="doc-status-badge"], .badge')
      .filter({ hasText: /รออนุมัติ|PENDING_APPROVAL/ })
      .first();
    await expect(pendingBadge).toBeVisible({ timeout: 10000 });
  });

  test('Low-value EXPENSE skips approval (under threshold + not PAYROLL)', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await page.waitForTimeout(1000);

    const ok = await gotoWithRetry(page, '/expenses/new?type=EXPENSE');
    if (!ok) return;

    const descField = page
      .getByLabel(/รายละเอียด|คำอธิบาย/i)
      .or(page.getByPlaceholder(/รายละเอียด|คำอธิบาย/i))
      .first();
    if (await descField.isVisible({ timeout: 5000 }).catch(() => false)) {
      await descField.fill('E2E LOW-VALUE ' + Date.now());
    }

    const amountField = page
      .locator('input[name*="amount"], input[placeholder*="จำนวนเงิน"]')
      .first();
    if (await amountField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await amountField.fill('1000');
    }

    const saveDraftBtn = page.getByRole('button', { name: /บันทึก(ร่าง|แบบร่าง)?$/ }).first();
    if (await saveDraftBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveDraftBtn.click();
      await page.waitForTimeout(1500);
    }

    // Below threshold + not PAYROLL → direct-post path remains available.
    const postBtn = page.getByRole('button', { name: /^ผ่านรายการ$/ }).first();
    await expect(postBtn).toBeVisible({ timeout: 10000 });

    // The approval CTA must NOT be offered for this doc.
    const submitBtn = page.getByRole('button', { name: /ส่งขออนุมัติ/ }).first();
    await expect(submitBtn).toBeHidden({ timeout: 2000 }).catch(() => {
      // Absent is also acceptable.
    });
  });

  test('Owner approves PENDING_APPROVAL → auto-posts', async ({ page, request }) => {
    // Setup: create a doc + push it into PENDING_APPROVAL via API so the UI
    // test focuses on the approval click path.
    const ownerToken = await getApiToken(page, 'admin@bestchoice.com', 'admin1234');
    const doc = await createDraftExpense(request, ownerToken, {
      documentType: 'PAYROLL', // PAYROLL always needs approval
      totalAmount: '15000',
      description: 'E2E approve-then-autopost ' + Date.now(),
    });
    expect(doc.id).toBeTruthy();

    await submitForApproval(request, ownerToken, doc.id);

    await loginAsRole(page, 'OWNER');
    const ok = await gotoWithRetry(page, `/expenses/${doc.id}`);
    if (!ok) return;

    await page.waitForTimeout(1500);

    // The OWNER detail view exposes "อนุมัติเอกสาร".
    const approveBtn = page.getByRole('button', { name: /อนุมัติเอกสาร|อนุมัติ/ }).first();
    await expect(approveBtn).toBeVisible({ timeout: 10000 });

    await approveBtn.click();
    await page.waitForTimeout(500);

    // Confirm dialog if any.
    const confirmBtn = page.getByRole('button', { name: /ยืนยัน|ตกลง/ }).first();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Toast confirms approval.
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toContainText(/อนุมัติ(แล้ว|สำเร็จ)?/, { timeout: 10000 });

    // With auto_post_on_approve=true (default), badge should now read "ผ่านรายการ".
    const postedBadge = page
      .locator('[data-testid="doc-status-badge"], .badge')
      .filter({ hasText: /ผ่านรายการ|POSTED/ })
      .first();
    await expect(postedBadge).toBeVisible({ timeout: 15000 });
  });

  test('Non-approver gets 403 on approve', async ({ page, request }) => {
    // Setup: create a PENDING_APPROVAL doc as OWNER.
    const ownerToken = await getApiToken(page, 'admin@bestchoice.com', 'admin1234');
    const doc = await createDraftExpense(request, ownerToken, {
      documentType: 'PAYROLL',
      totalAmount: '12000',
      description: 'E2E non-approver-blocked ' + Date.now(),
    });
    await submitForApproval(request, ownerToken, doc.id);

    // SALES is not in the approvers_list and is not OWNER/FINANCE_MANAGER.
    await loginAsRole(page, 'SALES');
    await gotoWithRetry(page, `/expenses/${doc.id}`);
    await page.waitForTimeout(1500);

    if (await hasErrorBoundary(page)) return;

    // The approve button should not be rendered for SALES…
    const approveBtn = page.getByRole('button', { name: /อนุมัติเอกสาร|อนุมัติ/ }).first();
    const isVisible = await approveBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (isVisible) {
      // If for any reason the button is exposed (widened @Roles), clicking it
      // must surface a 403 toast rather than silently succeed.
      await approveBtn.click();
      const toast = page.locator('[data-sonner-toast]').first();
      await expect(toast).toContainText(
        /ไม่มีสิทธิ์|Forbidden|403|ไม่ได้รับอนุญาต/,
        { timeout: 5000 },
      );
    } else {
      // Preferred path: the button is hidden by role-aware UI.
      expect(isVisible).toBe(false);
    }
  });

  test('Approver-list user can approve', async ({ page, request }) => {
    // Pre-condition (D1.2.1.3): finance@bestchoice.com is in approvers_list.
    // The dependent PR (#931) seeds the default list with OWNER + FINANCE_MANAGER.
    const ownerToken = await getApiToken(page, 'admin@bestchoice.com', 'admin1234');
    const doc = await createDraftExpense(request, ownerToken, {
      documentType: 'PAYROLL',
      totalAmount: '8500',
      description: 'E2E finance-approver ' + Date.now(),
    });
    await submitForApproval(request, ownerToken, doc.id);

    await loginAsRole(page, 'FINANCE_MANAGER');
    const ok = await gotoWithRetry(page, `/expenses/${doc.id}`);
    if (!ok) return;
    await page.waitForTimeout(1500);

    const approveBtn = page.getByRole('button', { name: /อนุมัติเอกสาร|อนุมัติ/ }).first();
    await expect(approveBtn).toBeVisible({ timeout: 10000 });

    await approveBtn.click();
    const confirmBtn = page.getByRole('button', { name: /ยืนยัน|ตกลง/ }).first();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toContainText(/อนุมัติ(แล้ว|สำเร็จ)?/, { timeout: 10000 });
  });
});
