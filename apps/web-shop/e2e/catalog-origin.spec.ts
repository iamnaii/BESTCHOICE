import { test, expect } from '@playwright/test';

const stock = ['THAI', 'IMPORTED', null].map((deviceOrigin, i) => ({
  id: `phone-${i}`, kind: 'UNIT', brand: 'Apple', model: 'iPhone 15', storage: '128GB',
  deviceOrigin, condition: 'USED', conditionGrade: 'A', images: [], minPrice: 15000,
  stockCount: 1, monthlyPaymentFrom: null, stock: { display: 'เครื่องนี้มีตัวเดียว', tone: 'unique' },
}));

test.beforeEach(async ({ page }) => {
  // All API requests are fixtures; these tests never write to a live shop.
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname === '/api/shop/models') data = [{ model: 'iPhone 15', count: 3 }];
    if (url.pathname === '/api/shop/products') {
      const origin = url.searchParams.get('deviceOrigin');
      const rows = stock.filter((p) => !origin || p.deviceOrigin === origin);
      data = { data: rows, total: rows.length, page: 1, limit: 24, minDownPct: null, monthsOptions: [] };
    }
    if (url.pathname.endsWith('/related')) data = [];
    if (/^\/api\/shop\/reviews\/[^/]+$/.test(url.pathname)) data = [];
    if (/^\/api\/shop\/reviews\/[^/]+\/summary$/.test(url.pathname)) data = { total: 0, average: 0 };
    if (url.pathname === '/api/shop/products/phone-1') {
      data = {
        ...stock[1], category: 'PHONE_USED', gallery: [], gallery360: [], cashPrice: 15000,
        installmentPrice: null,
        tiers: { A: { minPrice: 15000, maxPrice: 15000, units: [{
          id: 'phone-1', deviceOrigin: 'IMPORTED', conditionGrade: 'A', cashPrice: 15000,
          installmentPrice: null, gallery: [], gallery360: [],
          shopWarrantyDays: 60, warrantyTerms: 'รับประกันโดยร้าน\nไม่รวมความเสียหายจากน้ำ',
        }, {
          id: 'phone-other', deviceOrigin: 'IMPORTED', conditionGrade: 'B', cashPrice: 14000,
          installmentPrice: null, gallery: [], gallery360: [], shopWarrantyDays: 0,
          warrantyTerms: 'ไม่มีความคุ้มครองเพิ่มเติม',
        }, {
          id: 'phone-unknown', deviceOrigin: 'IMPORTED', conditionGrade: 'C', cashPrice: 13000,
          installmentPrice: null, gallery: [], gallery360: [],
        }] } },
      };
    }
    await route.fulfill({ json: data });
  });
});

test('desktop filters, refreshes a shared link, clears and displays device origin', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/products?mode=cash');
  await expect(page.locator('article')).toHaveCount(3);
  await expect(page.locator('article').filter({ hasText: 'ยังไม่ระบุไทย/นอก' })).toHaveCount(1);
  await page.locator('#filter-origin').selectOption('IMPORTED');
  await expect(page).toHaveURL(/deviceOrigin=IMPORTED/);
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('เครื่องนอก');
  await page.reload();
  await expect(page.locator('#filter-origin')).toHaveValue('IMPORTED');
  await expect(page.locator('article')).toHaveCount(1);
  await page.locator('#filter-origin').selectOption('THAI');
  await expect(page.locator('article')).toContainText('เครื่องไทย');
  await page.getByRole('button', { name: 'ล้างตัวกรองเครื่องไทย', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(3);
  await expect(page).not.toHaveURL(/deviceOrigin/);
  await page.goto('/products/phone-1');
  await expect(page.getByText('เครื่องนอก', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'รายละเอียดเครื่อง', exact: true })).toBeVisible();
});

test('mobile filter combines with condition/model/search and resets without clearing search', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/products?condition=USED&model=iPhone+15&search=iPhone&mode=cash');
  await page.getByRole('button', { name: 'ตัวกรอง', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('เครื่องไทย / เครื่องนอก', { exact: true }).selectOption('IMPORTED');
  await expect(page).toHaveURL(/deviceOrigin=IMPORTED/);
  await expect(page.locator('article')).toHaveCount(1);
  const query = new URL(page.url()).searchParams;
  expect(query.get('condition')).toBe('USED');
  expect(query.get('model')).toBe('iPhone 15');
  expect(query.get('search')).toBe('iPhone');
  await dialog.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' }).click();
  await expect(dialog.getByLabel('เครื่องไทย / เครื่องนอก', { exact: true })).toHaveValue('');
  await expect(page).not.toHaveURL(/deviceOrigin/);
  await expect(page).toHaveURL(/search=iPhone/);
  await expect(page.locator('article')).toHaveCount(3);
});

test('invalid origin in a URL does not send an unsupported filter to the API', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/shop/products') requests.push(request.url());
  });
  await page.goto('/products?deviceOrigin=invalid');
  await expect(page.locator('article')).toHaveCount(3);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((url) => !new URL(url).searchParams.has('deviceOrigin'))).toBe(true);
});

test('warranty follows the selected device and distinguishes none from unverified', async ({ page }) => {
  await page.goto('/products/phone-1');
  const warranty = page.getByRole('region', { name: 'ประกันเครื่องนี้' });
  await expect(warranty).toContainText('ประกันร้าน 60 วัน');
  await expect(warranty).toContainText('ไม่รวมความเสียหายจากน้ำ');
  await page.getByRole('button', { name: /เกรด B/ }).click();
  await expect(warranty).toContainText('ไม่มีประกันร้าน');
  await expect(warranty).toContainText('ไม่มีความคุ้มครองเพิ่มเติม');
  await expect(warranty).not.toContainText('60 วัน');
  await page.getByRole('button', { name: /เกรด C/ }).click();
  await expect(warranty).toContainText('ระยะเวลาประกันร้าน: สอบถามร้าน');
  await expect(warranty).not.toContainText('ไม่มีประกันร้าน');
  await expect(warranty).not.toContainText('ไม่มีความคุ้มครองเพิ่มเติม');
});
