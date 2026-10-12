import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { RESIDUAL_PARK_TODO_TAG } from '../../payments/services/payment-helpers';
import {
  AdvanceExcessIncomeTemplate,
  type AdvanceExcessIncomeResult,
} from '../cpa-templates/advance-excess-income.template';
import { ADVANCE_EXCESS_EXCLUDED_CONTRACT_STATUSES } from '../advance-excess-income.util';

export interface AdvanceExcessSweepSummary {
  candidates: number;
  posted: number;
  alreadyPosted: number;
  columnsOnly: number;
  nothing: number;
  skippedPendingVoid: number;
  skippedClosedPeriod: number;
  retryNextTick: number;
  failed: number;
  todosCreated: number;
}

/**
 * รอบกวาดเงินพักส่วนเกิน → รายได้ 42-1106 — ทุกวัน 00:40 Asia/Bangkok (หลังรอบตั้งลูกหนี้งวด 00:01 และค่าเผื่อฯ 00:30).
 * PR4 ต6 — คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 3 (29/09/2569) · แผน `docs/superpowers/plans/2026-10-11-acct-review-pr4-advance-vat.md`
 * หมายเหตุ 4.
 *
 * ทำไมเป็นรอบกวาด ไม่ใช่ตอนรับชำระ (ผลตรวจ C1/I3/I4): `checkContractCompletion` ถูกเรียก**ก่อน**ใบรับชำระจะหัก 21-1103
 * ทั้ง 4 ทาง · ลิงก์ชำระ QR flip COMPLETED/EARLY_PAYOFF เองในธุรกรรม · สัญญาที่ครบงวดทางรอบกลางคืน (งวดสุดท้ายถูกเงินพัก
 * หักครบ) ไม่ถูก flip เลย ⇒ อ่านยอดในบัญชี**วันถัดไป**ที่จุดเดียวครอบทุกทาง (ล่าช้าไม่เกิน 1 วัน — ถ7 เจ้าของรับได้).
 *
 * การเลือกสัญญา (SQL นอกธุรกรรม): 21-1103 ของสัญญามียอด Cr หรือคอลัมน์ถัง > 0 → สถานะไม่อยู่ในรายการยกเว้น → `COMPLETED` /
 * `EARLY_PAYOFF` หรือ "มีแถว Payment ≥ 1 และไม่มีแถวที่ไม่ใช่ PAID" → ไม่มีคำขอยกเลิกใบเสร็จ (`VOID_RECEIPT`) ค้างคิวอนุมัติ
 * (ข้ามไปวันถัดไป — void ก่อนลงรายได้ทำให้ Payment กลับเป็นค้างและสัญญาหลุดเงื่อนไขเอง; หลังลงรายได้ ด่าน ต6ข บล็อก void).
 * ต่อสัญญา: template ลงใน Serializable tx ของตัวเอง (ยอดในบัญชี + ภาษีที่ยังค้าง อ่านใน tx) · P2002 = มีแล้ว · P2034 =
 * รอรอบถัดไป · งวดปิด = ข้าม + Sentry · error อื่น = Sentry ต่อสัญญา ไม่หยุด loop · ไม่ throw ออกจาก tick.
 *
 * งาน (Todo MEDIUM · tag `reschedule-park` เดิมของ alarm I-5 ที่ถูกถอด · dedup tag + เลขสัญญา + ยังไม่ DONE):
 *   POSTED       → แจ้งฝ่ายบัญชีเพื่อทราบ (เลขรายการ ยอด ภาษี) + เตือนว่ายกเลิกใบเสร็จของสัญญานี้ไม่ได้จนกว่าจะกลับรายการ
 *   COLUMNS_ONLY → คอลัมน์ถัง > 0 แต่บัญชี 21-1103 = 0 — ไม่ลงรายการ ให้ตรวจ (แทน alarm เดิมที่อ่านจากคอลัมน์)
 */
@Injectable()
export class AdvanceExcessIncomeCron {
  private readonly logger = new Logger(AdvanceExcessIncomeCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly template: AdvanceExcessIncomeTemplate,
  ) {}

  @Cron('40 0 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<AdvanceExcessSweepSummary> {
    const summary: AdvanceExcessSweepSummary = {
      candidates: 0,
      posted: 0,
      alreadyPosted: 0,
      columnsOnly: 0,
      nothing: 0,
      skippedPendingVoid: 0,
      skippedClosedPeriod: 0,
      retryNextTick: 0,
      failed: 0,
      todosCreated: 0,
    };
    try {
      const { eligible, pendingVoid } = await this.selectCandidates();
      summary.candidates = eligible.length;
      this.logger.log(
        `[advance-excess-income] ${eligible.length} candidate contract(s), ${pendingVoid.size} with a pending VOID_RECEIPT request`,
      );

      const todoActor = await this.resolveTodoActor();

      for (const c of eligible) {
        if (pendingVoid.has(c.id)) {
          summary.skippedPendingVoid++;
          this.logger.log(
            `[advance-excess-income] skip ${c.contractNumber} — VOID_RECEIPT request pending (re-evaluated next tick)`,
          );
          continue;
        }
        let result: AdvanceExcessIncomeResult;
        try {
          result = await this.template.execute(c.id);
        } catch (e) {
          this.classifyFailure(e, c, summary);
          continue;
        }
        switch (result.outcome) {
          case 'POSTED':
            summary.posted++;
            if (await this.notifyPosted(todoActor, result)) summary.todosCreated++;
            break;
          case 'COLUMNS_ONLY':
            summary.columnsOnly++;
            if (await this.notifyColumnsOnly(todoActor, result)) summary.todosCreated++;
            break;
          case 'ALREADY_POSTED':
            summary.alreadyPosted++;
            break;
          case 'NOTHING':
            summary.nothing++;
            break;
        }
      }
    } catch (e) {
      // ห้าม throw ออกจาก tick — scheduler ต้องไม่ตาย พรุ่งนี้ลองใหม่เอง
      summary.failed++;
      Sentry.captureException(e, { tags: { cron: 'advance-excess-income', scope: 'tick' } });
      this.logger.error(`[advance-excess-income] tick failed: ${(e as Error).message}`);
    }
    this.logger.log(
      `[advance-excess-income] complete: ${Object.entries(summary)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`,
    );
    return summary;
  }

  /** สัญญาที่เข้าเกณฑ์กวาด + ชุด id ที่มีคำขอ VOID_RECEIPT ค้างคิว */
  private async selectCandidates(): Promise<{
    eligible: Array<{ id: string; contractNumber: string }>;
    pendingVoid: Set<string>;
  }> {
    // (ก) 21-1103 ของสัญญายังมียอด Cr ในบัญชี — Prisma GROUP BY บน JSON path ไม่ได้ จึงเป็น raw SQL (รูปเดียวกับ
    // เลนส์คิวรอจ่ายใน interco-pending.service.ts)
    const glRows = await this.prisma.$queryRaw<Array<{ contract_id: string | null }>>`
      SELECT je.metadata->>'contractId' AS contract_id
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '21-1103'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
      GROUP BY 1
      HAVING SUM(jl.credit - jl.debit) > 0
    `;
    // (ข) คอลัมน์ถังยังค้าง (บัญชีอาจเป็น 0 แล้ว = คอลัมน์ไม่ตรงบัญชี → งานแจ้ง)
    const columnRows = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        OR: [{ advanceBalance: { gt: 0 } }, { rescheduleAdvanceBalance: { gt: 0 } }],
      },
      select: { id: true },
    });
    const ids = [
      ...new Set([
        ...glRows.map((r) => r.contract_id).filter((id): id is string => !!id),
        ...columnRows.map((r) => r.id),
      ]),
    ];
    if (ids.length === 0) return { eligible: [], pendingVoid: new Set() };

    const eligible = await this.prisma.contract.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        status: { notIn: [...ADVANCE_EXCESS_EXCLUDED_CONTRACT_STATUSES] },
        OR: [
          { status: { in: ['COMPLETED', 'EARLY_PAYOFF'] } },
          {
            AND: [
              { payments: { some: { deletedAt: null } } },
              { payments: { none: { deletedAt: null, status: { not: 'PAID' } } } },
            ],
          },
        ],
      },
      select: { id: true, contractNumber: true },
      orderBy: { contractNumber: 'asc' },
    });
    if (eligible.length === 0) return { eligible, pendingVoid: new Set() };

    const pending = await this.prisma.paymentApprovalRequest.findMany({
      where: {
        contractId: { in: eligible.map((c) => c.id) },
        action: 'VOID_RECEIPT',
        status: 'PENDING',
        deletedAt: null,
      },
      select: { contractId: true },
    });
    return { eligible, pendingVoid: new Set(pending.map((p) => p.contractId)) };
  }

  private classifyFailure(
    e: unknown,
    c: { id: string; contractNumber: string },
    summary: AdvanceExcessSweepSummary,
  ): void {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      // ชน writer Serializable ตัวอื่น (เช่น void ก่อนลงรายได้) — รอบพรุ่งนี้อ่านสภาพใหม่เอง
      summary.retryNextTick++;
      this.logger.warn(
        `[advance-excess-income] ${c.contractNumber}: serialization conflict (P2034) — retry next tick`,
      );
      return;
    }
    if (
      e instanceof BadRequestException &&
      String((e as Error).message).includes('งวดที่ปิดแล้ว')
    ) {
      summary.skippedClosedPeriod++;
      Sentry.captureMessage(
        `[advance-excess-income] skipped — closed FINANCE period (contract ${c.contractNumber})`,
        {
          level: 'warning',
          tags: { cron: 'advance-excess-income', signal: 'CLOSED_PERIOD' },
          extra: {
            contractId: c.id,
            contractNumber: c.contractNumber,
            reason: (e as Error).message,
          },
        },
      );
      this.logger.warn(
        `[advance-excess-income] ${c.contractNumber}: closed period — ${(e as Error).message}`,
      );
      return;
    }
    summary.failed++;
    Sentry.captureException(e, {
      tags: { cron: 'advance-excess-income' },
      extra: { contractId: c.id, contractNumber: c.contractNumber },
    });
    this.logger.error(
      `[advance-excess-income] ${c.contractNumber}: failed — ${(e as Error).message}`,
    );
  }

  /** ผู้สร้างงาน: SYSTEM user · ไม่มี = admin@bestchoice.com (ตัวเดียวกับที่ JournalAutoService ใช้) · ไม่มีทั้งคู่ = ไม่สร้างงาน */
  private async resolveTodoActor(): Promise<{ id: string } | null> {
    const system = await this.prisma.user.findFirst({
      where: { isSystemUser: true, deletedAt: null },
      select: { id: true },
    });
    if (system) return system;
    const admin = await this.prisma.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
      select: { id: true },
    });
    if (!admin) {
      this.logger.error(
        '[advance-excess-income] no SYSTEM/admin user — Todo notifications skipped',
      );
    }
    return admin;
  }

  /** dedup: tag + เลขสัญญาในหัวเรื่อง + ยังไม่ DONE (รูปเดียวกับ alarm I-5 เดิม) */
  private async createTodoOnce(
    actor: { id: string } | null,
    contractNumber: string,
    title: string,
    description: string,
  ): Promise<boolean> {
    if (!actor) return false;
    try {
      const existing = await this.prisma.todo.findFirst({
        where: {
          tags: { has: RESIDUAL_PARK_TODO_TAG },
          title: { contains: contractNumber },
          status: { not: 'DONE' },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existing) return false;
      await this.prisma.todo.create({
        data: {
          title,
          description,
          priority: 'MEDIUM',
          tags: [RESIDUAL_PARK_TODO_TAG],
          createdById: actor.id,
        },
      });
      return true;
    } catch (err) {
      // งานแจ้งพังต้องไม่ทำให้รอบกวาดล้ม — รายการบัญชี commit แล้ว Sentry ถือข้อมูลไว้
      Sentry.captureException(err, {
        tags: { cron: 'advance-excess-income', scope: 'todo' },
        extra: { contractNumber, title },
      });
      this.logger.error(
        `[advance-excess-income] Todo for ${contractNumber} failed: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private notifyPosted(
    actor: { id: string } | null,
    r: Extract<AdvanceExcessIncomeResult, { outcome: 'POSTED' }>,
  ): Promise<boolean> {
    const amount = r.amount.toFixed(2);
    return this.createTodoOnce(
      actor,
      r.contractNumber,
      `สัญญา ${r.contractNumber} — ลงรายได้เงินพักส่วนเกิน ${amount} บาท เข้า 42-1106 แล้ว (เพื่อทราบ)`,
      `รอบกวาดเงินพักส่วนเกิน (PR4 ต6) ลงรายการ ${r.entryNo}: Dr 21-1103 ${amount} / Cr 42-1106 ${r.income.toFixed(2)} ` +
        `/ Cr 21-2102 ${r.vat.toFixed(2)} (ภาษีขายของยอดนี้รับรู้ไปแล้ว ณ วันรับเงิน) — สัญญาผ่อนครบ/ปิดแล้วและยังมี ` +
        `เงินรับล่วงหน้าค้างในบัญชี 21-1103 ตามคำตอบฝ่ายบัญชี เล่ม 1 ข้อ 3 (29/09/2569) · คอลัมน์ advanceBalance / ` +
        `rescheduleAdvanceBalance ของสัญญาตั้งเป็น 0 แล้ว` +
        (r.columnsMismatch
          ? ` · คอลัมน์ก่อนลงไม่ตรงยอดในบัญชี (Sentry close-advance-ledger-mismatch) — ลงตามบัญชี กรุณาตรวจประวัติ`
          : '') +
        ` · การยกเลิกใบเสร็จ/คืนเงินของสัญญานี้ถูกปิดไว้จนกว่าผู้ดูแลระบบจะกลับรายการนี้ด้วยคำสั่ง advance-excess:reverse ` +
        `(ห้ามยกเลิกรายการบัญชีด้วยมือ) · contractId: ${r.contractId}`,
    );
  }

  private notifyColumnsOnly(
    actor: { id: string } | null,
    r: Extract<AdvanceExcessIncomeResult, { outcome: 'COLUMNS_ONLY' }>,
  ): Promise<boolean> {
    const total = r.advanceBalance.plus(r.rescheduleAdvanceBalance).toFixed(2);
    return this.createTodoOnce(
      actor,
      r.contractNumber,
      `สัญญา ${r.contractNumber} — คอลัมน์เงินรับล่วงหน้า/เงินพัก ${total} บาท แต่บัญชี 21-1103 = 0 (ตรวจสอบ)`,
      `สัญญาผ่อนครบ/ปิดแล้ว คอลัมน์ advanceBalance ${r.advanceBalance.toFixed(2)} + rescheduleAdvanceBalance ` +
        `${r.rescheduleAdvanceBalance.toFixed(2)} ยังค้าง แต่สมุดบัญชี 21-1103 ของสัญญาไม่มียอด — รอบกวาดเงินพักส่วนเกิน ` +
        `(PR4 ต6) ไม่ลงรายการ (ไม่มีเงินในบัญชีให้รับรู้) กรุณาตรวจว่าเงินถูกหักไปทางใดแล้วปรับคอลัมน์ให้ตรง · ` +
        `contractId: ${r.contractId}`,
    );
  }
}
