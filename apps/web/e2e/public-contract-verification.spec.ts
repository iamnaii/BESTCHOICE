import { test, expect } from '@playwright/test';
import { backlogFixtures } from './helpers/backlog-fixtures';
import { unwrapResponse } from './helpers/api-utils';
const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Public contract verification — real guard chain', () => {
  test('valid hash shows only public fields on mobile without a login', async ({ page }, info) => {
    const f = backlogFixtures().verification;
    const endpoint = `${API_URL}/api/admin/contracts/${f.id}/verify`;
    const response = await page.request.get(endpoint, { params: { hash: f.hash } });
    expect(response.status()).toBe(200);
    const result = unwrapResponse(await response.json());
    expect(result).toMatchObject({
      verified: true,
      signatureCount: 0,
      contract: { contractNumber: f.contractNumber, status: 'ACTIVE' },
    });
    expect(Object.keys(result.contract).sort()).toEqual(['contractNumber', 'createdAt', 'status']);
    const protectedRead = await page.request.get(`${API_URL}/api/admin/contracts/${f.id}`);
    expect(protectedRead.status()).toBe(401);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/verify/contracts/${f.id}?hash=${f.hash}`);
    await page.addStyleTag({ content: 'html{font-size:20px!important}' });
    await expect(page.getByRole('heading', { name: 'สัญญาถูกต้อง', exact: true })).toBeVisible();
    await expect(page.getByText(f.contractNumber, { exact: true })).toBeVisible();
    await expect(page.getByText('ลายเซ็นในระบบ 0 รายการ')).toBeVisible();
    await expect(page.locator('dt')).toHaveText(['เลขสัญญา', 'สถานะ', 'วันที่สร้าง']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
      false,
    );
    await page.screenshot({ path: info.outputPath('verified-320-large-text.png') });
  });

  test('missing, invalid, Unicode and repeated hashes are denied without exposing the contract', async ({
    page,
  }) => {
    const f = backlogFixtures().verification;
    const endpoint = `${API_URL}/api/contracts/${f.id}/verify`;
    for (const query of [
      '',
      '?hash=wrong',
      `?hash=${encodeURIComponent('💥'.repeat(32))}`,
      `?hash=${f.hash}&hash=wrong`,
    ]) {
      const response = await page.request.get(endpoint + query);
      expect(response.status()).toBe(200);
      const result = unwrapResponse(await response.json());
      expect(result).toMatchObject({ verified: false });
      expect(result).not.toHaveProperty('contract');
    }
    await page.goto(`/verify/contracts/${f.id}?hash=wrong`);
    await expect(
      page.getByRole('heading', { name: 'ไม่สามารถยืนยันสัญญา', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(f.contractNumber, { exact: true })).toHaveCount(0);
  });

  test('a failed verification read offers retry and recovers against the real API', async ({
    page,
  }) => {
    const f = backlogFixtures().verification;
    const matches = (url: URL) => url.pathname.endsWith(`/contracts/${f.id}/verify`);
    await page.route(matches, (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(`/verify/contracts/${f.id}?hash=${f.hash}`);
    await expect(page.getByRole('heading', { name: 'เกิดข้อผิดพลาด', exact: true })).toBeVisible();
    await page.unroute(matches);
    await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'สัญญาถูกต้อง', exact: true })).toBeVisible();
    await expect(page.getByText(f.contractNumber, { exact: true })).toBeVisible();
  });
});
