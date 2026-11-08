import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-reading test (same style as headerNowrap.test.ts): rendering these pages needs heavy mocks.
// House touch-target minimum (typography audit item 5): mobile (< lg) ≥ 44px → max-lg:min-h-11,
// desktop (≥ lg) ≥ 32px → lg:min-h-8. Each case pins ONE control, found by its visible text.
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** className of the nearest <button>/<Button>/<Link> opening tag before `anchor`. */
function classOf(file: string, anchor: string | RegExp): string {
  const src = read(file);
  const at = typeof anchor === 'string' ? src.indexOf(anchor) : src.search(anchor);
  if (at < 0) throw new Error(`anchor not found in ${file}: ${String(anchor)}`);
  const head = src.slice(0, at);
  const open = Math.max(head.lastIndexOf('<button'), head.lastIndexOf('<Button'), head.lastIndexOf('<Link'));
  if (open < 0) throw new Error(`no control before anchor in ${file}: ${String(anchor)}`);
  const m = src.slice(open, at).match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
  if (!m) throw new Error(`control has no static className in ${file}: ${String(anchor)}`);
  return m[1] ?? m[2];
}

const MOBILE = 'max-lg:min-h-11';
const DESKTOP = 'lg:min-h-8';

// Controls whose growth would push the surrounding layout: equal negative margins keep the
// original layout box (Review Focus 4 — back links must not shift the page header).
const KEEPS_BOX = /max-lg:-m[tby]-/;
const KEEPS_BOX_DESKTOP = /(?:^|\s)lg:-m[tby]-/;

describe.each<[string, string | RegExp, { keepsBox?: boolean; desktopOnlyBox?: boolean; growsDown?: boolean }]>([
  // Settings card "แก้ไข" (9 /settings/* routes)
  ['SettingsPage/components/shared.tsx', />\s*แก้ไข\s*</, { keepsBox: true }],
  ['SettingsPage/components/LateFeeSettingsCard.tsx', />\s*แก้ไข\s*</, { keepsBox: true }],
  // Back links above page headings
  ['UsersPage/UserDetailPage.tsx', 'กลับไปรายการผู้ใช้', { growsDown: true }],
  ['other-income/OtherIncomeEntryPage.tsx', 'กลับไปหน้ารายการ', { keepsBox: true }],
  ['assets/AssetEntryPage.tsx', 'กลับไปหน้ารายการ', { keepsBox: true }],
  ['InspectionDetailPage.tsx', /\/>\s*กลับ\s*</, { keepsBox: true }],
  ['ExpenseFavoritesPage.tsx', /\/>\s*กลับ\s*</, {}],
  ['PurchaseOrdersPage/GoodsReceiptPrintPage.tsx', /\/>\s*กลับ\s*</, {}],
  // Text links / small buttons
  ['assets/AssetEntryPage.tsx', '{e.message}', {}],
  ['assets/components/AssetEntrySection3Vendor.tsx', 'ล้างชื่อผู้ขาย', {}],
  ['assets/AssetsListPage.tsx', '{row.assetCode}', {}],
  ['liff/LiffContract.tsx', 'แสดงอีก', {}],
  ['InterestConfigPage.tsx', 'สร้างตั้งค่าแรก', { keepsBox: true }],
  ['PricingTemplatesPage.tsx', 'เพิ่มราคาตั้งต้นรายการแรก', { keepsBox: true }],
  ['DunningSettingsPage.tsx', 'เพิ่ม กฎ แรก', { keepsBox: true }],
  ['LineOaSettingsPage.tsx', "showSecrets['token'] ? 'ซ่อน' : 'แสดง'", {}],
  ['LineOaSettingsPage.tsx', "showSecrets['secret'] ? 'ซ่อน' : 'แสดง'", {}],
  ['ProductCreatePage/components/PriceCard.tsx', '+ เพิ่มราคา', {}],
  ['ProductDetailPage/components/SellingPriceCard.tsx', />\s*แก้ราคา\s*</, {}],
  ['ProductDetailPage/components/SellingPriceCard.tsx', />\s*ขึ้นเว็บ\s*</, { keepsBox: true }],
  ['CustomerDetailPage/components/RecentActivityCard.tsx', 'ดูการเดินทางทั้งหมด', {}],
  ['ContractDetailPage.tsx', 'ดูรายละเอียดลูกค้า (ข้อมูลปัจจุบัน)', { keepsBox: true }],
  ['ContractDetailPage.tsx', />\s*ดูรายละเอียดสินค้า\s*</, { keepsBox: true }],
  ['other-income/OtherIncomeEntryPage.tsx', 'ใช้ยอดสุทธิ (', { desktopOnlyBox: true }],
])('%s — %s', (file, anchor, opts) => {
  const c = classOf(file, anchor);
  it('meets 44px on mobile and 32px on desktop', () => {
    expect(c).toContain(MOBILE);
    expect(c.split(/\s+/)).toContain(DESKTOP);
  });
  it('centres its label in the taller box', () => {
    // <button> centres natively; links and inline-flex text controls need items-center
    if (/\b(?:inline-flex|flex)\b/.test(c)) expect(c).toContain('items-center');
  });
  if (opts.keepsBox) {
    it('keeps the original layout box (negative margins on both breakpoints)', () => {
      expect(c).toMatch(KEEPS_BOX);
      expect(c).toMatch(KEEPS_BOX_DESKTOP);
    });
  }
  if (opts.growsDown) {
    // first thing on the page, flush under the sticky TopBar (PageShell pt-0): a negative top margin
    // would tuck the hit area under the TopBar, so it grows downward into the old mb-4 gap instead
    it('grows downward only (no negative top margin) and gives back the old bottom gap', () => {
      expect(c).not.toMatch(/-m[ty]-/);
      expect(c.split(/\s+/)).toContain('max-lg:mb-0');
      expect(c).not.toMatch(/(?:^|\s)mb-4(?:\s|$)/);
    });
  }
  if (opts.desktopOnlyBox) {
    it('keeps the desktop layout box (mobile already grew before this task)', () => {
      expect(c).toMatch(KEEPS_BOX_DESKTOP);
    });
  }
});

describe('LineOaSettingsPage.tsx — secret toggles', () => {
  it('keeps the small pill look inside the input: the pill is an inner span, the button is the hit area', () => {
    const src = read('LineOaSettingsPage.tsx');
    const pills = [...src.matchAll(/<span className="([^"]*)">\s*\{showSecrets\['(?:token|secret)'\] \? 'ซ่อน' : 'แสดง'\}/g)];
    expect(pills.length).toBe(2);
    for (const [, c] of pills) expect(c).toContain('bg-primary/10');
  });
});

describe('SalesHistoryPage.tsx — "กำไรรวม" help trigger', () => {
  const c = classOf('SalesHistoryPage.tsx', 'กำไรรวม <Info');
  it('meets 44px on mobile (desktop min-h-8 already) and keeps its layout box', () => {
    expect(c).toContain(MOBILE);
    expect(c).toContain('min-h-8');
    expect(c).toMatch(KEEPS_BOX);
  });
});

describe('ProductDetailPage/index.tsx — page tabs (ข้อมูลสินค้า / รูปถ่าย / ขึ้นเว็บ)', () => {
  it('tabs meet 44px on mobile (desktop 39px already ≥ 32px)', () => {
    expect(classOf('ProductDetailPage/index.tsx', '{tab.label}')).toContain(MOBILE);
  });
});

describe('SupplierDetailPage.tsx — active toggle (carried from Task 1)', () => {
  const c = classOf('SupplierDetailPage.tsx', "supplier.isActive ? 'ซ่อนผู้จัดจำหน่าย' : 'เปิดใช้งาน'");
  it('never wraps and meets the touch minimum', () => {
    expect(c).toContain('whitespace-nowrap');
    expect(c).toContain(MOBILE);
    expect(c.split(/\s+/)).toContain(DESKTOP);
  });
});
