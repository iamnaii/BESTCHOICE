import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { generateInterCompanyId, formatInterCompanyDescription } from './inter-company-link.util';

/**
 * JournalAutoService — automatically creates double-entry journal entries
 * when financial transactions occur (payments, expenses, contract activation, receipt void).
 *
 * Account codes follow the seeded Chart of Accounts (PEAK format XX-XXXX).
 *
 * Business rules:
 * - VAT on late fees: NOT charged (owner decision)
 * - Withholding tax: NOT applicable
 * - Cash basis for revenue, accrual basis for expenses
 * - Standard: TFRS for NPAEs
 *
 * Design: All methods accept an optional `tx` so they can run inside the
 * caller's existing transaction (atomic guarantee with the source operation).
 */
@Injectable()
export class JournalAutoService {
  private readonly logger = new Logger(JournalAutoService.name);

  // Phase A.1a: Account codes partitioned by company chart.
  // SHOP and FINANCE have separate chart-of-accounts. Each side's accounts
  // must be looked up by composite (companyId, code).

  // SHOP-side accounts (in SHOP chart)
  static readonly SHOP_ACC = {
    CASH: '11-1101',
    REVENUE_NEW: '41-1101',
    REVENUE_USED: '41-1102',
    INVENTORY_NEW: '11-3101',
    INVENTORY_USED: '11-3102',
    COGS_NEW: '51-1101',
    COGS_USED: '51-1102',
    COMMISSION_INCOME: '42-1105',
    DUE_FROM_FINANCE: '11-2105',
  } as const;

  // FINANCE-side accounts (in FINANCE chart)
  static readonly FINANCE_ACC = {
    CASH: '11-1101',
    HP_RECEIVABLE: '11-2102',
    ALLOWANCE_DOUBTFUL: '11-2103',
    REPO_INVENTORY: '11-3103',
    INVENTORY_NEW: '11-3104',
    INVENTORY_USED: '11-3105',
    VAT_INPUT: '11-4101',
    REVENUE_NEW: '41-2101',
    REVENUE_USED: '41-2102',
    INTEREST_INCOME: '42-2101',
    LATE_FEE_INCOME: '42-2102',
    REPOSSESSION_INCOME: '42-2104',
    COGS_NEW: '51-2101',
    COGS_USED: '51-2102',
    VAT_OUTPUT: '21-2101',
    CUSTOMER_CREDIT: '21-5101',
    DUE_TO_SHOP: '21-1102',
    BAD_DEBT_EXPENSE: '53-1701',
    COMMISSION_EXPENSE: '53-1801',
    LOSS_ON_REPO_RESALE: '53-1804',
  } as const;

  constructor(private prisma: PrismaService) {}

  private async generateEntryNumber(tx: Prisma.TransactionClient): Promise<string> {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `JE-${ym}`;
    const count = await tx.journalEntry.count({
      where: { entryNumber: { startsWith: prefix } },
    });
    return `${prefix}-${String(count + 1).padStart(4, '0')}`;
  }

  /** Resolve company id (defaults to first active company if not provided) */
  private async resolveCompanyId(
    tx: Prisma.TransactionClient,
    companyId?: string | null,
  ): Promise<string | null> {
    if (companyId) return companyId;
    const company = await tx.companyInfo.findFirst({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return company?.id || null;
  }

  /**
   * Create + auto-post a journal entry. Validates debit = credit.
   * Returns the entry id, or null if no lines. Throws if unbalanced.
   */
  private async createAndPost(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      entryDate: Date;
      description: string;
      referenceType: string;
      referenceId: string;
      createdById: string;
      lines: Array<{ accountCode: string; description?: string; debit: number; credit: number }>;
    },
  ): Promise<string | null> {
    // Drop zero lines
    const lines = params.lines.filter((l) => l.debit > 0 || l.credit > 0);
    if (lines.length === 0) return null;

    const totalDebit = lines.reduce((s, l) => s.plus(new Decimal(l.debit)), new Decimal(0));
    const totalCredit = lines.reduce((s, l) => s.plus(new Decimal(l.credit)), new Decimal(0));
    if (totalDebit.minus(totalCredit).abs().gt(new Decimal('0.01'))) {
      const msg = `Journal not balanced for ${params.referenceType} ${params.referenceId}: Dr ${totalDebit} ≠ Cr ${totalCredit}`;
      this.logger.error(msg);
      Sentry.captureException(new Error(msg), {
        tags: { kind: 'journal', referenceType: params.referenceType },
        extra: {
          referenceId: params.referenceId,
          totalDebit: totalDebit.toString(),
          totalCredit: totalCredit.toString(),
        },
      });
      throw new InternalServerErrorException(msg);
    }

    // Phase A.1a: validate accounts exist in this company's chart
    // (composite (companyId, code) lookup — chart is now partitioned by company)
    const codes = [...new Set(lines.map((l) => l.accountCode))];
    const accounts = await tx.chartOfAccount.findMany({
      where: { code: { in: codes }, companyId: params.companyId, deletedAt: null },
      select: { code: true, nameTh: true },
    });
    const foundCodes = new Set(accounts.map((a) => a.code));
    const missing = codes.filter((c) => !foundCodes.has(c));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Account(s) ${missing.join(', ')} ไม่อยู่ใน chart ของ companyId ${params.companyId}`,
      );
    }

    // F-6-002: soft-block — if entryDate in CLOSED period, redirect to current
    let entryDate = params.entryDate;
    let description = params.description;
    const period = await tx.accountingPeriod.findFirst({
      where: {
        companyId: params.companyId,
        year: entryDate.getFullYear(),
        month: entryDate.getMonth() + 1,
        status: { in: ['CLOSED', 'SYNCED'] },
      },
      select: { status: true },
    });
    if (period) {
      const originalYM = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
      this.logger.warn(
        `Auto-JE redirected from ${period.status} period ${originalYM} to current period`,
      );
      Sentry.captureMessage(`Auto-JE redirect: ${originalYM} → current`, {
        level: 'warning',
        tags: { kind: 'journal', referenceType: params.referenceType },
        extra: {
          referenceId: params.referenceId,
          originalYM,
          periodStatus: period.status,
        },
      });
      description = `[Originally for ${originalYM}] ${description}`;
      entryDate = new Date();
    }

    const entryNumber = await this.generateEntryNumber(tx);
    const entry = await tx.journalEntry.create({
      data: {
        entryNumber,
        companyId: params.companyId,
        entryDate,
        description,
        status: 'POSTED',
        postedAt: new Date(),
        postedById: params.createdById,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        createdById: params.createdById,
        lines: {
          create: lines.map((l) => ({
            accountCode: l.accountCode,
            description: l.description,
            debit: new Decimal(l.debit),
            credit: new Decimal(l.credit),
          })),
        },
      },
    });
    return entry.id;
  }

  /**
   * Auto journal — Payment received from customer (split FINANCE + SHOP — Phase A.1b).
   *
   * FINANCE entry (always):
   *   Dr. Cash/Bank                  [amountPaid]
   *     Cr. HP Receivable            [principal]
   *     Cr. Interest Income          [monthlyInterest]
   *     Cr. Late Fee Income          [lateFee — if any, lateFeeWaived → 0]
   *     Cr. VAT Output               [vatAmount]
   *     Cr. Due-to-SHOP              [monthlyCommission — FINANCE owes SHOP]
   *
   * SHOP entry (only when monthlyCommission > 0):
   *   Dr. Due-from-FINANCE           [monthlyCommission]
   *     Cr. Commission Income        [monthlyCommission]
   *
   * Both entries linked via [IC-<uuid>] description prefix when paired.
   *
   * Phase A.1a fold (commission into HP_RECEIVABLE) + commission-deferred Sentry
   * alarm REMOVED — commission now properly posted via inter-company entries.
   *
   * Backward compat: legacy `companyId` param accepted as alias for
   * `financeCompanyId` (Task 5 will clean up callers).
   *
   * Interest is recognised on cash basis. Late fees are NOT charged VAT (owner policy).
   */
  async createPaymentJournal(
    tx: Prisma.TransactionClient,
    params: {
      payment: {
        id: string;
        installmentNo: number;
        amountPaid: Decimal | number;
        monthlyPrincipal?: Decimal | number | null;
        monthlyInterest?: Decimal | number | null;
        monthlyCommission?: Decimal | number | null;
        vatAmount?: Decimal | number | null;
        lateFee?: Decimal | number | null;
        lateFeeWaived?: boolean;
        paidDate?: Date | null;
      };
      contract: { contractNumber: string; branchId?: string | null };
      userId: string;
      /** @deprecated Phase A.1b — use `financeCompanyId` instead. Accepted as alias. */
      companyId?: string | null;
      shopCompanyId?: string | null;
      financeCompanyId?: string | null;
    },
  ): Promise<string | null> {
    const FA = JournalAutoService.FINANCE_ACC;
    const SA = JournalAutoService.SHOP_ACC;

    // Resolve FINANCE company (legacy `companyId` accepted as alias)
    const financeCompanyId =
      params.financeCompanyId ??
      params.companyId ??
      (
        await tx.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
          select: { id: true },
        })
      )?.id ??
      // Fallback: first active company (legacy single-company setups / tests)
      (await this.resolveCompanyId(tx, null));

    if (!financeCompanyId) {
      this.logger.warn('No FINANCE company found — skipping payment journal');
      return null;
    }

    // Resolve SHOP company (only required when commission > 0)
    const shopCompanyId =
      params.shopCompanyId ??
      (
        await tx.companyInfo.findFirst({
          where: { companyCode: 'SHOP', deletedAt: null },
          select: { id: true },
        })
      )?.id ??
      // Fallback: same as FINANCE for legacy single-company setups
      financeCompanyId;

    const amountPaid = new Prisma.Decimal(params.payment.amountPaid ?? 0);
    const principal = new Prisma.Decimal(params.payment.monthlyPrincipal ?? 0);
    const interest = new Prisma.Decimal(params.payment.monthlyInterest ?? 0);
    const commission = new Prisma.Decimal(params.payment.monthlyCommission ?? 0);
    const vat = new Prisma.Decimal(params.payment.vatAmount ?? 0);
    const lateFee = params.payment.lateFeeWaived
      ? new Prisma.Decimal(0)
      : new Prisma.Decimal(params.payment.lateFee ?? 0);

    // If breakdown is missing (legacy/manual payment), settle whole amount against receivable as fallback
    const isZeroBreakdown =
      principal.isZero() &&
      interest.isZero() &&
      commission.isZero() &&
      vat.isZero() &&
      lateFee.isZero();
    const hpReceivableCredit = isZeroBreakdown ? amountPaid.sub(lateFee) : principal;

    const intercompanyId = commission.gt(0) ? generateInterCompanyId() : null;
    const baseDesc = `รับชำระค่างวด งวดที่ ${params.payment.installmentNo} สัญญา ${params.contract.contractNumber}`;

    // FINANCE entry (always)
    const financeDesc = intercompanyId
      ? formatInterCompanyDescription(intercompanyId, `${baseDesc} (FINANCE)`)
      : baseDesc;
    const financeEntryId = await this.createAndPost(tx, {
      companyId: financeCompanyId,
      entryDate: params.payment.paidDate || new Date(),
      description: financeDesc,
      referenceType: 'PAYMENT',
      referenceId: params.payment.id,
      createdById: params.userId,
      lines: [
        { accountCode: FA.CASH, description: 'รับชำระเงิน', debit: amountPaid.toNumber(), credit: 0 },
        { accountCode: FA.HP_RECEIVABLE, description: 'ตัดลูกหนี้เช่าซื้อ', debit: 0, credit: hpReceivableCredit.toNumber() },
        { accountCode: FA.INTEREST_INCOME, description: 'รายได้ดอกเบี้ยเช่าซื้อ', debit: 0, credit: interest.toNumber() },
        { accountCode: FA.LATE_FEE_INCOME, description: 'ค่าปรับล่าช้า', debit: 0, credit: lateFee.toNumber() },
        { accountCode: FA.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vat.toNumber() },
        { accountCode: FA.DUE_TO_SHOP, description: 'ค่าคอมมิชชันค้างจ่าย SHOP', debit: 0, credit: commission.toNumber() },
      ],
    });

    // SHOP entry — only when commission > 0
    if (commission.gt(0) && shopCompanyId && intercompanyId) {
      await this.createAndPost(tx, {
        companyId: shopCompanyId,
        entryDate: params.payment.paidDate || new Date(),
        description: formatInterCompanyDescription(intercompanyId, `${baseDesc} (SHOP commission)`),
        referenceType: 'PAYMENT',
        referenceId: params.payment.id,
        createdById: params.userId,
        lines: [
          { accountCode: SA.DUE_FROM_FINANCE, description: 'ค่าคอมมิชชันรับจาก FINANCE', debit: commission.toNumber(), credit: 0 },
          { accountCode: SA.COMMISSION_INCOME, description: 'รายได้ค่าคอมมิชชัน', debit: 0, credit: commission.toNumber() },
        ],
      });
    }

    return financeEntryId;
  }

  /**
   * Phase A.1b — Customer Credit overpayment.
   *
   * When a customer pays MORE than amount due, the excess is parked as a
   * liability ("Customer Credit") on the FINANCE side until applied to a
   * future installment.
   *
   * FINANCE entry:
   *   Dr. Cash (FINANCE)              [overpayment]
   *     Cr. Customer Credit (21-5101) [overpayment]
   */
  async createCustomerCreditOverpaymentJournal(
    tx: Prisma.TransactionClient,
    params: {
      paymentId: string;
      contractNumber: string;
      overpaymentAmount: Decimal;
      userId: string;
      financeCompanyId?: string | null;
      paidDate?: Date | null;
    },
  ): Promise<string | null> {
    const FA = JournalAutoService.FINANCE_ACC;
    const financeCompanyId =
      params.financeCompanyId ??
      (
        await tx.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
          select: { id: true },
        })
      )?.id ??
      null;
    if (!financeCompanyId) {
      throw new InternalServerErrorException('FINANCE company required for customer credit overpayment JE');
    }

    return this.createAndPost(tx, {
      companyId: financeCompanyId,
      entryDate: params.paidDate ?? new Date(),
      description: `รับชำระเกิน — บันทึกเครดิตลูกค้า สัญญา ${params.contractNumber}`,
      referenceType: 'CUSTOMER_CREDIT_OVERPAY',
      referenceId: params.paymentId,
      createdById: params.userId,
      lines: [
        { accountCode: FA.CASH, description: 'รับเงินชำระเกิน', debit: params.overpaymentAmount.toNumber(), credit: 0 },
        { accountCode: FA.CUSTOMER_CREDIT, description: 'หนี้สิน — เครดิตลูกค้า', debit: 0, credit: params.overpaymentAmount.toNumber() },
      ],
    });
  }

  /**
   * Phase A.1b — Customer Credit allocation to a future installment.
   *
   * Same structure as createPaymentJournal BUT debits Customer Credit instead
   * of Cash on the FINANCE side. Replaces the createPaymentJournal call from
   * applyCreditBalance (audit F-1-004 — current code Dr Cash twice when credit
   * was applied to an installment).
   *
   * FINANCE entry:
   *   Dr. Customer Credit (21-5101)   [allocated amount]
   *     Cr. HP Receivable             [principal]
   *     Cr. Interest Income           [interest]
   *     Cr. VAT Output                [vat]
   *     Cr. Late Fee Income           [lateFee]
   *     Cr. Due-to-SHOP               [commission]
   *
   * SHOP entry (only if commission > 0):
   *   Dr. Due-from-FINANCE            [commission]
   *     Cr. Commission Income         [commission]
   */
  async createCreditAllocationJournal(
    tx: Prisma.TransactionClient,
    params: {
      payment: {
        id: string;
        installmentNo: number;
        amountPaid: Decimal | number;
        monthlyPrincipal?: Decimal | number | null;
        monthlyInterest?: Decimal | number | null;
        monthlyCommission?: Decimal | number | null;
        vatAmount?: Decimal | number | null;
        lateFee?: Decimal | number | null;
        lateFeeWaived?: boolean;
        paidDate?: Date | null;
      };
      contract: { contractNumber: string; branchId?: string | null };
      userId: string;
      shopCompanyId?: string | null;
      financeCompanyId?: string | null;
    },
  ): Promise<{ financeEntryId: string | null; shopEntryId: string | null }> {
    const FA = JournalAutoService.FINANCE_ACC;
    const SA = JournalAutoService.SHOP_ACC;

    const financeCompanyId =
      params.financeCompanyId ??
      (
        await tx.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
          select: { id: true },
        })
      )?.id ??
      null;
    if (!financeCompanyId) {
      throw new InternalServerErrorException('FINANCE company required for credit allocation JE');
    }

    const shopCompanyId =
      params.shopCompanyId ??
      (
        await tx.companyInfo.findFirst({
          where: { companyCode: 'SHOP', deletedAt: null },
          select: { id: true },
        })
      )?.id ??
      null;

    const principal = new Prisma.Decimal(params.payment.monthlyPrincipal ?? 0);
    const interest = new Prisma.Decimal(params.payment.monthlyInterest ?? 0);
    const commission = new Prisma.Decimal(params.payment.monthlyCommission ?? 0);
    const vat = new Prisma.Decimal(params.payment.vatAmount ?? 0);
    const effectiveLateFee = params.payment.lateFeeWaived
      ? new Prisma.Decimal(0)
      : new Prisma.Decimal(params.payment.lateFee ?? 0);
    const amountAllocated = new Prisma.Decimal(params.payment.amountPaid);

    const intercompanyId = commission.gt(0) ? generateInterCompanyId() : null;
    const baseDesc = `ใช้เครดิตลูกค้าตัดงวด งวดที่ ${params.payment.installmentNo} สัญญา ${params.contract.contractNumber}`;

    const financeDesc = intercompanyId
      ? formatInterCompanyDescription(intercompanyId, `${baseDesc} (FINANCE)`)
      : baseDesc;
    const financeEntryId = await this.createAndPost(tx, {
      companyId: financeCompanyId,
      entryDate: params.payment.paidDate ?? new Date(),
      description: financeDesc,
      referenceType: 'CREDIT_ALLOCATION',
      referenceId: params.payment.id,
      createdById: params.userId,
      lines: [
        { accountCode: FA.CUSTOMER_CREDIT, description: 'ใช้เครดิตลูกค้า', debit: amountAllocated.toNumber(), credit: 0 },
        { accountCode: FA.HP_RECEIVABLE, description: 'ตัดลูกหนี้เช่าซื้อ', debit: 0, credit: principal.toNumber() },
        { accountCode: FA.INTEREST_INCOME, description: 'รายได้ดอกเบี้ยเช่าซื้อ', debit: 0, credit: interest.toNumber() },
        { accountCode: FA.LATE_FEE_INCOME, description: 'ค่าปรับล่าช้า', debit: 0, credit: effectiveLateFee.toNumber() },
        { accountCode: FA.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vat.toNumber() },
        { accountCode: FA.DUE_TO_SHOP, description: 'ค่าคอมมิชชันค้างจ่าย SHOP', debit: 0, credit: commission.toNumber() },
      ],
    });

    let shopEntryId: string | null = null;
    if (commission.gt(0) && shopCompanyId && intercompanyId) {
      shopEntryId = await this.createAndPost(tx, {
        companyId: shopCompanyId,
        entryDate: params.payment.paidDate ?? new Date(),
        description: formatInterCompanyDescription(intercompanyId, `${baseDesc} (SHOP commission)`),
        referenceType: 'CREDIT_ALLOCATION',
        referenceId: params.payment.id,
        createdById: params.userId,
        lines: [
          { accountCode: SA.DUE_FROM_FINANCE, description: 'ค่าคอมมิชชันรับจาก FINANCE', debit: commission.toNumber(), credit: 0 },
          { accountCode: SA.COMMISSION_INCOME, description: 'รายได้ค่าคอมมิชชัน', debit: 0, credit: commission.toNumber() },
        ],
      });
    }

    return { financeEntryId, shopEntryId };
  }

  /**
   * Auto journal — Expense paid.
   *
   * Dr. [Expense Account]            [amount (excl. VAT)]
   * Dr. VAT Input                    [vatAmount — if any]
   *   Cr. Cash/Bank                  [totalAmount]
   */
  async createExpenseJournal(
    tx: Prisma.TransactionClient,
    params: {
      expense: {
        id: string;
        expenseNumber: string;
        accountCode?: string | null;
        amount: Decimal | number;
        vatAmount?: Decimal | number | null;
        totalAmount: Decimal | number;
        description: string;
        expenseDate: Date;
        paymentDate?: Date | null;
      };
      userId: string;
      companyId?: string | null;
    },
  ): Promise<string | null> {
    const companyId = await this.resolveCompanyId(tx, params.companyId);
    if (!companyId) return null;
    if (!params.expense.accountCode) {
      this.logger.warn(`Expense ${params.expense.id} has no accountCode — skipping journal`);
      return null;
    }

    const amount = new Prisma.Decimal(params.expense.amount ?? 0);
    const vat = new Prisma.Decimal(params.expense.vatAmount ?? 0);
    const total = new Prisma.Decimal(params.expense.totalAmount ?? 0);

    // Phase A.1a: pick SHOP_ACC vs FINANCE_ACC based on owning company.
    // SHOP is not VAT-registered, so VAT_INPUT only applies to FINANCE expenses.
    const company = await tx.companyInfo.findUnique({
      where: { id: companyId },
      select: { companyCode: true },
    });
    const isShop = company?.companyCode === 'SHOP';
    const SA = JournalAutoService.SHOP_ACC;
    const FA = JournalAutoService.FINANCE_ACC;
    const cashAcc = isShop ? SA.CASH : FA.CASH;
    const vatInputAcc = FA.VAT_INPUT; // SHOP has no VAT chart entry; vat should be 0 for SHOP expenses

    return this.createAndPost(tx, {
      companyId,
      entryDate: params.expense.paymentDate || params.expense.expenseDate,
      description: `จ่ายค่าใช้จ่าย ${params.expense.expenseNumber}: ${params.expense.description}`,
      referenceType: 'EXPENSE',
      referenceId: params.expense.id,
      createdById: params.userId,
      lines: [
        { accountCode: params.expense.accountCode, description: params.expense.description, debit: amount.toNumber(), credit: 0 },
        { accountCode: vatInputAcc, description: 'ภาษีซื้อ', debit: vat.toNumber(), credit: 0 },
        { accountCode: cashAcc, description: 'จ่ายเงิน', debit: 0, credit: total.toNumber() },
      ],
    });
  }

  /**
   * Auto journal — Contract activated (cash sale of goods + receivable creation).
   *
   * Dr. Cash/Bank                       [downPayment]
   * Dr. Hire-Purchase Receivable        [financedAmount]
   *   Cr. Sales Revenue                 [sellingPrice + commission]  (excl. interest)
   *   Cr. Interest Income               [interestTotal]
   *   Cr. VAT Output                    [vatAmount]
   *
   * Plus COGS:
   * Dr. COGS                            [costPrice]
   *   Cr. Inventory                     [costPrice]
   */
  async createContractActivationJournal(
    tx: Prisma.TransactionClient,
    params: {
      contract: {
        id: string;
        contractNumber: string;
        sellingPrice: Decimal | number;
        downPayment: Decimal | number;
        financedAmount: Decimal | number;
        interestTotal: Decimal | number;
        storeCommission: Decimal | number;
        vatAmount: Decimal | number;
      };
      product: { costPrice?: Decimal | number | null; category?: string | null };
      userId: string;
      // Phase A.1b: split into SHOP+FINANCE paired entries.
      // shopCompanyId/financeCompanyId are explicit; if either is omitted we
      // resolve by companyCode. Legacy single `companyId` is no longer used —
      // both sides must be configured for activation to post correctly.
      shopCompanyId?: string | null;
      financeCompanyId?: string | null;
      /** @deprecated Use shopCompanyId + financeCompanyId. Ignored. */
      companyId?: string | null;
    },
  ): Promise<{ shopEntryId: string | null; financeEntryId: string | null } | null> {
    const SA = JournalAutoService.SHOP_ACC;
    const FA = JournalAutoService.FINANCE_ACC;

    const shopCompanyId =
      params.shopCompanyId ??
      (
        await tx.companyInfo.findFirst({
          where: { companyCode: 'SHOP', deletedAt: null },
          select: { id: true },
        })
      )?.id ??
      null;
    const financeCompanyId =
      params.financeCompanyId ??
      (
        await tx.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
          select: { id: true },
        })
      )?.id ??
      null;

    // Backward-compat: when the legacy single-company test fixture returns
    // null for findFirst (no company configured), preserve the historical
    // "return null" behavior rather than throwing.
    if (!shopCompanyId && !financeCompanyId) {
      return null;
    }
    if (!shopCompanyId || !financeCompanyId) {
      throw new InternalServerErrorException(
        'SHOP and FINANCE companies must be configured for inter-company contract activation JE',
      );
    }

    const c = params.contract;
    const sellingPrice = new Prisma.Decimal(c.sellingPrice ?? 0);
    const downPayment = new Prisma.Decimal(c.downPayment ?? 0);
    const storeCommission = new Prisma.Decimal(c.storeCommission ?? 0);
    const financedAmount = new Prisma.Decimal(c.financedAmount ?? 0);
    const interestTotal = new Prisma.Decimal(c.interestTotal ?? 0);
    const vatAmount = new Prisma.Decimal(c.vatAmount ?? 0);
    const costPrice = new Prisma.Decimal(params.product.costPrice ?? 0);

    const isUsed = (params.product.category || '').toLowerCase().includes('used') ||
      (params.product.category || '').includes('มือสอง');
    const shopRevenueAcc = isUsed ? SA.REVENUE_USED : SA.REVENUE_NEW;
    const shopCogsAcc = isUsed ? SA.COGS_USED : SA.COGS_NEW;
    const shopInventoryAcc = isUsed ? SA.INVENTORY_USED : SA.INVENTORY_NEW;

    const intercompanyId = generateInterCompanyId();
    const baseDesc = `เปิดสัญญาเช่าซื้อ ${c.contractNumber}`;

    // Inter-company invariant: SHOP Due-from-FINANCE = FINANCE Due-to-SHOP.
    // Derived from the cash-flow rule (CLAUDE.md): FINANCE pays SHOP
    // (sellingPrice + commission - downPayment) for goods sold.
    const dueFromFinance = sellingPrice.plus(storeCommission).minus(downPayment);

    // ── SHOP entry ────────────────────────────────────────────────────────
    // Dr Cash (downPayment) + Dr Due-from-FINANCE
    //   Cr Revenue (sellingPrice) + Cr Commission Income (storeCommission)
    // Dr COGS + Cr Inventory  (only when cost > 0)
    const shopLines: Array<{ accountCode: string; description: string; debit: number; credit: number }> = [];
    if (downPayment.greaterThan(0)) {
      shopLines.push({ accountCode: SA.CASH, description: 'รับเงินดาวน์', debit: downPayment.toNumber(), credit: 0 });
    }
    if (dueFromFinance.greaterThan(0)) {
      shopLines.push({ accountCode: SA.DUE_FROM_FINANCE, description: 'ลูกหนี้ระหว่างบริษัท (FINANCE)', debit: dueFromFinance.toNumber(), credit: 0 });
    }
    if (sellingPrice.greaterThan(0)) {
      shopLines.push({ accountCode: shopRevenueAcc, description: 'รายได้จากการขาย', debit: 0, credit: sellingPrice.toNumber() });
    }
    if (storeCommission.greaterThan(0)) {
      shopLines.push({ accountCode: SA.COMMISSION_INCOME, description: 'รายได้ค่าคอมมิชชัน', debit: 0, credit: storeCommission.toNumber() });
    }
    if (costPrice.greaterThan(0)) {
      shopLines.push({ accountCode: shopCogsAcc, description: 'ต้นทุนขาย', debit: costPrice.toNumber(), credit: 0 });
      shopLines.push({ accountCode: shopInventoryAcc, description: 'ตัดสินค้าคงเหลือ', debit: 0, credit: costPrice.toNumber() });
    }

    const shopEntryId = await this.createAndPost(tx, {
      companyId: shopCompanyId,
      entryDate: new Date(),
      description: formatInterCompanyDescription(intercompanyId, `${baseDesc} (SHOP)`),
      referenceType: 'CONTRACT',
      referenceId: c.id,
      createdById: params.userId,
      lines: shopLines,
    });

    // ── FINANCE entry ─────────────────────────────────────────────────────
    // Dr HP Receivable (financedAmount = principal + commission + interest + vat)
    //   Cr Due-to-SHOP (dueFromFinance — invariant pair)
    //   Cr Interest Income (interestTotal — upfront recognition preserved)
    //   Cr VAT Output (vatAmount)
    const financeLines: Array<{ accountCode: string; description: string; debit: number; credit: number }> = [];
    if (financedAmount.greaterThan(0)) {
      financeLines.push({ accountCode: FA.HP_RECEIVABLE, description: 'ลูกหนี้เช่าซื้อ', debit: financedAmount.toNumber(), credit: 0 });
    }
    if (dueFromFinance.greaterThan(0)) {
      financeLines.push({ accountCode: FA.DUE_TO_SHOP, description: 'เจ้าหนี้ระหว่างบริษัท (SHOP)', debit: 0, credit: dueFromFinance.toNumber() });
    }
    if (interestTotal.greaterThan(0)) {
      financeLines.push({ accountCode: FA.INTEREST_INCOME, description: 'รายได้ดอกเบี้ยเช่าซื้อ', debit: 0, credit: interestTotal.toNumber() });
    }
    if (vatAmount.greaterThan(0)) {
      financeLines.push({ accountCode: FA.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vatAmount.toNumber() });
    }

    const financeEntryId = await this.createAndPost(tx, {
      companyId: financeCompanyId,
      entryDate: new Date(),
      description: formatInterCompanyDescription(intercompanyId, `${baseDesc} (FINANCE)`),
      referenceType: 'CONTRACT',
      referenceId: c.id,
      createdById: params.userId,
      lines: financeLines,
    });

    return { shopEntryId, financeEntryId };
  }

  /**
   * Auto journal — Reversal entry for a voided posted entry.
   * Creates a new entry with debit/credit swapped.
   */
  async createReversalJournal(
    tx: Prisma.TransactionClient,
    params: {
      originalEntryId: string;
      reason: string;
      userId: string;
    },
  ): Promise<string | null> {
    const original = await tx.journalEntry.findUnique({
      where: { id: params.originalEntryId },
      include: { lines: true },
    });
    if (!original || original.deletedAt) return null;

    return this.createAndPost(tx, {
      companyId: original.companyId,
      entryDate: new Date(),
      description: `กลับรายการ: ${original.description} (เหตุผล: ${params.reason})`,
      referenceType: 'REVERSAL',
      referenceId: original.id,
      createdById: params.userId,
      lines: original.lines.map((l) => ({
        accountCode: l.accountCode,
        description: `กลับรายการ: ${l.description || ''}`,
        debit: new Prisma.Decimal(l.credit ?? 0).toNumber(), // swap
        credit: new Prisma.Decimal(l.debit ?? 0).toNumber(),
      })),
    });
  }

  /**
   * Auto journal — Bad debt write-off (ตัดหนี้สูญ).
   *
   * When no prior provision exists:
   *   Dr. Bad Debt Expense             [writeOffAmount]
   *     Cr. HP Receivable              [writeOffAmount]
   *
   * When a provision exists (partial or full):
   *   Dr. Bad Debt Expense             [writeOffAmount - provisionAmount]  (incremental charge)
   *   Dr. Allowance for Doubtful Accts [provisionAmount]                   (utilise reserve)
   *     Cr. HP Receivable              [writeOffAmount]
   *
   * The zero-line filter in createAndPost ensures lines with amount = 0 are dropped
   * automatically, so partial-provision and full-provision cases both produce
   * correctly balanced entries.
   */
  async createBadDebtWriteOffJournal(
    tx: Prisma.TransactionClient,
    params: {
      contractId: string;
      contractNumber: string;
      writeOffAmount: Decimal | number;
      provisionAmount?: Decimal | number;
      createdById: string;
      companyId?: string | null;
    },
  ): Promise<string | null> {
    const companyId = await this.resolveCompanyId(tx, params.companyId);
    if (!companyId) {
      this.logger.warn(
        `No active company found — skipping bad-debt write-off journal for contract ${params.contractId}`,
      );
      return null;
    }

    const writeOff = new Prisma.Decimal(params.writeOffAmount ?? 0);
    const provision = new Prisma.Decimal(params.provisionAmount ?? 0);

    // Incremental expense = amount not already provisioned (may be 0 if fully provisioned)
    const incrementalExpense = writeOff.sub(provision).greaterThan(0)
      ? writeOff.sub(provision)
      : new Prisma.Decimal(0);

    // Phase A.1a: bad debt write-off is FINANCE-side (HP receivable lives on FINANCE chart).
    const FA = JournalAutoService.FINANCE_ACC;
    return this.createAndPost(tx, {
      companyId,
      entryDate: new Date(),
      description: `ตัดหนี้สูญ สัญญา ${params.contractNumber}`,
      referenceType: 'BAD_DEBT_WRITE_OFF',
      referenceId: params.contractId,
      createdById: params.createdById,
      lines: [
        {
          accountCode: FA.BAD_DEBT_EXPENSE,
          description: 'ค่าใช้จ่ายหนี้สูญ',
          debit: incrementalExpense.toNumber(),
          credit: 0,
        },
        {
          accountCode: FA.ALLOWANCE_DOUBTFUL,
          description: 'ใช้ค่าเผื่อหนี้สงสัยจะสูญ',
          debit: provision.toNumber(),
          credit: 0,
        },
        {
          accountCode: FA.HP_RECEIVABLE,
          description: 'ตัดลูกหนี้เช่าซื้อ',
          debit: 0,
          credit: writeOff.toNumber(),
        },
      ],
    });
  }

  /**
   * Auto journal — Bad debt provision increment/recovery (Phase A.1b).
   *
   * Delta-based: only posts the change from the prior period's provision.
   *
   * Increment (delta > 0):
   *   Dr. Bad Debt Expense (53-1701)       [delta]
   *     Cr. Allowance for Doubtful (11-2103) [delta]
   *
   * Recovery (delta < 0):
   *   Dr. Allowance for Doubtful (11-2103) [|delta|]
   *     Cr. Bad Debt Expense (53-1701)     [|delta|]
   *
   * Zero delta: returns null immediately (no JE created).
   *
   * Closes audit finding F-1-009 (Allowance never posted).
   */
  async createBadDebtProvisionJournal(
    tx: Prisma.TransactionClient,
    params: {
      contractId: string;
      period: string; // YYYY-MM
      delta: Decimal; // positive = increment, negative = recovery
      userId: string;
      financeCompanyId?: string | null;
    },
  ): Promise<string | null> {
    if (params.delta.eq(0)) return null;

    const FA = JournalAutoService.FINANCE_ACC;
    const financeCompanyId =
      params.financeCompanyId ??
      (
        await tx.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
          select: { id: true },
        })
      )?.id ??
      null;

    if (!financeCompanyId) {
      throw new InternalServerErrorException(
        'FINANCE company required for bad debt provision JE',
      );
    }

    const isIncrement = params.delta.gt(0);
    const amount = params.delta.abs().toNumber();

    return this.createAndPost(tx, {
      companyId: financeCompanyId,
      entryDate: new Date(),
      description: `Bad debt provision ${isIncrement ? 'increment' : 'recovery'} ${params.period}`,
      referenceType: 'BAD_DEBT_PROVISION',
      referenceId: `${params.contractId}:${params.period}`,
      createdById: params.userId,
      lines: isIncrement
        ? [
            {
              accountCode: FA.BAD_DEBT_EXPENSE,
              description: 'Bad debt expense',
              debit: amount,
              credit: 0,
            },
            {
              accountCode: FA.ALLOWANCE_DOUBTFUL,
              description: 'Allowance for doubtful',
              debit: 0,
              credit: amount,
            },
          ]
        : [
            {
              accountCode: FA.ALLOWANCE_DOUBTFUL,
              description: 'Allowance reversal',
              debit: amount,
              credit: 0,
            },
            {
              accountCode: FA.BAD_DEBT_EXPENSE,
              description: 'Bad debt recovery',
              debit: 0,
              credit: amount,
            },
          ],
    });
  }

  /**
   * Auto journal — Repossession resale (Phase A.1b, closes F-1-018).
   *
   * Gain case (resellPrice >= bookValue):
   *   Dr. Cash/Bank FINANCE             [resellPrice]
   *     Cr. Repossessed Inventory       [bookValue]
   *     Cr. Repossession Income (42-2104) [gain]
   *
   * Loss case (resellPrice < bookValue):
   *   Dr. Cash/Bank FINANCE             [resellPrice]
   *   Dr. Loss on Repo Resale (53-1804) [loss]
   *     Cr. Repossessed Inventory       [bookValue]
   *
   * bookValue = product.costPrice + repairCost (inventory carrying amount).
   */
  async createRepossessionResaleJournal(
    tx: Prisma.TransactionClient,
    params: {
      repossessionId: string;
      resellPrice: Prisma.Decimal;
      bookValue: Prisma.Decimal;
      userId: string;
      financeCompanyId?: string | null;
    },
  ): Promise<string | null> {
    const FA = JournalAutoService.FINANCE_ACC;
    const financeCompanyId =
      params.financeCompanyId ??
      (
        await tx.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
          select: { id: true },
        })
      )?.id ??
      null;

    if (!financeCompanyId) {
      throw new InternalServerErrorException(
        'FINANCE company required for repossession resale JE',
      );
    }

    // Idempotency: a SOLD update can be retried — the JE must post once per repossession.
    const existing = await tx.journalEntry.findFirst({
      where: {
        referenceType: 'REPO_RESALE',
        referenceId: params.repossessionId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const gainOrLoss = params.resellPrice.minus(params.bookValue);
    const isGain = gainOrLoss.gte(0);

    const lines = isGain
      ? [
          {
            accountCode: FA.CASH,
            description: 'Cash from resale',
            debit: params.resellPrice.toNumber(),
            credit: 0,
          },
          {
            accountCode: FA.REPO_INVENTORY,
            description: 'Repossessed inventory removed',
            debit: 0,
            credit: params.bookValue.toNumber(),
          },
          {
            accountCode: FA.REPOSSESSION_INCOME,
            description: 'Gain on repossession resale',
            debit: 0,
            credit: gainOrLoss.toNumber(),
          },
        ]
      : [
          {
            accountCode: FA.CASH,
            description: 'Cash from resale',
            debit: params.resellPrice.toNumber(),
            credit: 0,
          },
          {
            accountCode: FA.LOSS_ON_REPO_RESALE,
            description: 'Loss on repossession resale',
            debit: gainOrLoss.abs().toNumber(),
            credit: 0,
          },
          {
            accountCode: FA.REPO_INVENTORY,
            description: 'Repossessed inventory removed',
            debit: 0,
            credit: params.bookValue.toNumber(),
          },
        ];

    return this.createAndPost(tx, {
      companyId: financeCompanyId,
      entryDate: new Date(),
      description: `Repossession resale ${params.repossessionId}`,
      referenceType: 'REPO_RESALE',
      referenceId: params.repossessionId,
      createdById: params.userId,
      lines,
    });
  }

  /**
   * Trial Balance — sum debit/credit per account from POSTED entries.
   */
  async getTrialBalance(filters: {
    asOfDate?: string;
    companyId?: string;
  }): Promise<{
    asOfDate: string;
    accounts: Array<{
      code: string;
      nameTh: string;
      accountGroup: string;
      totalDebit: number;
      totalCredit: number;
      balance: number;
    }>;
    totalDebit: number;
    totalCredit: number;
    balanced: boolean;
  }> {
    const asOf = filters.asOfDate ? new Date(filters.asOfDate) : new Date();
    asOf.setHours(23, 59, 59, 999);

    const where: Prisma.JournalLineWhereInput = {
      deletedAt: null,
      journalEntry: {
        deletedAt: null,
        status: 'POSTED',
        entryDate: { lte: asOf },
        ...(filters.companyId ? { companyId: filters.companyId } : {}),
      },
    };

    const lines = await this.prisma.journalLine.findMany({
      where,
      select: { accountCode: true, debit: true, credit: true },
    });

    const accountMap = new Map<string, { totalDebit: Prisma.Decimal; totalCredit: Prisma.Decimal }>();
    for (const line of lines) {
      const acc = accountMap.get(line.accountCode) || {
        totalDebit: new Prisma.Decimal(0),
        totalCredit: new Prisma.Decimal(0),
      };
      acc.totalDebit = acc.totalDebit.add(new Prisma.Decimal(line.debit ?? 0));
      acc.totalCredit = acc.totalCredit.add(new Prisma.Decimal(line.credit ?? 0));
      accountMap.set(line.accountCode, acc);
    }

    const codes = Array.from(accountMap.keys());
    const chartAccounts = codes.length > 0
      ? await this.prisma.chartOfAccount.findMany({
          where: { code: { in: codes } },
          select: { code: true, nameTh: true, accountGroup: true },
        })
      : [];

    const chartMap = new Map(chartAccounts.map((a) => [a.code, a]));

    const accounts = codes
      .map((code) => {
        const sums = accountMap.get(code)!;
        const chart = chartMap.get(code);
        return {
          code,
          nameTh: chart?.nameTh || '(ไม่พบในผังบัญชี)',
          accountGroup: chart?.accountGroup || 'UNKNOWN',
          totalDebit: sums.totalDebit.toDecimalPlaces(2).toNumber(),
          totalCredit: sums.totalCredit.toDecimalPlaces(2).toNumber(),
          balance: sums.totalDebit.sub(sums.totalCredit).toDecimalPlaces(2).toNumber(),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = Math.round(accounts.reduce((s, a) => s + a.totalDebit, 0) * 100) / 100;
    const totalCredit = Math.round(accounts.reduce((s, a) => s + a.totalCredit, 0) * 100) / 100;

    return {
      asOfDate: asOf.toISOString(),
      accounts,
      totalDebit,
      totalCredit,
      balanced: Math.abs(totalDebit - totalCredit) < 0.01,
    };
  }
}
