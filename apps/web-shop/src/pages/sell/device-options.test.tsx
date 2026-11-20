import { describe, expect, it } from 'vitest';
import { groupModels, resolveDevice, modelLabel, storageLabel } from './device-options';
const models = ['iPhone 17 Pro', 'iPhone 16', 'iPhone Air', 'iPhone SE 3', 'iPhone Future'].map(model => ({ model, storages: [{storage:'256GB', maxPrice:'27500'}] }));
describe('device options', () => {
  it('keeps every API model in a series including Air, SE and unknown models', () => {
    const groups = groupModels(models);
    expect(groups.map(g => g.id)).toEqual(['17','16','air','se','other']);
    expect(groups.flatMap(g => g.models)).toEqual(models);
  });
  it.each([
    ['iPhone 17 Pro','256GB',{model:'iPhone 17 Pro',storage:'256GB',step:'questions'}],
    ['iPhone 17 Pro','2TB',{model:'iPhone 17 Pro',storage:'',step:'storage'}],
    ['unknown','256GB',{model:'',storage:'',step:'device'}],
    [null,null,{model:'',storage:'',step:'device'}],
  ])('validates shared device %s / %s', (model,storage,want) => expect(resolveDevice(models,model,storage)).toEqual(want));
  it('displays Thai labels without changing source values', () => {
    expect(modelLabel('iPhone 17 Pro Max')).toBe('ไอโฟน 17 โปรแม็กซ์');
    expect(modelLabel('iPhone Air')).toBe('ไอโฟน แอร์');
    expect(storageLabel('256GB')).toBe('256 กิกะไบต์');
    expect(storageLabel('1TB')).toBe('1 เทระไบต์');
    expect(models[0].model).toBe('iPhone 17 Pro');
  });
});
