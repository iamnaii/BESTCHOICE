import { computeCostUsd, ratesFor } from './ai-pricing';

describe('ai-pricing', () => {
  it('returns haiku rate for haiku model', () => {
    const r = ratesFor('claude-haiku-4-5-20251001');
    expect(r.inputPer1M).toBe(0.8);
    expect(r.outputPer1M).toBe(4);
  });

  it('returns opus rate for opus model', () => {
    const r = ratesFor('claude-opus-4-7');
    expect(r.inputPer1M).toBe(15);
    expect(r.outputPer1M).toBe(75);
  });

  it('falls back to default rate for unknown model id', () => {
    const r = ratesFor('claude-future-model');
    expect(r.inputPer1M).toBe(3);
    expect(r.outputPer1M).toBe(15);
  });

  it('computes cost for haiku 10k in + 2k out', () => {
    // 10k × 0.8/M = 0.008 ; 2k × 4/M = 0.008 → 0.016
    const cost = computeCostUsd('claude-haiku-4-5-20251001', 10_000, 2_000);
    expect(cost).toBeCloseTo(0.016, 6);
  });

  it('computes cost for sonnet 50k in + 10k out', () => {
    // 50k × 3/M = 0.15 ; 10k × 15/M = 0.15 → 0.3
    const cost = computeCostUsd('claude-sonnet-4-5-20250514', 50_000, 10_000);
    expect(cost).toBeCloseTo(0.3, 6);
  });

  it('rounds to 6 decimals', () => {
    const cost = computeCostUsd('claude-haiku-4-5-20251001', 1, 1);
    // 1 × 0.8/1M = 0.0000008; 1 × 4/1M = 0.000004; total 0.0000048 → rounded to 0.000005
    expect(cost).toBe(0.000005);
  });
});
