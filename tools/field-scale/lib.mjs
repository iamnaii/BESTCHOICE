// Field-scale check — pure layer (no browser, no preview): CLI parsing, finding identity, the
// allow-list, comparing two runs and the Markdown report. tools/field-scale/check.mjs drives the
// browser; tools/field-scale/check.test.mjs tests this file.

export const DEFAULT_WIDTHS = [1440, 1024, 390];
export const THEMES = ['light', 'dark'];
export const SEVERITIES = ['P1', 'P2', 'P3'];
export const BLOCKING_SEVERITIES = ['P1', 'P2'];
export const COMPARABLE_STATUS = 'rendered';
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

// Only cells rendered in BOTH runs are compared: an errored / unopened / skipped cell has no findings,
// which would otherwise read as "everything fixed".
export function compareRuns(baseline, current) {
  const base = new Map(baseline.cells.map((c) => [cellId(c), c]));
  const curr = new Map(current.cells.map((c) => [cellId(c), c]));
  const compared = [...curr.keys()].filter(
    (id) => base.has(id) && base.get(id).status === COMPARABLE_STATUS && curr.get(id).status === COMPARABLE_STATUS,
  );
  const comparedSet = new Set(compared);
  const pick = (run) =>
    new Map(openFindings(run.cells.filter((c) => comparedSet.has(cellId(c)))).map((f) => [findingId(f), f]));
  const before = pick(baseline);
  const after = pick(current);
  const newFindings = [...after].filter(([id]) => !before.has(id)).map(([, f]) => f);
  const fixed = [...before].filter(([id]) => !after.has(id)).map(([, f]) => f);
  const notCompared = [...new Set([...base.keys(), ...curr.keys()])].filter((id) => !comparedSet.has(id));
  return {
    comparedCells: compared.length,
    notCompared,
    newFindings,
    fixed,
    blocking: newFindings.filter((f) => BLOCKING_SEVERITIES.includes(f.severity)),
  };
}

const findingLine = (f) =>
  `${f.severity} ${f.rule} ${f.route} ${f.width} ${f.theme} ${f.key ?? JSON.stringify(f.detail ?? null)}`;

export function formatCompare(result, baselineLabel, label) {
  return [
    `Compared ${result.comparedCells} cells (route × width × theme) of "${baselineLabel}" → "${label}"`,
    `New findings: ${result.newFindings.length} (blocking P1/P2: ${result.blocking.length})`,
    ...result.newFindings.map((f) => `  + ${findingLine(f)}`),
    `Fixed: ${result.fixed.length}`,
    ...result.fixed.map((f) => `  - ${findingLine(f)}`),
    ...(result.notCompared.length
      ? [
          `Not compared (missing from one run, or not rendered in both): ${result.notCompared.length}`,
          ...result.notCompared.map((id) => `  ? ${id}`),
        ]
      : []),
    result.blocking.length ? 'FAIL: new P1/P2 findings' : 'PASS: no new P1/P2 findings',
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
