import { describe, it, expect } from 'vitest';
import { accountDisplayName } from '../accountName';

describe('accountDisplayName', () => {
  it('strips the "(...)" parenthetical', () => {
    expect(accountDisplayName('ภาษีซื้อ (เครดิตได้)')).toBe('ภาษีซื้อ');
    expect(accountDisplayName('ลูกหนี้ผ่อนชำระ (HP Receivable Gross)')).toBe('ลูกหนี้ผ่อนชำระ');
  });

  it('leaves a plain name untouched', () => {
    expect(accountDisplayName('ภาษีซื้อรอเรียกเก็บ')).toBe('ภาษีซื้อรอเรียกเก็บ');
    expect(accountDisplayName('เงินสด — สุทธินีย์ คงเดช')).toBe('เงินสด — สุทธินีย์ คงเดช');
  });

  it('drops a leading NN-NNNN / SNN-NNNN code if embedded in the name', () => {
    expect(accountDisplayName('11-4101 ภาษีซื้อ (เครดิตได้)')).toBe('ภาษีซื้อ');
    expect(accountDisplayName('S41-1101 รายได้ขายมือถือใหม่')).toBe('รายได้ขายมือถือใหม่');
  });

  it('handles null / undefined / empty', () => {
    expect(accountDisplayName(null)).toBe('');
    expect(accountDisplayName(undefined)).toBe('');
    expect(accountDisplayName('')).toBe('');
  });
});
