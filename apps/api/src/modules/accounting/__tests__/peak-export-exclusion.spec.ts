import {
  LEGACY_INTEREST_ACCOUNTS,
  LEGACY_OPENING_FLOW,
  LEGACY_PRIOR_RECEIPT_FLOW,
  LEGACY_VAT_CATCHUP_FLOW,
  PEAK_EXPORT_EXCLUDED_FLOWS,
  isExcludedFromPeakExport,
  isExcludedLegacyInterestLine,
  isLegacyInterestAccount,
  peakExportContractId,
  peakExportOriginalEntryId,
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

    it('exports the flow names the importer must write (no retyped strings)', () => {
      expect(LEGACY_OPENING_FLOW).toBe('legacy-opening');
      expect(LEGACY_PRIOR_RECEIPT_FLOW).toBe('legacy-prior-receipt');
      expect(LEGACY_VAT_CATCHUP_FLOW).toBe('legacy-vat-catchup');
      expect([...PEAK_EXPORT_EXCLUDED_FLOWS]).toEqual([
        LEGACY_OPENING_FLOW,
        LEGACY_PRIOR_RECEIPT_FLOW,
      ]);
    });

    it('keeps the VAT catch-up entry — that VAT was never filed and must reach PEAK', () => {
      expect(isExcludedFromPeakExport({ metadata: { flow: LEGACY_VAT_CATCHUP_FLOW } })).toBe(false);
      expect(isExcludedFromPeakExport({ metadata: { tag: LEGACY_VAT_CATCHUP_FLOW } })).toBe(false);
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

  describe('isExcludedFromPeakExport with the original entry (mirrors / reversals)', () => {
    it.each([LEGACY_OPENING_FLOW, LEGACY_PRIOR_RECEIPT_FLOW])(
      'excludes a reversal whose original has flow %s',
      (flow) => {
        expect(isExcludedFromPeakExport({ metadata: null }, { metadata: { flow } })).toBe(true);
        expect(
          isExcludedFromPeakExport(
            { metadata: { tag: 'REVERSAL', flow: 'exchange-cancel' } },
            { metadata: { flow } },
          ),
        ).toBe(true);
      },
    );

    it('keeps a reversal of a non-legacy original', () => {
      expect(
        isExcludedFromPeakExport({ metadata: null }, { metadata: { tag: '2A', flow: 'x' } }),
      ).toBe(false);
    });

    it('still excludes on the own flow of the entry when the original is absent or odd', () => {
      const own = { metadata: { flow: LEGACY_OPENING_FLOW } };
      expect(isExcludedFromPeakExport(own, null)).toBe(true);
      expect(isExcludedFromPeakExport(own, undefined)).toBe(true);
      expect(isExcludedFromPeakExport({ metadata: {} }, { metadata: 'legacy-opening' })).toBe(
        false,
      );
    });
  });

  describe('peakExportOriginalEntryId', () => {
    it('reads metadata.originalEntryId (template mirrors)', () => {
      expect(
        peakExportOriginalEntryId({
          metadata: { tag: 'REVERSAL', originalEntryId: 'je-1' },
          referenceType: null,
          referenceId: null,
        }),
      ).toBe('je-1');
    });

    it('falls back to referenceId of a JournalService.void reversal (no metadata)', () => {
      expect(
        peakExportOriginalEntryId({
          metadata: null,
          referenceType: 'REVERSAL',
          referenceId: 'je-2',
        }),
      ).toBe('je-2');
    });

    it('prefers metadata.originalEntryId over the reference', () => {
      expect(
        peakExportOriginalEntryId({
          metadata: { originalEntryId: 'je-1' },
          referenceType: 'REVERSAL',
          referenceId: 'je-2',
        }),
      ).toBe('je-1');
    });

    it.each([
      [
        'a non-REVERSAL reference',
        { metadata: null, referenceType: 'PAYMENT', referenceId: 'p-1' },
      ],
      ['an empty originalEntryId', { metadata: { originalEntryId: '' }, referenceType: null }],
      ['a non-string originalEntryId', { metadata: { originalEntryId: 7 }, referenceType: null }],
      [
        'an empty REVERSAL referenceId',
        { metadata: null, referenceType: 'REVERSAL', referenceId: '' },
      ],
      ['no reference fields at all', { metadata: { tag: '2A' } }],
      ['array metadata', { metadata: [{ originalEntryId: 'je-1' }] }],
    ])('returns null for %s', (_label, entry) => {
      expect(peakExportOriginalEntryId(entry)).toBeNull();
    });
  });

  describe('peakExportContractId', () => {
    it('uses the own contractId of the entry when it has one', () => {
      expect(
        peakExportContractId(
          { metadata: { contractId: 'own' } },
          { metadata: { contractId: 'orig' } },
        ),
      ).toBe('own');
    });

    it('inherits the contractId of the original when the entry has none', () => {
      expect(peakExportContractId({ metadata: null }, { metadata: { contractId: 'orig' } })).toBe(
        'orig',
      );
      expect(
        peakExportContractId(
          { metadata: { contractId: '' } },
          { metadata: { contractId: 'orig' } },
        ),
      ).toBe('orig');
    });

    it('returns null when neither carries a string contractId', () => {
      expect(peakExportContractId({ metadata: { contractId: 9 } }, null)).toBeNull();
      expect(peakExportContractId({ metadata: 'x' }, { metadata: ['ct'] })).toBeNull();
      expect(peakExportContractId({ metadata: {} })).toBeNull();
    });
  });

  describe('isLegacyInterestAccount', () => {
    it.each(['11-2106', '41-1101'])('%s is a legacy interest account', (code) => {
      expect(isLegacyInterestAccount(code)).toBe(true);
    });

    it.each(['11-2101', '41-1102', '', '11-2106 '])('%s is not', (code) => {
      expect(isLegacyInterestAccount(code)).toBe(false);
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
