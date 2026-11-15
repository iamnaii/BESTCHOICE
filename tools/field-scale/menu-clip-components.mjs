// F5 (spec 2026-11-14 §5): one browser case per component that the static guard
// (apps/web/src/components/ui/field-guards.inventory.test.ts) lets keep an inline,
// non-portalled menu. Opens each menu on the local preview and checks the list box is
// inside the viewport and inside every ancestor that clips overflow. Saves nothing: every
// non-GET /api request the browser makes is aborted (and listed in results.json), and no
// form is submitted. The one write the script itself makes is the preview actor switch to
// OWNER (a plain fetch from node, not from the browser). The preview exposes no way to read
// or restore the previous actor, so the actor stays OWNER — which is the preview's startup
// default (apps/api/e2e/support/chat-credit-preview.ts: actor = the OWNER preview user).
//
// Run: npm run local:preview (once) → node tools/field-scale/menu-clip-components.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { previewStatus, repo } from '../local-preview.mjs';

const WIDTHS = [1440, 1024, 390];
// MENU_CLIP_STRICT=1 treats KNOWN entries as failures (see every clipped menu).
const STRICT = process.env.MENU_CLIP_STRICT === '1';

/** Runs in the page. Scroll containers the user can scroll (auto/scroll) are scrolled so
 * the list is as visible as it can get — reachable by scrolling is not "cut". Ancestors
 * with overflow hidden/clip are never scrolled: what they hide stays hidden. */
function revealInScrollers(el) {
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    const r = el.getBoundingClientRect();
    const b = a.getBoundingClientRect();
    if (/auto|scroll/.test(s.overflowY)) {
      const top = b.top + a.clientTop;
      const bottom = top + a.clientHeight;
      if (r.bottom > bottom) a.scrollTop += Math.min(r.bottom - bottom, r.top - top);
      else if (r.top < top) a.scrollTop -= top - r.top;
    }
    if (/auto|scroll/.test(s.overflowX)) {
      const left = b.left + a.clientLeft;
      const right = left + a.clientWidth;
      if (r.right > right) a.scrollLeft += Math.min(r.right - right, r.left - left);
      else if (r.left < left) a.scrollLeft -= left - r.left;
    }
  }
  const r = el.getBoundingClientRect();
  if (r.bottom > innerHeight) scrollBy(0, Math.min(r.bottom - innerHeight, r.top));
  else if (r.top < 0) scrollBy(0, r.top);
}

/** Runs in the page. Every way the list box is cut: by the viewport, or by an ancestor
 * whose overflow is not `visible` (its padding box is the clip rectangle). 1px tolerance. */
function clipIssues(el) {
  const r = el.getBoundingClientRect();
  const rect = [r.left, r.top, r.right, r.bottom].map(Math.round);
  const issues = [];
  if (r.width < 1 || r.height < 1) issues.push({ by: 'empty', rect });
  if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)
    issues.push({ by: 'viewport', rect, clip: [0, 0, innerWidth, innerHeight] });
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    const clipX = s.overflowX !== 'visible';
    const clipY = s.overflowY !== 'visible';
    if (!clipX && !clipY) continue;
    const b = a.getBoundingClientRect();
    const left = b.left + a.clientLeft;
    const top = b.top + a.clientTop;
    const right = left + a.clientWidth;
    const bottom = top + a.clientHeight;
    const cut =
      (clipX && (r.left < left - 1 || r.right > right + 1)) ||
      (clipY && (r.top < top - 1 || r.bottom > bottom + 1));
    if (cut)
      issues.push({
        by: `${a.tagName.toLowerCase()}.${String(a.className).trim().split(/\s+/).slice(0, 5).join('.')}`,
        overflow: `${s.overflowX}/${s.overflowY}`,
        rect,
        clip: [left, top, right, bottom].map(Math.round),
      });
  }
  return issues;
}

const nextFrame = (page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

/** GET → synthetic JSON; anything else → aborted, so a stray click can never write. */
async function mockGet(page, pattern, json) {
  await page.route(pattern, (route) => {
    if (route.request().resourceType() === 'document') return route.continue();
    return route.request().method() === 'GET' ? route.fulfill({ json: json(new URL(route.request().url())) }) : route.abort();
  });
}

const CASES = [
  {
    name: 'NoteMentionInput',
    where: '/inbox/<chatWorkRooms.SHOP> → โน้ตภายใน → ช่อง "แจ้งเตือนเพื่อนร่วมทีม"',
    async open(page, origin, info) {
      await page.goto(`${origin}/inbox/${info.chatWorkRooms.SHOP}?zone=shop`);
      if (page.viewportSize().width < 1024) {
        await page.getByRole('button', { name: 'เลือกโหมดช่องพิมพ์', exact: true }).click();
        await page.getByRole('menuitemradio', { name: 'โน้ตภายใน · ลูกค้าไม่เห็น', exact: true }).click();
      } else {
        await page.getByRole('radio', { name: 'โน้ตภายใน', exact: true }).click();
      }
      await page.getByRole('combobox', { name: 'แจ้งเตือนเพื่อนร่วมทีม', exact: true }).click();
      const list = page.getByRole('listbox', { name: 'เพื่อนร่วมทีมที่มีสิทธิ์ในห้องนี้', exact: true });
      await expect(list.getByRole('option').first()).toBeVisible();
      return list;
    },
  },
  {
    name: 'SearchableSelect',
    where: '/customers → "+ เพิ่มลูกค้าใหม่" → ที่อยู่ → จังหวัด (ที่อยู่ตามบัตร)',
    async open(page, origin) {
      await page.goto(`${origin}/customers`);
      await page.getByRole('button', { name: /^\+ เพิ่ม(ลูกค้า|ผู้สนใจ)ใหม่$/ }).click();
      const dialog = page.getByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' });
      await dialog.getByRole('heading', { name: 'ที่อยู่', exact: true }).click();
      const province = dialog.getByRole('combobox', { name: 'จังหวัด *', exact: true }).first();
      await province.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await province.click();
      const list = page.getByRole('listbox', { name: '-- เลือกจังหวัด --', exact: true });
      await expect(list.getByRole('option').first()).toBeVisible();
      return list;
    },
  },
  {
    name: 'NameAutocomplete',
    where: '/assets/new → ช่อง "ผู้รับผิดชอบ"',
    async open(page, origin) {
      await page.goto(`${origin}/assets/new`);
      const field = page.getByRole('combobox', { name: 'ผู้รับผิดชอบ *', exact: true });
      await field.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await field.click();
      const list = page.getByRole('listbox', { name: 'รายชื่อที่แนะนำ', exact: true });
      await expect(list.getByRole('option').first()).toBeVisible();
      return list.locator('xpath=..');
    },
  },
  {
    name: 'TemplatePickerCombobox',
    where: '/other-income/new → ส่วน 2 → ปุ่ม "ใช้แม่แบบ"',
    // Measured 2026-11-14 on the local preview: the w-72 panel is left-aligned to a
    // right-aligned button, so it runs past the right edge of the screen.
    known: {
      1024: { by: 'viewport', note: 'กล่องกว้าง 288px ชิดซ้ายของปุ่มที่อยู่ขวาสุด → เลยขอบขวาจอ (856→1144 บนจอ 1024)' },
      390: { by: 'viewport', note: 'เลยขอบขวาจอ (258→546 บนจอ 390)' },
    },
    async open(page, origin) {
      const templates = Array.from({ length: 8 }, (_, i) => ({
        id: `f5-other-income-${i + 1}`,
        name: `แม่แบบรายได้ทดสอบ ${i + 1}`,
        itemsJson: [{}],
        useCount: i,
      }));
      await mockGet(page, /\/other-income\/templates(?:\?|$)/, () => templates);
      await page.goto(`${origin}/other-income/new`);
      const trigger = page.getByRole('button', { name: 'ใช้แม่แบบ', exact: true });
      await trigger.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await trigger.click();
      const panel = trigger.locator('xpath=following-sibling::div[1]');
      await expect(panel.getByText('แม่แบบรายได้ทดสอบ 8', { exact: true })).toBeVisible();
      return panel;
    },
  },
  {
    name: 'CatalogPicker',
    where: '/purchase-orders → "+ ซื้อสินค้า" → ช่อง "ค้นหารุ่น" พิมพ์ iphone',
    async open(page, origin) {
      await mockGet(page, /\/(?:purchase-orders|suppliers)(?:\/summary)?(?:\?|$)/, (url) =>
        url.pathname.endsWith('/summary') ? {} : url.pathname.endsWith('/suppliers') ? { data: [], total: 0 } : [],
      );
      await page.goto(`${origin}/purchase-orders`);
      await page.getByRole('button', { name: '+ ซื้อสินค้า', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'ซื้อสินค้า' });
      const search = dialog.getByRole('combobox', { name: 'ค้นหารุ่น' });
      await search.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await search.fill('iphone');
      const list = dialog.getByRole('listbox');
      await expect(list.getByRole('option').first()).toBeVisible();
      return list.locator('xpath=..');
    },
  },
];

const status = await previewStatus();
assert.ok(status.running && status.current, 'Run npm run local:preview in this checkout first');
const origin = `http://localhost:${status.state.port}`;
const info = await (await fetch(`${origin}/api/admin/preview/info`)).json();
assert.equal(info.isolated, true, 'Only run against the isolated local preview');
// Other local checks switch the synthetic actor; these pages need OWNER. This is the only
// write the script makes (from node, outside the browser); there is no endpoint to undo it.
assert.equal((await fetch(`${origin}/api/preview/actor/owner`, { method: 'POST' })).status, 201);
const apiRequests = [];

const artifacts = join(repo, '.tmp/field-scale/menu-clip-components');
mkdirSync(artifacts, { recursive: true });
const results = [];
const failures = [];
const browser = await chromium.launch();
try {
  for (const width of WIDTHS) {
    for (const c of CASES) {
      const label = `${c.name} ${width}px`;
      const context = await browser.newContext({
        viewport: { width, height: width < 1024 ? 844 : 900 },
        reducedMotion: 'reduce',
      });
      await context.routeWebSocket('**/socket.io/**', (socket) => socket.close());
      // Nothing may be saved: abort every non-GET API call the page makes (page-level mocks in
      // mockGet run first and abort non-GET too). 'request' fires for aborted requests as well.
      await context.route('**/api/**', (route) =>
        route.request().method() === 'GET' ? route.fallback() : route.abort(),
      );
      context.on('request', (request) => {
        if (request.url().includes('/api/')) apiRequests.push({ case: label, method: request.method(), url: new URL(request.url()).pathname });
      });
      const page = await context.newPage();
      try {
        const list = await c.open(page, origin, info);
        await nextFrame(page);
        await list.evaluate(revealInScrollers);
        await nextFrame(page);
        const issues = await list.evaluate(clipIssues);
        await page.screenshot({ path: join(artifacts, `${c.name}-${width}.png`) });
        const known = STRICT ? undefined : c.known?.[width];
        if (known && issues.length > 0 && issues.every((i) => i.by === known.by)) {
          results.push({ component: c.name, width, status: 'KNOWN', note: known.note, issues });
          console.log(`KNOWN ${label}: ${known.note}`);
        } else if (known) {
          failures.push(
            issues.some((i) => i.by === known.by)
              ? `${label} (${c.where}): known issue "${known.note}" plus a new cut ${JSON.stringify(issues.filter((i) => i.by !== known.by))}`
              : `${label}: known issue "${known.note}" no longer reproduces — remove it from KNOWN`,
          );
          results.push({ component: c.name, width, status: 'FAIL', issues });
        } else if (issues.length) {
          failures.push(`${label} (${c.where}): list box is cut ${JSON.stringify(issues)}`);
          results.push({ component: c.name, width, status: 'FAIL', issues });
        } else {
          results.push({ component: c.name, width, status: 'PASS' });
          console.log(`PASS ${label}`);
        }
      } catch (error) {
        failures.push(`${label} (${c.where}): ${error.message.split('\n')[0]}`);
        results.push({ component: c.name, width, status: 'ERROR', error: error.message.split('\n')[0] });
        await page.screenshot({ path: join(artifacts, `${c.name}-${width}-error.png`) }).catch(() => {});
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(
      {
        origin,
        results,
        failures,
        // every non-GET API request the browser attempted — all aborted
        abortedWrites: apiRequests.filter((r) => r.method !== 'GET'),
        apiRequestCount: apiRequests.length,
      },
      null,
      2,
    ) + '\n');
}
const count = (s) => results.filter((r) => r.status === s).length;
if (failures.length) {
  console.error(`\nFAIL menu clip:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS menu clip: ${count('PASS')} passed · ${count('KNOWN')} known → ${artifacts}`);
}
