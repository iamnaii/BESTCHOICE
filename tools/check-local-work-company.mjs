import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';

export async function checkWorkCompany(page, origin, output, width) {
  const mobile = width < 1024;
  const company = () => page.evaluate(() => localStorage.getItem('bc-entity-scope'));
  const openMenu = async () => {
    if (mobile) await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
    else if (await page.getByRole('button', { name: 'ขยายเมนู', exact: true }).count()) {
      await page.getByRole('button', { name: 'ขยายเมนู', exact: true }).click();
    }
  };
  const tab = zone => page.getByRole('tab', { name: zone === 'shop' ? 'งานหน้าร้าน (SHOP)' : 'งานการเงิน (FINANCE)', exact: true });
  const dashboard = () => page.getByRole('heading', { name: 'แดชบอร์ด', exact: true });
  const portfolio = () => page.getByRole('heading', { name: 'พอร์ตสัญญา BESTCHOICE FINANCE', exact: true });
  const readCompany = async response => {
    assert.equal(response.status(), 200);
    return new URL(response.url()).searchParams.get('company');
  };
  const shopResponse = page.waitForResponse(r => r.url().includes('/dashboard/kpis'));
  await page.goto(new URL('/?zone=shop&company=finance', origin).href, { waitUntil: 'domcontentloaded' });
  assert.equal(await readCompany(await shopResponse), 'shop');
  await expect(dashboard()).toBeVisible();
  await expect.poll(company).toBe('SHOP');
  await expect(page.getByRole('button', { name: /บริษัทที่แสดงข้อมูล:/ })).toHaveCount(0);
  await openMenu();
  await expect(tab('shop')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tablist', { name: 'หมวดงาน' })).toHaveCount(1);
  const finResponse = page.waitForResponse(r => r.url().includes('/reports/finance-portfolio'));
  await tab('fin').click();
  assert.equal(await readCompany(await finResponse), 'finance');
  await expect(portfolio()).toBeVisible();
  await expect.poll(company).toBe('FINANCE');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(portfolio()).toBeVisible();
  await expect.poll(company).toBe('FINANCE');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(dashboard()).toBeVisible();
  await expect.poll(company).toBe('SHOP');
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await expect(portfolio()).toBeVisible();
  await expect.poll(company).toBe('FINANCE');
  // Settings remembers the work company of each visit, including browser history.
  await page.goto(new URL('/settings/brands?zone=fin', origin).href);
  await expect(page.getByRole('heading', { name: 'จัดการแบรนด์สินค้า' })).toBeVisible();
  await expect.poll(company).toBe('FINANCE');
  await page.goto(new URL('/?zone=shop', origin).href);
  await expect(dashboard()).toBeVisible();
  await expect.poll(company).toBe('SHOP');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'จัดการแบรนด์สินค้า' })).toBeVisible();
  await expect.poll(company).toBe('FINANCE');
  if (mobile) await page.getByTestId('exit-settings-bottomnav').click();
  else await page.getByTestId('exit-settings').click();
  await expect(portfolio()).toBeVisible();
  await openMenu();
  await expect(tab('fin')).toHaveAttribute('aria-selected', 'true');
  await tab('shop').click();
  await expect(dashboard()).toBeVisible();
  await expect.poll(company).toBe('SHOP');
  await openMenu();
  await expect(tab('shop')).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: join(output, `work-company-${width}.png`) });
  if (mobile) await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'กล่องข้อความ', exact: true })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow');
}
