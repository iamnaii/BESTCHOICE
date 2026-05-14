import { Decimal } from '@prisma/client/runtime/library';
import { VendorSettlementTemplate } from '../../journal/cpa-templates/vendor-settlement.template';

describe('VendorSettlementTemplate', () => {
  let template: VendorSettlementTemplate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;

  const docId = 'se-1';

  beforeEach(() => {
    journal = {
      createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-SE-001', id: 'je-se-1' }),
    };
    prisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
      expenseDocument: {
        findUniqueOrThrow: jest.fn(),
        // findMany used for single-vendor invariant check (added in PR-1 hardening)
        // AND for partial-vs-full settlement lookup (Fix #C8 — totalAmount per cleared id).
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        // updateMany used for batched cleared-EX status flip (replaces N x update)
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // groupBy used for cumulative-settled lookup (Fix #C8 — partial vs full).
      settlementLine: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      journalEntry: {
        findUnique: jest.fn().mockResolvedValue({ entryNumber: 'JE-SE-001' }),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'company-shop' }),
      },
    };
    template = new VendorSettlementTemplate(journal, prisma);
  });

  it('single ACCRUAL cleared, no WHT — Dr 21-1104 1000 / Cr cash 1000', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'SE-20260510-0001',
      documentType: 'VENDOR_SETTLEMENT',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('1000.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      depositAccountCode: '11-1101',
      journalEntryId: null,
      settlement: {
        settlementLines: [
          { id: 'l1', clearedDocumentId: 'ex-1', amountSettled: new Decimal('1000.00') },
        ],
      },
    });
    // findMany #1 — single-vendor invariant (one vendor, OK)
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
    ]);
    // findMany #2 — totalAmount lookup (Fix #C8 partial vs full check)
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', totalAmount: new Decimal('1000.00') },
    ]);

    const result = await template.execute(docId);
    expect(result.entryNo).toBe('JE-SE-001');
    expect(journal.createAndPost).toHaveBeenCalledTimes(1);

    const [args] = journal.createAndPost.mock.calls[0];
    const drAp = args.lines.find((l: { accountCode: string }) => l.accountCode === '21-1104');
    expect(drAp.dr).toEqual(new Decimal('1000'));
    const crCash = args.lines.find((l: { accountCode: string }) => l.accountCode === '11-1101');
    expect(crCash.cr).toEqual(new Decimal('1000'));

    // No WHT line
    const codes = args.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).not.toContain('21-3102');
    expect(codes).not.toContain('21-3103');

    // Balanced
    const sumDr = args.lines.reduce(
      (s: Decimal, l: { dr: Decimal }) => s.plus(l.dr),
      new Decimal(0),
    );
    const sumCr = args.lines.reduce(
      (s: Decimal, l: { cr: Decimal }) => s.plus(l.cr),
      new Decimal(0),
    );
    expect(sumDr.toString()).toBe('1000');
    expect(sumCr.toString()).toBe('1000');
  });

  it('multiple ACCRUAL cleared, no WHT — Dr 21-1104 6000 / Cr cash 6000', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'SE-20260510-0002',
      documentType: 'VENDOR_SETTLEMENT',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('6000.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      depositAccountCode: '11-1101',
      journalEntryId: null,
      settlement: {
        settlementLines: [
          { id: 'l1', clearedDocumentId: 'ex-1', amountSettled: new Decimal('1000.00') },
          { id: 'l2', clearedDocumentId: 'ex-2', amountSettled: new Decimal('2000.00') },
          { id: 'l3', clearedDocumentId: 'ex-3', amountSettled: new Decimal('3000.00') },
        ],
      },
    });
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
      { id: 'ex-2', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
      { id: 'ex-3', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
    ]);
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', totalAmount: new Decimal('1000.00') },
      { id: 'ex-2', totalAmount: new Decimal('2000.00') },
      { id: 'ex-3', totalAmount: new Decimal('3000.00') },
    ]);

    await template.execute(docId);

    const [args] = journal.createAndPost.mock.calls[0];
    const drAp = args.lines.find((l: { accountCode: string }) => l.accountCode === '21-1104');
    expect(drAp.dr).toEqual(new Decimal('6000'));
    const crCash = args.lines.find((l: { accountCode: string }) => l.accountCode === '11-1101');
    expect(crCash.cr).toEqual(new Decimal('6000'));

    // Balanced
    const sumDr = args.lines.reduce(
      (s: Decimal, l: { dr: Decimal }) => s.plus(l.dr),
      new Decimal(0),
    );
    const sumCr = args.lines.reduce(
      (s: Decimal, l: { cr: Decimal }) => s.plus(l.cr),
      new Decimal(0),
    );
    expect(sumDr.toString()).toBe('6000');
    expect(sumCr.toString()).toBe('6000');
  });

  it('with WHT (PND3) — Dr 21-1104 5000 / Cr cash 4900 + Cr 21-3102 100', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'SE-20260510-0003',
      documentType: 'VENDOR_SETTLEMENT',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('5000.00'),
      withholdingTax: new Decimal('100.00'),
      whtFormType: 'PND3',
      depositAccountCode: '11-1101',
      journalEntryId: null,
      settlement: {
        settlementLines: [
          { id: 'l1', clearedDocumentId: 'ex-1', amountSettled: new Decimal('5000.00') },
        ],
      },
    });
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
    ]);
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', totalAmount: new Decimal('5000.00') },
    ]);

    await template.execute(docId);

    const [args] = journal.createAndPost.mock.calls[0];
    const drAp = args.lines.find((l: { accountCode: string }) => l.accountCode === '21-1104');
    expect(drAp.dr).toEqual(new Decimal('5000'));
    const crCash = args.lines.find((l: { accountCode: string }) => l.accountCode === '11-1101');
    expect(crCash.cr).toEqual(new Decimal('4900'));
    const crWht = args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3102');
    expect(crWht.cr).toEqual(new Decimal('100'));

    // Balanced
    const sumDr = args.lines.reduce(
      (s: Decimal, l: { dr: Decimal }) => s.plus(l.dr),
      new Decimal(0),
    );
    const sumCr = args.lines.reduce(
      (s: Decimal, l: { cr: Decimal }) => s.plus(l.cr),
      new Decimal(0),
    );
    expect(sumDr.toString()).toBe('5000');
    expect(sumCr.toString()).toBe('5000');
  });

  it('side effect — each fully-cleared EX status → POSTED + paidAt = SE.documentDate', async () => {
    const documentDate = new Date('2026-05-10');
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'SE-20260510-0004',
      documentType: 'VENDOR_SETTLEMENT',
      documentDate,
      totalAmount: new Decimal('3000.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      depositAccountCode: '11-1101',
      journalEntryId: null,
      settlement: {
        settlementLines: [
          { id: 'l1', clearedDocumentId: 'ex-a', amountSettled: new Decimal('1000.00') },
          { id: 'l2', clearedDocumentId: 'ex-b', amountSettled: new Decimal('2000.00') },
        ],
      },
    });
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-a', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
      { id: 'ex-b', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
    ]);
    // Both EXs fully settled by this SE (settled == totalAmount).
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-a', totalAmount: new Decimal('1000.00') },
      { id: 'ex-b', totalAmount: new Decimal('2000.00') },
    ]);

    await template.execute(docId);

    // Cleared EXs flipped via batched updateMany (deletedAt:null guard)
    expect(prisma.expenseDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['ex-a', 'ex-b'] },
          deletedAt: null,
        }),
        data: expect.objectContaining({ status: 'POSTED', paidAt: documentDate }),
      }),
    );
    // SE itself updated via single update to POSTED + journalEntryId
    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: docId },
        data: expect.objectContaining({
          status: 'POSTED',
          paidAt: documentDate,
          journalEntryId: 'je-se-1',
        }),
      }),
    );
  });

  it('rejects when cleared EXs span multiple vendors (single-vendor invariant)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'SE-20260510-0006',
      documentType: 'VENDOR_SETTLEMENT',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('3000.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      depositAccountCode: '11-1101',
      journalEntryId: null,
      settlement: {
        settlementLines: [
          { id: 'l1', clearedDocumentId: 'ex-vendorA', amountSettled: new Decimal('1000.00') },
          { id: 'l2', clearedDocumentId: 'ex-vendorB', amountSettled: new Decimal('2000.00') },
        ],
      },
    });
    // findMany returns docs from two distinct vendors → invariant must reject
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-vendorA', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
      { id: 'ex-vendorB', vendorTaxId: '9876543210987', vendorName: 'Vendor B' },
    ]);

    await expect(template.execute(docId)).rejects.toThrow(
      /ผู้ขายรายเดียว/,
    );
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('idempotent — returns existing entryNo when journalEntryId already set, no createAndPost call', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'SE-20260510-0005',
      documentType: 'VENDOR_SETTLEMENT',
      documentDate: new Date('2026-05-10'),
      journalEntryId: 'je-existing-uuid',
      settlement: {
        settlementLines: [
          { id: 'l1', clearedDocumentId: 'ex-1', amountSettled: new Decimal('1000.00') },
        ],
      },
    });
    prisma.journalEntry.findUnique.mockResolvedValueOnce({ entryNumber: 'JE-EXISTING' });

    const result = await template.execute(docId);
    expect(result.entryNo).toBe('JE-EXISTING');
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  // Fix #C8 — partial settlement (settled < total) must keep EX status=ACCRUAL
  // so a subsequent SE can clear the residual. Without this guard the AP balance
  // strands forever (cap check at expense-documents.service blocks SE on non-ACCRUAL).
  it('Fix #C8 — keeps EX status=ACCRUAL when partial settlement < total', async () => {
    const documentDate = new Date('2026-05-10');
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'SE-20260510-0010',
      documentType: 'VENDOR_SETTLEMENT',
      documentDate,
      totalAmount: new Decimal('6000.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      depositAccountCode: '11-1101',
      journalEntryId: null,
      settlement: {
        settlementLines: [
          { id: 'l1', clearedDocumentId: 'ex-1', amountSettled: new Decimal('6000.00') },
        ],
      },
    });
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
    ]);
    // EX total = 10,000 but we only settle 6,000 → partial, must stay ACCRUAL.
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', totalAmount: new Decimal('10000.00') },
    ]);

    await template.execute(docId);

    // EX must NOT be flipped to POSTED — updateMany on cleared EXs should not be
    // called at all (no fullyPaidIds). The SE itself flips to POSTED via the
    // separate single `update` call below; that's unrelated to the cleared EX.
    const clearedFlipCalls = (prisma.expenseDocument.updateMany.mock.calls as unknown[][]).filter(
      (args) => {
        const where = (args[0] as { where: { id?: { in?: string[] } } }).where;
        return where.id?.in?.includes('ex-1') ?? false;
      },
    );
    expect(clearedFlipCalls).toHaveLength(0);
    // SE itself still flips to POSTED (separate `update` call on SE.id)
    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: docId },
        data: expect.objectContaining({ status: 'POSTED', paidAt: documentDate }),
      }),
    );
  });

  // Fix #C8 — when cumulative prior + this SE = total, the EX must flip POSTED.
  // Tests the "second SE clears the residual" path.
  it('Fix #C8 — flips EX status=POSTED only when cumulative settled = total', async () => {
    const documentDate = new Date('2026-05-12');
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'SE-20260512-0001',
      documentType: 'VENDOR_SETTLEMENT',
      documentDate,
      totalAmount: new Decimal('4000.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      depositAccountCode: '11-1101',
      journalEntryId: null,
      settlement: {
        settlementLines: [
          { id: 'l2', clearedDocumentId: 'ex-1', amountSettled: new Decimal('4000.00') },
        ],
      },
    });
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
    ]);
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', totalAmount: new Decimal('10000.00') },
    ]);
    // Prior POSTED SE already settled 6,000 → this SE adds 4,000 = 10,000 (full).
    prisma.settlementLine.groupBy.mockResolvedValueOnce([
      { clearedDocumentId: 'ex-1', _sum: { amountSettled: new Decimal('6000.00') } },
    ]);

    await template.execute(docId);

    expect(prisma.expenseDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['ex-1'] },
          deletedAt: null,
        }),
        data: expect.objectContaining({ status: 'POSTED', paidAt: documentDate }),
      }),
    );
  });

  // C12-symmetry — template-level defense throws when whtFormType is unknown.
  // Service-level guard normally rejects first, but template throws too so any
  // bypass surfaces here instead of silently misrouting under PND3.
  it('C12-symmetry: throws when wht > 0 and whtFormType is null', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'SE-20260514-C12A',
      documentType: 'VENDOR_SETTLEMENT',
      documentDate: new Date('2026-05-14'),
      totalAmount: new Decimal('5000.00'),
      withholdingTax: new Decimal('100.00'),
      whtFormType: null,
      depositAccountCode: '11-1101',
      journalEntryId: null,
      settlement: {
        settlementLines: [
          { id: 'l1', clearedDocumentId: 'ex-1', amountSettled: new Decimal('5000.00') },
        ],
      },
    });
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
    ]);

    await expect(template.execute(docId)).rejects.toThrow(/whtFormType ต้องเป็น PND3 หรือ PND53/);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('C12-symmetry: throws when whtFormType is unknown string (defensive)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'SE-20260514-C12B',
      documentType: 'VENDOR_SETTLEMENT',
      documentDate: new Date('2026-05-14'),
      totalAmount: new Decimal('5000.00'),
      withholdingTax: new Decimal('100.00'),
      whtFormType: 'PND91',
      depositAccountCode: '11-1101',
      journalEntryId: null,
      settlement: {
        settlementLines: [
          { id: 'l1', clearedDocumentId: 'ex-1', amountSettled: new Decimal('5000.00') },
        ],
      },
    });
    prisma.expenseDocument.findMany.mockResolvedValueOnce([
      { id: 'ex-1', vendorTaxId: '1234567890123', vendorName: 'Vendor A' },
    ]);

    await expect(template.execute(docId)).rejects.toThrow(/whtFormType ต้องเป็น PND3 หรือ PND53/);
  });
});
