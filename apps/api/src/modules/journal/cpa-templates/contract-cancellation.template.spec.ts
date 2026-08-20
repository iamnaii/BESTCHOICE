/**
 * contract-cancellation.template.spec.ts
 *
 * Unit tests for ContractCancellationTemplate (Phase 3 C-1 rework) using Jest
 * mocks (no real DB). The DB-backed behavior (GL nets to 0, guards, restore)
 * lives in src/modules/contracts/__tests__/contract-cancellation.integration.spec.ts
 * (vitest).
 *
 * NOTE: cpa-templates specs are excluded from the default jest run via
 * testPathIgnorePatterns (this file is carved back in). Run individually with:
 *   npx jest --testPathPattern=contract-cancellation.template.spec
 */
import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException } from '@nestjs/common';
import { ContractCancellationTemplate } from './contract-cancellation.template';
import { ExchangeCancelReversalTemplate } from './exchange-cancel-reversal.template';
import { EclStageReverseTemplate } from './ecl-stage-reverse.template';

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockContract = { contractNumber: 'BC-2026-001' };

function makeLine(debit: string, credit: string) {
  return { debit: new Decimal(debit), credit: new Decimal(credit) };
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('ContractCancellationTemplate (Phase 3 C-1 — sweep + ECL release)', () => {
  let template: ContractCancellationTemplate;
  let sweepMock: jest.Mocked<Pick<ExchangeCancelReversalTemplate, 'reverse'>>;
  let eclMock: jest.Mocked<Pick<EclStageReverseTemplate, 'execute'>>;
  let prismaMock: any;

  beforeEach(() => {
    sweepMock = {
      reverse: jest.fn().mockResolvedValue({
        reversalJeIds: ['je-rev-1', 'je-rev-2'],
        redirectedTotals: {},
      }),
    };
    eclMock = {
      execute: jest.fn().mockResolvedValue({ entryNo: 'JE-202601-00099' }),
    };
    prismaMock = {
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(mockContract),
      },
      contractCancellation: {
        findUnique: jest.fn().mockResolvedValue({ reversalJournalEntryId: null }),
      },
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue({ id: 'je-activation-1' }), // 1A guard
        findMany: jest.fn().mockResolvedValue([]), // cash tripwire candidates
        findUniqueOrThrow: jest.fn().mockResolvedValue({ entryNumber: 'JE-202601-00010' }),
      },
      journalLine: {
        findMany: jest.fn().mockResolvedValue([]), // glContractBalance(11-2102) = 0
      },
      badDebtProvision: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    template = new ContractCancellationTemplate(
      prismaMock,
      sweepMock as unknown as ExchangeCancelReversalTemplate,
      eclMock as unknown as EclStageReverseTemplate,
    );
  });

  // ─── Test 1: sweep is called with the C-1 caller contract ───────────────

  it('calls the sweep engine with excludeFlows + flowLabel + prefix (no redirects)', async () => {
    const result = await template.execute({
      contractId: 'contract-1',
      cancellationId: 'cancel-1',
    });

    expect(sweepMock.reverse).toHaveBeenCalledTimes(1);
    const [input, tx] = sweepMock.reverse.mock.calls[0];
    expect(input).toEqual({
      jeIds: [],
      newContractId: 'contract-1',
      // Fix Round 1: real-cash flows excluded too — mirror of a cash JE
      // would fabricate cash movement
      excludeFlows: [
        'provision',
        'stage-reverse',
        'shop-collect-settlement',
        'shop-down-payment',
        'reschedule-collect',
      ],
      flowLabel: 'contract-cancellation',
      descriptionPrefix: '[ยกเลิกสัญญา]',
    });
    // C-1 must NOT pass redirects/redirectStamp (Task 1 caller contract #1)
    expect(input).not.toHaveProperty('redirects');
    expect(input).not.toHaveProperty('redirectStamp');
    expect(tx).toBeUndefined();

    expect(result.entryNumber).toBe('JE-202601-00010');
    expect(result.reversalJeIds).toEqual(['je-rev-1', 'je-rev-2']);
  });

  // ─── Test 2: ECL release from live GL + provision rows flipped ──────────

  it('releases live 11-2102 balance in ONE stage-reverse JE + flips provision rows', async () => {
    // glContractBalance('11-2102','cr') = Cr 30.32
    prismaMock.journalLine.findMany.mockResolvedValue([makeLine('0', '30.32')]);

    await template.execute({ contractId: 'contract-1', cancellationId: 'cancel-1' });

    expect(eclMock.execute).toHaveBeenCalledTimes(1);
    const [input] = eclMock.execute.mock.calls[0];
    expect(input.contractId).toBe('contract-1');
    expect(input.reverseAmount.toFixed(2)).toBe('30.32');
    expect(input.fromBucket).toBe('CANCEL');
    expect(input.toBucket).toBe('CANCEL');

    expect(prismaMock.badDebtProvision.updateMany).toHaveBeenCalledWith({
      where: { contractId: 'contract-1', status: 'ACTIVE', deletedAt: null },
      data: { status: 'REVERSED' },
    });
  });

  it('skips the ECL release when 11-2102 balance is 0 (still flips provision rows)', async () => {
    await template.execute({ contractId: 'contract-1', cancellationId: 'cancel-1' });

    expect(eclMock.execute).not.toHaveBeenCalled();
    expect(prismaMock.badDebtProvision.updateMany).toHaveBeenCalled();
  });

  // ─── Test 2b: positive cash tripwire ────────────────────────────────────

  it('rejects loudly (naming entryNumber) when a sweep candidate touches a cash/bank account', async () => {
    prismaMock.journalEntry.findMany.mockResolvedValue([
      {
        id: 'je-jv-1',
        entryNumber: 'JE-202601-00777',
        metadata: { flow: 'test-hand-jv', contractId: 'contract-1' },
        lines: [
          { accountCode: '11-1101', ...makeLine('300', '0') },
          { accountCode: '41-1102', ...makeLine('0', '300') },
        ],
      },
    ]);

    await expect(
      template.execute({ contractId: 'contract-1', cancellationId: 'cancel-1' }),
    ).rejects.toThrow('JE-202601-00777');
    expect(sweepMock.reverse).not.toHaveBeenCalled();
  });

  it('tripwire skips excluded-flow / reversed / REVERSAL-tag candidates with cash lines', async () => {
    prismaMock.journalEntry.findMany.mockResolvedValue([
      {
        id: 'je-down-1',
        entryNumber: 'JE-202601-00701',
        metadata: { flow: 'shop-down-payment', contractId: 'contract-1' },
        lines: [{ accountCode: 'S11-1101', ...makeLine('2000', '0') }],
      },
      {
        id: 'je-collect-1',
        entryNumber: 'JE-202601-00702',
        metadata: { flow: 'shop-collect-settlement', contractId: 'contract-1' },
        lines: [{ accountCode: '11-1101', ...makeLine('500', '0') }],
      },
      {
        id: 'je-reversed-1',
        entryNumber: 'JE-202601-00703',
        metadata: { flow: 'test-x', contractId: 'contract-1', reversed: true },
        lines: [{ accountCode: '11-1201', ...makeLine('100', '0') }],
      },
      {
        id: 'je-rev-tag-1',
        entryNumber: 'JE-202601-00704',
        metadata: { tag: 'REVERSAL', flow: 'receipt-void', contractId: 'contract-1' },
        lines: [{ accountCode: '11-1101', ...makeLine('0', '100') }],
      },
    ]);

    await expect(
      template.execute({ contractId: 'contract-1', cancellationId: 'cancel-1' }),
    ).resolves.toBeDefined();
    expect(sweepMock.reverse).toHaveBeenCalledTimes(1);
  });

  // ─── Test 3: guards ─────────────────────────────────────────────────────

  it('throws BadRequestException when no activation 1A JE exists for contract', async () => {
    prismaMock.journalEntry.findFirst.mockResolvedValue(null);

    await expect(
      template.execute({ contractId: 'contract-1', cancellationId: 'cancel-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(sweepMock.reverse).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when the sweep finds nothing to reverse', async () => {
    sweepMock.reverse.mockResolvedValue({ reversalJeIds: [], redirectedTotals: {} });

    await expect(
      template.execute({ contractId: 'contract-1', cancellationId: 'cancel-1' }),
    ).rejects.toThrow('ไม่มีรายการบัญชีให้กลับรายการ');
  });

  // ─── Test 4: idempotent — DB-backed probe via reversalJournalEntryId ────

  it('returns the stored reversal entry without re-sweeping (idempotent, DB-backed)', async () => {
    prismaMock.contractCancellation.findUnique.mockResolvedValue({
      reversalJournalEntryId: 'je-existing-1',
    });
    prismaMock.journalEntry.findUniqueOrThrow.mockResolvedValue({
      entryNumber: 'JE-202601-EXISTING',
    });

    const result = await template.execute({
      contractId: 'contract-1',
      cancellationId: 'cancel-1',
    });

    expect(result.entryNumber).toBe('JE-202601-EXISTING');
    expect(result.reversalJeIds).toEqual([]);
    expect(sweepMock.reverse).not.toHaveBeenCalled();
    expect(eclMock.execute).not.toHaveBeenCalled();
  });
});
