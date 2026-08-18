import {
  deriveSaleChannel,
  normalizePayment,
  parseThaiDateTime,
} from '../tooltify-sales-parser';

describe('deriveSaleChannel', () => {
  it('maps price groups to sale channels', () => {
    expect(deriveSaleChannel('ราคาปลีก')).toBe('CASH');
    expect(deriveSaleChannel('ราคา 2')).toBe('INSTALLMENT');
    expect(deriveSaleChannel('ราคา 3')).toBe('EXTERNAL_FINANCE');
    expect(deriveSaleChannel('ราคา 4')).toBe('OTHER');
    expect(deriveSaleChannel('  ราคา 2 ')).toBe('INSTALLMENT'); // trims
    expect(deriveSaleChannel('')).toBe('OTHER');
  });
});

describe('normalizePayment', () => {
  it('maps Thai payment labels', () => {
    expect(normalizePayment('ขายแบบเงินสด')).toBe('CASH');
    expect(normalizePayment('ขายแบบโอน')).toBe('BANK_TRANSFER');
    expect(normalizePayment('ขายแบบสแกน QR')).toBe('QR_EWALLET');
    expect(normalizePayment('ขายแบบเครดิต')).toBe('CREDIT_BALANCE');
    expect(normalizePayment('อื่นๆ')).toBe('อื่นๆ'); // passthrough unknown
    expect(normalizePayment('')).toBe('UNKNOWN');
  });
});

describe('parseThaiDateTime', () => {
  it('parses "YYYY-MM-DD HH:mm:ss" as Bangkok time', () => {
    const d = parseThaiDateTime('2026-08-18 13:46:40');
    // 13:46:40 +07:00 === 06:46:40 UTC
    expect(d.toISOString()).toBe('2026-08-18T06:46:40.000Z');
  });
  it('accepts an ISO string too (exceljs Date cell path)', () => {
    const d = parseThaiDateTime('2026-08-18T06:46:40.000Z');
    expect(d.toISOString()).toBe('2026-08-18T06:46:40.000Z');
  });
});
