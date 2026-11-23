import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { glyph, noOverflow, touchTarget } from '../../../tools/icons/browser-assertions.mts';
import { installSellApiFixtures } from './fixtures/sell-api';
import { routeShopApi, seedCustomerSession, type ShopApiFixture } from './fixtures/shop-api';

const images = ['/icon-media/front.svg', '/icon-media/back.svg'];
const unit = {
  id: 'icons-fixture',
  deviceOrigin: 'THAI',
  conditionGrade: 'A',
  cashPrice: 15000,
  installmentPrice: null,
  gallery: images,
  gallery360: images,
};
const product = {
  ...unit,
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_USED',
  condition: 'USED',
  tiers: { A: { minPrice: 15000, maxPrice: 15000, units: [unit] } },
};

let fixture: ShopApiFixture;
let pageErrors: string[];

test.beforeEach(async ({ page, baseURL }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page
    .context()
    .route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.fallback() : route.abort(),
    );
  fixture = await routeShopApi(page, { strict: true });
});

test.afterEach(() => {
  expect(fixture.unmatched, 'Unmatched storefront API requests').toEqual([]);
  expect(pageErrors, 'Storefront JS errors').toEqual([]);
});

const save = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(name + '.png') });
const headerMenu = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: 'เปิดเมนู' });

async function centered(icon: Locator, container: Locator) {
  const a = (await icon.boundingBox())!;
  const b = (await container.boundingBox())!;
  expect(Math.abs(a.x + a.width / 2 - (b.x + b.width / 2))).toBeLessThan(2);
}

for (const width of [390, 1440]) {
  test.describe(`storefront at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });

    test('homepage links, keyboard search, catalogue and selected filter', async ({ page }) => {
      await page.goto('/');
      const header = page.getByRole('banner');
      await expect(
        header.getByRole('link', { name: 'BESTCHOICE หน้าหลัก' }).locator('img'),
      ).toHaveAttribute('src', '/logo-icon.svg');
      await glyph(page.getByRole('link', { name: 'ดูรุ่นทั้งหมด' }), 'arrow-right', 20);
      const footer = page.getByRole('contentinfo');
      for (const [name, href, icon] of [
        ['Facebook', 'https://www.facebook.com/bestchoicelopburi', 'facebook-logo'],
        ['LINE', 'https://line.me/R/ti/p/@bestchoice', 'chat-circle'],
        ['TikTok', 'https://www.tiktok.com/@bestchoicelopburi', 'tiktok-logo'],
      ]) {
        const link = footer.getByRole('link', { name, exact: true });
        await expect(link).toHaveAttribute('href', href);
        await glyph(link, icon, 20);
      }
      if (width < 600) {
        const menu = headerMenu(page);
        await glyph(menu, 'list', 20);
        await touchTarget(menu);
        await menu.press('Enter');
        await expect(header.getByRole('button', { name: 'ปิดเมนู' })).toBeFocused();
        const navigation = header.getByRole('navigation', { name: 'เมนูหลัก' });
        await expect(navigation.getByRole('link')).toHaveCount(7);
        await expect(navigation.locator('svg')).toHaveCount(0);
        await save(page, 'home-mobile-menu');
      } else {
        await glyph(header.getByRole('link', { name: 'บัญชี' }), 'user', 20);
        await save(page, 'home');
      }
      const search = header.getByRole('button', { name: 'ค้นหา', exact: true });
      await glyph(search, 'magnifying-glass', 20);
      await search.press('Enter');
      const searchbox = header.getByRole('searchbox');
      await expect(searchbox).toBeFocused();
      await searchbox.fill('iPhone 15');
      await searchbox.press('Enter');
      await expect(page).toHaveURL('/products?search=iPhone%2015#catalog');
      const results = page.getByRole('region', { name: 'รายการสินค้า' });
      await expect(results.getByRole('status')).toContainText('พบ 6 รายการ');

      if (width < 600) {
        const filters = page.getByRole('button', { name: 'ตัวกรอง', exact: true });
        await glyph(filters, 'sliders-horizontal', 16);
        await filters.click();
        const dialog = page.getByRole('dialog');
        await glyph(dialog.getByRole('button', { name: 'ปิด', exact: true }), 'x', 16);
        await save(page, 'catalog-filter');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
      }
      const priceMode = page.getByRole('group', { name: 'รูปแบบราคา' });
      const installment = priceMode.getByRole('button', { name: /ผ่อน/ });
      await glyph(installment, 'calendar-dots', 16);
      await priceMode.getByRole('button', { name: 'ซื้อสด' }).click();
      await expect(installment).toHaveAttribute('aria-pressed', 'false');
      await installment.click();
      await expect(installment).toHaveAttribute('aria-pressed', 'true');
      await noOverflow(page);
      await save(page, 'catalog-selected');
    });

    test('catalogue goes from loading to empty, error and retry', async ({ page }) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let fail = false;
      await page.route(
        (url) => url.pathname === '/api/shop/products',
        async (route) => {
          await gate;
          await route.fulfill(
            fail
              ? { status: 400, json: { message: 'Synthetic unavailable response' } }
              : { json: { data: [], total: 0, page: 1, limit: 24 } },
          );
        },
      );
      await page.goto('/products', { waitUntil: 'domcontentloaded' });
      const results = page.getByRole('region', { name: 'รายการสินค้า' });
      try {
        await expect(results.locator('[aria-busy=true]')).toBeVisible();
        await expect(results.getByRole('status').first()).toHaveText(/กำลังค้นหา/);
        await save(page, 'catalog-loading');
      } finally {
        release();
      }
      await glyph(results, 'magnifying-glass', 48);
      await expect(results.getByText('ไม่พบสินค้าตามตัวกรอง')).toBeVisible();
      await save(page, 'catalog-empty');
      // The app deliberately retries failed catalogue requests before showing the error.
      fail = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(results.getByText('เกิดข้อผิดพลาด')).toBeVisible({ timeout: 15_000 });
      await glyph(results, 'warning-circle', 48);
      const retry = results.getByRole('button', { name: 'โหลดใหม่' });
      await glyph(retry, 'arrows-clockwise', 16);
      await save(page, 'catalog-error');
      fail = false;
      await retry.press('Enter');
      await expect(results.getByText('ไม่พบสินค้าตามตัวกรอง')).toBeVisible();
      await noOverflow(page);
    });

    test('product gallery, keyboard navigation, 360° drag, zoom and dismiss', async ({ page }) => {
      await page.route('**/api/shop/products/icons-fixture', (route) =>
        route.fulfill({ json: product }),
      );
      await page.route('**/api/shop/products/icons-single', (route) =>
        route.fulfill({
          json: {
            ...product,
            tiers: {
              A: {
                minPrice: 15000,
                maxPrice: 15000,
                units: [{ ...unit, id: 'icons-single', gallery: images.slice(0, 1) }],
              },
            },
          },
        }),
      );
      await page.route('**/icon-media/*.svg', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="480"><rect x="30" y="20" width="240" height="440" rx="32" fill="${route.request().url().endsWith('front.svg') ? 'teal' : 'navy'}"/></svg>`,
        }),
      );
      await page.goto('/products/icons-fixture');
      const gallery = page.getByRole('region', { name: 'รูปสินค้า' });
      const next = gallery.getByRole('button', { name: 'รูปถัดไป' });
      const expand = gallery.getByRole('button', { name: 'ดูรูปขยาย' });
      await glyph(next, 'caret-right', 20);
      await glyph(expand, 'arrows-out', 20);
      if (width < 600) {
        await touchTarget(next);
        await touchTarget(expand);
      }
      await next.press('Enter');
      await expect(next).toBeFocused();
      await expect(gallery.getByRole('button', { name: 'รูปที่ 2' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const view360 = gallery.getByRole('button', { name: '360°' });
      await view360.press('Space');
      await expect(view360).toHaveAttribute('aria-pressed', 'true');
      await glyph(gallery.getByText('ลากเพื่อหมุน 360°'), 'arrow-clockwise', 16);
      const firstFrame = gallery.getByRole('img', { name: /360° เฟรม 1/ });
      const frameBox = (await firstFrame.boundingBox())!;
      await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(frameBox.x + frameBox.width / 2 + 8, frameBox.y + frameBox.height / 2);
      await page.mouse.up();
      await expect(gallery.getByRole('img', { name: /360° เฟรม 2/ })).toHaveAttribute(
        'src',
        images[1],
      );
      await save(page, 'gallery-360');
      await gallery.getByRole('button', { name: 'รูป', exact: true }).click();
      await expand.press('Enter');
      const dialog = page.getByRole('dialog', { name: /iPhone 15/ });
      const zoom = dialog.getByRole('button', { name: 'ขยายรูป', exact: true }).last();
      await glyph(zoom, 'magnifying-glass-plus', 20);
      await centered(zoom.locator('svg'), zoom);
      await zoom.press('Enter');
      const zoomOut = dialog.getByRole('button', { name: 'ย่อรูป', exact: true }).last();
      await glyph(zoomOut, 'magnifying-glass-minus', 20);
      await expect(zoomOut).toHaveAttribute('aria-pressed', 'true');
      const close = dialog.getByRole('button', { name: 'ปิดรูปขยาย' });
      await glyph(close, 'x', 20);
      await touchTarget(close);
      await noOverflow(page);
      await save(page, 'gallery-zoom');
      await close.press('Enter');
      await expect(dialog).toHaveCount(0);
      await page.goto('/products/icons-single');
      await gallery.getByRole('button', { name: 'ดูรูปขยาย' }).click();
      const disabled = dialog.getByRole('button', { name: 'รูปถัดไป' });
      await glyph(disabled, 'caret-right', 20);
      await expect(disabled).toBeDisabled();
    });

    test('account address dialog and auth transition', async ({ page }) => {
      await seedCustomerSession(page);
      await page.goto('/account');
      await expect(page.getByRole('heading', { name: 'ลูกค้าทดสอบ ระบบ' })).toBeVisible();
      await glyph(page.getByRole('link', { name: 'ออเดอร์', exact: true }), 'package', 24);
      const addresses = page.getByRole('link', { name: 'ที่อยู่', exact: true });
      await glyph(addresses, 'map-pin', 24);
      await addresses.click();
      const add = page.getByRole('button', { name: 'เพิ่มที่อยู่', exact: true });
      await glyph(add, 'plus', 16);
      await touchTarget(add);
      await add.focus();
      await expect(add).toBeFocused();
      await add.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'เพิ่มที่อยู่ใหม่' });
      await glyph(dialog.getByRole('button', { name: 'ปิด', exact: true }), 'x', 16);
      await noOverflow(page);
      await save(page, 'address-dialog');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      const address = {
        recipientName: 'ผู้รับทดสอบ',
        phone: '0800000000',
        line1: '99/9 ถนนทดสอบ',
        line2: '',
        subDistrict: 'ตำบลทดสอบ',
        district: 'อำเภอทดสอบ',
        province: 'ลพบุรี',
        postalCode: '15000',
      };
      const addressesPath = '/api/shop/me/addresses';
      await page.route(
        (url) => url.pathname === addressesPath,
        (route) =>
          route.request().method() === 'POST'
            ? route.fulfill({ status: 201, json: address })
            : route.fallback(),
      );
      await add.click();
      for (const [field, value] of Object.entries(address))
        await dialog.locator(`#${field}`).fill(value);
      const submitted = page.waitForRequest(
        (request) =>
          request.method() === 'POST' && new URL(request.url()).pathname === addressesPath,
      );
      await dialog.getByRole('button', { name: 'ดำเนินการต่อ' }).press('Enter');
      expect((await submitted).postDataJSON()).toEqual(address);
      const notifications = page.getByRole('region', { name: /^Notifications/ });
      await expect(notifications.getByText('บันทึกที่อยู่แล้ว')).toBeVisible();
      await glyph(notifications, 'check-circle', 16);
      await expect(dialog).toHaveCount(0);
      await page.locator('main').getByRole('link', { name: 'บัญชี', exact: true }).click();
      const logout = page.getByRole('button', { name: 'ออกจากระบบ', exact: true });
      await glyph(logout, 'sign-out', 24);
      await logout.click();
      await expect(page).toHaveURL('/login?returnTo=/account');
      const login = page.getByRole('button', { name: 'เข้าสู่ระบบด้วย LINE' });
      await glyph(login, 'chat-circle', 20);
      await touchTarget(login);
      await save(page, 'auth');
    });

    test('sell model selection and app 404', async ({ page }) => {
      const sell = await installSellApiFixtures(page);
      await page.goto('/sell/quote');
      const series = page.getByRole('button', { name: 'กลุ่ม iPhone 17', exact: true });
      await expect(series).toBeVisible();
      await series.press('Enter');
      const model = page.getByRole('button', { name: 'iPhone 17 Pro', exact: true });
      await model.press('Enter');
      await expect(page.getByRole('heading', { name: /ความจุ/ })).toBeVisible();
      await noOverflow(page);
      await save(page, 'sell-model');
      expect(sell.unmatched, 'Unmatched sell API requests').toEqual([]);
      await page.goto('/icons-test-nonexistent');
      const notFound = page.getByRole('heading', { name: 'ไม่พบหน้านี้' });
      await glyph(notFound.locator('..'), 'compass', 48);
      await expect(
        notFound.locator('..').getByRole('link', { name: 'ดูสินค้าทั้งหมด' }),
      ).toHaveAttribute('href', '/products');
      await noOverflow(page);
      await save(page, 'not-found');
    });

    test('stock wrapper keeps the logo, contacts and titled frame', async ({ page }) => {
      let intercepted = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('https://script.google.com/**', async (route) => {
        intercepted++;
        await gate;
        await route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic stock frame</h1>' });
      });
      const response = await page.goto('/stock', { waitUntil: 'commit' });
      const waiting = page.getByRole('status');
      const frame = page.locator('#stock-frame');
      try {
        expect(response?.status()).toBe(200);
        await expect(waiting).toContainText('กำลังโหลดสต๊อคเครื่องวันนี้');
        await expect(waiting.locator('img')).toHaveAttribute('src', '/logo-icon.svg');
        await expect(waiting.locator('img')).toHaveCSS('width', '56px');
        await expect(waiting.getByRole('link', { name: '095-567-8887' })).toHaveAttribute(
          'href',
          'tel:0955678887',
        );
        await expect(waiting.getByRole('link', { name: 'LINE' })).toHaveAttribute(
          'href',
          'https://lin.ee/o1tWXnQ',
        );
        await expect(frame).toHaveAttribute('title', 'สต๊อคเครื่องวันนี้ BESTCHOICE');
        // Screenshot while the outbound iframe is held and the first-party shell is visible.
        const cdp = await page.context().newCDPSession(page);
        try {
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
          await writeFile(
            test.info().outputPath('stock-loading-shell.png'),
            Buffer.from(data, 'base64'),
          );
        } finally {
          await cdp.detach();
        }
      } finally {
        release();
      }
      await expect(page.frameLocator('#stock-frame').getByRole('heading')).toHaveText(
        'Synthetic stock frame',
      );
      expect(intercepted).toBe(1);
      await expect(frame).toHaveCSS('width', `${width}px`);
      await noOverflow(page);
    });
  });
}

test('320px header and address dialog stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await seedCustomerSession(page);
  await page.goto('/account/addresses');
  await headerMenu(page).click();
  await noOverflow(page);
  await save(page, 'header-320');
  await page.getByRole('banner').getByRole('button', { name: 'ปิดเมนู' }).click();
  await page.getByRole('button', { name: 'เพิ่มที่อยู่', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'เพิ่มที่อยู่ใหม่' });
  await expect(dialog).toBeVisible();
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await noOverflow(page);
  await save(page, 'dialog-320');
});
