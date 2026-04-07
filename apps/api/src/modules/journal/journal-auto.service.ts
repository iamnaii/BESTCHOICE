import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
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
    CUSTOMER_CREDIT: '21-5101',
    REVENUE_NEW: '41-1101',
    REVENUE_USED: '41-1102',
    LATE_FEE_INCOME: '42-1102',
    COMMISSION_INCOME: '42-1105',
    COGS_NEW: '51-1101',
    COGS_USED: '51-1102',
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
      select: { id: true },
    });
    return company?.id || null;
  }

  /**
   * Create + auto-post a journal entry. Validates debit = credit.
   * Returns the entry id, or null if validation fails (logs warning).
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

    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      this.logger.warn(
        `Journal not balanced for ${params.referenceType} ${params.referenceId}: Dr ${totalDebit} ≠ Cr ${totalCredit}`,
      );
      return null;
    }

    const entryNumber = await this.generateEntryNumber(tx);
    const entry = await tx.journalEntry.create({
      data: {
        entryNumber,
        companyId: params.companyId,
        entryDate: params.entryDate,
        description: params.description,
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
   *   Cr. Hire-Purchase Receivable   [monthlyPrincipal]
   *   Cr. Commission Income          [monthlyCommission]
   *   Cr. VAT Output                 [vatAmount]
   *   Cr. Late Fee Income            [lateFee — if any]
   *
   * Note: monthlyInterest is treated as part of HP receivable settlement
   * under cash basis — already booked when contract was activated.
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

    const amountPaid = Number(params.payment.amountPaid);
    const principal = Number(params.payment.monthlyPrincipal || 0);
    const interest = Number(params.payment.monthlyInterest || 0);
    const commission = Number(params.payment.monthlyCommission || 0);
    const vat = Number(params.payment.vatAmount || 0);
    const lateFee = params.payment.lateFeeWaived ? 0 : Number(params.payment.lateFee || 0);

    // Settle HP receivable = principal + interest (both reduce the receivable)
    const hpSettled = principal + interest;
    // If breakdown is missing, settle whole amount against receivable as fallback
    const fallbackHp = hpSettled === 0 && commission === 0 && vat === 0 && lateFee === 0
      ? amountPaid - lateFee
      : hpSettled;

    return this.createAndPost(tx, {
      companyId,
      entryDate: params.payment.paidDate || new Date(),
      description: `รับชำระค่างวด งวดที่ ${params.payment.installmentNo} สัญญา ${params.contract.contractNumber}`,
      referenceType: 'PAYMENT',
      referenceId: params.payment.id,
      createdById: params.userId,
      lines: [
        { accountCode: JournalAutoService.ACC.CASH, description: 'รับชำระเงิน', debit: amountPaid, credit: 0 },
        { accountCode: JournalAutoService.ACC.HP_RECEIVABLE, description: 'ตัดลูกหนี้เช่าซื้อ', debit: 0, credit: fallbackHp },
        { accountCode: JournalAutoService.ACC.COMMISSION_INCOME, description: 'รายได้ค่าคอมมิชชัน', debit: 0, credit: commission },
        { accountCode: JournalAutoService.ACC.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vat },
        { accountCode: JournalAutoService.ACC.LATE_FEE_INCOME, description: 'ค่าปรับล่าช้า', debit: 0, credit: lateFee },
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

    const amount = Number(params.expense.amount);
    const vat = Number(params.expense.vatAmount || 0);
    const total = Number(params.expense.totalAmount);

    return this.createAndPost(tx, {
      companyId,
      entryDate: params.expense.paymentDate || params.expense.expenseDate,
      description: `จ่ายค่าใช้จ่าย ${params.expense.expenseNumber}: ${params.expense.description}`,
      referenceType: 'EXPENSE',
      referenceId: params.expense.id,
      createdById: params.userId,
      lines: [
        { accountCode: params.expense.accountCode, description: params.expense.description, debit: amount, credit: 0 },
        { accountCode: JournalAutoService.ACC.VAT_INPUT, description: 'ภาษีซื้อ', debit: vat, credit: 0 },
        { accountCode: JournalAutoService.ACC.CASH, description: 'จ่ายเงิน', debit: 0, credit: total },
      ],
    });
  }

  /**
   * Auto journal — Contract activated (cash sale of goods + receivable creation).
   *
   * Dr. Cash/Bank                       [downPayment]
   * Dr. Hire-Purchase Receivable        [financedAmount]
   *   Cr. Sales Revenue                 [sellingPrice + commission + interest]
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

    const sellingPrice = Number(params.contract.sellingPrice);
    const downPayment = Number(params.contract.downPayment);
    const financedAmount = Number(params.contract.financedAmount);
    const interest = Number(params.contract.interestTotal);
    const commission = Number(params.contract.storeCommission);
    const vat = Number(params.contract.vatAmount);
    const cost = Number(params.product.costPrice || 0);

    // Sales revenue = sellingPrice + interest + commission (full deal value, excl. VAT)
    const revenue = sellingPrice + interest + commission;
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
        { accountCode: JournalAutoService.ACC.CASH, description: 'รับเงินดาวน์', debit: downPayment, credit: 0 },
        { accountCode: JournalAutoService.ACC.HP_RECEIVABLE, description: 'ลูกหนี้เช่าซื้อ', debit: financedAmount, credit: 0 },
        { accountCode: revenueAcc, description: 'รายได้จากการขาย', debit: 0, credit: revenue },
        { accountCode: JournalAutoService.ACC.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vat },
      ],
    });

    // COGS entry (if cost available)
    if (cost > 0) {
      await this.createAndPost(tx, {
        companyId,
        entryDate: new Date(),
        description: `ต้นทุนสินค้า สัญญา ${params.contract.contractNumber}`,
        referenceType: 'CONTRACT_COGS',
        referenceId: params.contract.id,
        createdById: params.userId,
        lines: [
          { accountCode: cogsAcc, description: 'ต้นทุนขาย', debit: cost, credit: 0 },
          { accountCode: inventoryAcc, description: 'ตัดสินค้าคงเหลือ', debit: 0, credit: cost },
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
        debit: Number(l.credit), // swap
        credit: Number(l.debit),
      })),
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

    const accountMap = new Map<string, { totalDebit: number; totalCredit: number }>();
    for (const line of lines) {
      const acc = accountMap.get(line.accountCode) || { totalDebit: 0, totalCredit: 0 };
      acc.totalDebit += Number(line.debit);
      acc.totalCredit += Number(line.credit);
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
          totalDebit: Math.round(sums.totalDebit * 100) / 100,
          totalCredit: Math.round(sums.totalCredit * 100) / 100,
          balance: Math.round((sums.totalDebit - sums.totalCredit) * 100) / 100,
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
