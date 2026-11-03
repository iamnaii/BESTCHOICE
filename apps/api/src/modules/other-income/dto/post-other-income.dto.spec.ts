import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PostOtherIncomeDto } from './post-other-income.dto';

/**
 * Override JV amounts must have at most 2 decimals (review m2 of Task 28, 2026-11-01): `journal_lines.debit/credit`
 * are numeric(12,2), so 50.005 + 50.005 = 100.01 passes the exact-balance check (V1) on the raw values but Postgres
 * stores 50.01 + 50.01 = 100.02 against 100.01 — a POSTED entry that does not balance. The global ValidationPipe
 * (whitelist + transform, nested via @ValidateNested/@Type) rejects these before the service runs.
 */
async function errorsOf(overrideLines: Array<Record<string, unknown>>) {
  const dto = plainToInstance(PostOtherIncomeDto, { override: true, overrideLines });
  const errors = await validate(dto, { whitelist: true });
  return errors.flatMap((e) =>
    (e.children ?? []).flatMap((line) =>
      (line.children ?? []).flatMap((f) => Object.values(f.constraints ?? {})),
    ),
  );
}

describe('PostOtherIncomeDto — override line amounts', () => {
  it('rejects Dr 50.005 + 50.005 / Cr 100.01 (balanced raw, unbalanced once stored)', async () => {
    const messages = await errorsOf([
      { accountCode: '11-1101', debit: 50.005, credit: 0 },
      { accountCode: '11-1102', debit: 50.005, credit: 0 },
      { accountCode: '42-1102', debit: 0, credit: 100.01 },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.includes('ทศนิยมไม่เกิน 2 ตำแหน่ง'))).toBe(true);
  });

  it('rejects Dr 1.005 + 1.00 / Cr 1.0025 + 1.0025 (client per-line rounding misses it)', async () => {
    const messages = await errorsOf([
      { accountCode: '11-1101', debit: 1.005, credit: 0 },
      { accountCode: '11-1102', debit: 1.0, credit: 0 },
      { accountCode: '42-1102', debit: 0, credit: 1.0025 },
      { accountCode: '42-1103', debit: 0, credit: 1.0025 },
    ]);
    expect(messages).toHaveLength(3);
  });

  it('accepts amounts with up to 2 decimals', async () => {
    const messages = await errorsOf([
      { accountCode: '11-1101', debit: 100.01, credit: 0 },
      { accountCode: '42-1102', debit: 0, credit: 100.01 },
      { accountCode: '42-1103', debit: 0, credit: 0 },
    ]);
    expect(messages).toEqual([]);
  });
});
