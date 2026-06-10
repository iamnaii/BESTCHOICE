import { Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCallLogDto } from '../dto/create-call-log.dto';
import { BUSINESS_RULES } from '../../../utils/config.util';
import { DunningEngineService } from '../dunning-engine.service';
import { OverdueKpiService } from '../kpi.service';
import { PromiseService } from '../promise.service';
import { PaymentsService } from '../../payments/payments.service';
import { OverdueAnalyticsService } from './overdue-analytics.service';
import { validateSettlementDate, PROMISED_MAX_DAYS } from './settlement-date.util';

/** Signature of the facade-bound logContact (used by partialPaymentReschedule). */
type LogContactFn = ContactLogService['logContact'];

/**
 * Contact-logging + settlement actions for the overdue/collections module.
 *
 * Extracted from OverdueService as part of the behaviour-preserving decompose.
 * Holds the two contact $transactions:
 *   - logContact PROMISED branch — Serializable isolation + embeds
 *     promiseService.createPromise(tx) tx-handle passthrough (moved WHOLE)
 *   - logContact non-PROMISED branch — callLog.create + contract.update batch
 * plus createCallLog (callLog.create + auditLog.create, not in a $tx — same as
 * the original), recordSettlement, and partialPaymentReschedule.
 *
 * partialPaymentReschedule's INTENTIONAL cross-transaction separation is
 * preserved: paymentsService.autoAllocatePayment owns its own journal+receipt
 * $transaction; the subsequent reschedule (logContact) stays a separate tx.
 *
 * Re-enters the analytics seam via this.analytics (getBrokenPromiseCount +
 * computeFifoTargets). dunningEngine.executeEventTrigger is fired post-commit
 * (non-fatal) exactly as the original.
 */
export class ContactLogService {
  private readonly logger = new Logger(ContactLogService.name);

  constructor(
    private prisma: PrismaService,
    private promiseService: PromiseService,
    private paymentsService: PaymentsService,
    private dunningEngine: DunningEngineService,
    private kpiService: OverdueKpiService,
    private analytics: OverdueAnalyticsService,
  ) {}

  /**
   * Create a call log entry with audit trail
   */
  async createCallLog(dto: CreateCallLogDto, callerId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: dto.contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const callLog = await this.prisma.callLog.create({
      data: {
        contractId: dto.contractId,
        callerId,
        calledAt: new Date(dto.calledAt),
        result: dto.result,
        notes: dto.notes,
      },
      include: {
        caller: { select: { id: true, name: true } },
        contract: {
          select: { contractNumber: true, customer: { select: { name: true } } },
        },
      },
    });

    // Audit log for call
    await this.prisma.auditLog.create({
      data: {
        userId: callerId,
        action: 'CREATE_CALL_LOG',
        entity: 'call_log',
        entityId: callLog.id,
        newValue: {
          contractId: dto.contractId,
          contractNumber: contract.contractNumber,
          result: dto.result,
          calledAt: dto.calledAt,
        },
        ipAddress: '',
      },
    });

    return callLog;
  }

  /**
   * Record a settlement/promise-to-pay from a call.
   *
   * Rules:
   *  - settlementDate ต้อง > วันนี้ (จะ promise ย้อนหลังไม่ได้ — ป้องกันการกรอก
   *    วันเก่าเพื่อเบนความสนใจจาก aging bucket)
   *  - settlementDate ห่างจาก now เกิน 30 วัน → reject (นัดไกลเกินไป =
   *    staff พยายามยืดเวลาลูกหนี้)
   */
  async recordSettlement(
    contractId: string,
    callerId: string,
    dto: { settlementDate: string; settlementNotes: string; notes?: string },
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const now = new Date();
    const promised = new Date(dto.settlementDate);
    validateSettlementDate(promised, now);

    return this.prisma.callLog.create({
      data: {
        contractId,
        callerId,
        calledAt: now,
        result: 'PROMISED',
        notes: dto.notes,
        settlementDate: promised,
        settlementNotes: dto.settlementNotes,
      },
    });
  }

  /**
   * Log a contact attempt — creates a CallLog and updates lastContactDate
   * on the Contract. Optionally updates collectionNotes.
   *
   * Per-result side effects:
   *  - NO_ANSWER     → increment noAnswerCount, fire CALL_NO_ANSWER event trigger
   *  - ANSWERED      → reset noAnswerCount
   *  - PROMISED      → reset noAnswerCount, fire CALL_ANSWERED_PROMISE event trigger
   *  - REFUSED       → reset noAnswerCount, fire CALL_REFUSED event trigger
   *  - WRONG_NUMBER  → set needsSkipTracing=true
   *  - OTHER         → no side effects
   *
   * Event trigger fires AFTER the DB transaction commits — failure is non-fatal.
   */
  async logContact(
    contractId: string,
    callerId: string,
    dto: {
      result: string;
      notes?: string;
      collectionNotes?: string;
      settlementDate?: string;
      settlementNotes?: string;
      // P1 Task 12 quick-tag enums (optional, back-compat).
      callResult?:
        | 'ANSWERED'
        | 'NO_ANSWER'
        | 'BUSY'
        | 'DEVICE_OFF'
        | 'UNREACHABLE';
      negotiationResult?:
        | 'REQUESTED_EXTENSION'
        | 'WILL_PAY'
        | 'REFUSED'
        | 'REQUESTED_RETURN'
        | 'NEGOTIATING'
        | 'NOT_APPLICABLE';
      // P2 Task 4 — voice memo evidence (S3 URL). Stored on CallLog.
      voiceMemoUrl?: string;
      // P2 Task 10 — structured promise slots (replaces legacy single/dual settlement fields).
      slots?: Array<{ settlementDate: string; settlementAmount: number; notes?: string }>;
      targetInstallmentIds?: string[];
      settlementAmount?: number | string;
    },
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const now = new Date();

    // P2 Task 11 — route PROMISED results through PromiseService (creates
    // PromiseSlot records, handles broken-promise detection, cycle deadline
    // validation, FIFO installment targeting, and AuditLog).
    if (dto.result === 'PROMISED') {
      // Escalation Guardrail: ผิดนัด ≥ threshold → ห้าม PROMISED ต้อง escalate ก่อน
      const brokenCount = await this.analytics.getBrokenPromiseCount(contractId);
      if (brokenCount >= BUSINESS_RULES.ESCALATION_BROKEN_PROMISE_THRESHOLD) {
        throw new BadRequestException({
          message: `ลูกค้าผิดนัดมาแล้ว ${brokenCount} ครั้ง — ห้ามนัดเพิ่ม ต้อง escalate ก่อน`,
          requiresEscalation: true,
          brokenPromiseCount: brokenCount,
          threshold: BUSINESS_RULES.ESCALATION_BROKEN_PROMISE_THRESHOLD,
        });
      }

      // Hard 30-day cap on legacy settlementDate (mirror recordSettlement).
      // PromiseService also enforces cycleDeadline per-slot for the new path.
      if (dto.settlementDate) {
        const promised = new Date(dto.settlementDate);
        validateSettlementDate(promised, now);
      }

      // Build slots from either new dto.slots OR legacy single-settlement field.
      const slotsInput =
        dto.slots && dto.slots.length > 0
          ? dto.slots.map((s) => ({
              settlementDate: new Date(s.settlementDate),
              settlementAmount: s.settlementAmount,
              notes: s.notes,
            }))
          : dto.settlementDate
            ? [
                {
                  settlementDate: new Date(dto.settlementDate),
                  settlementAmount: Number(dto.settlementAmount ?? 0),
                },
              ]
            : [];

      if (slotsInput.length === 0) {
        throw new BadRequestException('ต้องระบุอย่างน้อย 1 ที่');
      }

      let totalPromiseAmount = new Prisma.Decimal(0);
      for (const s of slotsInput) {
        totalPromiseAmount = totalPromiseAmount.add(new Prisma.Decimal(s.settlementAmount));
      }

      const targetIds =
        dto.targetInstallmentIds && dto.targetInstallmentIds.length > 0
          ? dto.targetInstallmentIds
          : await this.analytics.computeFifoTargets(contractId, totalPromiseAmount.toNumber());

      // H2 fix: contract update + promise creation must commit atomically.
      // Previously the contract.update committed first; if createPromise threw
      // (e.g. cycleDeadline validation), the contract was left with a reset
      // contact date but no corresponding promise record.
      const newPromise = await this.prisma.$transaction(
        async (tx) => {
          await tx.contract.update({
            where: { id: contractId },
            data: {
              lastContactDate: now,
              dunningLastActionAt: now,
              ...(dto.collectionNotes !== undefined && { collectionNotes: dto.collectionNotes }),
              noAnswerCount: 0,
            },
          });
          return this.promiseService.createPromise(
            {
              contractId,
              userId: callerId,
              slots: slotsInput,
              targetInstallmentIds: targetIds,
              notes: dto.notes,
            },
            tx,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      // Fire CALL_ANSWERED_PROMISE event trigger — non-fatal.
      try {
        await this.dunningEngine.executeEventTrigger(
          'CALL_ANSWERED_PROMISE',
          contractId,
          null,
          newPromise.id,
        );
      } catch (err) {
        this.logger.warn(
          `executeEventTrigger failed for CALL_ANSWERED_PROMISE on contract ${contractId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }

      this.kpiService.invalidate();
      return newPromise;
    }

    // Per-result side effects + event-trigger key
    const resultMap: Record<
      string,
      {
        noAnswerDelta: 'inc' | 'reset' | 'keep';
        needsSkipTracing?: boolean;
        eventKey?: import('@prisma/client').DunningEventTrigger;
      }
    > = {
      NO_ANSWER:    { noAnswerDelta: 'inc',   eventKey: 'CALL_NO_ANSWER' },
      ANSWERED:     { noAnswerDelta: 'reset' },
      PROMISED:     { noAnswerDelta: 'reset', eventKey: 'CALL_ANSWERED_PROMISE' },
      REFUSED:      { noAnswerDelta: 'reset', eventKey: 'CALL_REFUSED' },
      WRONG_NUMBER: { noAnswerDelta: 'keep',  needsSkipTracing: true },
      OTHER:        { noAnswerDelta: 'keep' },
    };
    const plan = resultMap[dto.result] ?? { noAnswerDelta: 'keep' };

    const [callLog] = await this.prisma.$transaction([
      this.prisma.callLog.create({
        data: {
          contractId,
          callerId,
          calledAt: now,
          result: dto.result,
          notes: dto.notes ?? null,
          settlementDate: dto.settlementDate ? new Date(dto.settlementDate) : null,
          settlementNotes: dto.settlementNotes ?? null,
          // P1 Task 12 — quick-tag enums. Stored alongside the legacy `result`
          // free-string for back-compat. Analytics dashboards prefer these
          // structured columns going forward.
          callResult: dto.callResult ?? null,
          negotiationResult: dto.negotiationResult ?? null,
          // P2 Task 4 — voice memo (HOT tier by schema default until S3
          // lifecycle moves the object to GLACIER and a backfill cron flips
          // voiceMemoTier).
          voiceMemoUrl: dto.voiceMemoUrl ?? null,
        },
        include: { caller: { select: { id: true, name: true } } },
      }),
      this.prisma.contract.update({
        where: { id: contractId },
        data: {
          lastContactDate: now,
          dunningLastActionAt: now,
          ...(dto.collectionNotes !== undefined && { collectionNotes: dto.collectionNotes }),
          ...(plan.needsSkipTracing !== undefined && { needsSkipTracing: plan.needsSkipTracing }),
          ...(plan.noAnswerDelta === 'inc' && { noAnswerCount: { increment: 1 } }),
          ...(plan.noAnswerDelta === 'reset' && { noAnswerCount: 0 }),
        },
      }),
    ]);

    // Fire event trigger AFTER commit — failures non-fatal
    if (plan.eventKey) {
      try {
        await this.dunningEngine.executeEventTrigger(plan.eventKey, contractId, null, callLog.id);
      } catch (err) {
        this.logger.warn(
          `executeEventTrigger failed for ${plan.eventKey} on contract ${contractId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    // H2: drop stale KPI snapshots — logContact mutates counters that feed
    // queueToday, noAnswerCount-based filters, and promise-kept calcs.
    this.kpiService.invalidate();

    return callLog;
  }

  /**
   * "รับเงินบางส่วน + นัดส่วนที่เหลือ" — combo action สำหรับ collector
   *
   * เคสจริง: ลูกค้านัดจ่าย 1,000 แต่จ่ายจริง 300 + ขอเลื่อนส่วนที่เหลือ 700 พรุ่งนี้
   *
   * Sequence:
   *   1. รับเงิน amountPaid ผ่าน autoAllocatePayment (atomic, มี journal+receipt+LINE notify)
   *   2. คำนวณ outstanding ใหม่หลังรับเงิน
   *   3. สร้าง CallLog PROMISED ด้วย settlementAmount=outstanding-after,
   *      settlementDate=newSettlementDate
   *
   * Atomicity tradeoff: payment + call log อยู่คนละ transaction เพราะ autoAllocatePayment
   * มี $transaction ของตัวเอง. ถ้า logContact fail หลังรับเงินแล้ว, เงินยังถูกบันทึก
   * (correct: เงินรับมาแล้วเพิกถอนไม่ได้) — แค่ collector ต้อง log นัดใหม่ manual.
   */
  async partialPaymentReschedule(
    contractId: string,
    callerId: string,
    dto: {
      amountPaid: number;
      paymentMethod: string;
      evidenceUrl?: string;
      transactionRef?: string;
      newSettlementDate?: string;
      notes?: string;
    },
    // Facade-bound logContact, supplied per-call so it resolves the facade
    // instance the caller used (incl. a `jest.spyOn(service,'logContact')`
    // override). In production this forwards facade.logContact → this.logContact
    // — one indirection, identical behaviour. partialPaymentReschedule's
    // INTENTIONAL cross-tx payment separation is preserved (autoAllocatePayment
    // owns its own $tx; the reschedule logContact stays a separate $tx).
    logContactFn: LogContactFn,
  ) {
    // 1. Validate inputs + compute outstanding before payment.
    // Outstanding = "ยอดที่ค้างถึงงวดวันนี้" (mirrors getOverdueSummary +
    // queue.service): future PENDING installments must not be summed in.
    const now = new Date();
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      include: {
        payments: {
          where: {
            deletedAt: null,
            status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            dueDate: { lt: now },
          },
          select: { amountDue: true, amountPaid: true, lateFee: true },
        },
      },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const outstandingBefore = contract.payments.reduce((sum, p) => {
      const remaining = new Prisma.Decimal(p.amountDue).add(p.lateFee).sub(p.amountPaid);
      return sum.add(remaining);
    }, new Prisma.Decimal(0));

    if (outstandingBefore.lte(0)) {
      throw new BadRequestException('สัญญานี้ไม่มียอดค้างชำระ');
    }

    const paid = new Prisma.Decimal(dto.amountPaid);
    if (paid.gt(outstandingBefore)) {
      throw new BadRequestException('จำนวนเงินที่จ่ายเกินยอดค้างชำระทั้งหมด');
    }

    const isFullPayment = paid.equals(outstandingBefore);

    // Partial payment ต้องระบุวันนัดใหม่ + อนาคต + ไม่เกิน 30 วัน
    if (!isFullPayment) {
      if (!dto.newSettlementDate) {
        throw new BadRequestException(
          'จ่ายไม่ครบ — ต้องระบุวันที่นัดจ่ายส่วนที่เหลือ',
        );
      }
      const promisedDate = new Date(dto.newSettlementDate);
      validateSettlementDate(promisedDate, now, {
        invalid: 'วันที่นัดจ่ายไม่ถูกต้อง',
        notFuture: 'วันที่นัดจ่ายต้องเป็นวันในอนาคต',
        tooFar: `วันที่นัดจ่ายห่างจากวันนี้เกิน ${PROMISED_MAX_DAYS} วัน — กรุณาติดต่อหัวหน้างาน`,
      });
    }

    // 2. รับเงินผ่าน autoAllocatePayment (atomic + journal + receipt + LINE)
    // Fold transactionRef into notes — Payment row has no dedicated column
    // for it today, but finance needs the bank/QR ref preserved on the row
    // for statement reconciliation.
    const ref = dto.transactionRef?.trim();
    const notesWithRef = ref
      ? dto.notes
        ? `Ref: ${ref} — ${dto.notes}`
        : `Ref: ${ref}`
      : dto.notes;
    const allocation = await this.paymentsService.autoAllocatePayment(
      contractId,
      dto.amountPaid,
      dto.paymentMethod,
      callerId,
      notesWithRef,
      dto.evidenceUrl,
    );

    // 3. ถ้า partial → สร้าง CallLog PROMISED นัดส่วนที่เหลือ. ถ้า full → จบ
    const outstandingAfter = outstandingBefore.sub(paid).toNumber();
    let callLog: Awaited<ReturnType<LogContactFn>> | null = null;

    if (!isFullPayment) {
      try {
        callLog = await logContactFn(contractId, callerId, {
          result: 'PROMISED',
          notes: dto.notes,
          settlementDate: dto.newSettlementDate,
          settlementAmount: outstandingAfter,
          callResult: 'ANSWERED',
          negotiationResult: 'WILL_PAY',
        });
      } catch (err) {
        // Payment ผ่านแล้วแต่ log นัดใหม่ fail — log warning, ไม่ rollback payment
        // (เงินรับมาแล้วเพิกถอนไม่ได้ collector ต้อง log นัดใหม่ manual)
        this.logger.error(
          `partialPaymentReschedule: payment recorded but logContact failed for contract ${contractId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    // Drop stale KPI snapshots (collected-today, queueToday count, promise-kept)
    this.kpiService.invalidate();

    return {
      payment: allocation,
      callLog,
      outstandingBefore: outstandingBefore.toNumber(),
      amountPaid: dto.amountPaid,
      outstandingAfter,
      isFullPayment,
      newSettlementDate: dto.newSettlementDate ?? null,
    };
  }
}
