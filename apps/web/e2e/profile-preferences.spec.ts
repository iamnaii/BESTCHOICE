import { test, expect } from '@playwright/test';
import { backlogFixtures } from './helpers/backlog-fixtures';

test('Profile preferences — provider failure recovery and save/reload on a private user', async ({
  page,
}, info) => {
  const f = backlogFixtures().profile;
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/login');
  await page.locator('#email').fill(f.email);
  await page.locator('#password').fill(f.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  let providerFails = true;
  let providerEmpty = true;
  await page.route(
    (url) => url.pathname.endsWith('/yeastar/extensions'),
    (route) =>
      route.fulfill({
        status: providerFails ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          providerFails
            ? { message: 'Synthetic unavailable PBX' }
            : {
                success: true,
                data: providerEmpty
                  ? []
                  : [
                      { number: '101', name: 'พนักงานทดสอบหมายเลขเดิม', status: 'ONLINE' },
                      {
                        number: '102',
                        name: 'พนักงานทดสอบหมายเลขใหม่ที่มีชื่อยาว',
                        status: 'ONLINE',
                      },
                    ],
              },
        ),
      }),
  );
  await page.goto('/profile');
  await page.addStyleTag({ content: 'html{font-size:20px!important}' });
  await expect(page.getByRole('alert')).toContainText('โหลดหมายเลขโทรศัพท์ไม่สำเร็จ');
  providerFails = false;
  await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
  await expect(page.getByText('ยังไม่มีหมายเลขโทรศัพท์ให้เลือก')).toBeVisible();
  providerEmpty = false;
  await page.reload();
  await page.addStyleTag({ content: 'html{font-size:20px!important}' });
  const extension = page.getByRole('combobox', {
    name: 'Extension Yeastar (โทรศัพท์)',
    exact: true,
  });
  await expect(extension).toContainText('101');
  await extension.click();
  // the Combobox menu is portalled and searchable (R2-4d)
  const extensionMenu = page.locator('[data-slot=combobox-content]');
  await extensionMenu.getByRole('combobox', { name: 'ค้นหา', exact: true }).fill('ใหม่');
  await extensionMenu.getByRole('option', { name: /^102/ }).click();
  await expect(extensionMenu).toHaveCount(0);
  await expect(extension).toContainText('102');
  const saveExtension = page.waitForResponse(
    (r) =>
      r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/users/me/extension'),
  );
  await page
    .locator('[data-slot=card]')
    .filter({ hasText: 'ระบบโทรศัพท์ Yeastar PBX' })
    .getByRole('button', { name: 'บันทึก', exact: true })
    .click();
  expect((await saveExtension).status()).toBe(200);
  const account = page.getByRole('combobox', { name: 'เลือกบัญชีรับเงิน', exact: true });
  await account.click();
  const bank = page.getByRole('option').nth(3);
  const bankName = (await bank.innerText()).trim();
  await bank.click();
  const saveCash = page.waitForResponse(
    (r) =>
      r.request().method() === 'PATCH' &&
      new URL(r.url()).pathname.endsWith('/users/me/cash-account'),
  );
  await page
    .locator('[data-slot=card]')
    .filter({ hasText: 'บัญชีรับเงินเริ่มต้น' })
    .getByRole('button', { name: 'บันทึก', exact: true })
    .click();
  expect((await saveCash).status()).toBe(200);
  await page.reload();
  await page.addStyleTag({ content: 'html{font-size:20px!important}' });
  await expect(extension).toContainText('102');
  await expect(account).toContainText(bankName);
  await extension.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
    false,
  );
  await page.screenshot({ path: info.outputPath('profile-320-large-text.png'), fullPage: true });
});
