import { describe, expect, it } from 'vitest';
import { legacyVerificationPath, safeLoginReturnPath } from './verification-links';

describe('verification link compatibility', () => {
  it('preserves contract hashes and never guesses a document type for an ambiguous RT number', () => {
    expect(legacyVerificationPath('8dd406bc-aab3-4996-96e9-769b069ff24e', '?hash=abc')).toBe(
      '/verify/contracts/8dd406bc-aab3-4996-96e9-769b069ff24e?hash=abc',
    );
    expect(legacyVerificationPath('RT-202610-00001', '?hash=not-a-contract')).toBeNull();
    expect(legacyVerificationPath('PV-202610-00001')).toBe('/expenses/verify-number/PV-202610-00001');
    for (const number of ['EX-2610-001', 'PC-20261014-0001', 'PR-2026-000001', 'CUST-202610-00001']) {
      expect(legacyVerificationPath(number)).toBe(`/expenses/verify-number/${number}`);
    }
    expect(legacyVerificationPath('../customers')).toBeNull();
  });
  it('only restores internal paths after login', () => {
    expect(safeLoginReturnPath('/receipts/verify/RT-202610-00001', '/')).toBe(
      '/receipts/verify/RT-202610-00001',
    );
    for (const value of [
      '//evil.invalid',
      'https://evil.invalid',
      '/\\evil.invalid',
      '/login',
      undefined,
    ]) {
      expect(safeLoginReturnPath(value, '/')).toBe('/');
    }
  });
});
