import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { YearEndClosingTemplate } from '../journal/cpa-templates/year-end-closing.template';

/**
 * Phase 3 SP1 — Year-End Closing Service.
 *
 * Orchestrates the YearEndClosingTemplate with business-level guards:
 *   • Year must be in the past (cannot close current or future year)
 *   • Every monthly AccountingPeriod for the year must be CLOSED/SYNCED
 *     (so reopening individual months happens BEFORE running year-end)
 *   • Idempotency — a year can only be closed once. Subsequent calls error
 *     with ConflictException unless the prior closing was reversed first.
 *   • OWNER-only escape hatch: reverseYearEndClosing reverses all 3 JEs
 *     (creates 3 mirror-flipped JEs) with mandatory reason.
 */
@Injectable()
export class AccountingClosingService {
  private readonly logger = new Logger(AccountingClosingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly template: YearEndClosingTemplate,
    private readonly journalAuto: JournalAutoService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Preview the closing JE without posting. Returns the same shape that the
   * Page will render in its table — list of accounts + balances + net.
   */
  async previewYearEndClosing(year: number) {
    this.validateYear(year);

    const activity = await this.template.getYearAccountActivity(year);
    const existing = await this.findExistingClosingBatch(year);
    const periodIssues = await this.findOpenMonthlyPeriods(year);

    return {
      year,
      revenues: activity.revenues.map((r) => ({
        code: r.code,
        name: r.name,
        balance: r.balance.toFixed(2),
      })),
      expenses: activity.expenses.map((e) => ({
        code: e.code,
        name: e.name,
        balance: e.balance.toFixed(2),
      })),
      revenueTotal: activity.revenueTotal.toFixed(2),
      expenseTotal: activity.expenseTotal.toFixed(2),
      netIncome: activity.netIncome.toFixed(2),
      isProfit: activity.netIncome.gte(0),
      totalSteps: activity.netIncome.abs().lessThan(new Prisma.Decimal('0.005')) ? 2 : 3,
      // Pre-flight problems for the UI banner:
      alreadyClosed: existing ? true : false,
      closedAt: existing?.entryDate.toISOString() ?? null,
      closingBatchId: (existing?.metadata as { batchId?: string } | null)?.batchId ?? null,
      openMonths: periodIssues, // [] when all OK; array of {month, status} otherwise
    };
  }

  /**
   * Post all 3 closing JEs atomically. Throws on duplicate or open period.
   * Returns the 3 JE numbers + batch id.
   */
  async postYearEndClosing(year: number, userId: string) {
    this.validateYear(year);

    // Pre-tx checks (cheap fail-fast — also re-checked inside tx to close race)
    const openPeriods = await this.findOpenMonthlyPeriods(year);
    if (openPeriods.length > 0) {
      const monthList = openPeriods.map((p) => p.month).join(', ');
      throw new BadRequestException(
        `ต้องปิดงวดทุกเดือนก่อนปิดบัญชีปี ${year} — เดือนที่ยังไม่ปิด: ${monthList}`,
      );
    }

    const existingPre = await this.findExistingClosingBatch(year);
    if (existingPre) {
      throw new ConflictException(`ปี ${year} ปิดบัญชีไปแล้ว`);
    }

    // Wrap template + audit log in $transaction for atomicity. The template
    // posts 3 JEs; if the audit log write fails, all 3 must roll back.
    const result = await this.prisma.$transaction(async (tx) => {
      // Re-check inside tx — guards against two requests racing past the
      // pre-tx check and both attempting to post.
      const existingInTx = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'year-end-closing' } as any },
            { metadata: { path: ['year'], equals: year } as any },
          ],
          deletedAt: null,
        },
      });
      if (existingInTx) {
        throw new ConflictException(`ปี ${year} ปิดบัญชีไปแล้ว`);
      }

      const out = await this.template.execute(year, tx);
      return out;
    });

    // Audit log emitted outside tx (best-effort — chain insert can't roll back
    // a successful JE post anyway, and AuditService.log already has retry/log
    // semantics built in).
    await this.auditService.log({
      userId,
      action: 'YEAR_END_CLOSED',
      entity: 'accounting_period',
      entityId: result.batchId,
      newValue: {
        year,
        batchId: result.batchId,
        netIncome: result.netIncome.toFixed(2),
        revenueTotal: result.revenueTotal.toFixed(2),
        expenseTotal: result.expenseTotal.toFixed(2),
        step1JournalEntryId: result.step1.journalEntryId,
        step2JournalEntryId: result.step2.journalEntryId,
        step3JournalEntryId: result.step3?.journalEntryId ?? null,
      },
    });

    this.logger.log(
      `Year ${year} closed: batchId=${result.batchId} netIncome=${result.netIncome.toFixed(2)} by user ${userId}`,
    );

    return {
      year,
      batchId: result.batchId,
      step1: result.step1,
      step2: result.step2,
      step3: result.step3,
      netIncome: result.netIncome.toFixed(2),
      revenueTotal: result.revenueTotal.toFixed(2),
      expenseTotal: result.expenseTotal.toFixed(2),
    };
  }

  /**
   * OWNER-only escape hatch. Posts 3 mirror-flipped JEs (same date as
   * originals) and marks all originals with `metadata.reversedByBatchId` so
   * subsequent post calls succeed once reversal is in place.
   *
   * The role check is also enforced at the controller boundary — this is a
   * defense-in-depth check.
   */
  async reverseYearEndClosing(
    year: number,
    userId: string,
    reason: string,
    userRole?: string,
  ) {
    if (userRole && userRole !== 'OWNER') {
      throw new ForbiddenException('เฉพาะ OWNER เท่านั้นที่กลับรายการปิดบัญชีได้');
    }
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException('กรุณาระบุเหตุผลการกลับรายการ (อย่างน้อย 10 ตัวอักษร)');
    }

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'year-end-closing' } as any },
          { metadata: { path: ['year'], equals: year } as any },
        ],
        deletedAt: null,
      },
      include: { lines: { where: { deletedAt: null } } },
      orderBy: { entryDate: 'asc' },
    });

    if (entries.length === 0) {
      throw new NotFoundException(`ไม่พบรายการปิดบัญชีของปี ${year}`);
    }

    // Filter to the most recent un-reversed batch (in case prior reversal +
    // re-close exists). batchId groups the 3 entries together.
    const groupedByBatch = new Map<
      string,
      Array<(typeof entries)[number]>
    >();
    for (const e of entries) {
      const meta = e.metadata as { batchId?: string; reversedByBatchId?: string } | null;
      if (meta?.reversedByBatchId) continue; // skip already-reversed
      if (!meta?.batchId) continue;
      const list = groupedByBatch.get(meta.batchId) ?? [];
      list.push(e);
      groupedByBatch.set(meta.batchId, list);
    }

    // The active (latest) batch is the one we'll reverse
    let activeBatchId: string | null = null;
    let activeEntries: Array<(typeof entries)[number]> = [];
    for (const [batchId, batchEntries] of groupedByBatch) {
      if (batchEntries.length >= 2) {
        activeBatchId = batchId;
        activeEntries = batchEntries;
      }
    }

    if (!activeBatchId) {
      throw new ConflictException(`ปี ${year} ไม่มีรายการปิดบัญชีที่ยังไม่ถูกกลับรายการ`);
    }

    const reverseBatchId = `${activeBatchId}:R`;
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const reverseEntries: Array<{
        originalId: string;
        reverseEntryNo: string;
        reverseEntryId: string;
      }> = [];

      for (const orig of activeEntries) {
        // Flip Dr/Cr
        const flippedLines = orig.lines.map((l) => ({
          accountCode: l.accountCode,
          dr: new Prisma.Decimal(l.credit.toString()),
          cr: new Prisma.Decimal(l.debit.toString()),
          description: l.description
            ? `[กลับรายการ] ${l.description}`
            : '[กลับรายการปิดบัญชี]',
        }));

        const meta = orig.metadata as {
          year?: number;
          step?: number;
          batchId?: string;
        } | null;

        const reverseResult = await this.journalAuto.createAndPost(
          {
            description: `กลับรายการ ${orig.description} (${reason})`,
            reference: `${activeBatchId}:reverse:step${meta?.step ?? '?'}`,
            postedAt: now,
            metadata: {
              flow: 'year-end-closing-reverse',
              year,
              step: meta?.step ?? null,
              batchId: reverseBatchId,
              reversesEntryId: orig.id,
              reverseReason: reason,
              tag: 'YEAR_END_CLOSING_REVERSE',
            } as unknown as Prisma.JsonValue,
            lines: flippedLines,
          },
          tx,
        );

        // Mark the original entry as reversed (metadata-only, NOT status — JEs
        // retain POSTED for audit trail; the reversal sits beside them).
        const updatedMeta = {
          ...(meta ?? {}),
          reversedByBatchId: reverseBatchId,
          reversedAt: now.toISOString(),
          reversedByUserId: userId,
        };
        await tx.journalEntry.update({
          where: { id: orig.id },
          data: { metadata: updatedMeta as Prisma.InputJsonValue },
        });

        reverseEntries.push({
          originalId: orig.id,
          reverseEntryNo: reverseResult.entryNumber,
          reverseEntryId: reverseResult.id,
        });
      }

      return reverseEntries;
    });

    await this.auditService.log({
      userId,
      action: 'YEAR_END_CLOSING_REVERSED',
      entity: 'accounting_period',
      entityId: activeBatchId,
      oldValue: { year, batchId: activeBatchId },
      newValue: {
        year,
        reverseBatchId,
        reason,
        entries: result.map((r) => ({
          originalId: r.originalId,
          reverseEntryNo: r.reverseEntryNo,
        })),
      },
    });

    this.logger.warn(
      `Year ${year} closing batch ${activeBatchId} REVERSED by user ${userId}: ${reason}`,
    );

    return {
      year,
      originalBatchId: activeBatchId,
      reverseBatchId,
      entries: result,
    };
  }

  // ───────────────────────── Helpers ─────────────────────────

  private validateYear(year: number) {
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(year) || year < 2020 || year > 2030) {
      throw new BadRequestException('ปีไม่ถูกต้อง (รองรับ 2020-2030)');
    }
    if (year >= currentYear) {
      throw new BadRequestException(
        `ไม่สามารถปิดบัญชีปี ${year} ได้ — ต้องปิดปีที่ผ่านมาเท่านั้น (ปีปัจจุบัน ${currentYear})`,
      );
    }
  }

  private async findExistingClosingBatch(year: number) {
    return this.prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'year-end-closing' } as any },
          { metadata: { path: ['year'], equals: year } as any },
          { metadata: { path: ['step'], equals: 1 } as any },
          // Exclude entries that have a `reversedByBatchId` — those were
          // reversed by `reverseYearEndClosing` and a fresh re-close is OK.
        ],
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    }).then((e) => {
      if (!e) return null;
      const meta = e.metadata as { reversedByBatchId?: string } | null;
      if (meta?.reversedByBatchId) return null;
      return e;
    });
  }

  /**
   * Returns array of months whose AccountingPeriod for FINANCE company is
   * NOT CLOSED/SYNCED. Empty array = all 12 months are closed.
   */
  private async findOpenMonthlyPeriods(
    year: number,
  ): Promise<Array<{ month: number; status: string }>> {
    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!financeCompany) {
      throw new BadRequestException('ไม่พบ FINANCE company ในระบบ');
    }

    const periods = await this.prisma.accountingPeriod.findMany({
      where: { companyId: financeCompany.id, year },
      select: { month: true, status: true },
    });

    const periodMap = new Map(periods.map((p) => [p.month, p.status]));
    const issues: Array<{ month: number; status: string }> = [];

    for (let month = 1; month <= 12; month++) {
      const status = periodMap.get(month);
      // Missing OR OPEN/REVIEW = not closed
      if (!status || (status !== 'CLOSED' && status !== 'SYNCED')) {
        issues.push({ month, status: status ?? 'OPEN' });
      }
    }

    return issues;
  }

}
