import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { JournalAutoService, JeLineInput } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * P3-SP5 — Paired Journal Entries (SHOP ↔ FINANCE).
 *
 * Many Phase 3 SP5 flows touch BOTH SHOP and FINANCE simultaneously:
 *   - Installment contract activation: SHOP clears down-payment; FINANCE
 *     records HP receivable (already done by existing FINANCE templates).
 *   - Inventory transfer SHOP → FINANCE on contract activation.
 *   - FINANCE wire-out to SHOP for financed amount + commission.
 *
 * Each half has its own JournalEntry (own companyId, own entry number), but
 * the two MUST be posted atomically — partial-success leaves the books
 * out-of-balance across companies. This service wraps both halves in one
 * `$transaction` and stamps the SAME `metadata.batchId` on both so they can
 * be paired in audit reports.
 *
 * Why a separate service (vs. extending JournalAutoService)?
 *   - Keeps the single-JE path simple (most templates only touch one side).
 *   - The "two halves must balance independently" invariant is asserted up-
 *     front in `postPaired()` so callers get a clear error instead of a
 *     mid-tx unbalanced-Je failure.
 *
 * The `batchId` is set by this service (random UUID per call). Callers can
 * read it back from the returned object to write into their own audit logs.
 */
export interface PairedJeHalf {
  /** companyCode for this half — service resolves to companyId. */
  companyCode: 'SHOP' | 'FINANCE';
  description: string;
  reference?: string;
  /** Extra metadata to merge into the JE row (in addition to batchId). */
  metadata?: Record<string, unknown>;
  postedAt?: Date;
  lines: JeLineInput[];
}

export interface PairedJournalInput {
  shop: PairedJeHalf;
  finance: PairedJeHalf;
  /**
   * Shared business reference (e.g. contractId, transferId). Stamped on both
   * halves under `metadata.batchRef` so downstream queries can locate the pair.
   * Optional — `batchId` is always set even when this is omitted.
   */
  batchRef?: string;
}

export interface PairedJournalResult {
  batchId: string;
  shopJournalEntryId: string;
  shopEntryNumber: string;
  financeJournalEntryId: string;
  financeEntryNumber: string;
}

@Injectable()
export class PairedJournalService {
  private readonly logger = new Logger(PairedJournalService.name);

  // Cache companyId per code (lifetime of the service instance) — looked up
  // lazily because seed timing isn't guaranteed at module init in tests.
  private companyIdCache = new Map<string, string>();

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  private async resolveCompanyId(
    tx: Prisma.TransactionClient,
    code: 'SHOP' | 'FINANCE',
  ): Promise<string> {
    const cached = this.companyIdCache.get(code);
    if (cached) return cached;
    const co = await tx.companyInfo.findFirst({
      where: { companyCode: code, deletedAt: null },
      select: { id: true },
    });
    if (!co) {
      throw new BadRequestException(
        `Paired JE: ${code} CompanyInfo not found — run seed:coa first`,
      );
    }
    this.companyIdCache.set(code, co.id);
    return co.id;
  }

  /** Assert the half's Dr/Cr lines balance — surfaces a friendly error early. */
  private assertBalanced(half: PairedJeHalf, label: 'shop' | 'finance'): void {
    if (half.companyCode !== (label === 'shop' ? 'SHOP' : 'FINANCE')) {
      throw new BadRequestException(
        `Paired JE: ${label} half must have companyCode=${label.toUpperCase()} (got ${half.companyCode})`,
      );
    }
    if (half.lines.length < 2) {
      throw new BadRequestException(
        `Paired JE: ${label} half needs ≥2 lines (got ${half.lines.length})`,
      );
    }
    const totalDr = half.lines.reduce((s, l) => s.plus(l.dr), new Prisma.Decimal(0));
    const totalCr = half.lines.reduce((s, l) => s.plus(l.cr), new Prisma.Decimal(0));
    if (!totalDr.equals(totalCr)) {
      throw new BadRequestException(
        `Paired JE: ${label} half unbalanced — Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)}`,
      );
    }
  }

  /**
   * Post BOTH halves in a single `$transaction`. If either half throws, the
   * other half is rolled back automatically — there is no partial-success
   * window.
   */
  async postPaired(
    input: PairedJournalInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<PairedJournalResult> {
    this.assertBalanced(input.shop, 'shop');
    this.assertBalanced(input.finance, 'finance');

    const batchId = randomUUID();

    const exec = async (tx: Prisma.TransactionClient): Promise<PairedJournalResult> => {
      const shopCompanyId = await this.resolveCompanyId(tx, 'SHOP');
      const financeCompanyId = await this.resolveCompanyId(tx, 'FINANCE');

      const shopJe = await this.journal.createAndPost(
        {
          description: input.shop.description,
          reference: input.shop.reference,
          metadata: {
            ...(input.shop.metadata ?? {}),
            paired: true,
            batchId,
            batchSide: 'SHOP',
            ...(input.batchRef ? { batchRef: input.batchRef } : {}),
          },
          lines: input.shop.lines,
          postedAt: input.shop.postedAt,
          companyId: shopCompanyId,
        },
        tx,
      );

      const financeJe = await this.journal.createAndPost(
        {
          description: input.finance.description,
          reference: input.finance.reference,
          metadata: {
            ...(input.finance.metadata ?? {}),
            paired: true,
            batchId,
            batchSide: 'FINANCE',
            pairedWithJournalEntryId: shopJe.id,
            ...(input.batchRef ? { batchRef: input.batchRef } : {}),
          },
          lines: input.finance.lines,
          postedAt: input.finance.postedAt,
          companyId: financeCompanyId,
        },
        tx,
      );

      return {
        batchId,
        shopJournalEntryId: shopJe.id,
        shopEntryNumber: shopJe.entryNumber,
        financeJournalEntryId: financeJe.id,
        financeEntryNumber: financeJe.entryNumber,
      };
    };

    const result = outerTx ? await exec(outerTx) : await this.prisma.$transaction(exec);
    this.logger.log(
      `PairedJournalService — batchId=${result.batchId} SHOP=${result.shopEntryNumber} FINANCE=${result.financeEntryNumber}`,
    );
    return result;
  }
}
