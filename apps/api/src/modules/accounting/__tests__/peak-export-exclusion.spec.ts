import {
  LEGACY_INTEREST_ACCOUNTS,
  PEAK_EXPORT_EXCLUDED_FLOWS,
  isExcludedFromPeakExport,
  isExcludedLegacyInterestLine,
} from '../peak-export-exclusion';

/**
 * ตัวกรองไฟล์ส่งออก PEAK ของสัญญาที่ย้ายจากระบบเก่า (Task 10b · สเปค ร่าง 5 §5.6 / ด่าน 6.6 + 6.10)
 * PEAK รับรู้รายได้ (รวมดอกเบี้ย) ของสัญญาเก่าไปทั้งก้อนแล้วตอนทำสัญญา ⇒ ไฟล์ส่งออกต้องไม่ส่ง
 * รายการยกมา / marker และบรรทัด 11-2106 / 41-1101 ของสัญญาที่มี legacyContractCode
 */
describe('peak-export-exclusion', () => {
  describe('isExcludedFromPeakExport', () => {
    it('lists exactly the two legacy flows', () => {
      expect([...PEAK_EXPORT_EXCLUDED_FLOWS]).toEqual(['legacy-opening', 'legacy-prior-receipt']);
    });

    it.each(['legacy-opening', 'legacy-prior-receipt'])('excludes metadata.flow = %s', (flow) => {
      expect(isExcludedFromPeakExport({ metadata: { flow, contractId: 'ct-1' } })).toBe(true);
    });

    it('excludes the prior-receipt marker even though it carries tag 2B', () => {
      expect(
        isExcludedFromPeakExport({ metadata: { tag: '2B', flow: 'legacy-prior-receipt' } }),
      ).toBe(true);
    });

    it('keeps a real tag 2B receipt (filter is by flow, not tag)', () => {
      expect(isExcludedFromPeakExport({ metadata: { tag: '2B', flow: 'payment-receipt' } })).toBe(
        false,
      );
      expect(isExcludedFromPeakExport({ metadata: { tag: '2B' } })).toBe(false);
    });

    it('keeps entries whose flow is not a legacy flow', () => {
      for (const flow of [
        'installment-accrual',
        'expense-accrual',
        'legacy',
        'LEGACY-OPENING',
        '',
      ]) {
        expect(isExcludedFromPeakExport({ metadata: { flow } })).toBe(false);
      }
    });

    it('does not match a legacy flow name carried in another key (e.g. tag)', () => {
      expect(isExcludedFromPeakExport({ metadata: { tag: 'legacy-opening' } })).toBe(false);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'legacy-opening'],
      ['a number', 7],
      ['an array', ['legacy-opening']],
      ['an array holding an object with flow', [{ flow: 'legacy-opening' }]],
      ['flow as a non-string', { flow: ['legacy-opening'] }],
    ])('is defensive when metadata is %s', (_label, metadata) => {
      expect(isExcludedFromPeakExport({ metadata })).toBe(false);
    });
  });

  describe('isExcludedLegacyInterestLine', () => {
    it('lists exactly the two interest accounts', () => {
      expect([...LEGACY_INTEREST_ACCOUNTS]).toEqual(['11-2106', '41-1101']);
    });

    it.each(['11-2106', '41-1101'])('drops %s of a legacy contract', (accountCode) => {
      expect(isExcludedLegacyInterestLine({ accountCode }, { legacyContractCode: 'BC-0001' })).toBe(
        true,
      );
    });

    it.each(['11-2101', '11-2103', '11-2105', '21-2101', '21-2102', '32-1101', '52-1106'])(
      'keeps %s of a legacy contract',
      (accountCode) => {
        expect(
          isExcludedLegacyInterestLine({ accountCode }, { legacyContractCode: 'BC-0001' }),
        ).toBe(false);
      },
    );

    it.each(['11-2106', '41-1101'])(
      'keeps %s of a contract without a legacy code',
      (accountCode) => {
        expect(isExcludedLegacyInterestLine({ accountCode }, { legacyContractCode: null })).toBe(
          false,
        );
      },
    );

    it('treats an empty-string legacy code as not legacy', () => {
      expect(
        isExcludedLegacyInterestLine({ accountCode: '11-2106' }, { legacyContractCode: '' }),
      ).toBe(false);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])(
      'keeps interest lines when the contract is %s (no contractId / not found)',
      (_l, contract) => {
        expect(isExcludedLegacyInterestLine({ accountCode: '41-1101' }, contract)).toBe(false);
      },
    );
  });
});
