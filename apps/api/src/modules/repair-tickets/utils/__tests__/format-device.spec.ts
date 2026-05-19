import { formatDevice } from '../format-device';

describe('formatDevice', () => {
  it('uses product info when available (brand model storage)', () => {
    expect(
      formatDevice({
        product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB' },
      }),
    ).toBe('Apple iPhone 15 128GB');
  });

  it('uses contract.product info when product not directly linked', () => {
    expect(
      formatDevice({
        contract: { product: { brand: 'Samsung', model: 'S24', storage: null } },
      }),
    ).toBe('Samsung S24');
  });

  it('falls back to free-text fields for walk-in', () => {
    expect(
      formatDevice({
        deviceBrand: 'Xiaomi',
        deviceModel: 'Mi 13',
        deviceImei: '352xxx',
      }),
    ).toBe('Xiaomi Mi 13 (IMEI: 352xxx)');
  });

  it('uses SN when IMEI absent', () => {
    expect(
      formatDevice({
        deviceBrand: 'Apple',
        deviceModel: 'MBP',
        deviceSerial: 'C02xxx',
      }),
    ).toBe('Apple MBP (SN: C02xxx)');
  });

  it('returns "ไม่ระบุเครื่อง" when nothing supplied', () => {
    expect(formatDevice({})).toBe('ไม่ระบุเครื่อง');
  });
});
