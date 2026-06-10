import { Injectable, Logger, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { JournalAutoService } from '../../journal/journal-auto.service';

@Injectable()
export class AuditBackfillService {
  private readonly logger = new Logger(AuditBackfillService.name);

  constructor(
    private prisma: PrismaService,
    // Legacy dependency retained for DI compatibility. backfillJournals only
    // logs TODO stubs (Phase A.5 replay tool not yet implemented) and does not
    // call into it — kept so the provider wiring + tests remain stable.
    private journalAutoService: JournalAutoService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // Backfill — create missing journals for legacy contracts
  // ═══════════════════════════════════════════════════════════════

  async backfillJournals(options: { dryRun: boolean; limit?: number }): Promise<{
    dryRun: boolean;
    contracts: { total: number; backfilled: number; skipped: number; errors: number };
    payments: { total: number; backfilled: number; skipped: number; errors: number };
    details: { contractNumber: string; action: string; status: string; error?: string }[];
  }> {
    const details: { contractNumber: string; action: string; status: string; error?: string }[] = [];
    const stats = {
      contracts: { total: 0, backfilled: 0, skipped: 0, errors: 0 },
      payments: { total: 0, backfilled: 0, skipped: 0, errors: 0 },
    };

    // Find OWNER user for createdById
    const systemUser = await this.prisma.user.findFirst({
      where: { role: 'OWNER', deletedAt: null },
      select: { id: true },
    });
    if (!systemUser) {
      throw new NotFoundException('ไม่พบผู้ใช้ OWNER สำหรับ backfill');
    }

    // F-3-027 part 2/3 follow-up: resolve FINANCE companyId once for all
    // payment-journal backfills. HP installment receipts post to FINANCE-side
    // accounts and must pass companyId explicitly (Task 9 will validate via
    // allowedCompanies). Hoisted here so we don't query per payment.
    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!financeCompany) {
      throw new InternalServerErrorException('FINANCE company not configured');
    }
    const financeCompanyId = financeCompany.id;

    // Phase A.1b: SHOP companyId for the SHOP-side commission JE leg.
    // Optional — null is acceptable; JE will skip the commission entry.
    const shopCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const shopCompanyId = shopCompany?.id ?? null;

    // 1. Find orphan contracts (any non-DRAFT status without CONTRACT journal)
    const orphanContracts = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM contracts c
      WHERE c.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'CLOSED_BAD_DEBT')
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.reference_id = c.id
            AND je.reference_type = 'CONTRACT'
            AND je.deleted_at IS NULL
            AND je.status = 'POSTED'
        )
      ORDER BY c.created_at ASC
      LIMIT ${options.limit || 100}
    `;

    stats.contracts.total = orphanContracts.length;

    for (const { id: contractId } of orphanContracts) {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        include: {
          product: { select: { costPrice: true, category: true } },
          payments: {
            where: {
              deletedAt: null,
              status: { in: ['PAID', 'PARTIALLY_PAID'] },
              amountPaid: { gt: 0 },
            },
            orderBy: { installmentNo: 'asc' },
          },
        },
      });
      if (!contract) {
        stats.contracts.skipped++;
        continue;
      }

      // Backfill contract activation journal
      if (options.dryRun) {
        details.push({
          contractNumber: contract.contractNumber,
          action: 'CREATE_CONTRACT_JOURNAL',
          status: 'DRY_RUN',
        });
        stats.contracts.backfilled++;
      } else {
        // TODO Phase A.5: data-audit replay tool needs new templates once A.5 templates are implemented
        this.logger.warn(
          `[Phase A.4] Data audit contract JE replay skipped for ${contract.contractNumber} — TODO Phase A.5: replay tool needs new templates`,
        );
        details.push({
          contractNumber: contract.contractNumber,
          action: 'CREATE_CONTRACT_JOURNAL',
          status: 'SKIPPED_A4',
        });
        // continue to next contract; don't increment backfilled
      }

      // Backfill payment journals for this contract
      for (const payment of contract.payments) {
        // Check if payment journal already exists. PR-843/I2 Phase 3 PR 3.1:
        // new primitive receipt JEs key the payment via metadata.paymentId (the
        // scalar referenceId is a random UUID); legacy JEs key via referenceId ==
        // payment.id. Existence check only — findFirst across either shape.
        const existing = await this.prisma.journalEntry.findFirst({
          where: {
            // Payment JEs are referenceType 'AUTO' (not 'PAYMENT') — see above.
            referenceType: 'AUTO',
            deletedAt: null,
            status: 'POSTED',
            OR: [
              { referenceId: payment.id },
              { metadata: { path: ['paymentId'], equals: payment.id } as Prisma.JsonFilter },
            ],
          },
        });
        if (existing) {
          stats.payments.skipped++;
          continue;
        }

        stats.payments.total++;

        if (options.dryRun) {
          details.push({
            contractNumber: contract.contractNumber,
            action: `CREATE_PAYMENT_JOURNAL #${payment.installmentNo}`,
            status: 'DRY_RUN',
          });
          stats.payments.backfilled++;
        } else {
          // TODO Phase A.5: data-audit replay tool needs new templates once A.5 templates are implemented
          this.logger.warn(
            `[Phase A.4] Data audit payment JE replay skipped for ${contract.contractNumber} #${payment.installmentNo} — TODO Phase A.5: replay tool needs new templates`,
          );
          details.push({
            contractNumber: contract.contractNumber,
            action: `CREATE_PAYMENT_JOURNAL #${payment.installmentNo}`,
            status: 'SKIPPED_A4',
          });
          // continue to next payment; don't increment backfilled
        }
      }
    }

    return {
      dryRun: options.dryRun,
      contracts: stats.contracts,
      payments: stats.payments,
      details,
    };
  }
}
