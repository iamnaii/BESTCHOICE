import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CreditNoteIssueService } from './credit-note-issue.service';
import { CnVatMismatchError } from './credit-note-document.service';
import type { CreditNoteSource, IssueCreditNoteResult } from './credit-note-document.service';

/**
 * Phase 3 CN Task 5 — manual CN issue endpoint. This suite exercises
 * `CreditNoteIssueService.issueManually` in isolation: `CreditNoteDocumentService`
 * and `CreditNoteDeliveryService` are mocked so we can drive every outcome
 * (404 no JE / 409 duplicate / 422 no-accrued / 422 drift-mismatch / 201
 * success + post-commit delivery) without a real DB.
 */
function buildHarness(opts: {
  je?: { entryNumber: string } | null;
  cnOutcome?: IssueCreditNoteResult | (() => never);
  withDelivery?: boolean;
}) {
  const je = opts.je === undefined ? { entryNumber: 'JE-202607-0001' } : opts.je;

  const prisma = {
    journalEntry: { findFirst: jest.fn().mockResolvedValue(je) },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({ __tx: true })),
  };

  const issueForContract = jest.fn(async () => {
    if (typeof opts.cnOutcome === 'function') {
      return (opts.cnOutcome as () => never)();
    }
    return opts.cnOutcome ?? { outcome: 'ISSUED', receiptId: 'receipt-1', receiptNumber: 'RT-202607-00001' };
  });
  const docService = { issueForContract };

  const deliver = jest.fn().mockResolvedValue({ delivered: true });
  const delivery = opts.withDelivery === false ? undefined : { deliver };

  const service = new CreditNoteIssueService(prisma as any, docService as any, delivery as any);
  return { service, prisma, docService, delivery, deliver };
}

const CONTRACT_ID = 'contract-1';
const ACTOR_ID = 'user-1';

describe('CreditNoteIssueService.issueManually', () => {
  it.each<[CreditNoteSource, string]>([
    ['REPOSSESSION', 'repossession'],
    ['WRITE_OFF', 'write-off'],
  ])('resolves the JE using metadata.flow=%s -> %s + contractId + status POSTED', async (source, flow) => {
    const { service, prisma } = buildHarness({});
    await service.issueManually(CONTRACT_ID, source, ACTOR_ID);

    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'POSTED',
          deletedAt: null,
          AND: expect.arrayContaining([
            { metadata: { path: ['flow'], equals: flow } },
            { metadata: { path: ['contractId'], equals: CONTRACT_ID } },
          ]),
        }),
      }),
    );
  });

  it('throws 404 when no matching POSTED journal entry exists', async () => {
    const { service, prisma } = buildHarness({ je: null });

    await expect(service.issueManually(CONTRACT_ID, 'REPOSSESSION', ACTOR_ID)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.issueManually(CONTRACT_ID, 'REPOSSESSION', ACTOR_ID)).rejects.toThrow(
      'ไม่พบรายการบัญชีเลิกสัญญาสำหรับสัญญานี้',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws 409 when issueForContract reports SKIPPED_DUPLICATE', async () => {
    const { service, deliver } = buildHarness({
      cnOutcome: { outcome: 'SKIPPED_DUPLICATE' },
    });

    await expect(service.issueManually(CONTRACT_ID, 'WRITE_OFF', ACTOR_ID)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.issueManually(CONTRACT_ID, 'WRITE_OFF', ACTOR_ID)).rejects.toThrow(
      'สัญญานี้มีใบลดหนี้จากแหล่งนี้แล้ว',
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  it('throws 422 when issueForContract reports SKIPPED_NO_ACCRUED', async () => {
    const { service, deliver } = buildHarness({
      cnOutcome: { outcome: 'SKIPPED_NO_ACCRUED' },
    });

    await expect(service.issueManually(CONTRACT_ID, 'WRITE_OFF', ACTOR_ID)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  it('maps the drift-guard CnVatMismatchError (legacy full-amount JE) to a 422 CPA-advisory message', async () => {
    const { service, deliver } = buildHarness({
      cnOutcome: () => {
        // Real error class (not a hand-typed message string) — proves the
        // catch site discriminates via `instanceof`, so a future wording
        // edit to this message can never silently degrade into a 500.
        throw new CnVatMismatchError(
          '[CN] ยอด VAT ใบลดหนี้ (232.09) ไม่ตรงกับ Journal Entry JE-202607-0001 (297.51) — หยุดเพื่อป้องกันข้อมูลคลาดเคลื่อน',
        );
      },
    });

    await expect(service.issueManually(CONTRACT_ID, 'WRITE_OFF', ACTOR_ID)).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(service.issueManually(CONTRACT_ID, 'WRITE_OFF', ACTOR_ID)).rejects.toThrow(
      /ปรึกษา CPA/,
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  it('passes a NotFoundException thrown by issueForContract through unchanged (M7 — e.g. contract-not-found)', async () => {
    const { service, deliver } = buildHarness({
      cnOutcome: () => {
        // Mirrors CreditNoteDocumentService.issueForContract's contract-not-found
        // path (M7, final-review: NotFoundException instead of a raw Error).
        // `mapIssueError`'s `err instanceof HttpException` branch must return
        // this AS-IS — it must not fall through to the generic rethrow path
        // or get remapped to a different status code.
        throw new NotFoundException('[CN] ไม่พบสัญญา contract-1');
      },
    });

    await expect(service.issueManually(CONTRACT_ID, 'WRITE_OFF', ACTOR_ID)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.issueManually(CONTRACT_ID, 'WRITE_OFF', ACTOR_ID)).rejects.toThrow(
      /ไม่พบสัญญา/,
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  it('rethrows an unrecognized error unchanged (surfaces as 500)', async () => {
    const { service } = buildHarness({
      cnOutcome: () => {
        throw new Error('boom — unexpected DB failure');
      },
    });

    await expect(service.issueManually(CONTRACT_ID, 'WRITE_OFF', ACTOR_ID)).rejects.toThrow(
      'boom — unexpected DB failure',
    );
  });

  it('on success (ISSUED), resolves {receiptId, receiptNumber} and threads actorUserId through', async () => {
    const { service, docService } = buildHarness({});

    const result = await service.issueManually(CONTRACT_ID, 'REPOSSESSION', ACTOR_ID);

    expect(result).toEqual({ receiptId: 'receipt-1', receiptNumber: 'RT-202607-00001' });
    expect(docService.issueForContract).toHaveBeenCalledWith(
      {
        contractId: CONTRACT_ID,
        source: 'REPOSSESSION',
        sourceJournalEntryNo: 'JE-202607-0001',
        actorUserId: ACTOR_ID,
      },
      { __tx: true },
    );
  });

  it('fires CreditNoteDeliveryService.deliver(receiptId) after the transaction resolves on ISSUED', async () => {
    const { service, deliver } = buildHarness({});

    await service.issueManually(CONTRACT_ID, 'REPOSSESSION', ACTOR_ID);

    expect(deliver).toHaveBeenCalledWith('receipt-1');
  });

  it('does not throw and skips delivery when CreditNoteDeliveryService is not wired', async () => {
    const { service } = buildHarness({ withDelivery: false });

    const result = await service.issueManually(CONTRACT_ID, 'REPOSSESSION', ACTOR_ID);

    expect(result).toEqual({ receiptId: 'receipt-1', receiptNumber: 'RT-202607-00001' });
  });
});
