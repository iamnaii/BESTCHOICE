import { buildPreviewBlocks } from './payment-preview-blocks.util';

/**
 * Pure unit test (jest — no DB). Verifies the block-tagging + per-block subtotal
 * math used by the RecordPaymentWizard 2A/2B preview. The DB-dependent 2A-fetch
 * is covered separately by payment-journal-preview.block.integration.spec.ts (vitest).
 */
describe('buildPreviewBlocks', () => {
  it('consolidated (no accrual): tags every line 2B/unposted and balances the 2B subtotal', () => {
    const res = buildPreviewBlocks({
      liveLines: [
        { accountCode: '11-1201', accountName: 'KBank', debit: '1456.66', credit: '0.00', description: 'รับเงิน' },
        { accountCode: '11-2103', accountName: 'ลูกหนี้ค้างชำระ', debit: '0.00', credit: '1456.66', description: 'ล้าง' },
      ],
    });
    expect(res.lines.every((l) => l.block === '2B' && l.posted === false)).toBe(true);
    expect(res.accrual2A).toBeUndefined();
    expect(res.subtotals['2A']).toBeUndefined();
    expect(res.subtotals['2B']).toEqual({ debit: '1456.66', credit: '1456.66', balanced: true });
  });

  it('2B_ONLY: returns posted 2A context (=2,115.00) + live 2B, each block balanced', () => {
    const res = buildPreviewBlocks({
      accrualLines: [
        { accountCode: '11-2103', accountName: 'ลูกหนี้ค้างชำระ', debit: '1515.83', credit: '0.00', description: 'Accrual' },
        { accountCode: '21-2102', accountName: 'ล้างภาษีขายรอเรียกเก็บ', debit: '99.17', credit: '0.00', description: '' },
        { accountCode: '11-2106', accountName: 'รายได้รอตัดบัญชี', debit: '500.00', credit: '0.00', description: '' },
        { accountCode: '11-2101', accountName: 'ลูกหนี้ Gross', debit: '0.00', credit: '1416.66', description: '' },
        { accountCode: '11-2105', accountName: 'ลูกหนี้ภาษีขายรอ', debit: '0.00', credit: '99.17', description: '' },
        { accountCode: '41-1101', accountName: 'รายได้ดอกเบี้ย', debit: '0.00', credit: '500.00', description: '' },
        { accountCode: '21-2101', accountName: 'ภาษีขาย ภพ.30', debit: '0.00', credit: '99.17', description: '' },
      ],
      liveLines: [
        { accountCode: '11-1201', accountName: 'KBank', debit: '1515.83', credit: '0.00', description: 'รับเงิน' },
        { accountCode: '11-2103', accountName: 'ลูกหนี้ค้างชำระ', debit: '0.00', credit: '1515.83', description: 'ล้าง' },
      ],
    });
    // 2A context present, posted, balanced at 2,115.00
    expect(res.accrual2A).toBeDefined();
    expect(res.accrual2A!.lines.every((l) => l.block === '2A' && l.posted === true)).toBe(true);
    expect(res.accrual2A!.subtotal).toEqual({ debit: '2115.00', credit: '2115.00', balanced: true });
    expect(res.subtotals['2A']).toEqual({ debit: '2115.00', credit: '2115.00', balanced: true });
    // live 2B kept in `lines`, tagged unposted, balanced
    expect(res.lines.every((l) => l.block === '2B' && l.posted === false)).toBe(true);
    expect(res.subtotals['2B']).toEqual({ debit: '1515.83', credit: '1515.83', balanced: true });
  });

  it('flags an unbalanced block as balanced:false', () => {
    const res = buildPreviewBlocks({
      liveLines: [
        { accountCode: '11-1201', accountName: 'KBank', debit: '100.00', credit: '0.00', description: '' },
        { accountCode: '11-2103', accountName: 'x', debit: '0.00', credit: '90.00', description: '' },
      ],
    });
    expect(res.subtotals['2B'].balanced).toBe(false);
  });

  it('empty accrualLines array is treated as consolidated (no 2A block)', () => {
    const res = buildPreviewBlocks({
      accrualLines: [],
      liveLines: [
        { accountCode: '11-1101', accountName: 'cash', debit: '50.00', credit: '0.00', description: '' },
        { accountCode: '11-2103', accountName: 'x', debit: '0.00', credit: '50.00', description: '' },
      ],
    });
    expect(res.accrual2A).toBeUndefined();
    expect(res.subtotals['2A']).toBeUndefined();
  });
});
