import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

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

  // Account codes — single source of truth
  static readonly ACC = {
    CASH: '11-1101',
    HP_RECEIVABLE: '11-2102',
    INVENTORY_NEW: '11-3101',
    INVENTORY_USED: '11-3102',
    VAT_INPUT: '11-4101',
    VAT_OUTPUT: '21-2101',
    ALLOWANCE_DOUBTFUL: '11-2103',  // ค่าเผื่อหนี้สงสัยจะสูญ (contra asset; matches chart-of-accounts seed)
    CUSTOMER_CREDIT: '21-5101',
    REVENUE_NEW: '41-1101',
    REVENUE_USED: '41-1102',
    INTEREST_INCOME: '42-1101',     // รายได้ดอกเบี้ยเช่าซื้อ (HP interest revenue)
    LATE_FEE_INCOME: '42-1102',
    COMMISSION_INCOME: '42-1105',
    COGS_NEW: '51-1101',
    COGS_USED: '51-1102',
    BAD_DEBT_EXPENSE: '53-1101',    // หนี้สูญ
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

    // F-3-027 part 3/3: validate allowedCompanies for each line's account
    const codes = [...new Set(lines.map((l) => l.accountCode))];
    const [accounts, company] = await Promise.all([
      tx.chartOfAccount.findMany({
        where: { code: { in: codes } },
        select: { code: true, nameTh: true, allowedCompanies: true },
      }),
      tx.companyInfo.findUnique({
        where: { id: params.companyId },
        select: { companyCode: true },
      }),
    ]);
    if (!company) {
      throw new BadRequestException(`Company ${params.companyId} not found`);
    }
    if (company.companyCode) {
      const companyCode = company.companyCode;
      for (const acc of accounts) {
        if (acc.allowedCompanies.length > 0 && !acc.allowedCompanies.includes(companyCode)) {
          throw new BadRequestException(
            `Account ${acc.code} (${acc.nameTh}) ใช้ไม่ได้กับบริษัท ${companyCode}`,
          );
        }
      }
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
   * Auto journal — Payment received from customer.
   *
   * Dr. Cash/Bank                    [amountPaid]
   *   Cr. Hire-Purchase Receivable   [monthlyPrincipal only — NOT principal+interest]
   *   Cr. Interest Income            [monthlyInterest]
   *   Cr. Commission Income          [monthlyCommission]
   *   Cr. VAT Output                 [vatAmount]
   *   Cr. Late Fee Income            [lateFee — if any]
   *
   * Interest is recognised as a separate revenue line (cash basis).
   * Late fees are NOT charged VAT (owner policy).
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
      companyId?: string | null;
    },
  ): Promise<string | null> {
    const companyId = await this.resolveCompanyId(tx, params.companyId);
    if (!companyId) {
      this.logger.warn('No active company found — skipping payment journal');
      return null;
    }

    const amountPaid = new Prisma.Decimal(params.payment.amountPaid ?? 0);
    const principal = new Prisma.Decimal(params.payment.monthlyPrincipal ?? 0);
    const interest = new Prisma.Decimal(params.payment.monthlyInterest ?? 0);
    const commission = new Prisma.Decimal(params.payment.monthlyCommission ?? 0);
    const vat = new Prisma.Decimal(params.payment.vatAmount ?? 0);
    const lateFee = params.payment.lateFeeWaived
      ? new Prisma.Decimal(0)
      : new Prisma.Decimal(params.payment.lateFee ?? 0);

    // HP receivable is reduced by principal only — interest is recognised as separate revenue
    const hpSettled = principal;
    // If breakdown is missing (legacy/manual payment), settle whole amount against receivable as fallback
    const isZeroBreakdown = principal.isZero() && interest.isZero() && commission.isZero() && vat.isZero() && lateFee.isZero();
    const fallbackHp = isZeroBreakdown ? amountPaid.sub(lateFee) : hpSettled;

    return this.createAndPost(tx, {
      companyId,
      entryDate: params.payment.paidDate || new Date(),
      description: `รับชำระค่างวด งวดที่ ${params.payment.installmentNo} สัญญา ${params.contract.contractNumber}`,
      referenceType: 'PAYMENT',
      referenceId: params.payment.id,
      createdById: params.userId,
      lines: [
        { accountCode: JournalAutoService.ACC.CASH, description: 'รับชำระเงิน', debit: amountPaid.toNumber(), credit: 0 },
        { accountCode: JournalAutoService.ACC.HP_RECEIVABLE, description: 'ตัดลูกหนี้เช่าซื้อ', debit: 0, credit: fallbackHp.toNumber() },
        { accountCode: JournalAutoService.ACC.INTEREST_INCOME, description: 'รายได้ดอกเบี้ยเช่าซื้อ', debit: 0, credit: interest.toNumber() },
        { accountCode: JournalAutoService.ACC.COMMISSION_INCOME, description: 'รายได้ค่าคอมมิชชัน', debit: 0, credit: commission.toNumber() },
        { accountCode: JournalAutoService.ACC.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vat.toNumber() },
        { accountCode: JournalAutoService.ACC.LATE_FEE_INCOME, description: 'ค่าปรับล่าช้า', debit: 0, credit: lateFee.toNumber() },
      ],
    });
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

    return this.createAndPost(tx, {
      companyId,
      entryDate: params.expense.paymentDate || params.expense.expenseDate,
      description: `จ่ายค่าใช้จ่าย ${params.expense.expenseNumber}: ${params.expense.description}`,
      referenceType: 'EXPENSE',
      referenceId: params.expense.id,
      createdById: params.userId,
      lines: [
        { accountCode: params.expense.accountCode, description: params.expense.description, debit: amount.toNumber(), credit: 0 },
        { accountCode: JournalAutoService.ACC.VAT_INPUT, description: 'ภาษีซื้อ', debit: vat.toNumber(), credit: 0 },
        { accountCode: JournalAutoService.ACC.CASH, description: 'จ่ายเงิน', debit: 0, credit: total.toNumber() },
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
      companyId?: string | null;
    },
  ): Promise<string | null> {
    const companyId = await this.resolveCompanyId(tx, params.companyId);
    if (!companyId) return null;

    const sellingPrice = new Prisma.Decimal(params.contract.sellingPrice ?? 0);
    const downPayment = new Prisma.Decimal(params.contract.downPayment ?? 0);
    const financedAmount = new Prisma.Decimal(params.contract.financedAmount ?? 0);
    const interest = new Prisma.Decimal(params.contract.interestTotal ?? 0);
    const commission = new Prisma.Decimal(params.contract.storeCommission ?? 0);
    const vat = new Prisma.Decimal(params.contract.vatAmount ?? 0);
    const cost = new Prisma.Decimal(params.product.costPrice ?? 0);

    // Sales revenue = sellingPrice + commission only — interest is a separate revenue line
    const revenue = sellingPrice.add(commission);
    // HP Receivable = financedAmount which already includes principal + commission + interest + vat
    // (computed by installment.util.ts:56 calculateInstallment). Adding them again would
    // double-count and unbalance the JE — see F-2-001.
    const hpReceivable = financedAmount;
    const isUsed = (params.product.category || '').toLowerCase().includes('used') ||
      (params.product.category || '').includes('มือสอง');
    const revenueAcc = isUsed ? JournalAutoService.ACC.REVENUE_USED : JournalAutoService.ACC.REVENUE_NEW;
    const cogsAcc = isUsed ? JournalAutoService.ACC.COGS_USED : JournalAutoService.ACC.COGS_NEW;
    const inventoryAcc = isUsed ? JournalAutoService.ACC.INVENTORY_USED : JournalAutoService.ACC.INVENTORY_NEW;

    // Sales + receivable entry
    const salesEntryId = await this.createAndPost(tx, {
      companyId,
      entryDate: new Date(),
      description: `เปิดสัญญาเช่าซื้อ ${params.contract.contractNumber}`,
      referenceType: 'CONTRACT',
      referenceId: params.contract.id,
      createdById: params.userId,
      lines: [
        { accountCode: JournalAutoService.ACC.CASH, description: 'รับเงินดาวน์', debit: downPayment.toNumber(), credit: 0 },
        { accountCode: JournalAutoService.ACC.HP_RECEIVABLE, description: 'ลูกหนี้เช่าซื้อ', debit: hpReceivable.toNumber(), credit: 0 },
        { accountCode: revenueAcc, description: 'รายได้จากการขาย', debit: 0, credit: revenue.toNumber() },
        { accountCode: JournalAutoService.ACC.INTEREST_INCOME, description: 'รายได้ดอกเบี้ยเช่าซื้อ', debit: 0, credit: interest.toNumber() },
        { accountCode: JournalAutoService.ACC.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vat.toNumber() },
      ],
    });

    // COGS entry (if cost available)
    if (cost.greaterThan(0)) {
      await this.createAndPost(tx, {
        companyId,
        entryDate: new Date(),
        description: `ต้นทุนสินค้า สัญญา ${params.contract.contractNumber}`,
        referenceType: 'CONTRACT_COGS',
        referenceId: params.contract.id,
        createdById: params.userId,
        lines: [
          { accountCode: cogsAcc, description: 'ต้นทุนขาย', debit: cost.toNumber(), credit: 0 },
          { accountCode: inventoryAcc, description: 'ตัดสินค้าคงเหลือ', debit: 0, credit: cost.toNumber() },
        ],
      });
    }

    return salesEntryId;
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

    return this.createAndPost(tx, {
      companyId,
      entryDate: new Date(),
      description: `ตัดหนี้สูญ สัญญา ${params.contractNumber}`,
      referenceType: 'BAD_DEBT_WRITE_OFF',
      referenceId: params.contractId,
      createdById: params.createdById,
      lines: [
        {
          accountCode: JournalAutoService.ACC.BAD_DEBT_EXPENSE,
          description: 'ค่าใช้จ่ายหนี้สูญ',
          debit: incrementalExpense.toNumber(),
          credit: 0,
        },
        {
          accountCode: JournalAutoService.ACC.ALLOWANCE_DOUBTFUL,
          description: 'ใช้ค่าเผื่อหนี้สงสัยจะสูญ',
          debit: provision.toNumber(),
          credit: 0,
        },
        {
          accountCode: JournalAutoService.ACC.HP_RECEIVABLE,
          description: 'ตัดลูกหนี้เช่าซื้อ',
          debit: 0,
          credit: writeOff.toNumber(),
        },
      ],
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
