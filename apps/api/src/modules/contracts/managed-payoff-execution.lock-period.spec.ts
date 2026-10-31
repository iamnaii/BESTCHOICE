import { lockPayoffPeriod } from './managed-payoff-execution';

/**
 * review M2 (2026-10-31): the period row locked FOR SHARE must be the period `validatePeriodOpen` checks — the
 * Bangkok-calendar month (`accountingPeriodOf`), not the process-TZ month. In a UTC process the old
 * `getFullYear()/getMonth()` locked October for 00:30 on 1 November Bangkok time while the guard checked November.
 */
describe('lockPayoffPeriod', () => {
  it('locks the Bangkok-calendar period row (17:30Z on 31 Oct = November)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    await lockPayoffPeriod(
      { $queryRaw: queryRaw } as never,
      new Date('2026-10-31T17:30:00Z'),
      'co-finance',
    );

    const [periodLock] = queryRaw.mock.calls;
    expect((periodLock[0] as TemplateStringsArray).join('?')).toContain('FROM accounting_periods');
    expect(periodLock.slice(1)).toEqual(['co-finance', 2026, 11]);
  });
});
