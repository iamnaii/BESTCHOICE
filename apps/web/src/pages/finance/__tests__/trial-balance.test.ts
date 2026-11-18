import { describe, it, expect } from 'vitest';
import { fmtAmount, ledgerHref, unbalancedLabels, visibleSections, type PeriodTbSection } from '../trial-balance';

const amounts = (o: Partial<Record<'openingDr' | 'openingCr' | 'periodDr' | 'periodCr' | 'closingDr' | 'closingCr', string>>) => ({
  openingDr: '0', openingCr: '0', periodDr: '0', periodCr: '0', closingDr: '0', closingCr: '0', ...o,
});
const row = (code: string, o: Parameters<typeof amounts>[0] = {}) => ({
  code, name: `บัญชี ${code}`, type: 'ทดสอบ', normalBalance: 'Dr', ...amounts(o),
});

describe('trial-balance helpers', () => {
  it('fmtAmount: ศูนย์เว้นว่างในช่องบัญชี · แสดง 0.00 ในแถวรวม', () => {
    expect(fmtAmount('157480')).toBe('157,480.00');
    expect(fmtAmount('0')).toBe('');
    expect(fmtAmount('0.00')).toBe('');
    expect(fmtAmount('0', false)).toBe('0.00');
    expect(fmtAmount(undefined, false)).toBe('0.00');
  });

  it('visibleSections: ซ่อนบัญชีที่ไม่มียอดทั้ง 6 ช่อง และซ่อนหมวดที่ไม่เหลือบัญชี', () => {
    const sections: PeriodTbSection[] = [
      { sectionName: 'สินทรัพย์หมุนเวียน', codePrefix: '11', totals: amounts({}), rows: [row('11-1201', { closingDr: '10' }), row('11-1202')] },
      { sectionName: 'ทุน', codePrefix: '31', totals: amounts({}), rows: [row('31-1101')] },
    ];
    const hidden = visibleSections(sections, true);
    expect(hidden.map((s) => s.codePrefix)).toEqual(['11']);
    expect(hidden[0].rows.map((r) => r.code)).toEqual(['11-1201']);
    expect(visibleSections(sections, false)).toBe(sections);
  });

  it('ledgerHref: พาบัญชีและช่วงวันที่ไปหน้าบัญชีแยกประเภท', () => {
    expect(ledgerHref('11-1201', '2026-11-01', '2026-11-17')).toBe(
      '/finance/general-ledger?account=11-1201&start=2026-11-01&end=2026-11-17&from=trial-balance',
    );
  });

  it('unbalancedLabels: บอกคู่ที่ไม่สมดุลเป็นคำ', () => {
    expect(unbalancedLabels({ opening: true, period: true, closing: true })).toEqual([]);
    expect(unbalancedLabels({ opening: true, period: false, closing: false })).toEqual(['ระหว่างงวด', 'ยอดคงเหลือ']);
  });
});
