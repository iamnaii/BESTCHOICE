import { createHash } from 'node:crypto';
import { canonicalizeSales } from '../canonicalize';
import type { CanonicalSaleLine, SourceDecision, SourceDecisions } from '../types';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const evidence = {
  fileSha256: hashA,
  reason: 'synthetic decision',
  evidenceRef: 'fixture bill quantity',
};
function selection(rows: number[], fileSha256 = hashA): SourceDecision {
  return {
    ...evidence,
    fileSha256,
    action: 'SELECT_SALES',
    branchId: 'branch-A',
    storeKey: 'store-A',
    reportFrom: '2026-09-01',
    reportTo: '2026-09-30',
    sourceRows: rows,
  };
}
function line(row: number, overrides: Partial<CanonicalSaleLine> = {}): CanonicalSaleLine {
  const base = {
    source: { fileSha256: hashA, sheet: 'Worksheet', row, storeKey: 'store-A' },
    sourceStoreKey: 'store-A',
    orderNumber: 'A-1',
    barcode: '012345678901234',
    soldAt: new Date('2026-08-31T17:00:01Z'),
    productName: 'Synthetic phone',
    category: 'iPhone มือ 2',
    buyerLabel: '',
    shopLabel: null,
    paymentType: 'CASH',
    priceGroup: 'ราคาปลีก',
    saleChannel: 'CASH',
    costTotal: '50.00',
    listPrice: '100.00',
    salePrice: '100.00',
    profit: '50.00',
    salespersonName: '',
    occurrence: 1,
    ...overrides,
  };
  const sourceKey = createHash('sha256')
    .update(
      JSON.stringify([
        base.sourceStoreKey,
        base.orderNumber,
        base.barcode,
        base.soldAt.toISOString(),
        base.occurrence,
      ]),
    )
    .digest('hex');
  return { ...base, sourceKey };
}

describe('canonicalizeSales', () => {
  const decisions: SourceDecisions = { entries: [selection([3, 4])] };
  const accessories = [3, 4].map((row) =>
    line(row, { barcode: 'TEST-GIFT', category: 'Accessories' }),
  );

  it('keeps_two_bills_for_one_device', () => {
    const twoBillLines = [
      line(3),
      line(4, { orderNumber: 'A-2', soldAt: new Date('2026-09-03T00:00:00Z') }),
    ];
    const result = canonicalizeSales(twoBillLines, decisions);
    expect(result.rows.map((r) => r.orderNumber)).toEqual(['A-1', 'A-2']);
    expect(new Set(result.rows.map((r) => r.sourceKey)).size).toBe(2);
    expect(result.issues).toEqual([]);
  });

  it('counts byte-identical reports under two names once by physical row', () => {
    const result = canonicalizeSales([line(3), line(3)], { entries: [selection([3])] });
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.excluded).toHaveLength(1);
  });

  it('changes in overlapping exports conflict even when one report is excluded', () => {
    const first = line(3);
    const second = line(7, {
      source: { ...first.source, fileSha256: hashB, row: 7 },
      salePrice: '90.00',
    });
    expect(first.sourceKey).toBe(second.sourceKey);
    const result = canonicalizeSales([first, second], {
      entries: [
        selection([3]),
        { ...evidence, fileSha256: hashB, action: 'EXCLUDE_FILE', sourceRows: [7] },
      ],
    });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_CONFLICT' }));
    expect(result.rows).toEqual([]);
  });

  it('requires nonoverlapping selected report coverage even when bills differ', () => {
    const first = line(3);
    const second = line(7, {
      source: { ...first.source, fileSha256: hashB, row: 7 },
      orderNumber: 'B-2',
    });
    const result = canonicalizeSales([first, second], {
      entries: [selection([3]), selection([7], hashB)],
    });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'SALES_OVERLAP' }));
  });

  it('holds conflicting amounts at one event key pending unit evidence', () => {
    const result = canonicalizeSales([line(3), line(4, { salePrice: '90.00' })], decisions);
    expect(result.rows).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'SOURCE_CONFLICT',
      'SOURCE_CONFLICT',
    ]);
  });

  it('holds both identical accessories pending bill evidence', () => {
    const result = canonicalizeSales(accessories, decisions);
    expect(result.rows).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
    expect(result.issues.map((issue) => issue.source?.row).sort()).toEqual([3, 4]);
  });

  it('assigns verified units stable occurrences in physical order independent of input order', () => {
    const result = canonicalizeSales([...accessories].reverse(), {
      entries: [
        ...decisions.entries,
        { ...evidence, sourceRows: [4, 3], action: 'DISTINCT_UNITS' },
      ],
    });
    expect(result.issues).toEqual([]);
    expect(result.rows.map((row) => [row.source.row, row.occurrence])).toEqual([
      [3, 1],
      [4, 2],
    ]);
    expect(result.rows[1].sourceKey).toBe(
      line(4, { barcode: 'TEST-GIFT', occurrence: 2 }).sourceKey,
    );
  });

  it('retains the evidenced report row and records excluded source provenance', () => {
    const result = canonicalizeSales(accessories, {
      entries: [
        ...decisions.entries,
        { ...evidence, sourceRows: [3, 4], action: 'REPORT_DUPLICATE', keepRow: 4 },
      ],
    });
    expect(result.issues).toEqual([]);
    expect(result.rows.map((row) => [row.source.row, row.occurrence])).toEqual([[4, 1]]);
    expect(result.excluded).toEqual([expect.objectContaining({ source: accessories[0].source })]);
  });

  it('records the correct occurrence for a repeated input copy of the second distinct unit', () => {
    const result = canonicalizeSales([...accessories, ...accessories], {
      entries: [
        ...decisions.entries,
        { ...evidence, sourceRows: [3, 4], action: 'DISTINCT_UNITS' },
      ],
    });
    expect(result.issues).toEqual([]);
    for (const { source, sourceKey } of result.excluded) {
      expect(sourceKey).toBe(result.rows.find((r) => r.source.row === source.row)?.sourceKey);
    }
  });

  it('retains the same IMEI and bill at different instants, and the same instant with a different bill', () => {
    const result = canonicalizeSales(
      [
        line(3),
        line(4, { soldAt: new Date('2026-09-01T00:00:00Z') }),
        line(5, { orderNumber: 'A-2' }),
      ],
      { entries: [selection([3, 4, 5])] },
    );
    expect(result.issues).toEqual([]);
    expect(new Set(result.rows.map((r) => r.sourceKey)).size).toBe(3);
  });

  it('rejects selection evidence referencing unaccounted physical rows', () => {
    const result = canonicalizeSales([line(3)], { entries: [selection([3, 4])] });
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.rows).toHaveLength(0);
  });
  it('never applies an unrelated or unevidenced duplicate decision', () => {
    for (const invalid of [
      { sourceRows: [3], evidenceRef: 'fixture' },
      { sourceRows: [3, 4], evidenceRef: '' },
    ]) {
      const result = canonicalizeSales(accessories, {
        entries: [
          ...decisions.entries,
          { ...evidence, ...invalid, action: 'REPORT_DUPLICATE', keepRow: 3 },
        ],
      });
      expect(result.rows).toHaveLength(0);
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});
