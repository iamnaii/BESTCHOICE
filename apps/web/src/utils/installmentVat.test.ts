import { describe, expect, it } from 'vitest';
import { installmentVat } from './installmentVat';

// คำตัดสินเจ้าของ #22 (31 ต.ค. 2026): VAT ของตั้งค่าดอกเบี้ยอ่านจากบริษัท FINANCE ที่เดียว — กติกาเดียวกับ server
// (`resolveInstallmentVat`): FINANCE ไม่จด VAT = 0 · มีอัตรา = อัตรานั้น · ไม่มีแถว/อัตรา = VAT_RATE ของระบบ (ค่าเริ่มต้น 7)
describe('installmentVat', () => {
  const shop = { companyCode: 'SHOP', vatRegistered: false, vatRate: null };

  it('FINANCE registered with a rate → that rate (string decimal from the API)', () => {
    expect(
      installmentVat(
        [shop, { companyCode: 'FINANCE', vatRegistered: true, vatRate: '0.0700' }],
        '8',
      ),
    ).toEqual({ fraction: 0.07, percentText: '7%', source: 'FINANCE' });
  });

  it('FINANCE not VAT-registered → 0%', () => {
    expect(
      installmentVat([{ companyCode: 'FINANCE', vatRegistered: false, vatRate: '0.0700' }], '7'),
    ).toEqual({ fraction: 0, percentText: '0%', source: 'FINANCE' });
  });

  it('no FINANCE row → the system VAT_RATE (percent or legacy decimal form)', () => {
    expect(installmentVat([shop], '8')).toEqual({
      fraction: 0.08,
      percentText: '8%',
      source: 'SYSTEM',
    });
    expect(installmentVat([shop], '0.07')).toMatchObject({ fraction: 0.07, source: 'SYSTEM' });
    expect(installmentVat(undefined, undefined)).toMatchObject({
      fraction: 0.07,
      source: 'SYSTEM',
    });
  });
});
