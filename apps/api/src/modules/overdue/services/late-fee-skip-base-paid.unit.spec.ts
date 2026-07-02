/**
 * PR #1314 gap-fill — LOCALLY-RUNNABLE guard for the base-settled skip clause.
 *
 * The behavioural proof (real Postgres) lives in the sibling
 * `late-fee-skip-base-paid.integration.spec.ts`, but that file is *.integration.spec.ts
 * and therefore EXCLUDED from the jest run (CI DB-only). Nothing in the local suite
 * caught an accidental removal / operator flip (`<` → `<=`) / column typo in the raw
 * SQL — raw SQL is not type-checked by tsc either.
 *
 * This spec closes that gap cheaply: it constructs OverdueLifecycleCronService with a
 * mocked Prisma, runs calculateLateFees(), and asserts the compiled bulk-UPDATE SQL
 * still contains `"amount_paid" < "amount_due"` — in BOTH fee-formula modes, so the
 * guard survives a BRACKET/PER_DAY branch refactor. Mock-only, no DB.
 *
 * Sibling pattern: overdue.late-fee-escalation.spec.ts (makeBracketPrisma/makePerDayPrisma).
 */
import { OverdueLifecycleCronService } from './overdue-lifecycle-cron.service';
import type { ConsecutiveMissedService } from '../consecutive-missed.service';

// calculateLateFees calls `this.prisma.$executeRaw(Prisma.sql`…`)`, so mock.calls[0][0]
// is a Prisma.Sql. The new skip clause is a pure literal (no interpolation), so it lands
// verbatim in Sql.strings regardless of which fee fragment (BRACKET / PER_DAY) is spliced in.
type SqlLike = { strings?: readonly string[]; sql?: string };
const sqlTextOf = (arg: unknown): string => {
  const s = arg as SqlLike;
  if (Array.isArray(s?.strings)) return s.strings.join(' ');
  if (typeof s?.sql === 'string') return s.sql;
  return String(arg);
};

/** Minimal Prisma stub: only systemConfig.findUnique (mode dispatch) + $executeRaw. */
const makePrisma = (mode: 'BRACKET' | 'PER_DAY', rowsUpdated = 4) => {
  const $executeRaw = jest.fn().mockResolvedValue(rowsUpdated);
  const prisma = {
    systemConfig: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(where.key === 'late_fee_mode' ? { value: mode } : null),
      ),
    },
    $executeRaw,
  };
  return { prisma, $executeRaw };
};

const buildCron = (prisma: unknown) =>
  new OverdueLifecycleCronService(
    prisma as never,
    {} as unknown as ConsecutiveMissedService,
  );

describe('OverdueLifecycleCronService.calculateLateFees — base-settled skip guard (SQL text)', () => {
  afterEach(() => jest.clearAllMocks());

  it('BRACKET mode: bulk UPDATE skips base-settled rows via "amount_paid" < "amount_due"', async () => {
    const { prisma, $executeRaw } = makePrisma('BRACKET');

    const out = await buildCron(prisma).calculateLateFees();

    expect($executeRaw).toHaveBeenCalledTimes(1);
    expect(out.updated).toBe(4);
    const text = sqlTextOf($executeRaw.mock.calls[0][0]);
    expect(text).toContain('"amount_paid" < "amount_due"');
  });

  it('PER_DAY mode: the same guard survives the alternate fee-formula branch', async () => {
    const { prisma, $executeRaw } = makePrisma('PER_DAY');

    await buildCron(prisma).calculateLateFees();

    expect($executeRaw).toHaveBeenCalledTimes(1);
    const text = sqlTextOf($executeRaw.mock.calls[0][0]);
    expect(text).toContain('"amount_paid" < "amount_due"');
  });

  it('the skip clause sits beside the existing filters without displacing them', async () => {
    const { prisma, $executeRaw } = makePrisma('BRACKET');

    await buildCron(prisma).calculateLateFees();

    const text = sqlTextOf($executeRaw.mock.calls[0][0]);
    expect(text).toMatch(/UPDATE\s+"payments"/);
    expect(text).toContain('"late_fee_waived" = false');
    expect(text).toContain('"amount_paid" < "amount_due"');
  });
});
