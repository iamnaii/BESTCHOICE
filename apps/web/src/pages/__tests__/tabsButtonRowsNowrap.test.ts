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
  const last = all[0];
  return last[1] ?? last[2];
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
