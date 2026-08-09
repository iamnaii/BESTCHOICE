import { describe, it, expect } from 'vitest';
import { buildContractCreateUrl } from './contract-create-url';

describe('buildContractCreateUrl', () => {
  it('ไม่ระบุเครื่อง → ส่งแค่ customerId', () => {
    expect(buildContractCreateUrl('c1')).toBe('/contracts/create?customerId=c1');
  });

  it('ระบุเครื่อง → ส่ง customerId + productId (2 param ที่ wizard อ่านจริง)', () => {
    expect(buildContractCreateUrl('c1', 'p9')).toBe(
      '/contracts/create?customerId=c1&productId=p9',
    );
  });

  it('productId ว่าง/null → ไม่ใส่ param เปล่า', () => {
    expect(buildContractCreateUrl('c1', null)).toBe('/contracts/create?customerId=c1');
    expect(buildContractCreateUrl('c1', '')).toBe('/contracts/create?customerId=c1');
  });

  it('encode ค่าที่มีอักขระพิเศษ', () => {
    expect(buildContractCreateUrl('a b', 'p/1')).toBe(
      '/contracts/create?customerId=a+b&productId=p%2F1',
    );
  });
});
