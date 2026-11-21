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
    expect(result.excluded).toEqual([
      {
        source: accessories[0].source,
        sourceKey: result.rows[0].sourceKey,
        reason: 'REPORT_DUPLICATE',
      },
    ]);
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

describe('matching sale occurrences across exports', () => {
  function exportsWithPrices(
    selectedPrices: number[],
    excludedPrices: number[],
    exclusion: 'EXCLUDE_FILE' | 'EXCLUDE_ROW' = 'EXCLUDE_FILE',
  ) {
    const report = (prices: number[], firstRow: number, fileSha256: string) =>
      prices.map((price, index) => {
        const row = firstRow + index;
        return line(row, {
          barcode: 'TEST-GIFT',
          category: 'Accessories',
          salePrice: price.toFixed(2),
          source: { fileSha256, row, sheet: 'Worksheet', storeKey: 'store-A' },
        });
      });
    const selected = report(selectedPrices, 3, hashA);
    const excluded = report(excludedPrices, 7, hashB);
    const selectedRows = selected.map((r) => r.source.row);
    const entries: SourceDecision[] = [
      selection(selectedRows),
      {
        ...evidence,
        action: exclusion,
        fileSha256: hashB,
        sourceRows: excluded.map((r) => r.source.row),
      },
    ];
    if (selected.length > 1)
      entries.push({ ...evidence, action: 'DISTINCT_UNITS', sourceRows: selectedRows });
    return { selected, excluded, decisions: { entries } };
  }

  it.each([
    { a: [100, 100, 90], b: [100, 90, 90] },
    { a: [100], b: [100, 100] },
  ])('holds every physical row when the frequency changes from $a to $b', ({ a, b }) => {
    const { selected, excluded, decisions } = exportsWithPrices(a, b);
    const result = canonicalizeSales([...selected, ...excluded], decisions);
    expect(result.rows).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.issues.filter((i) => i.code === 'SOURCE_CONFLICT').map((i) => i.source)).toEqual(
      [...selected, ...excluded].map((r) => r.source),
    );
  });

  it.each([
    { b: [100, 90], exclusion: 'EXCLUDE_FILE' },
    { b: [90, 100], exclusion: 'EXCLUDE_FILE' },
    { b: [90, 100], exclusion: 'EXCLUDE_ROW' },
  ] as const)('matches excluded units by payload for $b with $exclusion', ({ b, exclusion }) => {
    const { selected, excluded, decisions } = exportsWithPrices([100, 90], [...b], exclusion);
    const result = canonicalizeSales([...selected, ...excluded, ...selected], decisions);
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(2);
    for (const row of excluded) {
      const matched = result.rows.find((r) => r.salePrice === row.salePrice)!;
      expect(result.excluded).toContainEqual({
        source: row.source,
        sourceKey: matched.sourceKey,
        reason: exclusion,
      });
    }
    for (const row of result.rows) {
      expect(result.excluded).toContainEqual({
        source: row.source,
        sourceKey: row.sourceKey,
        reason: 'IDENTICAL_FILE_COPY',
      });
    }
  });

  it('keeps ambiguous exclusions unlinked while linking unique prices within a reordered multiset', () => {
    const { selected, excluded, decisions } = exportsWithPrices([100, 100, 90], [90, 100, 100]);
    const result = canonicalizeSales([...selected, ...excluded], decisions);
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.excluded).toEqual(
      excluded.map((r) => ({
        source: r.source,
        sourceKey: r.salePrice === '90.00' ? result.rows[2].sourceKey : null,
        reason: 'EXCLUDE_FILE',
      })),
    );
  });
});
