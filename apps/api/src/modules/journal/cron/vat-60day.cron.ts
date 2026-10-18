import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { Vat60dayMandatoryTemplate } from '../cpa-templates/vat-60day-mandatory.template';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { ACCRUAL_EXCLUDED_CONTRACT_STATUSES } from '../accrual-contract-status';

/**
 * Runs daily at 02:00 Asia/Bangkok.
 *
 * Finds all InstallmentSchedule rows where:
 *   - dueDate < (today - 60 days) — strictly more than 60 days overdue per ม.82/3
 *   - vat60dayJournalEntryId is null (not yet processed)
 *   - No PAID Payment record (status='PAID' = fully settled per Payment lifecycle)
 *   - ฝ่ายบัญชี 16/10/2569 ข้อ 11.1: ยังไม่ได้ตั้งลูกหนี้งวด (accrualJournalEntryId ว่าง และ accruedAmount = accruedVat = 0) —
 *     งวดที่ตั้งภาษีขายเข้า 21-2101 แล้วห้ามตั้ง 21-2103 ซ้ำ · ถ้างวดถูกตั้ง 21-2103 ไปก่อนแล้ว 2A ค่อยตั้งทีหลัง
 *     (งวดบัญชีปิดแล้วเปิดใหม่ ฯลฯ) รอบ 2A กลับ 21-2103 เองในธุรกรรมเดียวกัน (`InstallmentAccrual2ATemplate.run`)
 *   - ฝ่ายบัญชี 16/10/2569 ข้อ 11.2: สัญญาไม่อยู่ใน ACCRUAL_EXCLUDED_CONTRACT_STATUSES (ยึดคืน/ปิด/ยกเลิกแล้ว
 *     ไม่ต้องจ่ายภาษีขาย 60 วัน) — รายการเดียวกับรอบตั้งลูกหนี้งวด
 *
 * For each candidate, fires Vat60dayMandatoryTemplate.execute().
 *
 * Idempotent: mandatory template is a no-op if vat60dayJournalEntryId is set.
 * Per-installment failures are captured to Sentry — cron continues on error.
 *
 * N+1 elimination: PAID-payment lookup is one batched query per cron run,
 * not one query per candidate.
 */
@Injectable()
export class Vat60dayCron {
  private readonly logger = new Logger(Vat60dayCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mandatory: Vat60dayMandatoryTemplate,
  ) {}

  /**
   * Returns the 60-day cutoff anchored to Asia/Bangkok midnight.
   *
   * Uses the Bangkok calendar date so the cutoff is stable regardless of
   * the host process timezone (Cloud Run defaults to UTC). Thailand does
   * not observe DST, so no DST adjustment is needed — the +07:00 offset
   * is constant year-round.
   */
  private getCutoffBangkok(): Date {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const bkkDate = formatter.format(new Date()); // YYYY-MM-DD in Bangkok
    const cutoff = new Date(`${bkkDate}T00:00:00+07:00`);
    cutoff.setDate(cutoff.getDate() - 60);
    return cutoff;
  }

  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ processed: number; failed: number }> {
    const cutoff = this.getCutoffBangkok();

    const candidates = await this.prisma.installmentSchedule.findMany({
      where: {
        // strict less-than: ม.82/3 = "เกิน 60 วัน" (strictly more than 60 days)
        dueDate: { lt: cutoff },
        vat60dayJournalEntryId: null,
        deletedAt: null,
        // ข้อ 11.1 — งวดที่ตั้งลูกหนี้งวดแล้ว (ทั้งงวด = ลิงก์ · บางส่วน = คอลัมน์ยอดสะสมตัวใดตัวหนึ่ง > 0) มีภาษีขายใน 21-2101 แล้ว
        accrualJournalEntryId: null,
        accruedAmount: { lte: 0 },
        accruedVat: { lte: 0 },
        // ข้อ 11.2 — สัญญาที่ยึดคืน/ปิด/ยกเลิกแล้ว
        contract: {
          deletedAt: null,
          status: { notIn: [...ACCRUAL_EXCLUDED_CONTRACT_STATUSES] },
        },
      },
      select: { id: true, contractId: true, installmentNo: true },
    });

    this.logger.log(`VAT 60-day cron: ${candidates.length} candidate(s) found`);

    if (candidates.length === 0) {
      this.logger.log('VAT 60-day cron complete: processed=0 failed=0');
      return { processed: 0, failed: 0 };
    }

    // Batch fetch all PAID (= fully settled) payments for these
    // (contractId, installmentNo) tuples in a single query. Avoids N+1.
    const contractIds = [...new Set(candidates.map((c) => c.contractId))];
    const installmentNos = [...new Set(candidates.map((c) => c.installmentNo))];
    const paidPayments = await this.prisma.payment.findMany({
      where: {
        contractId: { in: contractIds },
        installmentNo: { in: installmentNos },
        status: 'PAID',
        deletedAt: null,
      },
      select: { contractId: true, installmentNo: true },
    });
    const paidKey = (contractId: string, installmentNo: number) =>
      `${contractId}:${installmentNo}`;
    const paidSet = new Set(
      paidPayments.map((p) => paidKey(p.contractId, p.installmentNo)),
    );

    let processed = 0;
    let failed = 0;

    // Closed-period guard: the mandatory VAT JE posts to today's FINANCE period
    // (createAndPost defaults postedAt=now, companyId=FINANCE). Never silently post
    // into a CLOSED/SYNCED period past its grace window — mirror the 2A accrual cron.
    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    try {
      await validatePeriodOpen(this.prisma, new Date(), financeCompany?.id);
    } catch (e) {
      Sentry.captureMessage(
        `VAT 60-day cron skipped — current FINANCE period is closed (${candidates.length} candidate(s) deferred)`,
        { level: 'warning', extra: { reason: (e as Error).message } },
      );
      this.logger.warn(`VAT 60-day cron skipped — closed period: ${(e as Error).message}`);
      return { processed: 0, failed: 0 };
    }

    for (const inst of candidates) {
      // Skip fully-settled installments (status='PAID' = customer paid full amountDue
      // per the Payment lifecycle: PENDING → PARTIALLY_PAID → PAID)
      if (paidSet.has(paidKey(inst.contractId, inst.installmentNo))) continue;

      try {
        const result = await this.mandatory.execute(inst.id);
        if (result !== null) processed++;
      } catch (e) {
        failed++;
        Sentry.captureException(e, {
          extra: { installmentScheduleId: inst.id, contractId: inst.contractId },
        });
        this.logger.error(
          `VAT 60-day mandatory failed for installmentScheduleId=${inst.id}: ${(e as Error).message}`,
        );
      }
    }

    this.logger.log(`VAT 60-day cron complete: processed=${processed} failed=${failed}`);
    return { processed, failed };
  }
}
