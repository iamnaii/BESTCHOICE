// Typography audit — BEFORE/AFTER report (Task 6).
//   loadRun()        one run folder → records
//                    (admin: <dir>/typography/route-<no>-<w>-<theme>-<role>.json,
//                    shop: <dir>/shop/route-<slug>-<w>.json); facts re-read lazily, pair by pair
//   summarize()      pairs BEFORE↔AFTER (app + row + route + width + theme + role), runs the Task 1
//                    rules (evaluateTypography / diffFindings / compareFacts) and groups shell
//                    repeats (Ruling Z)
//   renderSummary()  summary.md (Thai, for the owner)
//   buildFindingsJson()  findings.json (Ruling AC)
//   renderContactSheet()  BEFORE|AFTER image pairs (relative paths — images stay in .tmp)
//   CLI  node tools/typography-audit/report.mjs
//        --admin-before-owner <dir> --admin-after-owner <dir>
//        --admin-before-sales <dir> --admin-after-sales <dir>
//        --shop-before <dir> --shop-after <dir>
//        --out docs/reports/typography-scale-audit-2026-11
//        --sheet .tmp/typo-audit/contact-sheet.html
//        [--revision <run label>=<sha> …]  (storefront runs have no run.json)
//        A missing folder is reported as missing (never fatal).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  evaluateTypography,
  diffFindings,
  compareFacts,
  findingKey,
  resolveKeys,
  TOUCH_MIN_DESKTOP,
  TOUCH_MIN_MOBILE,
} from './rules.mjs';

// Ruling Z: the same rule|kind|normalized text|width|theme|role on ≥ this many distinct routes is a
// shared part of the page (sidebar, header, bottom nav, a shared component) → one point with a
// route count.
export const SHELL_MIN_ROUTES = 5;
// /liff/debug prints the run's port, so its text differs BEFORE/AFTER — its D1/D2 are known noise.
export const KNOWN_NOISE_ROUTES = ['/liff/debug'];
// Pages whose displayed data differs between runs (not because of the font). Their findings are
// kept and counted, but annotated (※): a different count/number changes the key text, so
// new/resolved there is usually data noise.
export const RUN_VARYING_ROUTES = {
  '/liff/debug': 'พิมพ์หมายเลขพอร์ตของรอบทดสอบ',
  '/audit-logs': 'ตัวเลขในตารางคือจำนวนรายการ audit ของรอบนั้น',
  '/system-status': 'เวลาตอบสนองและหน่วยความจำของรอบนั้น',
};
const isRunVarying = (route) => Object.hasOwn(RUN_VARYING_ROUTES, route);
// Rule-vs-house-style (controller ruling, fix round 1): only these measured values are the house
// style the owner decides on — everything else in R3/R7 is a real finding.
export const HOUSE_STYLE = {
  R3: 'R3 P2 with line-height ratio 1.375 ± 0.01 (Tailwind leading-snug) and font-size < 20px',
  R7: `R7 at desktop widths (minimum ${TOUCH_MIN_DESKTOP}px) with height 31.5–34.5px (shadcn md Button/SelectTrigger 34px, sidebar items 32–34px)`,
};
const LEADING_SNUG = 1.375;
export function isHouseStyle(f) {
  const d = f.detail ?? {};
  if (f.rule === 'R3')
    return f.severity === 'P2' && Math.abs(d.ratio - LEADING_SNUG) < 0.01 && d.fontSize < 20;
  if (f.rule === 'R7') return d.min === TOUCH_MIN_DESKTOP && d.h >= 31.5 && d.h <= 34.5;
  return false;
}
export const UNMEASURED_ROLES = ['FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER'];
export const STATUSES = ['rendered', 'redirected', 'empty', 'error', 'blocked', 'document'];
export const SEVERITIES = ['P1', 'P2', 'P3'];
export const TOP_N = 30;
export const PRE_P1_RESERVE = 10;
const SEV_RANK = { P1: 3, P2: 2, P3: 1 };
const JSON_TEXT_MAX = 120;
const MD_TEXT_MAX = 40;
const SHELL_ROUTE_SAMPLE = 20;
const PERSIST_EXAMPLES = 5;
const SHEET_SHELL_SAMPLES = 2;
const MD_TABLE_LIMIT = 60;

const RULE_TH = {
  R1: 'ขนาดตัวอักษรไม่อยู่ในสเกล',
  R2: 'หัวข้อรองใหญ่กว่าหัวข้อหลัก',
  R3: 'ระยะบรรทัดไม่พอดี (ไทยแน่นเกิน = P1)',
  R4: 'สระ/วรรณยุกต์ถูกตัด',
  R5: 'ปุ่ม/ชิป/เมนู/หัวตารางขึ้นสองบรรทัด',
  R6: 'ข้อความในปุ่ม/ป้ายถูกตัดแนวนอน',
  R7: 'ปุ่ม/ช่องกรอกเตี้ยกว่าเกณฑ์',
  R7b: 'ช่องกรอกบนมือถือตัวเล็กกว่า 16px (iOS ซูม)',
  R8: 'ฟอนต์ผิด',
  R9: 'น้ำหนักตัวอักษรไม่อยู่ในชุดที่ส่ง',
  R10: 'ตัวเลขไม่เรียงหลัก (ไม่มี tabular-nums)',
  R11: 'ไอคอนไม่สมส่วนกับตัวอักษร',
  R12: 'ย่อหน้ากว้างเกินอ่านสบาย',
  D1: 'ข้อความเดียวกันกว้างเปลี่ยนเกิน 8%',
  D2: 'ตัวอักษรเยื้องจากกึ่งกลางปุ่ม/ชิป/ช่องกรอก',
};
const SEV_TH = { P1: 'ต้องแก้', P2: 'ควรแก้', P3: 'ขัดเกลา' };
const STATUS_TH = {
  rendered: 'วัดได้',
  redirected: 'ถูกพาไปหน้าอื่น',
  empty: 'หน้าว่าง',
  error: 'ผิดพลาด',
  blocked: 'ถูกกัน',
  document: 'หน้าเอกสาร',
  missing: 'ไม่มีไฟล์',
  'missing-run': 'ไม่มีโฟลเดอร์',
  unknown: 'ไม่ทราบสถานะ',
};
const APP_TH = { web: 'หลังบ้าน', shop: 'หน้าร้าน' };
const ROLE_LEGEND =
  'owner = เจ้าของ · salesA = พนักงานขาย · LIFF = ลูกค้าใน LINE (session ลูกค้าจำลอง) · guest = ผู้เยี่ยมชมหน้าร้าน · customer = ลูกค้าที่ล็อกอินหน้าร้าน';

// ── records ─────────────────────────────────────────────────────────────────────────────────────
// LIFF pages are measured with the same synthetic customer session in both role runs → one role
// ('liff').
const isRoleShared = (app, route) => app === 'web' && String(route).startsWith('/liff');

export function normalizeRecord(raw, ctx = {}) {
  const app = raw.app ?? ctx.app ?? 'web';
  const route = String(raw.route ?? '');
  const sourceRole = raw.role ?? ctx.role ?? null;
  const rec = {
    normalized: true,
    app,
    phase: raw.phase ?? ctx.phase ?? null,
    no: raw.no == null ? null : String(raw.no),
    route,
    width: Number(raw.width),
    theme: raw.theme ?? 'light',
    role: isRoleShared(app, route) ? 'liff' : sourceRole,
    sourceRole,
    group: ctx.group ?? (app === 'shop' ? 'shop' : sourceRole),
    run: ctx.label ?? null,
    status: STATUSES.includes(raw.status) ? raw.status : 'unknown',
    finalPath: raw.finalPath ?? raw.redirectedTo ?? null, // admin finalPath · shop redirectedTo
    error: raw.error ?? raw.reason ?? null, // admin error · shop reason
    screenshot: raw.screenshot ?? null,
  };
  if (Array.isArray(raw.facts)) rec.facts = raw.facts;
  if (typeof raw.readFacts === 'function') rec.readFacts = raw.readFacts;
  return rec;
}

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

export function loadRun(dir, meta = {}) {
  const info = {
    label: meta.label ?? null,
    app: meta.app ?? 'web',
    phase: meta.phase ?? null,
    role: meta.role ?? null,
    dir: meta.displayDir ?? dir ?? null,
    present: false,
    files: 0,
    skipped: 0,
    records: [],
    runStatus: null,
    revision: null,
    revisionSource: null,
  };
  if (!dir || !isDir(dir)) return info;
  const jsonDir = [path.join(dir, 'typography'), path.join(dir, 'shop')].find(isDir) ?? dir;
  info.present = true;
  try {
    const r = readJson(path.join(dir, 'run.json'));
    info.runStatus = r.status ?? null;
    if (r.revision) {
      info.revision = r.revision;
      info.revisionSource = 'run.json';
    }
  } catch {
    /* shop runs have no run.json — pass --revision <label>=<sha> */
  }
  const group = info.app === 'shop' ? 'shop' : info.role;
  for (const file of fs
    .readdirSync(jsonDir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const full = path.join(jsonDir, file);
    let raw = null;
    if (file.startsWith('route-')) {
      try {
        raw = readJson(full);
      } catch {
        raw = null;
      }
    }
    if (!raw || Array.isArray(raw) || typeof raw.route !== 'string') {
      info.skipped++;
      continue;
    } // unmatched.json etc.
    info.files++;
    const { facts: _facts, ...head } = raw;
    const rec = normalizeRecord(
      { ...head, screenshot: null, readFacts: () => readJson(full).facts ?? [] },
      { ...info, group },
    );
    rec.screenshot =
      info.app === 'shop'
        ? path.join(jsonDir, raw.screenshot ?? file.replace(/\.json$/, '.png'))
        : path.join(dir, 'uxui-pages', `route-${rec.no}-${rec.width}-${rec.theme}.png`);
    info.records.push(rec);
  }
  return info;
}

const factsOf = (rec) =>
  Array.isArray(rec.facts)
    ? rec.facts
    : typeof rec.readFacts === 'function'
      ? (rec.readFacts() ?? [])
      : [];
const pairKeyOf = (r) => [r.app, r.no ?? '', r.route, r.width, r.theme, r.role].join('|');
const parseKey = (key) => {
  const s = String(key ?? '');
  const i = s.indexOf('|'),
    j = s.lastIndexOf('|');
  if (i < 0) return { kind: '', keyText: s };
  return { kind: s.slice(0, i), keyText: j > i ? s.slice(i + 1, j) : s.slice(i + 1) };
};
const clip = (t, n) => {
  const s = String(t ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const themeRank = (t) => (t === 'light' ? 0 : 1);
const cmpPairs = (a, b) =>
  a.app.localeCompare(b.app) ||
  String(a.role).localeCompare(String(b.role)) ||
  a.route.localeCompare(b.route) ||
  String(a.no ?? '').localeCompare(String(b.no ?? ''), 'en', { numeric: true }) ||
  b.width - a.width ||
  themeRank(a.theme) - themeRank(b.theme);
const cmpPoints = (a, b) =>
  (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) ||
  b.routeCount - a.routeCount ||
  b.occurrences - a.occurrences ||
  a.rule.localeCompare(b.rule) ||
  b.width - a.width ||
  themeRank(a.theme) - themeRank(b.theme) ||
  a.route.localeCompare(b.route) ||
  a.text.localeCompare(b.text);

// Ruling Z grouping → points: shell groups (≥ shellMin distinct routes) count once; the rest stay
// individual.
export function groupPoints(findings, shellMin = SHELL_MIN_ROUTES) {
  const groups = new Map();
  for (const f of findings) {
    const { kind, keyText } = parseKey(f.key);
    const gk = [f.app, f.rule, f.severity ?? '', kind, keyText, f.width, f.theme, f.role].join('|');
    let g = groups.get(gk);
    if (!g) groups.set(gk, (g = { kind, keyText, items: [], routes: new Set() }));
    g.items.push(f);
    g.routes.add(f.route);
  }
  const point = (f, kind, keyText, items, routes, shell) => ({
    shell,
    rule: f.rule,
    severity: f.severity ?? null,
    escalatedFrom: f.escalatedFrom ?? null,
    app: f.app,
    kind,
    keyText,
    text: f.text ?? '',
    width: f.width,
    theme: f.theme,
    role: f.role,
    route: routes[0],
    routes,
    routeCount: routes.length,
    occurrences: items.length,
    no: f.no ?? null,
    key: f.key,
    detail: f.detail,
    example: f,
    pairKeys: [...new Set(items.map(pairKeyOf))],
  });
  const points = [];
  for (const g of groups.values()) {
    if (g.routes.size >= shellMin) {
      const items = [...g.items].sort((a, b) => a.route.localeCompare(b.route));
      points.push(point(items[0], g.kind, g.keyText, items, [...g.routes].sort(), true));
    } else {
      for (const f of g.items) points.push(point(f, g.kind, g.keyText, [f], [f.route], false));
    }
  }
  return points.sort(cmpPoints);
}

// Run-specific synthetic seed tokens: every docs:check run seeds a fresh database tagged DOCS-<8
// hex> and shows truncated record ids ("b98a5e4a..."). The key text already turns digits into '#',
// but not hex letters, so the same element would pair as added + resolved across runs.
// Canonicalized in the KEY TEXT only (raw text, and so D1's identical-text gate, are untouched);
// dup indices are recomputed on the canonical text.
export const RUN_TOKEN_PATTERNS = [
  // also the token clipped at the 40-character key limit, and e-mail forms
  [/docs-[0-9a-f#]{1,8}/gi, 'DOCS-~'],
  // truncated uuid prefix shown as "b98a5e4a..."
  [/(^|[^0-9a-z#])[0-9a-f#]{8}(?=\.\.\.|…)/gi, '$1~id~'],
];
export const canonicalKeyText = (text) =>
  RUN_TOKEN_PATTERNS.reduce((t, [re, to]) => t.replace(re, to), String(text));
export function canonicalizeFacts(facts) {
  const seen = new Map();
  return resolveKeys(facts).map((k, i) => {
    const { kind, keyText } = parseKey(k);
    const base = `${kind}|${canonicalKeyText(keyText)}`;
    const dup = seen.get(base) ?? 0;
    seen.set(base, dup + 1);
    return { ...facts[i], key: `${base}|${dup}` };
  });
}

const slim = (f) => ({
  rule: f.rule,
  severity: f.severity ?? null,
  app: f.app,
  no: f.no ?? null,
  route: f.route,
  width: f.width,
  theme: f.theme,
  ...(f.kind ? { kind: f.kind } : {}),
  role: f.role,
  key: f.key,
  text: clip(f.text, JSON_TEXT_MAX),
  detail: f.detail,
  ...(f.escalatedFrom ? { escalatedFrom: f.escalatedFrom } : {}),
});
const sum = (points) => points.reduce((a, p) => a + p.occurrences, 0);
const exampleOf = (f) => ({
  app: f.app,
  route: f.route,
  width: f.width,
  text: clip(f.text, MD_TEXT_MAX),
  value: describe(f),
});
// up to n examples with distinct texts, taken from distinct buckets first (e.g. different ratios)
function examples(list, bucketOf = () => '', n = 3) {
  const buckets = [...groupBy(list, bucketOf).values()].sort((a, b) => b.length - a.length);
  const out = [],
    texts = new Set();
  for (let i = 0; out.length < n && buckets.some((b) => b.length > i); i++) {
    for (const b of buckets) {
      const f = b[i];
      if (f && out.length < n && !texts.has(f.text)) {
        texts.add(f.text);
        out.push(exampleOf(f));
      }
    }
  }
  return out;
}
export function houseStyleSplit(findings) {
  const r3 = findings.filter((f) => f.rule === 'R3'),
    r7 = findings.filter((f) => f.rule === 'R7');
  const r3RealP2 = r3.filter((f) => f.severity === 'P2' && !isHouseStyle(f));
  const r7Real = r7.filter((f) => !isHouseStyle(f));
  const mobile = r7Real.filter((f) => f.detail?.min === TOUCH_MIN_MOBILE);
  const desktopLow = r7Real.filter((f) => f.detail?.min === TOUCH_MIN_DESKTOP && f.detail.h < 31.5);
  const other = r7Real.filter((f) => !mobile.includes(f) && !desktopLow.includes(f));
  return {
    scope: 'persisting + new (added and escalated)',
    R3: {
      definition: HOUSE_STYLE.R3,
      houseStyle: r3.filter(isHouseStyle).length,
      realP2: r3RealP2.length,
      realP1: r3.filter((f) => f.severity === 'P1').length,
      examples: {
        realP2: examples(r3RealP2, (f) => r1(f.detail?.ratio, 2)),
        realP1: examples(r3.filter((f) => f.severity === 'P1')),
      },
    },
    R7: {
      definition: HOUSE_STYLE.R7,
      houseStyle: r7.filter(isHouseStyle).length,
      realMobileBelow44: mobile.length,
      realDesktopBelow32: desktopLow.length,
      realDesktopOther: other.length,
      examples: {
        mobileBelow44: examples(mobile, (f) => f.route),
        desktopBelow32: examples(desktopLow, (f) => f.route),
        desktopOther: examples(other, (f) => f.route),
      },
    },
  };
}
const STATUS_COLUMNS = [...STATUSES, 'unknown'];
const emptyStatusCounts = () =>
  Object.fromEntries([...STATUSES, 'unknown', 'total'].map((s) => [s, 0]));

// ── summarize ───────────────────────────────────────────────────────────────────────────────────
export function summarize(runs, opts = {}) {
  const shellMin = opts.shellMinRoutes ?? SHELL_MIN_ROUTES;
  const sources = runs.map((r) => ({
    label: r.label ?? null,
    app: r.app ?? 'web',
    phase: r.phase ?? null,
    role: r.role ?? null,
    dir: r.dir ?? null,
    present: r.present !== false,
    files: r.files ?? (r.records ?? []).length,
    skipped: r.skipped ?? 0,
    runStatus: r.runStatus ?? null,
    revision: r.revision ?? null,
    revisionSource: r.revisionSource ?? (r.revision ? 'given' : null),
    records: 0,
    sharedDuplicates: 0,
  }));
  const missingRuns = sources
    .filter((s) => !s.present)
    .map(({ label, dir, app, phase, role }) => ({ label, dir, app, phase, role }));

  // 1. index records into BEFORE/AFTER slots (LIFF rows from the second role run are duplicates)
  const slots = new Map();
  let sharedDuplicates = 0;
  runs.forEach((r, src) => {
    if (r.present === false) return;
    const ctx = {
      app: r.app,
      phase: r.phase,
      role: r.role,
      label: r.label,
      group: (r.app ?? 'web') === 'shop' ? 'shop' : r.role,
    };
    for (const raw of r.records ?? []) {
      const rec = { ...(raw.normalized ? raw : normalizeRecord(raw, ctx)), src };
      const k = pairKeyOf(rec);
      const slot = slots.get(k) ?? {};
      const held = slot[rec.phase];
      if (held) {
        sharedDuplicates++;
        if (held.status === 'rendered' || rec.status !== 'rendered') {
          sources[src].sharedDuplicates++;
          continue;
        }
        sources[held.src].records--;
        sources[held.src].sharedDuplicates++; // a rendered duplicate replaces a non-rendered one
      }
      sources[src].records++;
      slot[rec.phase] = rec;
      slots.set(k, slot);
    }
  });
  const hasRun = (phase, rec) =>
    sources.some(
      (s) =>
        s.present &&
        s.app === rec.app &&
        s.phase === phase &&
        (rec.app === 'shop' || rec.role === 'liff' || s.role === rec.group),
    );

  // 2. per pair: evaluate, diff, compare (facts are read here and dropped after the pair)
  const records = {};
  const measured = { before: 0, after: 0 };
  const uncovered = {
    roles: [...UNMEASURED_ROLES],
    documentRoutes: [],
    blocked: [],
    errors: [],
    unpaired: [],
    missingRuns,
  };
  const documentRoutes = new Set();
  const pathRows = new Map();
  const cats = { added: [], escalated: [], persisting: [], resolved: [], D1: [], D2: [], R8: [] };
  const seen = Object.fromEntries(Object.keys(cats).map((k) => [k, new Set()]));
  const push = (cat, f) => {
    const id = `${f.app}|${findingKey(f)}`;
    if (seen[cat].has(id)) return false;
    seen[cat].add(id);
    cats[cat].push(f);
    return true;
  };
  const routes = [];
  const pairIndex = new Map();
  let pairsCompared = 0,
    noiseExcluded = 0,
    afterUnpairedFindings = 0;

  const pairs = [...slots.values()]
    .map((s) => ({ ...s, base: s.after ?? s.before }))
    .sort((a, b) => cmpPairs(a.base, b.base));
  for (const { before, after, base } of pairs) {
    for (const rec of [before, after].filter(Boolean)) {
      const byRole = ((records[rec.app] ??= {})[rec.phase] ??= {});
      const c = (byRole[rec.role] ??= emptyStatusCounts());
      c[rec.status]++;
      c.total++;
      if (rec.status === 'rendered') measured[rec.phase] = (measured[rec.phase] ?? 0) + 1;
      if (rec.status === 'document') documentRoutes.add(rec.route);
      if (rec.status === 'blocked')
        uncovered.blocked.push({
          app: rec.app,
          phase: rec.phase,
          route: rec.route,
          width: rec.width,
          theme: rec.theme,
          role: rec.role,
          reason: rec.error,
        });
      if (rec.status === 'error' || rec.status === 'empty' || rec.status === 'unknown') {
        uncovered.errors.push({
          app: rec.app,
          phase: rec.phase,
          route: rec.route,
          width: rec.width,
          theme: rec.theme,
          role: rec.role,
          status: rec.status,
          reason: rec.error,
        });
      }
      if (rec.no != null) {
        const k = `${rec.app}|${rec.route}`;
        (pathRows.get(k) ?? pathRows.set(k, new Set()).get(k)).add(rec.no);
      }
    }
    const ctx = {
      app: base.app,
      route: base.route,
      width: base.width,
      theme: base.theme,
      role: base.role,
    };
    const entry = {
      app: base.app,
      no: base.no,
      route: base.route,
      width: base.width,
      theme: base.theme,
      role: base.role,
      status: after?.status ?? before?.status,
      beforeStatus: before?.status ?? null,
      afterStatus: after?.status ?? null,
      counts: {
        new: { P1: 0, P2: 0, P3: 0 },
        escalated: 0,
        persisting: 0,
        resolved: 0,
        D1: 0,
        D2: 0,
        R8: 0,
      },
      screenshots: { before: before?.screenshot ?? null, after: after?.screenshot ?? null },
      sheet: { new: [], deltas: [] },
    };
    routes.push(entry);
    pairIndex.set(pairKeyOf(base), entry);
    const tag = (f) => ({ ...f, app: base.app, no: base.no });
    const afterFacts = after?.status === 'rendered' ? canonicalizeFacts(factsOf(after)) : null;
    const beforeFacts = before?.status === 'rendered' ? canonicalizeFacts(factsOf(before)) : null;
    const afterFindings = afterFacts ? evaluateTypography(afterFacts, ctx).map(tag) : [];
    for (const f of afterFindings)
      if (f.rule === 'R8') {
        entry.counts.R8++;
        push('R8', slim(f));
      }
    if (afterFacts && beforeFacts) {
      pairsCompared++;
      // R8 excluded (Ruling J)
      const d = diffFindings(evaluateTypography(beforeFacts, ctx).map(tag), afterFindings);
      const esc = new Set(d.escalated.map(findingKey));
      for (const f of d.added) {
        entry.counts.new[f.severity]++;
        push('added', slim(f));
        if (f.severity !== 'P3') entry.sheet.new.push(f);
      }
      for (const f of d.escalated) {
        const e = { ...f, escalatedFrom: f.before.severity };
        entry.counts.new[f.severity]++;
        entry.counts.escalated++;
        push('escalated', slim(e));
        if (f.severity !== 'P3') entry.sheet.new.push(e);
      }
      for (const f of d.persisting)
        if (!esc.has(findingKey(f))) {
          entry.counts.persisting++;
          push('persisting', slim(f));
        }
      for (const f of d.resolved) {
        entry.counts.resolved++;
        push('resolved', slim(f));
      }
      const deltas = compareFacts(beforeFacts, afterFacts, ctx).map(tag);
      if (KNOWN_NOISE_ROUTES.includes(base.route)) noiseExcluded += deltas.length;
      else
        for (const x of deltas) {
          entry.counts[x.rule]++;
          push(x.rule, slim(x));
          entry.sheet.deltas.push(x);
        }
    } else {
      const side = (rec, phase) => rec?.status ?? (hasRun(phase, base) ? 'missing' : 'missing-run');
      uncovered.unpaired.push({
        app: base.app,
        no: base.no,
        route: base.route,
        width: base.width,
        theme: base.theme,
        role: base.role,
        before: side(before, 'before'),
        after: side(after, 'after'),
        reason: after?.error ?? before?.error ?? null,
        finalPath: after?.finalPath ?? before?.finalPath ?? null,
      });
      if (afterFacts) afterUnpairedFindings += afterFindings.filter((f) => f.rule !== 'R8').length;
    }
  }
  uncovered.documentRoutes = [...documentRoutes].sort();

  // Inventory rows sharing a path are separate measurements (different entry point / fact counts).
  // Across rows a finding counts once: escalated beats persisting, and an existing finding
  // (persisting/escalated) beats added/resolved — it already existed in at least one measurement
  // (fix round 1, ruling 2).
  const pid = (f) => `${f.app}|${findingKey(f)}`;
  const escIds = new Set(cats.escalated.map(pid));
  const crossRowPrecedence = {};
  const drop = (cat, ids) => {
    const n0 = cats[cat].length;
    cats[cat] = cats[cat].filter((f) => !ids.has(pid(f)));
    crossRowPrecedence[cat] = n0 - cats[cat].length;
  };
  drop('persisting', escIds);
  const existing = new Set([...cats.persisting.map(pid), ...escIds]);
  drop('added', existing);
  drop('resolved', existing);

  // 3. points (Ruling Z) and totals
  const bySev = (list, s) => list.filter((f) => f.severity === s);
  const groups = {
    new: Object.fromEntries(
      SEVERITIES.map((s) => [
        s,
        [
          ...groupPoints(bySev(cats.added, s), shellMin),
          ...groupPoints(bySev(cats.escalated, s), shellMin),
        ].sort(cmpPoints),
      ]),
    ),
    added: groupPoints(cats.added, shellMin),
    escalated: groupPoints(cats.escalated, shellMin),
    deltas: { D1: groupPoints(cats.D1, shellMin), D2: groupPoints(cats.D2, shellMin) },
    persisting: groupPoints(cats.persisting, shellMin),
    resolved: groupPoints(cats.resolved, shellMin),
    r8: groupPoints(cats.R8, shellMin),
  };
  const byRule = (points, findings) => {
    const out = {};
    for (const p of points) {
      const r = (out[p.rule] ??= { findings: 0, points: 0, routes: new Set(), bySeverity: {} });
      r.findings += p.occurrences;
      r.points++;
      p.routes.forEach((x) => r.routes.add(`${p.app}|${x}`));
      r.bySeverity[p.severity] = (r.bySeverity[p.severity] ?? 0) + p.occurrences;
    }
    for (const r of Object.values(out)) r.routes = r.routes.size;
    for (const f of findings)
      if (isHouseStyle(f) && out[f.rule])
        out[f.rule].houseStyle = (out[f.rule].houseStyle ?? 0) + 1;
    return Object.fromEntries(
      Object.entries(out).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
    );
  };
  const median = (xs) => {
    if (!xs.length) return null;
    const a = [...xs].sort((x, y) => x - y),
      m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const runVarying = (list) => list.filter((f) => isRunVarying(f.route)).length;
  const totals = {
    records,
    measured,
    pairsCompared,
    sharedDuplicates,
    afterUnpairedFindings,
    crossRowPrecedence,
    houseStyle: houseStyleSplit([...cats.persisting, ...cats.added, ...cats.escalated]),
    unpaired: uncovered.unpaired.length,
    duplicateRoutePaths: [...pathRows.entries()]
      .filter(([, s]) => s.size > 1)
      .map(([k, s]) => ({
        route: k.split('|').slice(1).join('|'),
        rows: [...s].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
      })),
    new: {
      ...Object.fromEntries(
        SEVERITIES.map((s) => [s, { points: groups.new[s].length, findings: sum(groups.new[s]) }]),
      ),
      runVarying: runVarying(cats.added) + runVarying(cats.escalated),
    },
    escalated: { points: groups.escalated.length, findings: cats.escalated.length },
    deltas: {
      D1: {
        points: groups.deltas.D1.length,
        findings: cats.D1.length,
        wider: cats.D1.filter((d) => d.detail.change > 0).length,
        narrower: cats.D1.filter((d) => d.detail.change < 0).length,
        medianChangePct: round1(median(cats.D1.map((d) => d.detail.change * 100))),
      },
      D2: {
        points: groups.deltas.D2.length,
        findings: cats.D2.length,
        // offset = ink centre − box centre (px, y grows downward): negative = ink sits above the
        // centre
        aboveCentre: cats.D2.filter((d) => d.detail.afterOffset < 0).length,
        belowCentre: cats.D2.filter((d) => d.detail.afterOffset > 0).length,
        medianAfterOffsetPx: round1(median(cats.D2.map((d) => d.detail.afterOffset))),
        medianShiftPx: round1(
          median(cats.D2.map((d) => d.detail.afterOffset - d.detail.beforeOffset)),
        ),
      },
      noiseExcluded,
    },
    persisting: {
      points: groups.persisting.length,
      findings: cats.persisting.length,
      byRule: byRule(groups.persisting, cats.persisting),
    },
    resolved: {
      points: groups.resolved.length,
      findings: cats.resolved.length,
      runVarying: runVarying(cats.resolved),
      byRule: byRule(groups.resolved, cats.resolved),
    },
    afterOnlyR8: { points: groups.r8.length, findings: cats.R8.length },
  };

  // 4. top 30 (never the font check — Ruling J): new P1 → new P2 → new P3 → D1/D2 (alternating, so
  // one systematic shift cannot crowd out the other) → pre-existing → new/delta points that sit
  // only on run-varying pages (※)
  const deltaMag = (p) => Math.abs(p.detail?.change ?? p.detail?.afterOffset ?? 0);
  const dSort = (a, b) =>
    b.routeCount - a.routeCount ||
    b.occurrences - a.occurrences ||
    deltaMag(b) - deltaMag(a) ||
    cmpPoints(a, b);
  const d1s = [...groups.deltas.D1].sort(dSort),
    d2s = [...groups.deltas.D2].sort(dSort);
  const deltaPoints = [];
  for (let i = 0; i < Math.max(d1s.length, d2s.length); i++)
    deltaPoints.push(...[d1s[i], d2s[i]].filter(Boolean));
  const noisy = (p) => p.routes.every(isRunVarying);
  const ranked = [
    ...SEVERITIES.flatMap((s) => groups.new[s].map((p) => ({ tier: 'new', p }))),
    ...deltaPoints.map((p) => ({ tier: 'delta', p })),
  ];
  const fontCaused = ranked.filter(({ p }) => !noisy(p));
  // pre-existing P1 groups keep up to PRE_P1_RESERVE slots, interleaved by rule so every P1 rule
  // appears (ruling 8)
  const byRuleP1 = [
    ...groupBy(
      groups.persisting.filter((p) => p.severity === 'P1'),
      (p) => p.rule,
    ).entries(),
  ]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([, list]) => list);
  const preP1 = [];
  for (let i = 0; byRuleP1.some((l) => l.length > i); i++)
    for (const l of byRuleP1) if (l[i]) preP1.push(l[i]);
  const head = TOP_N - Math.min(PRE_P1_RESERVE, preP1.length);
  const tiers = [
    ...fontCaused.slice(0, head),
    ...preP1.map((p) => ({ tier: 'persisting-p1', p })),
    ...fontCaused.slice(head),
    ...groups.persisting.filter((p) => p.severity !== 'P1').map((p) => ({ tier: 'persisting', p })),
    ...ranked.filter(({ p }) => noisy(p)).map(({ p }) => ({ tier: 'run-varying', p })),
  ];
  const top30 = tiers.slice(0, TOP_N).map(({ tier, p }, i) => ({ rank: i + 1, tier, ...p }));

  return {
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    shellMinRoutes: shellMin,
    sources,
    routes,
    totals,
    uncovered,
    groups,
    top30,
    pairIndex,
    preP1,
    added: cats.added,
    escalated: cats.escalated,
    persisting: cats.persisting,
    resolved: cats.resolved,
    deltas: { D1: cats.D1, D2: cats.D2 },
    afterOnlyR8: cats.R8,
  };
}

// ── shared formatting ───────────────────────────────────────────────────────────────────────────
const n = (x) => Number(x ?? 0).toLocaleString('en-US');
const r1 = (x, d = 1) => (Number.isFinite(x) ? String(Math.round(x * 10 ** d) / 10 ** d) : '—');
export function describe(f) {
  const d = f.detail ?? {};
  switch (f.rule) {
    case 'R1':
      return `ขนาด ${r1(d.fontSize)}px`;
    case 'R2':
      return `h${d.headingLevel} ${r1(d.fontSize)}px > h1 ${r1(d.h1FontSize)}px`;
    case 'R3':
      return `ระยะบรรทัด ×${r1(d.ratio, 2)} (${r1(d.lineHeight)}/${r1(d.fontSize)}px)`;
    case 'R4':
      return d.scrollOverflowY
        ? 'เนื้อหาล้นกล่องแนวตั้ง'
        : `หมึกสูง ${r1(d.inkHeight)}px > บรรทัด ${r1(d.lineHeight)}px`;
    case 'R5':
      return `ขึ้น ${d.lines} บรรทัด (${d.kind})`;
    case 'R6':
      return `ถูกตัดแนวนอน (${d.kind})`;
    case 'R7':
      return `สูง ${r1(d.h)}px < ${d.min}px (${d.kind})`;
    case 'R7b':
      return `ตัวอักษร ${r1(d.fontSize)}px < ${d.min}px`;
    case 'R8':
      return `ฟอนต์ ${clip(String(d.fontFamily ?? '').split(',')[0], 40)}`;
    case 'R9':
      return `น้ำหนัก ${d.fontWeight}`;
    case 'R10':
      return `ไม่มี tabular-nums (${d.tag}, ${r1(d.fontSize)}px)`;
    case 'R11':
      return `ไอคอน ×${(d.outOfRange ?? []).map((x) => r1(x, 2)).join(', ')}`;
    case 'R12':
      return `กว้าง ${r1(d.em)}em > ${d.maxEm}em`;
    case 'D1':
      return `ความกว้างหมึก ${r1(d.before)} → ${r1(d.after)}px (${d.change > 0 ? '+' : ''}${r1((d.change ?? 0) * 100)}%)`;
    case 'D2':
      return `เยื้องจากกึ่งกลาง ${r1(d.beforeOffset)} → ${r1(d.afterOffset)}px`;
    default:
      return '';
  }
}
const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const roleShort = (r) => (r === 'liff' ? 'LIFF' : (r ?? '—'));
const relShot = (p, base) =>
  !p ? null : base ? path.relative(base, p).split(path.sep).join('/') : path.basename(p);
// summary.md / findings.json name a screenshot as <run folder>/<sub>/<file> — i.e. relative to
// .tmp/typo-audit/, never a local absolute or escaping path (public repo)
const shotName = (p) => (!p ? null : String(p).split(/[\\/]/).filter(Boolean).slice(-3).join('/'));
const where = (p) =>
  p.shell
    ? `ส่วนร่วม ${p.routeCount} หน้า เช่น ${p.routes.slice(0, 3).map(code).join(', ')}`
    : `${code(p.route)}${isRunVarying(p.route) ? ' ※' : ''}`;
const runVaryingNote = (count) =>
  count
    ? `※ หน้าที่ข้อมูลเปลี่ยนทุกรอบ (${Object.entries(RUN_VARYING_ROUTES)
        .map(([r, why]) => `${code(r)} ${why}`)
        .join(
          ' · ',
        )}) — ตัวเลขที่ต่างกันระหว่างรอบทำให้นับเป็นใหม่/หายไปได้ทั้งที่ไม่เกี่ยวกับฟอนต์ · หัวข้อนี้มี ${n(count)} ครั้งบนหน้าเหล่านี้\n`
    : '';
const shotOf = (s, p, phase) =>
  shotName(s.pairIndex?.get(pairKeyOf(p.example ?? p))?.screenshots?.[phase] ?? null);

function pointsTable(s, points, { limit = MD_TABLE_LIMIT, phase = 'after', tier = false } = {}) {
  if (!points.length) return '_ไม่มี_\n';
  const head = `| # | ${tier ? 'ประเภท | ' : ''}กฎ | ระดับ | แอป | หน้า | กว้าง | ธีม | role | ข้อความ | ค่าที่วัด | ภาพ |\n|---|${tier ? '---|' : ''}---|---|---|---|---|---|---|---|---|---|\n`;
  const rows = points.slice(0, limit).map((p, i) => {
    const sev = p.escalatedFrom ? `${p.escalatedFrom} → ${p.severity}` : (p.severity ?? '—');
    const tierCell = tier
      ? `${{ new: p.escalatedFrom ? 'เพิ่มระดับ' : 'ใหม่', delta: 'ดูด้วยตา', 'persisting-p1': 'มีอยู่ก่อน (P1)', persisting: 'มีอยู่ก่อน', 'run-varying': 'ใหม่ ※ ข้อมูลเปลี่ยนทุกรอบ' }[p.tier]} | `
      : '';
    const occ = p.shell && p.occurrences > p.routeCount ? ` (${n(p.occurrences)} ครั้ง)` : '';
    return `| ${i + 1} | ${tierCell}${p.rule} | ${sev} | ${APP_TH[p.app] ?? p.app} | ${cell(where(p))}${occ} | ${p.width} | ${p.theme} | ${roleShort(p.role)} | ${cell(clip(p.text, MD_TEXT_MAX))} | ${cell(describe(p))} | ${cell(shotOf(s, p, phase) ?? '—')} |`;
  });
  const more =
    points.length > limit
      ? `\n… อีก ${n(points.length - limit)} จุด — ดูทั้งหมดใน \`findings.json\`\n`
      : '';
  return `${head}${rows.join('\n')}\n${more}`;
}

const groupBy = (list, keyFn) => {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    (m.get(k) ?? m.set(k, []).get(k)).push(x);
  }
  return m;
};
const combo = (x) => `${x.width} ${x.theme} ${roleShort(x.role)}`;
const phaseTh = (p) => (p === 'before' ? 'ก่อน' : 'หลัง');

// ── summary.md ──────────────────────────────────────────────────────────────────────────────────
export function renderSummary(s) {
  const t = s.totals;
  const L = [];
  const newPts = SEVERITIES.reduce((a, x) => a + t.new[x].points, 0);
  const newFind = SEVERITIES.reduce((a, x) => a + t.new[x].findings, 0);
  L.push('# รายงานตรวจสเกลและสัดส่วนตัวอักษร ก่อน/หลังเปลี่ยนเป็น Noto Sans Thai (2026-11)', '');
  L.push(
    `สร้างเมื่อ ${String(s.generatedAt).slice(0, 10)} ด้วย \`node tools/typography-audit/report.mjs\` · ข้อมูลทั้งหมดเป็นข้อมูลจำลองของชุดทดสอบ (ไม่มีข้อมูลลูกค้าจริง) · ภาพหน้าจอและ contact sheet อยู่ใน \`.tmp/typo-audit/\` (ไม่ commit) — ชื่อภาพในตารางนับจากโฟลเดอร์นั้น`,
    '',
  );
  const revs = (phase) => {
    const list = [
      ...new Set(
        s.sources
          .filter((x) => x.present && x.phase === phase && x.revision)
          .map((x) => x.revision.slice(0, 9)),
      ),
    ];
    return list.length ? list.map(code).join(', ') : 'ไม่ทราบ commit';
  };
  L.push(
    `**อ่านอย่างไร** — "ก่อน" = commit ${revs('before')} (ฟอนต์เดิม Noto Sans Thai Looped) · "หลัง" = commit ${revs('after')} (Noto Sans Thai แบบไม่มีหัว — commit ที่รันเครื่องมือตรวจ แยกตามโฟลเดอร์ในตาราง "จำนวนที่วัด") · วัดด้วยเบราว์เซอร์จริงทุกหน้า × ความกว้าง 1440/390/320 × ธีมสว่าง/มืด (หน้าร้านมีแต่ธีมสว่าง) แล้วจับคู่หน้าเดียวกันก่อน/หลังมาเทียบ`,
  );
  L.push(
    `ระดับ: **P1 ต้องแก้** · **P2 ควรแก้** · **P3 ขัดเกลา** · "ครั้ง" = จำนวนที่พบจริงทุกหน้า · "จุด" = นับปัญหาเดียวกัน (กฎ+ชนิด+ข้อความ+ความกว้าง+ธีม+role เดียวกัน) ที่ซ้ำตั้งแต่ ${s.shellMinRoutes} หน้าขึ้นไปเป็น 1 จุด — คือส่วนที่ใช้ร่วมทุกหน้า เช่น เมนูซ้าย หัวหน้า เมนูล่าง หรือคอมโพเนนต์ร่วม · role: ${ROLE_LEGEND}`,
    '',
  );

  L.push('## สรุปสั้น', '');
  L.push(
    `- **เกิดจากฟอนต์ใหม่** ${n(newPts)} จุด (${n(newFind)} ครั้ง): P1 ${n(t.new.P1.points)} จุด (${n(t.new.P1.findings)} ครั้ง) · P2 ${n(t.new.P2.points)} จุด (${n(t.new.P2.findings)} ครั้ง) · P3 ${n(t.new.P3.points)} จุด (${n(t.new.P3.findings)} ครั้ง) — ในจำนวนนี้ "มีอยู่แล้วแต่ระดับสูงขึ้น" ${n(t.escalated.points)} จุด (${n(t.escalated.findings)} ครั้ง)${t.new.runVarying ? ` · อยู่บนหน้าที่ข้อมูลเปลี่ยนทุกรอบ ${n(t.new.runVarying)} ครั้ง (※ น่าจะเป็นสัญญาณรบกวน)` : ''}`,
  );
  L.push(
    `- **ควรดูด้วยตา** (ไม่ใช่ระดับปัญหา): ความกว้างเปลี่ยนเกิน 8% (D1) ${n(t.deltas.D1.points)} จุด (${n(t.deltas.D1.findings)} ครั้ง) · ตัวอักษรเยื้องในปุ่ม (D2) ${n(t.deltas.D2.points)} จุด (${n(t.deltas.D2.findings)} ครั้ง)`,
  );
  const hs = t.houseStyle;
  L.push(
    `- **มีอยู่ก่อนแล้ว** (ไม่เกี่ยวกับฟอนต์ใหม่) ${n(t.persisting.points)} จุด (${n(t.persisting.findings)} ครั้ง) — ในนี้ ${n(hs.R3.houseStyle + hs.R7.houseStyle)} ครั้งเป็นแบบที่บ้านกำหนด (ระยะบรรทัด leading-snug ${n(hs.R3.houseStyle)} · ปุ่มจอใหญ่สูง 32–34px ${n(hs.R7.houseStyle)}) ให้เจ้าของตัดสิน ไม่ใช่ข้อบกพร่อง · **หายไปหลังเปลี่ยน** ${n(t.resolved.points)} จุด (${n(t.resolved.findings)} ครั้ง)`,
  );
  L.push(
    `- **ฟอนต์ผิดในรอบหลัง** ${n(t.afterOnlyR8.points)} จุด (${n(t.afterOnlyR8.findings)} ครั้ง) — ดูหัวข้อ "AFTER เท่านั้น"`,
  );
  L.push(
    `- จับคู่เทียบได้ ${n(t.pairsCompared)} ชุด (หน้า × ความกว้าง × ธีม × role) · เทียบไม่ได้ ${n(t.unpaired)} ชุด — ดูหัวข้อ "ตรวจไม่ได้/ไม่วัด"`,
    '',
  );

  // coverage
  L.push('## จำนวนที่วัด (หน้า × ความกว้าง × ธีม × role)', '');
  L.push(
    '| โฟลเดอร์ | มีไหม | ไฟล์ JSON | ใช้ | ซ้ำ (LIFF) | ข้าม | ผลรัน | commit |',
    '|---|---|---|---|---|---|---|---|',
  );
  for (const x of s.sources) {
    L.push(
      `| ${code(x.dir ?? x.label)} (${x.label}) | ${x.present ? 'มี' : '**ไม่มี**'} | ${n(x.files)} | ${n(x.records)} | ${n(x.sharedDuplicates)} | ${n(x.skipped)} | ${x.runStatus ?? '—'} | ${x.revision ? `${code(x.revision.slice(0, 9))}${x.revisionSource === 'run.json' ? '' : ` (${x.revisionSource === 'cli' ? 'ระบุตอนรัน' : x.revisionSource})`}` : '—'} |`,
    );
  }
  L.push(
    '',
    '"ใช้" = แถวที่เข้ารายงาน · "ซ้ำ (LIFF)" = หน้า LIFF ที่วัดซ้ำในรอบ role ที่สอง (session ลูกค้าจำลองเดียวกัน) นับครั้งเดียว · "ข้าม" = ไฟล์ที่ไม่ใช่ผลของหน้า (เช่น `unmatched.json`) · commit มาจาก `run.json` ของรอบนั้น; หน้าร้านไม่มี `run.json` จึง "ระบุตอนรัน" (`--revision`)',
    '',
  );
  for (const app of Object.keys(t.records).sort()) {
    L.push(`### ${APP_TH[app] ?? app}`, '');
    L.push(
      `| รอบ | role | ${STATUS_COLUMNS.map((x) => STATUS_TH[x]).join(' | ')} | รวม |`,
      `|---|---|${STATUS_COLUMNS.map(() => '---|').join('')}---|`,
    );
    for (const phase of ['before', 'after']) {
      for (const [role, c] of Object.entries(t.records[app][phase] ?? {}).sort()) {
        L.push(
          `| ${phaseTh(phase)} | ${roleShort(role)} | ${STATUS_COLUMNS.map((x) => n(c[x])).join(' | ')} | ${n(c.total)} |`,
        );
      }
    }
    L.push('');
  }
  L.push(
    `นับเป็น "วัดได้" เฉพาะสถานะ ${code('rendered')} เท่านั้น — สถานะอื่นไม่นับว่าผ่าน · ก่อน ${n(t.measured.before)} · หลัง ${n(t.measured.after)} ชุด`,
    '',
  );

  // uncovered
  const u = s.uncovered;
  L.push('## ตรวจไม่ได้/ไม่วัด', '');
  L.push(
    `- **role ที่ไม่ได้วัด:** ${u.roles.join(', ')} — วัดเฉพาะ owner และ salesA (เมนู/การ์ดต่างกันตาม role)`,
  );
  L.push(
    `- **หน้าเอกสาร (ไม่วัดตามข้อกำหนด — ใบเสร็จ/ป้ายพัสดุ/สติกเกอร์/หน้าตรวจเอกสาร):** ${u.documentRoutes.length ? `${u.documentRoutes.length} เส้นทาง ${u.documentRoutes.map(code).join(', ')}` : 'ไม่มี'}`,
  );
  L.push(`- **ถูกกัน (blocked):** ${u.blocked.length ? `${n(u.blocked.length)} ชุด` : 'ไม่มี'}`);
  for (const b of u.blocked.slice(0, MD_TABLE_LIMIT))
    L.push(
      `  - ${APP_TH[b.app] ?? b.app} ${code(b.route)} ${combo(b)} (${phaseTh(b.phase)}): ${cell(b.reason ?? 'ไม่ระบุเหตุผล')}`,
    );
  L.push(`- **ผิดพลาด/หน้าว่าง:** ${u.errors.length ? `${n(u.errors.length)} ชุด` : 'ไม่มี'}`);
  for (const e of u.errors.slice(0, MD_TABLE_LIMIT))
    L.push(
      `  - ${APP_TH[e.app] ?? e.app} ${code(e.route)} ${combo(e)} (${phaseTh(e.phase)}) ${STATUS_TH[e.status]}: ${cell(clip(e.reason ?? 'ไม่ระบุ', 160))}`,
    );
  if (u.errors.length > MD_TABLE_LIMIT)
    L.push(
      `  - … อีก ${n(u.errors.length - MD_TABLE_LIMIT)} รายการ — ดู \`findings.json\` → \`uncovered.errors\``,
    );
  L.push(
    `- **โฟลเดอร์ผลที่ไม่มี:** ${u.missingRuns.length ? u.missingRuns.map((m) => `${m.label}${m.dir ? ` (${code(m.dir)})` : ''}`).join(', ') : 'ไม่มี — ครบทั้ง 6 โฟลเดอร์'}`,
  );
  L.push('');
  L.push('### เทียบก่อน/หลังไม่ได้ (ฝั่งใดฝั่งหนึ่งไม่ใช่ "วัดได้")', '');
  if (!u.unpaired.length) L.push('_ไม่มี — ทุกชุดเทียบได้_', '');
  else {
    L.push('| แอป | role | ก่อน → หลัง | ชุด | ตัวอย่างหน้า |', '|---|---|---|---|---|');
    const g = [
      ...groupBy(u.unpaired, (x) => `${x.app}|${x.role}|${x.before}|${x.after}`).values(),
    ].sort((a, b) => b.length - a.length);
    for (const list of g) {
      const x = list[0];
      const sample = [...new Set(list.map((y) => y.route))];
      L.push(
        `| ${APP_TH[x.app] ?? x.app} | ${roleShort(x.role)} | ${STATUS_TH[x.before] ?? x.before} → ${STATUS_TH[x.after] ?? x.after} | ${n(list.length)} | ${cell(sample.slice(0, 6).map(code).join(', '))}${sample.length > 6 ? ` และอีก ${sample.length - 6} หน้า` : ''} |`,
      );
    }
    L.push('');
    const changed = u.unpaired.filter(
      (x) =>
        x.before !== x.after &&
        !String(x.before).startsWith('missing') &&
        !String(x.after).startsWith('missing'),
    );
    L.push(
      `**สถานะเปลี่ยนระหว่างก่อน/หลัง (ต้องดู):** ${changed.length ? `${n(changed.length)} ชุด` : 'ไม่มี — ทุกชุดที่เทียบไม่ได้มีสถานะเดียวกันทั้งก่อนและหลัง (เช่น salesA ถูกพาออกจากหน้าที่เป็นของ owner — เป็นปกติ ไม่ใช่ข้อผิดพลาด)'}`,
    );
    for (const x of changed.slice(0, MD_TABLE_LIMIT))
      L.push(
        `- ${APP_TH[x.app] ?? x.app} ${code(x.route)} ${combo(x)}: ${STATUS_TH[x.before] ?? x.before} → ${STATUS_TH[x.after] ?? x.after}${x.reason ? ` — ${cell(clip(x.reason, 160))}` : ''}`,
      );
    if (changed.length > MD_TABLE_LIMIT)
      L.push(
        `- … อีก ${n(changed.length - MD_TABLE_LIMIT)} ชุด — ดู \`findings.json\` → \`uncovered.unpaired\``,
      );
    if (t.afterUnpairedFindings)
      L.push(
        '',
        `รอบหลังของชุดที่ไม่มีคู่ก่อนให้เทียบพบ ${n(t.afterUnpairedFindings)} ครั้ง — ไม่จัดเป็นใหม่หรือมีอยู่ก่อน (เทียบไม่ได้)`,
      );
    L.push('');
  }
  L.push('### หมายเหตุขอบเขต', '');
  L.push(
    '- salesA ถูกพาไปหน้าอื่นบนหน้าที่เป็นของ owner (เช่น ตั้งค่า บัญชี) — เป็นสิทธิ์ตามปกติ ไม่ใช่ข้อผิดพลาด',
  );
  L.push('- หน้า `/kiosk` วัดได้เฉพาะหน้าลงทะเบียนเครื่อง (ไม่มีเครื่องที่จับคู่ไว้ในชุดทดสอบ)');
  L.push(
    '- หน้า LIFF วัดด้วย session ลูกค้าจำลองเดียวกันทั้งสองรอบ role จึงรายงานครั้งเดียวใต้ role "LIFF"',
  );
  if (t.duplicateRoutePaths.length) {
    const cr = t.crossRowPrecedence;
    L.push(
      `- ${t.duplicateRoutePaths.length} เส้นทางอยู่ในรายการหน้าสองแถว เข้าจากคนละทาง จึงเป็นการวัดแยกกันสองครั้ง (จำนวนข้อความ/ปลายทางต่างกันได้) — นับทั้งสองแถวในตารางจำนวน แต่ปัญหา key เดียวกันนับครั้งเดียว และถ้าแถวหนึ่ง "มีอยู่ก่อน" อีกแถว "ใหม่/หายไป" นับเป็นมีอยู่ก่อน (ตัดออก ใหม่ ${n(cr.added)} · หายไป ${n(cr.resolved)} · มีอยู่ก่อนที่อีกแถวระดับสูงขึ้น ${n(cr.persisting)}): ${t.duplicateRoutePaths.map((d) => code(`${d.route} (${d.rows.join(', ')})`)).join(', ')}`,
    );
  }
  L.push(
    '- **ข้อจำกัดของเครื่องมือ:** ตัวอ่านรายการหน้า (`routes.mjs`) จะมองไม่เห็น `<Route>` ที่อยู่ใน `{expression}` (เงื่อนไข/วนลูป) หรือถ้ามีคำว่า `<Routes` ในคอมเมนต์ก่อนหน้า — รอบปรับให้ทนทานถูกพักไว้ตามคำสั่งเจ้าของ · รายการวันนี้ตรวจแยกแล้วว่าครบทุกหน้า',
    '',
  );

  // new
  L.push('## เกิดจากฟอนต์ใหม่ (มีในรอบหลังแต่ไม่มีในรอบก่อน หรือระดับสูงขึ้น)', '');
  L.push(
    'เรียงตามระดับ แล้วตามจำนวนหน้าที่ได้รับผล · แถวที่ระดับเขียนว่า "P2 → P1" คือมีอยู่แล้วแต่ฟอนต์ใหม่ทำให้หนักขึ้น',
    '',
  );
  for (const sev of SEVERITIES) {
    L.push(
      `### ${SEV_TH[sev]} (${sev}) — ใหม่ ${n(t.new[sev].points)} จุด (${n(t.new[sev].findings)} ครั้ง)`,
      '',
    );
    L.push(pointsTable(s, s.groups.new[sev]));
  }
  L.push(runVaryingNote(t.new.runVarying));

  // deltas
  L.push('## ควรดูด้วยตา (D1/D2 — เทียบก่อน/หลังเท่านั้น ไม่ใช่ระดับปัญหา)', '');
  const d1 = t.deltas.D1,
    d2 = t.deltas.D2;
  L.push(
    `- **D1** ข้อความเดียวกันกว้างขึ้นหรือแคบลงเกิน 8% — ตัวอักษรใหม่กว้างไม่เท่าเดิม อาจทำให้ล้นหรือขึ้นบรรทัดใหม่ · กว้างขึ้น ${n(d1.wider)} ครั้ง · แคบลง ${n(d1.narrower)} ครั้ง${d1.medianChangePct == null ? '' : ` · ค่ากลาง ${d1.medianChangePct > 0 ? '+' : ''}${d1.medianChangePct}%`}`,
  );
  L.push(
    `- **D2** ในปุ่ม/ชิป/ช่องกรอกที่สูงเท่าเดิม ตัวอักษรเยื้องจากกึ่งกลางเกิน 1.5px และเยื้องมากกว่าเดิม · อยู่สูงกว่ากึ่งกลาง ${n(d2.aboveCentre)} ครั้ง · ต่ำกว่า ${n(d2.belowCentre)} ครั้ง${d2.medianAfterOffsetPx == null ? '' : ` · ค่ากลางห่างจากกึ่งกลาง ${d2.medianAfterOffsetPx}px (ขยับจากเดิม ${d2.medianShiftPx}px; ค่าลบ = ขึ้นบน)`} — ถ้าเกือบทั้งหมดไปทางเดียวกัน แปลว่าเป็นผลรวมจากระยะบน/ล่างของฟอนต์ใหม่ แก้ได้ที่จุดเดียว ไม่ใช่ทีละปุ่ม`,
  );
  L.push(
    `- ตัดออก ${n(t.deltas.noiseExcluded)} รายการจาก ${KNOWN_NOISE_ROUTES.map(code).join(', ')} (หน้านี้พิมพ์หมายเลขพอร์ตของรอบทดสอบ ข้อความจึงต่างกันทุกครั้ง — สัญญาณรบกวนที่รู้อยู่แล้ว)`,
    '',
  );
  L.push(`### D1 — ${n(t.deltas.D1.points)} จุด (${n(t.deltas.D1.findings)} ครั้ง)`, '');
  L.push(pointsTable(s, s.groups.deltas.D1));
  L.push(`### D2 — ${n(t.deltas.D2.points)} จุด (${n(t.deltas.D2.findings)} ครั้ง)`, '');
  L.push(pointsTable(s, s.groups.deltas.D2));

  // persisting
  L.push('## มีอยู่ก่อนแล้ว (พบทั้งก่อนและหลัง — ไม่ได้เกิดจากฟอนต์ใหม่)', '');
  L.push(perRuleTable(s.groups.persisting, t.persisting.byRule));
  const preP1 = s.groups.persisting.filter((p) => p.severity === 'P1');
  L.push(
    `### P1 ที่มีอยู่ก่อนแล้ว — ${n(preP1.length)} จุด (${n(sum(preP1))} ครั้ง) · ต้องแก้ แม้ไม่ได้เกิดจากฟอนต์ใหม่`,
    '',
  );
  L.push(pointsTable(s, preP1));
  L.push('### กฎที่ขัดกับแบบที่บ้านกำหนด — แยกแบบบ้านออกจากปัญหาจริง', '');
  L.push(
    `นับรวม "มีอยู่ก่อน" และ "เกิดจากฟอนต์ใหม่" · แยกจากค่าที่วัดได้ของแต่ละครั้ง · \`findings.json\` → \`totals.houseStyle\``,
    '',
  );
  const exs = (list) =>
    list.length
      ? ` — ตัวอย่าง ${list.map((e) => `“${cell(e.text)}” (${APP_TH[e.app] ?? e.app} ${code(e.route)} ${e.width}px, ${cell(e.value)})`).join(' · ')}`
      : '';
  L.push(
    `- **R3 ระยะบรรทัด — ตามแบบบ้าน ${n(hs.R3.houseStyle)} ครั้ง:** ข้อความเล็กกว่า 20px ที่ใช้ \`leading-snug\` (×1.375) ต่ำกว่าเกณฑ์ 1.4 ของกฎ แต่ \`.claude/rules/frontend.md\` กำหนดให้ข้อความไทยใช้ \`leading-snug\` → ให้เจ้าของตัดสินเกณฑ์ ไม่ใช่ข้อบกพร่อง`,
  );
  L.push(
    `  - **ปัญหาจริง P2 ${n(hs.R3.realP2)} ครั้ง** (ระยะบรรทัดค่าอื่น เช่น ×1.0, ×0.95, ×1.33, ×1.65)${exs(hs.R3.examples.realP2)}`,
  );
  L.push(
    `  - **ปัญหาจริง P1 ${n(hs.R3.realP1)} ครั้ง** (ข้อความไทยระยะบรรทัดต่ำกว่า ×1.2 — สระ/วรรณยุกต์ชนบรรทัด)${exs(hs.R3.examples.realP1)}`,
  );
  L.push(
    `- **R7 ความสูงปุ่ม/ช่องกรอก — ตามแบบบ้าน ${n(hs.R7.houseStyle)} ครั้ง:** จอใหญ่ สูง 32–34px (ปุ่ม/SelectTrigger ขนาด md ของ shadcn 34px · รายการเมนูซ้าย 32–34px) ต่ำกว่าเกณฑ์ ${TOUCH_MIN_DESKTOP}px → ขนาดมาตรฐานของชุดคอมโพเนนต์ ให้เจ้าของตัดสิน`,
  );
  L.push(
    `  - **ปัญหาจริง มือถือต่ำกว่า ${TOUCH_MIN_MOBILE}px ${n(hs.R7.realMobileBelow44)} ครั้ง** (กดยากบนจอสัมผัส)${exs(hs.R7.examples.mobileBelow44)}`,
  );
  L.push(
    `  - **ปัญหาจริง จอใหญ่ต่ำกว่า 32px ${n(hs.R7.realDesktopBelow32)} ครั้ง**${exs(hs.R7.examples.desktopBelow32)}`,
  );
  if (hs.R7.realDesktopOther)
    L.push(
      `  - **ปัญหาจริง อื่น ๆ ${n(hs.R7.realDesktopOther)} ครั้ง**${exs(hs.R7.examples.desktopOther)}`,
    );
  L.push('');

  // resolved
  L.push('## หายไปหลังเปลี่ยน (พบในรอบก่อน ไม่พบในรอบหลัง)', '');
  L.push(perRuleTable(s.groups.resolved, t.resolved.byRule));
  L.push(runVaryingNote(t.resolved.runVarying));
  L.push('ตัวอย่าง (ภาพ = รอบก่อน):', '');
  L.push(pointsTable(s, s.groups.resolved, { limit: 20, phase: 'before' }));

  // R8 (AFTER only — Ruling J)
  L.push('## AFTER เท่านั้น — ฟอนต์ผิด (R8)', '');
  L.push(
    'กฎ R8 ตรวจว่าตัวอักษรของหน้าจอใช้ Noto Sans Thai (หรือ Sarabun เฉพาะเนื้อหาอ่านยาวของหน้าร้าน) — ตรวจเฉพาะรอบหลัง เพราะรอบก่อนใช้ Looped ทุกตัวโดยนิยาม จึงไม่อยู่ในหัวข้อเทียบก่อน/หลังใด ๆ',
    '',
  );
  L.push(
    `พบ ${n(t.afterOnlyR8.points)} จุด (${n(t.afterOnlyR8.findings)} ครั้ง) — \`findings.json\` → \`totals.afterOnlyR8\` / \`afterOnlyR8\``,
    '',
  );
  L.push(pointsTable(s, s.groups.r8));

  // top 30
  L.push(`## ${TOP_N} จุดที่ควรดูก่อน`, '');
  L.push(
    `ลำดับ: ใหม่ P1 → ใหม่ P2 → ใหม่ P3 → ดูด้วยตา (สลับ D1/D2) → **P1 ที่มีอยู่ก่อนแล้ว** (กันที่ไว้ ${PRE_P1_RESERVE} อันดับท้าย สลับตามกฎเพื่อให้ทุกกลุ่ม P1 ปรากฏ — รายการเต็มอยู่ในหัวข้อ "มีอยู่ก่อนแล้ว") → มีอยู่ก่อนอื่น ๆ → จุดใหม่ที่อยู่เฉพาะบนหน้าที่ข้อมูลเปลี่ยนทุกรอบ (※) · ในกลุ่มเดียวกันเรียงตามจำนวนหน้าที่ได้รับผล · ภาพ = ภาพรอบหลังของหน้าแรกในจุดนั้น`,
    '',
  );
  L.push(pointsTable(s, s.top30, { tier: true, limit: TOP_N }));

  // notes
  L.push('## หมายเหตุสำหรับการตรวจด้วยตา', '');
  L.push(
    `- ${code('/liff/debug')} พิมพ์หมายเลขพอร์ตของรอบทดสอบ ข้อความจึงต่างกันระหว่างก่อน/หลัง — ปัดตกได้`,
  );
  L.push(
    '- ภาพเต็มหน้าของหน้าร้านมีปุ่ม LINE ลอย/แถบล่างค้างทับเนื้อหา — เป็นผลของการถ่ายภาพเต็มหน้า ไม่ใช่ปัญหาของหน้า',
  );
  L.push(
    '- หน้า LIFF ที่ถูกบังคับธีมมืดมีตัวอักษรสีจางอ่านยาก — เป็นปัญหาจริงแต่เป็นเรื่องสี ไม่เกี่ยวกับฟอนต์',
  );
  L.push(
    `- contact sheet (\`.tmp/typo-audit/contact-sheet.html\`) แสดงคู่ภาพก่อน|หลังของหน้าที่มีจุดใหม่ P1/P2 หรือ D1/D2 ทั้งสองธีม · จุดที่เป็นส่วนร่วมหลายหน้าแสดงเป็นตัวอย่าง ${SHEET_SHELL_SAMPLES} หน้าแรก`,
    '',
  );

  L.push('## ตัวเลขมาจากไหน', '');
  L.push('ทุกตัวเลขในรายงานนี้มาจาก `findings.json` ไฟล์เดียวกัน:', '');
  L.push('- จำนวนที่วัด → `coverage` (ต่อแอป × รอบ × role × สถานะ) · โฟลเดอร์ → `sources`');
  L.push(
    '- ตรวจไม่ได้/ไม่วัด → `uncovered` (`roles`, `documentRoutes`, `blocked`, `errors`, `unpaired`, `missingRuns`)',
  );
  L.push(
    '- เกิดจากฟอนต์ใหม่ → `totals.new.P1/P2/P3` (`points` = จุด, `findings` = ครั้ง) · รายการเต็ม `added` + `escalated`',
  );
  L.push('- ควรดูด้วยตา → `totals.deltas` · รายการเต็ม `deltas.D1` / `deltas.D2`');
  L.push(
    '- มีอยู่ก่อน → `totals.persisting` (ไม่รวมที่ระดับสูงขึ้น) · `persisting` เก็บเป็นจำนวนต่อกฎ × ระดับ × หน้า × ความกว้าง × ธีม × role พร้อมตัวอย่างไม่เกิน 5 ข้อความ',
  );
  L.push(
    '- หายไป → `totals.resolved` · รายการเต็ม `resolved` · 30 จุด → `top30` · สถานะรายชุด → `routes`',
  );
  L.push(
    `- จุดที่เป็นส่วนร่วม (\`"shell": true\`) เก็บ \`routeCount\`, \`occurrences\` และรายชื่อหน้าไม่เกิน ${SHELL_ROUTE_SAMPLE} หน้าแรก · ข้อความตัดที่ ${JSON_TEXT_MAX} ตัวอักษร · ข้อมูลรายตัวอักษรเต็มอยู่ใน \`.tmp/typo-audit/\` (รันคำสั่งเดิมซ้ำได้)`,
    '',
  );
  return `${L.join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function perRuleTable(points, byRule) {
  const rules = Object.keys(byRule);
  if (!rules.length) return '_ไม่มี_\n';
  const rows = rules.map((rule) => {
    const r = byRule[rule];
    const sev = Object.entries(r.bySeverity)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k} ${n(v)}`)
      .join(' · ');
    const sample = [...new Set(points.filter((p) => p.rule === rule).map((p) => clip(p.text, 24)))]
      .slice(0, 3)
      .map((x) => `“${x}”`)
      .join(', ');
    return `| ${rule} | ${RULE_TH[rule] ?? ''} | ${sev} | ${n(r.points)} | ${n(r.findings)} | ${r.houseStyle ? n(r.houseStyle) : '—'} | ${n(r.routes)} | ${cell(sample)} |`;
  });
  return `| กฎ | ตรวจอะไร | ระดับ (ครั้ง) | จุด | ครั้ง | ในนี้ตามแบบบ้าน | หน้า | ตัวอย่าง |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

// ── findings.json (Ruling AC) ───────────────────────────────────────────────────────────────────
const jsonPoint = (p) => {
  const common = {
    rule: p.rule,
    severity: p.severity ?? undefined,
    beforeSeverity: p.escalatedFrom ?? undefined,
    app: p.app,
  };
  if (!p.shell) {
    return {
      ...common,
      route: p.route,
      no: p.no ?? undefined,
      width: p.width,
      theme: p.theme,
      role: p.role,
      key: p.key,
      text: clip(p.text, JSON_TEXT_MAX),
      detail: p.detail,
    };
  }
  return {
    shell: true,
    ...common,
    kind: p.kind,
    keyText: p.keyText,
    text: clip(p.text, JSON_TEXT_MAX),
    width: p.width,
    theme: p.theme,
    role: p.role,
    routeCount: p.routeCount,
    occurrences: p.occurrences,
    routes: p.routes.slice(0, SHELL_ROUTE_SAMPLE),
    example: {
      route: p.example.route,
      no: p.example.no ?? undefined,
      key: p.example.key,
      detail: p.example.detail,
    },
  };
};

export function buildFindingsJson(s) {
  const persisting = new Map();
  for (const f of s.persisting) {
    const k = [f.app, f.rule, f.severity, f.route, f.width, f.theme, f.role].join('|');
    const e =
      persisting.get(k) ??
      persisting
        .set(k, {
          rule: f.rule,
          severity: f.severity,
          app: f.app,
          route: f.route,
          width: f.width,
          theme: f.theme,
          role: f.role,
          count: 0,
          examples: [],
        })
        .get(k);
    e.count++;
    if (e.examples.length < PERSIST_EXAMPLES) e.examples.push(clip(f.text, MD_TEXT_MAX));
  }
  return {
    schema: 'typography-audit-report/1',
    generatedAt: s.generatedAt,
    notes: {
      pairing:
        'BEFORE↔AFTER by app + inventory row (no) + route + width + theme + role; only status "rendered" on both sides is compared',
      shell: `Ruling Z: same rule|severity|kind|normalized text|width|theme|role on >= ${s.shellMinRoutes} distinct routes = one point ("shell": true) with routeCount/occurrences; routes lists the first ${SHELL_ROUTE_SAMPLE}`,
      new: 'totals.new = added + escalated (escalated = persisting whose severity rose; not counted again in persisting)',
      persisting: `counts per rule × severity × route × width × theme × role with up to ${PERSIST_EXAMPLES} example texts (Ruling AC); per-finding detail stays in .tmp`,
      fontCheck:
        'afterOnlyR8 = font-family check on AFTER only; never part of added/escalated/persisting/resolved (Ruling J)',
      liff: 'LIFF rows (/liff*) use one synthetic customer session in both role runs → role "liff", counted once',
      dedupe:
        'inventory rows sharing a path are separate measurements (different entry point / fact counts); a finding is counted once per app + findingKey, and across rows escalated beats persisting and persisting/escalated beat added/resolved (totals.crossRowPrecedence = entries dropped)',
      routesCounts:
        'routes[].counts are per BEFORE/AFTER pair, before cross-row dedupe and precedence — their sums exceed totals by design',
      houseStyle:
        'totals.houseStyle splits R3/R7 (persisting + new) into the house style the owner decides on (definitions inside) and real findings',
      revisions:
        'sources[].revision comes from the run folder run.json (revisionSource "run.json") or from --revision <label>=<sha> (revisionSource "cli"; the storefront runs have no run.json)',
      runTokens:
        'run-specific seed tokens (DOCS-<hex>, truncated "abcd1234..." ids) are canonicalized in the key text before pairing; displayed texts are raw',
      noise: `D1/D2 on ${KNOWN_NOISE_ROUTES.join(', ')} excluded (run-specific port in the text) — totals.deltas.noiseExcluded`,
      text: `texts clipped to ${JSON_TEXT_MAX} characters; synthetic harness/fixture data only`,
    },
    shellMinRoutes: s.shellMinRoutes,
    sources: s.sources,
    totals: s.totals,
    coverage: s.totals.records,
    uncovered: s.uncovered,
    added: s.groups.added.map(jsonPoint),
    escalated: s.groups.escalated.map(jsonPoint),
    deltas: { D1: s.groups.deltas.D1.map(jsonPoint), D2: s.groups.deltas.D2.map(jsonPoint) },
    resolved: s.groups.resolved.map(jsonPoint),
    afterOnlyR8: s.groups.r8.map(jsonPoint),
    persisting: [...persisting.values()],
    top30: s.top30.map((p) => ({
      rank: p.rank,
      tier: p.tier,
      ...jsonPoint(p),
      screenshot: shotOf(s, p, 'after') ?? undefined,
    })),
    routes: s.routes.map(
      ({ app, no, route, width, theme, role, beforeStatus, afterStatus, counts }) => ({
        app,
        no: no ?? undefined,
        route,
        width,
        theme,
        role,
        beforeStatus,
        afterStatus,
        counts,
      }),
    ),
  };
}

// arrays of objects one entry per line (reviewable diffs, compact); objects indented
export function stringifyReviewable(value, indent = '') {
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every((v) => v === null || typeof v !== 'object')) return JSON.stringify(value);
    const inner = `${indent}  `;
    return `[\n${value.map((v) => inner + JSON.stringify(v)).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return '{}';
    const inner = `${indent}  `;
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stringifyReviewable(v, inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

// ── contact-sheet.html ──────────────────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const srcOf = (p, base) => relShot(p, base).split('/').map(encodeURIComponent).join('/');

export function renderContactSheet(s, opts = {}) {
  const base = opts.sheetDir ?? null;
  // qualifying pairs: non-shell new P1/P2 or D1/D2, plus the first routes of each shell point
  const qualifying = new Set();
  const take = (p) =>
    (p.shell ? p.pairKeys.slice(0, SHEET_SHELL_SAMPLES) : p.pairKeys).forEach((k) =>
      qualifying.add(k),
    );
  [...s.groups.new.P1, ...s.groups.new.P2, ...s.groups.deltas.D1, ...s.groups.deltas.D2].forEach(
    take,
  );
  // both themes of a qualifying page × width × role
  const cardKey = (r) => [r.app, r.no ?? '', r.route, r.width, r.role].join('|');
  const cardKeys = new Set(
    [...qualifying]
      .map((k) => s.pairIndex.get(k))
      .filter(Boolean)
      .map(cardKey),
  );
  const cards = s.routes.filter((r) => cardKeys.has(cardKey(r)));
  const score = (r) => r.counts.new.P1 * 1000 + r.counts.new.P2 * 10 + r.counts.D1 + r.counts.D2;
  cards.sort((a, b) => score(b) - score(a) || cmpPairs(a, b));
  const img = (p, label) =>
    p
      ? `<figure><figcaption>${label}</figcaption><a href="${srcOf(p, base)}"><img loading="lazy" src="${srcOf(p, base)}" alt="${label}"></a></figure>`
      : `<figure><figcaption>${label}</figcaption><div class="missing">ไม่มีภาพ</div></figure>`;
  const item = (f) =>
    `<li><b>${esc(f.rule)}${f.severity ? ` ${esc(f.escalatedFrom ? `${f.escalatedFrom}→${f.severity}` : f.severity)}` : ''}</b> ${esc(RULE_TH[f.rule] ?? '')} — “${esc(clip(f.text, 60))}” · ${esc(describe(f))}</li>`;
  const body = cards
    .map((r) => {
      const list = [...r.sheet.new, ...r.sheet.deltas];
      const badges = [
        r.counts.new.P1 ? `<span class="b p1">P1 ใหม่ ${r.counts.new.P1}</span>` : '',
        r.counts.new.P2 ? `<span class="b p2">P2 ใหม่ ${r.counts.new.P2}</span>` : '',
        r.counts.D1 ? `<span class="b d">D1 ${r.counts.D1}</span>` : '',
        r.counts.D2 ? `<span class="b d">D2 ${r.counts.D2}</span>` : '',
        r.afterStatus !== 'rendered' || r.beforeStatus !== 'rendered'
          ? `<span class="b s">${esc(STATUS_TH[r.beforeStatus] ?? r.beforeStatus ?? '—')} → ${esc(STATUS_TH[r.afterStatus] ?? r.afterStatus ?? '—')}</span>`
          : '',
      ].join('');
      return `<section class="card"><h2>${esc(APP_TH[r.app] ?? r.app)} <code>${esc(r.route)}</code> · ${r.width}px · ${esc(r.theme)} · ${esc(roleShort(r.role))} ${badges}</h2>
${list.length ? `<ul>${list.slice(0, 12).map(item).join('')}${list.length > 12 ? `<li>… อีก ${list.length - 12} รายการ</li>` : ''}</ul>` : '<p class="quiet">ไม่มีจุดใหม่ P1/P2 หรือ D1/D2 ในธีมนี้ (แสดงคู่ธีมเพื่อเทียบ)</p>'}
<div class="pair">${img(r.screenshots.before, 'ก่อน (Looped)')}${img(r.screenshots.after, 'หลัง (Noto Sans Thai)')}</div></section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Typography contact sheet</title>
<style>
:root{
  --bg:#f6f6f7;
  --card:#fff;
  --fg:#18181b;
  --muted:#71717a;
  --line:#e4e4e7;
  --p1:#b91c1c;
  --p2:#b45309;
  --d:#1d4ed8;
}
@media (prefers-color-scheme: dark){
:root{
  --bg:#09090b;
  --card:#18181b;
  --fg:#fafafa;
  --muted:#a1a1aa;
  --line:#27272a;
  --p1:#f87171;
  --p2:#fbbf24;
  --d:#60a5fa;
}
}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
header{max-width:1400px;margin:0 auto 16px}
.card{
  max-width:1400px;
  margin:0 auto 20px;
  background:var(--card);
  border:1px solid var(--line);
  border-radius:8px;
  padding:12px;
}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:15px;margin:0 0 8px}
.b{
  display:inline-block;
  margin-left:6px;
  padding:0 6px;
  border-radius:4px;
  font-size:12px;
  border:1px solid currentColor;
}
.p1{color:var(--p1)}
.p2{color:var(--p2)}
.d{color:var(--d)}
.s{color:var(--muted)}
ul{margin:0 0 8px;padding-left:18px}
.quiet{color:var(--muted);margin:0 0 8px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
figure{margin:0;min-width:0}
figcaption{font-size:12px;color:var(--muted)}
img{width:100%;height:auto;border:1px solid var(--line);display:block}
.missing{padding:24px;border:1px dashed var(--line);color:var(--muted);text-align:center}
@media (max-width:700px){.pair{grid-template-columns:1fr}}
</style></head><body>
<header><h1>คู่ภาพก่อน | หลัง — จุดใหม่ P1/P2 และ D1/D2</h1>
<p class="quiet">${n(cards.length)} คู่ภาพ (หน้า × ความกว้าง × ธีม × role) · ทั้งสองธีมของหน้าที่เข้าเกณฑ์ · จุดที่เป็นส่วนร่วมหลายหน้าแสดง ${SHEET_SHELL_SAMPLES} หน้าแรก · สร้าง ${esc(String(s.generatedAt).slice(0, 10))}</p></header>
${body || '<p class="quiet">ไม่มีหน้าที่เข้าเกณฑ์</p>'}
</body></html>
`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const RUN_FLAGS = [
  ['admin-before-owner', 'web', 'before', 'owner'],
  ['admin-after-owner', 'web', 'after', 'owner'],
  ['admin-before-sales', 'web', 'before', 'salesA'],
  ['admin-after-sales', 'web', 'after', 'salesA'],
  ['shop-before', 'shop', 'before', null],
  ['shop-after', 'shop', 'after', null],
];
const display = (p) => {
  const rel = path.relative(process.cwd(), p);
  return rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(p) : rel;
};

export function main(argv, io = {}) {
  const log = io.log ?? console.log;
  const { values } = parseArgs({
    args: argv,
    options: {
      ...Object.fromEntries(RUN_FLAGS.map(([f]) => [f, { type: 'string' }])),
      out: { type: 'string' },
      sheet: { type: 'string' },
      revision: { type: 'string', multiple: true },
    },
  });
  if (!values.out) throw new Error('--out <dir> is required');
  // --revision <label>=<sha>: the commit a run folder was produced at, for runs without run.json
  // (storefront)
  const given = new Map(
    (values.revision ?? []).map((v) => {
      const m = /^([a-z-]+)=([0-9a-f]{7,40})$/i.exec(v);
      if (!m || !RUN_FLAGS.some(([f]) => f === m[1]))
        throw new Error(`--revision expects <run label>=<sha>, got "${v}"`);
      return [m[1], m[2]];
    }),
  );
  const out = path.resolve(values.out);
  const sheet = path.resolve(values.sheet ?? path.join('.tmp', 'typo-audit', 'contact-sheet.html'));
  const runs = RUN_FLAGS.map(([label, app, phase, role]) => {
    const dir = values[label] ? path.resolve(values[label]) : null;
    const run = loadRun(dir, { label, app, phase, role, displayDir: dir ? display(dir) : null });
    if (given.has(label)) Object.assign(run, { revision: given.get(label), revisionSource: 'cli' });
    return run;
  });
  const summary = summarize(runs);
  const shotBase = path.dirname(sheet);
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.dirname(sheet), { recursive: true });
  const files = {
    summary: path.join(out, 'summary.md'),
    findings: path.join(out, 'findings.json'),
    sheet,
  };
  fs.writeFileSync(files.summary, renderSummary(summary));
  fs.writeFileSync(files.findings, `${stringifyReviewable(buildFindingsJson(summary))}\n`);
  fs.writeFileSync(files.sheet, renderContactSheet(summary, { sheetDir: shotBase }));
  const t = summary.totals;
  for (const r of summary.sources)
    log(
      `${r.present ? 'ok     ' : 'MISSING'} ${String(r.label).padEnd(19)} files=${r.files} used=${r.records} liffDup=${r.sharedDuplicates} skipped=${r.skipped}`,
    );
  log(
    `pairs compared ${t.pairsCompared} · unpaired ${t.unpaired} · measured before ${t.measured.before} / after ${t.measured.after}`,
  );
  log(
    `new P1 ${t.new.P1.points}/${t.new.P1.findings} · P2 ${t.new.P2.points}/${t.new.P2.findings} · P3 ${t.new.P3.points}/${t.new.P3.findings} (points/findings) · escalated ${t.escalated.points}/${t.escalated.findings}`,
  );
  log(
    `D1 ${t.deltas.D1.points}/${t.deltas.D1.findings} · D2 ${t.deltas.D2.points}/${t.deltas.D2.findings} · noise excluded ${t.deltas.noiseExcluded} · persisting ${t.persisting.points}/${t.persisting.findings} · resolved ${t.resolved.points}/${t.resolved.findings} · font check (AFTER) ${t.afterOnlyR8.points}/${t.afterOnlyR8.findings}`,
  );
  const sizes = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.statSync(f).size]));
  for (const [k, f] of Object.entries(files))
    log(`wrote ${k.padEnd(8)} ${display(f)} (${n(sizes[k])} bytes)`);
  return { summary, files, sizes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
