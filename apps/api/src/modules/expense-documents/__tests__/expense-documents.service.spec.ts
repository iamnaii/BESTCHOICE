import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { LineAggregatorService } from '../services/line-aggregator.service';

describe('ExpenseDocumentsService', () => {
  let service: ExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let docNumber: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let transition: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sameDay: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let accrual: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let creditNote: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payroll: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let settlement: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      expenseDocument: {
        create: jest.fn().mockResolvedValue({ id: 'doc-1', number: 'EX-20260510-0001' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        aggregate: jest.fn(),
      },
      expenseDetail: {
        update: jest.fn().mockResolvedValue({}),
        // C12 guard reads the lines to decide if per-line whtFormType is enough
        findUnique: jest.fn().mockResolvedValue({ lines: [] }),
      },
      expenseLine: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      chartOfAccount: {
        findMany: jest.fn().mockResolvedValue([
          { code: '53-1302', type: 'ค่าใช้จ่าย' },
          { code: '53-1404', type: 'ค่าใช้จ่าย' },
        ]),
      },
      // C10 attachment-threshold check reads ATTACHMENT_REQUIRED_ABOVE_AMOUNT
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    docNumber = { next: jest.fn().mockResolvedValue('EX-20260510-0001') };
    transition = {
      assertCanPost: jest.fn(),
      assertCanVoid: jest.fn(),
      assertCanEdit: jest.fn(),
      resolveTargetStatus: jest.fn().mockReturnValue('POSTED'),
    };
    sameDay = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1' }) };
    accrual = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-2' }) };
    creditNote = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-3' }) };
    payroll = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-4' }) };
    settlement = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-5' }) };
    service = new ExpenseDocumentsService(
      prisma,
      docNumber,
      transition,
      sameDay,
      accrual,
      creditNote,
      payroll,
      settlement,
      { createAndPost: jest.fn() } as never,
      new LineAggregatorService(),
      { preview: jest.fn() } as never,
    );
  });

  describe('create', () => {
    it('generates number, creates header + ExpenseDetail with lines in same tx', async () => {
      await service.create(
        {
          documentType: 'EXPENSE',
          branchId: 'branch-1',
          documentDate: '2026-05-10',
          priceType: 'EXCLUSIVE',
          lines: [
            { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
          ],
        } as never,
        'user-1',
      );
      expect(docNumber.next).toHaveBeenCalledWith(prisma, 'EXPENSE', expect.any(Date));
      expect(prisma.expenseDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: 'EX-20260510-0001',
            documentType: 'EXPENSE',
            createdById: 'user-1',
            status: 'DRAFT',
          }),
        }),
      );
    });

    it('computes totalAmount = subtotal + vatAmount from lines', async () => {
      await service.create(
        {
          documentType: 'EXPENSE',
          branchId: 'branch-1',
          documentDate: '2026-05-10',
          priceType: 'EXCLUSIVE',
          lines: [
            { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
          ],
        } as never,
        'user-1',
      );
      const callArg = prisma.expenseDocument.create.mock.calls[0][0];
      // subtotal=1000, vat=70, total=1070
      expect(callArg.data.totalAmount.toFixed(2)).toBe('1070.00');
    });
  });

  describe('list', () => {
    it('translates tab=draft to status=DRAFT', async () => {
      await service.list({ tab: 'draft' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'DRAFT' }),
        }),
      );
    });
    it('translates tab=unpaid to status=ACCRUAL', async () => {
      await service.list({ tab: 'unpaid' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'ACCRUAL' }) }),
      );
    });
    it('translates tab=recorded to status IN [ACCRUAL, POSTED]', async () => {
      await service.list({ tab: 'recorded' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['ACCRUAL', 'POSTED'] } }),
        }),
      );
    });
    it('translates tab=paid to paidAt NOT NULL', async () => {
      await service.list({ tab: 'paid' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paidAt: { not: null } }),
        }),
      );
    });
    it('default excludes VOIDED', async () => {
      await service.list({} as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: 'VOIDED' },
            deletedAt: null,
          }),
        }),
      );
    });
  });

  describe('post', () => {
    it('calls SameDay template when paymentMethod set', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
        totalAmount: new Decimal('500.00'),
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await service.post('doc-1', 'user-1');
      expect(sameDay.execute).toHaveBeenCalledWith('doc-1', expect.anything());
      expect(accrual.execute).not.toHaveBeenCalled();
    });
    it('calls Accrual template when paymentMethod missing', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-2',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        paymentMethod: null,
        depositAccountCode: null,
        totalAmount: new Decimal('300.00'),
      });
      transition.resolveTargetStatus.mockReturnValue('ACCRUAL');
      await service.post('doc-2', 'user-1');
      expect(accrual.execute).toHaveBeenCalledWith('doc-2', expect.anything());
      expect(sameDay.execute).not.toHaveBeenCalled();
    });
    it('rejects post when transition guard throws', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-3', status: 'POSTED', documentType: 'EXPENSE', paymentMethod: 'CASH',
        totalAmount: new Decimal('100.00'),
      });
      transition.assertCanPost.mockImplementation(() => { throw new BadRequestException('not draft'); });
      await expect(service.post('doc-3', 'user-1')).rejects.toThrow(BadRequestException);
    });

    // Fix #C10 — attachment threshold server-enforced
    it('Fix #C10: rejects post when totalAmount ≥ threshold and no receiptImageUrl', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({
        key: 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT',
        value: '50000',
      });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-c10', status: 'DRAFT', documentType: 'EXPENSE',
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        totalAmount: new Decimal('100000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('0'),
        whtFormType: null,
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-c10', 'user-1')).rejects.toThrow(
        /ต้องแนบไฟล์ประกอบ/,
      );
      expect(sameDay.execute).not.toHaveBeenCalled();
    });

    it('Fix #C10: allows post when totalAmount ≥ threshold WITH receiptImageUrl', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({
        key: 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT',
        value: '50000',
      });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-c10b', status: 'DRAFT', documentType: 'EXPENSE',
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        totalAmount: new Decimal('100000.00'),
        receiptImageUrl: 's3://bucket/receipt.pdf',
        withholdingTax: new Decimal('0'),
        whtFormType: null,
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-c10b', 'user-1')).resolves.toBeDefined();
      expect(sameDay.execute).toHaveBeenCalled();
    });

    it('Fix #C10: allows post when totalAmount < threshold, no receipt required', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({
        key: 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT',
        value: '50000',
      });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-c10c', status: 'DRAFT', documentType: 'EXPENSE',
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        totalAmount: new Decimal('1000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('0'),
        whtFormType: null,
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-c10c', 'user-1')).resolves.toBeDefined();
    });

    it('Fix #C10: threshold=0 disables the check (default config)', async () => {
      // null systemConfig → threshold defaults to 0 → never enforced
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-c10d', status: 'DRAFT', documentType: 'EXPENSE',
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        totalAmount: new Decimal('999999.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('0'),
        whtFormType: null,
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-c10d', 'user-1')).resolves.toBeDefined();
    });

    // Fix #C12 — WHT form type required when wht > 0
    it('Fix #C12: rejects post when wht > 0 and doc.whtFormType is null (no per-line override)', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-c12a', status: 'DRAFT', documentType: 'EXPENSE',
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        totalAmount: new Decimal('1000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('30.00'),
        whtFormType: null,
      });
      prisma.expenseDetail.findUnique.mockResolvedValue({
        lines: [{ whtAmount: new Decimal('30.00'), whtFormType: null }],
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-c12a', 'user-1')).rejects.toThrow(
        /whtFormType ต้องระบุ/,
      );
      expect(sameDay.execute).not.toHaveBeenCalled();
    });

    it('Fix #C12: allows post when wht > 0 and doc.whtFormType=PND53', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-c12b', status: 'DRAFT', documentType: 'EXPENSE',
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        totalAmount: new Decimal('1000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('30.00'),
        whtFormType: 'PND53',
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-c12b', 'user-1')).resolves.toBeDefined();
      expect(sameDay.execute).toHaveBeenCalled();
    });

    it('Fix #C12: allows post when doc.whtFormType is null BUT every wht-line has its own form type', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-c12c', status: 'DRAFT', documentType: 'EXPENSE',
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        totalAmount: new Decimal('1000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('30.00'),
        whtFormType: null,
      });
      prisma.expenseDetail.findUnique.mockResolvedValue({
        lines: [{ whtAmount: new Decimal('30.00'), whtFormType: 'PND53' }],
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-c12c', 'user-1')).resolves.toBeDefined();
      expect(sameDay.execute).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects update on POSTED doc', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({ id: 'doc-1', status: 'POSTED' });
      transition.assertCanEdit.mockImplementation(() => { throw new BadRequestException('locked'); });
      await expect(service.update('doc-1', { description: 'X' } as never, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('softDelete', () => {
    it('rejects soft-delete on non-DRAFT', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({ id: 'doc-1', status: 'ACCRUAL', deletedAt: null });
      await expect(service.softDelete('doc-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
    it('sets deletedAt for DRAFT', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({ id: 'doc-1', status: 'DRAFT', deletedAt: null });
      await service.softDelete('doc-1', 'user-1');
      expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFound for missing or soft-deleted', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockRejectedValue(new Error('not found'));
      await expect(service.findOne('missing-id')).rejects.toThrow();
    });
    it('throws NotFoundException when doc is soft-deleted (deletedAt set)', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'DRAFT', deletedAt: new Date(),
      });
      await expect(service.findOne('doc-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDailySummary', () => {
    beforeEach(() => {
      prisma.expenseDocument.findMany.mockResolvedValue([]);
    });

    it('throws when branchId missing', async () => {
      await expect(
        service.getDailySummary(
          { date: '2026-05-10' } as never,
          { id: 'u1', branchId: null, role: 'OWNER' },
        ),
      ).rejects.toThrow();
    });

    it('filters by branchId + date range + excludes VOIDED + deleted', async () => {
      await service.getDailySummary(
        { date: '2026-05-10', branchId: 'b1' } as never,
        { id: 'u1', branchId: 'b1', role: 'OWNER' },
      );
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            branchId: 'b1',
            status: { not: 'VOIDED' },
            deletedAt: null,
          }),
        }),
      );
    });

    it('aggregates byType correctly across multiple docs', async () => {
      prisma.expenseDocument.findMany.mockResolvedValue([
        {
          documentType: 'EXPENSE',
          totalAmount: new Decimal('1000'),
          netPayment: null,
          paymentMethod: null,
          paidAt: null,
          depositAccountCode: null,
          expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
          branch: { id: 'b1', name: 'A' },
        },
        {
          documentType: 'EXPENSE',
          totalAmount: new Decimal('500'),
          netPayment: null,
          paymentMethod: null,
          paidAt: null,
          depositAccountCode: null,
          expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
          branch: { id: 'b1', name: 'A' },
        },
        {
          documentType: 'PAYROLL',
          totalAmount: new Decimal('30000'),
          netPayment: null,
          paymentMethod: null,
          paidAt: null,
          depositAccountCode: null,
          expenseDetail: null,
          branch: { id: 'b1', name: 'A' },
        },
      ]);
      const result = await service.getDailySummary(
        { date: '2026-05-10', branchId: 'b1' } as never,
        { id: 'u1', branchId: 'b1', role: 'OWNER' },
      );
      expect(result.byType.EXPENSE.count).toBe(2);
      expect(result.byType.EXPENSE.total).toBe('1500.00');
      expect(result.byType.PAYROLL.count).toBe(1);
      expect(result.byType.PAYROLL.total).toBe('30000.00');
      expect(result.grandTotal).toBe('31500.00');
    });

    it('aggregates cashMovement only for docs with paidAt today + depositAccountCode', async () => {
      const today = new Date('2026-05-10T10:00:00Z');
      const yesterday = new Date('2026-05-09T10:00:00Z');
      prisma.expenseDocument.findMany.mockResolvedValue([
        {
          documentType: 'EXPENSE',
          totalAmount: new Decimal('1000'),
          netPayment: new Decimal('1000'),
          paymentMethod: 'CASH',
          paidAt: today,
          depositAccountCode: '11-1101',
          expenseDetail: null,
          branch: { id: 'b1', name: 'A' },
        },
        {
          documentType: 'EXPENSE',
          totalAmount: new Decimal('500'),
          netPayment: null,
          paymentMethod: null,
          paidAt: null,
          depositAccountCode: null,
          expenseDetail: null,
          branch: { id: 'b1', name: 'A' },
        },
        {
          documentType: 'EXPENSE',
          totalAmount: new Decimal('300'),
          netPayment: new Decimal('300'),
          paymentMethod: 'CASH',
          paidAt: yesterday,
          depositAccountCode: '11-1101',
          expenseDetail: null,
          branch: { id: 'b1', name: 'A' },
        },
      ]);
      const result = await service.getDailySummary(
        { date: '2026-05-10', branchId: 'b1' } as never,
        { id: 'u1', branchId: 'b1', role: 'OWNER' },
      );
      // Only the first doc (paidAt=today) should be in cashMovement
      expect(result.cashMovement['11-1101']?.count).toBe(1);
      expect(result.cashMovement['11-1101']?.out).toBe('1000.00');
    });
  });

  describe('voidDocument', () => {
    it('flips status to VOIDED for non-VOIDED doc', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'POSTED', journalEntryId: null, documentType: 'EXPENSE',
      });
      await service.voidDocument('doc-1', 'user-1');
      // Compare-and-swap on status — only flips if not already VOIDED
      expect(prisma.expenseDocument.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1', status: { not: 'VOIDED' } },
          data: { status: 'VOIDED' },
        }),
      );
    });
    it('rejects void when transition guard throws (already VOIDED)', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'VOIDED', journalEntryId: null, documentType: 'EXPENSE',
      });
      transition.assertCanVoid.mockImplementation(() => { throw new BadRequestException('already void'); });
      await expect(service.voidDocument('doc-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
    it('takes per-doc advisory lock to serialize concurrent voids', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'POSTED', journalEntryId: null, documentType: 'EXPENSE',
      });
      await service.voidDocument('doc-1', 'user-1');
      // Lock is taken at the start of the tx, before any read.
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        'void:doc-1',
      );
    });
    it('throws when CAS detects another caller already voided the doc', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'POSTED', journalEntryId: null, documentType: 'EXPENSE',
      });
      // updateMany returns count=0 → status flipped between read and write
      prisma.expenseDocument.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.voidDocument('doc-1', 'user-1')).rejects.toThrow(
        /ถูกยกเลิกไปแล้ว/,
      );
    });
    it('posts a reversal JE (flipped Dr/Cr) when doc had a journalEntryId', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1',
        number: 'EX-20260510-0001',
        status: 'POSTED',
        documentType: 'EXPENSE',
        journalEntryId: 'je-1',
      });
      prisma.journalEntry = {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'je-1',
          companyId: 'shop-co',
          lines: [
            { accountCode: '53-1302', debit: '1000', credit: '0', description: 'expense' },
            { accountCode: '11-1101', debit: '0', credit: '1000', description: 'cash' },
          ],
        }),
      };
      const journalMock = { createAndPost: jest.fn().mockResolvedValue({ id: 'je-r1', entryNumber: 'JE-202605-00002' }) };
      const svc = new ExpenseDocumentsService(
        prisma, docNumber, transition, sameDay, accrual, creditNote, payroll, settlement,
        journalMock as never,
        new LineAggregatorService(),
        { preview: jest.fn() } as never,
      );
      await svc.voidDocument('doc-1', 'user-1');
      expect(journalMock.createAndPost).toHaveBeenCalledTimes(1);
      const call = journalMock.createAndPost.mock.calls[0][0];
      // Lines flipped
      expect(call.lines[0]).toMatchObject({ accountCode: '53-1302' });
      expect(call.lines[0].dr.toString()).toBe('0');
      expect(call.lines[0].cr.toString()).toBe('1000');
      expect(call.lines[1]).toMatchObject({ accountCode: '11-1101' });
      expect(call.lines[1].dr.toString()).toBe('1000');
      expect(call.lines[1].cr.toString()).toBe('0');
      expect(call.metadata).toMatchObject({ tag: 'EXPENSE_VOID_REVERSAL', originalJournalEntryId: 'je-1' });
    });
    it('reverts cleared EXs back to ACCRUAL when voiding a VENDOR_SETTLEMENT', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'se-1',
        number: 'SE-20260510-0001',
        status: 'POSTED',
        documentType: 'VENDOR_SETTLEMENT',
        journalEntryId: 'je-se-1',
        settlement: {
          settlementLines: [
            { clearedDocumentId: 'ex-a' },
            { clearedDocumentId: 'ex-b' },
          ],
        },
      });
      prisma.journalEntry = {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'je-se-1', companyId: 'shop-co', lines: [
            { accountCode: '21-1104', debit: '500', credit: '0', description: 'AP' },
            { accountCode: '11-1201', debit: '0', credit: '500', description: 'bank' },
          ],
        }),
      };
      const journalMock = { createAndPost: jest.fn().mockResolvedValue({ id: 'je-r2', entryNumber: 'JE-202605-00003' }) };
      const svc = new ExpenseDocumentsService(
        prisma, docNumber, transition, sameDay, accrual, creditNote, payroll, settlement,
        journalMock as never,
        new LineAggregatorService(),
        { preview: jest.fn() } as never,
      );
      await svc.voidDocument('se-1', 'user-1');
      // Both cleared EXs reverted via updateMany with deletedAt:null guard
      const updateManyCalls = prisma.expenseDocument.updateMany.mock.calls;
      const exA = updateManyCalls.find(
        (c: unknown[]) => (c[0] as { where: { id?: string } }).where.id === 'ex-a',
      );
      const exB = updateManyCalls.find(
        (c: unknown[]) => (c[0] as { where: { id?: string } }).where.id === 'ex-b',
      );
      expect(exA?.[0]).toMatchObject({
        where: { id: 'ex-a', deletedAt: null },
        data: { status: 'ACCRUAL', paidAt: null },
      });
      expect(exB?.[0]).toMatchObject({
        where: { id: 'ex-b', deletedAt: null },
        data: { status: 'ACCRUAL', paidAt: null },
      });
    });
    it('skips soft-deleted EXs when reverting on SE void (does not throw)', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'se-1',
        number: 'SE-20260510-0001',
        status: 'POSTED',
        documentType: 'VENDOR_SETTLEMENT',
        journalEntryId: null,
        settlement: {
          settlementLines: [{ clearedDocumentId: 'ex-deleted' }],
        },
      });
      // First updateMany call (revert ex-deleted) returns count=0 because the EX is soft-deleted
      // Second call (final CAS flip) returns count=1.
      prisma.expenseDocument.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      await expect(service.voidDocument('se-1', 'user-1')).resolves.toBeDefined();
      // Revert call used the deletedAt:null filter
      expect(prisma.expenseDocument.updateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: 'ex-deleted', deletedAt: null },
        }),
      );
    });
  });
});
