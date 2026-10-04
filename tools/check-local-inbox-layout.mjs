import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Exercise the actual app shell: its unlayered theme CSS caused the double outline.
export async function checkInboxLayout(browser, origin, output) {
  const info = await (await fetch(new URL('/api/admin/preview/info', origin))).json();
  assert.equal(info.isolated, true);
  assert.equal(info.ocr, 'mock');
  const response = await fetch(new URL('/api/admin/preview/fixture', origin), { method: 'POST' });
  assert.equal(response.status, 201);
  const { roomId } = await response.json();
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext();
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(new URL(`/inbox/${roomId}`, origin).href);
        for (const mode of ['chat', 'note']) {
          await page.getByRole('radio', { name: mode === 'chat' ? 'ตอบลูกค้า' : 'โน้ตภายใน', exact: true }).click();
          const input = page.getByRole('textbox', { name: mode === 'chat' ? 'พิมพ์ข้อความ' : 'พิมพ์โน้ตภายใน', exact: true });
          await expect(input).toBeFocused();
          // Wait for the card's focus transition before measuring its replacement indicator.
          await expect(input.locator('..')).toHaveCSS('--tw-ring-offset-width', '0px');
          const metrics = await input.evaluate(el => {
            const style = getComputedStyle(el);
            const card = el.parentElement;
            const rect = card.getBoundingClientRect();
            return {
              outline: style.outlineStyle,
              ring: getComputedStyle(card).getPropertyValue('--tw-ring-color'),
              shadow: getComputedStyle(card).boxShadow,
              titleWidth: el.closest('.\\@container').querySelector('h3').getBoundingClientRect().width,
              left: rect.left, right: rect.right, bottom: rect.bottom,
              overflow: document.documentElement.scrollWidth > innerWidth,
              controls: [...card.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width).map(b => {
                const r = b.getBoundingClientRect();
                return { label: b.getAttribute('aria-label'), left: r.left, right: r.right, bottom: r.bottom };
              }),
            };
          });
          const label = `${theme} ${width}px ${mode}`;
          assert.equal(metrics.outline, 'none', `${label}: textarea must not draw a second focus outline`);
          assert.ok(metrics.ring && metrics.shadow !== 'none', `${label}: card must retain a visible focus indicator`);
          assert.ok(metrics.titleWidth >= 100, `${label}: customer name squeezed out of header`);
          assert.equal(metrics.overflow, false, `${label}: page overflow`);
          assert.ok(metrics.left >= 0 && metrics.right <= width + 1, `${label}: composer outside viewport`);
          for (const control of metrics.controls) {
            assert.ok(control.left >= metrics.left && control.right <= metrics.right + 1 && control.bottom <= metrics.bottom + 1,
              `${label}: ${control.label} outside composer`);
          }
          const send = page.getByRole('button', { name: mode === 'chat' ? 'ส่งข้อความ' : 'บันทึกโน้ต', exact: true });
          await expect(send).toBeDisabled();
          await input.fill('ตรวจเลย์เอาต์ภาษาไทย');
          await input.press('Shift+Enter');
          await page.keyboard.insertText('ก');
          await expect(input).toHaveValue('ตรวจเลย์เอาต์ภาษาไทย\nก');
          await expect(send).toBeEnabled();
          await page.screenshot({ path: join(output, `inbox-layout-${theme}-${width}-${mode}.png`), animations: 'disabled' });
          await input.fill('');
          if (mode === 'chat') {
            await input.press('Tab');
            const microphone = page.getByRole('button', { name: 'พูดเป็นข้อความ', exact: true });
            await expect(microphone).toBeFocused();
            await expect(microphone).toHaveCSS('outline-style', 'solid');
            await page.keyboard.press('Tab');
            const attachment = page.getByRole('button', { name: 'แนบไฟล์', exact: true });
            await expect(attachment).toBeFocused();
            await expect(attachment).toHaveCSS('outline-style', 'solid');
          }
        }
        await expect(page.getByRole('log', { name: 'ประวัติข้อความ' })).toBeVisible();
        assert.deepEqual(errors, [], `${theme} ${width}px browser errors`);
      }
    } finally { await context.close(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve('.tmp/local-preview');
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await checkInboxLayout(browser, process.env.LOCAL_INBOX_ORIGIN || 'http://localhost:5227', output);
    console.log('PASS: Inbox layout, light/dark, 320–1920px, chat/note focus and multiline drafts');
  } finally { await browser.close(); }
}
