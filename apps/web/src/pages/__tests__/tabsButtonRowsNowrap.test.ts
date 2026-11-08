import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Limitation: source-text test. Tab bars are hand-rendered (not the shared Tabs, which is already nowrap + scrollable),
// so each page is pinned individually: tab/button text never wraps, tab bars scroll inside themselves,
// button rows wrap whole buttons onto the next line.
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/** className (string or template literal) of the nearest element opening tag before the first occurrence of `text`. */
function classBefore(src: string, text: string, tagStart: string): string {
  const idx = src.indexOf(text);
  expect(idx, `text not found: ${text}`).toBeGreaterThan(-1);
  const start = src.lastIndexOf(tagStart, idx);
  expect(start, `no ${tagStart} before ${text}`).toBeGreaterThan(-1);
  const region = src.slice(start, idx);
  const all = [...region.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)];
  expect(all.length, `no className for ${text}`).toBeGreaterThan(0);
  const own = all[0];
  return own[1] ?? own[2];
}

/** className of the first <div className="..."> after `marker`. */
function divAfter(src: string, marker: string): string {
  const idx = src.indexOf(marker);
  expect(idx, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const m = /<div className="([^"]*)"/.exec(src.slice(idx));
  expect(m).not.toBeNull();
  return m![1];
}

const tabBars: Array<[string, string, string, string[]]> = [
  ['NotificationsPage/index.tsx', '{/* Tabs */}', '', ['ประวัติการส่ง', 'แม่แบบข้อความ', 'แจ้งพนักงาน (LINE)']],
  ['CommissionsPage.tsx', '{/* Tabs */}', '', ['<ListOrdered', '<Sparkles']],
  ['ContractsPage.tsx', '{/* View Tabs', '', ['สัญญาของฉัน', 'รอตรวจสอบ']],
  ['PurchaseOrdersPage/index.tsx', '{/* Tabs */}', '', ['รายการ PO', 'ยอดค้างชำระ']],
  ['ProductDetailPage/index.tsx', '{/* Tabs — always shown', '', ['{tab.label}']],
];

describe.each(tabBars)('%s tab bar', (file, marker, _x, labels) => {
  const src = read(`pages/${file}`);
  it('bar scrolls inside itself without widening the page', () => {
    const c = divAfter(src, marker);
    expect(c).toContain('overflow-x-auto');
    expect(c).toContain('max-w-full');
    expect(c).toContain('min-w-0');
  });
  it.each(labels)('tab %s does not wrap or shrink', (label) => {
    const c = classBefore(src, label, '<button');
    expect(c).toContain('whitespace-nowrap');
    expect(c).toContain('shrink-0');
  });
});

describe('ChartOfAccountsPage scope tabs', () => {
  const src = read('pages/ChartOfAccountsPage.tsx');
  it('group scrolls inside itself and tabs do not wrap', () => {
    const m = /<div className="([^"]*)" role="group"/.exec(src);
    expect(m![1]).toContain('overflow-x-auto');
    expect(m![1]).not.toContain('overflow-hidden');
    expect(m![1]).toContain('max-w-full');
    expect(src).toMatch(/'min-h-11 px-4 py-2 text-sm whitespace-nowrap shrink-0 /);
  });
});

const buttons: Array<[string, string[]]> = [
  ['PricingTemplatesPage.tsx', ['ดาวน์โหลดแบบฟอร์ม', "'นำเข้า Excel'", '+ เพิ่มราคาตั้งต้น']],
  ['ImportedSalesPage.tsx', ['ก่อนหน้า', 'ถัดไป']],
  ['NotificationsPage/index.tsx', ["'ส่งเตือนก่อนครบกำหนด'", "'ส่งทวงหนี้ค้างชำระ'"]],
  ['other-income/OtherIncomeViewPage.tsx', ['คัดลอก\n', 'แก้ไขและ ลงบัญชี']],
  ['other-income/components/TemplatePickerCombobox.tsx', ['ใช้แม่แบบ']],
  ['../components/expense-form-v4/AdjustmentSection.tsx', ['เพิ่มแบบ ด้วยตนเอง']],
];

describe.each(buttons)('%s buttons', (file, texts) => {
  const src = read(`pages/${file}`);
  it.each(texts)('button %j is whitespace-nowrap', (text) => {
    expect(classBefore(src, text, '<button')).toContain('whitespace-nowrap');
  });
});

// OtherIncomeViewPage has a second "แก้ไขและ ลงบัญชี" button (full-width sidebar draft shortcut) — pin it too.
describe('OtherIncomeViewPage sidebar draft edit button', () => {
  it('second "แก้ไขและ ลงบัญชี" button is whitespace-nowrap', () => {
    const src = read('pages/other-income/OtherIncomeViewPage.tsx');
    const text = 'แก้ไขและ ลงบัญชี';
    const first = src.indexOf(text);
    expect(first, 'first occurrence').toBeGreaterThan(-1);
    const idx = src.indexOf(text, first + 1);
    expect(idx, 'second occurrence').toBeGreaterThan(-1);
    const start = src.lastIndexOf('<button', idx);
    expect(start, 'no <button before second occurrence').toBeGreaterThan(-1);
    const all = [...src.slice(start, idx).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)];
    expect(all.length, 'no className for second occurrence').toBeGreaterThan(0);
    const own = all[0];
    expect(own[1] ?? own[2]).toContain('whitespace-nowrap');
  });
});

describe('button rows wrap whole buttons', () => {
  it('PricingTemplatesPage action row', () => {
    expect(divAfter(read('pages/PricingTemplatesPage.tsx'), 'action={')).toContain('flex-wrap');
  });
  it('ImportedSalesPage pager row', () => {
    const src = read('pages/ImportedSalesPage.tsx');
    expect(classBefore(src, 'ก่อนหน้า', '<div className=')).toContain('flex-wrap');
  });
  it('NotificationsPage quick actions row', () => {
    expect(divAfter(read('pages/NotificationsPage/index.tsx'), '{/* Quick Actions */}')).toContain('flex-wrap');
  });
  it('OtherIncomeViewPage header action row', () => {
    const src = read('pages/other-income/OtherIncomeViewPage.tsx');
    expect(classBefore(src, 'คัดลอก\n', '<div className=')).toContain('flex-wrap');
  });
  it('OtherIncomeEntryPage SectionHeader (hosts the "ใช้แม่แบบ" action)', () => {
    const src = read('pages/other-income/OtherIncomeEntryPage.tsx');
    expect(divAfter(src, 'function SectionHeader(')).toContain('flex-wrap');
  });
  it('AdjustmentSection manual-add row', () => {
    const src = read('components/expense-form-v4/AdjustmentSection.tsx');
    expect(classBefore(src, 'ไม่มีผลต่าง', '<div className=')).toContain('flex-wrap');
  });
});

// Underline technique: a scroll container clips anything below its padding box, so a tab's -mb-px (2px underline
// overlapping the bar border) would lose 1px. Bars that used -mb-px draw their bottom line as an inset shadow
// (token colour) and the tabs sit flush; the rest keep border-b with tabs above it. Either way: no -mb-px in a scroller.
describe('scrollable tab bars keep the full 2px underline', () => {
  it.each([
    ['NotificationsPage/index.tsx', '{/* Tabs */}'],
    ['ContractsPage.tsx', '{/* View Tabs'],
  ])('%s: inset-shadow line, no border-b, no -mb-px', (file, marker) => {
    const src = read(`pages/${file}`);
    const bar = divAfter(src, marker);
    expect(bar).toMatch(/shadow-\[inset_0_-1px_0_hsl\(var\(--border\)/);
    expect(bar).not.toMatch(/(^|\s)border-b(\s|$)/);
    expect(bar).toContain('overflow-y-hidden');
    const i = src.indexOf(marker);
    const barEnd = src.indexOf('</div>', i);
    expect(src.slice(i, barEnd)).not.toContain('-mb-px');
  });
  it.each([
    ['CommissionsPage.tsx', '{/* Tabs */}'],
    ['PurchaseOrdersPage/index.tsx', '{/* Tabs */}'],
    ['ProductDetailPage/index.tsx', '{/* Tabs — always shown'],
  ])('%s: border-b kept, tabs not pulled into it', (file, marker) => {
    const src = read(`pages/${file}`);
    expect(divAfter(src, marker)).toContain('border-b');
    const i = src.indexOf(marker);
    expect(src.slice(i, i + 2500)).not.toContain('-mb-px');
  });
});

describe('SellingPriceCard "ขึ้นเว็บ" readiness button', () => {
  it('never wraps', () => {
    const src = read('pages/ProductDetailPage/components/SellingPriceCard.tsx');
    const cls = classBefore(src, '>\n                ขึ้นเว็บ', '<button');
    expect(cls).toContain('whitespace-nowrap');
  });
});

describe('CommissionsPage "ดูอย่างเดียว" badge', () => {
  it('lives in the payouts panel header, not inside the tab button', () => {
    const src = read('pages/CommissionsPage.tsx');
    const tabIdx = src.indexOf('ใบจ่ายรายเดือน\n'); // label text inside the tab button
    const badgeIdx = src.indexOf('ดูอย่างเดียว\n');
    const payoutsIdx = src.indexOf("activeTab === 'payouts' && (");
    expect(badgeIdx).toBeGreaterThan(payoutsIdx);
    expect(src.slice(tabIdx, tabIdx + 400)).not.toContain('ดูอย่างเดียว');
    expect(classBefore(src, 'ดูอย่างเดียว\n', '<span')).toContain('whitespace-nowrap');
  });
});
