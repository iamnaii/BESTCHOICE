import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UsageError,
  applyAllow,
  compareRuns,
  findingId,
  formatCompare,
  parseAllow,
  parseArgs,
  renderReport,
  selectRoutes,
  summarize,
} from './lib.mjs';

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
  assert.deepEqual(r.notCompared.sort(), ['b|1440|light', 'c|1440|light', 'd|390|dark']);
  const text = formatCompare(r, 'baseline', 'r1-2');
  assert.match(text, /Compared 1 cells/);
  assert.match(text, /\+ P2 F4 a 1440 light new/);
  assert.match(text, /- P2 F1 a 1440 light old/);
  assert.match(text, /FAIL: new P1\/P2 findings/);
  assert.match(formatCompare(compareRuns(baseline, baseline), 'baseline', 'baseline'), /PASS: no new P1\/P2 findings/);
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
