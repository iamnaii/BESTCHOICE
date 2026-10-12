import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { JournalAutoService, type JeLineInput } from '../journal-auto.service';
import { CompanyResolverService } from '../company-resolver.service';
import { readContractCloseAdvances } from '../contract-close-advances';
import { emitDeferredWarnings, type DeferredWarning } from '../deferred-warning';
import {
  ADVANCE_VAT_CONSUME_DESCRIPTION,
  ADVANCE_VAT_META,
  resolveConsumeVat,
} from '../advance-vat';
import {
  ADVANCE_EXCESS_INCOME_ACCOUNT,
  ADVANCE_EXCESS_INCOME_AUDIT_ACTION,
  ADVANCE_EXCESS_INCOME_FLOW,
  ADVANCE_EXCESS_INCOME_REVERSE_FLOW,
  ADVANCE_EXCESS_INCOME_TAG,
  ADVANCE_EXCESS_REVERSED_AUDIT_ACTION,
  countAdvanceExcessIncomeEntries,
  isActiveAdvanceExcessEntry,
  listAdvanceExcessIncomeEntries,
} from '../advance-excess-income.util';

/**
 * รับรู้เงินพักส่วนเกินเป็นรายได้ 42-1106 (PR4 ต6 — คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 3, 29/09/2569 "เงินพักค่าปรับดิวสะสมเกิน").
 *
 * เรียกโดยรอบกวาดรายวัน 00:40 BKK (`advance-excess-income.cron.ts`) ต่อสัญญาที่ผ่อนครบ/ปิดแล้ว (ผู้เรียกคัดเลือก —
 * หมายเหตุ 4 ของแผน) — ลงใน `$transaction` Serializable ของตัวเอง **ห้ามเรียกจากธุรกรรมรับชำระ** (ผลตรวจ C1:
 * `checkContractCompletion` เกิดก่อนใบรับชำระจะหัก 21-1103 ⇒ อ่านที่นั่นจะหักซ้ำ).
 *
 *   Dr 21-1103 เงินรับล่วงหน้า        [ยอด Cr คงเหลือของสัญญาในบัญชี — ทุกถัง (ถ8)]
 *      Cr 42-1106 เงินพักค่าปรับดิวสะสมเกิน   [ยอด − ภาษี]
 *      Cr 21-2102 ภาษีขายรอเรียกเก็บ           [ภาษีที่รับรู้ตอนพักและยังค้าง — resolveConsumeVat (ต4)]
 *
 * `emptiesBucket = (GL 21-5101 ของสัญญา == 0)`: รายการนี้ล้างเฉพาะ 21-1103 — ถ้ายังมีเครดิต 21-5101 ค้าง (ถ3) ภาษีของเครดิต
 * นั้นต้องคงค้างไว้ ไม่ถูกกลับพร้อมเงินพัก. ขาภาษีประทับ `advanceVatConsume` ให้ `advanceVatOutstanding` ลดลง (T4 → T5).
 * ภาษีขายของยอดนี้รับรู้ไปแล้ว ณ วันรับเงิน (21-2101) จึงไม่มีขา 21-2101 ที่นี่.
 *
 * คอลัมน์ `advanceBalance` / `rescheduleAdvanceBalance` = 0 ในธุรกรรมเดียวกัน (`creditBalance` ไม่แตะ — ถ3) · audit
 * `ADVANCE_EXCESS_RECOGNIZED` ผ่าน `tx.auditLog.create` (atomic กับรายการ — แถวหลุด Merkle chain โดยตั้งใจ) ·
 * idempotency `flow + idempotencyKey` (`advance-excess-income:<contractId>` · ลงใหม่หลังกลับรายการ = ต่อท้าย `:<ลำดับ>`
 * โดยลำดับนับ**ทุกแถว**ของ flow รวม VOIDED/ลบ — `countAdvanceExcessIncomeEntries`) + จับ P2002 ⇒ `ALREADY_POSTED` ·
 * สัญญาณเตือนคอลัมน์ ≠ บัญชี ส่งหลัง commit (`emitDeferredWarnings`).
 *
 * **กลับรายการ (final review I2):** `reverse(contractId, { reason, actorUserId })` — กระจกทุกบรรทัดของรายการกวาดที่ยังมีผล
 * (`Cr 21-1103 / Dr 42-1106 / Dr 21-2102`) flow `advance-excess-income-reverse` · tag `REVERSAL` · key ต่อต้นฉบับ ·
 * **ไม่ copy stamp** `advanceVatConsume` (ต5 — ต้นฉบับถูก stamp `reversed` ⇒ `advanceVatOutstanding` กลับขึ้นเอง) · คืนคอลัมน์
 * `advanceBalance` / `rescheduleAdvanceBalance` จาก `*Before` ใน metadata · audit `ADVANCE_EXCESS_REVERSED` · เรียกจาก CLI
 * `advance-excess:reverse` (`src/cli/advance-excess-income-reverse.cli.ts`) — `JournalService.void` ปฏิเสธรายการ flow นี้
 * เพราะมันตั้ง VOIDED + รายการกลับไม่มี metadata (21-1103 ทั้งบัญชีเกินจริง · 42-1106 ติดลบ · รอบกวาดลงซ้ำไม่ได้).
 */
export type AdvanceExcessIncomeResult =
  | {
      outcome: 'POSTED';
      contractId: string;
      contractNumber: string;
      entryNo: string;
      amount: Decimal;
      income: Decimal;
      vat: Decimal;
      /** คอลัมน์ถังของสัญญาไม่ตรงยอดในบัญชี (สัญญาณเตือนส่งแล้ว) */
      columnsMismatch: boolean;
    }
  | { outcome: 'ALREADY_POSTED'; contractId: string; contractNumber?: string; entryNo?: string }
  | {
      outcome: 'COLUMNS_ONLY';
      contractId: string;
      contractNumber: string;
      advanceBalance: Decimal;
      rescheduleAdvanceBalance: Decimal;
    }
  | { outcome: 'NOTHING'; contractId: string; contractNumber: string };

export type AdvanceExcessReverseResult =
  | {
      outcome: 'REVERSED';
      contractId: string;
      contractNumber: string;
      /** เลขที่รายการกระจก */
      entryNo: string;
      /** เลขที่รายการกวาดที่ถูกกลับ */
      reversedEntryNo: string;
      amount: Decimal;
    }
  | { outcome: 'NOTHING_TO_REVERSE'; contractId: string }
  | { outcome: 'ALREADY_REVERSED'; contractId: string };

const ZERO = new Decimal(0);
const REVERSE_REASON_MIN = 10;
const LINE_DESCRIPTION = 'รับรู้เงินพักส่วนเกินเป็นรายได้ (เงินพักค่าปรับดิวสะสมเกิน)';
const toDecimal = (v: Prisma.Decimal | string | number | null | undefined): Decimal =>
  new Decimal((v ?? 0).toString());

@Injectable()
export class AdvanceExcessIncomeTemplate {
  private readonly logger = new Logger(AdvanceExcessIncomeTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    contractId: string,
    opts: { postedAt?: Date } = {},
  ): Promise<AdvanceExcessIncomeResult> {
    const postedAt = opts.postedAt ?? new Date();
    let contractNumberSeen: string | undefined;
    let out: { result: AdvanceExcessIncomeResult; warnings: DeferredWarning[] };
    try {
      out = await this.prisma.$transaction(
        async (tx) => {
          const r = await this.run(contractId, postedAt, tx);
          contractNumberSeen = r.contractNumber;
          return r;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      // รอบซ้อนกัน (สองโปรเซส) แพ้ unique index ของ idempotency — เท่ากับมีรายการแล้ว
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(
          `[advance-excess-income] P2002 on contract ${contractId} — entry already exists (ALREADY_POSTED)`,
        );
        return { outcome: 'ALREADY_POSTED', contractId, contractNumber: contractNumberSeen };
      }
      throw err;
    }
    // สัญญาณเตือนหลังธุรกรรม commit เท่านั้น (ธุรกรรมที่ล้มไม่ทิ้งสัญญาณ)
    emitDeferredWarnings(out.warnings);
    return out.result;
  }

  private async run(
    contractId: string,
    postedAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<{
    result: AdvanceExcessIncomeResult;
    warnings: DeferredWarning[];
    contractNumber: string;
  }> {
    const contract = await tx.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        advanceBalance: true,
        rescheduleAdvanceBalance: true,
        creditBalance: true,
      },
    });
    const contractNumber = contract.contractNumber;

    // idempotency ชั้นแรก (ชั้นสองคือ unique index ⇒ P2002 ใน execute)
    const priorEntries = await listAdvanceExcessIncomeEntries(tx, contractId);
    const active = priorEntries.filter(isActiveAdvanceExcessEntry);
    if (active.length > 0) {
      return {
        result: {
          outcome: 'ALREADY_POSTED',
          contractId,
          contractNumber,
          entryNo: active[0].entryNumber,
        },
        warnings: [],
        contractNumber,
      };
    }

    const advances = await readContractCloseAdvances(tx, contract, 'excess-income');
    const advanceBalanceBefore = toDecimal(contract.advanceBalance);
    const parkBalanceBefore = toDecimal(contract.rescheduleAdvanceBalance);
    const creditBalanceBefore = toDecimal(contract.creditBalance);

    if (!advances.advance.gt(0)) {
      // บัญชีไม่มีให้ลง — คอลัมน์ที่ยังค้างคือคอลัมน์ไม่ตรงบัญชี (สัญญาณเตือนจาก readContractCloseAdvances +
      // ผู้เรียกสร้างงานแจ้งให้ตรวจ แทน alarm เดิมที่อ่านจากคอลัมน์)
      if (advanceBalanceBefore.plus(parkBalanceBefore).gt(0)) {
        return {
          result: {
            outcome: 'COLUMNS_ONLY',
            contractId,
            contractNumber,
            advanceBalance: advanceBalanceBefore,
            rescheduleAdvanceBalance: parkBalanceBefore,
          },
          warnings: advances.warnings,
          contractNumber,
        };
      }
      return {
        result: { outcome: 'NOTHING', contractId, contractNumber },
        warnings: advances.warnings,
        contractNumber,
      };
    }

    const financeCompanyId = await this.companyResolver.getFinanceCompanyId(tx);
    await validatePeriodOpen(tx, postedAt, financeCompanyId);

    const amount = advances.advance;
    // ต4: รายการนี้ล้าง 21-1103 ทั้งยอด — "ทำให้ถังของสัญญาเป็น 0" ก็ต่อเมื่อไม่มีเครดิต 21-5101 ค้าง
    const emptiesBucket = advances.credit.lte(0);
    let vat = await resolveConsumeVat(tx, contractId, amount, emptiesBucket);
    // เพดานกันรายการพิกล (stamp ค้างเกินเงินที่เหลือ — เช่นหลัง void ที่ไม่ได้ประทับ reversed): ภาษีไม่เกินยอดที่ลง
    if (vat.gt(amount)) vat = amount;
    const income = amount.minus(vat);

    // ลำดับนับทุกแถวของ flow (รวม VOIDED/ลบ) — `priorEntries` เห็นเฉพาะ POSTED จึงใช้ตัดสิน "มีผล" เท่านั้น (final review I2)
    const seq = (await countAdvanceExcessIncomeEntries(tx, contractId)) + 1;
    const keyBase = `${ADVANCE_EXCESS_INCOME_FLOW}:${contractId}`;
    const idempotencyKey = seq === 1 ? keyBase : `${keyBase}:${seq}`;

    const lines: JeLineInput[] = [
      { accountCode: '21-1103', dr: amount, cr: ZERO, description: LINE_DESCRIPTION },
    ];
    if (income.gt(0)) {
      lines.push({
        accountCode: ADVANCE_EXCESS_INCOME_ACCOUNT,
        dr: ZERO,
        cr: income,
        description: LINE_DESCRIPTION,
      });
    }
    if (vat.gt(0)) {
      lines.push({
        accountCode: '21-2102',
        dr: ZERO,
        cr: vat,
        description: ADVANCE_VAT_CONSUME_DESCRIPTION,
      });
    }

    const columnsMismatch = advances.warnings.length > 0;
    const money = {
      amount: amount.toFixed(2),
      income: income.toFixed(2),
      vat: vat.toFixed(2),
      advanceBalanceBefore: advanceBalanceBefore.toFixed(2),
      rescheduleAdvanceBalanceBefore: parkBalanceBefore.toFixed(2),
      creditBalanceBefore: creditBalanceBefore.toFixed(2),
      ledger21_1103: amount.toFixed(2),
      ledger21_5101: advances.credit.toFixed(2),
    };

    const posted = await this.journal.createAndPost(
      {
        description: `รับรู้เงินพักส่วนเกินเป็นรายได้ (42-1106) — สัญญา ${contractNumber}`,
        reference:
          seq === 1
            ? `${contractId}:${ADVANCE_EXCESS_INCOME_FLOW}`
            : `${contractId}:${ADVANCE_EXCESS_INCOME_FLOW}:${seq}`,
        metadata: {
          tag: ADVANCE_EXCESS_INCOME_TAG,
          flow: ADVANCE_EXCESS_INCOME_FLOW,
          idempotencyKey,
          contractId,
          contractNumber,
          ...money,
          ...(vat.gt(0) ? { [ADVANCE_VAT_META.consume]: vat.toFixed(2) } : {}),
          columnsMismatch,
        },
        lines,
        postedAt,
        companyId: financeCompanyId,
      },
      tx,
    );

    await tx.contract.update({
      where: { id: contractId },
      data: { advanceBalance: 0, rescheduleAdvanceBalance: 0 },
    });

    const warnings: DeferredWarning[] = [...advances.warnings];
    const auditUser = await this.resolveAuditUser(tx);
    if (auditUser) {
      await tx.auditLog.create({
        data: {
          action: ADVANCE_EXCESS_INCOME_AUDIT_ACTION,
          entity: 'contract',
          entityId: contractId,
          userId: auditUser.id,
          newValue: {
            entryNumber: posted.entryNumber,
            contractNumber,
            ...money,
            columnsMismatch,
            postedAt: postedAt.toISOString(),
            source: 'ADVANCE_EXCESS_SWEEP',
          },
        },
      });
    } else {
      // AuditLog.userId บังคับ — ไม่มีผู้ใช้ระบบ = ข้าม audit แต่ไม่หยุดการลงรายการ (เงินอยู่ในบัญชีถูกต้องแล้ว)
      warnings.push({
        message:
          '[advance-excess-income] no SYSTEM/admin user — ADVANCE_EXCESS_RECOGNIZED audit skipped',
        tags: { module: 'journal', action: 'advance-excess-income-audit-skipped' },
        extra: { contractId, contractNumber, entryNumber: posted.entryNumber },
      });
    }

    this.logger.log(
      `[advance-excess-income] ${contractNumber}: ${posted.entryNumber} amount=${money.amount} income=${money.income} vat=${money.vat}`,
    );
    return {
      result: {
        outcome: 'POSTED',
        contractId,
        contractNumber,
        entryNo: posted.entryNumber,
        amount,
        income,
        vat,
        columnsMismatch,
      },
      warnings,
      contractNumber,
    };
  }

  /** ผู้ใช้สำหรับ audit ของงานระบบ — SYSTEM ก่อน แล้ว admin@bestchoice.com (pattern JournalAutoService) · ไม่มี = null */
  private async resolveAuditUser(tx: Prisma.TransactionClient): Promise<{ id: string } | null> {
    return (
      (await tx.user.findFirst({
        where: { isSystemUser: true, deletedAt: null },
        select: { id: true },
      })) ??
      (await tx.user.findFirst({
        where: { email: 'admin@bestchoice.com', deletedAt: null },
        select: { id: true },
      }))
    );
  }

  /**
   * กลับรายการกวาดที่ยังมีผลของสัญญาแบบกระจก (final review I2) — ดู doc ของคลาส. ผู้เรียก: CLI `advance-excess:reverse`.
   * ไม่มีรายการที่มีผล = `NOTHING_TO_REVERSE` · P2002 (กดพร้อมกัน) = `ALREADY_REVERSED`.
   */
  async reverse(
    contractId: string,
    input: { reason: string; actorUserId?: string | null },
    opts: { postedAt?: Date } = {},
  ): Promise<AdvanceExcessReverseResult> {
    const reason = (input.reason ?? '').trim();
    if (reason.length < REVERSE_REASON_MIN) {
      throw new BadRequestException(
        `ต้องระบุเหตุผลการกลับรายการอย่างน้อย ${REVERSE_REASON_MIN} ตัวอักษร`,
      );
    }
    const postedAt = opts.postedAt ?? new Date();
    try {
      return await this.prisma.$transaction(
        async (tx): Promise<AdvanceExcessReverseResult> => {
          const entries = await listAdvanceExcessIncomeEntries(tx, contractId);
          const active = entries.find(isActiveAdvanceExcessEntry);
          if (!active) return { outcome: 'NOTHING_TO_REVERSE', contractId };

          const original = await tx.journalEntry.findUniqueOrThrow({
            where: { id: active.id },
            include: { lines: { where: { deletedAt: null } } },
          });
          const meta = (original.metadata ?? {}) as Record<string, unknown>;
          const contractNumber =
            typeof meta.contractNumber === 'string'
              ? meta.contractNumber
              : (
                  await tx.contract.findUniqueOrThrow({
                    where: { id: contractId },
                    select: { contractNumber: true },
                  })
                ).contractNumber;
          const str = (v: unknown): string =>
            typeof v === 'string' ? v : toDecimal(v as never).toFixed(2);
          const amount = toDecimal(meta.amount as never);

          await validatePeriodOpen(tx, postedAt, original.companyId);

          const lines: JeLineInput[] = original.lines.map((l) => ({
            accountCode: l.accountCode,
            dr: toDecimal(l.credit),
            cr: toDecimal(l.debit),
            description: `[กลับรายการ] ${l.description ?? ''}`.trim(),
          }));

          // ไม่ copy stamp advanceVatPark/advanceVatConsume (ต5) — ต้นฉบับถูกประทับ reversed ⇒ outstanding กลับขึ้นเอง
          const posted = await this.journal.createAndPost(
            {
              description: `[กลับรายการ] รับรู้เงินพักส่วนเกินเป็นรายได้ (42-1106) — สัญญา ${contractNumber} · ${original.entryNumber}`,
              reference: `${original.id}:${ADVANCE_EXCESS_INCOME_REVERSE_FLOW}`,
              companyId: original.companyId,
              postedAt,
              metadata: {
                tag: 'REVERSAL',
                flow: ADVANCE_EXCESS_INCOME_REVERSE_FLOW,
                idempotencyKey: `${ADVANCE_EXCESS_INCOME_REVERSE_FLOW}:${original.id}`,
                originalEntryId: original.id,
                reversesEntryId: original.id,
                originalEntryNumber: original.entryNumber,
                contractId,
                contractNumber,
                reason,
                amount: amount.toFixed(2),
                income: str(meta.income),
                vat: str(meta.vat),
              },
              lines,
            },
            tx,
          );

          await tx.journalEntry.update({
            where: { id: original.id },
            data: {
              metadata: {
                ...(meta as Prisma.InputJsonObject),
                reversed: true,
                reversedByEntryNumber: posted.entryNumber,
              },
            },
          });

          // คืนคอลัมน์ถังตามที่รายการกวาดบันทึกไว้ก่อนตั้งเป็น 0 (GL 21-1103 กลับมาด้วยกระจก ⇒ คอลัมน์ต้องตามบัญชี)
          const restoredAdvance = toDecimal(meta.advanceBalanceBefore as never);
          const restoredPark = toDecimal(meta.rescheduleAdvanceBalanceBefore as never);
          await tx.contract.update({
            where: { id: contractId },
            data: { advanceBalance: restoredAdvance, rescheduleAdvanceBalance: restoredPark },
          });

          const auditUserId = input.actorUserId ?? (await this.resolveAuditUser(tx))?.id ?? null;
          if (auditUserId) {
            await tx.auditLog.create({
              data: {
                action: ADVANCE_EXCESS_REVERSED_AUDIT_ACTION,
                entity: 'contract',
                entityId: contractId,
                userId: auditUserId,
                newValue: {
                  entryNumber: posted.entryNumber,
                  reversedEntryNumber: original.entryNumber,
                  contractNumber,
                  amount: amount.toFixed(2),
                  income: str(meta.income),
                  vat: str(meta.vat),
                  reason,
                  restoredColumns: {
                    advanceBalance: restoredAdvance.toFixed(2),
                    rescheduleAdvanceBalance: restoredPark.toFixed(2),
                  },
                  postedAt: postedAt.toISOString(),
                  source: 'ADVANCE_EXCESS_REVERSE',
                },
              },
            });
          } else {
            this.logger.warn(
              `[advance-excess-income] no actor/SYSTEM/admin user — ADVANCE_EXCESS_REVERSED audit skipped (contract ${contractId})`,
            );
          }

          return {
            outcome: 'REVERSED',
            contractId,
            contractNumber,
            entryNo: posted.entryNumber,
            reversedEntryNo: original.entryNumber,
            amount,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(
          `[advance-excess-income] P2002 on reverse for contract ${contractId} — already reversed (ALREADY_REVERSED)`,
        );
        return { outcome: 'ALREADY_REVERSED', contractId };
      }
      throw err;
    }
  }
}
