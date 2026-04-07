import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

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
    await loginAsRole(page, 'OWNER');

    // Get an active contract to preview
    const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';
    const response = await page.request.get(`${apiURL}/api/contracts?status=ACTIVE&limit=1`, {
      headers: page.context().extraHTTPHeaders ? undefined : { 'X-Requested-With': 'XMLHttpRequest' },
    });

    if (!response.ok()) {
      test.skip(true, `Cannot fetch contracts: ${response.status()}`);
      return;
    }

    const data = await response.json();
    const contract = data?.data?.data?.[0] || data?.data?.[0];
    if (!contract?.id) {
      test.skip(true, 'No active contracts in database to test');
      return;
    }

    // Fetch the contract preview HTML directly via API
    const previewResponse = await page.request.get(
      `${apiURL}/api/contracts/${contract.id}/preview`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest' } },
    );
    expect(previewResponse.ok()).toBeTruthy();

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

  test('contract preview HTML is non-trivial size (full template, not fallback)', async ({ page }) => {
    await loginAsRole(page, 'OWNER');

    const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';
    const response = await page.request.get(`${apiURL}/api/contracts?status=ACTIVE&limit=1`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    if (!response.ok()) {
      test.skip(true, `Cannot fetch contracts: ${response.status()}`);
      return;
    }

    const data = await response.json();
    const contract = data?.data?.data?.[0] || data?.data?.[0];
    if (!contract?.id) {
      test.skip(true, 'No active contracts in database to test');
      return;
    }

    const previewResponse = await page.request.get(
      `${apiURL}/api/contracts/${contract.id}/preview`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest' } },
    );

    const previewData = await previewResponse.json();
    const html: string = previewData?.data?.html || previewData?.html || '';

    // Full template should be substantially larger than the inline fallback
    // (full template is ~308 lines, fallback is ~50 lines)
    expect(html.length).toBeGreaterThan(8000);
  });
});
