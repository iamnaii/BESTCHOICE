import { parseReferencePricingCatalog } from './reference-pricing';

const catalog = () => ({ version: 1, source: 'https://www.yellobe.com/buy/detail', capturedAt: '2026-09-08T14:00:00Z',
  profiles: { p: { pricingMode: 'MAX_PERCENT_EXACT', eligibilityRequired: true, eligibilityText: 'เครื่องไม่มีบัญชีล็อก',
    questions: [{ id: 'q', key: 'body', title: 'ตัวเครื่อง', selectType: 'SINGLE',
      choices: [{ id: 'c', label: 'มีรอย', deductType: 'PERCENT', deductValue: '15' }] }] } },
  assignments: [{ model: 'iPhone 12', storage: '128GB', profileId: 'p' }] });

describe('reference pricing runtime validation', () => {
  it('accepts the versioned catalog and rejects malformed JSON', () => {
    expect(parseReferencePricingCatalog(JSON.stringify(catalog()))).toEqual(catalog());
    expect(() => parseReferencePricingCatalog('{broken')).toThrow();
  });

  it.each(['-1', 'NaN', 'Infinity', '101', '15x'])('rejects invalid percentage %s before any profile is used', (value) => {
    const data = catalog(); data.profiles.p.questions[0].choices[0].deductValue = value;
    expect(() => parseReferencePricingCatalog(JSON.stringify(data))).toThrow();
  });

  it('rejects duplicate normalized capacity assignments, missing profiles and empty questions', () => {
    const duplicate = catalog(); duplicate.assignments.push({ model: 'iphone  12', storage: '128 GB', profileId: 'p' });
    expect(() => parseReferencePricingCatalog(JSON.stringify(duplicate))).toThrow();
    const missing = catalog(); missing.assignments[0].profileId = 'missing';
    expect(() => parseReferencePricingCatalog(JSON.stringify(missing))).toThrow();
    const empty = catalog(); empty.profiles.p.questions = [];
    expect(() => parseReferencePricingCatalog(JSON.stringify(empty))).toThrow();
  });
});
