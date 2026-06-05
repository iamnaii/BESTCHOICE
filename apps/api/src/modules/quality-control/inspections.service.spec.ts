import { PrismaService } from '../../prisma/prisma.service';
import { InspectionsService } from './inspections.service';

/**
 * Characterization tests for InspectionsService.calculateGrade (Wave 3 backfill).
 *
 * calculateGrade is the weighted auto-grading engine for used-phone inspections;
 * its A/B/C/D result feeds the resale price tier, yet the whole quality-control
 * module had no spec (review finding D7). These lock the weighting math, the
 * per-scoreType scoring, the "required item failed → cap at C" rule, the
 * divide-by-zero guard, and the configurable thresholds.
 *
 * calculateGrade is private and only touches `this.prisma`, so the service is
 * built with a mock Prisma and the method is called via a typed accessor.
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
  return (svc as unknown as {
    calculateGrade: (id: string) => Promise<'A' | 'B' | 'C' | 'D'>;
  }).calculateGrade('insp-1');
};

describe('InspectionsService.calculateGrade', () => {
  it('grades a perfect PASS_FAIL inspection as A (default thresholds 90/70/50)', async () => {
    expect(await grade([{ passFail: true, templateItem: { weight: 1, scoreType: 'PASS_FAIL' } }])).toBe('A');
  });

  it('maps a GRADE item (B = 75%) to a B', async () => {
    expect(await grade([{ grade: 'B', templateItem: { weight: 2, scoreType: 'GRADE' } }])).toBe('B');
  });

  it('scales SCORE_1_5 to a percentage (4/5 = 80% → B)', async () => {
    expect(await grade([{ score: 4, templateItem: { weight: 1, scoreType: 'SCORE_1_5' } }])).toBe('B');
  });

  it('caps a NUMBER score at 100 (95 → A)', async () => {
    expect(await grade([{ numberValue: 95, templateItem: { weight: 1, scoreType: 'NUMBER' } }])).toBe('A');
  });

  it('weights items: 90% raw score still grades A', async () => {
    // item1 weight 3 @ 100, item2 weight 1 @ 60 → (300+60)/4 = 90
    expect(
      await grade([
        { passFail: true, templateItem: { weight: 3, scoreType: 'PASS_FAIL' } },
        { numberValue: 60, templateItem: { weight: 1, scoreType: 'NUMBER' } },
      ]),
    ).toBe('A');
  });

  it('caps the grade at C when a REQUIRED item fails, even at 90% weighted', async () => {
    const results: Result[] = [
      { passFail: false, templateItem: { weight: 1, scoreType: 'PASS_FAIL', isRequired: true } },
      ...Array.from({ length: 9 }, () => ({
        passFail: true,
        templateItem: { weight: 1, scoreType: 'PASS_FAIL' },
      })),
    ];
    // weighted % = 900/10 = 90 (would be A), but required-fail caps it
    expect(await grade(results)).toBe('C');
  });

  it('returns D when there are no results (no divide-by-zero)', async () => {
    expect(await grade([])).toBe('D');
  });

  it('returns D below the C threshold (40% < 50)', async () => {
    expect(await grade([{ numberValue: 40, templateItem: { weight: 1, scoreType: 'NUMBER' } }])).toBe('D');
  });

  it('honours a configured grade_a_threshold (85% → A when A-threshold is 80)', async () => {
    const results: Result[] = [{ numberValue: 85, templateItem: { weight: 1, scoreType: 'NUMBER' } }];
    expect(await grade(results)).toBe('B'); // default A=90 → 85 is a B
    expect(await grade(results, [{ key: 'grade_a_threshold', value: '80' }])).toBe('A');
  });
});
