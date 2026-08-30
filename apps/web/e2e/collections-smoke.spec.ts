import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   Collections Workflow Hub (/collections) — smoke tests
   ================================================================ */
test.describe('/collections workflow hub', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('OWNER: loads page with 5 tabs visible (including ภาพรวมทีม/วิเคราะห์)', async ({
    page,
  }) => {
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await expect(page.getByRole('heading', { name: /ติดตามหนี้/ }).first()).toBeVisible({
      timeout: 15000,
    });

    // Tab set = TAB_CONFIG in pages/CollectionsPage/components/CollectionsTabs.tsx.
    // 'ภาพรวมทีม' + 'วิเคราะห์' are gated to OWNER/FINANCE_MANAGER by TAB_ROLE_ACCESS
    // (pages/CollectionsPage/index.tsx) — OWNER sees all five.
    for (const label of ['คิววันนี้', 'นัดชำระ', 'ทั้งหมด', 'ภาพรวมทีม', 'วิเคราะห์']) {
      await expect(page.getByRole('button', { name: new RegExp(label) }).first()).toBeVisible({
        timeout: 5000,
      });
    }
  });

  // REMOVED: 'OWNER: switching to ตามต่อ shows the warning banner'.
  // The 'ตามต่อ' tab no longer exists — the follow-up queue was folded into a
  // filter on the main queue (see FilterDrawer / FilterChipsBar), so there is no
  // tab button and no banner left to assert on.

  test('OWNER: switching to นัดชำระ loads the promise queue', async ({ page }) => {
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await page
      .getByRole('button', { name: /นัดชำระ/ })
      .first()
      .click();
    // Either rendered content or empty state — should not crash
    await expect(page.locator('body')).not.toContainText(/เกิดข้อผิดพลาด/);
  });

  // REMOVED: 'OWNER: approval tab loads both pending sections'.
  // The 'อนุมัติ' tab was removed from CollectionsTabs; the approval queue became
  // filters on the main queue ('รออนุมัติ' in FilterDrawer, 'MDM รออนุมัติ' in
  // FilterChipsBar). Neither section heading exists in the source any more.

  test('OWNER: ทั้งหมด tab renders existing overdue content', async ({ page }) => {
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await page
      .getByRole('button', { name: /ทั้งหมด/ })
      .first()
      .click();
    // AllTab wraps OverduePage — its own PageHeader renders "ค่าปรับ & ค้างชำระ"
    await expect(page.getByText(/ค่าปรับ|ค้างชำระ/).first()).toBeVisible({ timeout: 10000 });
  });
});

/* ================================================================
   /overdue still works (flag off by default) — no redirect
   ================================================================ */
test.describe('/overdue backward compat', () => {
  test('existing /overdue still loads when flag is off (default)', async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/overdue');
    if (await hasErrorBoundary(page)) return;

    await expect(page.getByText(/ค้างชำระ|ค่าปรับ/).first()).toBeVisible({ timeout: 15000 });
  });
});

/* ================================================================
   Plan 3 Power Features — Customer 360 / Bulk / Ad-hoc LINE
   ================================================================ */
test.describe('/collections power features', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/collections');
  });

  test('no crash on tab switching through all 5 tabs', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    for (const label of ['นัดชำระ', 'ทั้งหมด', 'ภาพรวมทีม', 'วิเคราะห์', 'คิววันนี้']) {
      await page
        .getByRole('button', { name: new RegExp(label) })
        .first()
        .click();
      await expect(page.locator('body')).not.toContainText(/เกิดข้อผิดพลาด/);
    }
  });

  test('Customer 360 panel opens + closes without error', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;

    // Look for the 360 button (ChevronRight) on any contract card. Skip if none.
    const openBtn = page.locator('[title="เปิด Customer 360"]').first();
    if (!(await openBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      return; // No contracts to test with — environment has no data
    }

    await openBtn.click();
    await expect(page.getByRole('dialog', { name: /ข้อมูลลูกค้า 360/ })).toBeVisible({
      timeout: 5000,
    });

    // Close via the panel's own close button. Scope to the dialog + exact name:
    // a bare /ปิด/ regex also matches every card's "เปิด Customer 360" button
    // ("ปิด" is a substring of "เปิด") → strict-mode violation.
    await page
      .getByRole('dialog', { name: /ข้อมูลลูกค้า 360/ })
      .getByRole('button', { name: 'ปิด', exact: true })
      .click();

    // ⚠️ ห้ามใช้ not.toBeVisible() ที่นี่ — แผงนี้ **ไม่เคย unmount**:
    // CollectionsPage/index.tsx:182-186 เรนเดอร์ <Customer360Panel> ไว้เสมอ
    // (ส่ง contract={panelContract} ซึ่งเป็น null ตอนปิด) และ
    // components/Customer360Panel.tsx:154-160 ปิดด้วยการเลื่อนออกจากจอ
    // (`open ? 'translate-x-0' : 'translate-x-full'`) ไม่ใช่ถอดออกจาก DOM
    // ⇒ <aside role="dialog"> ยังมี bounding box อยู่ Playwright จึงนับว่า "visible"
    // ตลอด (ล็อก CI: `7 × locator resolved to <aside … translate-x-full>` →
    // `unexpected value "visible"`).
    // สิ่งที่ตรวจได้จริงคือ "เลื่อนพ้นจอแล้ว" — auto-retry รอ transition 200ms เอง
    await expect(page.getByRole('dialog', { name: /ข้อมูลลูกค้า 360/ })).not.toBeInViewport({
      timeout: 3000,
    });
  });

  // REMOVED: 'BulkActionBar appears when row selected'.
  // Bulk-select was dropped from /collections: no BulkActionBar exists anywhere in
  // the app, QueueTab has no row checkboxes, and AllTab renders <DataTable> without
  // `selectable`/`bulkActions` so its "เลือก N รายการ" bar can never appear. The
  // only checkbox left on the queue is the 'ซ่อนที่ทำแล้ววันนี้' filter. Assign /
  // send-LINE / propose-lock survive as per-contract actions (ContractCard).

  test('ad-hoc LINE dialog opens from contract card', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;

    // Find an enabled LINE send button (not the disabled ones for customers without lineId)
    const sendBtn = page.locator('[title="ส่ง LINE"]').first();
    if (!(await sendBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      return;
    }

    const disabled = await sendBtn.isDisabled().catch(() => true);
    if (disabled) return;

    await sendBtn.click();
    await expect(page.getByText(/ส่ง LINE ถึง/)).toBeVisible({ timeout: 3000 });
    // Close
    await page
      .getByRole('button', { name: /ยกเลิก/ })
      .first()
      .click();
  });

  // REMOVED: 'OWNER: approval tab shows Letter queue section header'.
  // Same reason as the approval-tab test above (no 'อนุมัติ' tab), plus the letter
  // queue now has its own page at /letters (LettersPage) — covered by
  // e2e/letters-page.spec.ts.
});
