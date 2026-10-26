import { test, expect } from '@playwright/test';
import { loginAsRole, getRoleAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';
import { backlogFixtures } from './helpers/backlog-fixtures';
const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Finance Receivable contact log', () => {
  test.beforeEach(async ({ page }) => {
    backlogFixtures();
    await loginAsRole(page, 'FINANCE_MANAGER');
  });
  test('record a contact log and see it in timeline + last contacted column', async ({ page }) => {
    const f = backlogFixtures().receivables.clean;
    const headers = getRoleAuthHeaders('FINANCE_MANAGER');
    await page.goto(`/finance-receivable?search=${f.saleNumber}`);
    const row = page.getByRole('row').filter({ hasText: f.saleNumber });
    await expect(row).toHaveCount(1);
    await row.getByRole('button').filter({ hasText: f.saleNumber }).click();
    await page.getByRole('button', { name: 'บันทึกการติดต่อ', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'บันทึกการติดต่อไฟแนนซ์' });
    await dialog.getByRole('button', { name: 'รับสาย', exact: true }).click();
    const note = `ทดสอบระบบ ${f.saleNumber} contact note`;
    await dialog.getByPlaceholder('รายละเอียดการคุย…').fill(note);
    await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(note, { exact: true })).toBeVisible();
    const drawer = page.getByRole('dialog', { name: 'รายการเงินรับจากไฟแนนซ์' });
    await expect(drawer.getByText('จำนวนครั้ง', { exact: true }).locator('..')).toHaveText(
      'จำนวนครั้ง1',
    );
    await expect(drawer.getByText('ติดต่อล่าสุด', { exact: true }).locator('..')).not.toContainText(
      '—',
    );
    const response = await page.request.get(`${API_URL}/api/finance-receivable/${f.id}`, {
      headers,
    });
    expect(response.status()).toBe(200);
    const saved = unwrapResponse(await response.json());
    expect(saved.contactAttemptCount).toBe(1);
    expect(saved.lastContactedAt).toBeTruthy();
    const logs = await page.request.get(`${API_URL}/api/finance-receivable/${f.id}/contact-logs`, {
      headers,
    });
    expect(logs.status()).toBe(200);
    expect(unwrapResponse(await logs.json())).toEqual(
      expect.arrayContaining([expect.objectContaining({ notes: note, result: 'ANSWERED' })]),
    );
    await page.reload();
    await expect(row).toContainText(f.saleNumber);
    await expect(row.getByRole('cell').nth(2)).not.toHaveText('—');
    await expect(row.getByRole('cell').nth(2)).not.toBeEmpty();
  });
  test('broken-promise filter limits the list', async ({ page }) => {
    const f = backlogFixtures();
    await page.goto(`/finance-receivable?search=${f.prefix}`);
    await expect(
      page.getByRole('row').filter({ hasText: f.receivables.clean.saleNumber }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('row').filter({ hasText: f.receivables.broken.saleNumber }),
    ).toHaveCount(1);
    await page.getByLabel('มีนัดเลยกำหนด').check();
    await expect(
      page.getByRole('row').filter({ hasText: f.receivables.clean.saleNumber }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('row').filter({ hasText: f.receivables.broken.saleNumber }),
    ).toHaveCount(1);
  });
  test('reopening detail refreshes cached data and allows retry after a read error', async ({
    page,
  }) => {
    const f = backlogFixtures().receivables.broken;
    await page.goto(`/finance-receivable?search=${f.saleNumber}`);
    const row = page.getByRole('row').filter({ hasText: f.saleNumber });
    const open = () => row.getByRole('button').filter({ hasText: f.saleNumber }).click();
    const detailPath = `/finance-receivable/${f.id}`;
    const firstRead = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(detailPath));
    await open();
    expect((await firstRead).status()).toBe(200);
    const drawer = page.getByRole('dialog', { name: 'รายการเงินรับจากไฟแนนซ์' });
    await expect(drawer.getByRole('status')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    const matches = (url: URL) => url.pathname.endsWith(detailPath);
    await page.route(matches, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Synthetic read failure' }),
      }),
    );
    await open();
    await expect(drawer.getByRole('alert')).toContainText('อัปเดตข้อมูลไม่สำเร็จ');
    await page.unroute(matches);
    const retried = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(detailPath));
    await drawer.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
    expect((await retried).status()).toBe(200);
    await expect(drawer.getByRole('alert')).toHaveCount(0);
    await expect(drawer.getByRole('status')).toHaveCount(0);
  });
});
