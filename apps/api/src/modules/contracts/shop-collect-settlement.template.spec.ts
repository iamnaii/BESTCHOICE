/**
 * shop-collect-settlement.template.spec.ts
 *
 * Unit tests (Jest mocks, no real DB) for ShopCollectSettlementTemplate's
 * P2002-race handling — Item 3, repossessions-followups-2026-08.
 *
 * The up-front requestId dedupe check (execute(), before createAndPost) is a
 * check-then-act race: two submissions carrying the SAME requestId can both
 * pass it (neither JE exists yet) and both reach createAndPost. The loser
 * hits a raw Prisma unique-violation (P2002 on
 * journal_entries_idempotency_idx / journal_entries_ref_unique).
 *
 * CRITICAL FIX (2026-08-08 review): the template's ONLY production caller
 * (`ContractPaymentService.shopCollectSettlement`) always wraps `execute` in
 * a Serializable `$transaction`. By the time P2002 surfaces, Postgres has
 * already aborted that transaction (25P02) — every subsequent query on the
 * SAME client throws. A re-query-based "recovery" (the previous
 * implementation) can therefore NEVER succeed at the real call site; it just
 * swallows the useful P2002 and rethrows it anyway. The fix (matching the
 * repo precedent in `payroll-remittance.template.ts`) is to skip the re-query
 * entirely and throw a clean `ConflictException` (409) immediately — throwing
 * needs no DB access, so it works inside an aborted tx.
 *
 * Placed here, NOT under journal/cpa-templates/, because jest's
 * testPathIgnorePatterns (apps/api/package.json) excludes every
 * cpa-templates/*.spec.ts EXCEPT contract-cancellation.template.spec.ts
 * (verified empirically 2026-08-08: `npx jest src/modules/journal --listTests`
 * does not list a probe spec.ts placed there). DB-backed coverage for the
 * rest of this template already lives alongside this file at
 * shop-collect-settlement.integration.spec.ts (vitest, DB-backed — includes a
 * live two-connection race test proving the same invariant empirically).
 *
 * Run: cd apps/api && npx jest src/modules/contracts/shop-collect-settlement.template.spec.ts --silent
 */
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ConflictException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { JournalAutoService } from '../journal/journal-auto.service';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

function makeP2002(message = 'Unique constraint failed on the fields'): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function makeP2034(
  message = 'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('ShopCollectSettlementTemplate — P2002 race handling', () => {
  let template: ShopCollectSettlementTemplate;
  let journalMock: jest.Mocked<Pick<JournalAutoService, 'createAndPost'>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;

  const contractId = 'contract-1';
  const requestId = '11111111-1111-4111-8111-111111111111';
  const depositAccountCode = '11-1201';

  beforeEach(() => {
    journalMock = {
      createAndPost: jest.fn(),
    };
    prismaMock = {
      journalEntry: {
        findFirst: jest.fn(),
      },
      journalLine: {
        // Outstanding 11-2107 = 2500.00 (Dr 2500 / Cr 0) — matches the
        // amount used by every test below so the over-settle guard passes.
        findMany: jest.fn().mockResolvedValue([{ debit: new Decimal('2500.00'), credit: new Decimal('0') }]),
      },
      interCoSettlementItem: {
        // No interco-batch deduction rows (final review C1 ด่าน (ii)) — the
        // legacy shop-collect path these tests exercise has none.
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    template = new ShopCollectSettlementTemplate(journalMock as unknown as JournalAutoService, prismaMock);
  });

  it('P2002 race + requestId present → clean ConflictException (409), NO further prisma query after createAndPost (poisoned-tx rule)', async () => {
    // Only ONE findFirst call total: the up-front dedupe check (this call
    // "wins" the check — nothing exists yet). There must be NO second
    // findFirst — the tx is aborted after P2002, so a re-query would either
    // throw a secondary error or, if it somehow succeeded, would be reading
    // through a client the real call site can never provide.
    prismaMock.journalEntry.findFirst.mockResolvedValueOnce(null);
    journalMock.createAndPost.mockRejectedValue(makeP2002());

    await expect(
      template.execute({ contractId, depositAccountCode, amount: 2500, requestId }),
    ).rejects.toThrow(ConflictException);
    await expect(
      template.execute({ contractId, depositAccountCode, amount: 2500, requestId }),
    ).rejects.toThrow('กำลังถูกบันทึกอยู่');

    // Exactly 2 calls total across the two execute() invocations above (one
    // up-front findFirst per call) — proves no re-query was attempted after
    // either P2002.
    expect(prismaMock.journalEntry.findFirst).toHaveBeenCalledTimes(2);
  });

  it('P2002 with NO requestId (legacy caller) → race-recovery is skipped entirely, rethrows the original error', async () => {
    // No requestId ⇒ the up-front requestId block is skipped; the single
    // findFirst call below is the legacy (contractId+amount) idempotency
    // check.
    prismaMock.journalEntry.findFirst.mockResolvedValueOnce(null);
    const original = makeP2002();
    journalMock.createAndPost.mockRejectedValue(original);

    await expect(
      template.execute({ contractId, depositAccountCode, amount: 2500 }),
    ).rejects.toBe(original);

    expect(prismaMock.journalEntry.findFirst).toHaveBeenCalledTimes(1);
  });

  it('P2034 (Postgres SSI write conflict, empirically observed under the caller\'s SERIALIZABLE tx) → clean ConflictException (409), even without requestId', async () => {
    prismaMock.journalEntry.findFirst.mockResolvedValueOnce(null); // up-front check (no requestId branch this time)
    journalMock.createAndPost.mockRejectedValue(makeP2034());

    await expect(
      template.execute({ contractId, depositAccountCode, amount: 2500 }),
    ).rejects.toThrow(ConflictException);
    await expect(
      template.execute({ contractId, depositAccountCode, amount: 2500 }),
    ).rejects.toThrow('write conflict');

    // No re-query after the P2034 catch — same poisoned-tx rule as P2002.
    expect(prismaMock.journalEntry.findFirst).toHaveBeenCalledTimes(2);

    // SentryExceptionFilter only captures status >= 500 — a 409 here would
    // otherwise be invisible, so P2034 must surface a Sentry warning.
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      '[SCS] P2034 write-conflict translated to 409',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('non-P2002 error from createAndPost → rethrown untouched, no race-recovery attempted', async () => {
    prismaMock.journalEntry.findFirst.mockResolvedValueOnce(null); // up-front check only
    const boom = new Error('boom — unrelated DB failure');
    journalMock.createAndPost.mockRejectedValue(boom);

    await expect(
      template.execute({ contractId, depositAccountCode, amount: 2500, requestId }),
    ).rejects.toBe(boom);

    // Must not attempt a second (retry) findFirst for a non-P2002 error.
    expect(prismaMock.journalEntry.findFirst).toHaveBeenCalledTimes(1);
  });
});
