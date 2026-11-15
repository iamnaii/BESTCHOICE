// Field-scale check — synthetic chart of accounts for the route mocks (spec §5), read from the CPA CSV
// that prisma/seed-coa-finance.ts seeds from. Same column rules as
// apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts (loadCoaFromCsv / parseCsvLine); response
// shapes mirror ChartOfAccountsService.findAll / findByCodes / findGrouped.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ACCOUNT_CODE_RE = /^S?\d{2}-\d{4}$/;
export const ACTIVE_STATUS = 'ใช้งาน';
export const defaultCoaCsv = () =>
  fileURLToPath(
    new URL('../../apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv', import.meta.url),
  );

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

export function parseCoaCsv(text) {
  return text
    .split(/\r?\n/)
    .map(parseCsvLine)
    .filter((c) => ACCOUNT_CODE_RE.test((c[0] ?? '').trim()))
    .map((c) => ({
      id: `coa-${c[0].trim()}`,
      code: c[0].trim(),
      name: (c[1] ?? '').trim(),
      type: (c[2] ?? '').trim(),
      normalBalance: (c[3] ?? '').trim(),
      category: (c[4] ?? '').trim() || null,
      vatApplicable: (c[5] ?? '').trim() === 'ใช่',
      notes: (c[6] ?? '').trim() || null,
      status: (c[7] ?? '').trim() || ACTIVE_STATUS,
    }))
    .sort(byCode);
}

export const loadCoa = (file = defaultCoaCsv()) => parseCoaCsv(readFileSync(file, 'utf8'));

// GET /chart-of-accounts/grouped?type&codePrefix&category → { groups: [{ category, accounts }] } (active only)
export function coaGrouped(rows, { type, codePrefix, category } = {}) {
  const groups = new Map();
  for (const r of rows) {
    if (r.status !== ACTIVE_STATUS) continue;
    if (type && r.type !== type) continue;
    if (codePrefix && !r.code.startsWith(codePrefix)) continue;
    if (category && r.category !== category) continue;
    const key = r.category ?? 'อื่นๆ';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      code: r.code, name: r.name, normalBalance: r.normalBalance, vatApplicable: r.vatApplicable, notes: r.notes,
    });
  }
  return { groups: [...groups].map(([group, accounts]) => ({ category: group, accounts })) };
}

// GET /chart-of-accounts/by-codes?codes=a,b → [{ code, name }] ordered by code
export function coaByCodes(rows, codes) {
  const wanted = new Set(codes.map((c) => c.trim()).filter(Boolean));
  return rows.filter((r) => wanted.has(r.code)).map((r) => ({ code: r.code, name: r.name }));
}

// GET /chart-of-accounts?type&status&q → rows ordered by code
export function coaList(rows, { type, status, q } = {}) {
  const needle = (q ?? '').trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!type || r.type === type) &&
      (!status || r.status === status) &&
      (!needle || r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)),
  );
}
