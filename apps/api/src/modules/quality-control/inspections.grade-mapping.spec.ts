import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InspectionsService } from './inspections.service';

/**
 * Characterization tests for InspectionsService auto-grading internals
 * (Wave 3 MED gap-fill).
 *
 * The two existing specs (inspections.service.spec.ts +
 * inspections.calculate-grade.spec.ts) pin the weighting math, the threshold
 * boundaries, and the required-fail cap. They do NOT exercise:
 *
 *  - the GRADE scoreType lookup table (240-244): the `result.grade || 'D'`
 *    null-coalesce and the `gradeScores[...] || 0` unknown-key fall-through;
 *  - the NUMBER clamp + null-coalesce and the SCORE_1_5 perfect score
 *    (245-249);
 *  - the *configurable* thresholds (217-224): a config that lowers a band so
 *    the grade flips vs. defaults, a config that raises a band, and the
 *    empty-string `parseInt('' || '90')` fallback to the default;
 *  - the `completeInspection` orchestration (168-193): it auto-grades, persists
 *    `overallGrade`, and rejects an already-completed inspection.
 *
 * calculateGrade is private and only reads `this.prisma`
 * (inspectionResult.findMany + systemConfig.findMany); it is reached via a
 * typed accessor. completeInspection is public and walks findUnique → update →
 * per-product update → findUnique, so the Prisma mock is shaped to answer those
 * calls in order. This mirrors the credit-check characterization specs.
 */

type Result = {
  passFail?: boolean | null;
  grade?: string | null;
  score?: number | null;
  numberValue?: number | null;
  templateItem: { weight: number; scoreType: string; isRequired?: boolean };
};

type Config = { key: string; value: string };

const makePrisma = (results: Result[], configs: Config[] = []) =>
  ({
    inspectionResult: { findMany: jest.fn().mockResolvedValue(results) },
    systemConfig: { findMany: jest.fn().mockResolvedValue(configs) },
  }) as unknown as PrismaService;

const grade = (results: Result[], configs?: Config[]) => {
  const svc = new InspectionsService(makePrisma(results, configs));
  return (
    svc as unknown as {
      calculateGrade: (id: string) => Promise<'A' | 'B' | 'C' | 'D'>;
    }
  ).calculateGrade('insp-1');
};

// Single-item helpers at weight 1 so the weighted % equals that one item's
// score, isolating the per-scoreType branch under test.
const gradeItem = (grade: string | null): Result => ({
  grade,
  templateItem: { weight: 1, scoreType: 'GRADE' },
});
const numItem = (numberValue: number | null): Result => ({
  numberValue,
  templateItem: { weight: 1, scoreType: 'NUMBER' },
});
const scoreItem = (score: number | null): Result => ({
  score,
  templateItem: { weight: 1, scoreType: 'SCORE_1_5' },
});

describe('InspectionsService.calculateGrade — GRADE scoreType lookup (240-244)', () => {
  it("maps grade='A' to 100% → 'A'", async () => {
    expect(await grade([gradeItem('A')])).toBe('A');
  });

  it("null-coalesces a missing grade to 'D' (gradeScores[null || 'D'] = 25 → 'D')", async () => {
    // result.grade is null → `result.grade || 'D'` selects gradeScores['D'] = 25.
    // 25 < thresholds.C (50) → 'D'.
    expect(await grade([gradeItem(null)])).toBe('D');
  });

  it("scores an unknown grade letter as 0 (gradeScores['X'] = undefined || 0 → 'D')", async () => {
    // 'X' is truthy so `'X' || 'D'` stays 'X'; gradeScores['X'] is undefined and
    // `undefined || 0` collapses to 0. 0 < 50 → 'D'. An unknown grade is NOT
    // treated as a missing grade (would be 'D'/25) — it scores a hard zero.
    expect(await grade([gradeItem('X')])).toBe('D');
  });
});

describe('InspectionsService.calculateGrade — NUMBER / SCORE_1_5 scoring (245-249)', () => {
  it('clamps a NUMBER above 100 down to 100 (numberValue=150 → A)', async () => {
    // Math.min(150, 100) = 100 → 'A'. Out-of-range inputs do not over-credit.
    expect(await grade([numItem(150)])).toBe('A');
  });

  it('scales a perfect SCORE_1_5 (5/5) to 100% → A', async () => {
    expect(await grade([scoreItem(5)])).toBe('A');
  });

  it('null-coalesces a missing NUMBER to 0 → D', async () => {
    // Number(null) = 0, `0 || 0` = 0, Math.min(0, 100) = 0. 0 < 50 → 'D'.
    expect(await grade([numItem(null)])).toBe('D');
  });
});

describe('InspectionsService.calculateGrade — configurable thresholds (217-224)', () => {
  it("lowering grade_b_threshold to 60 flips 65% from default 'C' to 'B'", async () => {
    const results = [numItem(65)];
    // default B=70 → 65 lands in the C band (65 >= 50)
    expect(await grade(results)).toBe('C');
    // configured B=60 → 65 >= 60 → 'B'
    expect(await grade(results, [{ key: 'grade_b_threshold', value: '60' }])).toBe('B');
  });

  it("raising grade_c_threshold to 60 flips 55% from default 'C' to 'D'", async () => {
    const results = [numItem(55)];
    // default C=50 → 55 >= 50 → 'C'
    expect(await grade(results)).toBe('C');
    // configured C=60 → 55 < 60 (and below B/A too) → 'D'
    expect(await grade(results, [{ key: 'grade_c_threshold', value: '60' }])).toBe('D');
  });

  it("treats an empty-string config value as the default (parseInt('' || '90') = 90)", async () => {
    // The config row EXISTS but its value is ''. `'' || '90'` → '90', so
    // thresholds.A falls back to the default 90; 90% still grades 'A'.
    const results = [numItem(90)];
    expect(await grade(results, [{ key: 'grade_a_threshold', value: '' }])).toBe('A');
  });
});

// === completeInspection orchestration (168-193) ===

/**
 * Builds a Prisma mock for completeInspection. `findOneInspection` runs
 * `inspection.findUnique` twice: once at the top (state + products) and once at
 * the end (the freshly-persisted record). The mock returns `before` first and
 * `after` second so the returned record reflects the auto-graded value.
 */
const makeCompletePrisma = (opts: {
  before: { isCompleted: boolean; products: { id: string }[] };
  after: Record<string, unknown>;
  results: Result[];
  configs?: Config[];
}) => {
  const findUnique = jest
    .fn()
    .mockResolvedValueOnce(opts.before)
    .mockResolvedValueOnce(opts.after);
  const inspectionUpdate = jest.fn().mockResolvedValue({});
  const productUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    inspection: { findUnique, update: inspectionUpdate },
    product: { update: productUpdate },
    inspectionResult: { findMany: jest.fn().mockResolvedValue(opts.results) },
    systemConfig: { findMany: jest.fn().mockResolvedValue(opts.configs ?? []) },
  } as unknown as PrismaService;
  return { prisma, findUnique, inspectionUpdate, productUpdate };
};

describe('InspectionsService.completeInspection (168-193)', () => {
  it("auto-grades a 95%-scoring inspection and persists overallGrade='A'", async () => {
    const { prisma, inspectionUpdate, productUpdate } = makeCompletePrisma({
      before: { isCompleted: false, products: [{ id: 'prod-1' }] },
      after: { id: 'insp-1', isCompleted: true, overallGrade: 'A' },
      // one NUMBER item @ 95 weight 1 → 95% → 'A'
      results: [numItem(95)],
    });
    const svc = new InspectionsService(prisma);

    const out = (await svc.completeInspection('insp-1')) as { overallGrade: string };

    // the persisted update carries the computed grade + completion flags
    expect(inspectionUpdate).toHaveBeenCalledWith({
      where: { id: 'insp-1' },
      data: expect.objectContaining({ isCompleted: true, overallGrade: 'A' }),
    });
    // inspectedAt is stamped with a real Date
    expect(inspectionUpdate.mock.calls[0][0].data.inspectedAt).toBeInstanceOf(Date);
    // each linked product is pushed to QC_PENDING
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { status: 'QC_PENDING' },
    });
    // the returned record is the re-fetched (graded) inspection
    expect(out.overallGrade).toBe('A');
  });

  it('throws BadRequestException when the inspection is already completed', async () => {
    const { prisma, inspectionUpdate } = makeCompletePrisma({
      before: { isCompleted: true, products: [] },
      after: {},
      results: [],
    });
    const svc = new InspectionsService(prisma);

    await expect(svc.completeInspection('insp-1')).rejects.toBeInstanceOf(BadRequestException);
    // no grading / persistence happens on the already-completed guard
    expect(inspectionUpdate).not.toHaveBeenCalled();
  });
});
