import { test, expect } from '@playwright/test';
import { loginAsRole, getRoleAuthHeaders } from './helpers/auth';

import { backlogFixtures } from './helpers/backlog-fixtures';

/**
 * Contract Template Verification
 *
 * Ensures the full hire-purchase-contract.html template (8 pages, ~308 lines)
 * is loaded correctly — NOT the simplified inline fallback.
 *
 * If the build process fails to copy templates/*.html to dist/, this test
 * will catch it before deployment.
 */
test.describe('Contract Template — Full Template Loaded', () => {
  test('contract preview shows full hire-purchase template (not fallback)', async ({ page }) => {
    const contract = backlogFixtures().template;
    await loginAsRole(page, 'OWNER');
    const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';

    // Fetch the contract preview HTML directly via API
    const previewResponse = await page.request.get(
      `${apiURL}/api/contracts/${contract.id}/preview`,
      { headers: getRoleAuthHeaders('OWNER') },
    );
    expect(previewResponse.ok()).toBeTruthy();

    expect(previewResponse.status()).toBe(200);
    const previewData = await previewResponse.json();
    const html: string = previewData?.data?.html || previewData?.html || '';

    // ── Assertions: must be full template, NOT fallback ──

    // Full template marker (from hire-purchase-contract.html)
    expect(html).toContain('สัญญาเช่าซื้อโทรศัพท์มือถือ');

    // Full template has all 26 ข้อ — check for key sections
    expect(html).toContain('ข้อ 1'); // วัตถุประสงค์
    expect(html).toContain('ข้อ 4'); // ค่าเช่าซื้อ
    expect(html).toContain('ข้อ 8'); // ผิดนัดชำระ
    expect(html).toContain('ข้อ 15'); // กรรมสิทธิ์
    expect(html).toContain('ข้อ 21'); // ผลการสิ้นสุดสัญญา

    // Fallback template would have "สัญญาผ่อนชำระ" instead — must NOT appear
    expect(html).not.toMatch(/<h1[^>]*>สัญญาผ่อนชำระ<\/h1>/);

    // Must have signature section
    expect(html).toContain('ผู้ให้เช่าซื้อ');
    expect(html).toContain('ผู้เช่าซื้อ');
    expect(html).toContain('พยาน');
  });

  test('contract preview HTML is non-trivial size (full template, not fallback)', async ({
    page,
  }) => {
    const contract = backlogFixtures().template;
    await loginAsRole(page, 'OWNER');
    const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';

    const previewResponse = await page.request.get(
      `${apiURL}/api/contracts/${contract.id}/preview`,
      { headers: getRoleAuthHeaders('OWNER') },
    );

    expect(previewResponse.status()).toBe(200);
    const previewData = await previewResponse.json();
    const html: string = previewData?.data?.html || previewData?.html || '';

    // Full template should be substantially larger than the inline fallback
    // (full template is ~308 lines, fallback is ~50 lines)
    expect(html.length).toBeGreaterThan(8000);
  });
});
