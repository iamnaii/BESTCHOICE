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

    // 3. entry number via advisory lock (per-month series)
    const postedAt = input.postedAt ?? new Date();
    const entryNumber = await this.generateEntryNumber(postedAt, client);

    // 4. create entry + lines (POSTED immediately — auto-generated entries skip DRAFT/SoD)
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
        // companyId required by schema — FINANCE company resolved at runtime
        // TODO T6+: pass companyId from caller context
        companyId: await this.resolveFinanceCompanyId(client),
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
  // TODO Phase A.4 T6-T14: the methods below are stubs replacing old A.0-A.3
  // implementations. Each will be replaced by a proper CPA template in the
  // corresponding task. Callers compile; no journal is written until the real
  // implementation lands.
  // -----------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createPaymentJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createPaymentJournal: stub — awaiting T6 CPA template');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createExpenseJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createExpenseJournal: stub — awaiting T7 CPA template');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createContractActivationJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createContractActivationJournal: stub — awaiting T8 CPA template');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createEarlyPayoffJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createEarlyPayoffJournal: stub — awaiting T9 CPA template');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createReversalJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createReversalJournal: stub — awaiting T10 CPA template');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createBadDebtProvisionJournal(_prisma: unknown, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createBadDebtProvisionJournal: stub — awaiting T11 CPA template');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createBadDebtWriteOffJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createBadDebtWriteOffJournal: stub — awaiting T12 CPA template');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createInterCompanySettlementJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createInterCompanySettlementJournal: stub — awaiting T13 CPA template');
  }

  async getTrialBalance(_args: { asOfDate?: string; companyId?: string }): Promise<unknown[]> {
    this.logger.warn('getTrialBalance: stub — awaiting T14 CPA template');
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCustomerCreditOverpaymentJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createCustomerCreditOverpaymentJournal: stub — awaiting T6 CPA template');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCreditAllocationJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createCreditAllocationJournal: stub — awaiting T6 CPA template');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createRepossessionResaleJournal(_tx: Prisma.TransactionClient, _args: Record<string, unknown>): Promise<void> {
    this.logger.warn('createRepossessionResaleJournal: stub — awaiting T12 CPA template');
  }
}
