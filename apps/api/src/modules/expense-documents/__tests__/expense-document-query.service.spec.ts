/**
 * Characterization tests for the 9 READ-only methods extracted into
 * ExpenseDocumentQueryService (Phase 1 of the transactional-core decompose).
 *
 * IMPORTANT: every test here drives the FACADE (`service.getApAging(...)` etc.)
 * via the single construction factory. They were written BEFORE the extraction
 * to pin the pre-move behavior, and they keep passing after the facade
 * delegates to QueryService (behavior-identical, same mock instances flow
 * through the factory). Do NOT change these to test the QueryService directly —
 * the public contract is the facade.
 *
 * Focus: the UNDER-PINNED read methods that lacked dedicated coverage in
 * expense-documents.service.spec.ts (getApAging, getSummary, getCreditNoteCap,
 * getAuditTrail, previewJe). `list` / `findOne` / `getDailySummary` are already
 * covered there, so we only spot-check `list` tab translation here.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { makeExpenseDocumentsService } from './support/make-expense-documents-service';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('ExpenseDocumentQueryService (read methods, via facade)', () => {
  describe('getApAging (aging-bucket TRAP)', () => {
    // Deterministic "today" so the BKK calendar-day diff lands rows in stable
    // buckets. 2026-06-10T03:00:00Z = 2026-06-10 10:00 BKK → BKK date 2026-06-10.
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-10T03:00:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    function makeWithRows(rows: any[]) {
      const prisma = {
        expenseDocument: {
          findMany: jest.fn().mockResolvedValue(rows),
        },
      };
      return { prisma, service: makeExpenseDocumentsService({ prisma }).service };
    }

    it('buckets docs into exactly 0-30/31-60/61-90/90+ by BKK calendar-day age, with a TOTAL', async () => {
      // documentDate is stored at UTC midnight; BKK date = same calendar day.
      const rows = [
        // age 0 → 0-30
        { id: 'd0', number: 'EX-1', vendorName: 'A', vendorTaxId: '1', documentDate: new Date('2026-06-10T00:00:00Z'), totalAmount: new Decimal('100'), withholdingTax: new Decimal('0'), branchId: 'b1' },
        // age 30 → 0-30 (boundary)
        { id: 'd30', number: 'EX-2', vendorName: 'A', vendorTaxId: '1', documentDate: new Date('2026-05-11T00:00:00Z'), totalAmount: new Decimal('200'), withholdingTax: new Decimal('0'), branchId: 'b1' },
        // age 31 → 31-60
        { id: 'd31', number: 'EX-3', vendorName: 'A', vendorTaxId: '1', documentDate: new Date('2026-05-10T00:00:00Z'), totalAmount: new Decimal('300'), withholdingTax: new Decimal('0'), branchId: 'b1' },
        // age 61 → 61-90
        { id: 'd61', number: 'EX-4', vendorName: 'A', vendorTaxId: '1', documentDate: new Date('2026-04-10T00:00:00Z'), totalAmount: new Decimal('400'), withholdingTax: new Decimal('0'), branchId: 'b1' },
        // age 91 → 90+
        { id: 'd91', number: 'EX-5', vendorName: 'A', vendorTaxId: '1', documentDate: new Date('2026-03-11T00:00:00Z'), totalAmount: new Decimal('500'), withholdingTax: new Decimal('0'), branchId: 'b1' },
      ];
      const { service } = makeWithRows(rows);

      const res = await service.getApAging({});

      // Literal bucket label strings — must remain 0-30/31-60/61-90/90+/TOTAL.
      expect(Object.keys(res.buckets)).toEqual(['0-30', '31-60', '61-90', '90+', 'TOTAL']);
      expect(res.buckets['0-30']).toEqual({ count: 2, amount: '300.00' });
      expect(res.buckets['31-60']).toEqual({ count: 1, amount: '300.00' });
      expect(res.buckets['61-90']).toEqual({ count: 1, amount: '400.00' });
      expect(res.buckets['90+']).toEqual({ count: 1, amount: '500.00' });
      expect(res.buckets.TOTAL).toEqual({ count: 5, amount: '1500.00' });

      // ageDays + per-doc bucket label
      const d31 = res.docs.find((d) => d.id === 'd31')!;
      expect(d31.ageDays).toBe(31);
      expect(d31.bucket).toBe('31-60');
    });

    it('per-doc netAmount = totalAmount − withholdingTax and bucket amounts use that net', async () => {
      const rows = [
        { id: 'd0', number: 'EX-1', vendorName: 'A', vendorTaxId: '1', documentDate: new Date('2026-06-10T00:00:00Z'), totalAmount: new Decimal('1000'), withholdingTax: new Decimal('30'), branchId: 'b1' },
      ];
      const { service } = makeWithRows(rows);

      const res = await service.getApAging({});

      expect(res.docs[0].netAmount).toBe('970.00');
      // Bucket amount uses the net (totalAmount − wht), not gross.
      expect(res.buckets['0-30'].amount).toBe('970.00');
      expect(res.buckets.TOTAL.amount).toBe('970.00');
    });

    it('bucket filter narrows docs but bucket TOTALS still use the full set', async () => {
      const rows = [
        { id: 'd0', number: 'EX-1', vendorName: 'A', vendorTaxId: '1', documentDate: new Date('2026-06-10T00:00:00Z'), totalAmount: new Decimal('100'), withholdingTax: new Decimal('0'), branchId: 'b1' },
        { id: 'd91', number: 'EX-5', vendorName: 'A', vendorTaxId: '1', documentDate: new Date('2026-03-11T00:00:00Z'), totalAmount: new Decimal('500'), withholdingTax: new Decimal('0'), branchId: 'b1' },
      ];
      const { service } = makeWithRows(rows);

      const res = await service.getApAging({ bucket: '90+' });

      // docs narrowed to the requested bucket only
      expect(res.docs.map((d) => d.id)).toEqual(['d91']);
      // but bucket TOTALS reflect the full unfiltered set
      expect(res.buckets['0-30']).toEqual({ count: 1, amount: '100.00' });
      expect(res.buckets['90+']).toEqual({ count: 1, amount: '500.00' });
      expect(res.buckets.TOTAL).toEqual({ count: 2, amount: '600.00' });
    });

    it('queries ACCRUAL + unpaid docs and applies vendor/branch filters', async () => {
      const prisma = {
        expenseDocument: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = makeExpenseDocumentsService({ prisma }).service;

      await service.getApAging({ branchId: 'b9', vendor: 'Acme' });

      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            status: 'ACCRUAL',
            paidAt: null,
            branchId: 'b9',
            vendorName: { contains: 'Acme', mode: 'insensitive' },
          },
          orderBy: { documentDate: 'asc' },
        }),
      );
    });
  });

  describe('getSummary', () => {
    it('returns byStatus map + accrualUnpaid count/total (toFixed(2))', async () => {
      const prisma = {
        expenseDocument: {
          count: jest.fn().mockResolvedValue(7),
          groupBy: jest.fn().mockResolvedValue([
            { status: 'DRAFT', _count: { _all: 3 } },
            { status: 'POSTED', _count: { _all: 4 } },
          ]),
          aggregate: jest.fn().mockResolvedValue({
            _count: { _all: 2 },
            _sum: { totalAmount: new Decimal('1234.5') },
          }),
        },
      };
      const service = makeExpenseDocumentsService({ prisma }).service;

      const res = await service.getSummary({});

      expect(res.totalCount).toBe(7);
      expect(res.byStatus).toEqual({ DRAFT: 3, POSTED: 4 });
      expect(res.accrualUnpaidCount).toBe(2);
      expect(res.accrualUnpaidTotal).toBe('1234.50');
    });

    it('defaults accrualUnpaidTotal to "0.00" when sum is null', async () => {
      const prisma = {
        expenseDocument: {
          count: jest.fn().mockResolvedValue(0),
          groupBy: jest.fn().mockResolvedValue([]),
          aggregate: jest.fn().mockResolvedValue({
            _count: { _all: 0 },
            _sum: { totalAmount: null },
          }),
        },
      };
      const service = makeExpenseDocumentsService({ prisma }).service;

      const res = await service.getSummary({});

      expect(res.byStatus).toEqual({});
      expect(res.accrualUnpaidTotal).toBe('0.00');
    });
  });

  describe('getCreditNoteCap', () => {
    it('cap = original.totalAmount − Σ(non-VOIDED CN)', async () => {
      const prisma = {
        expenseDocument: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'orig',
            documentType: 'EXPENSE',
            deletedAt: null,
            totalAmount: new Decimal('1000'),
          }),
          aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: new Decimal('300') } }),
        },
      };
      const service = makeExpenseDocumentsService({ prisma }).service;

      const res = await service.getCreditNoteCap('orig');

      expect(res.originalTotal).toBe('1000');
      expect(res.usedTotal).toBe('300');
      expect(res.remainingCap).toBe('700');
      // Confirms it sums only non-VOIDED CNs against this original.
      expect(prisma.expenseDocument.aggregate).toHaveBeenCalledWith({
        where: {
          documentType: 'CREDIT_NOTE',
          status: { not: 'VOIDED' },
          deletedAt: null,
          creditNote: { originalDocumentId: 'orig' },
        },
        _sum: { totalAmount: true },
      });
    });

    it('throws BadRequestException when original is not an EXPENSE', async () => {
      const prisma = {
        expenseDocument: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'orig',
            documentType: 'CREDIT_NOTE',
            deletedAt: null,
            totalAmount: new Decimal('1000'),
          }),
          aggregate: jest.fn(),
        },
      };
      const service = makeExpenseDocumentsService({ prisma }).service;

      await expect(service.getCreditNoteCap('orig')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when original is soft-deleted', async () => {
      const prisma = {
        expenseDocument: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'orig',
            documentType: 'EXPENSE',
            deletedAt: new Date(),
            totalAmount: new Decimal('1000'),
          }),
          aggregate: jest.fn(),
        },
      };
      const service = makeExpenseDocumentsService({ prisma }).service;

      await expect(service.getCreditNoteCap('orig')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getAuditTrail', () => {
    function baseFindOneMock(doc: any) {
      // findOne does two findUniqueOrThrow calls (docType then full doc).
      const findUniqueOrThrow = jest
        .fn()
        .mockResolvedValueOnce({ documentType: doc.documentType ?? 'EXPENSE', deletedAt: null })
        .mockResolvedValueOnce(doc);
      return findUniqueOrThrow;
    }

    it('calls findOne (doc existence) then queries the audit log (both casings, take 50, desc)', async () => {
      const doc = { id: 'doc-1', documentType: 'EXPENSE', deletedAt: null, branchId: 'b1', payroll: null };
      const prisma = {
        expenseDocument: { findUniqueOrThrow: baseFindOneMock(doc) },
        auditLog: { findMany: jest.fn().mockResolvedValue([{ id: 'log-1' }]) },
      };
      const service = makeExpenseDocumentsService({ prisma }).service;

      const res = await service.getAuditTrail('doc-1');

      expect(prisma.expenseDocument.findUniqueOrThrow).toHaveBeenCalled();
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          entityId: 'doc-1',
          entity: { in: ['expense_document', 'ExpenseDocument'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });
      expect(res).toEqual([{ id: 'log-1' }]);
    });

    it('throws ForbiddenException for a non-cross-branch role reading another branch', async () => {
      const doc = { id: 'doc-1', documentType: 'EXPENSE', deletedAt: null, branchId: 'b1', payroll: null };
      const prisma = {
        expenseDocument: { findUniqueOrThrow: baseFindOneMock(doc) },
        auditLog: { findMany: jest.fn() },
      };
      const service = makeExpenseDocumentsService({ prisma }).service;

      await expect(
        service.getAuditTrail('doc-1', { role: 'BRANCH_MANAGER', branchId: 'b2' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });
  });

  describe('previewJe', () => {
    it('queries chartOfAccount for collected codes and calls jePreview.preview with account-name map', async () => {
      const prisma = {
        chartOfAccount: {
          findMany: jest.fn().mockResolvedValue([
            { code: '53-1302', name: 'ค่าใช้จ่ายสำนักงาน' },
          ]),
        },
      };
      const jePreview = { preview: jest.fn().mockReturnValue({ lines: [] }) };
      const service = makeExpenseDocumentsService({ prisma, jePreview }).service;

      const dto = {
        branchId: 'b1',
        documentDate: '2026-06-10',
        vendorName: 'V',
        lines: [{ category: '53-1302', amountBeforeVat: 100, vatRate: 0, whtPercent: 0 }],
      } as any;

      const res = await service.previewJe(dto);

      // chartOfAccount.findMany queried with collected codes + deletedAt: null.
      const callArg = prisma.chartOfAccount.findMany.mock.calls[0][0];
      expect(callArg.where.deletedAt).toBeNull();
      expect(Array.isArray(callArg.where.code.in)).toBe(true);
      expect(callArg.where.code.in).toContain('53-1302');
      expect(callArg.select).toEqual({ code: true, name: true });

      // jePreview.preview called with (dto, Map of code→name).
      expect(jePreview.preview).toHaveBeenCalledTimes(1);
      const [passedDto, namesMap] = jePreview.preview.mock.calls[0];
      expect(passedDto).toBe(dto);
      expect(namesMap).toBeInstanceOf(Map);
      expect(namesMap.get('53-1302')).toBe('ค่าใช้จ่ายสำนักงาน');
      expect(res).toEqual({ lines: [] });
    });
  });

  describe('list (tab translation spot-check)', () => {
    function makeForList() {
      const prisma = {
        expenseDocument: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      };
      return { prisma, service: makeExpenseDocumentsService({ prisma }).service };
    }

    const cases: Array<[string, any]> = [
      ['draft', { status: 'DRAFT' }],
      ['unpaid', { status: 'ACCRUAL' }],
      ['recorded', { status: { in: ['ACCRUAL', 'POSTED'] } }],
      ['paid', { paidAt: { not: null } }],
    ];

    it.each(cases)('tab %s maps to the right where clause', async (tab, expected) => {
      const { prisma, service } = makeForList();
      await service.list({ tab } as any, { branchId: 'b1', role: 'BRANCH_MANAGER' });
      const where = prisma.expenseDocument.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject(expected);
    });

    it('default (no tab) excludes VOIDED', async () => {
      const { prisma, service } = makeForList();
      await service.list({} as any, { branchId: 'b1', role: 'BRANCH_MANAGER' });
      const where = prisma.expenseDocument.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ not: 'VOIDED' });
    });
  });
});
