import { describe, expect, it } from 'vitest';
import { isAccessoryCompatible } from './accessory-compatibility';

const phone = { brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW' };
const accessory = (model: string, brand = 'Apple') => ({ brand, model, category: 'ACCESSORY' });
describe('declared accessory compatibility', () => {
  it('matches a declared model, including multi-model films and harmless whitespace/case', () => {
    expect(isAccessoryCompatible(accessory('iPhone 15'), phone)).toBe(true);
    expect(
      isAccessoryCompatible(accessory('iPhone 14, IPHONE   15, iPhone 16', ' APPLE '), phone),
    ).toBe(true);
  });
  it.each([
    'iPhone 15 Pro',
    'iPhone 15 Pro Max',
    'iPhone 15 Plus',
    'iPhone 16',
    'ฟิล์ม iPhone 15',
    '',
    'ทุกรุ่น',
    'Type-C',
    '15',
  ])('does not infer fit from %s', (model) => {
    expect(isAccessoryCompatible(accessory(model), phone)).toBe(false);
  });
  it('requires the same target brand and a phone/tablet rather than another accessory', () => {
    expect(isAccessoryCompatible(accessory('iPhone 15', 'Samsung'), phone)).toBe(false);
    expect(isAccessoryCompatible(accessory('iPhone 15', ''), phone)).toBe(false);
    expect(isAccessoryCompatible(accessory('iPhone 15'), { ...phone, category: 'ACCESSORY' })).toBe(
      false,
    );
    expect(
      isAccessoryCompatible(accessory('iPhone 15'), { ...phone, category: 'PHONE_USED' }),
    ).toBe(true);
  });
});
