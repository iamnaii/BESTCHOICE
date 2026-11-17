import { describe, it, expect } from 'vitest';
import { getSidebarForRole, getZoneConfigForRole, type MenuItem, type Zone } from '../menu';
import { NAV_LABELS } from '../work-navigation';

/**
 * ชื่อเมนูศัพท์บัญชีตาม PEAK (2026-11-17) — หน้าเดียวกันต้องชื่อเดียวกันทุกตำแหน่ง ทุกโซน
 * เดิมหน้า /expenses มี 2 ชื่อ ("ค่าใช้จ่ายดำเนินงาน" / "บันทึกรายจ่าย") และ /finance/vat สลับลำดับ
 * เพราะเมนูแต่ละตำแหน่งเขียนชื่อเอง — ตอนนี้ทุกที่อ่านจาก NAV_LABELS
 */
const ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER'];
const ZONES: Zone[] = ['shop', 'fin'];

const EXPECTED: Record<string, string> = {
  '/overdue': NAV_LABELS.overdue,
  '/expenses': NAV_LABELS.expenses,
  '/finance/bank-accounts': NAV_LABELS.cashBank,
  '/finance/vat': NAV_LABELS.vat,
  '/finance/wht': NAV_LABELS.wht,
  '/finance/general-journal': NAV_LABELS.generalJournal,
  '/finance/general-ledger': NAV_LABELS.generalLedger,
  '/finance/balance-sheet': NAV_LABELS.balanceSheet,
  '/profit-loss': NAV_LABELS.profitLoss,
  '/finance/cash-flow': NAV_LABELS.cashFlow,
  '/finance/equity-statement': NAV_LABELS.equityStatement,
};

function itemsOf(role: string, zone: Zone): MenuItem[] {
  return getSidebarForRole(role, zone).flatMap((s) => s.items.flatMap((i) => [i, ...(i.children ?? [])]));
}

describe('ชื่อเมนูศัพท์บัญชี — ชื่อเดียวทุกตำแหน่ง', () => {
  it('ชื่อตาม PEAK', () => {
    expect(NAV_LABELS.balanceSheet).toBe('งบฐานะการเงิน');
    expect(NAV_LABELS.profitLoss).toBe('งบกำไรขาดทุน');
    expect(NAV_LABELS.generalLedger).toBe('บัญชีแยกประเภท');
    expect(NAV_LABELS.expenses).toBe('บันทึกค่าใช้จ่าย');
    expect(NAV_LABELS.vat).toBe('ภาษีมูลค่าเพิ่ม (ภ.พ.30)');
    expect(NAV_LABELS.wht).toBe('ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1/3/53)');
    expect(NAV_LABELS.cashBank).toBe('เงินสด/ธนาคาร');
  });

  for (const role of ROLES) {
    for (const zone of ZONES) {
      it(`${role} โซน ${zone}: เมนูศัพท์บัญชีใช้ชื่อจาก NAV_LABELS`, () => {
        const wrong = itemsOf(role, zone)
          .filter((i) => i.path in EXPECTED && i.label !== EXPECTED[i.path])
          .map((i) => `${i.path} = "${i.label}" (ควรเป็น "${EXPECTED[i.path]}")`);
        expect(wrong).toEqual([]);
      });
    }
  }

  it('แถบล่างมือถือของ VIEWER ไม่เหลือชื่อเก่า', () => {
    const labels = getZoneConfigForRole('VIEWER')!.bottomNav.fin.map((i) => i.label);
    expect(labels).not.toContain('งบดุล');
    expect(labels).not.toContain('P&L');
  });

  it('แถบล่างมือถือใช้ชื่อสั้นเดิม (ไม่ใช้ชื่อยาวของเมนูข้าง)', () => {
    for (const role of ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']) {
      const overdue = getZoneConfigForRole(role)!.bottomNav.fin.find((i) => i.path === '/overdue');
      expect(overdue?.label).toBe('ค้างชำระ');
    }
  });
});
