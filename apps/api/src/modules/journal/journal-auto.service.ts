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
    UNEARNED_COMMISSION: '21-2201', // Phase A.2 — deferred commission income
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
    VAT_OUTPUT_PENDING: '21-2102', // Phase A.2 — deferred output VAT (booked at activation, drained per payment)
    CUSTOMER_CREDIT: '21-5101',
    DUE_TO_SHOP: '21-1102',
    BAD_DEBT_EXPENSE: '53-1701',
    COMMISSION_EXPENSE: '53-1801',
    LOSS_ON_REPO_RESALE: '53-1804',
    UNEARNED_INTEREST: '21-2202', // Phase A.2 — deferred interest income
  } as const;

  constructor(private prisma: PrismaService) {}

  private async generateEntryNumber(tx: Prisma.TransactionClient): Promise<string> {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `JE-${ym}`;

    // SELECT ... FOR UPDATE serialises concurrent inserts in the same month-prefix.
    // count()-based generation race-conditions when two transactions read the same
    // count and produce identical entry numbers — Phase A.1b doubled the surface
    // by posting paired SHOP+FINANCE entries per business operation. Same pattern
    // as receipts.service.generateReceiptNumber (verified working).
    const result = await (tx as unknown as { $queryRaw: typeof PrismaService.prototype.$queryRaw }).$queryRaw<
      Array<{ entryNumber: string }>
    >`
      SELECT entry_number AS "entryNumber" FROM journal_entries
      WHERE entry_number LIKE ${prefix + '%'}
      ORDER BY entry_number DESC
      LIMIT 1
      FOR UPDATE
    `;

    let seq = 1;
    if (result.length > 0) {
      const lastSeq = parseInt(result[0].entryNumber.replace(`${prefix}-`, ''), 10);
      if (!Number.isNaN(lastSeq)) seq = lastSeq + 1;
    }
    return `${prefix}-${String(seq).padStart(4, '0')}`;
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

    // Phase A.2 model: HP Receivable was loaded with the full installment
    // (principal + commission + interest + VAT) at activation. Each payment
    // drains the receivable by the installment portion of cash received
    // (= amountPaid - lateFee). Late fees are recognised as separate income.
    const isZeroBreakdown =
      principal.isZero() && interest.isZero() && commission.isZero() && vat.isZero() && lateFee.isZero();
    const hpReceivableCredit = isZeroBreakdown ? amountPaid.sub(lateFee) : amountPaid.sub(lateFee);

    const intercompanyId = commission.gt(0) ? generateInterCompanyId() : null;
    const baseDesc = `รับชำระค่างวด งวดที่ ${params.payment.installmentNo} สัญญา ${params.contract.contractNumber}`;

    // FINANCE entry (always).
    // Phase A.2 deferred-recognition lines:
    //   Dr Unearned Interest          → Cr Interest Income       (recognise interest as earned)
    //   Dr Output VAT Pending         → Cr Output VAT (PP.30)    (recognise VAT as payable)
    // Removed: Cr Due-to-SHOP (commission was already accrued in full at
    // contract activation; per-payment Cr would double-create the liability).
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
        { accountCode: FA.UNEARNED_INTEREST, description: 'ตัดดอกเบี้ยรอตัดบัญชี', debit: interest.toNumber(), credit: 0 },
        { accountCode: FA.VAT_OUTPUT_PENDING, description: 'ตัดภาษีขายรอเรียกเก็บ', debit: vat.toNumber(), credit: 0 },
        { accountCode: FA.HP_RECEIVABLE, description: 'ตัดลูกหนี้เช่าซื้อ', debit: 0, credit: hpReceivableCredit.toNumber() },
        { accountCode: FA.INTEREST_INCOME, description: 'รายได้ดอกเบี้ยเช่าซื้อ', debit: 0, credit: interest.toNumber() },
        { accountCode: FA.LATE_FEE_INCOME, description: 'ค่าปรับล่าช้า', debit: 0, credit: lateFee.toNumber() },
        { accountCode: FA.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vat.toNumber() },
      ],
    });

    // SHOP entry — only when commission > 0.
    // Phase A.2: recognise commission as earned by draining Unearned Commission.
    // Removed: Dr Due-from-FINANCE (receivable already established at activation).
    if (commission.gt(0) && shopCompanyId && intercompanyId) {
      await this.createAndPost(tx, {
        companyId: shopCompanyId,
        entryDate: params.payment.paidDate || new Date(),
        description: formatInterCompanyDescription(intercompanyId, `${baseDesc} (SHOP commission)`),
        referenceType: 'PAYMENT',
        referenceId: params.payment.id,
        createdById: params.userId,
        lines: [
          { accountCode: SA.UNEARNED_COMMISSION, description: 'ตัดค่านายหน้ารอตัดบัญชี', debit: commission.toNumber(), credit: 0 },
          { accountCode: SA.COMMISSION_INCOME, description: 'รายได้ค่านายหน้า', debit: 0, credit: commission.toNumber() },
        ],
      });
    }

    return financeEntryId;
  }

  /**
   * Phase A.1c — Early payoff JE (handles discount).
   *
   * When a customer closes their contract early with a discount, the
   * collected cash is LESS than the sum of remaining installments. The
   * principal must always be settled in full (otherwise HP Receivable
   * stays inflated and the device remains on the FINANCE balance sheet).
   * The discount is absorbed by reducing recognised interest, commission,
   * and VAT proportionally.
   *
   * FINANCE entry:
   *   Dr. Cash (FINANCE)               [totalPayoff incl. late fees]
   *     Cr. HP Receivable               [sum of remaining principal]
   *     Cr. Interest Income             [scaled-down interest]
   *     Cr. VAT Output                  [scaled-down VAT]
   *     Cr. Late Fee Income             [unpaid late fees]
   *     Cr. Due-to-SHOP                 [scaled-down commission, if > 0]
   *
   * SHOP entry (only when commission > 0):
   *   Dr. Due-from-FINANCE              [commission]
   *     Cr. Commission Income           [commission]
   *
   * Linked via [IC-<uuid>] description prefix.
   *
   * Caller is responsible for updating Payment rows; this method only posts
   * the aggregated JE for the whole payoff.
   */
  async createEarlyPayoffJournal(
    tx: Prisma.TransactionClient,
    params: {
      contractId: string;
      contractNumber: string;
      installments: Array<{
        amountDue: Decimal | number | null;
        amountPaidBefore: Decimal | number | null;
        monthlyPrincipal: Decimal | number | null;
        monthlyInterest: Decimal | number | null;
        monthlyCommission: Decimal | number | null;
        vatAmount: Decimal | number | null;
        lateFee: Decimal | number | null;
        lateFeeWaived: boolean;
      }>;
      totalPayoff: Decimal | number; // cash debit, includes late fees
      userId: string;
      shopCompanyId?: string | null;
      financeCompanyId?: string | null;
      paidDate?: Date | null;
    },
  ): Promise<string | null> {
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
      throw new InternalServerErrorException('FINANCE company required for early payoff JE');
    }

    // Per-installment remaining breakdown — scale by (1 - amountPaidBefore/amountDue).
    let sumPrincipal = new Prisma.Decimal(0);
    let sumInterestOrig = new Prisma.Decimal(0);
    let sumCommissionOrig = new Prisma.Decimal(0);
    let sumVatOrig = new Prisma.Decimal(0);
    let sumLateFee = new Prisma.Decimal(0);

    for (const inst of params.installments) {
      const amountDue = new Prisma.Decimal(inst.amountDue ?? 0);
      const amountPaidBefore = new Prisma.Decimal(inst.amountPaidBefore ?? 0);
      const ratioRemaining = amountDue.gt(0)
        ? Prisma.Decimal.max(0, new Prisma.Decimal(1).sub(amountPaidBefore.div(amountDue)))
        : new Prisma.Decimal(1);
      sumPrincipal = sumPrincipal.add(new Prisma.Decimal(inst.monthlyPrincipal ?? 0).mul(ratioRemaining));
      sumInterestOrig = sumInterestOrig.add(new Prisma.Decimal(inst.monthlyInterest ?? 0).mul(ratioRemaining));
      sumCommissionOrig = sumCommissionOrig.add(new Prisma.Decimal(inst.monthlyCommission ?? 0).mul(ratioRemaining));
      sumVatOrig = sumVatOrig.add(new Prisma.Decimal(inst.vatAmount ?? 0).mul(ratioRemaining));
      if (!inst.lateFeeWaived) {
        sumLateFee = sumLateFee.add(new Prisma.Decimal(inst.lateFee ?? 0));
      }
    }

    sumPrincipal = sumPrincipal.toDecimalPlaces(2);
    sumInterestOrig = sumInterestOrig.toDecimalPlaces(2);
    sumCommissionOrig = sumCommissionOrig.toDecimalPlaces(2);
    sumVatOrig = sumVatOrig.toDecimalPlaces(2);
    sumLateFee = sumLateFee.toDecimalPlaces(2);

    const cash = new Prisma.Decimal(params.totalPayoff);
    const cashExclLateFee = cash.sub(sumLateFee);
    const sumOtherOrig = sumInterestOrig.add(sumCommissionOrig).add(sumVatOrig);
    // Total receivable owed for the unpaid installments (= what HP Receivable
    // must drain by — installments were loaded with full breakdown at activation).
    const sumOwedExclLateFee = sumPrincipal.add(sumOtherOrig);

    // Phase A.2: discount allocates proportionally across interest/commission/vat.
    // Principal must always be settled in full (HP Receivable drain to zero).
    let interestActual = new Prisma.Decimal(0);
    let commissionActual = new Prisma.Decimal(0);
    let vatActual = new Prisma.Decimal(0);
    const nonPrincipalActual = cashExclLateFee.sub(sumPrincipal);

    if (sumOtherOrig.gt(0)) {
      const scale = nonPrincipalActual.div(sumOtherOrig);
      interestActual = sumInterestOrig.mul(scale).toDecimalPlaces(2);
      commissionActual = sumCommissionOrig.mul(scale).toDecimalPlaces(2);
      vatActual = sumVatOrig.mul(scale).toDecimalPlaces(2);
      // Absorb rounding residual into interest so the entry balances exactly.
      const allocated = interestActual.add(commissionActual).add(vatActual);
      const residual = nonPrincipalActual.sub(allocated);
      if (!residual.isZero()) {
        interestActual = interestActual.add(residual).toDecimalPlaces(2);
      }
    } else {
      interestActual = nonPrincipalActual.toDecimalPlaces(2);
    }

    // Discount portions per component (forfeited income).
    const commissionDiscount = sumCommissionOrig.sub(commissionActual).toDecimalPlaces(2);

    const intercompanyId = sumCommissionOrig.gt(0) ? generateInterCompanyId() : null;
    const baseDesc = `ปิดสัญญาก่อนกำหนด — สัญญา ${params.contractNumber}`;
    const entryDate = params.paidDate ?? new Date();

    // FINANCE entry — Phase A.2:
    //   Dr Cash                       totalPayoff
    //   Dr Unearned Interest          sumInterestOrig                (drain full deferred)
    //   Dr VAT Pending                sumVatOrig                      (drain full deferred)
    //   Dr Due-to-SHOP                commissionDiscount              (FINANCE owes SHOP less)
    //     Cr HP Receivable             sumOwedExclLateFee             (drain receivable)
    //     Cr Interest Income           interestActual                  (recognize earned)
    //     Cr VAT Output (PP.30)        vatActual                       (recognize VAT collected)
    //     Cr Late Fee Income           sumLateFee
    // The implicit interest/VAT discount = (Unearned drain - Income recognised).
    const financeDesc = intercompanyId
      ? formatInterCompanyDescription(intercompanyId, `${baseDesc} (FINANCE)`)
      : baseDesc;
    const financeEntryId = await this.createAndPost(tx, {
      companyId: financeCompanyId,
      entryDate,
      description: financeDesc,
      referenceType: 'EARLY_PAYOFF',
      referenceId: params.contractId,
      createdById: params.userId,
      lines: [
        { accountCode: FA.CASH, description: 'รับชำระปิดก่อนกำหนด', debit: cash.toNumber(), credit: 0 },
        { accountCode: FA.UNEARNED_INTEREST, description: 'ตัดดอกเบี้ยรอตัดบัญชี', debit: sumInterestOrig.toNumber(), credit: 0 },
        { accountCode: FA.VAT_OUTPUT_PENDING, description: 'ตัดภาษีขายรอเรียกเก็บ', debit: sumVatOrig.toNumber(), credit: 0 },
        { accountCode: FA.DUE_TO_SHOP, description: 'ลดเจ้าหนี้ระหว่างบริษัท (ส่วนลดคอมมิชชัน)', debit: commissionDiscount.toNumber(), credit: 0 },
        { accountCode: FA.HP_RECEIVABLE, description: 'ตัดลูกหนี้เช่าซื้อ', debit: 0, credit: sumOwedExclLateFee.toNumber() },
        { accountCode: FA.INTEREST_INCOME, description: 'รายได้ดอกเบี้ยเช่าซื้อ', debit: 0, credit: interestActual.toNumber() },
        { accountCode: FA.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vatActual.toNumber() },
        { accountCode: FA.LATE_FEE_INCOME, description: 'ค่าปรับล่าช้า', debit: 0, credit: sumLateFee.toNumber() },
      ],
    });

    // SHOP entry — Phase A.2:
    //   Dr Unearned Commission         sumCommissionOrig             (drain full)
    //     Cr Commission Income          commissionActual              (recognize earned)
    //     Cr Due-from-FINANCE           commissionDiscount            (mirrors FINANCE Due-to-SHOP reduction)
    if (sumCommissionOrig.gt(0) && params.shopCompanyId && intercompanyId) {
      await this.createAndPost(tx, {
        companyId: params.shopCompanyId,
        entryDate,
        description: formatInterCompanyDescription(intercompanyId, `${baseDesc} (SHOP commission)`),
        referenceType: 'EARLY_PAYOFF',
        referenceId: params.contractId,
        createdById: params.userId,
        lines: [
          { accountCode: SA.UNEARNED_COMMISSION, description: 'ตัดค่านายหน้ารอตัดบัญชี', debit: sumCommissionOrig.toNumber(), credit: 0 },
          { accountCode: SA.COMMISSION_INCOME, description: 'รายได้ค่านายหน้า', debit: 0, credit: commissionActual.toNumber() },
          { accountCode: SA.DUE_FROM_FINANCE, description: 'ลดลูกหนี้ระหว่างบริษัท (ส่วนลดคอมมิชชัน)', debit: 0, credit: commissionDiscount.toNumber() },
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

    // Phase A.2: Same model as createPaymentJournal but Customer Credit replaces
    // Cash on the FINANCE side. HP Receivable drains by amountAllocated - lateFee
    // (= installment portion). Interest + VAT swap from deferred to recognised.
    // Late fee is rare for credit allocation but handled symmetrically.
    const hpReceivableCredit = amountAllocated.sub(effectiveLateFee);

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
        { accountCode: FA.UNEARNED_INTEREST, description: 'ตัดดอกเบี้ยรอตัดบัญชี', debit: interest.toNumber(), credit: 0 },
        { accountCode: FA.VAT_OUTPUT_PENDING, description: 'ตัดภาษีขายรอเรียกเก็บ', debit: vat.toNumber(), credit: 0 },
        { accountCode: FA.HP_RECEIVABLE, description: 'ตัดลูกหนี้เช่าซื้อ', debit: 0, credit: hpReceivableCredit.toNumber() },
        { accountCode: FA.INTEREST_INCOME, description: 'รายได้ดอกเบี้ยเช่าซื้อ', debit: 0, credit: interest.toNumber() },
        { accountCode: FA.LATE_FEE_INCOME, description: 'ค่าปรับล่าช้า', debit: 0, credit: effectiveLateFee.toNumber() },
        { accountCode: FA.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vat.toNumber() },
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
          { accountCode: SA.UNEARNED_COMMISSION, description: 'ตัดค่านายหน้ารอตัดบัญชี', debit: commission.toNumber(), credit: 0 },
          { accountCode: SA.COMMISSION_INCOME, description: 'รายได้ค่านายหน้า', debit: 0, credit: commission.toNumber() },
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
      // Phase A.2: defer commission income — recognised cash-basis per payment.
      shopLines.push({ accountCode: SA.UNEARNED_COMMISSION, description: 'รายได้ค่านายหน้ารอตัดบัญชี', debit: 0, credit: storeCommission.toNumber() });
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
      // Phase A.2: defer interest — recognised cash-basis per payment via
      // Dr Unearned Interest / Cr Interest Income in createPaymentJournal.
      financeLines.push({ accountCode: FA.UNEARNED_INTEREST, description: 'รายได้ดอกเบี้ยรอตัดบัญชี', debit: 0, credit: interestTotal.toNumber() });
    }
    if (vatAmount.greaterThan(0)) {
      // Phase A.2: defer VAT — VAT becomes payable to the revenue dept as
      // each installment's tax invoice is issued, not at activation.
      financeLines.push({ accountCode: FA.VAT_OUTPUT_PENDING, description: 'ภาษีขายรอเรียกเก็บ', debit: 0, credit: vatAmount.toNumber() });
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

    // Aggregate at the DB level — full table scan into memory was OOM-prone at scale.
    const grouped = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where,
      _sum: { debit: true, credit: true },
    });

    const codes = grouped.map((g) => g.accountCode);
    // Scope chart lookup by companyId — same code (e.g. 11-1101 Cash) can exist in
    // both SHOP and FINANCE charts with different names. Without the scope, names
    // would be silently mislabelled when one entity's row overwrites the other's.
    const chartAccounts = codes.length > 0
      ? await this.prisma.chartOfAccount.findMany({
          where: {
            code: { in: codes },
            ...(filters.companyId ? { companyId: filters.companyId } : {}),
          },
          select: { code: true, nameTh: true, accountGroup: true },
        })
      : [];

    const chartMap = new Map(chartAccounts.map((a) => [a.code, a]));

    const accounts = grouped
      .map((g) => {
        const totalDebit = new Prisma.Decimal(g._sum.debit ?? 0);
        const totalCredit = new Prisma.Decimal(g._sum.credit ?? 0);
        const chart = chartMap.get(g.accountCode);
        return {
          code: g.accountCode,
          nameTh: chart?.nameTh || '(ไม่พบในผังบัญชี)',
          accountGroup: chart?.accountGroup || 'UNKNOWN',
          totalDebit: totalDebit.toDecimalPlaces(2).toNumber(),
          totalCredit: totalCredit.toDecimalPlaces(2).toNumber(),
          balance: totalDebit.sub(totalCredit).toDecimalPlaces(2).toNumber(),
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
