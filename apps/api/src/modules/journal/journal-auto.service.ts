import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

export interface JeLineInput {
  accountCode: string;
  dr: Decimal;
  cr: Decimal;
  description?: string;
}

export interface CreateAndPostInput {
  description: string;
  reference?: string;
  metadata?: Prisma.JsonValue;
  lines: JeLineInput[];
  postedAt?: Date;
  /**
   * Optional companyId override. Defaults to FINANCE company.
   * Pass SHOP company id for SHOP-side flows (e.g. expense documents
   * are recorded against SHOP per Phase A.5b plan — see PR #795).
   */
  companyId?: string;
}

/**
 * Phase A.4 — single FINANCE chart, Full Accrual TFRS.
 * Per-case templates live in cpa-templates/ and call createAndPost.
 *
 * The old A.0-A.3 SHOP_ACC / FINANCE_ACC statics and inter-company methods
 * have been removed. New templates will be added by tasks T6-T14.
 */
@Injectable()
export class JournalAutoService {
  private readonly logger = new Logger(JournalAutoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createAndPost(
    input: CreateAndPostInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const client = (tx ?? this.prisma) as Prisma.TransactionClient;

    // 1. balanced check
    const totalDr = input.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const totalCr = input.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    if (!totalDr.equals(totalCr)) {
      const msg = `Unbalanced JE: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)} desc="${input.description}"`;
      Sentry.captureMessage(msg, 'error');
      throw new BadRequestException(msg);
    }

    // 2. resolve account ids by code (single chart in A.4 — no companyId scoping)
    const codes = [...new Set(input.lines.map((l) => l.accountCode))];
    const accounts = await client.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true, id: true },
    });
    const codeMap = new Map(accounts.map((a) => [a.code, a.id]));
    for (const code of codes) {
      if (!codeMap.has(code)) {
        throw new BadRequestException(`Account code not found in CoA: ${code}`);
      }
    }

    // 3. resolve companyId — defaults to FINANCE if caller didn't pass one.
    const postedAt = input.postedAt ?? new Date();
    const companyId = input.companyId ?? (await this.resolveFinanceCompanyId(client));

    // Fix #C9 (Round 2 — blast-radius correction):
    // The period-open guard was previously called HERE on every createAndPost
    // invocation. That broke payment + contract atomicity: a reopened FINANCE
    // period would reject the mid-tx JE write and roll back the Payment record.
    // Per-module guards are the right boundary — they run BEFORE opening the tx
    // and they know each module's date semantics (Payment.paidAt vs
    // EX.documentDate vs contract activation date). Module callers that already
    // honor period lock (verified 2026-05-14):
    //   - payments.service.ts:138       → validatePeriodOpen(new Date())
    //   - payments.service.ts:649,1003  → inside that same outer tx
    //   - contract-payment.service.ts:256 → validatePeriodOpen(paidDate)
    //   - receipts.service.ts:450       → validatePeriodOpen(new Date())
    //   - asset.service.ts (×4)         → validatePeriodOpen(activityDate, FINANCE)
    //   - asset-transfer.service.ts:105 → validatePeriodOpen(transferDate)
    //   - depreciation.service.ts (×2)  → validatePeriodOpen(periodStart)
    //   - journal.service.ts:62,201     → manual journal post + void
    //   - installment-accrual.cron:90   → validatePeriodOpen(inst.dueDate)
    // Expense module now guards at its own service entry points
    // (expense-documents.service.ts post() + voidDocument()) — see those
    // sites for the per-module period-lock invocation.
    // OtherIncomeTemplate sits inside other-income.service.post(), which is
    // also wrapped by its own period validation.

    // 4. entry number via advisory lock (per-month series)
    const entryNumber = await this.generateEntryNumber(postedAt, client);

    // 5. create entry + lines (POSTED immediately — auto-generated entries skip DRAFT/SoD)
    const entry = await client.journalEntry.create({
      data: {
        entryNumber,
        description: input.description,
        referenceType: input.reference ? 'AUTO' : null,
        referenceId: input.reference ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        entryDate: postedAt,
        status: 'POSTED',
        postedAt,
        // companyId required by schema. Defaults to FINANCE; callers (e.g.
        // expense-documents PR #795) pass SHOP id when posting SHOP-side flows.
        companyId,
        createdById: await this.resolveSystemUserId(client),
        lines: {
          create: input.lines.map((l) => ({
            accountCode: l.accountCode,
            debit: l.dr,
            credit: l.cr,
            description: l.description ?? null,
          })),
        },
      },
    });
    return { id: entry.id, entryNumber };
  }

  private async generateEntryNumber(
    postedAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const ym = `${postedAt.getFullYear()}${(postedAt.getMonth() + 1).toString().padStart(2, '0')}`;
    const lockKey = parseInt(ym, 10);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

    const start = new Date(postedAt.getFullYear(), postedAt.getMonth(), 1);
    const end = new Date(postedAt.getFullYear(), postedAt.getMonth() + 1, 1);
    const count = await tx.journalEntry.count({
      where: { entryDate: { gte: start, lt: end } },
    });
    return `JE-${ym}-${(count + 1).toString().padStart(5, '0')}`;
  }

  /** Resolve FINANCE company id — cached after first call. T6+ callers will pass companyId explicitly. */
  private financeCompanyId: string | null = null;
  private async resolveFinanceCompanyId(tx: Prisma.TransactionClient): Promise<string> {
    if (this.financeCompanyId) return this.financeCompanyId;
    const company = await tx.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new BadRequestException('FINANCE company not found in database');
    this.financeCompanyId = company.id;
    return company.id;
  }

  /** Resolve system user for auto-generated entries. T6+ callers will pass userId explicitly. */
  private systemUserId: string | null = null;
  private async resolveSystemUserId(tx: Prisma.TransactionClient): Promise<string> {
    if (this.systemUserId) return this.systemUserId;
    const user = await tx.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('System user not found');
    this.systemUserId = user.id;
    return user.id;
  }

  // -----------------------------------------------------------------------
  // C1 FIX (Phase A.4 PR #741 review): stubs now THROW instead of silently
  // dropping JE writes. Every caller that was silently losing journal entries
  // will now visibly fail in tests/dev, making unwired callers discoverable.
  // Wire each caller to the correct cpa-templates/ template in follow-up tasks
  // T6-T14 — see docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md
  // -----------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createPaymentJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createPaymentJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createExpenseJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createExpenseJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createContractActivationJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createContractActivationJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createEarlyPayoffJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createEarlyPayoffJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createReversalJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createReversalJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createBadDebtProvisionJournal(_prisma: unknown, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createBadDebtProvisionJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createBadDebtWriteOffJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createBadDebtWriteOffJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createInterCompanySettlementJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createInterCompanySettlementJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCustomerCreditOverpaymentJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createCustomerCreditOverpaymentJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCreditAllocationJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createCreditAllocationJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createRepossessionResaleJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    throw new Error(
      '[Phase A.4] createRepossessionResaleJournal stub — caller must migrate to new cpa-templates/. See docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md',
    );
  }
}
