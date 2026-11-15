// Field scale collector tests (real Chromium, real Noto Sans Thai files) — same harness as
// collect.test.mjs: the page and apps/web/public/fonts are served from a fake http origin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { evaluateFields, normalizeKeyText } from './rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../apps/web/public');
const COLLECT_TAG = { path: path.join(HERE, 'collect.js') };
const ORIGIN = 'http://fields.test';
// Global Constraints exclude list, verbatim (same as collect.test.mjs).
const EXCLUDE =
  '.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog, .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, .parcel-label, .contract-body, iframe, svg';
const CONTROL_FIELDS = [
  'type',
  'id',
  'key',
  'kind',
  'tag',
  'scope',
  'ancestors',
  'x',
  'y',
  'w',
  'h',
  'borderRadius',
  'borderWidth',
  'borderColor',
  'backgroundColor',
  'fontSize',
  'largeText',
  'label',
  'contentLeft',
  'contentRight',
  'contentWidth',
  'placeholderInkWidth',
  'optionCount',
  'longestOptionInkWidth',
  'valueOverflowX',
  'valueOverflowY',
  'adornments',
];
const TARGET_FIELDS = [
  'type',
  'id',
  'key',
  'role',
  'scope',
  'scroller',
  'targetAncestors',
  'x',
  'y',
  'w',
  'h',
  'coveredBy',
];
// Tailwind preflight equivalent + one shared 44px field look (.f) and label look (.lab).
const BASE_STYLE = `body{margin:0;font-family:"Noto Sans Thai",sans-serif;font-size:16px;line-height:24px}
button,input,select,textarea{font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit}
*,*::before,*::after{box-sizing:border-box}
.f{display:block;height:44px;width:200px;margin:0;padding:0 12px;border:1px solid rgb(212,212,216);border-radius:8px;background:rgb(255,255,255);font-size:14px}
.lab{display:block;margin:0 0 12px;font-size:14px;line-height:20px}`;
const html = (body) => `<!doctype html><html lang="th"><head><meta charset="utf-8">
<link rel="stylesheet" href="/fonts/noto-sans-thai/fonts.css"><style>${BASE_STYLE}</style></head><body>${body}</body></html>`;

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

async function openPage(body) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/')
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html(body) });
    const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
    if (pathname.startsWith('/fonts/') && file.startsWith(PUBLIC + path.sep)) {
      const contentType = file.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2';
      return route.fulfill({ status: 200, contentType, body: await readFile(file) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(async () => {
    void document.body.offsetHeight;
    await document.fonts.ready;
  });
  await page.addScriptTag(COLLECT_TAG);
  return page;
}

async function collect(body, options = {}) {
  const page = await openPage(body);
  try {
    return await page.evaluate((o) => window.__collectFields(o), { exclude: EXCLUDE, ...options });
  } finally {
    await page.close();
  }
}

const controls = (facts) => facts.filter((f) => f.type === 'control');
const targets = (facts) => facts.filter((f) => f.type === 'target');
const byKey = (facts, key) => {
  const found = facts.filter((f) => f.key === key);
  assert.equal(found.length, 1, `expected one fact with key ${key}, got ${found.length}`);
  return found[0];
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const CTX = { route: '/fixture', width: 1280, theme: 'light', role: 'owner' };

test('one control per outermost field, with its kind; non-field inputs are not controls', async () => {
  const facts = await collect(`
    <div data-slot="input-wrapper" class="f" style="display:flex;align-items:center"><input data-slot="input" placeholder="ค้นหา" style="border:0;padding:0;flex:1;min-width:0"></div>
    <div data-field-frame class="f"><input placeholder="แท็ก" style="border:0;padding:0;width:100%"></div>
    <input data-slot="readonly-field" class="f" readonly tabindex="-1" value="1,234.00">
    <button type="button" role="combobox" data-slot="select-trigger" class="f"><span data-slot="select-value">ทั้งหมด</span></button>
    <button type="button" role="combobox" aria-label="ผู้ติดต่อ" class="f">เลือก</button>
    <span style="position:relative;display:block"><select class="f" aria-label="สาขา"><option>ลาดพร้าว</option></select></span>
    <textarea class="f" style="height:96px" placeholder="หมายเหตุ"></textarea>
    <input class="f" placeholder="ชื่อ">
    <input type="checkbox"><input type="radio"><input type="hidden" value="x"><input type="file"><input type="submit" value="ส่ง">`);
  assert.deepEqual(
    controls(facts).map((f) => [f.id, f.kind, f.tag, f.key]),
    [
      [0, 'input-wrapper', 'div', 'input-wrapper|ค้นหา|0'],
      [1, 'field-frame', 'div', 'field-frame|แท็ก|0'],
      [2, 'readonly', 'input', 'readonly||0'],
      [3, 'select-trigger', 'button', 'select-trigger||0'],
      [4, 'combobox', 'button', 'combobox|ผู้ติดต่อ|0'],
      [5, 'native-select', 'select', 'native-select|สาขา|0'],
      [6, 'textarea', 'textarea', 'textarea|หมายเหตุ|0'],
      [7, 'input', 'input', 'input|ชื่อ|0'],
    ],
  );
  for (const f of controls(facts)) assert.deepEqual(Object.keys(f).sort(), [...CONTROL_FIELDS].sort());
  for (const f of targets(facts)) assert.deepEqual(Object.keys(f).sort(), [...TARGET_FIELDS].sort());
  assert.deepEqual(
    facts.map((f) => f.id),
    facts.map((_, i) => i),
    'ids are unique and dense: controls first, then targets',
  );
});

test('values never leave the page: typed value, option text, select-value text', async () => {
  const facts = await collect(`
    <input class="f" placeholder="ค้นหาลูกค้า" value="นายสมชาย 0812345678">
    <input data-slot="readonly-field" class="f" readonly value="ยอดลับ 9,999">
    <select class="f" aria-label="สาขา"><option>ลาดพร้าวลับ</option><option>บางนาลับ</option></select>
    <button type="button" role="combobox" data-slot="select-trigger" class="f"><span data-slot="select-value">สาขาลับ</span></button>`);
  const json = JSON.stringify(facts);
  for (const secret of ['สมชาย', '0812345678', 'ยอดลับ', '9,999', 'ลาดพร้าวลับ', 'บางนาลับ', 'สาขาลับ'])
    assert.ok(!json.includes(secret), secret);
  const select = byKey(facts, 'native-select|สาขา|0');
  assert.equal(select.optionCount, 2);
  assert.equal(typeof select.longestOptionInkWidth, 'number');
});

test('box, radius, border, background, font, content box and largeText', async () => {
  const facts = await collect(`
    <input class="f" placeholder="ชื่อ" style="padding:0 40px 0 12px">
    <input class="f" placeholder="ไร้ขอบ" style="border:0;background:transparent;border-radius:6px 6px 0 0">
    <input class="f text-lg" placeholder="ยอดเงินใหญ่">
    <input class="f" placeholder="ตัวใหญ่" style="font-size:18px">`);
  const a = byKey(facts, 'input|ชื่อ|0');
  assert.deepEqual([a.x, a.y, a.w, a.h], [0, 0, 200, 44]);
  assert.equal(a.borderRadius, 8);
  assert.equal(a.borderWidth, 1);
  assert.equal(a.borderColor, 'rgb(212, 212, 216)');
  assert.equal(a.backgroundColor, 'rgb(255, 255, 255)');
  assert.equal(a.fontSize, 14);
  assert.deepEqual([a.contentLeft, a.contentRight, a.contentWidth], [13, 159, 146]);
  assert.equal(a.largeText, false);
  const bare = byKey(facts, 'input|ไร้ขอบ|0');
  assert.deepEqual([bare.borderWidth, bare.borderColor], [0, 'none']);
  assert.equal(bare.backgroundColor, 'rgba(0, 0, 0, 0)');
  assert.equal(bare.borderRadius, 6, 'largest corner');
  assert.equal(byKey(facts, 'input|ยอดเงินใหญ่|0').largeText, true, 'text-lg class');
  assert.equal(byKey(facts, 'input|ตัวใหญ่|0').largeText, true, '18px font');
});

test('scope and ancestors: page / #main / dialog, layout of every ancestor up to the scope root', async () => {
  const facts = await collect(`
    <div style="display:flex;gap:8px"><input class="f" placeholder="หน้า"></div>
    <div id="main">
      <div style="display:grid;grid-template-columns:200px 200px;gap:16px"><div><input class="f" placeholder="ก"></div><div><input class="f" placeholder="ข"></div></div>
      <div style="display:flex;flex-direction:column"><input class="f" placeholder="ค"></div>
    </div>
    <div role="dialog"><input class="f" placeholder="ในกล่อง"></div>`);
  const layouts = (f) => f.ancestors.map((x) => x.layout);
  const pg = byKey(facts, 'input|หน้า|0');
  const a = byKey(facts, 'input|ก|0');
  const b = byKey(facts, 'input|ข|0');
  const c = byKey(facts, 'input|ค|0');
  const dialog = byKey(facts, 'input|ในกล่อง|0');
  assert.deepEqual([pg.scope, a.scope, c.scope, dialog.scope], ['page', 'main', 'main', 'dialog:0']);
  assert.deepEqual(layouts(pg), ['flex-row'], 'stops before body');
  assert.deepEqual(layouts(a), ['other', 'grid', 'other']);
  assert.deepEqual(layouts(c), ['flex-col', 'other']);
  assert.deepEqual(layouts(dialog), ['other'], 'stops at the dialog');
  assert.notEqual(a.ancestors[0].id, b.ancestors[0].id);
  assert.equal(a.ancestors[1].id, b.ancestors[1].id, 'shared grid');
  assert.equal(a.ancestors[2].id, c.ancestors[1].id, 'shared #main');
});

test('label: for= above with its gap, aria-labelledby, wrapping label, sr-only label ignored', async () => {
  const facts = await collect(`
    <label for="a" class="lab">ชื่อลูกค้า</label><input id="a" class="f">
    <span id="lb" class="lab" style="font-size:12px;margin-bottom:6px">เบอร์โทร</span><button type="button" role="combobox" aria-labelledby="lb" class="f"></button>
    <label style="display:block">ที่อยู่ <input class="f" placeholder="บ้านเลขที่"></label>
    <label for="d" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">ซ่อน</label><input id="d" class="f" placeholder="ป้ายซ่อน">`);
  assert.deepEqual(byKey(facts, 'input|ชื่อลูกค้า|0').label, { fontSize: 14, gap: 12, above: true });
  assert.deepEqual(byKey(facts, 'combobox|เบอร์โทร|0').label, { fontSize: 12, gap: 6, above: true });
  assert.equal(byKey(facts, 'input|ที่อยู่|0').label.above, false, 'a wrapping label is not above');
  assert.equal(byKey(facts, 'input|ป้ายซ่อน|0').label, null);
});

test('placeholder and longest native option are canvas-measured against the content box (F2)', async () => {
  const PH = 'ค้นหาด้วยชื่อลูกค้า เบอร์โทร หรือเลขสัญญา';
  const page = await openPage(`
    <input class="f" style="width:120px" placeholder="${PH}">
    <input class="f" placeholder="ชื่อ">
    <select class="f" style="width:160px;padding-right:40px" aria-label="บัญชี"><option>สั้น</option><option>ธนาคาร - กสิกรไทย ออมทรัพย์ - 2031165209</option></select>
    <select class="f" aria-label="สถานะ"><option>เปิด</option><option>ปิด</option></select>
    <span id="probe" style="font-size:14px;white-space:nowrap">${PH}</span>`);
  try {
    const facts = await page.evaluate((o) => window.__collectFields(o), { exclude: EXCLUDE });
    const rendered = await page.evaluate(
      () => document.getElementById('probe').getBoundingClientRect().width,
    );
    const long = byKey(facts, `input|${normalizeKeyText(PH)}|0`);
    near(long.placeholderInkWidth, rendered, 0.5, 'placeholder ink vs rendered span');
    assert.equal(long.contentWidth, 94);
    assert.ok(long.placeholderInkWidth > long.contentWidth + 1);
    const short = byKey(facts, 'input|ชื่อ|0');
    assert.ok(short.placeholderInkWidth > 0 && short.placeholderInkWidth < short.contentWidth);
    const account = byKey(facts, 'native-select|บัญชี|0');
    assert.equal(account.optionCount, 2);
    assert.equal(account.contentWidth, 106);
    assert.ok(account.longestOptionInkWidth > account.contentWidth + 1);
    const status = byKey(facts, 'native-select|สถานะ|0');
    assert.ok(status.longestOptionInkWidth < status.contentWidth);
    assert.ok(!JSON.stringify(facts).includes('กสิกรไทย'), 'option text is never recorded');
    assert.deepEqual(
      evaluateFields(facts, CTX)
        .filter((f) => f.rule === 'F2')
        .map((f) => f.key),
      [`placeholder@input|${normalizeKeyText(PH)}|0`, 'option@native-select|บัญชี|0'],
    );
  } finally {
    await page.close();
  }
});

test('Radix select-value overflow on either axis (F2 value)', async () => {
  const VALUE = 'ผู้จัดการ สาขา ลาดพร้าว ที่มี ชื่อ ยาวมาก';
  const clamp =
    'min-width:0;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1';
  const facts = await collect(`
    <button type="button" role="combobox" aria-label="แคบตัดบรรทัด" data-slot="select-trigger" class="f" style="width:120px;display:flex;align-items:center"><span data-slot="select-value" style="${clamp}">${VALUE}</span></button>
    <button type="button" role="combobox" aria-label="แคบจุดไข่ปลา" data-slot="select-trigger" class="f" style="width:120px;display:flex;align-items:center"><span data-slot="select-value" style="min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${VALUE}</span></button>
    <button type="button" role="combobox" aria-label="พอดี" data-slot="select-trigger" class="f" style="display:flex;align-items:center"><span data-slot="select-value" style="${clamp}">ทั้งหมด</span></button>`);
  const pick = (name) => byKey(facts, `select-trigger|${name}|0`);
  assert.equal(pick('แคบตัดบรรทัด').valueOverflowY, true, 'line-clamp-1 hides the wrapped lines');
  assert.deepEqual(
    [pick('แคบจุดไข่ปลา').valueOverflowX, pick('แคบจุดไข่ปลา').valueOverflowY],
    [true, false],
  );
  assert.deepEqual([pick('พอดี').valueOverflowX, pick('พอดี').valueOverflowY], [false, false]);
  assert.deepEqual(
    evaluateFields(facts, CTX)
      .filter((f) => f.rule === 'F2')
      .map((f) => f.key),
    ['value@select-trigger|แคบตัดบรรทัด|0', 'value@select-trigger|แคบจุดไข่ปลา|0'],
  );
});

test('adornments: NativeSelect chevron, clear button, leading icon two levels up (F4)', async () => {
  const facts = await collect(`
    <span style="position:relative;display:block;width:200px"><select class="f" style="padding-right:40px" aria-label="สาขา"><option>ลาดพร้าว</option></select><svg aria-hidden="true" style="position:absolute;right:13px;top:14px;width:16px;height:16px"></svg></span>
    <div style="position:relative;width:200px"><input class="f" placeholder="ค้นหาสินค้า"><button type="button" aria-label="ล้าง" style="position:absolute;right:4px;top:10px;width:24px;height:24px;padding:0;border:0"></button></div>
    <div style="position:relative;width:200px"><svg aria-hidden="true" style="position:absolute;left:12px;top:14px;width:16px;height:16px;z-index:1"></svg><span style="position:relative;display:block"><select class="f" style="padding-left:36px" aria-label="ผู้รับมอบหมาย"><option>ทั้งหมด</option></select></span></div>
    <div style="position:relative;width:200px"><svg aria-hidden="true" style="position:absolute;left:12px;top:14px;width:16px;height:16px"></svg><input class="f" placeholder="ค้นหางาน"></div>`);
  assert.deepEqual(byKey(facts, 'native-select|สาขา|0').adornments, [
    { x: 171, y: 14, w: 16, h: 16, side: 'right' },
  ]);
  assert.deepEqual(byKey(facts, 'input|ค้นหาสินค้า|0').adornments, [
    { x: 172, y: 54, w: 24, h: 24, side: 'right' },
  ]);
  assert.deepEqual(byKey(facts, 'native-select|ผู้รับมอบหมาย|0').adornments, [
    { x: 12, y: 102, w: 16, h: 16, side: 'left' },
  ]);
  const findings = evaluateFields(facts, CTX);
  assert.deepEqual(
    findings
      .filter((f) => f.rule === 'F4')
      .map((f) => [f.key, f.detail.side, f.detail.reserveShort, f.detail.inkOverlap]),
    [
      ['right0@input|ค้นหาสินค้า|0', 'right', 15, 0],
      ['left0@input|ค้นหางาน|0', 'left', 15, 15],
    ],
  );
  assert.deepEqual(
    findings.filter((f) => f.rule === 'F3'),
    [],
    'a clear button inside its field is F4, not F3',
  );
});

test('targets: role, ancestors, scroller, coveredBy (F3 P2 and P1)', async () => {
  const facts = await collect(`
    <div style="position:relative;height:60px">
      <button style="position:absolute;left:0;top:0;width:120px;height:44px">บันทึก</button>
      <button style="position:absolute;left:100px;top:8px;width:120px;height:44px">ยกเลิก</button>
    </div>
    <div style="position:relative;height:60px">
      <a href="#x" style="position:absolute;left:0;top:0;width:120px;height:44px;display:block">ดูรายละเอียดลูกค้า</a>
      <button style="position:absolute;left:30px;top:0;width:60px;height:44px">ลบ</button>
    </div>
    <a href="#card" style="display:block;width:200px;padding:8px"><button type="button">ซ้อนในลิงก์</button></a>
    <div style="overflow:auto;height:60px;position:relative"><button style="position:absolute;left:0;top:0;width:120px;height:44px">ในกล่องเลื่อน</button></div>`);
  const save = byKey(facts, 'target-button|บันทึก|0');
  const cancel = byKey(facts, 'target-button|ยกเลิก|0');
  const link = byKey(facts, 'target-link||0');
  const removeButton = byKey(facts, 'target-button|ลบ|0');
  const card = byKey(facts, 'target-link||1');
  const inner = byKey(facts, 'target-button|ซ้อนในลิงก์|0');
  const scrolled = byKey(facts, 'target-button|ในกล่องเลื่อน|0');
  assert.equal(save.role, 'button');
  assert.equal(link.role, 'link');
  assert.equal(save.coveredBy, null);
  assert.equal(cancel.coveredBy, null);
  assert.equal(link.coveredBy, removeButton.id, 'the delete button sits on the link centre');
  assert.deepEqual(inner.targetAncestors, [card.id]);
  assert.equal(save.scroller, null);
  assert.equal(typeof scrolled.scroller, 'number');
  assert.ok(!JSON.stringify(facts).includes('ดูรายละเอียดลูกค้า'), 'link text is never a key');
  assert.deepEqual(
    evaluateFields(facts, CTX)
      .filter((f) => f.rule === 'F3')
      .map((f) => [f.key, f.severity]),
    [
      ['target-button|บันทึก|0~target-button|ยกเลิก|0', 'P2'],
      ['target-link||0~target-button|ลบ|0', 'P1'],
    ],
  );
});

test('hidden, aria-hidden, sr-only, display:none and excluded subtrees are skipped', async () => {
  const facts = await collect(`
    <input class="f" placeholder="เห็น">
    <input class="f" placeholder="ซ่อน1" style="visibility:hidden">
    <div aria-hidden="true"><input class="f" placeholder="ซ่อน2"></div>
    <input class="f" placeholder="ซ่อน3" hidden>
    <input class="f" placeholder="ซ่อน4" style="display:none">
    <input placeholder="ซ่อน5" style="position:absolute;width:1px;height:1px;padding:0;border:0;overflow:hidden">
    <div class="sticker"><input class="f" placeholder="ซ่อน6"></div>`);
  assert.deepEqual(
    facts.map((f) => f.key),
    ['input|เห็น|0', 'target-field||0'],
  );
});

test('root option, missing root, determinism, no DOM residue, __collectTypography unchanged', async () => {
  const page = await openPage(
    '<div id="scope"><input class="f" placeholder="ใน"></div><input class="f" placeholder="นอก">',
  );
  try {
    const typoBefore = await page.evaluate(
      (exclude) => window.__collectTypography({ exclude }),
      EXCLUDE,
    );
    const htmlBefore = await page.evaluate(() => document.body.innerHTML);
    const a = await page.evaluate((exclude) => window.__collectFields({ exclude }), EXCLUDE);
    const b = await page.evaluate((exclude) => window.__collectFields({ exclude }), EXCLUDE);
    assert.deepEqual(a, b);
    assert.equal(await page.evaluate(() => document.body.innerHTML), htmlBefore);
    const typoAfter = await page.evaluate(
      (exclude) => window.__collectTypography({ exclude }),
      EXCLUDE,
    );
    assert.deepEqual(typoAfter, typoBefore);
    const scoped = await page.evaluate(() => window.__collectFields({ root: '#scope' }));
    assert.deepEqual(
      scoped.filter((f) => f.type === 'control').map((f) => f.key),
      ['input|ใน|0'],
    );
    await assert.rejects(
      page.evaluate(() => window.__collectFields({ root: '#missing' })),
      /root not found/,
    );
  } finally {
    await page.close();
  }
});
