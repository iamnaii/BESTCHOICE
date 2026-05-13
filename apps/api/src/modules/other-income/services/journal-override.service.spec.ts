import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalOverrideService, OverrideLine } from './journal-override.service';

const D = (n: number | string) => new Decimal(n);

describe('JournalOverrideService', () => {
  const svc = new JournalOverrideService();

  const line = (accountCode: string, debit: number, credit: number): OverrideLine => ({
    accountCode,
    debit: D(debit),
    credit: D(credit),
  });

  describe('validate()', () => {
    it('V1: passes when Dr equals Cr exactly', () => {
      expect(() => svc.validate([line('11-1101', 100, 0), line('42-1102', 0, 100)])).not.toThrow();
    });

    it('V1: passes within 0.01 tolerance', () => {
      expect(() =>
        svc.validate([line('11-1101', 100.005, 0), line('42-1102', 0, 100)]),
      ).not.toThrow();
    });

    it('V1: throws when Dr != Cr beyond 0.01 tolerance', () => {
      expect(() => svc.validate([line('11-1101', 100, 0), line('42-1102', 0, 99)]))
        .toThrow(BadRequestException);
      try {
        svc.validate([line('11-1101', 100, 0), line('42-1102', 0, 99)]);
      } catch (e: any) {
        expect(e.response.errors[0].rule).toBe('V1');
        expect(e.response.errors[0].msg).toContain('ผลต่าง');
      }
    });

    it('V2: throws when fewer than 2 lines', () => {
      expect(() => svc.validate([])).toThrow(BadRequestException);
      try { svc.validate([]); } catch (e: any) {
        expect(e.response.errors[0].rule).toBe('V2');
      }
      expect(() => svc.validate([line('11-1101', 100, 0)])).toThrow(BadRequestException);
    });

    it('V5: throws when a line has both Dr and Cr', () => {
      expect(() =>
        svc.validate([line('11-1101', 50, 50), line('42-1102', 0, 100)]),
      ).toThrow(BadRequestException);
      try {
        svc.validate([line('11-1101', 50, 50), line('42-1102', 0, 100)]);
      } catch (e: any) {
        expect(e.response.errors[0].rule).toBe('V5');
        expect(e.response.errors[0].msg).toContain('11-1101');
        expect(e.response.errors[0].msg).toContain('มีทั้ง Dr และ Cr');
      }
    });

    it('V5: throws when a line has neither Dr nor Cr', () => {
      expect(() =>
        svc.validate([line('11-1101', 100, 0), line('42-1102', 0, 0), line('21-2101', 0, 100)]),
      ).toThrow(BadRequestException);
      try {
        svc.validate([line('11-1101', 100, 0), line('42-1102', 0, 0), line('21-2101', 0, 100)]);
      } catch (e: any) {
        expect(e.response.errors[0].rule).toBe('V5');
        expect(e.response.errors[0].msg).toContain('42-1102');
        expect(e.response.errors[0].msg).toContain('ไม่มีทั้ง Dr และ Cr');
      }
    });

    it('short-circuit priority — V2 fires before V5 when both would apply', () => {
      // 1 line that's also missing dr/cr should report V2 first
      try { svc.validate([line('11-1101', 0, 0)]); } catch (e: any) {
        expect(e.response.errors[0].rule).toBe('V2');
      }
    });
  });

  describe('computeDiffSummary()', () => {
    const auto = [line('11-1101', 1000, 0), line('42-1102', 0, 1000)];

    it('returns empty string when arrays are equal', () => {
      expect(svc.computeDiffSummary(auto, [...auto])).toBe('');
    });

    it('detects modified credit amount', () => {
      const modified = [line('11-1101', 1500, 0), line('42-1102', 0, 1500)];
      const summary = svc.computeDiffSummary(auto, modified);
      expect(summary).toContain('แก้');
      expect(summary).toContain('11-1101');
      expect(summary).toContain('1,000.00');
      expect(summary).toContain('1,500.00');
    });

    it('detects added line', () => {
      const modified = [...auto, line('21-2101', 0, 70)];
      const summary = svc.computeDiffSummary(auto, modified);
      expect(summary).toContain('เพิ่มบรรทัด');
      expect(summary).toContain('21-2101');
    });

    it('detects removed line', () => {
      const modified = [auto[0]];
      const summary = svc.computeDiffSummary(auto, modified);
      expect(summary).toContain('ลบบรรทัด');
      expect(summary).toContain('42-1102');
    });

    it('combines multiple changes with separator', () => {
      const modified = [line('11-1101', 1500, 0), line('21-2101', 0, 1500)];
      const summary = svc.computeDiffSummary(auto, modified);
      expect(summary).toContain('แก้');
      expect(summary).toContain('ลบบรรทัด');
      expect(summary).toContain('เพิ่มบรรทัด');
      expect(summary).toContain(';'); // separator
    });
  });
});
