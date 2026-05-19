import { describe, it, expect } from 'vitest';
import {
  filterActiveWhtRates,
  whtRatesToSelectOptions,
  type WhtRateEntry,
} from './wht-rates';

describe('D1.1.3.5 — filterActiveWhtRates', () => {
  // Reference clock for deterministic tests
  const NOW = new Date('2026-05-17T00:00:00Z');

  it('includes entries with no effectiveDate (always active)', () => {
    const rates: WhtRateEntry[] = [
      { rate: 1, label: '1%' },
      { rate: 3, label: '3%' },
    ];
    expect(filterActiveWhtRates(rates, NOW)).toEqual(rates);
  });

  it('includes entries whose effectiveDate is in the past', () => {
    const rates: WhtRateEntry[] = [
      { rate: 1, label: '1%', effectiveDate: '2025-01-01' },
      { rate: 5, label: '5%', effectiveDate: '2026-01-01' },
    ];
    expect(filterActiveWhtRates(rates, NOW)).toHaveLength(2);
  });

  it('includes entries whose effectiveDate equals now (boundary)', () => {
    const rates: WhtRateEntry[] = [
      { rate: 10, label: '10%', effectiveDate: NOW.toISOString() },
    ];
    expect(filterActiveWhtRates(rates, NOW)).toHaveLength(1);
  });

  it('EXCLUDES entries whose effectiveDate is strictly in the future', () => {
    const rates: WhtRateEntry[] = [
      { rate: 1, label: '1%' }, // always
      { rate: 5, label: '5% future', effectiveDate: '2030-01-01' },
    ];
    const filtered = filterActiveWhtRates(rates, NOW);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rate).toBe(1);
  });

  it('mixes past + future + always-on correctly', () => {
    const rates: WhtRateEntry[] = [
      { rate: 1, label: '1% old', effectiveDate: '2025-01-01' },
      { rate: 3, label: '3% future', effectiveDate: '2030-01-01' },
      { rate: 10, label: '10% always-on' },
      { rate: 15, label: '15% just-now', effectiveDate: NOW.toISOString() },
    ];
    const filtered = filterActiveWhtRates(rates, NOW);
    expect(filtered.map((r) => r.rate)).toEqual([1, 10, 15]);
  });

  it('treats unparseable effectiveDate as "include" (permissive fallback)', () => {
    const rates: WhtRateEntry[] = [
      { rate: 1, label: '1% bad date', effectiveDate: 'totally-not-a-date' },
    ];
    expect(filterActiveWhtRates(rates, NOW)).toHaveLength(1);
  });
});

describe('D1.1.3.5 — whtRatesToSelectOptions', () => {
  const NOW = new Date('2026-05-17T00:00:00Z');

  it('always prepends the 0% option', () => {
    const opts = whtRatesToSelectOptions([], NOW);
    expect(opts).toEqual([{ value: '0', label: '0%' }]);
  });

  it('maps active entries to {value, label} pairs after the 0% option', () => {
    const rates: WhtRateEntry[] = [
      { rate: 1, label: '1% — ดอกเบี้ย' },
      { rate: 3, label: '3% — ค่าบริการ' },
    ];
    const opts = whtRatesToSelectOptions(rates, NOW);
    expect(opts).toEqual([
      { value: '0', label: '0%' },
      { value: '1', label: '1% — ดอกเบี้ย' },
      { value: '3', label: '3% — ค่าบริการ' },
    ]);
  });

  it('drops future-dated entries from the rendered options', () => {
    const rates: WhtRateEntry[] = [
      { rate: 1, label: '1% — old' },
      { rate: 5, label: '5% — future', effectiveDate: '2099-01-01' },
    ];
    const opts = whtRatesToSelectOptions(rates, NOW);
    expect(opts.map((o) => o.value)).toEqual(['0', '1']);
  });
});
