import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  UsageError,
  applyAllow,
  compareRuns,
  findingId,
  formatCompare,
  menuFinding,
  parseAllow,
  parseArgs,
  renderReport,
  screenProblem,
  selectRoutes,
  summarize,
} from './lib.mjs';
import { ACCOUNT_CODE_RE, coaByCodes, coaGrouped, coaList, loadCoa, parseCsvLine } from './coa.mjs';
import { menuClipVerdict } from './menu-clip.mjs';
import { ADDRESS_FORM_HOSTS, COMMON_MOCKS, ROUTES } from './routes.mjs';

const cell = (route, width, theme, findings, status = 'rendered', extra = {}) => ({
  route, width, theme, status, findings, probes: [], apiErrors: [], ...extra,
});
const f = (route, width, theme, rule, severity, key) => ({ route, width, theme, rule, severity, key, detail: {} });

test('parseArgs: defaults', () => {
  assert.deepEqual(parseArgs(['--label', 'baseline']), {
    mode: 'run', label: 'baseline', routes: null, widths: [1440, 1024, 390], themes: ['light', 'dark'],
  });
});

test('parseArgs: options, de-duplicated', () => {
  assert.deepEqual(
    parseArgs(['--label', 'r1-2', '--routes', 'a,b,a', '--widths', '390,1440,390', '--themes', 'dark']),
    { mode: 'run', label: 'r1-2', routes: ['a', 'b'], widths: [390, 1440], themes: ['dark'] },
  );
});

test('parseArgs: rejects bad input with a UsageError', () => {
  for (const argv of [
    [], ['--label'], ['--label', 'a/b'], ['--label', 'x', '--widths', '100'], ['--label', 'x', '--widths', '14.5'],
    ['--label', 'x', '--themes', 'sepia'], ['--label', 'x', '--routes'], ['--label', 'x', '--routes', '--widths'],
    ['--label', 'x', '--bogus', '1'], ['--compare', 'a'], ['--compare', 'a', 'b', '--widths', '390'],
    ['--label', 'x', '--compare', 'a', 'b'],
  ]) {
    assert.throws(() => parseArgs(argv), UsageError, JSON.stringify(argv));
  }
});

test('parseArgs: compare mode', () => {
  assert.deepEqual(parseArgs(['--compare', 'baseline', 'r1-2']), { mode: 'compare', baseline: 'baseline', label: 'r1-2' });
});

test('selectRoutes keeps the asked order and names unknown ids', () => {
  const routes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(selectRoutes(null, routes), routes);
  assert.deepEqual(selectRoutes(['c', 'a'], routes).map((r) => r.id), ['c', 'a']);
  assert.throws(
    () => selectRoutes(['a', 'zz'], routes),
    (e) => e instanceof UsageError && /zz/.test(e.message) && /known: a, b, c/.test(e.message),
  );
});

test('findingId uses the key, falling back to the detail', () => {
  assert.equal(findingId(f('dunning', 1440, 'light', 'F1', 'P2', 'row:3')), 'dunning|1440|light|F1|row:3');
  assert.equal(findingId({ route: 'x', width: 390, theme: 'dark', rule: 'F2', detail: { a: 1 } }), 'x|390|dark|F2|{"a":1}');
});

test('parseAllow validates entries; applyAllow marks matches', () => {
  const reason = 'ตั้งใจให้ต่าง: ช่องยอดเงินใหญ่';
  assert.throws(() => parseAllow({}), /entries/);
  assert.throws(() => parseAllow({ entries: [{ id: 'x', reason }] }), /finding id/);
  assert.throws(() => parseAllow({ entries: [{ id: 'a|1|light|F1|k', reason: 'short' }] }), /reason/);
  assert.throws(
    () => parseAllow({ entries: [{ id: 'a|1|light|F1|k', reason }, { id: 'a|1|light|F1|k', reason }] }),
    /duplicate/,
  );
  const allow = parseAllow({ entries: [{ id: 'a|1440|light|F1|k1', reason }] });
  const [kept, open] = applyAllow([f('a', 1440, 'light', 'F1', 'P2', 'k1'), f('a', 1440, 'light', 'F1', 'P2', 'k2')], allow);
  assert.equal(kept.allowed, true);
  assert.equal(kept.allowReason, reason);
  assert.equal(open.allowed, false);
});

test('compareRuns: new, fixed and blocking findings over cells rendered in both runs', () => {
  const baseline = { cells: [
    cell('a', 1440, 'light', [f('a', 1440, 'light', 'F1', 'P2', 'old'), f('a', 1440, 'light', 'F3', 'P1', 'kept')]),
    cell('b', 1440, 'light', [f('b', 1440, 'light', 'F1', 'P2', 'x')], 'error'),
    cell('c', 1440, 'light', [f('c', 1440, 'light', 'F2', 'P2', 'gone')]),
  ] };
  const current = { cells: [
    cell('a', 1440, 'light', [
      f('a', 1440, 'light', 'F3', 'P1', 'kept'), f('a', 1440, 'light', 'F4', 'P2', 'new'),
      f('a', 1440, 'light', 'F1', 'P3', 'minor'), { ...f('a', 1440, 'light', 'F1', 'P2', 'ok'), allowed: true },
    ]),
    cell('b', 1440, 'light', [f('b', 1440, 'light', 'F1', 'P2', 'y')]),
    cell('d', 390, 'dark', [f('d', 390, 'dark', 'F1', 'P2', 'z')]),
  ] };
  const r = compareRuns(baseline, current);
  assert.equal(r.comparedCells, 1);
  assert.deepEqual(r.newFindings.map((x) => x.key), ['new', 'minor']);
  assert.deepEqual(r.blocking.map((x) => x.key), ['new']);
  assert.deepEqual(r.fixed.map((x) => x.key), ['old']);
  assert.deepEqual(r.notCompared.sort(), ['b|1440|light', 'd|390|dark']);
  assert.deepEqual(r.notRun, ['c|1440|light']);
  assert.equal(r.failed, true);
  const text = formatCompare(r, 'baseline', 'r1-2');
  assert.match(text, /Compared 1 cells/);
  assert.match(text, /\+ P2 F4 a 1440 light new/);
  assert.match(text, /- P2 F1 a 1440 light old/);
  assert.match(text, /Not run in "r1-2" \(subset run — not blocking\): 1 cells/);
  assert.match(text, /FAIL: new P1\/P2 findings/);
  const same = compareRuns(baseline, baseline);
  assert.equal(same.failed, false);
  assert.match(formatCompare(same, 'baseline', 'baseline'), /PASS: no new P1\/P2 findings/);
});

test('compareRuns: every MENU failure blocks, even one the baseline already had', () => {
  const clip = (route, key, reasons) => ({ ...f(route, 1440, 'light', 'MENU', 'P1', key), detail: { reasons } });
  const baseline = { cells: [
    cell('m', 1440, 'light', [clip('m', 'menu-a', ['ถูกตัดโดย <div class="x">']), clip('m', 'menu-b', ['ถูกตัดโดย <div class="y">'])]),
    cell('n', 1440, 'light', [clip('n', 'menu-c', ['ถูกตัดโดย <div class="z">'])]),
  ] };
  const current = { cells: [
    cell('m', 1440, 'light', [
      clip('m', 'menu-a', ['ถูกตัดโดย <div class="x">']), clip('m', 'menu-b', ['ถูกตัดโดย <div class="other">']),
    ]),
    cell('n', 1440, 'light', [clip('n', 'menu-c:error', ['probe error: locator.click: Timeout 15000ms exceeded'])]),
  ] };
  const r = compareRuns(baseline, current);
  assert.deepEqual(r.newFindings, [], 'MENU is reported in its own section, not as a new finding');
  assert.deepEqual(r.blocking, []);
  assert.deepEqual(
    r.menuFailures.map((x) => [x.key, x.vsBaseline]),
    [['menu-a', 'identical'], ['menu-b', 'changed'], ['menu-c:error', 'new']],
  );
  assert.deepEqual(r.fixed.map((x) => x.key), ['menu-c'], 'the clip finding is gone, replaced by a probe error');
  assert.equal(r.failed, true);
  const text = formatCompare(r, 'baseline', 'r1-2');
  assert.match(text, /MENU failures \(account-menu probes — never accepted from the baseline\): 3/);
  assert.match(text, /! P1 MENU m 1440 light menu-a — ถูกตัดโดย <div class="x"> \[byte-identical to baseline: pre-existing S2-01\/S2-02, fixed by Task 6\]/);
  assert.match(text, /! P1 MENU m 1440 light menu-b — .* \[reasons differ from baseline\]/);
  assert.match(text, /! P1 MENU n 1440 light menu-c:error — probe error: .* \[not in baseline\]/);
  assert.match(text, /FAIL: 3 MENU failures \(1 byte-identical to baseline/);
  const self = compareRuns(baseline, baseline);
  assert.equal(self.failed, true, 'a baseline with MENU failures fails against itself until Task 6');
  assert.ok(self.menuFailures.every((x) => x.vsBaseline === 'identical'));
  const menuFixed = compareRuns(baseline, { cells: [cell('m', 1440, 'light', []), cell('n', 1440, 'light', [])] });
  assert.equal(menuFixed.failed, false);
  assert.deepEqual(menuFixed.fixed.map((x) => x.key), ['menu-a', 'menu-b', 'menu-c']);
  assert.match(formatCompare(menuFixed, 'baseline', 't6'), /MENU failures \(account-menu probes — never accepted from the baseline\): 0/);
});

test('compareRuns: a cell rendered at baseline that stops rendering blocks; one left out of a subset run does not', () => {
  const baseline = { cells: [
    cell('a', 1440, 'light', [f('a', 1440, 'light', 'F1', 'P2', 'k')], 'rendered', { factCount: 20 }),
    cell('b', 1440, 'light', [], 'rendered', { factCount: 20 }),
    cell('c', 390, 'dark', [], 'rendered', { factCount: 20 }),
  ] };
  const current = { cells: [
    cell('a', 1440, 'light', [], 'error', { error: 'landed on /?zone=shop instead of /todos', factCount: 0 }),
    cell('b', 1440, 'light', [], 'open-failed', { openError: 'locator.click: Timeout 15000ms exceeded', factCount: 18 }),
  ] };
  const r = compareRuns(baseline, current);
  assert.equal(r.comparedCells, 0);
  assert.deepEqual(r.fixed, [], 'findings of a cell that stopped rendering are not "fixed"');
  assert.deepEqual(r.lostCells, [
    { cell: 'a|1440|light', status: 'error', reason: 'landed on /?zone=shop instead of /todos' },
    { cell: 'b|1440|light', status: 'open-failed', reason: 'locator.click: Timeout 15000ms exceeded' },
  ]);
  assert.deepEqual(r.notRun, ['c|390|dark']);
  assert.deepEqual(r.notCompared, []);
  assert.equal(r.failed, true);
  const text = formatCompare(r, 'baseline', 'r1-2');
  assert.match(text, /Cells rendered in "baseline" but not in "r1-2" \(blocking\): 2/);
  assert.match(text, /! a\|1440\|light — error: landed on \/\?zone=shop instead of \/todos/);
  assert.match(text, /FAIL: 2 cells stopped rendering/);
  const subset = compareRuns(baseline, { cells: [baseline.cells[0]] });
  assert.equal(subset.failed, false);
  assert.deepEqual(subset.notRun, ['b|1440|light', 'c|390|dark']);
});

test('compareRuns: a fact count below half of the baseline cell blocks', () => {
  const baseline = { cells: [
    cell('a', 1440, 'light', [], 'rendered', { factCount: 64 }),
    cell('b', 1440, 'light', [], 'rendered', { factCount: 40 }),
  ] };
  const current = { cells: [
    cell('a', 1440, 'light', [], 'rendered', { factCount: 31 }),
    cell('b', 1440, 'light', [], 'rendered', { factCount: 20 }),
  ] };
  const r = compareRuns(baseline, current);
  assert.deepEqual(r.factDrops, [{ cell: 'a|1440|light', before: 64, after: 31 }], 'exactly half is not a drop');
  assert.equal(r.failed, true);
  assert.match(formatCompare(r, 'baseline', 'r1-2'), /! a\|1440\|light — facts 64 → 31/);
  assert.match(formatCompare(r, 'baseline', 'r1-2'), /FAIL: 1 cells lost over half their measured fields/);
});

test('screenProblem: a redirect, an error fallback or an empty screen is not the screen that was asked for', () => {
  const ok = { requestedPath: '/stock/transfers?view=history', finalPath: '/stock/transfers?view=history&zone=shop', factCount: 20, fallbackText: null };
  assert.equal(screenProblem(ok), null, 'the app may add query parameters');
  assert.equal(
    screenProblem({ ...ok, requestedPath: '/todos', finalPath: '/?zone=shop' }),
    'landed on /?zone=shop instead of /todos',
  );
  assert.equal(screenProblem({ ...ok, fallbackText: 'เกิดข้อผิดพลาด' }), 'error fallback visible: เกิดข้อผิดพลาด');
  assert.equal(screenProblem({ ...ok, factCount: 0 }), 'no form fields measured (facts 0)');
});

test('menuFinding: a clipped menu and a probe that errored get different keys', () => {
  const where = { route: 'r', width: 1440, theme: 'dark' };
  assert.equal(menuFinding({ id: 'menu-a', ok: true, reasons: [] }, where), null);
  assert.deepEqual(menuFinding({ id: 'menu-a', ok: false, reasons: ['ถูกตัดโดย <div>'] }, where), {
    rule: 'MENU', severity: 'P1', key: 'menu-a', detail: { reasons: ['ถูกตัดโดย <div>'] }, ...where,
  });
  assert.equal(menuFinding({ id: 'menu-a', ok: false, error: true, reasons: ['probe error: x'] }, where).key, 'menu-a:error');
});

test('parseAllow refuses MENU findings — a clipped menu is never kept on purpose', () => {
  assert.throws(
    () => parseAllow({ entries: [{ id: 'other-income-items|1440|light|MENU|account-menu-items-card', reason: 'ตั้งใจให้เมนูถูกตัด' }] }),
    /MENU/,
  );
});

test('renderReport: totals, probes, api errors and unfinished cells', () => {
  const results = {
    label: 'baseline', startedAt: 's', finishedAt: 'e', sourceRevision: 'abc123', origin: 'http://localhost:5195',
    widths: [1440], themes: ['light'], routes: ['a', 'b'],
    routeMeta: [{ id: 'a', appendix: ['S2-01'] }, { id: 'b', appendix: [] }],
    cells: [
      cell('a', 1440, 'light', [
        f('a', 1440, 'light', 'MENU', 'P1', 'account-menu-items-card'), f('a', 1440, 'light', 'F1', 'P2', 'k'),
        { ...f('a', 1440, 'light', 'F1', 'P2', 'ok'), allowed: true },
      ], 'rendered', {
        probes: [{ id: 'account-menu-items-card', ok: false, reasons: ['เมนู [0,0 → 1,1] ถูกตัดโดย <div class="a|b"> x'] }],
        apiErrors: [{ method: 'GET', path: '/purchase-orders/summary', status: 501 }],
      }),
      cell('b', 1440, 'light', [], 'open-failed', {
        openError: 'locator timed out',
        apiErrors: [{ method: 'GET', path: '/purchase-orders/summary', status: 501 }],
      }),
    ],
  };
  const s = summarize(results);
  assert.deepEqual(s.bySeverity, { P1: 1, P2: 1, P3: 0 });
  assert.equal(s.allowed, 1);
  assert.deepEqual(s.apiErrors, [{ method: 'GET', path: '/purchase-orders/summary', status: 501, routes: ['a', 'b'] }]);
  const report = renderReport(results);
  assert.match(report, /ข้อพบที่ยังเปิด: 2 \(P1 1 · P2 1 · P3 0\) · ยกเว้นตาม allow.json: 1/);
  assert.match(report, /\| a \| account-menu-items-card \| 1440 \| light \| FAIL \| .*a\\\|b/);
  assert.match(report, /\| a \| S2-01 \| 1 \| 1 \| 1 \| 1 \| 0 \| 1 \|/);
  assert.match(report, /- b\|1440\|light — open-failed: locator timed out/);
  assert.match(report, /\| GET \| \/purchase-orders\/summary \| 501 \| a, b \|/);
});

test('coa: parseCsvLine keeps quoted commas', () => {
  assert.deepEqual(parseCsvLine('11-1101,"ชื่อ, มีจุลภาค",สินทรัพย์'), ['11-1101', 'ชื่อ, มีจุลภาค', 'สินทรัพย์']);
});

test('coa: the CPA CSV loads into the API shapes', () => {
  const rows = loadCoa();
  assert.ok(rows.length > 100, `${rows.length} accounts`);
  assert.ok(rows.every((r) => ACCOUNT_CODE_RE.test(r.code)));
  assert.equal(rows.find((r) => r.code === '42-1102')?.name, 'ดอกเบี้ยเงินฝาก');
  const flat = coaGrouped(rows, {}).groups.flatMap((g) => g.accounts);
  assert.equal(flat.length, rows.filter((r) => r.status === 'ใช้งาน').length);
  assert.ok(flat.length < rows.length, 'inactive accounts are left out');
  assert.ok(flat.some((a) => a.code === '42-1102'));
  assert.deepEqual(Object.keys(flat[0]).sort(), ['code', 'name', 'normalBalance', 'notes', 'vatApplicable']);
  const expense = coaGrouped(rows, { type: 'ค่าใช้จ่าย' }).groups.flatMap((g) => g.accounts);
  assert.ok(expense.length > 0 && expense.every((a) => rows.find((r) => r.code === a.code).type === 'ค่าใช้จ่าย'));
  assert.deepEqual(coaByCodes(rows, ['11-1201', ' 11-1101', '99-9999']).map((r) => r.code), ['11-1101', '11-1201']);
  assert.ok(coaList(rows, { status: 'ใช้งาน' }).every((r) => r.status === 'ใช้งาน' && r.id === `coa-${r.code}`));
});

test('menuClipVerdict: fully visible menu passes; clipped or off-screen fails', () => {
  const viewport = { width: 1440, height: 900 };
  const menu = { top: 300, left: 100, bottom: 620, right: 500 };
  assert.deepEqual(menuClipVerdict({ found: false }), { ok: false, reasons: ['ไม่พบเมนูบัญชีหลังกดเปิด'] });
  assert.deepEqual(
    menuClipVerdict({ found: true, menu, viewport, clippers: [{ tag: 'main', className: 'x', rect: { top: 0, left: 0, bottom: 900, right: 1440 } }] }),
    { ok: true, reasons: [] },
  );
  assert.equal(menuClipVerdict({ found: true, menu: { ...menu, bottom: 900.8 }, viewport, clippers: [] }).ok, true, '1px tolerance');
  const clipped = menuClipVerdict({
    found: true, menu, viewport,
    clippers: [{ tag: 'div', className: 'rounded-lg border bg-card overflow-hidden', rect: { top: 200, left: 90, bottom: 450, right: 700 } }],
  });
  assert.equal(clipped.ok, false);
  assert.match(clipped.reasons[0], /ถูกตัดโดย <div class="rounded-lg border bg-card overflow-hidden">/);
  const offscreen = menuClipVerdict({ found: true, menu: { ...menu, bottom: 950 }, viewport, clippers: [] });
  assert.equal(offscreen.ok, false);
  assert.match(offscreen.reasons[0], /ล้นจอ 1440×900/);
});

test('routes: ids, paths, mocks and probes are well formed', () => {
  const ids = ROUTES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const r of ROUTES) {
    assert.match(r.id, /^[a-z0-9-]+$/);
    assert.ok(typeof r.path === 'function' || (typeof r.path === 'string' && r.path.startsWith('/')), r.id);
    assert.ok(Array.isArray(r.mocks) && Array.isArray(r.appendix), r.id);
    assert.ok(r.open === undefined || typeof r.open === 'function', r.id);
    for (const m of [...COMMON_MOCKS, ...r.mocks]) {
      assert.ok(m.path instanceof RegExp && m.path.source.startsWith('^') && m.path.source.endsWith('$'), `${r.id}: ${m.path}`);
      assert.equal(typeof m.json, 'function', `${r.id}: ${m.path}`);
    }
  }
});

test('routes: cover appendix ก, the 9 AddressForm hosts and both account-menu probes', () => {
  const appendix = new Set(ROUTES.flatMap((r) => r.appendix));
  for (const code of ['S1-01', 'S1-02', 'S1-03', 'S1-04', 'S1-05', 'S1-06', 'S2-01', 'S2-02', 'S2-03', 'S2-04', 'S2-05',
    'S2-07', 'S2-08', 'S3-02', 'S3-03', 'S3-04', 'S3-05', 'S3-07', 'S3-09', 'S3-10', 'S3-12']) {
    assert.ok(appendix.has(code), code);
  }
  const ids = new Set(ROUTES.map((r) => r.id));
  assert.equal(ADDRESS_FORM_HOSTS.length, 9);
  for (const id of ADDRESS_FORM_HOSTS) assert.ok(ids.has(id), id);
  const probes = ROUTES.flatMap((r) => (r.probes ?? []).map((p) => [r.id, p.id, p.widths]));
  assert.deepEqual(probes, [
    ['other-income-items', 'account-menu-items-card', [1440]],
    ['other-income-override', 'account-menu-override-jv', [1440]],
  ]);
});

test('routes: the deep screens later tasks measure, and a fixed buy-back catalog', async () => {
  const byId = new Map(ROUTES.map((r) => [r.id, r]));
  for (const id of ['company-entity-edit', 'company-entity-create', 'purchase-order-wizard', 'interest-config-form',
    'finance-knowledge-form', 'todo-form', 'stock-transfers-outgoing', 'other-income-items', 'expense-new', 'payroll-new',
    'recurring-bill-dialog', 'trade-in-quick-buy', 'pos-sale-form']) {
    assert.ok(byId.has(id), id);
  }
  assert.equal(typeof byId.get('company-entity-create').open, 'function');
  assert.ok(byId.get('company-entity-create').appendix.includes('S1-02'));
  assert.equal(typeof byId.get('payroll-new').open, 'function', 'S3-07 needs an expanded line');
  assert.ok(byId.get('purchase-order-wizard').appendix.includes('S2-08'));
  const poSuppliers = await byId.get('purchase-order-wizard').mocks.find((m) => m.path.test('/suppliers')).json();
  assert.equal(poSuppliers.data.length, 1, 'the wizard draft names the one mocked supplier');
  const catalogMock = byId.get('trade-in-quick-buy').mocks.find((m) => m.path.test('/trade-ins/quick-buy/catalog'));
  assert.ok(catalogMock, 'the catalog is mocked so the selects do not depend on preview data or timing');
  const catalog = await catalogMock.json();
  assert.ok(catalog.models.length > 0 && catalog.models.every((m) => m.storages.length > 0));
});

test('routes: common mocks answer from the CPA chart of accounts and the preview user', async () => {
  const find = (path) => COMMON_MOCKS.find((m) => m.path.test(path));
  const grouped = await find('/chart-of-accounts/grouped').json(new URL('http://x/api/admin/chart-of-accounts/grouped'), {});
  assert.ok(grouped.groups.flatMap((g) => g.accounts).some((a) => a.code === '42-1102' && a.name === 'ดอกเบี้ยเงินฝาก'));
  const byCodes = await find('/chart-of-accounts/by-codes').json(
    new URL('http://x/api/admin/chart-of-accounts/by-codes?codes=11-1101,11-1201'), {},
  );
  assert.deepEqual(byCodes.map((r) => r.code), ['11-1101', '11-1201']);
  assert.equal(find('/chart-of-accounts/grouped/x'), undefined, 'anchored');
  const perms = await find('/accounting-permissions/me').json(new URL('http://x/'), {
    me: { id: 'u1', name: 'ผู้ทดสอบ', role: 'OWNER' },
  });
  assert.deepEqual(perms.user, { id: 'u1', name: 'ผู้ทดสอบ', role: 'OWNER', branchId: null });
  assert.ok(perms.permissions.includes('INCOME_POST'));
  const roleMap = ROUTES.find((r) => r.id === 'account-role-edit').mocks[0].json();
  assert.ok(roleMap.every((row) => row.accountName), 'role-map names come from the CSV');
});

const CHECK = fileURLToPath(new URL('./check.mjs', import.meta.url));
const runCheck = (...args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' });

test('check.mjs: usage errors exit 2 before touching the preview', () => {
  const noLabel = runCheck();
  assert.equal(noLabel.status, 2, noLabel.stderr);
  assert.match(noLabel.stderr, /--label is required/);
  assert.match(noLabel.stderr, /usage: node tools\/field-scale\/check\.mjs --label <name>/);
  const badRoute = runCheck('--label', 'x', '--routes', 'no-such-route');
  assert.equal(badRoute.status, 2, badRoute.stderr);
  assert.match(badRoute.stderr, /unknown route id\(s\): no-such-route/);
});

test('check.mjs: --compare needs both runs on disk', () => {
  const r = runCheck('--compare', 'field-scale-test-missing-a', 'field-scale-test-missing-b');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no results for "field-scale-test-missing-a"/);
});
