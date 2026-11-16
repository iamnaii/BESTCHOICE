// Field-scale check — pure layer (no browser, no preview): CLI parsing, finding identity, the
// allow-list, comparing two runs and the Markdown report. tools/field-scale/check.mjs drives the
// browser; tools/field-scale/check.test.mjs tests this file.

export const DEFAULT_WIDTHS = [1440, 1024, 390];
export const THEMES = ['light', 'dark'];
export const SEVERITIES = ['P1', 'P2', 'P3'];
export const BLOCKING_SEVERITIES = ['P1', 'P2'];
export const COMPARABLE_STATUS = 'rendered';
export const MENU_RULE = 'MENU';
export const FACT_DROP_RATIO = 0.5;
export const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const REPORT_FINDINGS_MAX = 300;
export const USAGE = [
  'usage: node tools/field-scale/check.mjs --label <name> [--routes <id,id>] [--widths 1440,1024,390] [--themes light,dark]',
  '       node tools/field-scale/check.mjs --compare <baselineLabel> <label>',
].join('\n');

export class UsageError extends Error {}

function listValue(argv, i, flag) {
  const value = argv[i];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  const items = [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!items.length) throw new UsageError(`${flag} needs a value`);
  return items;
}

function labelValue(value, flag) {
  if (value === undefined || !LABEL_RE.test(value)) {
    throw new UsageError(`${flag} needs a name made of letters, digits, ".", "-" or "_" (got ${value ?? 'nothing'})`);
  }
  return value;
}

function widthValue(w) {
  if (!/^\d+$/.test(w) || Number(w) < 320 || Number(w) > 3840) {
    throw new UsageError(`--widths: "${w}" is not a whole number between 320 and 3840`);
  }
  return Number(w);
}

function themeValue(t) {
  if (!THEMES.includes(t)) throw new UsageError(`--themes: "${t}" is not light or dark`);
  return t;
}

export function parseArgs(argv) {
  if (argv[0] === '--compare') {
    if (argv.length !== 3) throw new UsageError('--compare takes exactly two labels and no other options');
    return { mode: 'compare', baseline: labelValue(argv[1], '--compare'), label: labelValue(argv[2], '--compare') };
  }
  const out = { mode: 'run', label: null, routes: null, widths: [...DEFAULT_WIDTHS], themes: [...THEMES] };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag === '--label') out.label = labelValue(argv[i + 1], flag);
    else if (flag === '--routes') out.routes = listValue(argv, i + 1, flag);
    else if (flag === '--widths') out.widths = listValue(argv, i + 1, flag).map(widthValue);
    else if (flag === '--themes') out.themes = listValue(argv, i + 1, flag).map(themeValue);
    else if (flag === '--compare') throw new UsageError('--compare must be the first argument');
    else throw new UsageError(`unknown argument "${flag}"`);
  }
  if (!out.label) throw new UsageError('--label is required');
  return out;
}

export function selectRoutes(ids, routes) {
  if (!ids) return routes;
  const byId = new Map(routes.map((r) => [r.id, r]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) {
    throw new UsageError(`unknown route id(s): ${unknown.join(', ')} — known: ${routes.map((r) => r.id).join(', ')}`);
  }
  return ids.map((id) => byId.get(id));
}

export const cellId = (c) => `${c.route}|${c.width}|${c.theme}`;

// How a route's network rule answers one /api request (path WITHOUT /api or /api/admin): the first mock
// whose method (default GET) and path match → 'mock'; else a non-GET on a blockWrites route → 'block'
// (aborted, listed in the cell as blockedWrites); else 'pass' to the preview.
export function routeRequest(route, mocks, method, path) {
  const mock = mocks.find((m) => (m.method ?? 'GET') === method && m.path.test(path));
  if (mock) return { action: 'mock', mock };
  if (route.blockWrites && method !== 'GET') return { action: 'block' };
  return { action: 'pass' };
}

// A cell whose open step did not throw can still show the wrong screen: the app redirected (role
// menu, missing record), an error fallback replaced the page, or nothing measurable is on it.
// Query parameters may differ (the shell adds ?zone=); the pathname may not.
export function screenProblem({ requestedPath, finalPath, factCount, fallbackText }) {
  const pathname = (p) => new URL(p, 'http://preview.invalid').pathname;
  if (!finalPath || pathname(finalPath) !== pathname(requestedPath)) {
    return `landed on ${finalPath ?? '(nothing)'} instead of ${requestedPath}`;
  }
  if (fallbackText) return `error fallback visible: ${fallbackText}`;
  if (!factCount) return 'no form fields measured (facts 0)';
  return null;
}

// A failed account-menu probe is a MENU P1 finding; a probe that threw is keyed apart from a clip so
// the two never stand in for each other in a compare.
export function menuFinding(probe, where) {
  if (probe.ok) return null;
  return {
    rule: MENU_RULE, severity: 'P1', key: probe.error ? `${probe.id}:error` : probe.id,
    detail: { reasons: probe.reasons }, ...where,
  };
}

export function findingId(f) {
  const key = typeof f.key === 'string' && f.key !== '' ? f.key : JSON.stringify(f.detail ?? null);
  return `${cellId(f)}|${f.rule}|${key}`;
}

export function parseAllow(json) {
  const entries = json?.entries;
  if (!Array.isArray(entries)) throw new Error('allow.json: "entries" must be an array');
  const byId = new Map();
  entries.forEach((e, i) => {
    if (typeof e?.id !== 'string' || e.id.split('|').length < 5) {
      throw new Error(`allow.json entries[${i}]: "id" must be a finding id (route|width|theme|rule|key)`);
    }
    if (e.id.split('|')[3] === MENU_RULE) {
      throw new Error(`allow.json entries[${i}]: MENU findings (a clipped or broken account menu) cannot be allowed`);
    }
    if (typeof e.reason !== 'string' || e.reason.trim().length < 10) {
      throw new Error(`allow.json entries[${i}]: "reason" must say why the finding is kept (at least 10 characters)`);
    }
    if (byId.has(e.id)) throw new Error(`allow.json entries[${i}]: duplicate id ${e.id}`);
    byId.set(e.id, e.reason.trim());
  });
  return byId;
}

export function applyAllow(findings, allow) {
  return findings.map((f) => {
    const reason = allow.get(findingId(f));
    return reason ? { ...f, allowed: true, allowReason: reason } : { ...f, allowed: false };
  });
}

const openFindings = (cells) => cells.flatMap((c) => c.findings).filter((f) => !f.allowed);
const sameReasons = (a, b) => JSON.stringify(a.detail?.reasons ?? null) === JSON.stringify(b.detail?.reasons ?? null);

// Findings are compared only over cells rendered in BOTH runs: an errored / unopened / skipped cell has
// no findings, which would otherwise read as "everything fixed". So the compare also blocks on
//   - every MENU finding of the current run (a clipped or broken account menu is never accepted from the
//     baseline; `vsBaseline` says whether the baseline had the same id with byte-identical reasons),
//   - every cell rendered at baseline that is not rendered now (lostCells),
//   - every compared cell whose fact count fell below FACT_DROP_RATIO of its baseline (factDrops).
// Baseline cells the current run did not measure (--routes / --widths / --themes subset) are notRun.
export function compareRuns(baseline, current) {
  const base = new Map(baseline.cells.map((c) => [cellId(c), c]));
  const curr = new Map(current.cells.map((c) => [cellId(c), c]));
  const rendered = (map, id) => map.get(id)?.status === COMPARABLE_STATUS;
  const compared = [...curr.keys()].filter((id) => rendered(base, id) && rendered(curr, id));
  const comparedSet = new Set(compared);
  const pick = (run) =>
    new Map(openFindings(run.cells.filter((c) => comparedSet.has(cellId(c)))).map((f) => [findingId(f), f]));
  const before = pick(baseline);
  const after = pick(current);
  const newFindings = [...after].filter(([id, f]) => !before.has(id) && f.rule !== MENU_RULE).map(([, f]) => f);
  const fixed = [...before].filter(([id]) => !after.has(id)).map(([, f]) => f);
  const baseMenu = new Map(
    baseline.cells.flatMap((c) => c.findings).filter((f) => f.rule === MENU_RULE).map((f) => [findingId(f), f]),
  );
  const menuFailures = current.cells
    .flatMap((c) => c.findings)
    .filter((f) => f.rule === MENU_RULE)
    .map((f) => {
      const was = baseMenu.get(findingId(f));
      return { ...f, vsBaseline: !was ? 'new' : sameReasons(was, f) ? 'identical' : 'changed' };
    });
  const lostCells = [...curr.keys()]
    .filter((id) => rendered(base, id) && !rendered(curr, id))
    .map((id) => {
      const c = curr.get(id);
      return { cell: id, status: c.status, reason: c.error ?? c.openError ?? '' };
    });
  const factDrops = compared
    .filter((id) => base.get(id).factCount > 0 && curr.get(id).factCount < base.get(id).factCount * FACT_DROP_RATIO)
    .map((id) => ({ cell: id, before: base.get(id).factCount, after: curr.get(id).factCount }));
  const notRun = [...base.keys()].filter((id) => !curr.has(id));
  const lostSet = new Set(lostCells.map((c) => c.cell));
  const notCompared = [...curr.keys()].filter((id) => !comparedSet.has(id) && !lostSet.has(id));
  const blocking = newFindings.filter((f) => BLOCKING_SEVERITIES.includes(f.severity));
  return {
    comparedCells: compared.length,
    notCompared,
    notRun,
    newFindings,
    fixed,
    blocking,
    menuFailures,
    lostCells,
    factDrops,
    failed: blocking.length + menuFailures.length + lostCells.length + factDrops.length > 0,
  };
}

const findingLine = (f) =>
  `${f.severity} ${f.rule} ${f.route} ${f.width} ${f.theme} ${f.key ?? JSON.stringify(f.detail ?? null)}`;

const MENU_VS_BASELINE = {
  identical: 'byte-identical to baseline: pre-existing S2-01/S2-02, fixed by Task 6',
  changed: 'reasons differ from baseline',
  new: 'not in baseline',
};

function failReasons(result) {
  const identical = result.menuFailures.filter((f) => f.vsBaseline === 'identical').length;
  return [
    ...(result.blocking.length ? ['new P1/P2 findings'] : []),
    ...(result.menuFailures.length
      ? [`${result.menuFailures.length} MENU failures (${identical} byte-identical to baseline — the known S2-01/S2-02 clip, acceptable only before Task 6)`]
      : []),
    ...(result.lostCells.length ? [`${result.lostCells.length} cells stopped rendering`] : []),
    ...(result.factDrops.length ? [`${result.factDrops.length} cells lost over half their measured fields`] : []),
  ];
}

export function formatCompare(result, baselineLabel, label) {
  const reasons = failReasons(result);
  return [
    `Compared ${result.comparedCells} cells (route × width × theme) of "${baselineLabel}" → "${label}"`,
    `New findings: ${result.newFindings.length} (blocking P1/P2: ${result.blocking.length})`,
    ...result.newFindings.map((f) => `  + ${findingLine(f)}`),
    `Fixed: ${result.fixed.length}`,
    ...result.fixed.map((f) => `  - ${findingLine(f)}`),
    `MENU failures (account-menu probes — never accepted from the baseline): ${result.menuFailures.length}`,
    ...result.menuFailures.map(
      (f) => `  ! ${findingLine(f)} — ${(f.detail?.reasons ?? []).join('; ')} [${MENU_VS_BASELINE[f.vsBaseline]}]`,
    ),
    ...(result.lostCells.length
      ? [
          `Cells rendered in "${baselineLabel}" but not in "${label}" (blocking): ${result.lostCells.length}`,
          ...result.lostCells.map((c) => `  ! ${c.cell} — ${c.status}: ${c.reason}`),
        ]
      : []),
    ...(result.factDrops.length
      ? [
          `Cells whose fact count fell below ${FACT_DROP_RATIO * 100}% of "${baselineLabel}" (blocking): ${result.factDrops.length}`,
          ...result.factDrops.map((c) => `  ! ${c.cell} — facts ${c.before} → ${c.after}`),
        ]
      : []),
    ...(result.notCompared.length
      ? [
          `Not compared (not rendered in "${baselineLabel}", or new in "${label}"): ${result.notCompared.length}`,
          ...result.notCompared.map((id) => `  ? ${id}`),
        ]
      : []),
    ...(result.notRun.length
      ? [`Not run in "${label}" (subset run — not blocking): ${result.notRun.length} cells`]
      : []),
    reasons.length
      ? `FAIL: ${reasons.join('; ')}`
      : 'PASS: no new P1/P2 findings, no MENU failures, no cell lost or emptied',
  ].join('\n');
}

const countBy = (findings) =>
  Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));

export function summarize(results) {
  const cells = results.cells;
  const all = cells.flatMap((c) => c.findings);
  const open = all.filter((f) => !f.allowed);
  const byRule = {};
  for (const f of open) {
    byRule[f.rule] ??= { P1: 0, P2: 0, P3: 0 };
    byRule[f.rule][f.severity] = (byRule[f.rule][f.severity] ?? 0) + 1;
  }
  const routes = [...new Set(cells.map((c) => c.route))].map((route) => {
    const rc = cells.filter((c) => c.route === route);
    return {
      route,
      appendix: (results.routeMeta ?? []).find((m) => m.id === route)?.appendix ?? [],
      cells: rc.length,
      rendered: rc.filter((c) => c.status === COMPARABLE_STATUS).length,
      ...countBy(open.filter((f) => f.route === route)),
      allowed: all.filter((f) => f.route === route && f.allowed).length,
    };
  });
  const probes = cells.flatMap((c) =>
    (c.probes ?? []).map((p) => ({ ...p, route: c.route, width: c.width, theme: c.theme })),
  );
  const api = new Map();
  for (const c of cells) {
    for (const e of c.apiErrors ?? []) {
      const k = `${e.method} ${e.path} ${e.status}`;
      const entry = api.get(k) ?? { method: e.method, path: e.path, status: e.status, routes: new Set() };
      entry.routes.add(c.route);
      api.set(k, entry);
    }
  }
  const apiErrors = [...api.values()]
    .map((e) => ({ ...e, routes: [...e.routes].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const problems = cells
    .filter((c) => c.status !== COMPARABLE_STATUS)
    .map((c) => ({ cell: cellId(c), status: c.status, message: c.openError ?? c.error ?? '' }));
  return {
    total: open.length,
    allowed: all.length - open.length,
    bySeverity: countBy(open),
    byRule,
    routes,
    probes,
    apiErrors,
    problems,
  };
}

const md = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderReport(results) {
  const s = summarize(results);
  const open = results.cells
    .flatMap((c) => c.findings)
    .filter((f) => !f.allowed)
    .sort(
      (a, b) =>
        a.severity.localeCompare(b.severity) || a.route.localeCompare(b.route) || a.rule.localeCompare(b.rule) ||
        b.width - a.width,
    );
  return [
    `# Field scale — ${results.label}`,
    '',
    `- เวลา: ${results.startedAt} → ${results.finishedAt}`,
    `- source revision: ${results.sourceRevision ?? 'unknown'} · preview: ${results.origin}`,
    `- ความกว้าง: ${results.widths.join(', ')} · ธีม: ${results.themes.join(', ')} · หน้า: ${results.routes.length} · cell: ${results.cells.length}`,
    `- ข้อพบที่ยังเปิด: ${s.total} (P1 ${s.bySeverity.P1} · P2 ${s.bySeverity.P2} · P3 ${s.bySeverity.P3}) · ยกเว้นตาม allow.json: ${s.allowed}`,
    '',
    '## ข้อพบตามกฎ',
    '',
    '| กฎ | P1 | P2 | P3 |',
    '|---|---|---|---|',
    ...Object.keys(s.byRule).sort().map((r) => `| ${r} | ${s.byRule[r].P1} | ${s.byRule[r].P2} | ${s.byRule[r].P3} |`),
    '',
    '## เมนูบัญชีถูกตัด (S2-01 / S2-02)',
    '',
    ...(s.probes.length
      ? [
          '| หน้า | probe | กว้าง | ธีม | ผล | เหตุ |',
          '|---|---|---|---|---|---|',
          ...s.probes.map(
            (p) => `| ${p.route} | ${p.id} | ${p.width} | ${p.theme} | ${p.ok ? 'PASS' : 'FAIL'} | ${md(p.reasons.join('; '))} |`,
          ),
        ]
      : ['ไม่ได้รัน probe ในรอบนี้']),
    '',
    '## รายหน้า',
    '',
    '| หน้า | ภาคผนวก ก | cell | วัดได้ | P1 | P2 | P3 | ยกเว้น |',
    '|---|---|---|---|---|---|---|---|',
    ...s.routes.map(
      (r) => `| ${r.route} | ${r.appendix.join(', ') || '—'} | ${r.cells} | ${r.rendered} | ${r.P1} | ${r.P2} | ${r.P3} | ${r.allowed} |`,
    ),
    '',
    '## cell ที่วัดไม่ครบ',
    '',
    ...(s.problems.length ? s.problems.map((p) => `- ${p.cell} — ${p.status}: ${md(p.message)}`) : ['ไม่มี']),
    '',
    '## API ที่ตอบ error (ยังไม่มี mock)',
    '',
    ...(s.apiErrors.length
      ? [
          '| method | path | status | หน้า |',
          '|---|---|---|---|',
          ...s.apiErrors.map((e) => `| ${e.method} | ${md(e.path)} | ${e.status} | ${e.routes.join(', ')} |`),
        ]
      : ['ไม่มี']),
    '',
    '## ข้อพบทั้งหมด (ยังเปิด)',
    '',
    ...open.slice(0, REPORT_FINDINGS_MAX).map((f) => `- ${md(findingLine(f))}`),
    ...(open.length > REPORT_FINDINGS_MAX ? [`- … อีก ${open.length - REPORT_FINDINGS_MAX} ข้อ — ดู results.json`] : []),
    '',
  ].join('\n');
}
