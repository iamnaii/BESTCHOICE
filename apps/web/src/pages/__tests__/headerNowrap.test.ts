import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Limitation: cannot see <th> with no className or with cn()/template classNames.
// Raw <th> tables (column headers; row-header names may wrap) outside the Table wrapper: headers never wrap, the table scrolls in its own box.
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

function headerClasses(src: string) {
  return [...src.matchAll(/<th\b(?![^>]*scope="row")[^>]*className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2]);
}

describe.each([
  ['AccountRolesPage.tsx'],
  ['ExpenseDetailPage.tsx'],
  ['WhtReportPage.tsx'],
  ['SettingsPage/components/UserPermissionTable.tsx'],
])('%s', (file) => {
  const src = read(file);
  it('every <th> is whitespace-nowrap', () => {
    const classes = headerClasses(src);
    expect(classes.length).toBeGreaterThan(0);
    for (const c of classes) expect(c).toContain('whitespace-nowrap');
  });
  it('table sits in a horizontal scroll container', () => {
    expect(src).toMatch(/overflow-x-auto/);
  });
});
