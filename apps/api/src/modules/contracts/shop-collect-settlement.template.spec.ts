/**
 * shop-collect-settlement.template.spec.ts
 *
 * Unit tests (Jest mocks, no real DB) for ShopCollectSettlementTemplate's
 * P2002-race handling — Item 3, repossessions-followups-2026-08.
 *
 * The up-front requestId dedupe check (execute(), before createAndPost) is a
 * check-then-act race: two submissions carrying the SAME requestId can both
 * pass it (neither JE exists yet) and both reach createAndPost. The loser
 * previously surfaced a raw Prisma unique-violation (P2002 on
 * journal_entries_idempotency_idx / journal_entries_ref_unique) as an
 * unhandled 500. The fix wraps createAndPost in try/catch and, on P2002 +
 * requestId present, re-runs the same dedupe query to translate the race
 * into either an idempotent hit (amount matches) or the existing
 * ConflictException (amount differs) — see shop-collect-settlement.template.ts.
 *
 * Placed here, NOT under journal/cpa-templates/, because jest's
 * testPathIgnorePatterns (apps/api/package.json) excludes every
 * cpa-templates/*.spec.ts EXCEPT contract-cancellation.template.spec.ts
 * (verified empirically 2026-08-08: `npx jest src/modules/journal --listTests`
 * does not list a probe spec.ts placed there). DB-backed coverage for the
 * rest of this template already lives alongside this file at
 * shop-collect-settlement.integration.spec.ts (vitest, 9 specs, DB-backed —
 * a live two-process race is impractical to simulate deterministically
 * there, hence this mocked unit spec for the race-recovery branch instead).
 *
 * Run: cd apps/api && npx jest src/modules/contracts/shop-collect-settlement.template.spec.ts --silent
 */
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ConflictException } from '@nestjs/common';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { JournalAutoService } from '../journal/journal-auto.service';

function makeP2002(message = 'Unique constraint failed on the fields'): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2002',
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
    };

    template = new ShopCollectSettlementTemplate(journalMock as unknown as JournalAutoService, prismaMock);
  });

  it('P2002 race + existing JE matches the incoming amount → idempotent hit (entryNo, deduped:true), not a 500', async () => {
    // 1st findFirst = up-front dedupe check (this call "wins" the check —
    // nothing exists yet). 2nd findFirst = the post-P2002 retry query, which
    // now finds the JE the concurrent winner actually posted.
    prismaMock.journalEntry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        entryNumber: 'JE-202608-00099',
        metadata: { flow: 'shop-collect-settlement', contractId, requestId, amount: '2500.00' },
      });
    journalMock.createAndPost.mockRejectedValue(makeP2002());

    const result = await template.execute({ contractId, depositAccountCode, amount: 2500, requestId });

    expect(result).toEqual({ entryNo: 'JE-202608-00099', deduped: true });
  });

  it('P2002 race + existing JE has a DIFFERENT amount → ConflictException (ห้ามกลืนเงียบ)', async () => {
    prismaMock.journalEntry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        entryNumber: 'JE-202608-00099',
        metadata: { flow: 'shop-collect-settlement', contractId, requestId, amount: '3000.00' },
      });
    journalMock.createAndPost.mockRejectedValue(makeP2002());

    await expect(
      template.execute({ contractId, depositAccountCode, amount: 2500, requestId }),
    ).rejects.toThrow(ConflictException);
  });

  it('P2002 error but the re-query finds no matching row → rethrows the ORIGINAL P2002 (e.g. legacy reference collision)', async () => {
    prismaMock.journalEntry.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const original = makeP2002('legacy reference collision');
    journalMock.createAndPost.mockRejectedValue(original);

    await expect(
      template.execute({ contractId, depositAccountCode, amount: 2500, requestId }),
    ).rejects.toBe(original);
  });

  it('P2002 error + the retry re-query itself throws (poisoned outer tx, e.g. 25P02) → surfaces the ORIGINAL P2002, not the re-query failure', async () => {
    prismaMock.journalEntry.findFirst
      .mockResolvedValueOnce(null) // up-front check
      .mockRejectedValueOnce(new Error('current transaction is aborted')); // retry query
    const original = makeP2002();
    journalMock.createAndPost.mockRejectedValue(original);

    await expect(
      template.execute({ contractId, depositAccountCode, amount: 2500, requestId }),
    ).rejects.toBe(original);
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

  it('P2002 with NO requestId (legacy caller) → race-recovery is skipped entirely, rethrows the original error', async () => {
    // No requestId ⇒ the up-front block is skipped; the single findFirst
    // call below is the legacy (contractId+amount) idempotency check.
    prismaMock.journalEntry.findFirst.mockResolvedValueOnce(null);
    const original = makeP2002();
    journalMock.createAndPost.mockRejectedValue(original);

    await expect(
      template.execute({ contractId, depositAccountCode, amount: 2500 }),
    ).rejects.toBe(original);

    expect(prismaMock.journalEntry.findFirst).toHaveBeenCalledTimes(1);
  });
});
