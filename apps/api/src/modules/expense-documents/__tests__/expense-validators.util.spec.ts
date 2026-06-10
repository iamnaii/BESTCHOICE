import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import {
  ADJUSTMENT_ALLOWLIST,
  assertCategoriesAreExpense,
  validateAdjustments,
} from '../expense-validators.util';

/**
 * Characterization spec for validateAdjustments (V12/V13/V14).
 *
 * Pure unit test — no DI, no DB. Mocks the only tx surface the validator
 * touches: tx.chartOfAccount.findMany. Pins the EXACT Thai messages and the
 * signed-sum convention (CR=+, DR=−). Behavior was previously covered only
 * INDIRECTLY via create()/createSettlement() integration tests.
 */
describe('validateAdjustments (expense-validators.util)', () => {
  const D = (v: string | number) => new Prisma.Decimal(v);

  // Builds a mock tx whose chartOfAccount.findMany returns the given codes.
  const makeTx = (foundCodes: string[]) => {
    const findMany = jest
      .fn()
      .mockResolvedValue(foundCodes.map((code) => ({ code })));
    return {
      tx: { chartOfAccount: { findMany } } as unknown as Prisma.TransactionClient,
      findMany,
    };
  };

  it('fast path: no adjustments + diff 0 → resolves and never queries CoA', async () => {
    const { tx, findMany } = makeTx([]);
    await expect(
      validateAdjustments(tx, {
        adjustments: [],
        netExpected: D('100.00'),
        amountPaid: D('100.00'),
      }),
    ).resolves.toBeUndefined();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('V14 (empty accountCode): throws with the pre-existing "V13:" label', async () => {
    const { tx } = makeTx([]);
    await expect(
      validateAdjustments(tx, {
        adjustments: [{ accountCode: '   ', side: 'CR', amount: 10 }],
        netExpected: D('100.00'),
        amountPaid: D('110.00'),
      }),
    ).rejects.toThrow(
      new BadRequestException('V13: บัญชีปรับผลต่างแถวที่ 1 ยังไม่ได้เลือกบัญชี'),
    );
  });

  it('V14 (amount <= 0): throws จำนวนต้องมากกว่า 0', async () => {
    const { tx } = makeTx([]);
    await expect(
      validateAdjustments(tx, {
        adjustments: [{ accountCode: '52-1104', side: 'CR', amount: 0 }],
        netExpected: D('100.00'),
        amountPaid: D('100.00'),
      }),
    ).rejects.toThrow(
      new BadRequestException('V14: บัญชีปรับผลต่างแถวที่ 1: จำนวนต้องมากกว่า 0'),
    );
  });

  it('V13 (code not in CoA): throws ไม่พบในผังบัญชี', async () => {
    const { tx } = makeTx([]); // findMany returns nothing
    await expect(
      validateAdjustments(tx, {
        adjustments: [{ accountCode: '52-1104', side: 'CR', amount: 10 }],
        netExpected: D('100.00'),
        amountPaid: D('110.00'),
      }),
    ).rejects.toThrow(
      new BadRequestException('V13: บัญชีปรับผลต่าง 52-1104 ไม่พบในผังบัญชี'),
    );
  });

  it('V13 (in CoA but not on allow-list): throws ไม่อยู่ในรายการที่อนุญาต', async () => {
    const { tx } = makeTx(['51-1101']); // exists in CoA but NOT allow-listed
    await expect(
      validateAdjustments(tx, {
        adjustments: [{ accountCode: '51-1101', side: 'CR', amount: 10 }],
        netExpected: D('100.00'),
        amountPaid: D('110.00'),
      }),
    ).rejects.toThrow(
      new BadRequestException(
        `V13: บัญชีปรับผลต่าง 51-1101 ไม่อยู่ในรายการที่อนุญาต — ` +
          `อนุญาตเฉพาะ ${[...ADJUSTMENT_ALLOWLIST].join(', ')}`,
      ),
    );
  });

  it('V12 (signed-sum mismatch): throws ผลรวมบัญชีปรับผลต่าง', async () => {
    const { tx } = makeTx(['52-1104']); // passes V13/V14 — fails only V12
    // diff = 110 − 100 = 10, but signed sum = +5 (CR) ≠ 10
    await expect(
      validateAdjustments(tx, {
        adjustments: [{ accountCode: '52-1104', side: 'CR', amount: 5 }],
        netExpected: D('100.00'),
        amountPaid: D('110.00'),
      }),
    ).rejects.toThrow(
      new BadRequestException(
        `V12: ผลรวมบัญชีปรับผลต่าง (signed = 5.00) ` +
          `ไม่เท่ากับผลต่าง amount_paid − net_expected (10.00)`,
      ),
    );
  });

  it('happy path (CR = +amount): overpay diff matched by a CR adjustment → resolves', async () => {
    const { tx } = makeTx(['52-1104']);
    // diff = 110 − 100 = +10; CR 10 → signed +10 === diff
    await expect(
      validateAdjustments(tx, {
        adjustments: [{ accountCode: '52-1104', side: 'CR', amount: 10 }],
        netExpected: D('100.00'),
        amountPaid: D('110.00'),
      }),
    ).resolves.toBeUndefined();
  });

  it('happy path (DR = −amount): underpay diff matched by a DR adjustment → resolves', async () => {
    const { tx } = makeTx(['52-1104']);
    // diff = 90 − 100 = −10; DR 10 → signed −10 === diff
    await expect(
      validateAdjustments(tx, {
        adjustments: [{ accountCode: '52-1104', side: 'DR', amount: 10 }],
        netExpected: D('100.00'),
        amountPaid: D('90.00'),
      }),
    ).resolves.toBeUndefined();
  });

  it('dedup: duplicate accountCode → findMany queried with deduped code set', async () => {
    const { tx, findMany } = makeTx(['52-1104']);
    // two CR rows of the same code, 6 + 4 = +10 === diff (110 − 100)
    await expect(
      validateAdjustments(tx, {
        adjustments: [
          { accountCode: '52-1104', side: 'CR', amount: 6 },
          { accountCode: '52-1104', side: 'CR', amount: 4 },
        ],
        netExpected: D('100.00'),
        amountPaid: D('110.00'),
      }),
    ).resolves.toBeUndefined();
    expect(findMany).toHaveBeenCalledTimes(1);
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.code.in).toEqual(['52-1104']);
    expect(whereArg.deletedAt).toBeNull();
  });
});

/**
 * Characterization spec for assertCategoriesAreExpense.
 *
 * Pure unit test — mocks the only tx surface the guard touches:
 * tx.chartOfAccount.findMany. Pins the EXACT Thai messages, the deduped/insertion-
 * order query, and the first-offender throw order. Behavior was previously
 * copy-pasted (byte-equivalent) across create / createCreditNote /
 * createPettyCash / update and covered only INDIRECTLY via those integration tests.
 */
describe('assertCategoriesAreExpense (expense-validators.util)', () => {
  // Builds a mock tx whose chartOfAccount.findMany returns the given {code,type} rows.
  const makeTx = (rows: { code: string; type: string }[]) => {
    const findMany = jest.fn().mockResolvedValue(rows);
    return {
      tx: { chartOfAccount: { findMany } } as unknown as Prisma.TransactionClient,
      findMany,
    };
  };

  it('all categories valid (type ค่าใช้จ่าย) → resolves; queries deduped code set + deletedAt null + select {code,type}', async () => {
    const { tx, findMany } = makeTx([
      { code: '51-1101', type: 'ค่าใช้จ่าย' },
      { code: '52-1104', type: 'ค่าใช้จ่าย' },
    ]);
    await expect(
      assertCategoriesAreExpense(tx, ['51-1101', '52-1104']),
    ).resolves.toBeUndefined();
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.code.in).toEqual(['51-1101', '52-1104']);
    expect(arg.where.deletedAt).toBeNull();
    expect(arg.select).toEqual({ code: true, type: true });
  });

  it('code missing from CoA → throws ไม่พบในผังบัญชี', async () => {
    const { tx } = makeTx([]); // findMany omits it
    await expect(assertCategoriesAreExpense(tx, ['51-1101'])).rejects.toThrow(
      new BadRequestException('หมวดบัญชี 51-1101 ไม่พบในผังบัญชี'),
    );
  });

  it('code present but wrong type (รายได้) → throws ไม่ใช่ "ค่าใช้จ่าย"', async () => {
    const { tx } = makeTx([{ code: '41-1101', type: 'รายได้' }]);
    await expect(assertCategoriesAreExpense(tx, ['41-1101'])).rejects.toThrow(
      new BadRequestException('หมวดบัญชี 41-1101 ไม่ใช่ "ค่าใช้จ่าย"'),
    );
  });

  it('dedup: duplicate categories → findMany queried once with the deduped set', async () => {
    const { tx, findMany } = makeTx([{ code: '51-1101', type: 'ค่าใช้จ่าย' }]);
    await expect(
      assertCategoriesAreExpense(tx, ['51-1101', '51-1101', '51-1101']),
    ).resolves.toBeUndefined();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.code.in).toEqual(['51-1101']);
  });

  it('first-offender: [valid, missing] → the missing code throws', async () => {
    // findMany returns only the valid one; the second (missing) trips the loop.
    const { tx } = makeTx([{ code: '51-1101', type: 'ค่าใช้จ่าย' }]);
    await expect(
      assertCategoriesAreExpense(tx, ['51-1101', '99-9999']),
    ).rejects.toThrow(new BadRequestException('หมวดบัญชี 99-9999 ไม่พบในผังบัญชี'));
  });

  it('first-offender: wrong-type before missing (by insertion order) → the wrong-type code throws first', async () => {
    // Iteration follows Set insertion order: 41-1101 (wrong type) is reached
    // before 99-9999 (missing), so the ไม่ใช่ message wins.
    const { tx } = makeTx([{ code: '41-1101', type: 'รายได้' }]);
    await expect(
      assertCategoriesAreExpense(tx, ['41-1101', '99-9999']),
    ).rejects.toThrow(new BadRequestException('หมวดบัญชี 41-1101 ไม่ใช่ "ค่าใช้จ่าย"'));
  });

  it('empty array → resolves; findMany still called once with empty in: []', async () => {
    const { tx, findMany } = makeTx([]);
    await expect(assertCategoriesAreExpense(tx, [])).resolves.toBeUndefined();
    // The guard always queries (no fast-path); the for-loop over [] is a no-op.
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.code.in).toEqual([]);
  });
});
