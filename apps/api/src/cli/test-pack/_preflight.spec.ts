import { DRIVE_REQUIRED_ACCOUNTS, missingAccounts } from './_preflight';

describe('missingAccounts', () => {
  it('คืนรหัสที่ขาด เรียงตามลำดับที่ต้องการ', () => {
    expect(missingAccounts(['S11-3101', 'S51-1106', 'S21-2002'], ['S21-2002'])).toEqual([
      'S11-3101',
      'S51-1106',
    ]);
  });

  it('มีครบ = คืน array ว่าง', () => {
    expect(missingAccounts(['11-1101'], ['11-1101', '11-2101'])).toEqual([]);
  });
});

describe('DRIVE_REQUIRED_ACCOUNTS', () => {
  it('มีบัญชีใหม่สามตัวที่ prod ต้องรัน seed:coa ถึงจะมี', () => {
    expect(DRIVE_REQUIRED_ACCOUNTS).toEqual(
      expect.arrayContaining(['S11-3101', 'S51-1106', 'S21-2002']),
    );
  });

  it('ไม่มีรหัสซ้ำ', () => {
    expect(new Set(DRIVE_REQUIRED_ACCOUNTS).size).toBe(DRIVE_REQUIRED_ACCOUNTS.length);
  });
});
