import {
  APPLEHOUSE_NOTE_PREFIX,
  AUTO_WITHDRAWN_PREFIX,
  checkImportGuard,
  ExistingValuation,
  planAppleHouseImport,
} from '../../../prisma/applehouse-import-plan';

const NOTE = `${APPLEHOUSE_NOTE_PREFIX}2026-11-20 · เครื่องไทย`;
const OLD_NOTE = `${APPLEHOUSE_NOTE_PREFIX}2026-09-21 · เครื่องไทย`;

const row = (over: Partial<ExistingValuation>): ExistingValuation => ({
  id: 'r1', model: 'iPhone 15', storage: '128GB', basePrice: 14000, note: OLD_NOTE, deletedAt: null, ...over,
});

describe('planAppleHouseImport', () => {
  it('updates an AppleHouse row and creates a model the shop never priced', () => {
    const plan = planAppleHouseImport([row({})], [
      { model: 'iPhone 15', storage: '128GB', basePrice: 13500 },
      { model: 'iPhone 17e', storage: '256GB', basePrice: 15000 },
    ], NOTE);
    expect(plan).toEqual([
      { kind: 'update', id: 'r1', model: 'iPhone 15', storage: '128GB', from: 14000, basePrice: 13500, note: NOTE },
      { kind: 'create', model: 'iPhone 17e', storage: '256GB', basePrice: 15000, note: NOTE },
    ]);
  });

  it('matches model and storage case-insensitively', () => {
    const plan = planAppleHouseImport([row({ model: 'IPHONE 15', storage: '128gb' })],
      [{ model: 'iPhone 15', storage: '128GB', basePrice: 13500 }], NOTE);
    expect(plan[0].kind).toBe('update');
  });

  it('keeps a price the shop edited, even when the source moved', () => {
    const plan = planAppleHouseImport(
      [row({ basePrice: '15000.00', note: `ร้านปรับราคาแล้ว · ข้อมูลอ้างอิงเดิม: ${OLD_NOTE}` })],
      [{ model: 'iPhone 15', storage: '128GB', basePrice: 13500 }], NOTE);
    expect(plan).toEqual([{ kind: 'keep-shop-price', id: 'r1', model: 'iPhone 15', storage: '128GB', shopPrice: 15000, sourcePrice: 13500 }]);
  });

  it('keeps a price staff entered by hand before the source listed the model', () => {
    const plan = planAppleHouseImport(
      [row({ basePrice: 16000, note: null }), row({ id: 'r2', model: 'iPhone 16', note: 'ตั้งเองหน้าร้าน' })],
      [{ model: 'iPhone 15', storage: '128GB', basePrice: 13500 }, { model: 'iPhone 16', storage: '128GB', basePrice: 17000 }], NOTE);
    expect(plan.map(a => a.kind)).toEqual(['keep-shop-price', 'keep-shop-price']);
  });

  it('updates rows from the Yellobe and 2026-07-18 market imports', () => {
    const plan = planAppleHouseImport(
      [row({ note: 'yellobe 2026-09-08' }), row({ id: 'r2', model: 'iPhone 16', note: 'อ้างอิงราคาตลาด 2026-07-18' })],
      [{ model: 'iPhone 15', storage: '128GB', basePrice: 13500 }, { model: 'iPhone 16', storage: '128GB', basePrice: 17000 }], NOTE);
    expect(plan.map(a => a.kind)).toEqual(['update', 'update']);
  });

  it('withdraws an AppleHouse row the source no longer prices, with a marker', () => {
    const plan = planAppleHouseImport([row({})], [{ model: 'iPhone 16', storage: '128GB', basePrice: 17000 }], NOTE);
    expect(plan).toContainEqual({ kind: 'withdraw', id: 'r1', model: 'iPhone 15', storage: '128GB', note: `${AUTO_WITHDRAWN_PREFIX}${OLD_NOTE}` });
  });

  it('never withdraws a shop-edited or hand-made row', () => {
    const plan = planAppleHouseImport([
      row({ id: 'shop', note: `ร้านปรับราคาแล้ว · ข้อมูลอ้างอิงเดิม: ${OLD_NOTE}` }),
      row({ id: 'manual', model: 'iPhone 12', note: null }),
    ], [{ model: 'iPhone 16', storage: '128GB', basePrice: 17000 }], NOTE);
    expect(plan.filter(a => a.kind === 'withdraw')).toEqual([]);
  });

  it('restores a row the importer withdrew once the source prices it again', () => {
    const deletedAt = new Date('2026-12-01');
    const plan = planAppleHouseImport(
      [row({ note: `${AUTO_WITHDRAWN_PREFIX}${OLD_NOTE}`, deletedAt })],
      [{ model: 'iPhone 15', storage: '128GB', basePrice: 13000 }], NOTE);
    expect(plan).toEqual([{ kind: 'restore', id: 'r1', model: 'iPhone 15', storage: '128GB', basePrice: 13000, note: NOTE }]);
  });

  it('restores rows withdrawn by the 2026-09-21 Yellobe switch (no marker back then)', () => {
    const deletedAt = new Date('2026-09-20T23:43:47Z');
    const plan = planAppleHouseImport([
      row({ id: 'y', model: 'iPhone 17 Pro Max', storage: '1TB', note: 'yellobe 2026-09-08', deletedAt }),
      row({ id: 'm', model: 'iPhone 12', storage: '64GB', note: 'อ้างอิงราคาตลาด 2026-07-18', deletedAt }),
    ], [
      { model: 'iPhone 17 Pro Max', storage: '1TB', basePrice: 41000 },
      { model: 'iPhone 12', storage: '64GB', basePrice: 5000 },
    ], NOTE);
    expect(plan.map(a => a.kind)).toEqual(['restore', 'restore']);
  });

  it('leaves a row deleted by staff deleted', () => {
    const plan = planAppleHouseImport([row({ deletedAt: new Date() })],
      [{ model: 'iPhone 15', storage: '128GB', basePrice: 13500 }], NOTE);
    expect(plan).toEqual([{ kind: 'skip-deleted', id: 'r1', model: 'iPhone 15', storage: '128GB' }]);
  });

  it('refuses duplicate rows that normalise to the same model', () => {
    expect(() => planAppleHouseImport([row({ id: 'a' }), row({ id: 'b', model: 'iphone 15' })], [], NOTE))
      .toThrow(/Duplicate normalized/);
  });
});

describe('checkImportGuard', () => {
  const models = Array.from({ length: 10 }, (_, i) => row({ id: `m${i}`, model: `iPhone 1${i}`, basePrice: 10000 }));
  const snapshotFor = (rows: ExistingValuation[], price: (i: number) => number) =>
    rows.map((r, i) => ({ model: r.model, storage: r.storage, basePrice: price(i) }));

  it('passes a normal round (moves under 15%, nothing withdrawn)', () => {
    const plan = planAppleHouseImport(models, snapshotFor(models, i => 10000 - i * 100), NOTE);
    expect(checkImportGuard(plan, models)).toEqual([]);
  });

  it('blocks a price that moves 15% or more, either way', () => {
    const plan = planAppleHouseImport(models, snapshotFor(models, i => (i === 0 ? 8500 : i === 1 ? 11500 : 10000)), NOTE);
    expect(checkImportGuard(plan, models)).toEqual([
      'iPhone 10 128GB ราคาขยับ -15% (10000 → 8500)',
      'iPhone 11 128GB ราคาขยับ 15% (10000 → 11500)',
    ]);
  });

  it('blocks when 20% or more of the source-managed models disappear', () => {
    const plan = planAppleHouseImport(models, snapshotFor(models.slice(0, 8), () => 10000), NOTE);
    expect(checkImportGuard(plan, models)).toEqual(['รุ่นที่ AppleHouse ไม่มีราคาแล้ว 2 จาก 10 รุ่น']);
  });

  it('lets one missing model through', () => {
    const plan = planAppleHouseImport(models, snapshotFor(models.slice(0, 9), () => 10000), NOTE);
    expect(checkImportGuard(plan, models)).toEqual([]);
  });

  it('ignores shop-kept prices and new models', () => {
    const shop = row({ id: 's', model: 'iPhone 9', basePrice: 20000, note: 'ร้านปรับราคาแล้ว · x' });
    const plan = planAppleHouseImport([shop], [
      { model: 'iPhone 9', storage: '128GB', basePrice: 5000 },
      { model: 'iPhone 18', storage: '256GB', basePrice: 40000 },
    ], NOTE);
    expect(checkImportGuard(plan, [shop])).toEqual([]);
  });
});
