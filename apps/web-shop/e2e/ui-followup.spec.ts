import { expect, test } from '@playwright/test';
import { routeShopApi, seedCustomerSession } from './fixtures/shop-api';

for (const width of [320, 390, 1440]) {
  test.describe(`UI follow-up ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });

    test('address dialog restores focus after dismissal and save; failure stays editable', async ({
      page,
      baseURL,
    }) => {
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === baseURL ? route.fallback() : route.abort(),
      );
      const fixture = await routeShopApi(page, { strict: true });
      await seedCustomerSession(page);
      let fail = true;
      await page.route('**/api/shop/me/addresses', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: fail ? 400 : 201,
              json: fail ? { message: 'Synthetic error' } : {},
            })
          : route.fallback(),
      );
      await page.goto('/account/addresses');
      const add = page.getByRole('button', { name: 'เพิ่มที่อยู่', exact: true });
      const dialog = page.getByRole('dialog', { name: 'เพิ่มที่อยู่ใหม่' });
      for (const method of ['escape', 'close']) {
        await add.press('Enter');
        await expect(dialog).toBeVisible();
        if (method === 'escape') await page.keyboard.press('Escape');
        else await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(add).toBeFocused();
      }
      await add.press('Enter');
      const address = {
        recipientName: 'ผู้รับทดสอบ',
        phone: '0800000000',
        line1: '99 ถนนทดสอบ',
        line2: '',
        subDistrict: 'ตำบลทดสอบ',
        district: 'อำเภอทดสอบ',
        province: 'ลพบุรี',
        postalCode: '15000',
      };
      for (const [field, value] of Object.entries(address))
        await dialog.locator(`#${field}`).fill(value);
      await dialog.getByRole('button', { name: 'ดำเนินการต่อ' }).click();
      await expect(page.getByText('บันทึกไม่สำเร็จ', { exact: true })).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#recipientName')).toHaveValue(address.recipientName);
      fail = false;
      await dialog.getByRole('button', { name: 'ดำเนินการต่อ' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(add).toBeFocused();
      expect(fixture.unmatched).toEqual([]);
    });

    test('catalogue stays still when reduced motion is enabled during its entrance', async ({
      page,
      baseURL,
    }) => {
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === baseURL ? route.fallback() : route.abort(),
      );
      const fixture = await routeShopApi(page, { strict: true });
      await page.addInitScript(() => {
        const failures: string[] = [];
        Object.assign(window, { motionFailures: failures });
        const sample = () => {
          if (!matchMedia('(prefers-reduced-motion: reduce)').matches) return;
          document.querySelectorAll('[data-product-card]').forEach((card) => {
            const style = getComputedStyle(card);
            if (style.transform !== 'none' || style.opacity !== '1')
              failures.push(`${style.transform}/${style.opacity}`);
          });
        };
        new MutationObserver(sample).observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style'],
        });
        matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', sample);
      });
      await page.goto('/products');
      await expect(page.locator('[data-product-card]')).toHaveCount(6);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('[data-product-card]')).some(
          (card) => getComputedStyle(card).transform !== 'none',
        ),
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const frames = await page.evaluate(async () => {
        const result: boolean[] = [];
        for (let i = 0; i < 8; i++) {
          result.push(
            Array.from(document.querySelectorAll('[data-product-card]')).every((card) => {
              const style = getComputedStyle(card);
              return style.transform === 'none' && style.opacity === '1';
            }),
          );
          await new Promise(requestAnimationFrame);
        }
        return result;
      });
      expect(frames).toEqual(Array(8).fill(true));
      expect(
        await page.evaluate(
          () => (window as unknown as { motionFailures: string[] }).motionFailures,
        ),
      ).toEqual([]);
      expect(fixture.unmatched).toEqual([]);
    });
  });
}
