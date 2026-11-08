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
  ['after-sales/CaseTable.tsx'],
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
    // Anchored: the nearest opening tag before each table element must carry overflow-x-auto.
    const tables = [...src.matchAll(/<(?:table|ScreenTable|Table)\b/g)];
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      const before = src.slice(0, t.index);
      const wrapper = [...before.matchAll(/<(?!\/)[A-Za-z][^<>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})[^<>]*>/g)].pop();
      expect(wrapper, 'wrapper element before table').toBeDefined();
      expect(wrapper![1] ?? wrapper![2]).toContain('overflow-x-auto');
    }
  });
});

// /after-sales CaseTable draws its own chips (not the shared Badge): they must never wrap either.
describe('after-sales/CaseTable.tsx chips', () => {
  const src = read('after-sales/CaseTable.tsx');
  it.each([
    ['StageChip', /className=\{`inline-flex[^`]*`\}/],
    ['AwaitingMgrChip', /className="inline-flex[^"]*border-warning\/40[^"]*"/],
    ['SOURCE_LABEL chip', /className="inline-block[^"]*bg-muted[^"]*"\s*>\s*\{SOURCE_LABEL/],
  ])('%s is whitespace-nowrap', (_name, re) => {
    const m = src.match(re);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('whitespace-nowrap');
  });
});

// Long dynamic chip text must not push a nowrap chip off a 320/360px screen.
describe('long-text chips are capped and truncated, rows wrap', () => {
  const cap = (src: string, anchor: string) => {
    const i = src.indexOf(anchor);
    expect(i).toBeGreaterThan(-1);
    return src.slice(Math.max(0, i - 450), i + 450);
  };
  it('CaseTable mobile card row wraps and StageChip truncates with title', () => {
    const src = read('after-sales/CaseTable.tsx');
    expect(src).toMatch(/flex flex-wrap items-center justify-between[^"]*">\s*<span className="font-semibold text-primary">/);
    const chip = src.match(/function StageChip[\s\S]*?\n}\n/)![0];
    expect(chip).toContain('title={label}');
    expect(chip).toContain('max-w-full');
    expect(chip).toContain('<span className="truncate">{label}</span>');
  });
  it.each([
    ['../components/device-returns/ContractDeviceReturnActions.tsx', 'รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน {pending'],
    ['SmsTemplatesPage.tsx', 'รูปแบบย่อยของ {t.parent.name}'],
    ['FinanceReceivablePage/ContactTimeline.tsx', 'คุย: {log.contact.name}'],
    ['UnifiedInboxPage/components/ProductContextCard.tsx', '{promo.name}</span>'],
  ])('%s Badge has max-w-full, truncate span and title', (file, anchor) => {
    const around = cap(read(file), anchor);
    expect(around).toContain('max-w-full');
    expect(around).toContain('className="truncate"');
    expect(around).toContain('title=');
  });
});
