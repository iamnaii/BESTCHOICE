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
  ['EquityStatementPage.tsx'],
  ['equity/EquityViewPage.tsx'],
  ['assets/components/AssetEntrySection4Journal.tsx'],
  ['settings/TrashPage/components/TrashRows.tsx'],
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

// Round 3 Task 2: short fixed-text chips are hand-written spans (not the shared Badge): they must never wrap.
describe('fixed-text chips are whitespace-nowrap', () => {
  const around = (file: string, anchor: string) => {
    const src = read(file);
    const i = src.indexOf(anchor);
    expect(i, anchor).toBeGreaterThan(-1);
    const open = src.lastIndexOf('<span', i);
    return src.slice(open, i);
  };
  it.each([
    ['ContractCreatePage/components/ProductSelectStep.tsx', "{p.category === 'PHONE_NEW' ? 'มือ 1'"],
    ['CommissionsPage.tsx', 'ดูอย่างเดียว\n            </span>'],
    ['liff/LiffContract.tsx', 'ถึงกำหนด\n                        </span>'],
  ])('%s', (file, anchor) => {
    const tag = around(file, anchor);
    expect(tag).toContain('whitespace-nowrap');
  });
});

// A scroll wrapper must be a containing block for abspos children (sr-only), or they leak past it and widen the page.
describe('TrashRows scroll wrapper is positioned', () => {
  it('overflow-x-auto wrapper is relative', () => {
    const m = read('settings/TrashPage/components/TrashRows.tsx').match(/<div className="([^"]*overflow-x-auto[^"]*)">/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('relative');
  });
});

// Chat assignee chip shows Thai text: no leading-none (clips tone marks), height stays h-5.
describe('ChatPanel assignee chip', () => {
  const src = read('UnifiedInboxPage/components/ChatPanel.tsx');
  const chip = src.match(/'inline-flex h-5 max-w-\[11rem\][^']*'/);
  it('uses leading-snug and keeps h-5', () => {
    expect(chip).not.toBeNull();
    expect(chip![0]).toContain('leading-snug');
    expect(chip![0]).not.toContain('leading-none');
    expect(chip![0]).toContain('h-5');
  });
  it('appointment chip uses leading-snug (Thai text rule)', () => {
    const src = read('UnifiedInboxPage/components/ChatPanel.tsx');
    const before = src.slice(0, src.indexOf("roomApptState.tone === 'danger'"));
    const cls = before.slice(before.lastIndexOf("'inline-flex h-5"));
    expect(cls).toContain('leading-snug');
    expect(cls).not.toContain('leading-none');
  });
});

// Round 4 Task 2: shareholder table cells need horizontal padding so nowrap headers read apart.
// Anchored on this table's own <ScreenTable> ... </ScreenTable> (the doc.lines.map window would also take in neighbouring markup).
describe('EquityViewPage shareholder table — cells have horizontal padding', () => {
  const src = read('equity/EquityViewPage.tsx');
  const open = src.indexOf('<ScreenTable className="w-full text-sm">');
  const table = src.slice(open, src.indexOf('</ScreenTable>', open));
  const cells = [...table.matchAll(/<(th|td) className="([^"]*)"/g)];
  it('anchor found and every <th>/<td> has a plain className string (none skipped)', () => {
    expect(open).toBeGreaterThan(-1);
    expect(cells.length).toBe((table.match(/<(th|td)\b/g) ?? []).length);
    expect(cells.length).toBeGreaterThan(0);
  });
  const lastTd = cells.filter((m) => m[1] === 'td').pop();
  const lastTh = cells.filter((m) => m[1] === 'th').pop();
  it.each(cells.map((m, i) => [`${i} ${m[1]} ${m[2]}`, m[2], m === lastTd || m === lastTh]))('%s has horizontal padding', (_name, cls, isLast) => {
    expect(new RegExp(isLast ? '\\bpl-2\\b' : '\\b(px-2|pr-2)\\b').test(cls as string)).toBe(true);
  });
  it('last column (WHT) trims trailing padding: pl-2 only, no px-2', () => {
    const last = (tag: 'th' | 'td') => cells.filter((m) => m[1] === tag).pop()![2];
    for (const tag of ['th', 'td'] as const) {
      expect(last(tag)).toMatch(/\bpl-2\b/);
      expect(last(tag)).not.toMatch(/\bpx-2\b/);
    }
  });
  it('every <th> is still whitespace-nowrap', () => {
    const ths = [...table.matchAll(/<th className="([^"]*)"/g)];
    expect(ths.length).toBe((table.match(/<th\b/g) ?? []).length);
    expect(ths.length).toBeGreaterThan(0);
    for (const m of ths) expect(m[1]).toContain('whitespace-nowrap');
  });
});
