// Cookie consent — real-browser proof. No tracker request may leave the page before consent;
// tracker hosts are recorded and fulfilled with an empty script (no real network).
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { routeShopApi } from './fixtures/shop-api';
import { installSellApiFixtures } from './fixtures/sell-api';

const OUT = '../../../.tmp/consent/shop';
const TRACKER_SUFFIXES = [
  'googletagmanager.com',
  'google-analytics.com',
  'facebook.net',
  'facebook.com',
];
const MAPS_SUFFIXES = ['google.com', 'gstatic.com', 'googleapis.com'];
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

const hostMatches = (host: string, suffixes: string[]) =>
  suffixes.some((s) => host === s || host.endsWith(`.${s}`));

interface Net {
  tracker: string[];
  other: string[];
  all: string[];
}

async function control(context: BrowserContext): Promise<Net> {
  const net: Net = { tracker: [], other: [], all: [] };
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!/^https?:$/.test(url.protocol) || LOCAL_HOSTS.has(url.hostname)) return route.fallback();
    net.all.push(url.href);
    if (hostMatches(url.hostname, TRACKER_SUFFIXES)) {
      net.tracker.push(`${Date.now()} ${url.href}`);
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    }
    net.other.push(url.href);
    return route.abort();
  });
  return net;
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
}

const banner = (page: Page) => page.getByRole('region', { name: 'การใช้คุกกี้' });
const btn = (scope: Page | Locator, name: string) =>
  scope.getByRole('button', { name, exact: true });

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no bounding box');
  return b;
}
type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

async function noOverflow(scope: Locator) {
  const bad = await scope.evaluate(
    (root) =>
      Array.from(root.querySelectorAll('button')).filter(
        (b) => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1,
      ).length,
  );
  expect(bad).toBe(0);
}

async function equalSize(buttons: Locator[]) {
  const boxes = await Promise.all(buttons.map(box));
  for (const b of boxes) {
    expect(Math.abs(b.width - boxes[0].width)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.height - boxes[0].height)).toBeLessThanOrEqual(1);
  }
}

let net: Net;
test.beforeEach(async ({ page, context }) => {
  net = await control(context);
  await routeShopApi(page);
});

const GTAG = 'googletagmanager.com/gtag/js?id=G-E2ETEST';

test('1 first visit: banner, zero tracker requests incl. product page', async ({ page }) => {
  await page.goto('/');
  await expect(banner(page)).toBeVisible();
  await settle(page);
  await page.goto('/products/phone-1');
  await settle(page);
  expect(net.tracker, JSON.stringify(net.tracker)).toEqual([]);
  console.log('case1 other external:', JSON.stringify(net.other));
});

test('2 reject: no tracker, banner gone, persists after reload', async ({ page }) => {
  await page.goto('/');
  await btn(banner(page), 'ปฏิเสธ').click();
  await expect(banner(page)).toHaveCount(0);
  await settle(page);
  expect(net.tracker).toEqual([]);
  await page.reload();
  await settle(page);
  await expect(banner(page)).toHaveCount(0);
  await page.goto('/products/phone-1');
  await settle(page);
  expect(net.tracker).toEqual([]);
});

test('3 accept all: gtag + fbevents, view_item + ViewContent, no banner after reload', async ({
  page,
}) => {
  await page.goto('/');
  await btn(banner(page), 'ยอมรับทั้งหมด').click();
  await expect(banner(page)).toHaveCount(0);
  await page.goto('/products/phone-1');
  await settle(page);
  expect(net.tracker.some((u) => u.includes(GTAG))).toBe(true);
  expect(net.tracker.some((u) => /connect\.facebook\.net\/.*fbevents\.js/.test(u))).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.dataLayer ?? []).some(
          (e) => Array.from(e as ArrayLike<unknown>)[1] === 'view_item',
        ),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window.fbq as unknown as { queue: unknown[][] }).queue ?? []).some(
          (a) => a[0] === 'track' && a[1] === 'ViewContent',
        ),
      ),
    )
    .toBe(true);
  await page.reload();
  await settle(page);
  await expect(banner(page)).toHaveCount(0);
  console.log('case3 tracker:', JSON.stringify(net.tracker), 'other:', JSON.stringify(net.other));
});

test('4 settings dialog: analytics only', async ({ page }) => {
  await page.goto('/');
  await btn(banner(page), 'ตั้งค่า').click();
  const dialog = page.getByRole('dialog', { name: 'ตั้งค่าคุกกี้' });
  await dialog.getByRole('switch', { name: 'คุกกี้เพื่อการวิเคราะห์' }).click();
  await btn(dialog, 'บันทึกที่เลือก').click();
  await expect(banner(page)).toHaveCount(0);
  await settle(page);
  expect(net.tracker.some((u) => u.includes(GTAG))).toBe(true);
  expect(net.tracker.some((u) => u.includes('fbevents'))).toBe(false);
  expect(net.tracker.some((u) => u.includes('facebook'))).toBe(false);
  console.log('case4 tracker:', JSON.stringify(net.tracker));
});

test('5 withdrawal: reload then zero tracker requests', async ({ page }) => {
  await page.goto('/');
  await btn(banner(page), 'ยอมรับทั้งหมด').click();
  await settle(page);
  expect(net.tracker.length).toBeGreaterThan(0);
  await btn(page, 'ตั้งค่าคุกกี้').click();
  const reloaded = page.waitForEvent('load');
  await btn(page.getByRole('dialog', { name: 'ตั้งค่าคุกกี้' }), 'ปฏิเสธทั้งหมด').click();
  await reloaded;
  await settle(page);
  net.tracker.length = 0;
  await page.reload();
  await settle(page);
  await page.goto('/products/phone-1');
  await settle(page);
  expect(net.tracker, JSON.stringify(net.tracker)).toEqual([]);
  await expect(banner(page)).toHaveCount(0);
});

test('6 footer link opens /privacy', async ({ page }) => {
  await page.goto('/');
  await btn(banner(page), 'ปฏิเสธ').click();
  await page.getByRole('link', { name: 'นโยบายความเป็นส่วนตัว' }).last().click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole('heading', { name: /นโยบายความเป็นส่วนตัวและคุกกี้/ }).first(),
  ).toBeVisible();
});

test('7 mobile 360: equal buttons, no overflow, LINE button clear of banner, restore', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const b = banner(page);
  await expect(b).toBeVisible();
  await page.waitForTimeout(500);
  const line = page.getByRole('link', { name: 'ทักแชทหาร้าน' });
  const three = [btn(b, 'ยอมรับทั้งหมด'), btn(b, 'ปฏิเสธ'), btn(b, 'ตั้งค่า')];
  await equalSize(three);
  await noOverflow(b);
  await expect(line).toBeVisible();
  const lineBox = await box(line);
  const bannerBox = await box(b);
  expect(lineBox.y).toBeGreaterThanOrEqual(0);
  expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(740);
  expect(overlap(lineBox, bannerBox)).toBe(false);
  await page.screenshot({ path: `${OUT}/consent-banner-360.png` });

  await three[2].click();
  const dialog = page.getByRole('dialog', { name: 'ตั้งค่าคุกกี้' });
  await expect(dialog).toBeVisible();
  await equalSize([
    btn(dialog, 'ยอมรับทั้งหมด'),
    btn(dialog, 'ปฏิเสธทั้งหมด'),
    btn(dialog, 'บันทึกที่เลือก'),
  ]);
  await noOverflow(dialog);
  await page.screenshot({ path: `${OUT}/consent-dialog-360.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // product page: mobile sticky bottom bar and LINE button stay clear of the banner
  await page.goto('/products/phone-1');
  await expect(banner(page)).toBeVisible();
  await page.waitForTimeout(500);
  const bb = await box(banner(page));
  const sticky = page.locator('div.fixed').filter({ has: page.locator('a, button') });
  const n = await sticky.count();
  let stickyChecked = 0;
  for (let i = 0; i < n; i++) {
    const s = sticky.nth(i);
    if (!(await s.isVisible())) continue;
    if ((await s.getAttribute('data-consent-ui')) !== null) continue;
    const sb = await box(s);
    if (sb.width < 300) continue;
    stickyChecked++;
    expect(overlap(sb, bb), 'sticky bar vs banner').toBe(false);
  }
  // the product page always renders its mobile sticky bar once the product has loaded
  expect(stickyChecked).toBeGreaterThan(0);
  const pLine = page.getByRole('link', { name: 'ทักแชทหาร้าน' });
  // the product page hides the floating LINE button (the sticky bar carries the contact CTA)
  if (await pLine.isVisible()) expect(overlap(await box(pLine), bb)).toBe(false);
  console.log('case7 product page sticky bars checked:', stickyChecked);

  // after choosing, the LINE button drops back to its normal bottom (5rem = 80px above the edge)
  await page.goto('/');
  await btn(banner(page), 'ปฏิเสธ').click();
  await expect(banner(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  const after = await box(line);
  expect(Math.abs(740 - (after.y + after.height) - 80)).toBeLessThanOrEqual(2);
  expect(after.y + after.height).toBeGreaterThan(lineBox.y + lineBox.height);
});

test('8 desktop 1280: equal buttons, LINE clear of banner card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const b = banner(page);
  await expect(b).toBeVisible();
  await page.waitForTimeout(500);
  await equalSize([btn(b, 'ยอมรับทั้งหมด'), btn(b, 'ปฏิเสธ'), btn(b, 'ตั้งค่า')]);
  await noOverflow(b);
  const line = page.getByRole('link', { name: 'ทักแชทหาร้าน' });
  await expect(line).toBeVisible();
  expect(overlap(await box(line), await box(b))).toBe(false);
  await page.screenshot({ path: `${OUT}/consent-banner-1280.png` });
});

test('9 click-to-load map + privacy screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await btn(banner(page), 'ปฏิเสธ').click();
  await settle(page);
  const show = btn(page, 'แสดงแผนที่');
  await show.scrollIntoViewIfNeeded();
  expect(net.all.filter((u) => hostMatches(new URL(u).hostname, MAPS_SUFFIXES))).toEqual([]);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/map-box-360.png` });
  await show.click();
  const frame = page.locator('iframe');
  await expect(frame).toHaveCount(1);
  expect(await frame.getAttribute('src')).toMatch(/google\.com\/maps/);

  await page.goto('/privacy');
  await settle(page);
  await page.screenshot({ path: `${OUT}/privacy-360.png`, fullPage: true });
});

test('10 /sell/quote at 360: contact links scroll fully above the banner', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  // page-level routes win over the context routes: local app + sell API fixtures, rest aborted
  await installSellApiFixtures(page);
  await page.goto('/sell/quote');
  const b = banner(page);
  await expect(b).toBeVisible();
  await page.waitForTimeout(500);
  const links = page
    .getByRole('region', { name: 'ติดต่อร้านเรื่องขายหรือเทิร์น' })
    .getByRole('link');
  expect(await links.count()).toBeGreaterThan(0);
  await links.last().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const bannerTop = (await box(b)).y;
  for (let i = 0; i < (await links.count()); i++) {
    const lb = await box(links.nth(i));
    expect(lb.y + lb.height, `link ${i} bottom vs banner top`).toBeLessThanOrEqual(bannerTop + 1);
  }
  await page.screenshot({ path: `${OUT}/sell-quote-banner-360.png` });
});
