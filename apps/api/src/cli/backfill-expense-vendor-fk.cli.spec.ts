import { resolveVendorMatch, SupplierRow } from './backfill-expense-vendor-fk.cli';

describe('resolveVendorMatch — expense vendor FK backfill matching logic', () => {
  const suppliers: SupplierRow[] = [
    { id: 'sup-1', taxId: '0105568000001' },
    { id: 'sup-2', taxId: '0105568000002' },
    { id: 'sup-3', taxId: null }, // supplier with no taxId
  ];

  it('returns eligible when exactly one supplier matches the vendorTaxId', () => {
    const result = resolveVendorMatch(suppliers, '0105568000001');
    expect(result).toEqual({ kind: 'eligible', supplierId: 'sup-1' });
  });

  it('returns no-supplier when no supplier has the given taxId', () => {
    const result = resolveVendorMatch(suppliers, '9999999999999');
    expect(result).toEqual({ kind: 'no-supplier' });
  });

  it('returns ambiguous when two suppliers share the same taxId', () => {
    const duplicates: SupplierRow[] = [
      { id: 'sup-a', taxId: '0105568000099' },
      { id: 'sup-b', taxId: '0105568000099' },
    ];
    const result = resolveVendorMatch(duplicates, '0105568000099');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidateIds).toHaveLength(2);
      expect(result.candidateIds).toContain('sup-a');
      expect(result.candidateIds).toContain('sup-b');
    }
  });

  it('returns no-supplier when vendorTaxId is null', () => {
    const result = resolveVendorMatch(suppliers, null);
    expect(result).toEqual({ kind: 'no-supplier' });
  });

  it('returns no-supplier when vendorTaxId is an empty string', () => {
    const result = resolveVendorMatch(suppliers, '');
    expect(result).toEqual({ kind: 'no-supplier' });
  });

  it('returns no-supplier when vendorTaxId is whitespace-only', () => {
    const result = resolveVendorMatch(suppliers, '   ');
    expect(result).toEqual({ kind: 'no-supplier' });
  });

  it('does NOT match a supplier whose taxId is null, even if vendorTaxId is set', () => {
    // sup-3 has taxId=null; that must never match any real vendorTaxId
    const onlyNullTaxId: SupplierRow[] = [{ id: 'sup-3', taxId: null }];
    const result = resolveVendorMatch(onlyNullTaxId, '0105568000001');
    expect(result).toEqual({ kind: 'no-supplier' });
  });

  it('returns eligible for the second supplier when first has different taxId', () => {
    const result = resolveVendorMatch(suppliers, '0105568000002');
    expect(result).toEqual({ kind: 'eligible', supplierId: 'sup-2' });
  });

  it('returns no-supplier when active supplier list is empty', () => {
    const result = resolveVendorMatch([], '0105568000001');
    expect(result).toEqual({ kind: 'no-supplier' });
  });
});
