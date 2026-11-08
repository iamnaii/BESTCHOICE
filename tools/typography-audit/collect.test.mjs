// Typography audit — in-page collector tests (real Chromium, real Noto Sans Thai files).
// The page and apps/web/public/fonts are served from a fake http origin via page.route
// (Ruling I: fonts.css uses absolute /fonts/ urls, which cannot resolve under file://).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { factKey, isNumericOnly, normalizeKeyText, resolveKeys, UI_FONT_RE } from './rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COLLECT = path.join(HERE, 'collect.js');
const PUBLIC = path.resolve(HERE, '../../apps/web/public');
const ORIGIN = 'http://typography.test';
// Global Constraints exclude list, verbatim.
const EXCLUDE = '.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog, .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, .parcel-label, .contract-body, iframe, svg';
const FIELDS = ['key', 'tag', 'kind', 'text', 'fontSize', 'lineHeight', 'fontWeight', 'fontFamily', 'numeric', 'x', 'y', 'w', 'h',
  'lines', 'textTop', 'textHeight', 'inkWidth', 'inkHeight', 'overflowClip', 'scrollOverflowX', 'scrollOverflowY', 'hasThai',
  'numericOnly', 'inReadingBlock', 'iconRatios', 'headingLevel'];
const THAI_RE = /[฀-๿]/;

// Tailwind preflight equivalent: form controls inherit the page font.
const BASE_STYLE = `body{margin:0;font-family:"Noto Sans Thai",sans-serif;font-size:16px;line-height:24px}
button,input,select,textarea{font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit}`;
const html = (body, head) => `<!doctype html><html lang="th"><head><meta charset="utf-8">
<link rel="stylesheet" href="/fonts/noto-sans-thai/fonts.css"><style>${BASE_STYLE}</style>${head}</head><body>${body}</body></html>`;

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function openPage(body, head = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html(body, head) });
    const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
    if (pathname.startsWith('/fonts/') && file.startsWith(PUBLIC + path.sep)) {
      const contentType = file.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2';
      return route.fulfill({ status: 200, contentType, body: await readFile(file) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/`);
  const loadedFaces = await page.evaluate(async () => {
    void document.body.offsetHeight; // force layout so every used face starts loading
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Noto Sans Thai' && f.status === 'loaded').length;
  });
  assert.ok(loadedFaces > 0, 'Noto Sans Thai FontFace must be loaded before measuring');
  await page.addScriptTag({ path: COLLECT });
  return page;
}

async function collect(body, { head = '', options = {}, prepare } = {}) {
  const page = await openPage(body, head);
  try {
    if (prepare) await prepare(page);
    return await page.evaluate((o) => window.__collectTypography(o), { exclude: EXCLUDE, ...options });
  } finally {
    await page.close();
  }
}

const withText = (facts, text) => facts.filter((f) => f.text === text);
const one = (facts, text) => {
  const found = withText(facts, text);
  assert.equal(found.length, 1, `expected exactly one fact with text ${JSON.stringify(text)}, got ${found.length}`);
  return found[0];
};
const centreOffset = (f) => f.textTop + f.textHeight / 2 - (f.y + f.h / 2);

// ---------------------------------------------------------------- brief Step 1 cases

test('single-line 40px button → lines 1 (lines from text rects, not box height)', async () => {
  const facts = await collect('<button style="height:40px;padding:0 16px;line-height:21px;font-size:14px">บันทึก</button>');
  const f = one(facts, 'บันทึก');
  assert.equal(f.kind, 'button');
  assert.equal(f.tag, 'button');
  assert.equal(f.lines, 1);
  assert.equal(f.h, 40);
  assert.equal(f.lineHeight, 21);
  assert.equal(f.fontSize, 14);
});

test('wrapped button → lines ≥ 2, kind button', async () => {
  const facts = await collect('<button style="width:60px;font-size:14px;line-height:21px">บันทึกข้อมูลลูกค้าทั้งหมด</button>');
  const f = one(facts, 'บันทึกข้อมูลลูกค้าทั้งหมด');
  assert.equal(f.kind, 'button');
  assert.ok(f.lines >= 2, `lines=${f.lines}`);
});

test('ink overflow Thai — overflow:hidden ⇒ overflowClip both (Ruling H) and inkHeight > 16', async () => {
  const facts = await collect('<div style="overflow:hidden;height:16px;line-height:16px;font-size:16px">ปุ่ม</div>');
  const f = one(facts, 'ปุ่ม');
  assert.equal(f.overflowClip, 'both');
  assert.ok(f.inkHeight > 16, `inkHeight=${f.inkHeight}`);
  assert.equal(f.lineHeight, 16);
  assert.equal(f.hasThai, true);
});

test('ink overflow Thai — overflow-y:hidden alone ⇒ overflowClip y (Ruling H)', async () => {
  const facts = await collect('<div style="overflow-y:hidden;height:16px;line-height:16px;font-size:16px">ปุ่ม</div>');
  assert.equal(one(facts, 'ปุ่ม').overflowClip, 'y');
});

test('excludes document subtrees (.template-paper, .sticker, .parcel-label)', async () => {
  const facts = await collect(`<p>หน้าจอ</p>
    <div class="template-paper"><p>สัญญา</p></div>
    <div class="sticker"><span>สติกเกอร์</span></div>
    <div class="parcel-label"><b>ใบปะหน้า</b></div>
    <svg width="100" height="20"><text x="0" y="15">กราฟ</text></svg>`);
  assert.deepEqual(facts.map((f) => f.text), ['หน้าจอ']);
});

test('family and weight captured', async () => {
  const facts = await collect('<p style="font-weight:600">ตัวหนา</p>');
  const f = one(facts, 'ตัวหนา');
  assert.ok(f.fontFamily.startsWith('"Noto Sans Thai"'), f.fontFamily);
  assert.match(f.fontFamily, UI_FONT_RE);
  assert.equal(f.fontWeight, 600);
  assert.equal(typeof f.fontWeight, 'number');
});

test('reading block flag', async () => {
  const facts = await collect('<div class="reading-block"><p>อ่านยาว</p></div><p>ทั่วไป</p>');
  assert.equal(one(facts, 'อ่านยาว').inReadingBlock, true);
  assert.equal(one(facts, 'ทั่วไป').inReadingBlock, false);
});

test('numeric only (<td>1,234.50</td>) and tabular-nums flag', async () => {
  const facts = await collect(`<table><tbody><tr>
    <td>1,234.50</td>
    <td style="font-variant-numeric:tabular-nums">2,000</td>
    <td style="font-feature-settings:'tnum'">3,000</td>
    <td>ยอด 4,000</td>
    <td>-</td>
  </tr></tbody></table>`);
  const plain = one(facts, '1,234.50');
  assert.equal(plain.tag, 'td');
  assert.equal(plain.numericOnly, true);
  assert.equal(plain.numeric, false);
  assert.equal(one(facts, '2,000').numeric, true);
  assert.equal(one(facts, '3,000').numeric, true);
  assert.equal(one(facts, 'ยอด 4,000').numericOnly, false);
  assert.equal(one(facts, '-').numericOnly, false);
});

test('key has no class and masks digits; dup index counts per kind+text in DOM order', async () => {
  const facts = await collect(`<p class="text-sm leading-snug font-extrabold">ยอด 1,200 บาท</p>
    <button>ตกลง 1</button><span>ตกลง 2</span><button>ตกลง 3</button>`);
  const p = one(facts, 'ยอด 1,200 บาท');
  assert.equal(p.key, 'paragraph|ยอด #,### บาท|0');
  assert.ok(!/text-sm|leading|extrabold/.test(p.key));
  assert.equal(one(facts, 'ตกลง 1').key, 'button|ตกลง #|0');
  assert.equal(one(facts, 'ตกลง 2').key, 'text|ตกลง #|0');
  assert.equal(one(facts, 'ตกลง 3').key, 'button|ตกลง #|1');
});

// ---------------------------------------------------------------- shape + drift guard (Ruling A, Task 1 facts)

const DRIFT_PAGE = `<h1>หน้า   หลัก ๑๒๓</h1>
  <p>ยอด
     1,200   บาท</p>
  <p>ราคา&nbsp;฿1,200</p>
  <table><tbody><tr><td>฿1,200</td><td>-</td><td>12.5%</td><td>1 – 2</td><td>01/11/2569</td></tr></tbody></table>
  <button>บันทึก</button><button>บันทึก</button><span>บันทึก</span>
  <nav><a href="#a"><span>ภาพรวม</span></a><a href="#b">ภาพรวม</a></nav>
  <label>ชื่อ</label><span class="rounded-full" style="font-size:12px">ใหม่ 3</span>
  <input placeholder="ค้นหา 10 รายการ"><input value="ห้ามเก็บ"><input aria-label="จำนวน"><select aria-label="สาขา"><option>ห้ามเก็บ</option></select>
  <div role="tab">แท็บ 1</div><div role="tab">แท็บ 2</div>
  <p>${'ข้อความยาวมาก '.repeat(10)}</p>`;

test('every fact has the full Task 1 shape with the right types', async () => {
  const facts = await collect(DRIFT_PAGE);
  assert.ok(facts.length >= 20, `facts=${facts.length}`);
  for (const f of facts) {
    assert.deepEqual(Object.keys(f).sort(), [...FIELDS].sort(), JSON.stringify(f));
    assert.equal(f.tag, f.tag.toLowerCase());
    assert.equal(typeof f.key, 'string');
    assert.ok(['heading', 'button', 'badge', 'th', 'nav', 'tab', 'input', 'label', 'paragraph', 'text'].includes(f.kind), f.kind);
    assert.equal(typeof f.text, 'string');
    assert.ok(f.text.length <= 60);
    assert.equal(typeof f.fontFamily, 'string');
    for (const n of ['fontSize', 'fontWeight', 'x', 'y', 'w', 'h', 'lines', 'textTop', 'textHeight', 'inkWidth', 'inkHeight']) {
      assert.ok(typeof f[n] === 'number' && Number.isFinite(f[n]), `${n}=${f[n]} on ${f.key}`);
    }
    assert.ok(f.lineHeight === null || (typeof f.lineHeight === 'number' && Number.isFinite(f.lineHeight)), `lineHeight=${f.lineHeight}`);
    assert.ok(['none', 'x', 'y', 'both'].includes(f.overflowClip));
    for (const b of ['numeric', 'scrollOverflowX', 'scrollOverflowY', 'hasThai', 'numericOnly', 'inReadingBlock']) {
      assert.equal(typeof f[b], 'boolean', `${b} on ${f.key}`);
    }
    assert.ok(Array.isArray(f.iconRatios) && f.iconRatios.every(Number.isFinite));
    assert.ok(f.headingLevel === null || [1, 2, 3, 4, 5, 6].includes(f.headingLevel));
    assert.ok(Number.isInteger(f.lines));
  }
});

test('drift guard: key === rules.mjs factKey and numericOnly === rules.mjs isNumericOnly for every fact', async () => {
  const facts = await collect(DRIFT_PAGE);
  const longFull = 'ข้อความยาวมาก '.repeat(10).trim();
  const seen = new Map();
  for (const f of facts) {
    const full = f.text.length === 60 ? longFull : f.text;
    if (f.text.length === 60) assert.equal(f.text, longFull.slice(0, 60));
    const base = `${f.kind}|${normalizeKeyText(full)}`;
    const dup = seen.get(base) ?? 0;
    seen.set(base, dup + 1);
    assert.equal(f.key, factKey(f.kind, full, dup), `key drift for ${JSON.stringify(full)}`);
    assert.equal(f.numericOnly, isNumericOnly(full), `numericOnly drift for ${JSON.stringify(full)}`);
    assert.equal(f.hasThai, THAI_RE.test(full), `hasThai drift for ${JSON.stringify(full)}`);
  }
  // rules.mjs resolveKeys over key-less copies reproduces the collector's keys exactly
  assert.deepEqual(resolveKeys(facts.map((f) => ({ ...f, key: undefined, text: f.text.length === 60 ? longFull : f.text }))), facts.map((f) => f.key));
  // the spot checks the drift guard must cover
  assert.equal(one(facts, 'ยอด 1,200 บาท').key, 'paragraph|ยอด #,### บาท|0');
  assert.deepEqual(withText(facts, 'บันทึก').map((f) => f.key), ['button|บันทึก|0', 'button|บันทึก|1', 'text|บันทึก|0']);
  assert.equal(one(facts, '฿1,200').numericOnly, true);
  assert.equal(one(facts, 'หน้า หลัก ๑๒๓').key, 'heading|หน้า หลัก ๑๒๓|0');
});

// ---------------------------------------------------------------- Ruling Q: form controls

test('form controls are facts with text = placeholder || aria-label || "" and never the value', async () => {
  const facts = await collect(`
    <input placeholder="ค้นหาลูกค้า" value="นายสมชาย 0812345678">
    <input aria-label="จำนวนชิ้น" value="5">
    <input value="ความลับ">
    <textarea placeholder="หมายเหตุ">ข้อความลับในช่อง</textarea>
    <select aria-label="สาขา"><option>ลาดพร้าวลับ</option></select>
    <input type="hidden" value="h"><input type="checkbox"><input type="radio"><input type="file"><input type="range"><input type="color">`);
  const inputs = facts.filter((f) => f.kind === 'input');
  assert.deepEqual(inputs.map((f) => [f.tag, f.text, f.key]), [
    ['input', 'ค้นหาลูกค้า', 'input|ค้นหาลูกค้า|0'],
    ['input', 'จำนวนชิ้น', 'input|จำนวนชิ้น|0'],
    ['input', '', 'input||0'],
    ['textarea', 'หมายเหตุ', 'input|หมายเหตุ|0'],
    ['select', 'สาขา', 'input|สาขา|0'],
  ]);
  assert.equal(facts.length, 5, 'no other facts (no option text, no textarea content, no excluded input types)');
  const json = JSON.stringify(facts);
  for (const secret of ['สมชาย', '0812345678', 'ความลับ', 'ข้อความลับในช่อง', 'ลาดพร้าวลับ']) assert.ok(!json.includes(secret), secret);
  for (const f of inputs) assert.equal(f.lines, 1);
  assert.equal(one(facts, '').inkWidth, 0);
});

test('form control textTop/textHeight: font box centred in the content box', async () => {
  const facts = await collect(`
    <input placeholder="สมมาตร" style="box-sizing:border-box;height:40px;padding:8px 12px;border:1px solid #000;font-size:16px;line-height:24px">
    <input placeholder="ไม่สมมาตร" style="box-sizing:border-box;height:40px;padding:12px 12px 4px;border:1px solid #000;font-size:16px;line-height:24px">`);
  const sym = one(facts, 'สมมาตร');
  const asym = one(facts, 'ไม่สมมาตร');
  for (const f of [sym, asym]) {
    assert.ok(Number.isFinite(f.textTop) && Number.isFinite(f.textHeight));
    assert.ok(f.textHeight > 16, `textHeight=${f.textHeight}`);
    assert.equal(f.h, 40);
  }
  assert.equal(sym.textHeight, asym.textHeight);
  assert.ok(Math.abs(centreOffset(sym)) < 1e-6, `symmetric offset=${centreOffset(sym)}`);
  assert.ok(Math.abs(centreOffset(asym) - 4) < 1e-6, `asymmetric offset=${centreOffset(asym)}`);
});

test('button[role=combobox] with a value span ⇒ one input fact, no fact for the value span', async () => {
  const facts = await collect(`
    <button role="combobox" aria-label="เลือกสาขา" style="font-size:16px"><span data-slot="select-value">ลาดพร้าว</span><svg width="16" height="16"></svg></button>
    <div data-slot="select-trigger" tabindex="0"><span>ทั้งหมด</span></div>`);
  assert.deepEqual(facts.map((f) => [f.kind, f.tag, f.text]), [['input', 'button', 'เลือกสาขา'], ['input', 'div', '']]);
  assert.deepEqual(one(facts, 'เลือกสาขา').iconRatios, [1]);
});

// ---------------------------------------------------------------- Ruling R: kind anchors + precedence

test('span label inside a nav link ⇒ kind nav with the link box; text metrics from the span', async () => {
  const facts = await collect(`<nav>
    <a href="#s" style="display:flex;align-items:center;gap:8px;height:44px;width:70px">
      <svg width="18" height="18"></svg><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">ตั้งค่าระบบทั้งหมด</span>
    </a></nav>`);
  const f = one(facts, 'ตั้งค่าระบบทั้งหมด');
  assert.equal(f.kind, 'nav');
  assert.equal(f.tag, 'span');
  assert.equal(f.h, 44);
  assert.equal(f.w, 70);
  assert.equal(f.overflowClip, 'both');
  assert.equal(f.scrollOverflowX, true);
  assert.deepEqual(f.iconRatios, [18 / 16]);
  assert.ok(f.textHeight < 44, 'textHeight comes from the span text rects, not the link box');
});

test('precedence: button[role=tab] ⇒ tab, button[role=combobox] ⇒ input, input[type=button] ⇒ input', async () => {
  const facts = await collect(`<button role="tab">ภาพรวม</button>
    <button role="combobox" aria-label="ประเภท">มือถือ</button>
    <input type="button" value="ส่ง" aria-label="ส่งข้อมูล">`);
  assert.equal(one(facts, 'ภาพรวม').kind, 'tab');
  assert.equal(one(facts, 'ประเภท').kind, 'input');
  assert.equal(one(facts, 'ส่งข้อมูล').kind, 'input');
  assert.equal(withText(facts, 'มือถือ').length, 0);
  assert.equal(withText(facts, 'ส่ง').length, 0);
});

test('[role=button] card: two paragraphs stay paragraph, two spans stay text, a lone span takes the card', async () => {
  const facts = await collect(`
    <div role="button"><p>ชื่อสินค้า</p><p>รายละเอียดสินค้า</p></div>
    <div role="button"><span>รายการ</span><span>ยอดรวม</span></div>
    <div role="button" style="box-sizing:border-box;height:60px;padding:8px"><span>การ์ดเดียว</span></div>`);
  assert.equal(one(facts, 'ชื่อสินค้า').kind, 'paragraph');
  assert.equal(one(facts, 'รายละเอียดสินค้า').kind, 'paragraph');
  assert.equal(one(facts, 'รายการ').kind, 'text');
  assert.equal(one(facts, 'ยอดรวม').kind, 'text');
  const lone = one(facts, 'การ์ดเดียว');
  assert.equal(lone.kind, 'button');
  assert.equal(lone.h, 60);
});

test('anchor rejected when the anchor carries its own text; heading/badge/th/label kinds', async () => {
  const facts = await collect(`<button>บันทึก<span>3</span></button>
    <h2><span>หัวข้อรอง</span></h2><h1>หัวเรื่อง</h1>
    <span class="rounded-full" style="font-size:12px">ใหม่</span>
    <span class="rounded-full" style="font-size:14px">ใหญ่</span>
    <div data-slot="badge" style="font-size:14px">ค้างชำระ</div>
    <table><thead><tr><th>ชื่อ</th></tr></thead></table>
    <label>เบอร์โทร</label><div>ทั่วไป</div>`);
  assert.equal(one(facts, 'บันทึก').kind, 'button');
  assert.equal(one(facts, '3').kind, 'text');
  const h2 = one(facts, 'หัวข้อรอง');
  assert.deepEqual([h2.kind, h2.headingLevel, h2.tag], ['heading', 2, 'span']);
  assert.deepEqual([one(facts, 'หัวเรื่อง').kind, one(facts, 'หัวเรื่อง').headingLevel], ['heading', 1]);
  assert.equal(one(facts, 'ใหม่').kind, 'badge');
  assert.equal(one(facts, 'ใหญ่').kind, 'text');
  assert.equal(one(facts, 'ค้างชำระ').kind, 'badge');
  assert.equal(one(facts, 'ชื่อ').kind, 'th');
  assert.equal(one(facts, 'เบอร์โทร').kind, 'label');
  assert.equal(one(facts, 'ทั่วไป').kind, 'text');
  assert.equal(one(facts, 'ทั่วไป').headingLevel, null);
});

test('td tag: a lone text element inside a td reports tag td; shared cells keep their own tag', async () => {
  const facts = await collect(`<table><tbody><tr>
    <td><span>1,234.50</span></td>
    <td><span>1</span> <span>ชิ้น</span></td>
  </tr></tbody></table>`);
  const lone = one(facts, '1,234.50');
  assert.deepEqual([lone.tag, lone.kind, lone.numericOnly], ['td', 'text', true]);
  assert.equal(one(facts, '1').tag, 'span');
  assert.equal(one(facts, 'ชิ้น').tag, 'span');
});

test('icon ratios read direct svg children even though svg is in the exclude list', async () => {
  const facts = await collect('<button style="font-size:16px"><svg width="20" height="20"></svg>เพิ่ม</button>');
  assert.deepEqual(one(facts, 'เพิ่ม').iconRatios, [1.25]);
});

// ---------------------------------------------------------------- Ruling S: overflow clip walk

test('overflowClip: nearest non-visible element per axis decides; auto/scroll stops; html/body ignored', async () => {
  const facts = await collect(`
    <div style="overflow:hidden;width:300px"><p>ถูกตัด</p></div>
    <div style="overflow:hidden"><div style="overflow:auto;height:60px"><p>เลื่อนได้</p></div></div>
    <div style="overflow-x:clip"><p>ตัดแนวนอน</p></div>
    <p>ปกติ</p>`);
  assert.equal(one(facts, 'ถูกตัด').overflowClip, 'both');
  assert.equal(one(facts, 'เลื่อนได้').overflowClip, 'none');
  assert.equal(one(facts, 'ตัดแนวนอน').overflowClip, 'x');
  assert.equal(one(facts, 'ปกติ').overflowClip, 'none');
  const rootClipped = await collect('<p>ราก</p>', { head: '<style>html,body{overflow:hidden}</style>' });
  assert.equal(one(rootClipped, 'ราก').overflowClip, 'none');
});

// ---------------------------------------------------------------- measurement details

test('line-height: normal resolves to a measured px value (Ruling F)', async () => {
  const facts = await collect('<p style="margin:0;line-height:normal;font-size:16px">ปกติ</p>');
  const f = one(facts, 'ปกติ');
  assert.ok(Number.isFinite(f.lineHeight), `lineHeight=${f.lineHeight}`);
  assert.equal(f.lineHeight, f.h, 'a single-line block with no padding is exactly one normal line box tall');
  assert.ok(f.lineHeight > 16);
});

test('lines counts every direct text node (unique tops ±1px)', async () => {
  const facts = await collect('<p>บรรทัดแรก<br>บรรทัดสอง</p><p>ยอด <b>1</b> บาท</p>');
  assert.equal(one(facts, 'บรรทัดแรกบรรทัดสอง').lines, 2);
  assert.equal(one(facts, 'ยอด บาท').lines, 1); // direct text nodes "ยอด " + " บาท", joined with '' then collapsed
});

test('coordinates are page-absolute (scroll offsets added)', async () => {
  const facts = await collect('<div style="height:2000px"></div><p style="margin:0">ล่างสุด</p>', {
    prepare: (page) => page.evaluate(() => window.scrollTo(0, 900)),
  });
  const f = one(facts, 'ล่างสุด');
  assert.equal(f.y, 2000);
  assert.ok(f.textTop >= 2000 && f.textTop < 2000 + f.h);
});

test('visibility: hidden, opacity 0, aria-hidden, [hidden], display:none are skipped', async () => {
  const facts = await collect(`<p style="visibility:hidden">ซ่อน1</p><p style="opacity:0">ซ่อน2</p>
    <div aria-hidden="true"><p>ซ่อน3</p></div><p hidden>ซ่อน4</p><p style="display:none">ซ่อน5</p><p>เห็น</p>`);
  assert.deepEqual(facts.map((f) => f.text), ['เห็น']);
});

test('root option scopes collection (root itself included); missing root throws; empty exclude excludes nothing', async () => {
  const scoped = await collect('<div id="main"><p>ใน</p></div><p>นอก</p>', { options: { root: '#main' } });
  assert.deepEqual(scoped.map((f) => f.text), ['ใน']);
  const self = await collect('<p id="solo">ตัวเอง</p>', { options: { root: '#solo' } });
  assert.deepEqual(self.map((f) => f.text), ['ตัวเอง']);
  await assert.rejects(collect('<p>x</p>', { options: { root: '#missing' } }), /root not found/);
  const all = await collect('<div class="sticker"><p>สติกเกอร์</p></div>', { options: { exclude: '' } });
  assert.deepEqual(all.map((f) => f.text), ['สติกเกอร์']);
});

test('deterministic output and no DOM residue', async () => {
  const page = await openPage(DRIFT_PAGE);
  try {
    const before = await page.evaluate(() => document.body.innerHTML);
    const a = await page.evaluate((exclude) => window.__collectTypography({ exclude }), EXCLUDE);
    const b = await page.evaluate((exclude) => window.__collectTypography({ exclude }), EXCLUDE);
    assert.deepEqual(a, b);
    assert.equal(await page.evaluate(() => document.body.innerHTML), before);
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------- Ruling T: visually hidden (sr-only) text

const SR_ONLY = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border-width:0';
const SR_ONLY_V3 = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0';

test('sr-only label inside an icon button ⇒ no fact; the same text as a normal 1-line label ⇒ a fact', async () => {
  const hidden = await collect(`<button aria-label="x"><svg width="16" height="16"></svg><span class="sr-only-like" style="${SR_ONLY}">ลบรายการนี้</span></button>`);
  assert.deepEqual(hidden, []);
  const shown = await collect('<button aria-label="x"><svg width="16" height="16"></svg><span>ลบรายการนี้</span></button>');
  const f = one(shown, 'ลบรายการนี้');
  assert.equal(f.kind, 'button');
  assert.equal(f.lines, 1);
});

test('visually hidden variants: clip rect(0…) (also on a full-size box), collapsing inset, 1×1 overflow box, hidden ancestor — skipped; near misses kept', async () => {
  const facts = await collect(`
    <span style="${SR_ONLY_V3}">ซ่อนแบบเก่า</span>
    <span style="position:absolute;top:0;left:0;width:200px;height:24px;clip:rect(0,0,0,0)">ซ่อนด้วยคลิปอย่างเดียว</span>
    <span style="display:block;width:200px;clip-path:inset(0 50% 0 50%)">ซ่อนแบบหุบ</span>
    <span style="display:inline-block;width:1px;height:1px;overflow:hidden">ซ่อนกล่องเล็ก</span>
    <span style="${SR_ONLY}"><b>ซ่อนลึก</b></span>
    <span style="display:block;width:200px;clip-path:inset(10%)">ตัดขอบนิดเดียว</span>
    <span style="display:inline-block;width:1px;height:1px">ล้นออกมาเห็น</span>
    <p>มองเห็น</p>`);
  assert.deepEqual(facts.map((f) => f.text), ['ตัดขอบนิดเดียว', 'ล้นออกมาเห็น', 'มองเห็น']);
});

// ---------------------------------------------------------------- Ruling U: value-independent input flags

test('input/textarea scroll flags are always false and typed values never appear', async () => {
  const longValue = 'ข้อความที่พิมพ์ยาวมากเกินความกว้างของช่องนี้หลายเท่าตัว'.repeat(3);
  const manyLines = Array.from({ length: 20 }, (_, i) => `บรรทัดค่าที่พิมพ์ ${i + 1}`).join('\n');
  const page = await openPage(`<input id="i" placeholder="ค้นหา" style="width:80px">
    <textarea id="t" placeholder="หมายเหตุ" rows="2" style="width:200px"></textarea>`);
  try {
    const raw = await page.evaluate(({ v, t }) => {
      const i = document.getElementById('i'); const ta = document.getElementById('t');
      i.value = v; ta.value = t; // typed values (not attributes)
      return { inputScrolls: i.scrollWidth > i.clientWidth + 1, textareaScrolls: ta.scrollHeight > ta.clientHeight + 1 };
    }, { v: longValue, t: manyLines });
    assert.deepEqual(raw, { inputScrolls: true, textareaScrolls: true }, 'fixture must really overflow');
    const facts = await page.evaluate((exclude) => window.__collectTypography({ exclude }), EXCLUDE);
    assert.deepEqual(facts.map((f) => [f.kind, f.text, f.scrollOverflowX, f.scrollOverflowY]),
      [['input', 'ค้นหา', false, false], ['input', 'หมายเหตุ', false, false]]);
    const json = JSON.stringify(facts);
    assert.ok(!json.includes('ข้อความที่พิมพ์') && !json.includes('บรรทัดค่าที่พิมพ์'));
  } finally {
    await page.close();
  }
});
