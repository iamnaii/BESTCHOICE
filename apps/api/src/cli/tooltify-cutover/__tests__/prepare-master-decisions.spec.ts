import { prepareMasterDecisions } from '../prepare-master-decisions';
import type { CanonicalStockUnit, SourceDecisions } from '../types';

const rows = [3, 4, 5].map((row) => ({
  source: { fileSha256: 'sha', row, storeKey: 'TOOLTIFY_3012', sheet: 'Worksheet' },
  category: 'PHONE_USED',
  kind: 'DEVICE',
  deviceOrigin: row === 4 ? 'IMPORTED' : null,
})) as CanonicalStockUnit[];
const input: SourceDecisions = {
  entries: [
    {
      action: 'RESOLVE_STOCK',
      fileSha256: 'sha',
      sourceRows: [3, 4, 5],
      deviceOrigin: null,
      desiredStatus: 'IN_STOCK',
      pricing: {
        mode: 'EXPLICIT',
        cashPrice: '13900.00',
        installmentPrice: '1',
        financePrice: '2',
      },
      reason: 'reviewed intake',
      evidenceRef: '/evidence/intake.json',
      supplier: { mode: 'NO_SUPPLIER' },
    },
  ],
};
const policy = {
  storeKey: 'TOOLTIFY_3012',
  defaultOrigin: 'THAI' as const,
  evidenceRef: '/evidence/owner-confirmed-thai.json',
  evidenceSha256: 'a'.repeat(64),
};
it('replaces stale copied bases while preserving cash, known origins and supplier decisions', () => {
  const out = prepareMasterDecisions(rows, input, policy);
  const resolutions = out.entries.filter((d) => d.action === 'RESOLVE_STOCK');
  expect(resolutions.map((d) => d.deviceOrigin)).toEqual(['THAI', 'IMPORTED', 'THAI']);
  expect(
    resolutions.every(
      (d) => d.pricing.mode === 'MASTER_INSTALLMENTS' && d.pricing.cashPrice === '13900.00',
    ),
  ).toBe(true);
  expect(resolutions.every((d) => d.supplier?.mode === 'NO_SUPPLIER')).toBe(true);
  expect(prepareMasterDecisions(rows, out, policy)).toEqual(out);
  expect(input.entries).toHaveLength(1);
});
it('does not apply a store-specific origin confirmation to another store', () => {
  expect(() =>
    prepareMasterDecisions(
      [{ ...rows[0], source: { ...rows[0].source, storeKey: 'OTHER' } }],
      input,
      policy,
    ),
  ).toThrow('ORIGIN_POLICY_STORE_MISMATCH');
});
it('preserves QC and accessories, and rejects conflicting source origins', () => {
  const qc = structuredClone(input);
  Object.assign(qc.entries[0], { desiredStatus: 'QC_PENDING' });
  expect(prepareMasterDecisions(rows, qc, policy)).toEqual(qc);
  expect(
    prepareMasterDecisions(
      rows.map((r) => ({ ...r, kind: 'ACCESSORY', category: 'ACCESSORY' })),
      input,
      policy,
    ),
  ).toEqual(input);
  const conflict = structuredClone(input);
  Object.assign(conflict.entries[0], { deviceOrigin: 'THAI' });
  expect(() => prepareMasterDecisions(rows, conflict, policy)).toThrow('SOURCE_ORIGIN_CONFLICT');
});
