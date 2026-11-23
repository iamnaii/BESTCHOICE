import { expect, test, type Locator, type Page } from '@playwright/test';
import { glyph, noOverflow, touchTarget } from '../../../tools/icons/browser-assertions.mts';
import { MOCK_LINE_ID, mockLiffApi, mockLiffSdk } from './helpers/liff-mock';

const save = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(name + '.png') });

async function distinctIcons(controls: Locator) {
  const icons = controls.locator('svg[data-nav-icon]');
  expect(await icons.count()).toBeGreaterThan(2);
  const shapes = await icons.evaluateAll((nodes) =>
    nodes.map((svg) => ({ fill: svg.getAttribute('fill'), geometry: svg.innerHTML })),
  );
  for (const { fill, geometry } of shapes) {
    expect(fill).toBe('currentColor');
    expect(geometry).toContain('opacity="0.2"');
  }
  expect(new Set(shapes.map(({ geometry }) => geometry)).size).toBe(shapes.length);
}

async function openMenu(page: Page, width: number) {
  if (width < 1024) {
    await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
  } else {
    const expand = page.getByRole('button', { name: 'ขยายเมนู', exact: true });
    if (await expand.count()) await expand.click();
  }
}

let errors: string[];

test.beforeEach(async ({ page, baseURL }, info) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.context().routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page
    .context()
    .route('**/*', (route) =>
      new URL(route.request().url()).origin === baseURL ? route.fallback() : route.abort(),
    );
  const theme = info.titlePath.join(' ').includes('dark') ? 'dark' : 'light';
  await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
});

test.afterEach(() => expect(errors, 'Admin JavaScript errors').toEqual([]));

for (const [width, theme] of [
  [390, 'light'],
  [390, 'dark'],
  [1440, 'light'],
  [1440, 'dark'],
] as const) {
  test.describe(`admin ${width}px ${theme}`, () => {
    test.use({ viewport: { width, height: 900 }, colorScheme: theme });

    test('SHOP, FINANCE and settings navigate with distinct glyphs', async ({ page }) => {
      const shopResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith('/shop-home'),
      );
      await page.goto('/?zone=shop');
      expect((await shopResponse).status()).toBe(200);
      await expect(
        page.getByRole('heading', { name: 'หน้าหลักหน้าร้าน', exact: true }),
      ).toBeVisible();
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /\blight\b/);
      await openMenu(page, width);
      const tabs = page.getByRole('tablist', { name: 'หมวดงาน' });
      const shop = tabs.getByRole('tab', { name: 'งานหน้าร้าน (SHOP)' });
      const finance = tabs.getByRole('tab', { name: 'งานการเงิน (FINANCE)' });
      const shopIcon = await glyph(shop, 'StorefrontIcon', 18);
      const finIcon = await glyph(finance, 'CurrencyCircleDollarIcon', 18);
      expect(await shopIcon.innerHTML()).not.toBe(await finIcon.innerHTML());
      await expect(shop).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('button', { name: /บริษัทที่แสดงข้อมูล:/ })).toHaveCount(0);
      const shopMenu = page.getByRole('navigation', { name: 'เมนูงานหน้าร้าน' });
      await distinctIcons(shopMenu.getByRole('heading').getByRole('button'));
      await save(page, 'shop-menu');
      const portfolioResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith('/finance-portfolio'),
      );
      await finance.press('Enter');
      const response = await portfolioResponse;
      expect(response.status()).toBe(200);
      expect(new URL(response.url()).searchParams.get('company')).toBe('finance');
      await expect(
        page.getByRole('heading', { name: 'พอร์ตสัญญา BESTCHOICE FINANCE' }),
      ).toBeVisible();
      await openMenu(page, width);
      await expect(finance).toHaveAttribute('aria-selected', 'true');
      const financeMenu = page.getByRole('navigation', { name: 'เมนูงานการเงิน' });
      await distinctIcons(financeMenu.getByRole('heading').getByRole('button'));
      await save(page, 'finance-menu');
      await page.goto('/settings/accounting?zone=fin');
      await expect(
        page.getByRole('heading', { name: 'บัญชี & ภาษี', exact: true }).first(),
      ).toBeVisible();
      await openMenu(page, width);
      const settings = page.getByRole('navigation', { name: 'เมนูตั้งค่าระบบ' });
      const accounting = settings.getByRole('link', { name: 'บัญชี & ภาษี', exact: true });
      await expect(accounting).toHaveAttribute('aria-current', 'page');
      await distinctIcons(settings.getByRole('link'));
      await noOverflow(page);
      await save(page, 'settings-menu');
    });

    test('LIFF notification settings render states and save with synthetic LINE identity', async ({
      page,
    }) => {
      await mockLiffSdk(page);
      const route = '/line-oa/liff/notification-preferences';
      const initial = { paymentReminder: true, overdueNotice: false, receiptNotification: true };
      await mockLiffApi(page, [{ method: 'GET', path: route, body: initial }]);

      let writes = 0;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(`**${route}`, async (handler) => {
        const request = handler.request();
        if (request.method() !== 'POST') return handler.fallback();
        writes++;
        expect(request.postDataJSON()).toEqual({ ...initial, overdueNotice: writes === 1 });
        await pending;
        return handler.fulfill(
          writes === 1
            ? { json: { ...initial, overdueNotice: true } }
            : { status: 503, json: { message: 'Synthetic failing save' } },
        );
      });
      await page.goto('/liff/notifications');
      await expect(page.getByRole('heading', { name: 'ตั้งค่าการแจ้งเตือน' })).toBeVisible();
      for (const [name, icon] of [
        [/^แจ้งเตือนค่างวด/, 'wallet'],
        [/^แจ้งค้างชำระ/, 'warning'],
        [/^ใบเสร็จ\/ยืนยันชำระ/, 'receipt'],
      ] as const) {
        const control = page.getByRole('button', { name });
        await expect(await glyph(control, icon, 24)).toHaveAttribute('aria-hidden', 'true');
        if (width < 1024) await touchTarget(control);
      }
      const profile = page.getByRole('link', { name: 'กลับไปโปรไฟล์' });
      await glyph(profile, 'arrow-left', 16);
      await expect(profile).toHaveAttribute('href', `/liff/profile?lineId=${MOCK_LINE_ID}`);
      const contract = page.getByRole('link', { name: 'ดูสัญญาของฉัน' });
      await glyph(contract, 'arrow-right', 16);
      await expect(contract).toHaveAttribute('href', `/liff/contract?lineId=${MOCK_LINE_ID}`);
      const overdue = page.getByRole('button', { name: /^แจ้งค้างชำระ/ });
      try {
        await overdue.press('Enter');
        await expect(overdue).toBeDisabled();
      } finally {
        release();
      }
      const notifications = page.getByRole('region', { name: /^Notifications/ });
      await expect(notifications).toHaveAttribute('aria-live', 'polite');
      await expect(notifications.getByText('บันทึกการตั้งค่าแล้ว')).toBeVisible();
      await glyph(notifications, 'check-circle', 16);
      await glyph(page.locator('#root'), 'bell');
      await save(page, 'liff-notifications');
      const dismiss = notifications.getByRole('button', { name: 'Close toast' });
      await glyph(dismiss, 'x', 16);
      await dismiss.press('Enter');
      await expect(notifications.getByText('บันทึกการตั้งค่าแล้ว')).toHaveCount(0);
      await overdue.press('Enter');
      await expect(notifications.getByText('ไม่สามารถบันทึกได้ กรุณาลองใหม่')).toBeVisible();
      await glyph(notifications, 'xcircle', 16);
      expect(writes).toBe(2);
      await noOverflow(page);
    });
  });
}

test('320px LIFF notification error places the 48px glyph above its text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockLiffSdk(page);
  await mockLiffApi(page, [
    {
      method: 'GET',
      path: '/line-oa/liff/notification-preferences',
      status: 404,
      body: { message: 'Synthetic failing load' },
    },
  ]);
  await page.goto('/liff/notifications', { waitUntil: 'domcontentloaded' });
  const heading = page.getByRole('heading', {
    level: 2,
    name: 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่',
  });
  const illustration = await glyph(heading.locator('..'), 'warning-circle', 48);
  const icon = (await illustration.boundingBox())!;
  const label = (await heading.boundingBox())!;
  expect(icon.y + icon.height).toBeLessThan(label.y);
  expect(Math.abs(icon.x + icon.width / 2 - (label.x + label.width / 2))).toBeLessThan(2);
  await noOverflow(page);
  await save(page, 'liff-error-320');
});

for (const width of [390, 1440]) {
  test(`settings add, edit, delete and status controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const reason = { id: 'icon-fixture', label: 'เหตุผลทดสอบ', isActive: true, sortOrder: 10 };
    await page.route('**/settings/reverse-reasons?**', (route) =>
      route.fulfill({ json: [reason] }),
    );
    await page.route('**/settings/reverse-reasons', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: [reason] })
        : route.fulfill({ status: 405, json: { message: 'Unexpected fixture write' } }),
    );
    await page.goto('/settings/access/reverse-reasons?zone=shop');
    const row = page.getByRole('row').filter({ hasText: reason.label });
    const edit = row.getByRole('button', { name: `แก้ไข ${reason.label}` });
    const remove = row.getByRole('button', { name: `ลบ ${reason.label}` });
    await glyph(edit, 'pencil', 14);
    await glyph(remove, 'trash', 14);
    await expect(row.getByRole('switch')).toBeChecked();
    const add = page.getByRole('button', { name: 'เพิ่มเหตุผลใหม่', exact: true });
    await glyph(add, 'plus', 16);
    await edit.press('Enter');
    const editDialog = page.getByRole('dialog', { name: 'แก้ไขเหตุผล' });
    await expect(editDialog.getByRole('textbox', { name: /เหตุผล/ })).toHaveValue(reason.label);
    await glyph(editDialog.getByRole('button', { name: 'ปิด', exact: true }), 'x', 16);
    await noOverflow(page);
    await save(page, 'settings-edit');
    await page.keyboard.press('Escape');
    await expect(editDialog).toHaveCount(0);
    await remove.press('Enter');
    const deleteDialog = page.getByRole('dialog', { name: 'ลบเหตุผล?' });
    await expect(deleteDialog).toContainText(reason.label);
    await save(page, 'settings-delete');
    await deleteDialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await expect(row).toBeVisible();
    await noOverflow(page);
  });

  test(`signing progress and completed signer at ${width}px with synthetic contract responses`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const responses: Record<string, unknown> = {
      '/settings/test-mode': { enabled: true },
      '/contracts/icon-fixture/kyc/status': {
        status: 'VERIFIED',
        otpVerified: true,
        idCardUploaded: true,
      },
      '/contracts/icon-fixture/preview': { html: '<!doctype html><h1>สัญญาตัวอย่าง</h1>' },
      '/contracts/icon-fixture/signatures': [
        {
          id: 'fixture-signature',
          signerType: 'COMPANY',
          signedAt: '2026-11-23T09:00:00Z',
          signatureImage: '',
        },
      ],
      '/users/me/signature': { signatureImage: null },
      '/contracts/icon-fixture': {
        id: 'icon-fixture',
        status: 'DRAFT',
        workflowStatus: 'DRAFT',
        contractNumber: 'SYNTHETIC-001',
        pdpaConsentId: 'fixture-consent',
        customer: { id: 'fixture-customer', name: 'ลูกค้าทดสอบ' },
        signatureRequirements: {
          complete: false,
          checklist: [
            { type: 'CUSTOMER', label: 'ผู้ซื้อ (ผู้เช่าซื้อ)', signed: false },
            { type: 'COMPANY', label: 'ผู้ขาย (ผู้ให้เช่าซื้อ)', signed: true },
            { type: 'WITNESS_1', label: 'พยาน 1', signed: false },
            { type: 'WITNESS_2', label: 'พยาน 2', signed: false },
          ],
        },
      },
    };
    await page.route('**/api/admin/**', (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api\/admin/, '');
      if (!(path in responses)) return route.fallback();
      return route.request().method() === 'GET'
        ? route.fulfill({ json: responses[path] })
        : route.fulfill({ status: 405, json: { message: 'Unexpected signing write' } });
    });
    await page.goto('/contracts/icon-fixture/sign');
    const verified = page.getByRole('heading', { name: 'ยืนยันตัวตนเรียบร้อยแล้ว' });
    await glyph(verified.locator('..'), 'check-circle');
    await glyph(page.getByRole('alert').filter({ hasText: 'โหมดทดสอบ' }), 'warning');
    await page.getByRole('button', { name: 'ดำเนินการต่อ' }).click();
    const consent = page.getByRole('heading', { name: 'ยินยอม PDPA เรียบร้อยแล้ว' });
    await glyph(consent.locator('..'), 'check-circle');
    await expect(page.getByRole('img', { name: 'เสร็จแล้ว' })).toHaveCount(1);
    await page.getByRole('button', { name: 'ดำเนินการต่อ' }).click();
    const sign = page.getByRole('button', { name: 'เซ็นสัญญา', exact: true });
    await expect(sign).toBeDisabled();
    await page.getByRole('checkbox', { name: /ข้าพเจ้าได้อ่านและเข้าใจ/ }).check();
    await sign.press('Enter');
    await expect(page.getByRole('img', { name: 'เสร็จแล้ว' })).toHaveCount(3);
    const signer = page.getByRole('button', { name: /ผู้ขาย.*ลงนามแล้ว/ });
    await glyph(signer, 'check');
    await signer.press('Enter');
    const signed = page.getByRole('heading', { name: /ผู้ขาย.*ลงนามเรียบร้อยแล้ว/ });
    await glyph(signed.locator('..'), 'check-circle');
    await noOverflow(page);
    await save(page, 'completed-signer');
  });
}
