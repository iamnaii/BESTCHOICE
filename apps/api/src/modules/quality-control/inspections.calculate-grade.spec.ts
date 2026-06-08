import { PrismaService } from '../../prisma/prisma.service';
import { InspectionsService } from './inspections.service';

/**
 * Characterization tests for InspectionsService.calculateGrade — boundary pinning
 * (Wave 3 gap-fill, audit HIGH gap D7).
 *
 * The existing inspections.service.spec.ts covers A>=90, B>=70, D, and the
 * required-fail cap from a would-be A. This file locks the branches that spec
 * leaves open:
 *
 *  - The C band lower boundary (256-266): pct === thresholds.C (50) → 'C'.
 *  - The `>=` threshold semantics: pct === thresholds.B (70) → 'B' (not C),
 *    pct === thresholds.A (90) → 'A' (not B), pct just below C (49) → 'D'.
 *  - The required-fail cap fall-through (259-261): when a REQUIRED item fails,
 *    the cap only DEMOTES a B-or-better to C — it never PROMOTES a sub-C score
 *    (pct=40 with a required-fail still grades 'D'), and the cap itself fires at
 *    pct === thresholds.B (70) → 'C'.
 *
 * calculateGrade is private and only reads `this.prisma`
 * (inspectionResult.findMany + systemConfig.findMany), so the service is built
 * with a hand-mocked Prisma and the method is reached via a typed accessor,
 * mirroring the credit-check characterization specs.
 */

type Result = {
  passFail?: boolean | null;
  grade?: string | null;
  score?: number | null;
  numberValue?: number | null;
  templateItem: { weight: number; scoreType: string; isRequired?: boolean };
};

const makePrisma = (results: Result[], configs: { key: string; value: string }[] = []) =>
  ({
    inspectionResult: { findMany: jest.fn().mockResolvedValue(results) },
    systemConfig: { findMany: jest.fn().mockResolvedValue(configs) },
  }) as unknown as PrismaService;

const grade = (results: Result[], configs?: { key: string; value: string }[]) => {
  const svc = new InspectionsService(makePrisma(results, configs));
  return (
    svc as unknown as {
      calculateGrade: (id: string) => Promise<'A' | 'B' | 'C' | 'D'>;
    }
  ).calculateGrade('insp-1');
};

// A single NUMBER item at weight 1 makes weighted% === numberValue, so these
// inputs probe the threshold comparisons directly.
const num = (numberValue: number): Result => ({
  numberValue,
  templateItem: { weight: 1, scoreType: 'NUMBER' },
});

describe('InspectionsService.calculateGrade — threshold boundaries', () => {
  it('pins the lower C boundary: 50% === thresholds.C grades C', async () => {
    expect(await grade([num(50)])).toBe('C');
  });

  it('treats pct === thresholds.B (70) as B, not C (>= is inclusive on the upper band)', async () => {
    expect(await grade([num(70)])).toBe('B');
  });

  it('treats pct === thresholds.A (90) as A, not B (>= is inclusive on the upper band)', async () => {
    expect(await grade([num(90)])).toBe('A');
  });

  it('drops to D one point below the C threshold (49% < 50)', async () => {
    expect(await grade([num(49)])).toBe('D');
  });

  it('grades the open interior of the C band (60% → C)', async () => {
    expect(await grade([num(60)])).toBe('C');
  });
});

describe('InspectionsService.calculateGrade — required-fail cap fall-through', () => {
  it('does NOT promote a sub-C score: required-fail at 40% weighted still grades D', async () => {
    // required PASS_FAIL fail (weight 3, score 0) + NUMBER 100 (weight 2)
    // weighted% = (0*3 + 100*2) / 5 = 40. hasRequiredFail = true.
    // cap guard `40 >= thresholds.B (70)` is false → falls through to the
    // normal ladder; 40 < 50 → 'D'. The cap only demotes, never raises.
    const results: Result[] = [
      { passFail: false, templateItem: { weight: 3, scoreType: 'PASS_FAIL', isRequired: true } },
      { numberValue: 100, templateItem: { weight: 2, scoreType: 'NUMBER' } },
    ];
    expect(await grade(results)).toBe('D');
  });

  it('fires the cap exactly at pct === thresholds.B (70): required-fail → C', async () => {
    // required PASS_FAIL fail (weight 3, score 0) + NUMBER 100 (weight 7)
    // weighted% = (0*3 + 100*7) / 10 = 70. hasRequiredFail = true.
    // cap guard `70 >= thresholds.B (70)` is true → 'C' (would have been 'B').
    const results: Result[] = [
      { passFail: false, templateItem: { weight: 3, scoreType: 'PASS_FAIL', isRequired: true } },
      { numberValue: 100, templateItem: { weight: 7, scoreType: 'NUMBER' } },
    ];
    expect(await grade(results)).toBe('C');
  });

  it('a NON-required PASS_FAIL fail does not set the cap (90% weighted → A)', async () => {
    // Same shape as the required-fail "cap from A" case, but the failing item is
    // NOT required, so hasRequiredFail stays false and the score is uncapped.
    // weighted% = (0*1 + 100*9) / 10 = 90 → 'A'.
    const results: Result[] = [
      { passFail: false, templateItem: { weight: 1, scoreType: 'PASS_FAIL', isRequired: false } },
      ...Array.from({ length: 9 }, () => ({
        passFail: true,
        templateItem: { weight: 1, scoreType: 'PASS_FAIL' },
      })),
    ];
    expect(await grade(results)).toBe('A');
  });
});
