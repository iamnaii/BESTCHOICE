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
  // D1.2.1.5 — NotificationsService mock (used by submitForApproval)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;

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
      // C10 attachment-threshold check reads ATTACHMENT_REQUIRED_ABOVE_AMOUNT.
      // D1.2.7.4 — voidDocument now also reads `reverse_block_cascaded` via findFirst.
      // D1.2.7.1 — voidDocument also reads `reverse_reason_required` (default true);
      // existing tests that don't pass a reasonCode would fail under the new gate,
      // so global mock disables this flag — individual tests override to assert on.
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockImplementation((args: { where: { key: string } }) => {
          if (args.where.key === 'reverse_reason_required') {
            return Promise.resolve({ value: 'false' });
          }
          return Promise.resolve(null);
        }),
      },
      // C9 Round 2 — post/voidDocument resolve SHOP companyId for the
      // module-level validatePeriodOpen call (mirroring expense templates).
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'shop-co-id' }),
      },
      // C9 Round 2 — validatePeriodOpen reads accountingPeriod by
      // (companyId, year, month). Default = no row (= OPEN), so post() passes.
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      // C3 — voidDocument writes an audit entry with reason metadata.
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      // D1.2.1.5 — notifyApprovers() resolves recipients via User.findMany.
      // Default empty → fallback path tries OWNER (also empty here) → no-op.
      user: {
        findMany: jest.fn().mockResolvedValue([]),
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
    notifications = { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) };
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
      { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never,
      { getConfig: jest.fn(), validate: jest.fn() } as never,
      { loadWhitelist: jest.fn().mockResolvedValue(new Set(['53-1104', '53-1105'])), validateLine: jest.fn().mockResolvedValue({ taxableBase: new Decimal(0) }) } as never,
      notifications,
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

    // W1 — adjustment row accountCode must be on the allow-list (52-1104,
    // 52-1106, 53-1303, 53-1503). Without this, an accountant could pick
    // Revenue or Cash as the offset, balancing the JE but causing drift.
    it('W1: rejects adjustment accountCode outside the allow-list (e.g. 41-1101 Revenue)', async () => {
      // CoA mock returns the rev code so the existence check passes,
      // forcing the allow-list check to be the gate.
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { code: '53-1302', type: 'ค่าใช้จ่าย' },
        { code: '41-1101', type: 'รายได้' },
      ]);
      await expect(
        service.create(
          {
            documentType: 'EXPENSE',
            branchId: 'branch-1',
            documentDate: '2026-05-10',
            priceType: 'EXCLUSIVE',
            lines: [
              { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0 },
            ],
            amountPaid: '999',
            adjustments: [{ accountCode: '41-1101', side: 'CR', amount: '1' }],
          } as never,
          'user-1',
        ),
      ).rejects.toThrow(/ไม่อยู่ในรายการที่อนุญาต/);
    });

    it('W1: accepts adjustment accountCode 52-1104 (rounding tolerance allow-list)', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { code: '53-1302', type: 'ค่าใช้จ่าย' },
        { code: '52-1104', type: 'ค่าใช้จ่าย' },
      ]);
      await expect(
        service.create(
          {
            documentType: 'EXPENSE',
            branchId: 'branch-1',
            documentDate: '2026-05-10',
            priceType: 'EXCLUSIVE',
            lines: [
              { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0 },
            ],
            amountPaid: '999',
            adjustments: [{ accountCode: '52-1104', side: 'DR', amount: '1' }],
          } as never,
          'user-1',
        ),
      ).resolves.toBeDefined();
    });

    // B3 / K-05 — V12 happy path with diff=0 (omit amountPaid + no adjustments).
    // Documents that the no-adjustment legacy path still works after the V12
    // refactor in B2 (validateAdjustments helper extraction).
    it('B3 / K-05 (V12 fast path): create with no adjustments + no amountPaid → POSTs successfully', async () => {
      await expect(
        service.create(
          {
            documentType: 'EXPENSE',
            branchId: 'branch-1',
            documentDate: '2026-05-10',
            priceType: 'EXCLUSIVE',
            lines: [
              { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0 },
            ],
            // no amountPaid → defaults to netExpected; no adjustments → fast path
          } as never,
          'user-1',
        ),
      ).resolves.toBeDefined();
    });

    // B3 / K-08 — Direction routing: signed-sum rule lets either side route.
    // `side: 'CR'` on 53-1503 closes a positive diff (overpay, +1) — would mis-
    // route to 52-1104 if direction was hard-coded to one side. This test
    // proves the validator accepts the correct CR-direction routing.
    it('B3 / K-08 (direction overpay): diff > 0 → side=CR on 53-1503 reconciles', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { code: '53-1302', type: 'ค่าใช้จ่าย' },
        { code: '53-1503', type: 'รายได้' },
      ]);
      await expect(
        service.create(
          {
            documentType: 'EXPENSE',
            branchId: 'branch-1',
            documentDate: '2026-05-10',
            priceType: 'EXCLUSIVE',
            lines: [
              { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0 },
            ],
            amountPaid: '1001',   // overpay by 1 (diff = +1)
            adjustments: [{ accountCode: '53-1503', side: 'CR', amount: '1' }],
          } as never,
          'user-1',
        ),
      ).resolves.toBeDefined();
    });

    // B3 / K-08 (direction underpay): diff < 0 → side=DR on 52-1104 reconciles.
    // Confirms the symmetrical direction works; rejects if the side is wrong.
    it('B3 / K-08 (direction underpay): wrong side rejects via V12', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { code: '53-1302', type: 'ค่าใช้จ่าย' },
        { code: '52-1104', type: 'ค่าใช้จ่าย' },
      ]);
      await expect(
        service.create(
          {
            documentType: 'EXPENSE',
            branchId: 'branch-1',
            documentDate: '2026-05-10',
            priceType: 'EXCLUSIVE',
            lines: [
              { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0 },
            ],
            amountPaid: '999',    // underpay by 1 (diff = −1)
            // Wrong side: CR contributes +1, but diff needs −1
            adjustments: [{ accountCode: '52-1104', side: 'CR', amount: '1' }],
          } as never,
          'user-1',
        ),
      ).rejects.toThrow(/V12/);
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

    // B3 / K-02 — V15: ACCRUAL ห้ามมี WHT (มาตรา 50 ป.รัษฎากร).
    // WHT arises at payment, not accrual. ACCRUAL EXs cannot carry WHT — must
    // throw before reaching the AccrualTemplate. Fix Report P0-2.
    // `whtFormType: 'PND53'` is needed to bypass the doc-level form-type guard
    // (which fires first at expense-documents.service.ts:1329); V15 is the
    // intended check for this scenario.
    it('B3 / K-02 (V15): rejects post on ACCRUAL doc with withholdingTax > 0', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-v15',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        paymentMethod: null,         // → ACCRUAL path
        depositAccountCode: null,
        totalAmount: new Decimal('1000.00'),
        withholdingTax: new Decimal('30.00'),
        whtFormType: 'PND53',
      });
      transition.resolveTargetStatus.mockReturnValue('ACCRUAL');
      await expect(service.post('doc-v15', 'user-1')).rejects.toThrow(/V15|มาตรา 50/);
      expect(accrual.execute).not.toHaveBeenCalled();
    });

    // B3 / K-02 control — ACCRUAL with WHT = 0 should pass V15 + reach AccrualTemplate.
    it('B3 / K-02 control: ACCRUAL with WHT = 0 reaches AccrualTemplate', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-v15-ok',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        paymentMethod: null,
        depositAccountCode: null,
        totalAmount: new Decimal('1000.00'),
        withholdingTax: new Decimal('0'),
      });
      transition.resolveTargetStatus.mockReturnValue('ACCRUAL');
      await service.post('doc-v15-ok', 'user-1');
      expect(accrual.execute).toHaveBeenCalledWith('doc-v15-ok', expect.anything());
    });

    // Fix #C10 — attachment threshold server-enforced
    it('Fix #C10: rejects post when totalAmount ≥ threshold and no receiptImageUrl', async () => {
      // Key-aware mock — period-lock util reads `accounting_period_closed_until`
      // from the same table; treat that key as missing (period OPEN) so the
      // C10 attachment-threshold test doesn't accidentally fail on a phantom
      // period lock.
      prisma.systemConfig.findUnique.mockImplementation((args: { where: { key: string } }) =>
        args.where.key === 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT'
          ? { key: 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT', value: '50000' }
          : null,
      );
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
      // Key-aware mock — period-lock util reads `accounting_period_closed_until`
      // from the same table; treat that key as missing (period OPEN) so the
      // C10 attachment-threshold test doesn't accidentally fail on a phantom
      // period lock.
      prisma.systemConfig.findUnique.mockImplementation((args: { where: { key: string } }) =>
        args.where.key === 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT'
          ? { key: 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT', value: '50000' }
          : null,
      );
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
      // Key-aware mock — period-lock util reads `accounting_period_closed_until`
      // from the same table; treat that key as missing (period OPEN) so the
      // C10 attachment-threshold test doesn't accidentally fail on a phantom
      // period lock.
      prisma.systemConfig.findUnique.mockImplementation((args: { where: { key: string } }) =>
        args.where.key === 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT'
          ? { key: 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT', value: '50000' }
          : null,
      );
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

    // C12-symmetry — extend service-level guard to SE / CN / PAYROLL
    it('C12-symmetry: rejects post on VENDOR_SETTLEMENT when wht > 0 and whtFormType null', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-se-c12', status: 'DRAFT', documentType: 'VENDOR_SETTLEMENT',
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        totalAmount: new Decimal('5000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('100.00'),
        whtFormType: null,
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-se-c12', 'user-1')).rejects.toThrow(
        /whtFormType ต้องระบุ/,
      );
      expect(settlement.execute).not.toHaveBeenCalled();
    });

    it('C12-symmetry: allows post on VENDOR_SETTLEMENT when wht > 0 and whtFormType=PND53', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-se-c12b', status: 'DRAFT', documentType: 'VENDOR_SETTLEMENT',
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        totalAmount: new Decimal('5000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('100.00'),
        whtFormType: 'PND53',
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-se-c12b', 'user-1')).resolves.toBeDefined();
      expect(settlement.execute).toHaveBeenCalled();
    });

    it('C12-symmetry: rejects post on VENDOR_SETTLEMENT when whtFormType is unknown string', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-se-c12c', status: 'DRAFT', documentType: 'VENDOR_SETTLEMENT',
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        totalAmount: new Decimal('5000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('100.00'),
        whtFormType: 'PND91',
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-se-c12c', 'user-1')).rejects.toThrow(
        /whtFormType ต้องเป็น PND3 หรือ PND53/,
      );
    });

    it('C12-symmetry: allows PAYROLL post with wht > 0 (whtFormType not required — always 21-3101)', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-pr-c12', status: 'DRAFT', documentType: 'PAYROLL',
        depositAccountCode: '11-1101',
        totalAmount: new Decimal('30000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('500.00'),
        whtFormType: null, // payroll WHT always ภ.ง.ด.1 → 21-3101
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-pr-c12', 'user-1')).resolves.toBeDefined();
      expect(payroll.execute).toHaveBeenCalled();
    });

    // Fix #C9 Round 2 — period guard moved from journal-auto.createAndPost
    // to the expense module's service entry point. Expense post in a CLOSED
    // FINANCE/SHOP period must still reject; payment receipt JEs (which
    // share createAndPost) must NOT be affected by this guard (see
    // journal-auto.service.spec.ts for the converse: createAndPost itself
    // no longer checks period).
    it('Fix #C9 Round 2: rejects post when SHOP AccountingPeriod for documentDate is CLOSED', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-c9-1',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        documentDate: new Date('2026-03-15'), // period closed
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
        totalAmount: new Decimal('1000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('0'),
        whtFormType: null,
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-c9-1', 'user-1')).rejects.toThrow(/ปิดแล้ว/);
      expect(sameDay.execute).not.toHaveBeenCalled();
      // Verify the period check ran with SHOP companyId + the doc's date
      expect(prisma.companyInfo.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyCode: 'SHOP' }),
        }),
      );
    });

    it('Fix #C9 Round 2: rejects post when SHOP AccountingPeriod is SYNCED', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'SYNCED' });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-c9-2',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        documentDate: new Date('2026-03-15'),
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
        totalAmount: new Decimal('1000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('0'),
        whtFormType: null,
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-c9-2', 'user-1')).rejects.toThrow(/ปิดแล้ว/);
    });

    it('Fix #C9 Round 2: throws NotFoundException when SHOP CompanyInfo is missing', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue(null);
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-c9-3',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        documentDate: new Date('2026-05-10'),
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
        totalAmount: new Decimal('1000.00'),
        receiptImageUrl: null,
        withholdingTax: new Decimal('0'),
        whtFormType: null,
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await expect(service.post('doc-c9-3', 'user-1')).rejects.toThrow(NotFoundException);
      await expect(service.post('doc-c9-3', 'user-1')).rejects.toThrow(
        /CompanyInfo with companyCode=SHOP/,
      );
    });
  });

  // D1.2.1.5 — notification_on_pending fan-out
  describe('submitForApproval + notifyApprovers (D1.2.1.5)', () => {
    function setupDraftDoc() {
      const docFields = {
        id: 'doc-sub-n',
        number: 'EX-20260510-0001',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        totalAmount: new Decimal('500.00'),
        deletedAt: null,
      };
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue(docFields);
      // update() in the global mock returns a stub w/o totalAmount → set it
      // explicitly so submitForApproval's notifyApprovers() can read it.
      prisma.expenseDocument.update.mockResolvedValue({
        ...docFields,
        status: 'PENDING_APPROVAL',
      });
    }

    it('flips DRAFT -> PENDING_APPROVAL and notifies approvers when flag is on (default)', async () => {
      setupDraftDoc();
      prisma.systemConfig.findFirst.mockImplementation(
        (args: { where: { key: string } }) => {
          if (args.where.key === 'approvers_list') {
            return Promise.resolve({ value: JSON.stringify(['user-app-1', 'user-app-2']) });
          }
          // notification_on_pending defaults to true (no row)
          return Promise.resolve(null);
        },
      );
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-app-1', email: 'app1@ex.com', name: 'Approver 1' },
        { id: 'user-app-2', email: 'app2@ex.com', name: 'Approver 2' },
      ]);
      await service.submitForApproval('doc-sub-n', 'user-1');
      const updateCalls = prisma.expenseDocument.update.mock.calls;
      expect(
        updateCalls.some((c: unknown[]) => {
          const arg = c[0] as { data?: { status?: string } };
          return arg?.data?.status === 'PENDING_APPROVAL';
        }),
      ).toBe(true);
      // Fan-out: two recipients => two notifications.send() calls
      expect(notifications.send).toHaveBeenCalledTimes(2);
      const firstCall = notifications.send.mock.calls[0][0];
      expect(firstCall.channel).toBe('IN_APP');
      expect(firstCall.subject).toContain('EX-20260510-0001');
      expect(firstCall.relatedId).toBe('doc-sub-n');
    });

    it('does NOT fan out when notification_on_pending = false', async () => {
      setupDraftDoc();
      prisma.systemConfig.findFirst.mockImplementation(
        (args: { where: { key: string } }) => {
          if (args.where.key === 'notification_on_pending') return Promise.resolve({ value: 'false' });
          if (args.where.key === 'approvers_list') {
            return Promise.resolve({ value: JSON.stringify(['user-app-1']) });
          }
          return Promise.resolve(null);
        },
      );
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-app-1', email: 'app1@ex.com', name: 'A1' },
      ]);
      await service.submitForApproval('doc-sub-n', 'user-1');
      expect(notifications.send).not.toHaveBeenCalled();
    });

    it('falls back to OWNERs when approvers_list is empty', async () => {
      setupDraftDoc();
      // approvers_list missing → empty list → notifyApprovers tries OWNERs
      prisma.systemConfig.findFirst.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([
        { id: 'owner-1', email: 'owner@bc.com', name: 'Owner' },
      ]);
      await service.submitForApproval('doc-sub-n', 'user-1');
      expect(notifications.send).toHaveBeenCalledTimes(1);
      expect(notifications.send.mock.calls[0][0].recipient).toBe('owner@bc.com');
    });

    it('notification failures do NOT block the status transition', async () => {
      setupDraftDoc();
      prisma.systemConfig.findFirst.mockImplementation(
        (args: { where: { key: string } }) => {
          if (args.where.key === 'approvers_list') {
            return Promise.resolve({ value: JSON.stringify(['user-app-1']) });
          }
          return Promise.resolve(null);
        },
      );
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-app-1', email: 'app1@ex.com', name: 'A1' },
      ]);
      // Notification call throws — submitForApproval must still resolve
      notifications.send.mockRejectedValueOnce(new Error('LINE down'));
      await expect(service.submitForApproval('doc-sub-n', 'user-1')).resolves.toBeDefined();
      // Status was still flipped (Promise.allSettled inside notifyApprovers
      // ensures one delivery failure doesn't abort the operation).
      const updateCalls = prisma.expenseDocument.update.mock.calls;
      expect(
        updateCalls.some((c: unknown[]) => {
          const arg = c[0] as { data?: { status?: string } };
          return arg?.data?.status === 'PENDING_APPROVAL';
        }),
      ).toBe(true);
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
        { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
        { execute: jest.fn() } as never,
        { getConfig: jest.fn(), validate: jest.fn() } as never,
        { loadWhitelist: jest.fn().mockResolvedValue(new Set(['53-1104', '53-1105'])), validateLine: jest.fn().mockResolvedValue({ taxableBase: new Decimal(0) }) } as never,
        { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) } as never,
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
        { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
        { execute: jest.fn() } as never,
        { getConfig: jest.fn(), validate: jest.fn() } as never,
        { loadWhitelist: jest.fn().mockResolvedValue(new Set(['53-1104', '53-1105'])), validateLine: jest.fn().mockResolvedValue({ taxableBase: new Decimal(0) }) } as never,
        { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) } as never,
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

    // B3 / C3 — Cascade check + audit + reverseDate (C3.1, C3.3, C3.4)
    it('C3.4: rejects void when an active SETTLEMENT references this doc', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'ACCRUAL', journalEntryId: 'je-1', documentType: 'EXPENSE',
      });
      // First count() call = pending CN → 0
      // Second count() call = pending SE → 1 (this is our cascade hit)
      prisma.expenseDocument.count = jest
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);
      await expect(service.voidDocument('doc-1', 'user-1')).rejects.toThrow(
        /SE.*ยกเลิก|ยกเลิก SE/,
      );
    });

    // D1.2.7.4 — cascade block toggle
    it('D1.2.7.4: OWNER can disable cascade block via SystemConfig — void proceeds even with pending CN/SE', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_block_cascaded') return Promise.resolve({ value: 'false' });
        if (args.where.key === 'reverse_reason_required') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'ACCRUAL', journalEntryId: 'je-orig', documentType: 'EXPENSE', number: 'EX-001',
      });
      // CN cascade hit and SE cascade hit — both should be IGNORED when flag is off
      prisma.expenseDocument.count = jest
        .fn()
        .mockResolvedValueOnce(3) // pending CN > 0
        .mockResolvedValueOnce(2); // pending SE > 0
      prisma.journalEntry = {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'je-orig', entryNumber: 'JE-OLD',
          lines: [{ accountCode: '53-1404', debit: '100', credit: '0', description: 'x' }],
          metadata: {},
        }),
      };
      const journalMock = {
        createAndPost: jest.fn().mockResolvedValue({ id: 'je-rev', entryNumber: 'JE-REV-001' }),
      };
      const svc = new ExpenseDocumentsService(
        prisma, docNumber, transition, sameDay, accrual, creditNote, payroll, settlement,
        journalMock as never,
        new LineAggregatorService(),
        { preview: jest.fn() } as never,
        { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
        { execute: jest.fn() } as never,
        { getConfig: jest.fn(), validate: jest.fn() } as never,
        { loadWhitelist: jest.fn().mockResolvedValue(new Set()), validateLine: jest.fn() } as never,
        { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) } as never,
      );
      // Should NOT throw — both cascade checks are bypassed
      await expect(svc.voidDocument('doc-1', 'user-1')).resolves.toBeDefined();
    });

    it('D1.2.7.4: default behavior unchanged when SystemConfig key absent (flag = true)', async () => {
      // No SystemConfig override → cascade block enforced (= existing C3.4 behavior).
      // Pass reasonCode so the test fails specifically on cascade, not reason-required.
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'ACCRUAL', journalEntryId: 'je-1', documentType: 'EXPENSE',
      });
      prisma.expenseDocument.count = jest.fn().mockResolvedValue(1); // pending CN
      await expect(
        service.voidDocument('doc-1', 'user-1', { reasonCode: 'data_entry_error' }),
      ).rejects.toThrow(/ใบลดหนี้/);
    });

    // D1.2.7.1 — reason_required toggle
    it('D1.2.7.1: rejects void when no reasonCode and flag is on (default)', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'ACCRUAL', journalEntryId: 'je-1', documentType: 'EXPENSE',
      });
      prisma.expenseDocument.count = jest.fn().mockResolvedValue(0);
      await expect(service.voidDocument('doc-1', 'user-1')).rejects.toThrow(/เหตุผล/);
    });

    // D1.2.7.2 — DB-driven reasons whitelist
    it('D1.2.7.2: rejects void when reasonCode is not in configured whitelist', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_reasons') {
          return Promise.resolve({
            value: JSON.stringify([{ code: 'manager_decision', label: 'x' }]),
          });
        }
        // reverse_reason_required defaults to true so we leave it alone
        if (args.where.key === 'reverse_reason_required') return Promise.resolve(null);
        return Promise.resolve(null);
      });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'ACCRUAL', journalEntryId: 'je-1', documentType: 'EXPENSE',
      });
      prisma.expenseDocument.count = jest.fn().mockResolvedValue(0);
      await expect(
        service.voidDocument('doc-1', 'user-1', { reasonCode: 'data_entry_error' }),
      ).rejects.toThrow(/ไม่อยู่ในรายการ/);
    });

    it('D1.2.7.2: accepts custom reasonCode when in configured whitelist', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_reasons') {
          return Promise.resolve({
            value: JSON.stringify([{ code: 'manager_decision', label: 'x' }]),
          });
        }
        return Promise.resolve(null);
      });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'ACCRUAL', journalEntryId: 'je-orig', documentType: 'EXPENSE', number: 'EX-001',
      });
      prisma.expenseDocument.count = jest.fn().mockResolvedValue(0);
      prisma.journalEntry = {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'je-orig', entryNumber: 'JE-OLD',
          lines: [{ accountCode: '53-1404', debit: '100', credit: '0', description: 'x' }],
          metadata: {},
        }),
      };
      const journalMock = {
        createAndPost: jest.fn().mockResolvedValue({ id: 'je-rev', entryNumber: 'JE-REV-001' }),
      };
      const svc = new ExpenseDocumentsService(
        prisma, docNumber, transition, sameDay, accrual, creditNote, payroll, settlement,
        journalMock as never,
        new LineAggregatorService(),
        { preview: jest.fn() } as never,
        { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
        { execute: jest.fn() } as never,
        { getConfig: jest.fn(), validate: jest.fn() } as never,
        { loadWhitelist: jest.fn().mockResolvedValue(new Set()), validateLine: jest.fn() } as never,
        { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) } as never,
      );
      await expect(
        svc.voidDocument('doc-1', 'user-1', { reasonCode: 'manager_decision' }),
      ).resolves.toBeDefined();
    });

    // D1.2.6.4 — future-date reverseDate block
    it('D1.2.6.4: rejects future-dated reverseDate when flag is off', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'payment_date_allow_future') return Promise.resolve({ value: 'false' });
        if (args.where.key === 'reverse_reason_required') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'ACCRUAL', journalEntryId: 'je-1', documentType: 'EXPENSE',
      });
      prisma.expenseDocument.count = jest.fn().mockResolvedValue(0);
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await expect(
        service.voidDocument('doc-1', 'user-1', { reverseDate: future }),
      ).rejects.toThrow(/อนาคต/);
    });

    it('D1.2.6.4: allows future-dated reverseDate when flag is on (default)', async () => {
      // Global mock has `reverse_reason_required: false`. No other overrides → flag defaults true.
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'ACCRUAL', journalEntryId: 'je-orig', documentType: 'EXPENSE', number: 'EX-001',
      });
      prisma.expenseDocument.count = jest.fn().mockResolvedValue(0);
      prisma.journalEntry = {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'je-orig', entryNumber: 'JE-OLD',
          lines: [{ accountCode: '53-1404', debit: '100', credit: '0', description: 'x' }],
          metadata: {},
        }),
      };
      const journalMock = {
        createAndPost: jest.fn().mockResolvedValue({ id: 'je-rev', entryNumber: 'JE-REV-001' }),
      };
      const svc = new ExpenseDocumentsService(
        prisma, docNumber, transition, sameDay, accrual, creditNote, payroll, settlement,
        journalMock as never,
        new LineAggregatorService(),
        { preview: jest.fn() } as never,
        { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
        { execute: jest.fn() } as never,
        { getConfig: jest.fn(), validate: jest.fn() } as never,
        { loadWhitelist: jest.fn().mockResolvedValue(new Set()), validateLine: jest.fn() } as never,
        { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) } as never,
      );
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await expect(
        svc.voidDocument('doc-1', 'user-1', { reverseDate: future }),
      ).resolves.toBeDefined();
    });

    it('D1.2.7.1: allows void without reasonCode when flag is off', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_reason_required') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'ACCRUAL', journalEntryId: 'je-orig', documentType: 'EXPENSE', number: 'EX-001',
      });
      prisma.expenseDocument.count = jest.fn().mockResolvedValue(0);
      prisma.journalEntry = {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'je-orig', entryNumber: 'JE-OLD',
          lines: [{ accountCode: '53-1404', debit: '100', credit: '0', description: 'x' }],
          metadata: {},
        }),
      };
      const journalMock = {
        createAndPost: jest.fn().mockResolvedValue({ id: 'je-rev', entryNumber: 'JE-REV-001' }),
      };
      const svc = new ExpenseDocumentsService(
        prisma, docNumber, transition, sameDay, accrual, creditNote, payroll, settlement,
        journalMock as never,
        new LineAggregatorService(),
        { preview: jest.fn() } as never,
        { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
        { execute: jest.fn() } as never,
        { getConfig: jest.fn(), validate: jest.fn() } as never,
        { loadWhitelist: jest.fn().mockResolvedValue(new Set()), validateLine: jest.fn() } as never,
        { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) } as never,
      );
      await expect(svc.voidDocument('doc-1', 'user-1')).resolves.toBeDefined();
    });

    it('C3.3: writes audit log with reasonCode + reasonDetail + reverseJournalEntryId', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1',
        status: 'POSTED',
        journalEntryId: 'je-original',
        documentType: 'EXPENSE',
        number: 'EX-001',
      });
      // Mock journal-auto returning a reversal JE id
      const journalMock = {
        createAndPost: jest.fn().mockResolvedValue({ id: 'je-reverse-1', entryNumber: 'JE-202605-X' }),
      };
      // Need to grab the spec's `original` JE mock — earlier test pattern uses
      // tx.journalEntry.findUniqueOrThrow. Stitch it in.
      prisma.journalEntry = {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'je-original',
          companyId: 'shop-co-id',
          lines: [
            { accountCode: '53-1101', debit: '100.00', credit: '0', description: 'salary' },
            { accountCode: '11-1101', debit: '0', credit: '100.00', description: 'cash' },
          ],
        }),
      };
      const svc = new ExpenseDocumentsService(
        prisma, docNumber, transition, sameDay, accrual, creditNote, payroll, settlement,
        journalMock as never,
        new LineAggregatorService(),
        { preview: jest.fn() } as never,
        { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
        { execute: jest.fn() } as never,
        { getConfig: jest.fn(), validate: jest.fn() } as never,
        { loadWhitelist: jest.fn().mockResolvedValue(new Set(['53-1104', '53-1105'])), validateLine: jest.fn().mockResolvedValue({ taxableBase: new Decimal(0) }) } as never,
        { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) } as never,
      );

      await svc.voidDocument('doc-1', 'user-1', {
        reasonCode: 'data_entry_error',
        reasonDetail: 'ป้อนยอดผิด',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'EXPENSE_VOIDED',
          entity: 'expense_document',
          entityId: 'doc-1',
          userId: 'user-1',
          newValue: expect.objectContaining({
            status: 'VOIDED',
            reverseJournalEntryId: 'je-reverse-1',
            reasonCode: 'data_entry_error',
            reasonDetail: 'ป้อนยอดผิด',
            documentNumber: 'EX-001',
            documentType: 'EXPENSE',
          }),
        }),
      });
    });

    it('C3.1: reverseDate from DTO overrides today for postedAt on reversal JE', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1',
        status: 'POSTED',
        journalEntryId: 'je-original',
        documentType: 'EXPENSE',
        number: 'EX-001',
      });
      const journalMock = {
        createAndPost: jest.fn().mockResolvedValue({ id: 'je-reverse-2', entryNumber: 'JE-X' }),
      };
      prisma.journalEntry = {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'je-original',
          companyId: 'shop-co-id',
          lines: [
            { accountCode: '53-1101', debit: '100.00', credit: '0', description: 'salary' },
          ],
        }),
      };
      const svc = new ExpenseDocumentsService(
        prisma, docNumber, transition, sameDay, accrual, creditNote, payroll, settlement,
        journalMock as never,
        new LineAggregatorService(),
        { preview: jest.fn() } as never,
        { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
        { execute: jest.fn() } as never,
        { getConfig: jest.fn(), validate: jest.fn() } as never,
        { loadWhitelist: jest.fn().mockResolvedValue(new Set(['53-1104', '53-1105'])), validateLine: jest.fn().mockResolvedValue({ taxableBase: new Decimal(0) }) } as never,
        { send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }) } as never,
      );

      await svc.voidDocument('doc-1', 'user-1', {
        reasonCode: 'cancel_transaction',
        reverseDate: '2026-04-30',
      });

      // Reversal JE postedAt should be derived from '2026-04-30' not today.
      const call = journalMock.createAndPost.mock.calls[0][0];
      const postedAtYmd = (call.postedAt as Date)
        .toLocaleString('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });
      expect(postedAtYmd).toBe('2026-04-30');
    });
  });
});
