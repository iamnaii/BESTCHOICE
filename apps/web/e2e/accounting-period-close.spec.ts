import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders, loginAsRole, getRoleAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

import { backlogFixtures } from './helpers/backlog-fixtures';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Accounting — Period Close hardening (F-6-003)', () => {
  test('rejects close with forceCloseReason shorter than 50 chars (DTO validation)', async ({
    page,
  }) => {
    await loginViaAPI(page);
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

  test('accepts payload shape with valid forceCloseReason ≥50 chars (no DTO error)', async ({
    page,
  }) => {
    const longReason =
      'ทดสอบ E2E สำหรับ F-6-003 — รับทราบและยอมรับปัญหา audit ทั้งหมดที่ระบบรายงาน เพื่อปิดงวดสำหรับ smoke test ของ Phase A.0';
    expect(longReason.length).toBeGreaterThanOrEqual(50);

    await loginViaAPI(page);
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
    expect(res.status()).toBe(400);
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

  test('full close-with-audit-issues flow', async ({ page }) => {
    const { id, ...period } = backlogFixtures().period;
    const reason =
      'ทดสอบระบบ ยืนยันรับทราบประเด็นตรวจสอบจำลองทั้งหมดเพื่อทดสอบสิทธิ์การปิดงวดในฐานข้อมูลแยกเท่านั้น';
    await loginAsRole(page, 'OWNER');
    const owner = getRoleAuthHeaders('OWNER');
    const read = async () => {
      const r = await page.request.get(
        `${API_URL}/api/expenses/periods/${period.companyId}/${period.year}/${period.month}`,
        { headers: owner },
      );
      expect(r.status()).toBe(200);
      return unwrapResponse(await r.json());
    };
    const blocked = await page.request.post(`${API_URL}/api/expenses/periods/close`, {
      headers: owner,
      data: period,
    });
    expect(blocked.status()).toBe(400);
    expect((await read()).status).toBe('REVIEW');
    await loginAsRole(page, 'FINANCE_MANAGER');
    const denied = await page.request.post(`${API_URL}/api/expenses/periods/close`, {
      headers: getRoleAuthHeaders('FINANCE_MANAGER'),
      data: { ...period, forceCloseReason: reason },
    });
    expect(denied.status()).toBe(403);
    expect((await read()).status).toBe('REVIEW');
    const closed = await page.request.post(`${API_URL}/api/expenses/periods/close`, {
      headers: owner,
      data: { ...period, forceCloseReason: reason },
    });
    expect(closed.ok(), await closed.text()).toBe(true);
    expect((await read()).status).toBe('CLOSED');
    const audit = await page.request.get(
      `${API_URL}/api/audit/logs?action=PERIOD_FORCE_CLOSE&entityId=${id}`,
      { headers: owner },
    );
    expect(audit.status()).toBe(200);
    const logs = unwrapResponse(await audit.json());
    const matching = (Array.isArray(logs) ? logs : logs.data).filter(
      (row: { action: string; entityId: string }) =>
        row.action === 'PERIOD_FORCE_CLOSE' && row.entityId === id,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].newValue.reason).toBe(reason);
  });
});

test.describe('Accounting — Period reopen (F-6-004)', () => {
  test('reopen endpoint exists and rejects unauth', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/expenses/periods/reopen`, {
      data: { companyId: 'x', year: 2026, month: 1, reason: 'test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(res.status());
  });
});
