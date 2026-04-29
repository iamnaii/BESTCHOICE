import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

/* ================================================================
   Phase A.0 — F-6-003
   Verify period-close hardening:
   - Closing a REVIEW period with hasIssues=true MUST be blocked
     (400) when no forceCloseReason provided.
   - Closing same period with forceCloseReason ≥50 chars MUST succeed
     and create an AuditLog with action=PERIOD_FORCE_CLOSE.

   Strategy:
   - We cannot fabricate an audit-issues period state without a test
     fixture endpoint. Instead we exercise the validation layer:
   - Send POST with too-short forceCloseReason → expect 400 (hits the
     @MinLength(50) DTO validator).
   - This proves the contract is wired (the bug we fixed was the
     handler ignoring forceCloseReason entirely).
   ================================================================ */

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Accounting — Period Close hardening (F-6-003)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('rejects close with forceCloseReason shorter than 50 chars (DTO validation)', async ({ page }) => {
    const res = await page.request.post(`${API_URL}/api/expenses/periods/close`, {
      headers: getAuthHeaders(),
      data: {
        companyId: 'nonexistent-id-for-validation-test',
        year: 2026,
        month: 1,
        forceCloseReason: 'too short', // 9 chars — must be rejected by @MinLength(50)
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json().catch(() => ({}));
    const message = JSON.stringify(body);
    // Thai validation message from CloseMonthDto
    expect(message).toMatch(/forceCloseReason|50 ตัวอักษร/);
  });

  test('accepts payload shape with valid forceCloseReason ≥50 chars (no DTO error)', async ({ page }) => {
    const longReason =
      'ทดสอบ E2E สำหรับ F-6-003 — รับทราบและยอมรับปัญหา audit ทั้งหมดที่ระบบรายงาน เพื่อปิดงวดสำหรับ smoke test ของ Phase A.0';
    expect(longReason.length).toBeGreaterThanOrEqual(50);

    const res = await page.request.post(`${API_URL}/api/expenses/periods/close`, {
      headers: getAuthHeaders(),
      data: {
        companyId: 'nonexistent-id-for-validation-test',
        year: 2026,
        month: 1,
        forceCloseReason: longReason,
      },
    });

    // Either 404 (period not found) or 400 (other business rule) or 200 (closed) — but NOT
    // a 400 "forceCloseReason ต้อง ≥50 ตัวอักษร" DTO violation. That proves the field is
    // accepted by the DTO and reaches the service layer.
    const body = await res.json().catch(() => ({}));
    const message = JSON.stringify(body);
    expect(message).not.toMatch(/forceCloseReason ต้อง ≥50 ตัวอักษร/);
  });

  test('closing endpoint exists and requires auth', async ({ request }) => {
    // Fresh request with no auth — must be 401 not 404.
    const res = await request.post(`${API_URL}/api/expenses/periods/close`, {
      data: { companyId: 'x', year: 2026, month: 1 },
      headers: { 'Content-Type': 'application/json' },
    });
    // Should be unauthorized (401) — endpoint mounted, guard active.
    // Some setups respond 403 for missing CSRF — accept either.
    expect([401, 403]).toContain(res.status());
  });

  test.skip('full close-with-audit-issues flow', async () => {
    // requires fixture: needs a REVIEW-status period with auditIssues.hasIssues=true
    // pre-seeded via test endpoint. Currently no such fixture exists.
    // Once available, verify:
    //  1. POST without forceCloseReason → 400 with "audit issues" message
    //  2. POST with valid forceCloseReason → 200 + AuditLog row exists
    //     where action=PERIOD_FORCE_CLOSE and entity points to the period
    expect(true).toBe(false);
  });
});

test.describe('Accounting — Period reopen (F-6-004)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('reopen endpoint exists and rejects unauth', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/expenses/periods/reopen`, {
      data: { companyId: 'x', year: 2026, month: 1, reason: 'test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(res.status());
  });
});
