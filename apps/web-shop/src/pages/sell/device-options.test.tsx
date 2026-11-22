import { describe, expect, it } from 'vitest';
import { groupModels, resolveDevice, modelLabel, storageLabel } from './device-options';
const models = ['iPhone 17 Pro', 'iPhone 16', 'iPhone Air', 'iPhone SE 3', 'iPhone Future'].map(
  (model) => ({ model, storages: [{ storage: '256GB', maxPrice: '27500' }] }),
);
describe('device options', () => {
  it('keeps every API model in a series including Air, SE and unknown models', () => {
    const groups = groupModels(models);
    expect(groups.map((g) => g.id)).toEqual(['16', '17', 'air', 'se', 'other']);
    expect(groups.flatMap((g) => g.models)).toHaveLength(models.length);
    expect(groups.flatMap((g) => g.models)).toEqual(expect.arrayContaining(models));
  });
  it('orders numbered series from old to new regardless of catalog order', () => {
    const catalog = [
      'iPhone Air',
      'iPhone 17 Pro',
      'iPhone 13',
      'iPhone 9',
      'iPhone 16',
      'iPhone 15',
      'iPhone 14',
      'iPhone 17',
    ].map((model) => ({ model, storages: [] }));
    const groups = groupModels(catalog);
    expect(groups.map((g) => g.id)).toEqual(['9', '13', '14', '15', '16', '17', 'air']);
    expect(groups.find((g) => g.id === '17')?.models.map((m) => m.model)).toEqual([
      'iPhone 17 Pro',
      'iPhone 17',
    ]);
  });
  it.each([
    ['iPhone 17 Pro', '256GB', { model: 'iPhone 17 Pro', storage: '256GB', step: 'questions' }],
    ['iPhone 17 Pro', '2TB', { model: 'iPhone 17 Pro', storage: '', step: 'storage' }],
    ['unknown', '256GB', { model: '', storage: '', step: 'device' }],
    [null, null, { model: '', storage: '', step: 'device' }],
  ])('validates shared device %s / %s', (model, storage, want) =>
    expect(resolveDevice(models, model, storage)).toEqual(want),
  );
  it('displays English model names and short capacity units without changing source values', () => {
    expect(modelLabel('iPhone 17 Pro Max')).toBe('iPhone 17 Pro Max');
    expect(modelLabel('iPhone Air')).toBe('iPhone Air');
    expect(storageLabel('256GB')).toBe('256 GB');
    expect(storageLabel('1TB')).toBe('1 TB');
    expect(storageLabel('512 gb')).toBe('512 GB');
    expect(storageLabel('2tb')).toBe('2 TB');
    expect(models[0].model).toBe('iPhone 17 Pro');
  });
});
