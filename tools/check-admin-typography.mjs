import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { previewStatus, output } from './local-preview.mjs';

// Run against this checkout's isolated preview only. No production mutations.
const status = await previewStatus();
assert.ok(status.running && status.current, 'Run npm run local:preview in this checkout first');
const origin = `http://localhost:${status.state.port}`;
const artifacts = join(output, 'typography');
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch();
// Layout-only fixture: this preview does not implement the receivable API.
async function mockReceivables(page) {
  const data = ['PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'OVERDUE', 'DISPUTED'].map(
    (status, i) => ({
      id: `test-${i}`,
      status,
      financeCompany: 'LOCAL TEST FINANCE',
      financeRefNumber: 'TEST-001',
      expectedAmount: '15000',
      commissionRate: '0.05',
      commissionAmount: '750',
      netExpectedAmount: '14250',
      receivedAmount: '1000',
      receivedDate: null,
      bankRef: null,
      expectedDate: '2026-10-10',
      note: null,
      createdAt: '2026-09-30',
      externalFinanceCompanyId: null,
      lastContactedAt: null,
      lastPromisedDate: null,
      contactAttemptCount: 0,
      sale: {
        id: `sale-${i}`,
        saleNumber: 'TEST-SALE',
        sellingPrice: '15000',
        netAmount: '15000',
        financeAmount: '15000',
        downPaymentAmount: '0',
        createdAt: '2026-09-30',
        customer: { id: 'test-customer', name: 'ลูกค้าทดสอบการจัดวาง', phone: '0000000000' },
        product: { id: 'test-product', name: 'iPhone 15 Pro Max', brand: 'Apple' },
        salesperson: { id: 'test-user', name: 'ผู้ทดสอบ' },
      },
      branch: { id: 'test-branch', name: 'สาขาทดสอบ' },
      recordedBy: null,
    }),
  );
  await page.route(/\/finance-receivable(?:\/(?:companies|summary))?(?:\?|$)/, async (route) => {
    if (route.request().resourceType() === 'document') return route.continue();
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/companies')
      ? ['LOCAL TEST FINANCE']
      : path.endsWith('/summary')
        ? {
            totalPending: 2,
            totalReceived: 1,
            totalOverdue: 1,
            totalDisputed: 1,
            pendingAmount: '28500',
            receivedAmount: '1000',
            overdueAmount: '14250',
            disputedAmount: '14250',
          }
        : { data, total: data.length };
    await route.fulfill({ json });
  });
}

async function checkUiFonts(page, label) {
  const audit = await page.evaluate(() => {
    const expected = getComputedStyle(document.body).fontFamily;
    const elements = new Set(document.querySelectorAll('input, textarea, select'));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim()) elements.add(walker.currentNode.parentElement);
    }
    const visible = [...elements].filter((e) => e?.checkVisibility());
    return {
      expected,
      checked: visible.length,
      mismatches: visible.flatMap((e) => {
        const family = getComputedStyle(e).fontFamily;
        return family === expected
          ? []
          : [{ tag: e.tagName, family, text: e.textContent.slice(0, 60) }];
      }),
    };
  });
  assert.ok(audit.checked > 10, `Font audit must inspect rendered content: ${label}`);
  assert.deepEqual(audit.mismatches, [], `Same UI font stack: ${label}`);
  console.log(`PASS fonts ${label}: ${audit.checked} text/control elements, ${audit.expected}`);
}
try {
  for (const width of [390, 768, 1056, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    });
    await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
    await mockReceivables(page);
    for (const path of [
      '/finance-portfolio',
      '/contracts',
      '/credit-checks',
      '/finance-receivable',
      '/customers',
      '/inbox',
    ]) {
      await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.app-shell')).toBeVisible();
      if (path === '/inbox')
        await expect(page.getByRole('button', { name: /^รอตอบ/ })).toBeVisible();
      else
        await expect(page.locator('#main h1').first()).toHaveCSS(
          'font-size',
          width < 1024 ? '22px' : '24px',
        );
      // The desktop Inbox is its own workspace (2026-10-07): MainLayout renders no app
      // sidebar there, so its wrapper has no left padding at any width.
      await expect(page.locator('.wrapper')).toHaveCSS(
        'padding-left',
        width < 1024 || path === '/inbox' ? '0px' : /^(70|264)px$/,
      );
      if (path === '/finance-portfolio' && width >= 1024) {
        const expand = page.getByRole('button', { name: 'ขยายเมนู', exact: true });
        if (await expand.count()) await expand.click();
        await expect(page.locator('.wrapper')).toHaveCSS('padding-left', '264px');
      }
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: join(artifacts, `${path.slice(1)}-${width}.png`),
        animations: 'disabled',
      });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      await checkUiFonts(page, `${path} ${width}px`);
      if (path === '/finance-portfolio') {
        const badges = page.locator(
          '.finance-portfolio-table tbody td:last-child [data-slot=badge]',
        );
        await expect(badges).toHaveCount(3);
        for (const badge of await badges.all()) {
          await expect(badge).toHaveCSS('white-space', 'nowrap');
          const fits = await badge.evaluate((e) => {
            const range = document.createRange();
            range.selectNodeContents(e);
            return range.getBoundingClientRect().height <= e.getBoundingClientRect().height;
          });
          assert.ok(fits, `Status must fit inside its pill at ${width}px`);
        }
      }
      if (['/contracts', '/credit-checks', '/finance-receivable'].includes(path)) {
        const badges = page.locator('#main .admin-status-badge');
        await expect.poll(() => badges.count()).toBeGreaterThan(0);
        for (const badge of await badges.all()) {
          await expect(badge).toHaveCSS('white-space', 'nowrap');
          assert.ok(
            await badge.evaluate((e) => {
              const range = document.createRange();
              range.selectNodeContents(e);
              const text = range.getBoundingClientRect(),
                box = e.getBoundingClientRect();
              const cell = e.closest('td')?.getBoundingClientRect();
              return (
                text.height <= box.height &&
                text.width <= box.width &&
                (!cell || (box.left >= cell.left && box.right <= cell.right))
              );
            }),
            `Full status fits in badge and cell: ${path} ${width}px`,
          );
        }
      }
      if (path === '/finance-portfolio') {
        const cards = page.locator('.finance-summary-content');
        await expect(cards).toHaveCount(5);
        assert.ok(
          await cards.evaluateAll((es) =>
            es.every((e) => {
              const value = e.querySelector('p:last-child');
              const range = document.createRange();
              range.selectNodeContents(value);
              const text = range.getBoundingClientRect(),
                box = value.getBoundingClientRect();
              return (
                text.height <= parseFloat(getComputedStyle(value).lineHeight) &&
                text.width <= box.width
              );
            }),
          ),
          `Portfolio values and currency stay together: ${width}px`,
        );
      }
      if (path === '/inbox') {
        await page.getByRole('combobox', { name: 'กรองตามช่องทาง' }).click();
        await expect(page.getByRole('option').first()).toBeVisible();
        await checkUiFonts(page, `Inbox menu ${width}px`);
        await page.keyboard.press('Escape');
      }
      for (const input of await page
        .locator('input:visible:not([type=checkbox]):not([type=radio])')
        .all()) {
        const size = await input.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
        assert.ok(size >= (width < 1024 ? 16 : 14), `Readable input on ${path} at ${width}px`);
      }
    }
    // Actual shared form controls, including intentionally enlarged money entry.
    await page.evaluate(async () => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const {
        default: { createRoot },
      } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { Input } = await import('/src/components/ui/input.tsx');
      const host = document.createElement('div');
      host.id = 'typography-fixture';
      document.querySelector('#main').append(host);
      window.typographyRoot = createRoot(host);
      window.typographyRoot.render(
        React.createElement(
          'div',
          null,
          React.createElement(Input, { 'aria-label': 'Standard test input' }),
          React.createElement(Input, {
            'aria-label': 'Large amount test input',
            className: 'text-2xl font-mono',
            value: '12500',
            readOnly: true,
          }),
          React.createElement('span', { className: 'font-mono' }, 'IMEI 000000000000000'),
          React.createElement('code', null, 'รหัส TEST-001'),
          React.createElement('kbd', null, 'Ctrl+K'),
        ),
      );
      const sonnerUrl = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((url) => /\/sonner\.js\?/.test(url));
      if (!sonnerUrl) throw new Error('Mounted Sonner module missing');
      const { toast } = await import(sonnerUrl);
      toast.success('ตรวจฟอนต์แจ้งเตือน', { id: 'typography-check', duration: Infinity });
    });
    await expect(page.getByLabel('Standard test input')).toHaveCSS(
      'font-size',
      width < 1024 ? '16px' : '14px',
    );
    await expect(page.getByLabel('Large amount test input')).toHaveCSS('font-size', '24px');
    await expect(page.getByText('ตรวจฟอนต์แจ้งเตือน', { exact: true })).toBeVisible();
    await checkUiFonts(page, `controls, identifiers and toast ${width}px`);
    await page.evaluate(() => {
      window.typographyRoot.unmount();
      document.querySelector('#typography-fixture').remove();
    });
    await page.close();
  }

  // Compare real document components with the new stylesheet enabled/disabled.
  // Check every descendant's type metrics and geometry, in screen AND print media.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.goto(origin + '/inbox');
  await page.addStyleTag({
    content: '* { animation: none !important; transition: none !important; }',
  });
  await expect(page.getByRole('button', { name: /^รอตอบ/ })).toBeVisible();
  for (const kind of ['receipt', 'template', 'sticker']) {
    await page.evaluate(async (kind) => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const {
        default: { createRoot },
      } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const host = document.createElement('div');
      host.id = 'typography-document';
      document.querySelector('#main').append(host);
      window.typographyRoot = createRoot(host);
      let element;
      if (kind === 'receipt') {
        const { default: Receipt } = await import('/src/components/payment/MobileReceipt.tsx');
        element = React.createElement(Receipt, {
          receipt: {
            receiptNumber: 'TEST-RECEIPT',
            receiptType: 'PAYMENT',
            paidDate: '2026-09-30',
            amount: 12500,
            payerName: 'ลูกค้าตัวอย่าง',
            receiverName: 'พนักงานตัวอย่าง',
            paymentMethod: 'CASH',
          },
        });
      } else if (kind === 'template') {
        const { default: Preview } =
          await import('/src/components/template-editor/preview/DocumentPreview.tsx');
        element = React.createElement(Preview);
      } else {
        const { StickerCard, STICKER_STYLES } =
          await import('/src/pages/StickerPrintPage/StickerCard.tsx');
        element = React.createElement(
          React.Fragment,
          null,
          React.createElement('style', null, STICKER_STYLES),
          React.createElement(StickerCard, {
            view: {
              productId: 'test',
              model: 'iPhone 15 Pro Max',
              spec: '256GB · สีดำ',
              cash: '25,900',
              used: { battery: 95, box: true },
              imei: '000000000000000',
              rates: [{ no: 1, down: '2,590', monthly: '2,500', months: 12 }],
            },
          }),
        );
      }
      window.typographyRoot.render(element);
    }, kind);
    await expect(
      page
        .locator('#typography-document')
        .locator(
          kind === 'receipt'
            ? '.mobile-receipt'
            : kind === 'template'
              ? '.template-paper'
              : '.sticker',
        ),
    ).toBeAttached();
    await page.evaluate(() => document.fonts.ready);
    for (const media of ['screen', 'print']) {
      await page.emulateMedia({ media });
      await page.evaluate(() => document.fonts.ready);
      const snapshots = [];
      for (const disabled of [true, false]) {
        snapshots.push(
          await page.evaluate(async (disabled) => {
            const style = document.querySelector(
              'style[data-vite-dev-id$="/styles/admin-typography.css"]',
            );
            if (!style?.sheet) throw new Error('Admin stylesheet missing');
            style.sheet.disabled = disabled;
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            return [
              ...document.querySelectorAll('#typography-document, #typography-document *'),
            ].map((e) => {
              const s = getComputedStyle(e),
                r = e.getBoundingClientRect();
              return [
                e.tagName,
                s.fontFamily,
                s.fontSize,
                s.fontWeight,
                s.lineHeight,
                s.letterSpacing,
                r.width,
                r.height,
              ];
            });
          }, disabled),
        );
      }
      assert.deepEqual(
        snapshots[1],
        snapshots[0],
        `${kind}: unchanged typography and geometry in ${media}`,
      );
    }
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => {
      window.typographyRoot.unmount();
      document.querySelector('#typography-document').remove();
    });
    console.log(`PASS ${kind}: screen and print unchanged`);
  }
  await page.close();
  console.log(
    'PASS admin typography: 6 routes × 4 widths (receivable layout uses intercepted synthetic GET), standard/large inputs, document isolation',
  );
} finally {
  await browser.close();
}
