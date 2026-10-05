import { test, expect, type Page } from '@playwright/test';

// ชิป "จองไว้" ของเครื่องที่ใบจองล็อก (PR 2) ต้องพอดีคอลัมน์สถานะ 84px ที่ 1440 และ 390 และไม่ดันหน้าให้เลื่อนแนวนอน
// mock API ด้วย page.route แบบเดียวกับ sales-menu-regression.spec.ts (ไม่แตะ API จริง)
async function fixture(page: Page) {
  const actor = { id: 'ux-actor', name: 'พนักงานตัวอย่าง UX', email: 'ux@example.invalid', role: 'OWNER', branchId: 'ux-branch', accessibleCompanies: ['SHOP', 'FINANCE'], primaryCompany: 'SHOP' };
  const branch = { id: 'ux-branch', name: 'สาขาตัวอย่าง', shopCashAccountCode: 'S11-1101' };
  const product = {
    id: 'ux-product', name: 'เครื่องตัวอย่าง', brand: 'TEST', model: 'PHONE', category: 'PHONE_NEW', branchId: branch.id, branch, supplier: null,
    status: 'RESERVED', cashPrice: '9000', installmentPrice: '10000', costPrice: '6000', imeiSerial: null, serialNumber: 'UX-SERIAL', storage: null,
    prices: [{ id: 'cash', label: 'ราคาเงินสด', amount: '9000', isDefault: true }],
    lockedByBookings: [{ id: 'bk-ux', bookingNumber: 'BK-20261005-0001', customer: { name: 'ลูกค้าที่มีชื่อยาวมากสำหรับทดสอบความกว้าง' } }],
  };
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url()), routePath = url.pathname.replace(/^\/api(\/admin)?/, '');
    if (route.request().method() !== 'GET') return route.fulfill({ status: 501, json: { message: 'Synthetic fixture: writes disabled' } });
    if (routePath === '/auth/me') return route.fulfill({ json: actor });
    if (routePath === '/settings/ui-flags') return route.fulfill({ status: 503, json: { message: 'Use application defaults in this isolated UI fixture' } });
    if (routePath === '/branches') return route.fulfill({ json: [branch] });
    if (routePath === '/products') {
      return route.fulfill({ json: { data: [product], total: 1, page: 1, limit: 50, totalPages: 1, viewCounts: { ready: 0, all: 1 } } });
    }
    return route.fulfill({ status: 501, json: { message: `Synthetic fixture: unsupported read ${routePath}` } });
  });
}

for (const width of [1440, 390]) {
  test.describe(`stock list lock chip / ${width}px / synthetic UI`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 } });

    test('ชิป "จองไว้ · BK-…" พอดีคอลัมน์สถานะ ไม่ล้น ไม่ดันหน้าเลื่อนแนวนอน', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await fixture(page);
      await page.goto('/stock/products?view=all');
      const link = page.getByRole('link', { name: /จองไว้ · BK-20261005-0001/ }).first();
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/bookings?bookingId=bk-ux');
      const m = await link.evaluate((el) => {
        const cell = el.closest('td') ?? el.parentElement!.parentElement!;
        const l = el.getBoundingClientRect(), c = cell.getBoundingClientRect();
        const doc = document.documentElement;
        return { linkRight: l.right, cellRight: c.right, linkWidth: l.width, cellWidth: c.width, cell: cell.tagName,
          scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
      });
      // eslint-disable-next-line no-console
      console.log(`MEASURE@${width}`, JSON.stringify(m));
      expect(m.linkRight).toBeLessThanOrEqual(m.cellRight + 1);
      expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
      expect(errors).toEqual([]);
    });
  });
}
