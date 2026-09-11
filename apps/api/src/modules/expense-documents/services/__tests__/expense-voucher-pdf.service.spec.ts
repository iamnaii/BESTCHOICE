import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertVoucherBranchAccess, ExpenseVoucherPdfService } from '../expense-voucher-pdf.service';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Branch scope of GET /expense-documents/:id/voucher.pdf (DOC-03, issue #1562).
 * The scope check runs right after the document lookup, before CompanyInfo is
 * read or Chromium is launched — so the denial paths are unit-testable without
 * puppeteer.
 */
describe('assertVoucherBranchAccess', () => {
  const doc = { branchId: 'branch-a' };

  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('lets %s read any branch', (role) => {
    expect(() => assertVoucherBranchAccess(doc, { role, branchId: null })).not.toThrow();
    expect(() => assertVoucherBranchAccess(doc, { role, branchId: 'branch-b' })).not.toThrow();
  });

  it('lets a BRANCH_MANAGER read their own branch only', () => {
    expect(() => assertVoucherBranchAccess(doc, { role: 'BRANCH_MANAGER', branchId: 'branch-a' })).not.toThrow();
    expect(() => assertVoucherBranchAccess(doc, { role: 'BRANCH_MANAGER', branchId: 'branch-b' })).toThrow(ForbiddenException);
    expect(() => assertVoucherBranchAccess(doc, { role: 'BRANCH_MANAGER', branchId: 'branch-b' })).toThrow('สาขาอื่น');
  });

  it('refuses a branch-bound account that has no branch (fail-closed)', () => {
    expect(() => assertVoucherBranchAccess(doc, { role: 'BRANCH_MANAGER', branchId: null })).toThrow(ForbiddenException);
    expect(() => assertVoucherBranchAccess(doc, { role: 'SALES', branchId: undefined })).toThrow(ForbiddenException);
  });

  it('keeps the unscoped behaviour for internal callers that pass no viewer', () => {
    expect(() => assertVoucherBranchAccess(doc, undefined)).not.toThrow();
  });
});

describe('ExpenseVoucherPdfService.generate — scope before render', () => {
  const prisma = {
    expenseDocument: { findFirst: jest.fn() },
    companyInfo: { findFirst: jest.fn() },
  };
  const service = new ExpenseVoucherPdfService(prisma as unknown as PrismaService);
  const posted = { id: 'doc-1', status: 'POSTED', branchId: 'branch-a', expenseDetail: { lines: [] } };

  beforeEach(() => {
    prisma.expenseDocument.findFirst.mockReset();
    prisma.companyInfo.findFirst.mockReset();
  });

  it('answers 404 for an unknown or deleted document before any scope decision', async () => {
    prisma.expenseDocument.findFirst.mockResolvedValueOnce(null);
    await expect(service.generate('missing', { role: 'BRANCH_MANAGER', branchId: 'branch-b' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.expenseDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'missing', deletedAt: null } }));
  });

  it('refuses another branch’s BRANCH_MANAGER without reading company info or launching the renderer', async () => {
    prisma.expenseDocument.findFirst.mockResolvedValueOnce(posted);
    await expect(service.generate('doc-1', { role: 'BRANCH_MANAGER', branchId: 'branch-b' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.companyInfo.findFirst).not.toHaveBeenCalled();
  });
});
