// Typography audit — route coverage: which pages get measured.
//   appPaths()         every path="…" of a React Router App.tsx, nested paths resolved to full paths
//   adminRouteGaps()   App.tsx paths missing from an inventory (after stripping #anchor, normalising :param)
//   settingsRegistryEntries()  settings pages rendered from settingsRegistry (not path="…" routes)
//   DOCUMENT_ROUTES    paper/document routes — reported as "not measured" (Global Constraints, Ruling K)
//   shopRoutes()       storefront routes with concrete sample URLs (mirrors apps/web-shop/src/App.tsx)
//   CLI  node tools/typography-audit/routes.mjs --write-admin-inventory <out>
//        → { rows } for UXUI_INVENTORY = October inventory + gap rows (ids T1, T2, …) from App.tsx and the
//          settings registry
// Plain string scanning (no JSX parser dependency): tracks <Route> nesting, self-closing and index routes,
// and skips {expressions}, comments, strings and nested JSX inside attributes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const ADMIN_APP = 'apps/web/src/App.tsx';
export const SETTINGS_REGISTRY = 'apps/web/src/config/settings-registry.tsx';
export const OCTOBER_INVENTORY = 'docs/reports/uxui-2026-10-14/acceptance-routes.json';

// ── document routes (Ruling K: the Global list, literally — plus /cn/ by controller ruling) ──────
export const DOCUMENT_ROUTES = [
  /^\/r\//, // ใบเสร็จขายสด /r/:token
  /^\/cn\//, // ใบลดหนี้ /cn/:token — public credit-note PDF viewer, same class as /r/:token
  /^\/sales\/[^/]+\/parcel-label$/, // ป้ายพัสดุ /sales/:id/parcel-label
  /^\/stickers$/,
  /^\/verify\//,
  /^\/receipts\/verify\//,
  /^\/contract-templates\/.+/, // preview subpaths only — the bare list/editor page is measured
];
export const stripHash = (p) => String(p).split('#')[0];
export const isDocumentRoute = (p) => DOCUMENT_ROUTES.some((re) => re.test(stripHash(p)));

// ── JSX scanning ────────────────────────────────────────────────────────────────────────────────
const lineOf = (src, i) => src.slice(0, i).split('\n').length;
// a '<' inside an expression opens JSX only after one of these (or `return`) — otherwise it is less-than
const JSX_AFTER = new Set(['', '{', '(', '[', ',', '?', ':', '=', '&', '|', '!', '>', ';']);

function skipQuoted(src, i) {
  const q = src[i];
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === q) return i + 1;
  }
  throw new Error(`unterminated string (line ${lineOf(src, i)})`);
}

function skipTemplate(src, i) {
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '`') return i + 1;
    if (src[i] === '$' && src[i + 1] === '{') i = skipExpr(src, i + 1) - 1;
  }
  throw new Error(`unterminated template literal (line ${lineOf(src, i)})`);
}

// src[i] === '{' → index just past the matching '}'
function skipExpr(src, i) {
  const start = i;
  let depth = 0;
  let prev = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '{') { depth++; prev = c; i++; continue; }
    if (c === '}') { depth--; i++; if (depth === 0) return i; prev = c; continue; }
    if (c === '"' || c === "'") { i = skipQuoted(src, i); prev = 'a'; continue; }
    if (c === '`') { i = skipTemplate(src, i); prev = 'a'; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) throw new Error(`unterminated comment (line ${lineOf(src, i)})`);
      i = e + 2; continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? src.length : e; continue;
    }
    if (c === '<' && /[A-Za-z>]/.test(src[i + 1] ?? '')
      && (JSX_AFTER.has(prev) || /\breturn\s*$/.test(src.slice(Math.max(0, i - 12), i)))) {
      i = skipJsxElement(src, i); prev = 'a'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  throw new Error(`unterminated {expression} (line ${lineOf(src, start)})`);
}

// src[i] === '<' (element or fragment) → index just past the element
function skipJsxElement(src, i) {
  if (src[i + 1] === '>') return skipJsxChildren(src, i + 2, '');
  const tag = scanTag(src, i);
  return tag.selfClosing ? tag.end : skipJsxChildren(src, tag.end, tag.name);
}

function skipJsxChildren(src, i, name) {
  const start = i;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') { i = skipExpr(src, i); continue; }
    if (c === '<' && src[i + 1] === '/') {
      const e = src.indexOf('>', i);
      if (e < 0) break;
      return e + 1;
    }
    if (c === '<' && /[A-Za-z>]/.test(src[i + 1] ?? '')) { i = skipJsxElement(src, i); continue; }
    i++;
  }
  throw new Error(`unterminated <${name}> (line ${lineOf(src, start)})`);
}

// src[i] === '<' → { name, attrs, selfClosing, end }; attrs: name → true | { kind: 'string'|'expr', value }
function scanTag(src, i) {
  const start = i;
  let j = i + 1;
  while (j < src.length && /[\w$.\-:]/.test(src[j])) j++;
  const name = src.slice(i + 1, j);
  const attrs = {};
  while (j < src.length) {
    const c = src[j];
    if (/\s/.test(c)) { j++; continue; }
    if (c === '/' && src[j + 1] === '>') return { name, attrs, selfClosing: true, end: j + 2 };
    if (c === '>') return { name, attrs, selfClosing: false, end: j + 1 };
    if (c === '{') { j = skipExpr(src, j); continue; } // {...spread}
    if (/[A-Za-z_$]/.test(c)) {
      const s = j;
      while (j < src.length && /[\w$\-:]/.test(src[j])) j++;
      const attr = src.slice(s, j);
      let k = j;
      while (/\s/.test(src[k] ?? '')) k++;
      if (src[k] !== '=') { attrs[attr] = true; continue; }
      k++;
      while (/\s/.test(src[k] ?? '')) k++;
      if (src[k] === '"' || src[k] === "'") {
        const e = src.indexOf(src[k], k + 1); // JSX attribute strings have no escapes
        if (e < 0) break;
        attrs[attr] = { kind: 'string', value: src.slice(k + 1, e) };
        j = e + 1; continue;
      }
      if (src[k] === '{') {
        const e = skipExpr(src, k);
        attrs[attr] = { kind: 'expr', value: src.slice(k + 1, e - 1) };
        j = e; continue;
      }
      throw new Error(`unsupported value for ${attr}= in <${name}> (line ${lineOf(src, k)})`);
    }
    throw new Error(`unexpected '${c}' in <${name}> (line ${lineOf(src, j)})`);
  }
  throw new Error(`unterminated <${name}> tag (line ${lineOf(src, start)})`);
}

function attrPath(attr) {
  if (!attr || attr === true) return null;
  if (attr.kind === 'string') return attr.value;
  const literal = /^\s*(['"`])([^'"`$]*)\1\s*$/.exec(attr.value);
  if (!literal) throw new Error(`dynamic path={${attr.value.trim()}} is not supported`);
  return literal[2];
}

// component name of element={…}: first JSX element, unwrapping ProtectedRoute (October convention);
// a lowercase host element (inline <div>) → ''
const ELEMENT_WRAPPERS = new Set(['ProtectedRoute']);
function elementComponent(attr) {
  if (!attr || attr.kind !== 'expr') return '';
  const name = [...attr.value.matchAll(/<([A-Za-z][\w.]*)/g)].map((m) => m[1]).find((n) => !ELEMENT_WRAPPERS.has(n));
  return !name || /^[a-z]/.test(name) ? '' : name;
}

const resolveChild = (parent, own) => (own.startsWith('/') || !parent ? own : `${parent.replace(/\/+$/, '')}/${own}`);

// Every <Route path="…"> in source order with its full path. Index and pathless (layout) routes add no
// path of their own: an index route renders at its parent's path, a layout route passes its parent through.
// Scans between the first <Routes> and the last </Routes> when present (whole source otherwise).
export function appRoutes(source) {
  const open = source.search(/<Routes[\s>]/);
  const close = source.lastIndexOf('</Routes>');
  const [from, to] = open >= 0 && close > open ? [open, close] : [0, source.length];
  const routes = [];
  const stack = []; // full path of each open <Route> ('' for a top-level layout)
  let i = from;
  while (i < to) {
    const c = source[i];
    if (c === '{') { i = skipExpr(source, i); continue; }
    if (c === '<') {
      const closing = /^<\/Route\s*>/.exec(source.slice(i, i + 16));
      if (closing) {
        if (!stack.length) throw new Error(`</Route> without an open <Route> (line ${lineOf(source, i)})`);
        stack.pop();
        i += closing[0].length; continue;
      }
      if (/^<Route[\s/>]/.test(source.slice(i, i + 7))) {
        const tag = scanTag(source, i);
        const parent = stack.length ? stack[stack.length - 1] : '';
        const own = attrPath(tag.attrs.path);
        const full = own == null ? parent : resolveChild(parent, own);
        if (own != null) routes.push({ path: full, component: elementComponent(tag.attrs.element) });
        if (!tag.selfClosing) stack.push(full);
        i = tag.end; continue;
      }
      if (/[A-Za-z]/.test(source[i + 1] ?? '')) { i = scanTag(source, i).end; continue; } // other tags: skip attrs, walk children
      if (source[i + 1] === '/') { i = source.indexOf('>', i) + 1 || to; continue; }
    }
    i++;
  }
  if (stack.length) throw new Error(`${stack.length} <Route> element(s) never closed`);
  return routes;
}

export function appPaths(appTsxSource) {
  return [...new Set(appRoutes(appTsxSource).map((r) => r.path))];
}

// ── settings registry ───────────────────────────────────────────────────────────────────────────
// Settings sub-pages are not path="…" routes: /settings/:categoryId(/:itemId) renders them from
// settingsRegistry. The October inventory enumerated them as settings-* rows; this reads the same set.

// src[i] is an opening bracket → index of its matching closer (strings, templates, comments skipped)
function matchBracket(src, i) {
  const start = i;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") { i = skipQuoted(src, i); continue; }
    if (c === '`') { i = skipTemplate(src, i); continue; }
    if (c === '/' && (src[i + 1] === '*' || src[i + 1] === '/')) {
      const block = src[i + 1] === '*';
      const e = src.indexOf(block ? '*/' : '\n', i + 2);
      if (e < 0) break;
      i = e + (block ? 2 : 1); continue;
    }
    if ('[{('.includes(c)) depth++;
    else if (']})'.includes(c) && --depth === 0) return i;
    i++;
  }
  throw new Error(`unbalanced bracket (line ${lineOf(src, start)})`);
}

// top-level {…} object literals between from and to (exclusive)
function topLevelObjects(src, from, to) {
  const objects = [];
  for (let i = from; i < to;) {
    const c = src[i];
    if (c === '{') { const e = matchBracket(src, i); objects.push(src.slice(i, e + 1)); i = e + 1; continue; }
    if (c === '"' || c === "'") { i = skipQuoted(src, i); continue; }
    if (c === '`') { i = skipTemplate(src, i); continue; }
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      const block = src[i + 1] === '*';
      const e = src.indexOf(block ? '*/' : '\n', i + 2);
      i = e < 0 ? to : e + (block ? 2 : 1); continue;
    }
    i++;
  }
  return objects;
}

const stringField = (text, key) => new RegExp(`\\b${key}:\\s*['"]([^'"]*)['"]`).exec(text)?.[1];

// [{ path, type, component }] — category → /settings/<cat> (settings-category) · inline → /settings/<cat>#<id>
// (settings-inline, the harness opens the [id] panel) · route → its path (settings-route). External items
// only link to other App.tsx routes, which the App.tsx scan covers.
export function settingsRegistryEntries(source) {
  const head = /export const settingsRegistry\b[^=]*=\s*\[/.exec(source);
  if (!head) throw new Error('settingsRegistry array not found');
  const open = head.index + head[0].length - 1;
  const entries = [];
  for (const category of topLevelObjects(source, open + 1, matchBracket(source, open))) {
    const items = /\bitems:\s*\[/.exec(category);
    const cat = items && stringField(category.slice(0, items.index), 'id');
    if (!cat) throw new Error(`settings category without id/items: ${category.slice(0, 80)}`);
    entries.push({ path: `/settings/${cat}`, type: 'settings-category', component: 'SettingsCategoryRoute' });
    const itemsOpen = items.index + items[0].length - 1;
    for (const item of topLevelObjects(category, itemsOpen + 1, matchBracket(category, itemsOpen))) {
      const kind = stringField(item, 'kind');
      const id = stringField(item, 'id');
      const component = /\bcomponent:\s*([A-Za-z_$][\w$]*)/.exec(item)?.[1] ?? '';
      if (kind === 'inline') entries.push({ path: `/settings/${cat}#${id}`, type: 'settings-inline', component });
      else if (kind === 'route') {
        entries.push({ path: stringField(item, 'path') ?? `/settings/${cat}/${id}`, type: 'settings-route', component });
      }
    }
  }
  return entries;
}

// ── inventory comparison ────────────────────────────────────────────────────────────────────────
export function normalizeRoutePath(p) {
  let s = stripHash(p);
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s.replace(/:[A-Za-z0-9_]+(\??)/g, ':$1');
}

const rowPath = (row) => (typeof row === 'string' ? row : row.path);

export function adminRouteGaps(inventoryRows, paths) {
  const known = new Set(inventoryRows.map((r) => normalizeRoutePath(rowPath(r))));
  const gaps = [];
  for (const p of paths) {
    const key = normalizeRoutePath(p);
    if (known.has(key)) continue;
    known.add(key);
    gaps.push(p);
  }
  return gaps;
}

const expandOptional = (segs) => segs.reduce((acc, s) => (s.endsWith('?')
  ? acc.flatMap((a) => [[...a, s.slice(0, -1)], a])
  : acc.map((a) => [...a, s])), [[]]);

function patternMatches(pattern, concrete) {
  const want = stripHash(concrete).split('/');
  return expandOptional(pattern.split('/')).some((segs) => segs.length === want.length
    && segs.every((s, k) => (s.startsWith(':') ? want[k] !== '' : s === want[k])));
}

const REGISTRY_ROW_TYPES = new Set(['settings-category', 'settings-inline', 'settings-route']);

// Inventory rows whose path nothing serves any more: no normalised exact match and no :param pattern
// match in App.tsx (splat routes such as /liff/* or * do not count as serving a row) — or, when registry
// entries are given, a settings-category/inline/route row the registry no longer lists.
export function staleRows(inventoryRows, paths, registryEntries = null) {
  const exact = new Set(paths.map(normalizeRoutePath));
  const patterns = paths.filter((p) => p.includes(':') && !p.includes('*'));
  const registry = registryEntries && new Set(registryEntries.map((e) => e.path));
  return inventoryRows.filter((r) => {
    const p = rowPath(r);
    if (registry && REGISTRY_ROW_TYPES.has(r.type) && !registry.has(p)) return true;
    return !exact.has(normalizeRoutePath(p)) && !patterns.some((pattern) => patternMatches(pattern, p));
  });
}

// October rows keep their `no` as id (type → 'document' when they match DOCUMENT_ROUTES). Gap rows T1, T2, …:
// every App.tsx path missing from October (App.tsx order, type 'page' unless document), then every
// settings-registry page October did not list (exact path incl. #anchor, registry order, settings-* type).
export function buildAdminInventory(octoberRows, appTsxSource, settingsRegistrySource = '') {
  const routes = appRoutes(appTsxSource);
  const paths = [...new Set(routes.map((r) => r.path))];
  const registry = settingsRegistrySource ? settingsRegistryEntries(settingsRegistrySource) : null;
  const typed = (p, type) => (isDocumentRoute(p) ? 'document' : type);
  const kept = octoberRows.map((r) => ({
    app: 'admin', id: String(r.no), path: r.path, type: typed(r.path, r.type), component: r.component ?? '',
  }));
  const appGaps = adminRouteGaps(octoberRows, paths).map((p) => ({
    path: p, type: 'page', component: routes.find((r) => r.path === p)?.component ?? '',
  }));
  const listed = new Set([...octoberRows.map(rowPath), ...paths]);
  const registryGaps = [];
  for (const e of registry ?? []) {
    if (listed.has(e.path)) continue;
    listed.add(e.path);
    registryGaps.push(e);
  }
  const gaps = [...appGaps, ...registryGaps].map((g, k) => ({
    app: 'admin', id: `T${k + 1}`, path: g.path, type: typed(g.path, g.type), component: g.component,
  }));
  const rows = [...kept, ...gaps];
  const ids = new Set();
  for (const r of rows) {
    if (ids.has(r.id)) throw new Error(`duplicate inventory id ${r.id}`);
    ids.add(r.id);
  }
  return { rows, gaps, stale: staleRows(octoberRows, paths, registry) };
}

// ── storefront ──────────────────────────────────────────────────────────────────────────────────
// Mirrors apps/web-shop/src/App.tsx exactly (minus * and /auth/line-callback — Ruling P). Samples are
// stable synthetic values Task 5's fixture serves; splat redirects use their bare prefix; Thai paths
// stay as written (the browser percent-encodes them).
const SHOP_ROUTES = [
  ['/'], ['/products'], ['/products/:id', '/products/phone-1'],
  ['/how-it-works'], ['/shipping'], ['/returns'], ['/about'], ['/contact'],
  ['/orders'], ['/orders/:orderNumber', '/orders/BC-TEST-0001'],
  ['/account'], ['/account/addresses'],
  ['/promotions'], ['/installment-terms'],
  ['/sell'], ['/sell/quote'], ['/sell/:id', '/sell/test-1'],
  ['/buyback'], ['/buyback/quote'], ['/buyback/submit'], ['/buyback/:id', '/buyback/test-1'],
  ['/trade-in'], ['/trade-in/submit'], ['/trade-in/:id', '/trade-in/test-1'],
  ['/cart'], ['/checkout/*', '/checkout'],
  ['/apply'], ['/apply/status'], ['/apply/success/*', '/apply/success'], ['/apply/:id', '/apply/test-1'],
  ['/saving-plan/*', '/saving-plan'], ['/account/saving-plans'],
  ['/ผ่อนไอโฟนลพบุรี'], ['/iphone-มือสอง-ลพบุรี'], ['/ผ่อนมือถือไม่ใช้บัตรเครดิต'],
  ['/login'],
];

export function shopRoutes() {
  return SHOP_ROUTES.map(([p, sample = p]) => ({ path: p, sample, auth: p === '/account' || p.startsWith('/account/') }));
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function main(argv) {
  const flag = argv.indexOf('--write-admin-inventory');
  const out = flag >= 0 ? argv[flag + 1] : undefined;
  if (!out || out.startsWith('--')) {
    process.stderr.write('usage: node tools/typography-audit/routes.mjs --write-admin-inventory <out>\n');
    process.exitCode = 2;
    return;
  }
  const october = JSON.parse(fs.readFileSync(path.join(ROOT, OCTOBER_INVENTORY), 'utf8'));
  const app = fs.readFileSync(path.join(ROOT, ADMIN_APP), 'utf8');
  const registry = fs.readFileSync(path.join(ROOT, SETTINGS_REGISTRY), 'utf8');
  const { rows, gaps, stale } = buildAdminInventory(october, app, registry);
  const target = path.resolve(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({ rows }, null, 2)}\n`);
  const lines = [
    `admin inventory: ${october.length} October rows + ${gaps.length} gap rows = ${rows.length} rows`
      + ` (${rows.filter((r) => r.type === 'document').length} type document)`,
    `gaps — routes in ${ADMIN_APP} / pages in ${SETTINGS_REGISTRY} missing from ${OCTOBER_INVENTORY} (${gaps.length}):`,
    ...gaps.map((g) => `  ${g.id}\t${g.type}\t${g.path}`),
    `stale — October rows no longer served by ${ADMIN_APP} / ${SETTINGS_REGISTRY};`
      + ` kept in the output, information only (${stale.length}):`,
    ...stale.map((s) => `  ${s.no}\t${s.type}\t${s.path}`),
    `wrote ${target}`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
