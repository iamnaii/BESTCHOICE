/**
 * contract-cancellation.template.spec.ts
 *
 * Unit tests for ContractCancellationTemplate using Jest mocks (no real DB).
 *
 * NOTE: cpa-templates specs are excluded from the default jest run via
 * testPathIgnorePatterns. Run individually with:
 *   npx jest --testPathPattern=contract-cancellation.template.spec
 */
import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException } from '@nestjs/common';
import { ContractCancellationTemplate } from './contract-cancellation.template';
import { JournalAutoService } from '../journal-auto.service';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeActivationJeLine(accountCode: string, debit: string, credit: string) {
  return {
    accountCode,
    debit: new Decimal(debit),
    credit: new Decimal(credit),
    description: `Test line ${accountCode}`,
  };
}

/** Standard 1A activation JE lines for a 17,000 / 12-month contract. */
const ACTIVATION_LINES = [
  makeActivationJeLine('11-2101', '19600', '0'),    // HP Receivable Gross Dr
  makeActivationJeLine('11-2105', '1274', '0'),     // VAT Receivable Dr
  makeActivationJeLine('21-1101', '0', '17000'),    // เจ้าหนี้-หน้าร้าน Cr
  makeActivationJeLine('21-1102', '0', '1700'),     // เจ้าหนี้ค่าคอม Cr
  makeActivationJeLine('11-2106', '0', '900'),      // Unearned Interest Cr
  makeActivationJeLine('21-2102', '0', '1274'),     // VAT Deferred Cr
];

const mockActivationJE = {
  id: 'je-activation-1',
  entryNumber: 'JE-202601-00001',
  status: 'POSTED',
  metadata: { tag: '1A', contractId: 'contract-1' },
  lines: ACTIVATION_LINES,
  deletedAt: null,
};

const mockContract = {
  contractNumber: 'BC-2026-001',
};

// ─── suite ───────────────────────────────────────────────────────────────────

describe('ContractCancellationTemplate', () => {
  let template: ContractCancellationTemplate;
  let journalMock: jest.Mocked<Pick<JournalAutoService, 'createAndPost'>>;
  let prismaMock: any;

  beforeEach(() => {
    journalMock = {
      createAndPost: jest.fn().mockResolvedValue({ id: 'je-new', entryNumber: 'JE-202601-00010' }),
    };

    prismaMock = {
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(mockContract),
      },
      journalEntry: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    template = new ContractCancellationTemplate(
      journalMock as unknown as JournalAutoService,
      prismaMock,
    );
  });

  // ─── Test 1: reversal entries are balanced ──────────────────────────────

  it('reversal JE lines sum to zero (balanced) — Dr = Cr', async () => {
    // First findFirst call: no existing reversal
    // Second findFirst call: return the activation JE
    prismaMock.journalEntry.findFirst
      .mockResolvedValueOnce(mockActivationJE)   // activation JE found
      .mockResolvedValueOnce(null);              // no existing reversal

    // Override createAndPost to capture the lines passed
    const capturedInputs: any[] = [];
    journalMock.createAndPost.mockImplementation(async (input) => {
      capturedInputs.push(input);
      return { id: `je-${capturedInputs.length}`, entryNumber: `JE-202601-0001${capturedInputs.length}` };
    });

    await template.execute({
      contractId: 'contract-1',
      cancellationId: 'cancel-1',
      refundAmount: new Decimal(0),
    });

    expect(capturedInputs.length).toBe(1); // only reversal, no refund
    const reversalInput = capturedInputs[0];

    const totalDr = reversalInput.lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const totalCr = reversalInput.lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));

    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });

  // ─── Test 2: with refundAmount > 0, refund lines added ─────────────────

  it('with refundAmount > 0 adds Dr 52-1106 / Cr 11-1201 refund JE', async () => {
    prismaMock.journalEntry.findFirst
      .mockResolvedValueOnce(mockActivationJE)
      .mockResolvedValueOnce(null);

    const capturedInputs: any[] = [];
    journalMock.createAndPost.mockImplementation(async (input) => {
      capturedInputs.push(input);
      return { id: `je-${capturedInputs.length}`, entryNumber: `JE-202601-0001${capturedInputs.length}` };
    });

    const refundAmount = new Decimal('500.00');
    await template.execute({
      contractId: 'contract-1',
      cancellationId: 'cancel-1',
      refundAmount,
    });

    // Two JEs should be created: reversal + refund
    expect(capturedInputs.length).toBe(2);

    const refundInput = capturedInputs[1];
    const discountLine = refundInput.lines.find((l: any) => l.accountCode === '52-1106');
    const bankLine = refundInput.lines.find((l: any) => l.accountCode === '11-1201');

    expect(discountLine).toBeDefined();
    expect(bankLine).toBeDefined();
    expect(new Decimal(discountLine.dr.toString()).toFixed(2)).toBe('500.00');
    expect(new Decimal(bankLine.cr.toString()).toFixed(2)).toBe('500.00');

    // Refund JE is also balanced
    const refundDr = refundInput.lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const refundCr = refundInput.lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
    expect(refundDr.toFixed(2)).toBe(refundCr.toFixed(2));
  });

  // ─── Test 3: throws when no activation JE found ─────────────────────────

  it('throws BadRequestException when no activation 1A JE exists for contract', async () => {
    prismaMock.journalEntry.findFirst
      .mockResolvedValueOnce(null)  // no activation JE
      .mockResolvedValueOnce(null); // no existing reversal

    await expect(
      template.execute({
        contractId: 'contract-1',
        cancellationId: 'cancel-1',
        refundAmount: new Decimal(0),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // ─── Test 4: idempotent — returns existing reversal if already posted ───

  it('returns existing reversal entry number without re-posting (idempotent)', async () => {
    const existingReversal = { entryNumber: 'JE-202601-EXISTING' };
    prismaMock.journalEntry.findFirst
      .mockResolvedValueOnce(mockActivationJE)     // activation found
      .mockResolvedValueOnce(existingReversal);    // reversal already exists

    const result = await template.execute({
      contractId: 'contract-1',
      cancellationId: 'cancel-1',
      refundAmount: new Decimal(0),
    });

    expect(result.entryNumber).toBe('JE-202601-EXISTING');
    expect(journalMock.createAndPost).not.toHaveBeenCalled();
  });
});
