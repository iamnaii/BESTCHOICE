import { calculateAge, contractSignatureRequirements } from './validation.util';

describe('contract signer requirements', () => {
  const four = ['CUSTOMER', 'STAFF', 'WITNESS_1', 'WITNESS_2'].map(signerType => ({ signerType }));
  afterEach(() => jest.useRealTimers());
  it.each([17, 19, 20])('resolves age %i consistently for the API and signing workflow', age => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-11T01:00:00Z'));
    const result = contractSignatureRequirements({ customer: { birthDate: `${2026 - age}-09-11` }, signatures: four });
    expect(result.checklist).toHaveLength(age < 20 ? 5 : 4);
    expect(result.complete).toBe(age === 20);
  });
  it('switches age at Bangkok midnight regardless of server timezone', () => {
    const birth = new Date('2006-09-11T00:00:00Z');
    expect(calculateAge(birth, new Date('2026-09-10T16:59:59Z'))).toBe(19);
    expect(calculateAge(birth, new Date('2026-09-10T17:00:00Z'))).toBe(20);
  });
  it('deduplicates the legacy seller alias and excludes deleted signatures', () => {
    const result = contractSignatureRequirements({ signatures: [...four, { signerType: 'COMPANY' },
      { signerType: 'GUARDIAN', deletedAt: new Date() }], customer: { birthDate: '2010-09-11' } });
    expect(result.checklist.filter(row => row.type === 'COMPANY')).toHaveLength(1);
    const missingWitness = contractSignatureRequirements({ signatures: four.map(row => row.signerType === 'WITNESS_2'
      ? { ...row, deletedAt: new Date() } : row) });
    expect(missingWitness.complete).toBe(false);
  });
});
