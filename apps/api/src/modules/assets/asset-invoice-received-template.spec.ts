import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AssetInvoiceReceivedTemplate } from '../journal/cpa-templates/asset-invoice-received.template';

/**
 * Characterization (golden) UNIT test for AssetInvoiceReceivedTemplate.
 *
 * Locks the deferred-input-VAT transfer that fires when the supplier tax
 * invoice physically arrives for an asset that was POSTed before the invoice:
 *
 *   Dr 11-4101  ภาษีซื้อ (เครดิตได้ทันที)        [vatAmount]
 *     Cr 11-4102 ภาษีซื้อรอเรียกเก็บ             [vatAmount]
 *
 * Mock-based — JournalAutoService.createAndPost + PrismaService are plain
 * jest mocks; no real DB. Money is Prisma.Decimal, asserted via .toFixed(2).
 *
 * The existing cpa-templates/asset-invoice-received.template.spec.ts is a
 * vitest + real-DB integration test that jest IGNORES (testPathIgnorePatterns
 * matches /cpa-templates/). This file is the jest-visible safety net.
 */
describe('AssetInvoiceReceivedTemplate (mock unit)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let template: AssetInvoiceReceivedTemplate;

  // Captured payload that the template handed to createAndPost.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let capturedPostArgs: any;
  let auditLogArgs: { data: Record<string, unknown> } | undefined;

  const POSTED_ASSET = {
    id: 'asset-1',
    assetCode: 'INV-0001',
    name: 'Notebook with deferred VAT',
    status: 'POSTED',
    hasVat: true,
    vatAccount: '11-4102',
    // vatAmount comes off the DB row as a Decimal; template re-wraps via
    // new Decimal(asset.vatAmount.toString()).
    vatAmount: new Prisma.Decimal('700'),
    deletedAt: null,
  };

  beforeEach(() => {
    capturedPostArgs = undefined;
    auditLogArgs = undefined;

    journal = {
      createAndPost: jest.fn().mockImplementation((payload: unknown) => {
        capturedPostArgs = payload;
        return Promise.resolve({ id: 'je-uuid-1', entryNumber: 'JE-260601-00001' });
      }),
    };

    // tx client used inside $transaction — no existing JE (first run path).
    const tx = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      journalPostAuditLog: {
        create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          auditLogArgs = args;
          return Promise.resolve({ id: 'audit-1' });
        }),
      },
    };

    prisma = {
      fixedAsset: {
        findFirst: jest.fn().mockResolvedValue({ ...POSTED_ASSET }),
      },
      // template calls journal.createAndPost with the SAME tx, and createAndPost
      // is fully mocked, so tx only needs journalEntry + journalPostAuditLog.
      $transaction: jest.fn().mockImplementation(
        async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
      ),
      // expose for assertions
      __tx: tx,
    };

    template = new AssetInvoiceReceivedTemplate(journal, prisma);
  });

  it('posts exactly two lines: Dr 11-4101 / Cr 11-4102 for the full vatAmount', async () => {
    const out = await template.execute({ assetId: 'asset-1', triggeredById: 'user-1' });

    // returns the entryNo / id from createAndPost
    expect(out.entryNo).toBe('JE-260601-00001');
    expect(out.journalEntryId).toBe('je-uuid-1');

    const lines = capturedPostArgs.lines as Array<{
      accountCode: string;
      dr: Prisma.Decimal;
      cr: Prisma.Decimal;
    }>;
    expect(lines).toHaveLength(2);

    const drLine = lines[0];
    const crLine = lines[1];

    // Dr leg — claimable input tax 11-4101 = full VAT, credit side zero.
    expect(drLine.accountCode).toBe('11-4101');
    expect(drLine.dr.toFixed(2)).toBe('700.00');
    expect(drLine.cr.toFixed(2)).toBe('0.00');

    // Cr leg — clears deferred input VAT 11-4102 = full VAT, debit side zero.
    expect(crLine.accountCode).toBe('11-4102');
    expect(crLine.cr.toFixed(2)).toBe('700.00');
    expect(crLine.dr.toFixed(2)).toBe('0.00');
  });

  it('produces a balanced JE (total Dr === total Cr === vatAmount)', async () => {
    await template.execute({ assetId: 'asset-1', triggeredById: 'user-1' });

    const lines = capturedPostArgs.lines as Array<{ dr: Prisma.Decimal; cr: Prisma.Decimal }>;
    const totalDr = lines.reduce((s, l) => s.plus(l.dr), new Prisma.Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.cr), new Prisma.Decimal(0));

    expect(totalDr.toFixed(2)).toBe('700.00');
    expect(totalCr.toFixed(2)).toBe('700.00');
    expect(totalDr.equals(totalCr)).toBe(true);
  });

  it('stamps idempotency metadata (flow + assetId) and vatAmount on the posted JE', async () => {
    await template.execute({ assetId: 'asset-1', triggeredById: 'user-1' });

    const meta = capturedPostArgs.metadata as Record<string, unknown>;
    expect(meta.flow).toBe('asset-invoice-received');
    expect(meta.tag).toBe('ASSET_INVOICE_RECEIVED');
    expect(meta.assetId).toBe('asset-1');
    expect(meta.assetCode).toBe('INV-0001');
    // vatAmount is serialized to 2dp string on the metadata for audit/idempotency.
    expect(meta.vatAmount).toBe('700.00');

    // reference encodes asset id + flow so it's traceable.
    expect(capturedPostArgs.reference).toBe('asset-1:asset-invoice-received');

    // audit log is paired with the JE post in the same tx, attributed to the
    // triggering user.
    expect(auditLogArgs?.data.journalEntryId).toBe('je-uuid-1');
    expect(auditLogArgs?.data.postedById).toBe('user-1');
  });

  it('idempotency short-circuit: when a JE already exists, returns it without re-posting', async () => {
    // Re-wire the tx so the dedupe lookup finds an existing JE.
    const existingTx = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'je-existing',
          entryNumber: 'JE-260501-00099',
        }),
      },
      journalPostAuditLog: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(
      async (fn: (t: unknown) => Promise<unknown>) => fn(existingTx),
    );

    const out = await template.execute({ assetId: 'asset-1', triggeredById: 'user-1' });

    expect(out.entryNo).toBe('JE-260501-00099');
    expect(out.journalEntryId).toBe('je-existing');
    // No new JE posted, no audit log written.
    expect(journal.createAndPost).not.toHaveBeenCalled();
    expect(existingTx.journalPostAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects assets whose VAT sits in 11-4101 already (nothing to transfer)', async () => {
    prisma.fixedAsset.findFirst.mockResolvedValue({
      ...POSTED_ASSET,
      vatAccount: '11-4101',
    });

    await expect(
      template.execute({ assetId: 'asset-1', triggeredById: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('rejects a zero-VAT asset (no transfer needed)', async () => {
    prisma.fixedAsset.findFirst.mockResolvedValue({
      ...POSTED_ASSET,
      vatAmount: new Prisma.Decimal('0'),
    });

    await expect(
      template.execute({ assetId: 'asset-1', triggeredById: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('rejects a non-POSTED asset and a missing asset', async () => {
    prisma.fixedAsset.findFirst.mockResolvedValueOnce({ ...POSTED_ASSET, status: 'DRAFT' });
    await expect(
      template.execute({ assetId: 'asset-1', triggeredById: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.fixedAsset.findFirst.mockResolvedValueOnce(null);
    await expect(
      template.execute({ assetId: 'missing', triggeredById: 'user-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
