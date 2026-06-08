import {
  codePrefix,
  SECTION_MAP,
  EXPENSE_ACCOUNT_CATEGORY,
  EQUITY_ACCOUNTS,
} from './accounting-section-map.util';

describe('accounting-section-map.util', () => {
  describe('codePrefix', () => {
    it('FINANCE code → first 2 chars', () => {
      expect(codePrefix('11-1101')).toBe('11');
      expect(codePrefix('53-1306')).toBe('53');
    });
    it('SHOP code (S-prefix) → first 3 chars', () => {
      expect(codePrefix('S11-1101')).toBe('S11');
      expect(codePrefix('S53-1101')).toBe('S53');
    });
  });

  describe('SECTION_MAP', () => {
    it('maps FINANCE + SHOP prefixes to their Thai section names', () => {
      expect(SECTION_MAP['11']).toBe('สินทรัพย์หมุนเวียน');
      expect(SECTION_MAP['55']).toBe('ค่าใช้จ่ายโปรแกรมบัญชี (ยกเว้น P&L)');
      expect(SECTION_MAP['S50']).toBe('ต้นทุนขาย (SHOP)');
      expect(SECTION_MAP['S11']).toBe('สินทรัพย์หมุนเวียน (SHOP)');
    });
    it('codePrefix output keys resolve in SECTION_MAP', () => {
      expect(SECTION_MAP[codePrefix('S52-1101')]).toBe('ค่าใช้จ่ายบริหาร (SHOP)');
      expect(SECTION_MAP[codePrefix('41-2101')]).toBe('รายได้จากการดำเนินงาน');
    });
  });

  describe('EXPENSE_ACCOUNT_CATEGORY', () => {
    it('rolls accounts up to the right P&L category', () => {
      expect(EXPENSE_ACCOUNT_CATEGORY['52-1101']).toBe('SELL_COMMISSION');
      expect(EXPENSE_ACCOUNT_CATEGORY['53-1102']).toBe('ADMIN_SOCIAL_SECURITY');
      expect(EXPENSE_ACCOUNT_CATEGORY['53-1601']).toBe('ADMIN_DEPRECIATION');
      expect(EXPENSE_ACCOUNT_CATEGORY['54-1101']).toBe('OTHER_MISC');
    });
    it('leaves unlisted accounts undefined (they still count in section totals)', () => {
      expect(EXPENSE_ACCOUNT_CATEGORY['99-9999']).toBeUndefined();
    });
  });

  describe('EQUITY_ACCOUNTS', () => {
    it('lists the 4 equity accounts in order with fallback names', () => {
      expect(EQUITY_ACCOUNTS.map((a) => a.code)).toEqual(['31-1101', '31-1102', '32-1101', '33-1101']);
      expect(EQUITY_ACCOUNTS[3].defaultName).toBe('กำไร(ขาดทุน)สุทธิประจำปี');
    });
  });
});
