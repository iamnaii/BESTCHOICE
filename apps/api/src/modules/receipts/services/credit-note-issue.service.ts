import {
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreditNoteDocumentService,
  CreditNoteSource,
} from './credit-note-document.service';
import { CreditNoteDeliveryService } from './credit-note-delivery.service';

/** `metadata.flow` value stamped by the JE templates, keyed by CN source. */
const FLOW_BY_SOURCE: Record<CreditNoteSource, string> = {
  REPOSSESSION: 'repossession',
  WRITE_OFF: 'write-off',
};

/**
 * Phase 3 CN Task 5 — manual CN issue endpoint logic (committed follow-up from
 * the 2026-07-24 CN phase: the auto-issue callers are RepossessionsService.create
 * and BadDebtService.writeOffBadDebt, both of which call
 * `CreditNoteDocumentService.issueForContract` inside the SAME `$transaction`
 * that posts the source JE. This service covers every OTHER case where a
 * REPOSSESSION/WRITE_OFF journal entry already exists but no CN document was
 * ever issued for it — e.g. a JE posted before the auto-issue wiring shipped,
 * or an attempt that failed between JE-commit and CN-issue.
 *
 * `issueForContract` is invoked from a transaction started HERE (not the
 * original JE-posting transaction, which already committed) — its internal
 * drift guard still protects us: it independently re-derives the CN
 * breakdown via `computeCnBreakdown` and asserts it matches
 * `journalEntry.metadata.creditNoteVatAmount`. A JE posted before the
 * 2026-07-26 pro-rate ruling landed (full-amount metadata) will fail that
 * assert — see `mapIssueError` below for the 422 this maps to.
 */
export class CreditNoteIssueService {
  private readonly logger = new Logger(CreditNoteIssueService.name);

  constructor(
    private prisma: PrismaService,
    private creditNoteDocumentService: CreditNoteDocumentService,
    private cnDeliveryService: CreditNoteDeliveryService | undefined,
  ) {}

  async issueManually(
    contractId: string,
    source: CreditNoteSource,
    actorUserId: string,
  ): Promise<{ receiptId: string; receiptNumber: string }> {
    const flow = FLOW_BY_SOURCE[source];

    const je = await this.prisma.journalEntry.findFirst({
      where: {
        status: 'POSTED',
        deletedAt: null,
        AND: [
          { metadata: { path: ['flow'], equals: flow } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
      },
      select: { entryNumber: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!je) {
      throw new NotFoundException('ไม่พบรายการบัญชีเลิกสัญญาสำหรับสัญญานี้');
    }

    let result: { receiptId: string; receiptNumber: string } | null = null;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const cnResult = await this.creditNoteDocumentService.issueForContract(
          {
            contractId,
            source,
            sourceJournalEntryNo: je.entryNumber,
            actorUserId,
          },
          tx,
        );

        if (cnResult.outcome !== 'ISSUED') {
          if (cnResult.outcome === 'SKIPPED_DUPLICATE') {
            throw new ConflictException('สัญญานี้มีใบลดหนี้จากแหล่งนี้แล้ว');
          }
          // Only remaining outcome: SKIPPED_NO_ACCRUED
          throw new UnprocessableEntityException(
            'ไม่พบงวดค้างชำระที่มีการตั้งค่าเจ้าหนี้ (accrual) สำหรับสัญญานี้ — ไม่สามารถออกใบลดหนี้ได้',
          );
        }

        return { receiptId: cnResult.receiptId, receiptNumber: cnResult.receiptNumber };
      });
    } catch (err) {
      throw this.mapIssueError(err);
    }

    // Post-commit only — a failed LINE push must never roll back the receipt
    // that was just created. Fire-and-forget, same pattern as
    // RepossessionsService.create / BadDebtService.writeOffBadDebt.
    if (result && this.cnDeliveryService) {
      void this.cnDeliveryService
        .deliver(result.receiptId)
        .catch((err) => Sentry.captureException(err));
    }

    return result!;
  }

  /**
   * `issueForContract`'s own drift guard throws a plain `Error` (not an
   * HttpException) when the recomputed CN VAT doesn't match the JE's stamped
   * `metadata.creditNoteVatAmount` — this happens for a JE posted before the
   * 2026-07-26 pro-rate ruling (full-amount metadata, no pro-rate). Map that
   * to a 422 advising a CPA-guided JE adjustment rather than a raw 500.
   * Any NestJS HttpException thrown above (Conflict/UnprocessableEntity for
   * SKIPPED_DUPLICATE/SKIPPED_NO_ACCRUED) passes through unchanged; anything
   * else unexpected is rethrown as-is (surfaces as 500).
   */
  private mapIssueError(err: unknown): unknown {
    if (err instanceof HttpException) {
      return err;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ไม่ตรงกับ Journal Entry')) {
      this.logger.warn(`[CN manual-issue] drift guard tripped: ${message}`);
      return new UnprocessableEntityException(
        'ยอด VAT ที่คำนวณใหม่ไม่ตรงกับ Journal Entry เดิม (น่าจะเป็น JE ที่ออกก่อนปรับสูตร pro-rate) — กรุณาปรึกษา CPA เพื่อพิจารณาปรับปรุงรายการบัญชีก่อนออกใบลดหนี้',
      );
    }
    return err;
  }
}
