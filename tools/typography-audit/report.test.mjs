import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { factKey } from './rules.mjs';
import {
  SHELL_MIN_ROUTES,
  summarize,
  renderSummary,
  buildFindingsJson,
  renderContactSheet,
  normalizeRecord,
  loadRun,
  main,
} from './report.mjs';

const NOTO = '"Noto Sans Thai", "Inter", sans-serif';
const LOOPED = '"Noto Sans Thai Looped", sans-serif';
// a fact that triggers no rule at 1440 / web (same defaults as rules.test.mjs)
const fact = (o = {}) => ({
  key: factKey(o.kind ?? 'text', o.text ?? 'ข้อความ', 0),
  tag: 'div',
  kind: 'text',
  text: 'ข้อความ',
  fontSize: 14,
  lineHeight: 22,
  fontWeight: 400,
  fontFamily: NOTO,
  numeric: false,
  x: 0,
  y: 0,
  w: 100,
  h: 22,
  lines: 1,
  textTop: 0,
  textHeight: 22,
  inkWidth: 80,
  inkHeight: 14,
  overflowClip: 'none',
  scrollOverflowX: false,
  scrollOverflowY: false,
  hasThai: false,
  numericOnly: false,
  inReadingBlock: false,
  iconRatios: [],
  headingLevel: null,
  ...o,
});
const rec = (o = {}) => ({
  no: '1',
  route: '/x',
  width: 1440,
  theme: 'light',
  role: 'owner',
  status: 'rendered',
  facts: [],
  ...o,
});
const run = (phase, records, o = {}) => ({
  label: `admin-${phase}-owner`,
  app: 'web',
  phase,
  role: 'owner',
  present: true,
  records,
  ...o,
});
const pair = (beforeRecords, afterRecords, o = {}) => [
  run('before', beforeRecords, o),
  run('after', afterRecords, o),
];
// "## title" sections of the markdown → [{ title, body }]
const sections = (md) =>
  md
    .split(/^## /m)
    .slice(1)
    .map((s) => ({ title: s.split('\n')[0], body: s }));
const section = (md, re) => sections(md).find((s) => re.test(s.title));
const tmpDirs = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typo-report-'));
  tmpDirs.push(dir);
  return dir;
};
after(() => tmpDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

test('summarize counts non-rendered separately', () => {
  const statuses = [
    rec({ no: '1', route: '/a' }),
    rec({ no: '2', route: '/b', status: 'error', error: 'boom' }),
    rec({ no: 'T1', route: '/r/:token', status: 'document' }),
    rec({ no: '4', route: '/d', status: 'redirected', finalPath: '/' }),
    rec({ no: '5', route: '/e', status: 'empty' }),
  ];
  const shopBlocked = {
    app: 'shop',
    route: '/account',
    width: 390,
    theme: 'light',
    role: 'customer',
    status: 'blocked',
    reason: 'no auth fixture',
    facts: [],
  };
  const s = summarize([
    ...pair(statuses, statuses),
    { label: 'shop-before', app: 'shop', phase: 'before', present: true, records: [shopBlocked] },
    { label: 'shop-after', app: 'shop', phase: 'after', present: true, records: [shopBlocked] },
  ]);
  assert.equal(s.totals.measured.after, 1, 'only rendered counts as measured');
  assert.equal(s.totals.measured.before, 1);
  assert.equal(s.totals.records.web.after.owner.rendered, 1);
  assert.equal(s.totals.records.web.after.owner.error, 1);
  assert.equal(s.totals.records.web.after.owner.document, 1);
  assert.equal(s.totals.records.shop.after.customer.blocked, 1);
  assert.equal(s.totals.pairsCompared, 1);
  assert.deepEqual(s.uncovered.documentRoutes, ['/r/:token']);
  assert.ok(
    s.uncovered.roles.includes('FINANCE_MANAGER') && s.uncovered.roles.includes('ACCOUNTANT'),
  );
  assert.deepEqual(
    s.uncovered.blocked.map((b) => [b.route, b.reason]),
    [
      ['/account', 'no auth fixture'],
      ['/account', 'no auth fixture'],
    ],
  );
  const byRoute = Object.fromEntries(s.routes.map((r) => [r.route, r.status]));
  assert.deepEqual(byRoute, {
    '/a': 'rendered',
    '/b': 'error',
    '/r/:token': 'document',
    '/d': 'redirected',
    '/e': 'empty',
    '/account': 'blocked',
  });
  const md = renderSummary(s);
  const gap = section(md, /ตรวจไม่ได้\/ไม่วัด/);
  assert.ok(gap, 'section ตรวจไม่ได้/ไม่วัด exists');
  for (const needle of [
    '/b',
    'boom',
    '/account',
    'no auth fixture',
    '/r/:token',
    'FINANCE_MANAGER',
  ])
    assert.ok(gap.body.includes(needle), needle);
});

test('summary lists added P1 first', () => {
  const before = [
    fact({ kind: 'text', text: 'DDD-D1', inkWidth: 100 }),
    // R1 P3 on both sides → persisting
    fact({ kind: 'text', text: 'EEE-OLD', fontSize: 15, lineHeight: 24 }),
  ];
  const after = [
    fact({ kind: 'button', text: 'CCC-P3', h: 40, fontSize: 15, lineHeight: 24 }), // R1 P3 new
    fact({ kind: 'button', text: 'BBB-P2', h: 30 }), // R7 P2 new
    fact({ kind: 'button', text: 'AAA-P1', h: 40, lines: 2 }), // R5 P1 new
    fact({ kind: 'text', text: 'DDD-D1', inkWidth: 120 }), // D1 only
    fact({ kind: 'text', text: 'EEE-OLD', fontSize: 15, lineHeight: 24 }),
  ];
  const s = summarize(pair([rec({ facts: before })], [rec({ facts: after })]));
  assert.equal(s.totals.new.P1.findings, 1);
  assert.equal(s.totals.new.P2.findings, 1);
  assert.equal(s.totals.new.P3.findings, 1);
  assert.equal(s.totals.deltas.D1.findings, 1);
  assert.equal(s.totals.persisting.findings, 1);
  const md = renderSummary(s);
  const order = ['AAA-P1', 'BBB-P2', 'CCC-P3', 'DDD-D1', 'EEE-OLD'];
  const at = order.map((t) => md.indexOf(t));
  assert.ok(
    at.every((i) => i >= 0),
    JSON.stringify(at),
  );
  assert.deepEqual(
    [...at].sort((x, y) => x - y),
    at,
    `section order ${JSON.stringify(at)}`,
  );
  const top = section(md, /30 จุด/);
  assert.ok(top, 'top-30 section exists');
  const topAt = order.map((t) => top.body.indexOf(t));
  assert.ok(
    topAt.every((i) => i >= 0),
    JSON.stringify(topAt),
  );
  assert.deepEqual(
    [...topAt].sort((x, y) => x - y),
    topAt,
    `top-30 order ${JSON.stringify(topAt)}`,
  );
  assert.equal(s.top30[0].rule, 'R5');
});

test('R8 never appears in diff sections', () => {
  const before = [fact({ text: 'ฟอนต์เดิม', fontFamily: LOOPED })];
  const after = [
    fact({ text: 'ฟอนต์เดิม', fontFamily: LOOPED }),
    fact({ text: 'ใหม่ R1', fontSize: 15, lineHeight: 24 }),
  ];
  const s = summarize(pair([rec({ facts: before })], [rec({ facts: after })]));
  for (const list of [s.added, s.escalated, s.persisting, s.resolved])
    assert.ok(!list.some((f) => f.rule === 'R8'));
  assert.ok(!s.top30.some((f) => f.rule === 'R8'));
  assert.equal(s.totals.afterOnlyR8.findings, 1);
  assert.equal(s.totals.new.P3.findings, 1);
  const md = renderSummary(s);
  const [head] = md.split(/^## /m);
  assert.ok(!/\bR8\b/.test(head), 'header has no R8');
  const all = sections(md);
  const r8 = all.filter((x) => /AFTER เท่านั้น/.test(x.title));
  assert.equal(r8.length, 1);
  assert.ok(/\bR8\b/.test(r8[0].body) && r8[0].body.includes('ฟอนต์เดิม'));
  for (const x of all.filter((y) => !/AFTER เท่านั้น/.test(y.title)))
    assert.ok(!/\bR8\b/.test(x.body), `R8 leaked into "${x.title}"`);
});

test('shell grouping counts a finding repeated on many routes once', () => {
  const routes = (n, prefix) => Array.from({ length: n }, (_, i) => `/${prefix}${i}`);
  const mk = (route, i, text) =>
    rec({
      no: `${text}-${i}`,
      route,
      facts: [fact({ kind: 'nav', text, fontSize: 15, lineHeight: 24 })],
    });
  const wide = routes(6, 'w'),
    narrow = routes(4, 'n');
  const after = [
    ...wide.map((r, i) => mk(r, i, 'เมนูร่วม')),
    ...narrow.map((r, i) => mk(r, i, 'เมนูน้อย')),
  ];
  const before = after.map((r) => ({ ...r, facts: [] }));
  const s = summarize(pair(before, after));
  assert.ok(SHELL_MIN_ROUTES >= 2 && SHELL_MIN_ROUTES <= 6, `threshold ${SHELL_MIN_ROUTES}`);
  assert.equal(s.totals.new.P3.findings, 10);
  assert.equal(s.totals.new.P3.points, 1 + 4, 'shell counted once, narrow repeats individually');
  const shell = s.groups.new.P3.filter((g) => g.shell);
  assert.equal(shell.length, 1);
  assert.equal(shell[0].routeCount, 6);
  assert.equal(shell[0].text, 'เมนูร่วม');
  const md = renderSummary(s);
  assert.ok(md.includes('6 หน้า'), 'shell row shows its route count');
  const json = buildFindingsJson(s);
  const shellJson = json.added.filter((g) => g.shell);
  assert.equal(shellJson.length, 1);
  assert.equal(shellJson[0].routeCount, 6);
});

test('escalated findings are listed with added under เกิดจากฟอนต์ใหม่', () => {
  const thai = (lineHeight) =>
    fact({ text: 'ข้อความไทย', hasThai: true, fontSize: 14, lineHeight });
  // before ratio 1.3 → R3 P2 (Thai ≥ 1.2, outside 1.35–1.8)
  // after 1.1 → R3 P1 (Thai < 1.2); same key
  const s = summarize(pair([rec({ facts: [thai(18.2)] })], [rec({ facts: [thai(15.4)] })]));
  assert.equal(s.totals.escalated.findings, 1);
  assert.equal(s.totals.new.P1.findings, 1, 'escalated counts toward new P1');
  assert.equal(s.totals.persisting.findings, 0, 'escalated is not counted again as persisting');
  assert.equal(s.top30[0].escalatedFrom, 'P2');
  const md = renderSummary(s);
  const fresh = section(md, /เกิดจากฟอนต์ใหม่/);
  assert.ok(fresh.body.includes('ข้อความไทย') && fresh.body.includes('P2 → P1'));
  const json = buildFindingsJson(s);
  assert.equal(json.escalated.length, 1);
  assert.equal(json.escalated[0].beforeSeverity, 'P2');
});

test('shop and admin field-name variants are both read', () => {
  const shop = normalizeRecord(
    {
      app: 'shop',
      route: '/account/x',
      width: 390,
      role: 'customer',
      status: 'redirected',
      redirectedTo: '/account',
      facts: [],
    },
    { phase: 'after' },
  );
  assert.equal(shop.app, 'shop');
  assert.equal(shop.theme, 'light', 'shop JSON without theme defaults to light');
  assert.equal(shop.finalPath, '/account');
  const shopBlocked = normalizeRecord(
    {
      app: 'shop',
      route: '/y',
      width: 390,
      theme: 'light',
      role: 'guest',
      status: 'blocked',
      reason: 'no fixture',
    },
    { phase: 'after' },
  );
  assert.equal(shopBlocked.error, 'no fixture');
  const admin = normalizeRecord(
    {
      no: '7',
      route: '/z',
      width: 1440,
      theme: 'dark',
      role: 'salesA',
      status: 'redirected',
      finalPath: '/?zone=shop',
      facts: [],
    },
    { app: 'web', phase: 'after' },
  );
  assert.equal(admin.app, 'web');
  assert.equal(admin.finalPath, '/?zone=shop');
  const adminErr = normalizeRecord(
    {
      no: '8',
      route: '/z',
      width: 1440,
      theme: 'dark',
      role: 'owner',
      status: 'error',
      error: 'boom',
    },
    { app: 'web', phase: 'after' },
  );
  assert.equal(adminErr.error, 'boom');

  const root = tmpDir();
  const adminDir = path.join(root, 'admin-after-owner');
  fs.mkdirSync(path.join(adminDir, 'typography'), { recursive: true });
  fs.mkdirSync(path.join(adminDir, 'uxui-pages'), { recursive: true });
  fs.writeFileSync(
    path.join(adminDir, 'typography', 'route-7-1440-dark-owner.json'),
    JSON.stringify({
      no: '7',
      route: '/z',
      width: 1440,
      theme: 'dark',
      role: 'owner',
      status: 'rendered',
      facts: [fact()],
      target: '/z',
      finalPath: '/z',
    }),
  );
  fs.writeFileSync(path.join(adminDir, 'uxui-pages', 'route-7-1440-dark.png'), '');
  const shopDir = path.join(root, 'shop-after');
  fs.mkdirSync(path.join(shopDir, 'shop'), { recursive: true });
  fs.writeFileSync(
    path.join(shopDir, 'shop', 'route-about-390.json'),
    JSON.stringify({
      app: 'shop',
      route: '/about',
      width: 390,
      theme: 'light',
      role: 'guest',
      status: 'rendered',
      facts: [fact()],
      screenshot: 'route-about-390.png',
    }),
  );
  fs.writeFileSync(path.join(shopDir, 'shop', 'unmatched.json'), JSON.stringify({ entries: [] }));
  fs.writeFileSync(path.join(shopDir, 'shop', 'route-about-390.png'), '');

  const a = loadRun(adminDir, {
    label: 'admin-after-owner',
    app: 'web',
    phase: 'after',
    role: 'owner',
  });
  assert.equal(a.present, true);
  assert.equal(a.records.length, 1);
  assert.equal(a.records[0].screenshot, path.join(adminDir, 'uxui-pages', 'route-7-1440-dark.png'));
  assert.equal(a.records[0].readFacts().length, 1);
  const sh = loadRun(shopDir, { label: 'shop-after', app: 'shop', phase: 'after' });
  assert.equal(sh.records.length, 1, 'unmatched.json is not a route file');
  assert.equal(sh.skipped, 1);
  assert.equal(sh.records[0].screenshot, path.join(shopDir, 'shop', 'route-about-390.png'));
  const gone = loadRun(path.join(root, 'nope'), {
    label: 'admin-before-sales',
    app: 'web',
    phase: 'before',
    role: 'salesA',
  });
  assert.equal(gone.present, false);
  assert.deepEqual(gone.records, []);
});

test('a pair with one side non-rendered goes to ตรวจไม่ได้/ไม่วัด with both statuses', () => {
  const s = summarize(
    pair(
      [rec({ route: '/p', facts: [fact({ fontSize: 15, lineHeight: 24 })] })],
      [rec({ route: '/p', status: 'error', error: 'page crashed', facts: [] })],
    ),
  );
  assert.equal(s.totals.pairsCompared, 0);
  assert.equal(
    s.added.length + s.resolved.length + s.persisting.length,
    0,
    'no diff for a non-rendered pair',
  );
  assert.equal(s.uncovered.unpaired.length, 1);
  assert.deepEqual(
    (({ route, before, after, reason }) => ({ route, before, after, reason }))(
      s.uncovered.unpaired[0],
    ),
    { route: '/p', before: 'rendered', after: 'error', reason: 'page crashed' },
  );
  const md = renderSummary(s);
  const gap = section(md, /ตรวจไม่ได้\/ไม่วัด/);
  assert.ok(
    gap.body.includes('/p') &&
      gap.body.includes('วัดได้ → ผิดพลาด') &&
      gap.body.includes('page crashed'),
  );
});

test('findings.json stores persisting as counts with at most 5 examples', () => {
  const offs = Array.from({ length: 7 }, (_, i) =>
    fact({ text: `ข้อความ ${'ก'.repeat(i + 1)}`, fontSize: 15, lineHeight: 24 }),
  );
  const fresh = fact({ kind: 'button', text: 'ปุ่มใหม่', h: 30 });
  const s = summarize(pair([rec({ facts: offs })], [rec({ facts: [...offs, fresh] })]));
  const json = buildFindingsJson(s);
  assert.equal(json.persisting.length, 1);
  const [p] = json.persisting;
  assert.equal(p.rule, 'R1');
  assert.equal(p.count, 7);
  assert.equal(p.examples.length, 5);
  assert.equal(p.detail, undefined, 'no per-finding detail for persisting');
  assert.equal(json.added.length, 1);
  assert.equal(json.added[0].detail.h, 30, 'added keeps full detail');
  assert.equal(json.totals.persisting.findings, 7);
});

test('/liff/debug deltas are known noise; LIFF rows from both role runs count once', () => {
  const liff = (role, inkWidth) =>
    rec({ no: '28', route: '/liff/debug', role, facts: [fact({ text: 'port', inkWidth })] });
  const contract = (role) =>
    rec({
      no: '18',
      route: '/liff/contract',
      role,
      facts: [fact({ fontSize: 15, lineHeight: 24 })],
    });
  const s = summarize([
    run('before', [liff('owner', 100), contract('owner')]),
    run('after', [liff('owner', 130), contract('owner')]),
    run('before', [liff('salesA', 100), contract('salesA')], {
      label: 'admin-before-sales',
      role: 'salesA',
    }),
    run('after', [liff('salesA', 130), contract('salesA')], {
      label: 'admin-after-sales',
      role: 'salesA',
    }),
  ]);
  assert.equal(s.totals.deltas.D1.findings, 0);
  assert.equal(s.totals.deltas.noiseExcluded, 1);
  assert.equal(s.totals.pairsCompared, 2, 'one pair per LIFF route, not one per role');
  assert.equal(s.totals.sharedDuplicates, 4);
  assert.equal(s.totals.persisting.findings, 1);
  assert.ok(s.routes.every((r) => r.role === 'liff'));
  assert.ok(renderSummary(s).includes('/liff/debug'));
});

test('a missing run folder is reported, not fatal', () => {
  const s = summarize([
    run('before', [rec()]),
    run('after', [rec()]),
    {
      label: 'admin-before-sales',
      app: 'web',
      phase: 'before',
      role: 'salesA',
      present: false,
      dir: '/nope',
      records: [],
    },
    run('after', [rec({ role: 'salesA' })], { label: 'admin-after-sales', role: 'salesA' }),
  ]);
  assert.deepEqual(
    s.uncovered.missingRuns.map((r) => r.label),
    ['admin-before-sales'],
  );
  assert.equal(s.uncovered.unpaired.length, 1);
  assert.equal(s.uncovered.unpaired[0].before, 'missing-run');
  const gap = section(renderSummary(s), /ตรวจไม่ได้\/ไม่วัด/);
  assert.ok(gap.body.includes('admin-before-sales'));
});

test('contact sheet pairs BEFORE|AFTER images for new P1/P2 or D1/D2, both themes', () => {
  const shot = (phase, theme) => `/tmp/typo/${phase}/route-1-1440-${theme}.png`;
  const mk = (phase, theme, facts) => rec({ theme, facts, screenshot: shot(phase, theme) });
  const bad = [fact({ kind: 'button', text: 'ปุ่มยาว', h: 40, lines: 2 })];
  const s = summarize(
    pair(
      [mk('before', 'light', []), mk('before', 'dark', [])],
      [mk('after', 'light', bad), mk('after', 'dark', [])],
    ),
  );
  const html = renderContactSheet(s, { sheetDir: '/tmp/typo' });
  for (const theme of ['light', 'dark']) {
    assert.ok(html.includes(`before/route-1-1440-${theme}.png`), `before ${theme}`);
    assert.ok(html.includes(`after/route-1-1440-${theme}.png`), `after ${theme}`);
  }
  assert.ok(!html.includes('/tmp/typo/after'), 'image paths are relative to the sheet');
  assert.ok(html.includes('ปุ่มยาว'));
});

test('run-specific seed tokens do not split a finding into added + resolved', () => {
  const off = (text) => fact({ text, fontSize: 15, lineHeight: 24 }); // R1 P3 on both sides
  const before = [
    off('ทดสอบระบบ DOCS-CA4ABCDD สาขา A'),
    off('docs-ca4abcdd.sales-a@example.invalid'),
    off('b98a5e4a...'),
    off('ทดสอบระบบ ลูกค้าเอกสารยาวมาก ๆ ๆ DOCS-1A2B3C4D'),
  ];
  const after = [
    off('ทดสอบระบบ DOCS-72C22C15 สาขา A'),
    off('docs-72c22c15.sales-a@example.invalid'),
    off('0f3c9d21...'),
    off('ทดสอบระบบ ลูกค้าเอกสารยาวมาก ๆ ๆ DOCS-ABCDEF12'),
  ];
  const s = summarize(pair([rec({ facts: before })], [rec({ facts: after })]));
  assert.equal(s.totals.new.P3.findings, 0);
  assert.equal(s.totals.resolved.findings, 0);
  assert.equal(s.totals.persisting.findings, 4);
  assert.ok(
    s.persisting.some((f) => f.text.includes('DOCS-72C22C15')),
    'raw AFTER text is kept for display',
  );
});

test('summary names screenshots relative to the audit folder, never a local absolute path', () => {
  const shot = (phase) =>
    `/Users/someone/repo/.tmp/typo-audit/admin-${phase}-owner/uxui-pages/route-1-1440-light.png`;
  const s = summarize(
    pair(
      [rec({ screenshot: shot('before') })],
      [
        rec({
          screenshot: shot('after'),
          facts: [fact({ kind: 'button', text: 'ปุ่ม', h: 40, lines: 2 })],
        }),
      ],
    ),
  );
  const md = renderSummary(s);
  assert.ok(md.includes('admin-after-owner/uxui-pages/route-1-1440-light.png'));
  assert.ok(!md.includes('/Users/someone') && !md.includes('../'), 'no absolute or escaping path');
  const json = JSON.stringify(buildFindingsJson(s));
  assert.ok(!json.includes('/Users/someone') && !json.includes('../'));
});

test('findings on run-varying pages are annotated and counted, not dropped', () => {
  const td = (text) => fact({ tag: 'td', text, numericOnly: true });
  const s = summarize(
    pair(
      [rec({ route: '/audit-logs', facts: [td('9')] })],
      [rec({ route: '/audit-logs', facts: [td('12')] })],
    ),
  );
  assert.equal(s.totals.new.P3.findings, 1, 'still counted');
  assert.equal(s.totals.new.runVarying, 1);
  assert.equal(s.totals.resolved.runVarying, 1);
  const fresh = section(renderSummary(s), /เกิดจากฟอนต์ใหม่/);
  assert.ok(fresh.body.includes('`/audit-logs` ※') && fresh.body.includes('ข้อมูลเปลี่ยนทุกรอบ'));
  // in the top 30 such points rank after every other tier (they are annotated noise)
  const old = rec({
    no: '2',
    route: '/y',
    facts: [fact({ text: 'เดิม', fontSize: 15, lineHeight: 24 })],
  });
  const s2 = summarize(
    pair(
      [rec({ route: '/audit-logs', facts: [td('9')] }), old],
      [rec({ route: '/audit-logs', facts: [td('12')] }), old],
    ),
  );
  assert.deepEqual(
    s2.top30.map((p) => [p.tier, p.route]),
    [
      ['persisting', '/y'],
      ['run-varying', '/audit-logs'],
    ],
  );
});

test('top 30 alternates D1 and D2 so one systematic shift cannot crowd out the other', () => {
  const btn = (text, textTop) =>
    fact({ kind: 'button', text, y: 0, h: 40, textTop, textHeight: 18 });
  const before = [btn('ก', 11), btn('ข', 11), btn('ค', 11), fact({ text: 'กว้าง', inkWidth: 100 })];
  const after = [btn('ก', 8), btn('ข', 8), btn('ค', 8), fact({ text: 'กว้าง', inkWidth: 130 })];
  const s = summarize(pair([rec({ facts: before })], [rec({ facts: after })]));
  assert.deepEqual(
    s.top30
      .map((p) => p.rule)
      .slice(0, 2)
      .sort(),
    ['D1', 'D2'],
  );
});

test('D1/D2 totals state the direction and median of the change', () => {
  const btn = (text, textTop) =>
    fact({ kind: 'button', text, y: 0, h: 40, textTop, textHeight: 18 }); // offset = textTop - 11
  const s = summarize(
    pair(
      [
        rec({
          facts: [
            btn('ปุ่มหนึ่ง', 11),
            btn('ปุ่มสอง', 11),
            fact({ text: 'กว้างขึ้น', inkWidth: 100 }),
          ],
        }),
      ],
      [
        rec({
          facts: [
            btn('ปุ่มหนึ่ง', 9),
            btn('ปุ่มสอง', 8),
            fact({ text: 'กว้างขึ้น', inkWidth: 120 }),
          ],
        }),
      ],
    ),
  );
  assert.deepEqual(
    (({ findings, aboveCentre, belowCentre, medianAfterOffsetPx, medianShiftPx }) => ({
      findings,
      aboveCentre,
      belowCentre,
      medianAfterOffsetPx,
      medianShiftPx,
    }))(s.totals.deltas.D2),
    { findings: 2, aboveCentre: 2, belowCentre: 0, medianAfterOffsetPx: -2.5, medianShiftPx: -2.5 },
  );
  assert.deepEqual(
    (({ findings, wider, narrower, medianChangePct }) => ({
      findings,
      wider,
      narrower,
      medianChangePct,
    }))(s.totals.deltas.D1),
    { findings: 1, wider: 1, narrower: 0, medianChangePct: 20 },
  );
  assert.equal(s.deltas.D2[0].kind, 'button', 'delta findings keep their kind');
  const d = section(renderSummary(s), /ควรดูด้วยตา/);
  assert.ok(
    d.body.includes('สูงกว่ากึ่งกลาง 2') && d.body.includes('-2.5px'),
    'D2 direction in plain words',
  );
});

test('R3/R7 thresholds follow the house style — the split counts real findings only', () => {
  const both = (facts, o = {}) => [rec({ facts, ...o }), rec({ facts, ...o })];
  const snug = fact({ text: 'ระยะ snug', fontSize: 14, lineHeight: 19.25 }); // ×1.375 → passes R3
  const tight = fact({ text: 'ตัวเลขชิด', fontSize: 14, lineHeight: 14 }); // ×1.0 → real P2
  const thai = fact({ text: 'ไทยชิดมาก', hasThai: true, fontSize: 14, lineHeight: 15.4 }); // P1
  const btn32 = fact({ kind: 'button', text: 'ปุ่ม 32', h: 32 }); // desktop 32 → passes R7
  const btn31 = fact({ kind: 'button', text: 'ปุ่มเกือบ', h: 31.9 }); // desktop < 32 → real
  const btn24 = fact({ kind: 'button', text: 'ปุ่มเตี้ย', h: 24 }); // desktop < 32 → real
  const mob = fact({ kind: 'button', text: 'ปุ่มมือถือ', h: 40 }); // 390 < 44 → real
  const [b1, a1] = both([snug, tight, thai, btn32, btn31, btn24]);
  const [b2, a2] = both([mob], { no: '2', width: 390 });
  const s = summarize(pair([b1, b2], [a1, a2]));
  const hs = s.totals.houseStyle;
  assert.deepEqual(
    [hs.R3.realP2, hs.R3.realP1, hs.R7.realMobileBelow44, hs.R7.realDesktopBelow32],
    [1, 1, 1, 2],
  );
  // nothing is subtracted as house style: the split adds up to every R3/R7 finding
  const byRule = s.totals.persisting.byRule;
  assert.equal(byRule.R3.findings, hs.R3.realP2 + hs.R3.realP1);
  assert.equal(byRule.R7.findings, hs.R7.realMobileBelow44 + hs.R7.realDesktopBelow32);
  assert.equal(byRule.R3.houseStyle, undefined);
  assert.equal(byRule.R7.houseStyle, undefined);
  assert.equal(hs.R3.houseStyle, undefined, 'no house-style exemption count');
  assert.equal(hs.R7.houseStyle, undefined, 'no house-style exemption count');
  assert.match(hs.decision, /owner 2026-11-08/);
  assert.deepEqual(hs.thresholds, {
    R3SmallMaxFontPx: 20,
    R3SmallRange: [1.35, 1.8],
    R3LargeRange: [1.2, 1.6],
    R3ThaiMin: 1.2,
    R7DesktopFromWidthPx: 768,
    R7DesktopMinPx: 32,
    R7MobileToWidthPx: 430,
    R7MobileMinPx: 44,
  });
  const json = buildFindingsJson(s);
  assert.deepEqual(json.totals.houseStyle, hs);
  assert.match(json.notes.houseStyle, /2026-11-08/);
  assert.doesNotMatch(json.notes.houseStyle, /owner decides on/);
  const md = renderSummary(s);
  const pre = section(md, /มีอยู่ก่อนแล้ว/).body;
  for (const text of ['ตัวเลขชิด', 'ไทยชิดมาก', 'ปุ่มเกือบ', 'ปุ่มเตี้ย', 'ปุ่มมือถือ'])
    assert.ok(pre.includes(text), `real finding example ${text}`);
  for (const text of ['ระยะ snug', 'ปุ่ม 32']) assert.ok(!md.includes(text), `${text} passes now`);
  assert.ok(pre.includes('เจ้าของตัดสิน 2026-11-08'), 'the section states the owner decision');
  assert.ok(pre.includes('×1.35') && pre.includes('×1.375') && pre.includes('32px'));
  assert.ok(!md.includes('ให้เจ้าของตัดสิน'), 'nothing left for the owner to decide');
  assert.ok(!md.includes('ตามแบบบ้าน '), 'no house-style count or column');
  assert.ok(!md.includes('ในนี้ตามแบบบ้าน'), 'per-rule table has no house-style column');
  assert.ok(section(md, /สรุปสั้น/).body.includes('เจ้าของตัดสิน 2026-11-08'));
});

test('persisting in one inventory row and added/resolved in another counts once', () => {
  const off = fact({ text: 'ซ้ำสองแถว', fontSize: 15, lineHeight: 24 });
  const gone = fact({ text: 'หายในแถวสอง', fontSize: 15, lineHeight: 24 });
  const s = summarize(
    pair(
      [
        rec({ no: '1', route: '/dup', facts: [off, gone] }),
        rec({ no: '2', route: '/dup', facts: [gone] }),
      ],
      [
        rec({ no: '1', route: '/dup', facts: [off, gone] }),
        rec({ no: '2', route: '/dup', facts: [off] }),
      ],
    ),
  );
  assert.equal(s.totals.persisting.findings, 2);
  assert.equal(s.totals.new.P3.findings, 0, 'added in row 2 but persisting in row 1');
  assert.equal(s.totals.resolved.findings, 0, 'resolved in row 2 but persisting in row 1');
  assert.deepEqual(s.totals.crossRowPrecedence, { added: 1, resolved: 1, persisting: 0 });
});

test('top 30 keeps room for pre-existing P1 groups of every rule', () => {
  const btn = (i) =>
    fact({
      kind: 'button',
      text: `ปุ่ม ${'ก'.repeat(i + 1)}`,
      y: 0,
      h: 40,
      textTop: 11,
      textHeight: 18,
    });
  const moved = (i) => ({ ...btn(i), textTop: 8 });
  const p1 = [
    fact({ text: 'ไทยชิด', hasThai: true, fontSize: 14, lineHeight: 15.4 }), // R3 P1
    fact({ text: 'ตัดสระ', hasThai: true, overflowClip: 'y', scrollOverflowY: true }), // R4 P1
    fact({ kind: 'tab', text: 'แท็บยาว', lines: 2 }), // R5 P1 at 1440
  ];
  const before = [...Array.from({ length: 40 }, (_, i) => btn(i)), ...p1];
  const after = [...Array.from({ length: 40 }, (_, i) => moved(i)), ...p1];
  const s = summarize(pair([rec({ facts: before })], [rec({ facts: after })]));
  assert.equal(s.top30.length, 30);
  const pre = s.top30.filter((p) => p.tier === 'persisting-p1');
  assert.deepEqual(pre.map((p) => p.rule).sort(), ['R3', 'R4', 'R5']);
  const firstPre = s.top30.findIndex((p) => p.tier === 'persisting-p1');
  assert.ok(
    s.top30.slice(0, firstPre).every((p) => p.tier === 'delta'),
    'font-caused points come first',
  );
});

test('header revisions come from the sources; unknown statuses get a column', () => {
  const s = summarize([
    run('before', [rec(), rec({ no: '9', route: '/odd', status: 'weird' })], {
      revision: 'abc1234def0',
    }),
    run('after', [rec(), rec({ no: '9', route: '/odd', status: 'weird' })], {
      revision: 'fff0000aaa1',
    }),
  ]);
  const md = renderSummary(s);
  const [head] = md.split(/^## /m);
  assert.ok(head.includes('abc1234de') && head.includes('fff0000aa'), 'revisions in the header');
  assert.ok(!head.includes('70eb82556') && !head.includes('1776'), 'nothing hard-coded');
  assert.equal(s.totals.records.web.after.owner.unknown, 1);
  const cov = section(md, /จำนวนที่วัด/).body;
  assert.ok(cov.includes('ไม่ทราบสถานะ'), 'unknown column present');
  assert.ok(/\| หลัง \| owner \| 1 \|( 0 \|){5} 1 \| 2 \|/.test(cov), 'row adds up incl. unknown');
});

test('CLI writes summary, findings and contact sheet; a missing folder is reported', () => {
  const root = tmpDir();
  const adminRun = (name, facts) => {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, 'typography'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'typography', 'route-1-1440-light-owner.json'),
      JSON.stringify(rec({ facts })),
    );
    return dir;
  };
  const out = path.join(root, 'out');
  const sheet = path.join(root, 'contact-sheet.html');
  const result = main(
    [
      '--admin-before-owner',
      adminRun('admin-before-owner', [fact()]),
      '--admin-after-owner',
      adminRun('admin-after-owner', [fact({ kind: 'button', text: 'ปุ่ม', h: 40, lines: 2 })]),
      '--admin-before-sales',
      path.join(root, 'admin-before-salesA'),
      '--revision',
      'admin-after-owner=deadbeef1',
      '--revision',
      'shop-after=1f67675fd',
      '--out',
      out,
      '--sheet',
      sheet,
    ],
    { log: () => {} },
  );
  for (const f of [path.join(out, 'summary.md'), path.join(out, 'findings.json'), sheet])
    assert.ok(fs.existsSync(f), f);
  const json = JSON.parse(fs.readFileSync(path.join(out, 'findings.json'), 'utf8'));
  assert.equal(json.totals.new.P1.findings, 1);
  const missing = json.uncovered.missingRuns.map((r) => r.label).sort();
  assert.deepEqual(missing, [
    'admin-after-sales',
    'admin-before-sales',
    'shop-after',
    'shop-before',
  ]);
  assert.ok(fs.readFileSync(path.join(out, 'summary.md'), 'utf8').includes('admin-before-sales'));
  assert.equal(result.summary.totals.pairsCompared, 1);
  const src = Object.fromEntries(json.sources.map((x) => [x.label, x]));
  assert.equal(src['admin-after-owner'].revision, 'deadbeef1');
  assert.equal(src['admin-after-owner'].revisionSource, 'cli');
  assert.equal(
    src['shop-after'].revision,
    '1f67675fd',
    'a missing run still records the given revision',
  );
});
