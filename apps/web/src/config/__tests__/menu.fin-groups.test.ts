import { describe, it, expect } from 'vitest';
import { getSidebarForRole, resolveZoneForPath } from '../menu';

/**
 * จัดกลุ่มโซนไฟแนนซ์ตาม PEAK (2026-11-17) — กลุ่มหนึ่งมีงานชนิดเดียว เรียงเหมือนกันทุกตำแหน่ง
 * กลุ่ม fin-* เป็นค่าคงที่ใช้ร่วม (แบบ assetMenuSection) ⇒ สมาชิกเหมือนกันโดยโครงสร้าง
 */
const fin = (role: string) => getSidebarForRole(role, 'fin');
const labels = (role: string) => fin(role).map((s) => s.label);
const paths = (role: string, key: string) =>
  fin(role).find((s) => s.key === key)?.items.map((i) => i.path);

const SHARED_TAIL = ['รายรับ', 'ติดตามหนี้', 'รายจ่าย', 'สินทรัพย์', 'การเงิน', 'ภาษี', 'บัญชี & งบการเงิน', 'ปิดงวด & ทุน', 'รายงาน'];

describe('โซนไฟแนนซ์ — ลำดับกลุ่ม', () => {
  it('OWNER', () => {
    expect(labels('OWNER')).toEqual(['ภาพรวม', ...SHARED_TAIL]);
  });
  it('FINANCE_MANAGER', () => {
    expect(labels('FINANCE_MANAGER')).toEqual(['ภาพรวม', 'ลูกค้า & สัญญา', ...SHARED_TAIL]);
  });
  it('ACCOUNTANT', () => {
    expect(labels('ACCOUNTANT')).toEqual(['ภาพรวม', ...SHARED_TAIL, 'ข้อมูลอ้างอิง']);
  });
});

describe('โซนไฟแนนซ์ — กลุ่มใช้ร่วมเป็นตัวเดียวกันทุกตำแหน่ง', () => {
  it.each(['fin-revenue', 'fin-expense', 'asset', 'fin-cash', 'fin-tax', 'fin-statements'])('%s', (key) => {
    const [o, f, a] = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].map((r) => fin(r).find((s) => s.key === key));
    expect(o).toBeDefined();
    expect(f).toBe(o);
    expect(a).toBe(o);
  });

  it('รายรับ มีใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ (ไม่ใช่กลุ่มแยกเมนูเดียว)', () => {
    expect(paths('OWNER', 'fin-revenue')).toEqual([
      '/payments', '/other-income', '/finance/contract-cancellation', '/finance/e-receipt-auto',
    ]);
  });

  it('บัญชี & งบการเงิน รวมสมุดรายวันกับบัญชีแยกประเภท', () => {
    expect(paths('OWNER', 'fin-statements')).toEqual([
      '/finance/general-journal', '/finance/general-ledger', '/finance/balance-sheet',
      '/profit-loss', '/finance/cash-flow', '/finance/equity-statement',
    ]);
  });
});

describe('โซนไฟแนนซ์ — กลุ่มที่สิทธิ์ต่างกัน', () => {
  it('ติดตามหนี้: งานทวงหนี้ออกจากกลุ่มรายรับแล้ว', () => {
    expect(paths('OWNER', 'owner-collection')).toEqual(['/overdue', '/letters', '/mdm', '/repossessions']);
    expect(paths('FINANCE_MANAGER', 'fm-collection')).toEqual(['/overdue', '/letters', '/repossessions']);
    expect(paths('ACCOUNTANT', 'acc-collection')).toEqual(['/letters', '/repossessions']);
  });

  it('ยึดคืนของเจ้าของยังอยู่โซนไฟแนนซ์ที่เดียว (คำสั่งเจ้าของ 2026-08-29)', () => {
    expect(resolveZoneForPath('OWNER', '/repossessions')).toBe('fin');
    expect(getSidebarForRole('OWNER', 'shop').flatMap((s) => s.items.map((i) => i.path))).not.toContain('/repossessions');
  });

  it('ปิดงวด & ทุน: งวดบัญชีมีเฉพาะเจ้าของ', () => {
    const tail = ['/financial-audit', '/finance/peak-export', '/finance/equity', '/finance/dividend-register'];
    expect(paths('OWNER', 'owner-period-close')).toEqual(['/monthly-close', '/finance/year-end-closing', '/accounting/periods', ...tail]);
    expect(paths('FINANCE_MANAGER', 'fm-closing')).toEqual(['/monthly-close', '/finance/year-end-closing', ...tail]);
    expect(paths('ACCOUNTANT', 'acc-close')).toEqual(['/monthly-close', '/finance/year-end-closing', ...tail]);
  });

  it('รายงาน: ค่าคอมมิชชันเฉพาะเจ้าของกับผจก.การเงิน', () => {
    const base = ['/reports', '/imported-sales', '/finance/aging-report', '/finance/bad-debt-report', '/finance/intercompany-report'];
    expect(paths('OWNER', 'owner-reports')).toEqual([...base, '/commissions']);
    expect(paths('FINANCE_MANAGER', 'fm-reports')).toEqual([...base, '/commissions']);
    expect(paths('ACCOUNTANT', 'acc-reports')).toEqual(base);
  });

  it('ไม่มีกลุ่มเมนูเดียวที่ถอดแล้ว', () => {
    const keys = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].flatMap((r) => fin(r).map((s) => s.key));
    for (const gone of ['owner-fin-notifications', 'owner-bank', 'fm-bank', 'acc-bank', 'acc-daily']) {
      expect(keys).not.toContain(gone);
    }
  });
});
