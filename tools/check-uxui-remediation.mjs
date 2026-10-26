import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { previewStatus, output } from './local-preview.mjs';

// Isolated local preview only. Synthetic GET fixtures cover APIs outside its scope.
// This checks rendering/navigation, never posts business transactions.
const status = await previewStatus();
assert.ok(status.running && status.current, 'Run npm run local:preview first');
const origin = `http://localhost:${status.state.port}`;
assert.equal(status.info.isolated, true, 'Use synthetic preview fixtures only');
const previewContractId = new URL(status.info.documentUrl).pathname.split('/').at(-1);
const previewContract = await (
  await fetch(`${origin}/api/admin/contracts/${previewContractId}`)
).json();
const previewContacts = await (await fetch(`${origin}/api/admin/contacts?limit=100`)).json();
const contactId = previewContacts.data.find((c) => c.contactCode === 'LOCAL-TRADE-IN-SELLER')?.id;
const customerId = previewContract.customerId;
assert.ok(contactId && customerId, 'Managed preview must have populated audit fixtures');
const artifacts = join(output, 'uxui-remediation');
mkdirSync(artifacts, { recursive: true });
const results = [];
const browser = await chromium.launch();
const widths = [320, 360, 390, 430, 768, 1024, 1280, 1440];
const integrations = [
  {
    key: 'line',
    name: 'LINE Official Account สำหรับสาขาทดสอบ',
    description: 'ข้อมูลสังเคราะห์ตรวจการจัดวาง',
    configured: true,
  },
  {
    key: 'payment',
    name: 'Payment Service Integration Long Name',
    description: 'ข้อมูลสังเคราะห์ตรวจการจัดวาง',
    configured: false,
  },
  {
    key: 'sms',
    name: 'SMS Notification Service',
    description: 'ข้อมูลสังเคราะห์ตรวจการจัดวาง',
    configured: true,
  },
];

async function record(page, name, width, theme, detail = {}) {
  const filename = `${name}-${width}-${theme}.png`;
  if ([320, 1440].includes(width))
    await page.screenshot({ path: join(artifacts, filename), animations: 'disabled' });
  results.push({
    name,
    width,
    theme,
    status: 'pass',
    ...detail,
    screenshot: [320, 1440].includes(width) ? filename : null,
  });
  console.log(`PASS ${name} ${width} ${theme}`);
}
async function noOverflow(page, name) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${name}: body overflows`,
  );
}
async function insideViewport(locator, name) {
  for (const el of await locator.all()) {
    assert.ok(
      await el.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.left >= -1 && r.right <= innerWidth + 1;
      }),
      `${name}: clipped horizontally`,
    );
  }
}
async function goto(page, path) {
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function fixtures(page) {
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/api/admin/integrations**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith('/registry')
        ? integrations.map((i) => ({ ...i, fields: [] }))
        : path.endsWith('/config')
          ? {}
          : integrations,
    });
  });
  await page.route('**/api/admin/notifications/sms/credit**', (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.route('**/api/admin/expenses/periods/reopened**', (route) =>
    route.fulfill({
      json: [
        {
          id: 'layout-only',
          year: 2026,
          month: 10,
          reopenedAt: '2026-10-14T00:00:00Z',
          reopenedBy: { name: 'ผู้ทดสอบการจัดวาง' },
          reopenReason: 'เหตุผลตัวอย่างสำหรับตรวจคำภาษาไทยและความยาวของข้อความบนจอแคบ',
          taxFiled: true,
        },
      ],
    }),
  );
}
async function mountFixture(page) {
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const {
      default: { createRoot },
    } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: Filters } =
      await import('/src/pages/LettersPage/components/LetterFiltersBar.tsx');
    const { default: Charts } =
      await import('/src/pages/DashboardPage/components/DashboardCharts.tsx');
    const { Button } = await import('/src/components/ui/button.tsx');
    const host = document.createElement('section');
    host.id = 'ux-fixture';
    document.querySelector('#main').replaceChildren(host);
    window.uxRoot = createRoot(host);
    const h = React.createElement;
    window.uxRoot.render(
      h(
        'div',
        { className: 'p-4 space-y-6 min-w-0' },
        h('h1', null, 'ตรวจส่วนประกอบร่วม'),
        h(Filters, { value: {}, onChange: () => {}, branches: [], canSelectBranch: true }),
        h(Button, { size: 'sm' }, 'ปุ่มทดสอบ'),
        h(Button, { className: 'min-h-11' }, 'ปุ่มเอกสารขนาดกำหนดเอง'),
        h(Charts, {
          trend: [
            { month: 'ก.ย.', newContracts: 2, paymentsReceived: 125000 },
            { month: 'ต.ค.', newContracts: 7, paymentsReceived: 32500 },
          ],
          trendError: false,
          refetchTrend: () => {},
          statusDist: [{ status: 'ACTIVE', count: 7 }],
          statusDistError: false,
          refetchStatusDist: () => {},
        }),
      ),
    );
  });
  await expect(page.getByRole('heading', { name: 'ตรวจส่วนประกอบร่วม' })).toBeVisible();
}

try {
  for (const theme of process.env.UXUI_DEEP_ONLY ? [] : ['light', 'dark']) {
    for (const width of widths) {
      const page = await browser.newPage({
        viewport: { width, height: width === 320 ? 568 : 1000 },
        reducedMotion: 'reduce',
        colorScheme: theme,
      });
      await fixtures(page);
      await page.addInitScript((theme) => {
        localStorage.setItem('theme', theme);
      }, theme);
      await goto(page, '/finance-portfolio');
      // Set the actual root theme as well; this covers projects using a namespaced key.
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
        theme,
      );
      const grid = page.locator('.finance-portfolio-summary');
      await expect(grid.locator('.finance-summary-content')).toHaveCount(5);
      const columns = await grid.evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length,
      );
      assert.equal(columns, width < 1280 ? 2 : 5);
      const nav = page.getByRole('navigation', { name: 'เมนูด้านล่าง' });
      if (width < 1024) {
        await expect(nav).toBeVisible();
        assert.ok((await nav.locator('a,button').count()) <= 5);
        for (const label of await nav
          .locator('a > span:last-child,button > span:last-child')
          .all()) {
          assert.ok(
            await label.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
            'Mobile label must fit',
          );
        }
      }
      await noOverflow(page, 'portfolio');
      await record(page, 'portfolio', width, theme, { columns });

      await goto(page, `/contacts/${contactId}`);
      const merge = page.getByRole('button', { name: 'รวมผู้ติดต่อซ้ำ', exact: true });
      await expect(merge).toBeVisible();
      await insideViewport(page.locator('#main').getByRole('button'), 'contact actions');
      await noOverflow(page, 'contact');
      await record(page, 'contact', width, theme);

      await goto(page, '/appointments');
      const branch = page.getByRole('combobox', { name: 'สาขาที่ดู' });
      await expect(branch).toBeVisible();
      assert.ok((await branch.boundingBox()).width >= 180, 'Branch select needs readable width');
      await insideViewport(branch, 'branch');
      await record(page, 'appointments', width, theme);

      await goto(page, '/settings/integrations/hub');
      await expect(
        page.getByRole('button', { name: /LINE Official Account สำหรับสาขาทดสอบ/ }),
      ).toBeVisible();
      for (const card of await page
        .locator('#main button')
        .filter({ has: page.locator('[data-slot=badge]') })
        .all()) {
        assert.ok(
          await card.evaluate((e) => {
            const p = e.getBoundingClientRect();
            return [...e.querySelectorAll('[data-slot=badge]')].every((b) => {
              const r = b.getBoundingClientRect();
              return r.left >= p.left && r.right <= p.right;
            });
          }),
          'Integration badge outside its card',
        );
      }
      await noOverflow(page, 'integrations');
      await record(page, 'integrations', width, theme);
      if ([320, 1440].includes(width)) {
        await page.getByRole('button', { name: /LINE Official Account สำหรับสาขาทดสอบ/ }).click();
        const configDialog = page.getByRole('dialog');
        await expect(configDialog).toBeVisible();
        await insideViewport(configDialog, 'integration dialog');
        const title = await configDialog.getByRole('heading').boundingBox();
        const close = await configDialog
          .getByRole('button', { name: 'ปิด', exact: true })
          .boundingBox();
        assert.ok(
          title.x + title.width <= close.x || title.y >= close.y + close.height,
          'Dialog title overlaps close control',
        );
        await page.keyboard.press('Escape');
        await expect(configDialog).toHaveCount(0);
      }

      await goto(page, '/inbox');
      await mountFixture(page);
      await expect(page.getByLabel('วันที่เริ่ม', { exact: true })).toBeVisible();
      await expect(page.getByLabel('วันที่สิ้นสุด', { exact: true })).toBeVisible();
      await insideViewport(
        page.locator('#ux-fixture input, #ux-fixture [role=combobox]'),
        'filters',
      );
      assert.ok(
        (
          await page
            .getByRole('button', { name: 'ปุ่มเอกสารขนาดกำหนดเอง', exact: true })
            .boundingBox()
        ).height >= 44,
        'Explicit document target must keep its height on desktop too',
      );
      if (width < 1024) {
        assert.ok(
          (await page.getByRole('button', { name: 'ปุ่มทดสอบ', exact: true }).boundingBox())
            .height >= 44,
        );
        await expect(page.getByLabel('วันที่เริ่ม', { exact: true })).toHaveCSS(
          'font-size',
          '16px',
        );
      }
      await expect(page.locator('.recharts-area-curve')).toHaveCount(2);
      const chartColors = await page
        .locator('.recharts-area-curve')
        .evaluateAll((es) => es.map((e) => getComputedStyle(e).stroke));
      const legendColors = await page
        .locator('#ux-fixture [data-slot=card-toolbar] span[style]')
        .evaluateAll((es) => es.map((e) => getComputedStyle(e).backgroundColor));
      assert.deepEqual(chartColors, legendColors, 'Legend colors must match series');
      await page.getByText('ดูข้อมูลกราฟเป็นตาราง', { exact: true }).click();
      await expect(page.getByRole('cell', { name: '125,000.00', exact: true })).toBeVisible();
      await noOverflow(page, 'shared filters/chart');
      await page.evaluate(() => window.scrollTo(0, 0));
      await record(page, 'filters-chart', width, theme, { chartColors });
      await page.close();
    }
  }

  // Customer modal at the narrowest viewport: real local customer, keyboard only.
  const modal = await browser.newPage({
    viewport: { width: 320, height: 568 },
    reducedMotion: 'reduce',
  });
  await fixtures(modal);
  await goto(modal, `/customers/${customerId}`);
  const opener = modal.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true });
  await opener.focus();
  await modal.keyboard.press('Enter');
  const dialog = modal.getByRole('dialog', { name: 'แก้ไขข้อมูลลูกค้า' });
  await expect(dialog).toBeVisible();
  assert.ok(await dialog.evaluate((e) => e.contains(document.activeElement)));
  await insideViewport(dialog, 'customer modal');
  await modal.getByRole('button', { name: 'บันทึก', exact: true }).focus();
  await modal.keyboard.press('Tab');
  assert.ok(await dialog.evaluate((e) => e.contains(document.activeElement)));
  await record(modal, 'customer-modal', 320, 'light');
  await modal.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await modal.close();

  // Mounting a paper/editor/iframe must not disable the shell styles, even in a portal.
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
    });
    await fixtures(page);
    await goto(page, '/finance-portfolio');
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    const shellMetrics = () =>
      page.evaluate(() => {
        const heading = document.querySelector('#main h1'),
          s = getComputedStyle(heading),
          b = getComputedStyle(document.body);
        return [
          s.fontSize,
          s.color,
          b.getPropertyValue('--primary'),
          b.getPropertyValue('--success'),
          getComputedStyle(document.querySelector('.finance-portfolio-summary'))
            .gridTemplateColumns,
        ];
      });
    const before = await shellMetrics();
    for (const cls of ['bc-document', 'document-sheet', 'template-paper', 'tiptap', 'iframe']) {
      await page.evaluate((cls) => {
        const paper = document.createElement(cls === 'iframe' ? 'iframe' : 'div');
        paper.id = 'paper-scope-test';
        paper.className = cls;
        document.body.append(paper);
      }, cls);
      assert.deepEqual(await shellMetrics(), before, `Shell changed on ${cls}`);
      await page.evaluate(() => document.querySelector('#paper-scope-test').remove());
    }
    await goto(page, '/expenses');
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    const warning = page
      .locator('[data-slot=alert]')
      .filter({ hasText: 'งวด 2026-10 ถูกเปิดชั่วคราว' });
    await expect(warning).toBeVisible();
    const ratio = await warning.evaluate((e) => {
      const canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d');
      canvas.width = canvas.height = 1;
      const ancestors = [];
      for (let p = e; p; p = p.parentElement) ancestors.unshift(p);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 1, 1);
      for (const p of ancestors) {
        ctx.fillStyle = getComputedStyle(p).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
      }
      const bg = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      const text = e.querySelector('[data-slot=alert-description]');
      ctx.fillStyle = getComputedStyle(text).color;
      ctx.fillRect(0, 0, 1, 1);
      const fg = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      const lum = (rgb) =>
        rgb
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      return (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
    });
    assert.ok(ratio >= 4.5, `Warning contrast ${theme}: ${ratio}`);
    await record(page, 'warning-and-scope', 1440, theme, { contrast: ratio });
    await page.setViewportSize({ width: 320, height: 568 });
    await insideViewport(warning, 'narrow warning');
    await record(page, 'warning', 320, theme, { contrast: ratio });
    await page.close();
  }

  // Old contract links preserve the hash; receipt links do not call contract verify.
  const contractId = '11111111-1111-4111-8111-111111111111';
  const verify = await browser.newPage();
  let contractCalls = 0,
    receiptCalls = 0;
  await fixtures(verify);
  await verify.route(`**/api/admin/contracts/${contractId}/verify**`, (route) => {
    contractCalls++;
    assert.equal(new URL(route.request().url()).searchParams.get('hash'), 'test-hash');
    return route.fulfill({
      json: {
        verified: true,
        reason: '',
        contract: {
          contractNumber: 'TEST-VERIFY',
          status: 'ACTIVE',
          workflowStatus: 'COMPLETED',
          customerName: 'ข้อมูลทดสอบ',
          branchName: 'ทดสอบ',
          createdAt: '2026-10-01',
          totalMonths: 12,
          monthlyPayment: 1000,
        },
        signatures: [],
        hash: 'test-hash',
      },
    });
  });
  await verify.goto(`${origin}/verify/${contractId}?hash=test-hash`);
  await expect(verify).toHaveURL(new RegExp(`/verify/contracts/${contractId}\\?hash=test-hash`));
  await expect(verify.getByText('TEST-VERIFY', { exact: true })).toBeVisible();
  assert.equal(contractCalls, 1);
  await verify.route('**/api/admin/receipts/number/RT-202610-0001**', (route) => {
    receiptCalls++;
    return route.fulfill({
      json: {
        receiptNumber: 'RT-202610-0001',
        receiptType: 'PAYMENT',
        paidDate: '2026-10-14',
        amount: 12500,
        payerName: 'ข้อมูลทดสอบ',
        receiverName: 'ข้อมูลทดสอบ',
        paymentMethod: 'CASH',
      },
    });
  });
  await verify.goto(`${origin}/verify/RT-202610-0001`);
  await expect(verify.getByRole('heading', { name: 'เลือกประเภทเอกสาร' })).toBeVisible();
  assert.equal(receiptCalls, 0, 'An ambiguous number must not open any document automatically');
  await verify.getByRole('link', { name: 'ตรวจสอบใบเสร็จรับเงิน' }).click();
  await expect(verify).toHaveURL(/\/receipts\/verify\/RT-202610-0001/);
  await expect(verify.getByRole('heading', { name: 'ใบเสร็จถูกต้อง' })).toBeVisible();
  assert.equal(receiptCalls, 1);
  assert.equal(contractCalls, 1);
  await verify.close();
  results.push({ name: 'legacy-verification', status: 'pass', contractCalls, receiptCalls });

  // Cold guest → login → exact intended receipt/voucher route (synthetic auth only).
  for (const target of [
    '/receipts/verify/RT-202610-0001',
    '/expenses/verify/11111111-1111-4111-8111-111111111111',
  ]) {
    const page = await browser.newPage();
    await fixtures(page);
    await page.route('**/api/admin/auth/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/login'))
        return route.fulfill({
          json: {
            state: 'AUTHENTICATED',
            accessToken: 'LOCAL-SYNTHETIC-ONLY',
            user: {
              id: 'test',
              email: 'test@example.invalid',
              name: 'ทดสอบ',
              role: 'OWNER',
              branchId: null,
              accessibleCompanies: ['SHOP', 'FINANCE'],
            },
          },
        });
      return route.fulfill({ status: 401, json: { message: 'Test guest' } });
    });
    await page.goto(origin + target);
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('อีเมล', { exact: true }).fill('test@example.invalid');
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill('synthetic-test-only');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(target);
    results.push({ name: 'guest-return', target, status: 'pass' });
    await page.close();
  }
} finally {
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(`PASS ${results.length} UX/UI cases; evidence: ${artifacts}`);
