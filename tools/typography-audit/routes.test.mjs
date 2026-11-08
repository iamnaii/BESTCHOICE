import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  appPaths, adminRouteGaps, DOCUMENT_ROUTES, isDocumentRoute, shopRoutes, buildAdminInventory, settingsRegistryEntries,
} from './routes.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI = fileURLToPath(new URL('./routes.mjs', import.meta.url));
const OCTOBER = path.join(ROOT, 'docs/reports/uxui-2026-10-14/acceptance-routes.json');

test('appPaths resolves nested routes', () => {
  const src = '<Route path="/settings/:categoryId"><Route path=":itemId"/></Route>';
  const paths = appPaths(src);
  assert.ok(paths.includes('/settings/:categoryId/:itemId'), paths.join(' '));
  assert.ok(paths.includes('/settings/:categoryId'));
});

test('appPaths resolves index routes, self-closing nested routes and pathless layouts', () => {
  const src = `
    function App() { const x = '<Route path="/not-jsx" />'; return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* <Route path="/ghost" element={<Ghost />} /> — commented out, must be ignored */}
        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/a" element={<A />}>
            <Route index element={<AIndex />} />
            <Route path="b" element={<B onPick={(v) => v > 1} />} />
            <Route path="c" element={<C title="x > y {brace}" />}>
              <Route path="d" element={<D />}/>
            </Route>
          </Route>
          <Route path="/liff/*" element={<LiffRedirect to="/liff/contract" />} />
          <Route path="/e" element={<ProtectedRoute roles={['OWNER']}><E /></ProtectedRoute>} />
          <Route path="/debug" element={<div style={{ padding: 20 }}><p>don't // break {window.x}</p></div>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>); }`;
  assert.deepEqual(appPaths(src), ['/a', '/a/b', '/a/c', '/a/c/d', '/liff/*', '/e', '/debug', '*']);
});

test('adminRouteGaps returns only missing', () => {
  assert.deepEqual(adminRouteGaps([{ path: '/a' }, { path: '/b' }], ['/a', '/b', '/c']), ['/c']);
});

test('adminRouteGaps compares after stripping #anchor and normalising :param names', () => {
  const rows = [{ path: '/settings/access#maker-checker' }, { path: '/x/:id' }, { path: '/inbox/:roomId?' }];
  assert.deepEqual(adminRouteGaps(rows, ['/settings/access', '/x/:contractId', '/inbox/:room?', '/y/:id']), ['/y/:id']);
});

test('document routes classified', () => {
  assert.ok(Array.isArray(DOCUMENT_ROUTES) && DOCUMENT_ROUTES.every((re) => re instanceof RegExp));
  for (const p of ['/r/:token', '/sales/:id/parcel-label']) {
    assert.ok(DOCUMENT_ROUTES.some((re) => re.test(p)), p);
  }
  for (const p of ['/stickers', '/verify/contracts/:id', '/verify/:identifier', '/receipts/verify/:receiptNumber',
    '/contract-templates/abc', '/sales/abc/parcel-label']) {
    assert.ok(isDocumentRoute(p), p);
  }
  // Ruling K: the bare /contract-templates list/editor page is measured; only its subpaths are documents.
  for (const p of ['/contract-templates', '/settings/products/stickers', '/settings/stickers', '/stickers/x',
    '/sales', '/sales/:id', '/expenses/verify/:id', '/expenses/verify-number/:number']) {
    assert.ok(!isDocumentRoute(p), p);
  }
});

test('credit-note viewer /cn/:token is a document route (controller ruling, same class as /r/:token)', () => {
  assert.ok(isDocumentRoute('/cn/:token'));
  assert.ok(DOCUMENT_ROUTES.some((re) => re.test('/cn/:token')));
  for (const p of ['/contracts', '/customers']) assert.ok(!isDocumentRoute(p), p);
});

test('shopRoutes covers App.tsx', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/web-shop/src/App.tsx'), 'utf8');
  const expected = appPaths(src).filter((p) => p !== '*' && p !== '/auth/line-callback');
  const routes = shopRoutes();
  // mirror exactly: every App.tsx path is listed, nothing extra, no duplicates
  assert.deepEqual(routes.map((r) => r.path).sort(), [...expected].sort());
  assert.equal(new Set(routes.map((r) => r.path)).size, routes.length);
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));
  assert.equal(byPath['/account'].auth, true);
  for (const r of routes) {
    assert.equal(r.auth, r.path === '/account' || r.path.startsWith('/account/'), r.path);
    assert.ok(!/[:*]/.test(r.sample), `sample must be concrete: ${r.sample}`);
    const re = new RegExp(`^${r.path.replace(/\/\*$/, '(?:/.*)?').replace(/:[A-Za-z0-9_]+/g, '[^/]+')}$`);
    assert.ok(re.test(r.sample), `${r.sample} must match ${r.path}`);
  }
  assert.equal(byPath['/products/:id'].sample, '/products/phone-1');
});

const REGISTRY = `
import { lazy } from 'react';
export interface SettingsItem { id: string; kind: SettingsItemKind; path?: string; } // not the registry
const ALL: SettingsRole[] = ['OWNER', 'FINANCE_MANAGER'];
export const settingsRegistry: SettingsCategory[] = [
  {
    id: 'company', label: "บริษัท & สาขา", icon: Building2, roles: ['OWNER'], group: 'org',
    items: [
      { id: 'info', label: 'ข้อมูล', group: 'บริษัท', roles: ['OWNER'], kind: 'inline', component: CompanyTab, keywords: ['{', "it's"] },
      { id: 'devices', label: 'เครื่องตอกบัตร', roles: ['OWNER'], kind: 'route', component: AttendanceDevicesPage, path: '/settings/company/devices' },
      { id: 'branches', label: 'สาขา', roles: ['OWNER'], kind: 'external', path: '/branches' },
    ],
  },
  {
    id: 'ops', label: 'งาน', icon: Plug, roles: ALL,
    items: [
      // a comment with a { brace
      { id: 'card', label: 'การ์ด', roles: ALL, kind: 'inline', component: OpsCard },
    ],
  },
];
`;

test('settingsRegistryEntries reads categories, inline and route items (external links are other routes)', () => {
  assert.deepEqual(settingsRegistryEntries(REGISTRY), [
    { path: '/settings/company', type: 'settings-category', component: 'SettingsCategoryRoute' },
    { path: '/settings/company#info', type: 'settings-inline', component: 'CompanyTab' },
    { path: '/settings/company/devices', type: 'settings-route', component: 'AttendanceDevicesPage' },
    { path: '/settings/ops', type: 'settings-category', component: 'SettingsCategoryRoute' },
    { path: '/settings/ops#card', type: 'settings-inline', component: 'OpsCard' },
  ]);
});

test('buildAdminInventory keeps October rows, appends T-rows, types documents and lists stale rows', () => {
  const october = [
    { no: '1', path: '/a', type: 'page', component: 'A' },
    { no: '2', path: '/stickers', type: 'page', component: 'StickerPrintPage' },
    { no: '3', path: '/settings/:categoryId', type: 'settings-shell', component: 'SettingsLayout' },
    { no: '4', path: '/settings/company#info', type: 'settings-inline', component: 'CompanyTab' },
    { no: '5', path: '/gone', type: 'page', component: 'GonePage' },
    { no: '6', path: '/settings/company', type: 'settings-category', component: 'SettingsCategoryRoute' },
    { no: '7', path: '/settings/company#removed', type: 'settings-inline', component: 'OldCard' },
  ];
  const app = `<Routes>
    <Route path="/a" element={<A />} />
    <Route path="/stickers" element={<StickerPrintPage />} />
    <Route path="/settings/:categoryId" element={<ProtectedRoute roles={['OWNER']}><SettingsLayout /></ProtectedRoute>}>
      <Route index element={<SettingsCategoryRoute />} />
      <Route path=":itemId" element={<SettingsItemRoute />} />
    </Route>
    <Route path="/r/:token" element={<SaleReceiptViewPage />} />
    <Route path="/kiosk" element={<ProtectedRoute roles={['OWNER']}><KioskPage /></ProtectedRoute>} />
  </Routes>`;
  const { rows, gaps, stale } = buildAdminInventory(october, app, REGISTRY);
  assert.deepEqual(rows.map((r) => r.id), ['1', '2', '3', '4', '5', '6', '7', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
  assert.ok(rows.every((r) => r.app === 'admin'));
  assert.deepEqual(rows[1], { app: 'admin', id: '2', path: '/stickers', type: 'document', component: 'StickerPrintPage' });
  assert.deepEqual(rows[3], { app: 'admin', id: '4', path: '/settings/company#info', type: 'settings-inline', component: 'CompanyTab' });
  // App.tsx gaps first (App.tsx order), then settings-registry pages October did not list
  assert.deepEqual(gaps, [
    { app: 'admin', id: 'T1', path: '/settings/:categoryId/:itemId', type: 'page', component: 'SettingsItemRoute' },
    { app: 'admin', id: 'T2', path: '/r/:token', type: 'document', component: 'SaleReceiptViewPage' },
    { app: 'admin', id: 'T3', path: '/kiosk', type: 'page', component: 'KioskPage' },
    { app: 'admin', id: 'T4', path: '/settings/company/devices', type: 'settings-route', component: 'AttendanceDevicesPage' },
    { app: 'admin', id: 'T5', path: '/settings/ops', type: 'settings-category', component: 'SettingsCategoryRoute' },
    { app: 'admin', id: 'T6', path: '/settings/ops#card', type: 'settings-inline', component: 'OpsCard' },
  ]);
  assert.deepEqual(rows.slice(7), gaps);
  // '#removed' is still matched by /settings/:categoryId but the registry no longer has the item
  assert.deepEqual(stale.map((r) => r.path), ['/gone', '/settings/company#removed']);
  // without a registry, only App.tsx gaps are added
  assert.deepEqual(buildAdminInventory(october, app).gaps.map((g) => g.id), ['T1', 'T2', 'T3']);
});

test('CLI --write-admin-inventory writes { rows } the harness can map to unique no', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typography-routes-'));
  try {
    const out = path.join(dir, 'nested', 'admin-inventory.json');
    const result = spawnSync(process.execPath, [CLI, '--write-admin-inventory', out], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const { rows } = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(rows.every((r) => r.app === 'admin' && typeof r.id === 'string' && typeof r.path === 'string'
      && typeof r.type === 'string' && typeof r.component === 'string'));
    const harness = rows.filter((r) => r.app === 'admin').map((r) => ({ ...r, no: r.id }));
    assert.equal(new Set(harness.map((r) => r.no)).size, harness.length);
    const october = JSON.parse(fs.readFileSync(OCTOBER, 'utf8'));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const row of october) assert.equal(byId.get(row.no)?.path, row.path, `October no ${row.no}`);
    const tRows = rows.filter((r) => !october.some((o) => o.no === r.id));
    assert.deepEqual(tRows.map((r) => r.id), tRows.map((_, k) => `T${k + 1}`));
    for (const r of tRows) assert.ok(result.stdout.includes(r.path), `stdout lists gap ${r.path}`);
    for (const r of rows) assert.equal(r.type === 'document', isDocumentRoute(r.path), r.path);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI rejects a missing output path', () => {
  const result = spawnSync(process.execPath, [CLI, '--write-admin-inventory'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--write-admin-inventory <out>/);
});
