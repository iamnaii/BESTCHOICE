import { describe, it, expect } from 'vitest';
import { tradeInEvidenceError } from './trade-in-evidence';
const seller = { sellerName: 'Synthetic Seller', sellerPhone: '0000000000', sellerAddress: 'Synthetic Address', sellerIdCardNumber: '0000000000001' };
describe('physical trade-in evidence', () => {
  it('accepts a device with both identifiers or a documented absent identifier', () => {
    expect(tradeInEvidenceError({ ...seller, imei: '000000000000001', serialNumber: 'SN-1' })).toBeNull();
    expect(tradeInEvidenceError({ ...seller, serialNumber: 'SN-1', imeiMissingReason: 'Wi-Fi only' })).toBeNull();
    expect(tradeInEvidenceError({ ...seller, imei: '000000000000001', serialNumberMissingReason: 'Serial label damaged' })).toBeNull();
  });
  it('requires a real identifier even when both absence reasons are supplied', () => {
    expect(tradeInEvidenceError({ ...seller, imeiMissingReason: 'Missing', serialNumberMissingReason: 'Missing' })).toContain('อย่างน้อยหนึ่ง');
  });
  it.each(['sellerName', 'sellerPhone', 'sellerAddress', 'sellerIdCardNumber'] as const)('requires %s at acceptance', (field) => {
    expect(tradeInEvidenceError({ ...seller, [field]: '', imei: '000000000000001', serialNumber: 'SN-1' })).not.toBeNull();
  });
  it('rejects an incorrect ID checksum and missing absence reason', () => {
    expect(tradeInEvidenceError({ ...seller, sellerIdCardNumber: '0000000000002', serialNumber: 'SN-1' })).toContain('บัตรประชาชน');
    expect(tradeInEvidenceError({ ...seller, serialNumber: 'SN-1' })).toContain('เหตุผล');
  });
});
