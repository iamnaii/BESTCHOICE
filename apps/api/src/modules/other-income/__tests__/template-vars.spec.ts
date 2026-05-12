import { replaceVariables } from '../services/template-vars.util';

describe('replaceVariables', () => {
  it('replaces {เดือน} with Thai short month abbreviation', () => {
    const may = new Date('2026-05-12T00:00:00Z');  // 2026-05-12 07:00 BKK
    expect(replaceVariables('ดอกเบี้ยเดือน {เดือน}', may)).toBe('ดอกเบี้ยเดือน พ.ค.');
  });

  it('replaces {ปี} with Buddhist Era year', () => {
    const d = new Date('2026-05-12T00:00:00Z');
    expect(replaceVariables('ปี {ปี}', d)).toBe('ปี 2569');
  });

  it('replaces {เดือนปี} with combined form', () => {
    const d = new Date('2026-05-12T00:00:00Z');
    expect(replaceVariables('ค่างวด {เดือนปี}', d)).toBe('ค่างวด พ.ค. 2569');
  });

  it('handles UTC late-night that flips to next day in BKK', () => {
    // 2026-05-12 18:30 UTC = 2026-05-13 01:30 BKK (next day, still พ.ค.)
    const lateUtc = new Date('2026-05-12T18:30:00Z');
    expect(replaceVariables('{เดือนปี}', lateUtc)).toBe('พ.ค. 2569');
  });

  it('handles year boundary: 2026-12-31 18:30 UTC = 2027-01-01 01:30 BKK', () => {
    const yearFlip = new Date('2026-12-31T18:30:00Z');
    expect(replaceVariables('{เดือนปี}', yearFlip)).toBe('ม.ค. 2570');
  });

  it('replaces multiple occurrences', () => {
    const d = new Date('2026-05-12T00:00:00Z');
    expect(replaceVariables('{เดือน}/{ปี} — {เดือน}', d)).toBe('พ.ค./2569 — พ.ค.');
  });

  it('leaves text without tokens unchanged', () => {
    expect(replaceVariables('no tokens here', new Date())).toBe('no tokens here');
  });
});
