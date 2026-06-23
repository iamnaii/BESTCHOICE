import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  makeExpenseDocumentsService,
  MadeExpenseDocumentsService,
} from './support/make-expense-documents-service';

/**
 * Phase 2b CHARACTERIZATION spec — pins the CURRENT behavior of the JE-posting
 * core (post / executePostBody / approve) THROUGH THE FACADE before that core
 * is moved VERBATIM into ExpenseDocumentLifecycleService. These tests must stay
 * green identically before AND after the move (the facade delegates to lifecycle
 * which holds the SAME template mocks via the factory).
 *
 * Gaps pinned here (not covered by the existing post/approve specs):
 *   1. post() routes a CREDIT_NOTE doc to creditNoteTemplate.execute(id, tx).
 *   2. post() of a PETTY_CASH_REIMBURSEMENT doc THROWS
 *      `type PETTY_CASH_REIMBURSEMENT not supported` and NEVER reaches
 *      pettyCashTemplate.execute — pins the allow-list quirk: PETTY_CASH is
 *      NOT in executePostBody's allow-list, so the later (unreachable)
 *      `if (doc.documentType === 'PETTY_CASH_REIMBURSEMENT')` branch is dead.
 *   3. approve() with auto_post_on_approve=true of a CREDIT_NOTE doc routes the
 *      auto-post chain to creditNoteTemplate.execute + writes AUTO_POSTED audit.
 *
 * Harness mirrors expense-documents.service.spec.ts: prisma.$transaction runs
 * the callback synchronously against the same prisma mock; advisory locks,
 * companyInfo (SHOP), accountingPeriod (OPEN), systemConfig, auditLog all
 * stubbed so the posting body flows to the JE-template dispatch unobstructed.
 */
describe('ExpenseDocuments posting core (Phase 2b characterization)', () => {
  let made: MadeExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(() => {
    prisma = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      expenseDocument: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      expenseDetail: {
        findUnique: jest.fn().mockResolvedValue({ lines: [] }),
      },
      // C10 attachment-threshold check reads ATTACHMENT_REQUIRED_ABOVE_AMOUNT.
      // Default null → threshold defaults to 0 → never enforced.
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
        // approval_enabled / auto_post_on_approve etc. → null = defaults
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // post/approve resolve SHOP companyId for the validatePeriodOpen call.
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'shop-co-id' }),
      },
      // validatePeriodOpen reads accountingPeriod — null = OPEN.
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    made = makeExpenseDocumentsService({
      prisma,
      transition: {
        // assertCanPost / assertCanApprove no-op so the posting body runs.
        assertCanPost: jest.fn(),
        assertCanApprove: jest.fn(),
        assertCanVoid: jest.fn(),
        assertCanEdit: jest.fn(),
        resolveTargetStatus: jest.fn().mockReturnValue('POSTED'),
      },
      creditNoteTemplate: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-CN' }) },
      pettyCashTemplate: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-PC' }) },
      sameDayTemplate: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-SD' }) },
      accrualTemplate: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-AC' }) },
      payrollTemplate: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-PR' }) },
      settlementTemplate: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-SE' }) },
      shopExpenseTemplate: {
        execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1', journalEntryId: 'je-1' }),
      },
    });
  });

  // GAP #1 — CREDIT_NOTE is in the allow-list + has a reachable branch.
  it('post() routes a CREDIT_NOTE doc to creditNoteTemplate.execute(id, tx)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'cn-1',
      status: 'DRAFT',
      documentType: 'CREDIT_NOTE',
      paymentMethod: null,
      depositAccountCode: null,
      totalAmount: new Decimal('500.00'),
      withholdingTax: new Decimal('0'),
      whtFormType: null,
      receiptImageUrl: null,
      documentDate: new Date('2026-05-10'),
      deletedAt: null,
    });

    await made.service.post('cn-1', 'user-1');

    expect(made.creditNoteTemplate.execute).toHaveBeenCalledWith('cn-1', expect.anything());
    // Routed via the CREDIT_NOTE branch — NOT the generic same-day/accrual path.
    expect(made.sameDayTemplate.execute).not.toHaveBeenCalled();
    expect(made.accrualTemplate.execute).not.toHaveBeenCalled();
  });

  // GAP #2 + #5 — PETTY_CASH allow-list quirk: NOT in the allow-list, so
  // executePostBody throws `type ... not supported` BEFORE the (dead) petty-cash
  // branch is ever reached. Pin the THROW; pettyCashTemplate must NOT run.
  it('post() of a PETTY_CASH_REIMBURSEMENT doc THROWS not-supported and never calls pettyCashTemplate', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'pc-1',
      status: 'DRAFT',
      documentType: 'PETTY_CASH_REIMBURSEMENT',
      paymentMethod: null,
      depositAccountCode: null,
      totalAmount: new Decimal('500.00'),
      withholdingTax: new Decimal('0'),
      whtFormType: null,
      receiptImageUrl: null,
      documentDate: new Date('2026-05-10'),
      deletedAt: null,
    });

    await expect(made.service.post('pc-1', 'user-1')).rejects.toThrow(BadRequestException);
    await expect(made.service.post('pc-1', 'user-1')).rejects.toThrow(
      'type PETTY_CASH_REIMBURSEMENT not supported',
    );
    expect(made.pettyCashTemplate.execute).not.toHaveBeenCalled();
  });

  // REPAIR_SERVICE → ShopExpense (ACCRUAL mode, Cr S21-1103)
  it('routes a REPAIR_SERVICE doc to ShopExpenseTemplate (ACCRUAL → Cr S21-1103), not accrualTemplate', async () => {
    // First call: post() loads the base doc for assertCanPost
    prisma.expenseDocument.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'doc-1',
        status: 'DRAFT',
        documentType: 'REPAIR_SERVICE',
        paymentMethod: null,
        depositAccountCode: null,
        totalAmount: new Decimal('800.00'),
        withholdingTax: new Decimal('0'),
        whtFormType: null,
        receiptImageUrl: null,
        documentDate: new Date('2026-05-10'),
        journalEntryId: null,
        deletedAt: null,
      })
      // Second call: REPAIR_SERVICE branch loads full doc with lines + branch
      .mockResolvedValueOnce({
        id: 'doc-1',
        status: 'DRAFT',
        documentType: 'REPAIR_SERVICE',
        paymentMethod: null,
        depositAccountCode: null,
        totalAmount: new Decimal('800.00'),
        withholdingTax: new Decimal('0'),
        whtFormType: null,
        receiptImageUrl: null,
        documentDate: new Date('2026-05-10'),
        journalEntryId: null,
        deletedAt: null,
        expenseDetail: {
          lines: [
            { lineNo: 1, category: 'S51-1105', amountBeforeVat: new Decimal('800') },
          ],
        },
        branch: { name: 'สาขากลาง', shopCashAccountCode: 'S11-1101' },
      });

    await made.service.post('doc-1', 'user-1');

    expect(made.shopExpenseTemplate.execute).toHaveBeenCalledTimes(1);
    const input = made.shopExpenseTemplate.execute.mock.calls[0][0];
    expect(input).toMatchObject({
      idempotencyKey: 'shop-expense:doc-1',
      expenseId: 'doc-1',
      expenseAccountCode: 'S51-1105',
      mode: 'ACCRUAL',
    });
    expect(input.amount.toString()).toBe('800');
    expect(input.cashAccountCode).toBeUndefined();
    expect(made.accrualTemplate.execute).not.toHaveBeenCalled();
    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACCRUAL', journalEntryId: 'je-1' }),
      }),
    );
  });

  // Non-REPAIR EXPENSE doc still routes to accrualTemplate (regression guard)
  it('still routes a non-REPAIR EXPENSE doc to the accrual template (no paymentMethod → ACCRUAL)', async () => {
    made.transition.resolveTargetStatus.mockReturnValue('ACCRUAL');
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-2',
      status: 'DRAFT',
      documentType: 'EXPENSE',
      paymentMethod: null,
      depositAccountCode: null,
      totalAmount: new Decimal('500.00'),
      withholdingTax: new Decimal('0'),
      whtFormType: null,
      receiptImageUrl: null,
      documentDate: new Date('2026-05-10'),
      journalEntryId: null,
      deletedAt: null,
    });

    await made.service.post('doc-2', 'user-1');

    expect(made.accrualTemplate.execute).toHaveBeenCalledWith('doc-2', expect.anything());
    expect(made.shopExpenseTemplate.execute).not.toHaveBeenCalled();
  });

  // GAP #3 — approve() auto-post chain on a CREDIT_NOTE doc routes to
  // creditNoteTemplate.execute and writes the AUTO_POSTED audit log.
  it('approve() auto-post (auto_post_on_approve=true) of a CREDIT_NOTE routes to creditNoteTemplate + writes AUTO_POSTED audit', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'cn-app',
      status: 'PENDING_APPROVAL',
      documentType: 'CREDIT_NOTE',
      paymentMethod: null,
      depositAccountCode: null,
      totalAmount: new Decimal('500.00'),
      withholdingTax: new Decimal('0'),
      whtFormType: null,
      receiptImageUrl: null,
      documentDate: new Date('2026-05-10'),
      deletedAt: null,
    });
    // systemConfig.findFirst defaults to null → auto_post_on_approve defaults true.

    await made.service.approve('cn-app', 'user-1', 'OWNER');

    // Auto-post chain routed to the CREDIT_NOTE template.
    expect(made.creditNoteTemplate.execute).toHaveBeenCalledWith('cn-app', expect.anything());

    // Both APPROVED + AUTO_POSTED audit logs written in the same tx.
    const actions = prisma.auditLog.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { data?: { action?: string } })?.data?.action,
    );
    expect(actions).toContain('APPROVED');
    expect(actions).toContain('AUTO_POSTED');
  });
});
