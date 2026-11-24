// Read-only source inventory; run from apps/web: ../../node_modules/.bin/tsx ../../docs/reports/2026-11-24-access-audit/inventory.ts
// These are declared gates/default templates, NOT evidence of successful requests or deployed grants.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { inventory } from '../../../tools/lib/access-entrypoints.mjs';
import { getSidebarForRole, isChatVisibleForRole } from '../../../apps/web/src/config/menu';
import { DEFAULT_ACCESS_POSITIONS, PERMISSION_CATALOG } from '../../../packages/shared/src/employee-access';

const root = path.resolve(process.cwd(), '../..');
if (!fs.existsSync(path.join(root, 'apps/web/src/App.tsx'))) throw new Error('Run from apps/web');
const output = path.join(root, 'docs/reports/2026-11-24-access-audit');
const roles = ['OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER'];
function csv(name: string, rows: Record<string, unknown>[]) {
  const keys = Object.keys(rows[0] ?? {});
  const cell = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  fs.writeFileSync(path.join(output, name), '\ufeff' + [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(cell).join(',')).join('\n') + '\n');
}
const files = new Map<string, { source: ts.SourceFile; constants: Map<string, ts.Expression> }>();
const constantFiles = new WeakMap<Map<string, ts.Expression>, string>();
function context(file: string) {
  if (files.has(file)) return files.get(file)!;
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const constants = new Map<string, ts.Expression>();
  source.forEachChild(n => {
    if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) constants.set(d.name.text, d.initializer);
    }
  });
  const value = { source, constants }; files.set(file, value); constantFiles.set(constants, file); return value;
}
function strings(node: ts.Node | undefined, constants: Map<string, ts.Expression>, depth = 0): string[] | null {
  if (!node || depth > 12) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map(n => strings(n, constants, depth + 1));
    return values.some(v => v === null) ? null : values.flat() as string[];
  }
  if (ts.isSpreadElement(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return strings(node.expression, constants, depth + 1);
  if (ts.isIdentifier(node)) {
    if (constants.has(node.text)) return strings(constants.get(node.text), constants, depth + 1);
    const file = constantFiles.get(constants);
    if (file) for (const item of context(file).source.statements) {
      if (!ts.isImportDeclaration(item) || !ts.isStringLiteral(item.moduleSpecifier)) continue;
      const bindings = item.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const imported = bindings.elements.find(e => e.name.text === node.text);
      if (!imported || !item.moduleSpecifier.text.startsWith('.')) continue;
      const base = path.join(path.dirname(file), item.moduleSpecifier.text);
      const target = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(p => fs.existsSync(path.join(root, p)));
      if (target) { const other = context(target).constants; return strings(other.get(imported.propertyName?.text ?? imported.name.text), other, depth + 1); }
    }
    return null;
  }
  if (ts.isCallExpression(node) && node.expression.getText() === 'Object.values' && node.arguments[0]?.getText() === 'UserRole') return roles;
  if (ts.isPropertyAccessExpression(node) && node.expression.getText() === 'UserRole') return [node.name.text];
  return null;
}
function parseRoles(text: string | undefined, constants: Map<string, ts.Expression>) {
  if (!text) return undefined;
  const src = ts.createSourceFile('roles.ts', text, ts.ScriptTarget.Latest, true);
  const exp = (src.statements[0] as ts.ExpressionStatement).expression as ts.CallExpression;
  const values = exp.arguments.map(n => strings(n, constants));
  return values.some(v => v === null) ? null : values.flat() as string[];
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/api/src/modules/employee-access/access-policy.manifest.json'), 'utf8'));
const entries = inventory(root);
const apiRows = entries.map((entry: any) => {
  const declared = entry.decorators.find((d: string) => d.startsWith('Roles(')) ?? entry.classDecorators.find((d: string) => d.startsWith('Roles('));
  const allowed = parseRoles(declared, context(entry.file).constants);
  const policy = manifest[`${entry.controller}.${entry.method}`];
  return {
    entrypoint: `${entry.controller}.${entry.method}`, file: entry.file,
    controller: entry.classDecorators.find((d: string) => d.startsWith('Controller(')) ?? '',
    transport: entry.transport, classification: policy?.classification ?? 'UNCLASSIFIED',
    declared_roles: declared ?? '', guards: [...entry.classDecorators, ...entry.decorators].filter((d: string) => d.startsWith('UseGuards(')).join(' | '),
    ...Object.fromEntries(roles.map(role => [role, allowed === undefined ? 'NO_ROLE_METADATA' : allowed === null ? 'UNRESOLVED' : allowed.includes(role) ? 'DECLARED_ALLOWED' : 'DECLARED_DENIED'])),
    managed_permission: policy?.permission ?? '', resource: policy?.resource ?? '', resolution: policy?.resolution ?? '',
    limitation: 'Declared gates only; authentication, VIEWER flag, company, branch, resource, state and approvals still apply. Public/customer/integration classification is not a staff grant.',
  };
});
csv('api-declared-gates.csv', apiRows);

const menuRows: Record<string, unknown>[] = [];
for (const role of roles) {
  for (const zone of ['shop', 'fin', 'settings'] as const) {
    for (const section of getSidebarForRole(role, zone)) {
      const visit = (item: any, parent = '') => {
        menuRows.push({ role, zone, section: section.label, parent, label: item.label, path: item.path, kind: item.children?.length ? 'GROUP' : 'LINK' });
        for (const child of item.children ?? []) visit(child, item.label);
      };
      section.items.forEach(item => visit(item));
    }
  }
  if (isChatVisibleForRole(role)) menuRows.push({ role, zone: 'contextual', section: 'Top bar / mobile', parent: '', label: 'แชทลูกค้า', path: '/inbox', kind: 'LINK' });
}
csv('menus-by-role.csv', menuRows);
let menus = '# เมนูปัจจุบันแยกทุก role\n\nสำรวจจาก config ที่ checkout วันที่ 24 พฤศจิกายน 2026 ไม่ใช่การยืนยันว่า API ทุกหน้าทำงานได้ และไม่ใช่สิทธิ์ของบัญชีจริง รายการ GROUP เป็นหัวข้อเมนู ไม่ใช่ปลายทาง หน้าเสริม/หน้าลูกทั้งหมดดู web-route-gates.csv\n';
for (const role of roles) {
  menus += `\n## ${role}\n\n| ส่วนงาน | หมวด | หน้า | เส้นทาง | ชนิด |\n|---|---|---|---|---|\n`;
  menus += menuRows.filter(r => r.role === role).map(r => `| ${r.zone} | ${r.section} | ${r.parent ? r.parent + ' → ' : ''}${r.label} | \`${r.path}\` | ${r.kind} |`).join('\n') + '\n';
}
fs.writeFileSync(path.join(output, 'legacy-menus.md'), menus);

const app = context('apps/web/src/App.tsx');
const routeRows: Record<string, unknown>[] = [];
function attr(attributes: ts.JsxAttributes, name: string) { return attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText(app.source) === name) as ts.JsxAttribute | undefined; }
function value(attribute?: ts.JsxAttribute) {
  const n = attribute?.initializer;
  return n && ts.isStringLiteral(n) ? n.text : n && ts.isJsxExpression(n) ? n.expression : undefined;
}
function walk(node: ts.Node, inherited: string[][] = [], authenticated = false) {
  const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
  let constraints = inherited;
  let auth = authenticated;
  if (opening?.tagName.getText(app.source) === 'Route') {
    const route = value(attr(opening.attributes, 'path'));
    const element = value(attr(opening.attributes, 'element'));
    let unresolved = false, redirect = false;
    const guards: string[][] = [];
    if (element && typeof element !== 'string') {
      const scan = (n: ts.Node) => {
        const e = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : undefined;
        if (e?.tagName.getText(app.source) === 'Navigate') redirect = true;
        if (e?.tagName.getText(app.source) === 'ProtectedRoute') {
          auth = true;
          const rv = value(attr(e.attributes, 'roles'));
          if (rv && typeof rv !== 'string') { const parsed = strings(rv, app.constants); if (parsed) guards.push(parsed); else unresolved = true; }
        }
        n.forEachChild(scan);
      };
      scan(element);
    }
    constraints = [...inherited, ...guards];
    if (typeof route === 'string') routeRows.push({
      path: route, line: app.source.getLineAndCharacterOfPosition(opening.getStart(app.source)).line + 1,
      protected_route_auth: auth, redirect,
      ...Object.fromEntries(roles.map(role => [role, unresolved ? 'UNRESOLVED' : constraints.some(c => !c.includes(role)) ? 'DECLARED_DENIED' : constraints.length ? 'DECLARED_ALLOWED' : 'NO_ADDITIONAL_ROLE_GATE'])),
      menu_roles_exact_path: roles.filter(role => menuRows.some(r => r.role === role && String(r.path).split(/[?#]/)[0] === route)).join(' | '),
      limitation: 'App.tsx ProtectedRoute only; MainLayout, settings guards, company grants and APIs can further restrict. Dynamic paths not matched to menu patterns.',
    });
  }
  node.forEachChild(child => walk(child, constraints, auth));
}
walk(app.source);
csv('web-route-gates.csv', routeRows);

const permissionRows = PERMISSION_CATALOG.map(p => ({
  permission: p.key, label: p.label, group: p.group, owner_only: p.ownerOnly,
  ...Object.fromEntries(DEFAULT_ACCESS_POSITIONS.map(position => [position.code,
    position.code === 'OWNER' ? 'IMPLICIT_OWNER' : p.ownerOnly ? 'RESERVED_OWNER' : position.permissions.includes(p.key as any) ? 'TEMPLATE_GRANT' : p.allStaff ? 'IMPLICIT_STAFF_CAPABILITY' : 'NOT_IN_TEMPLATE'])),
  limitation: 'Current source defaults only; no company/scope/branch selected, not production assignments, not a usable-flow guarantee.',
}));
csv('position-defaults-by-permission.csv', permissionRows);
let templates = '# สิทธิ์ในแม่แบบตำแหน่งปัจจุบัน\n\nนี่คือ DEFAULT_ACCESS_POSITIONS ใน source ไม่ใช่สิทธิ์ที่มอบหมายจริง และไม่ใช่ข้อเสนอฉบับใหม่ บริษัท/สาขา/เคสยังไม่ได้เลือก การมี permission เดี่ยวไม่รับประกันว่า workflow ใช้งานได้ สิทธิ์ที่ไม่อยู่ในแม่แบบไม่ถือว่าอนุญาต\n';
for (const p of DEFAULT_ACCESS_POSITIONS) {
  templates += `\n## ${p.name} (${p.code}) — ${p.permissions.length} สิทธิ์ที่ระบุในแม่แบบ\n\n`;
  if (p.code === 'OWNER') { templates += 'OWNER ใช้อำนาจเจ้าของแยกจากตำแหน่งที่มอบหมายได้ จำนวน 0 ในแม่แบบไม่ใช่ไม่มีสิทธิ์ และคัดลอกตำแหน่งแล้วไม่ได้อำนาจเจ้าของ\n'; continue; }
  templates += '| หมวด | สิทธิ์ | รหัส |\n|---|---|---|\n';
  templates += p.permissions.map(key => { const d = PERMISSION_CATALOG.find(x => x.key === key)!; return `| ${d.groupLabel} | ${d.label} | \`${key}\` |`; }).join('\n') + '\n';
}
templates += '\nสิทธิ์โดยนัยสำหรับพนักงานที่ยืนยันตัวตน (ยังต้องใช้ boundary/การปกปิดรายละเอียด):\n\n' + PERMISSION_CATALOG.filter(p => p.allStaff).map(p => `- ${p.label} (\`${p.key}\`)`).join('\n') + '\n';
fs.writeFileSync(path.join(output, 'current-position-templates.md'), templates);
const summary = {
  sourceDate: '2026-11-24 Asia/Bangkok', apiEntrypoints: apiRows.length,
  classifications: Object.fromEntries([...new Set(apiRows.map(r => r.classification))].map(k => [k, apiRows.filter(r => r.classification === k).length])),
  unresolvedApiRoles: apiRows.filter(r => r.OWNER === 'UNRESOLVED').map(r => r.entrypoint),
  webRoutes: routeRows.length, unresolvedWebRoutes: routeRows.filter(r => r.OWNER === 'UNRESOLVED').map(r => r.path),
  menuDestinations: Object.fromEntries(roles.map(role => [role, new Set(menuRows.filter(r => r.role === role && r.kind === 'LINK').map(r => r.path)).size])),
  permissions: permissionRows.length,
  positions: DEFAULT_ACCESS_POSITIONS.map(p => ({ code: p.code, name: p.name, explicitTemplateGrants: p.permissions.length })),
};
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
