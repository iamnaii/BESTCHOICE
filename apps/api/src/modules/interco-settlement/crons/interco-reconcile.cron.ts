import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { readBoolFlag } from '../../../utils/config.util';
import {
  IntercoAgingService,
  isSwapCreditOneBook,
  negativeTypedFields,
} from '../interco-aging.service';
import { IntercoPendingService } from '../interco-pending.service';

/** tag ของ Todo — dedup อ่านค่านี้ตัวเดียว (อย่า hardcode ซ้ำที่อื่น) */
export const RECONCILE_TODO_TAG = 'interco-reconcile';

export type ReconcileFindingKind =
  /** สองสมุดไม่ตรงกันต่อสัญญา (11-2107 vs S21-3001) — carry e ของ Phase 2 */
  | 'BOOK_MISMATCH'
  /** เครดิตเปลี่ยนเครื่องค้างสมุดเดียวทั้งที่เป็นยุคที่ต้องมีสองสมุด — carry c */
  | 'SWAP_CREDIT_ONE_BOOK'
  /** เจ้าหนี้ (21-1101+21-1102) ≠ ลูกหนี้ SHOP (S11-3001+S11-3002) ต่อสัญญา */
  | 'PAYABLE_PAIR_MISMATCH'
  /** ยอด typed/net ติดลบ = ล้างเกิน — ตาข่ายของ carry d (TOCTOU) */
  | 'NEGATIVE_TYPED'
  /** ระดับบัญชี: มีบรรทัดที่เลนส์ต่อสัญญามองไม่เห็น — ตาข่ายของ carry ข */
  | 'ACCOUNT_DRIFT';

export interface ReconcileFinding {
  kind: ReconcileFindingKind;
  contractId?: string;
  contractNumber?: string;
  detail: string;
  amounts: Record<string, string>;
  /**
   * รูปแบบที่ "รู้จักและอธิบายได้" — ยังนับเป็น finding เต็มใบ (ห้ามซ่อน:
   * เป็นส่วนต่างจริงตาม F4 / interco spec §11) แต่ในกล่อง Todo จะถูก **ยุบเป็น
   * บรรทัดสรุปเดียว** ไม่กินโควตารายบรรทัดของความผิดปกติที่ยังไม่มีคำอธิบาย
   * (precedent: `legacyOneBookNet` ของ Task 3).
   */
  pattern?: ReconcileFindingPattern;
}

/** รูปแบบที่รู้จัก — ยุบเป็นบรรทัดสรุปในคำอธิบาย Todo */
export type ReconcileFindingPattern = 'COMMISSION_ONLY_GAP';

export interface ReconcileTickResult {
  enabled: boolean;
  findings: ReconcileFinding[];
  todoCreated: boolean;
}

/**
 * ลำดับความรุนแรงสำหรับจัดเรียงก่อนตัดบรรทัด: เงินที่เคลื่อนผิด (ติดลบ) และ
 * ยอดบัญชีที่อธิบายไม่ได้ ต้องอยู่บนสุดเสมอ — ห้ามให้ความไม่ตรงเชิงโครงสร้างที่
 * รู้สาเหตุแล้วมาดันของจริงตกไปอยู่ใน "และอีก N รายการ".
 */
const KIND_SEVERITY: Record<ReconcileFindingKind, number> = {
  NEGATIVE_TYPED: 0,
  ACCOUNT_DRIFT: 1,
  SWAP_CREDIT_ONE_BOOK: 2,
  BOOK_MISMATCH: 3,
  PAYABLE_PAIR_MISMATCH: 4,
};

const PATTERN_LABEL: Record<ReconcileFindingPattern, string> = {
  COMMISSION_ONLY_GAP: 'รูปแบบสัญญาไม่ระบุค่าคอม',
};

/** จำนวนบรรทัดสูงสุดใน Todo ก่อนตัดเป็น "และอีก N รายการ" */
const MAX_DESCRIPTION_LINES = 20;
const EPS = new Prisma.Decimal('0.01');

const KIND_LABEL: Record<ReconcileFindingKind, string> = {
  BOOK_MISMATCH: 'สองสมุดไม่ตรงกัน',
  SWAP_CREDIT_ONE_BOOK: 'เครดิตเปลี่ยนเครื่องค้างสมุดเดียว',
  PAYABLE_PAIR_MISMATCH: 'เจ้าหนี้/ลูกหนี้รอบจ่ายไม่ตรงกัน',
  NEGATIVE_TYPED: 'ยอดติดลบ (ล้างเกิน)',
  ACCOUNT_DRIFT: 'ยอดบัญชีอธิบายไม่ได้',
};

/** 8000 → "8,000.00" (ผ่าน Decimal.toFixed — ไม่แปลงเป็น Number ตามกติกาเงิน) */
function formatAmount(value: Prisma.Decimal): string {
  const [intPart, decPart] = value.toFixed(2).split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const digits = sign ? intPart.slice(1) : intPart;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decPart}`;
}

/**
 * รวมจำนวน + ยอดของ finding ตามรูปแบบที่รู้จัก. ยอด = Σ `commissionDiff`
 * (ค่าที่ service คำนวณมาแล้ว — ที่นี่แค่รวม ไม่ derive GL ใหม่).
 */
function summarizePatterns(
  findings: ReconcileFinding[],
): Partial<Record<ReconcileFindingPattern, { count: number; total: Prisma.Decimal }>> {
  const out: Partial<Record<ReconcileFindingPattern, { count: number; total: Prisma.Decimal }>> = {};
  for (const f of findings) {
    if (!f.pattern) continue;
    const agg = out[f.pattern] ?? { count: 0, total: new Prisma.Decimal(0) };
    agg.count += 1;
    agg.total = agg.total.plus(new Prisma.Decimal(f.amounts.commissionDiff ?? 0));
    out[f.pattern] = agg;
  }
  return out;
}

/**
 * กระทบยอดระหว่างกิจการรายเดือน — Phase 4 spec §6 ข้อ 3 (ตาข่ายสุดท้ายของเฟส).
 *
 * **รายงานอย่างเดียว ไม่แตะ GL แม้แต่บรรทัดเดียว** (doctrine): ความไม่ตรงกัน
 * ทุกแบบที่นี่ต้องให้คนตัดสินว่าจะแก้ด้วย JV แบบไหน — การเดา JE ปรับปรุงเอง
 * คือคลาสเดียวกับ opening-balance gap (interco spec §11) ที่รอ CPA อยู่.
 *
 * **ห้ามคำนวณยอด typed/net เองในไฟล์นี้** — ทุกตัวเลขมาจาก
 * `IntercoAgingService` (เลนส์ต่อสัญญา + pairing + drift ระดับบัญชี) และ
 * `IntercoPendingService.getReconcileTotals()` (drift ของคิวรอจ่าย); การตัดสิน
 * "ผิดปกติหรือไม่" อยู่ใน predicate ที่ service export
 * (`negativeTypedFields` / `isSwapCreditOneBook`) หรือ flag ที่ service คำนวณ
 * มาแล้ว (`bookMismatch` / `legacyOneBook` / `mismatch`). cron นี้ทำแค่ประกอบ
 * ข้อความ — ยอดในกล่อง Todo กับบนแท็บ UI จึงมาจากก้อนเดียวกันเสมอ.
 *
 * **เกณฑ์แยก legacy (สำคัญ — ห้าม alert เท็จ):**
 *   - `SWAP_CREDIT_ONE_BOOK` นับเฉพาะสัญญาที่มี A.4 ยุค Phase 2+
 *     (`getPhase2SwapContractIds` — JE `shop-exchange-return` ที่ stamp
 *     `newContractId`). swap ยุคก่อน Phase 1 ที่มี 11-2107 แต่ไม่มี S21-3001
 *     เป็น **สภาพปกติ** ตาม spec §11.4 → ข้าม
 *   - `BOOK_MISMATCH` ข้ามแถว `legacyOneBook` ด้วยเหตุผลเดียวกัน (แถวเหล่านั้น
 *     สองสมุดต่างกันโดยนิยาม ตราบใดที่ยังไม่มีขาคู่ฝั่ง SHOP)
 *   - `PAYABLE_PAIR_MISMATCH` ข้ามสัญญา `legacyNoShop` (activate ก่อน
 *     2026-06-23 — สมุด SHOP ยังไม่มีลูกหนี้)
 *   - `NEGATIVE_TYPED` **ไม่ยกเว้น legacy** แต่วัดด้วยยอดรวมระดับสัญญา
 *     (ดู `negativeTypedFields`) — ยอดติดลบไม่ใช่สภาพปกติของยุคใดทั้งสิ้น
 *
 * **ไม่ผูกกับเกณฑ์วันของ alert รายวัน**: reconcile ไม่อ่าน
 * `shop_receivable_aging_alert_days` เลย — สัญญาที่ผิดปกติแต่ยังไม่แก่พอ
 * (หรือแก่แล้วแต่ operator ตั้งเกณฑ์ไว้สูงจนแท็บ UI กับ cron รายวันมองต่างกัน)
 * ก็ยังโผล่ที่นี่ทุกเดือนเสมอ.
 *
 * doctrine R-1: root `PrismaService` เท่านั้น, ไม่อยู่บนเส้นทางเงิน,
 * **ห้าม throw ออกจาก tick**.
 */
@Injectable()
export class IntercoReconcileCron {
  private readonly logger = new Logger(IntercoReconcileCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aging: IntercoAgingService,
    private readonly pending: IntercoPendingService,
  ) {}

  /** เดือนละครั้ง วันที่ 1 เวลา 08:00 BKK (spec §6 ข้อ 3). */
  @Cron('0 8 1 * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<ReconcileTickResult> {
    try {
      const enabled = await readBoolFlag(this.prisma, 'interco_reconcile_enabled', true);
      if (!enabled) {
        this.logger.debug('[interco-reconcile] ปิดใช้งาน — ข้ามรอบนี้');
        return { enabled: false, findings: [], todoCreated: false };
      }

      const findings = await this.collectFindings();
      const period = this.bkkMonth(new Date());

      if (findings.length === 0) {
        this.logger.log(`[interco-reconcile] ${period}: กระทบยอดตรงทุกรายการ — ไม่มีสิ่งผิดปกติ`);
        return { enabled: true, findings, todoCreated: false };
      }

      const counts = this.countByKind(findings);
      this.logger.warn(
        `[interco-reconcile] ${period}: พบ ${findings.length} รายการไม่ตรง — ` +
          Object.entries(counts)
            .map(([kind, n]) => `${KIND_LABEL[kind as ReconcileFindingKind]} ${n}`)
            .join(' · '),
      );
      const patternSummary = summarizePatterns(findings);
      Sentry.captureMessage('Interco monthly reconcile mismatches', {
        level: 'warning',
        tags: { subsystem: 'interco-netting' },
        extra: {
          period,
          total: findings.length,
          ...counts,
          // นับแยกจาก kind: รูปแบบที่รู้จักจะบวมขึ้นเรื่อย ๆ ตามจำนวนสัญญา
          // ถ้าปนกับ kind จะอ่านกราฟ Sentry ไม่ออกว่าของจริงเพิ่มหรือไม่
          patternCommissionOnly: patternSummary.COMMISSION_ONLY_GAP?.count ?? 0,
          patternCommissionOnlyTotal: (
            patternSummary.COMMISSION_ONLY_GAP?.total ?? new Prisma.Decimal(0)
          ).toFixed(2),
        },
      });

      const todoCreated = await this.upsertMonthlyTodo(period, findings);
      return { enabled: true, findings, todoCreated };
    } catch (outerErr) {
      // DB/service ล่มทั้งก้อน — ห้ามทำให้ scheduler ตาย, เดือนหน้าลองใหม่เอง
      // (และมนุษย์ยังเปิดแท็บอายุลูกหนี้ดูเองได้ทุกเมื่อ)
      Sentry.captureException(outerErr, {
        tags: { cron: 'interco-reconcile', scope: 'tick' },
      });
      this.logger.error(
        `[interco-reconcile] tick ล้มเหลว: ${
          outerErr instanceof Error ? outerErr.message : String(outerErr)
        }`,
      );
      return { enabled: false, findings: [], todoCreated: false };
    }
  }

  /** อ่านทุกมุมจาก service แล้วแปลงเป็น findings (ไม่มีการคำนวณยอดที่นี่) */
  private async collectFindings(): Promise<ReconcileFinding[]> {
    const [agingResult, negativeRows, pairs, phase2Ids, accountDrifts, openBatchGross, reconcileTotals] =
      await Promise.all([
        this.aging.getShopReceivableAging(),
        // **คนละแหล่งกับ rows โดยเจตนา** — เคสหักเกินแบบสมมาตร (สองสมุดติดลบ
        // เท่ากัน) ไม่ผ่าน filter ของรายงานหลัก ถ้าอ่านจาก rows detector นี้จะ
        // ไม่มีวันยิงเลย (C1, Fix Round 1 — ดู jsdoc `getNegativeTypedRows`)
        this.aging.getNegativeTypedRows(),
        this.aging.getPayablePairing(),
        this.aging.getPhase2SwapContractIds(),
        this.aging.getTypedAccountDrift(),
        this.aging.getOpenBatchPayableGross(),
        this.pending.getReconcileTotals(),
      ]);

    const findings: ReconcileFinding[] = [];

    for (const row of agingResult.rows) {
      const oneBook = isSwapCreditOneBook(row, phase2Ids.has(row.contractId));

      if (oneBook) {
        findings.push({
          kind: 'SWAP_CREDIT_ONE_BOOK',
          contractId: row.contractId,
          contractNumber: row.contractNumber,
          detail:
            `สัญญา ${row.contractNumber}: เครดิตเปลี่ยนเครื่อง (11-2107) ` +
            `${formatAmount(row.swapCreditGross)} บาท แต่สมุด SHOP (S21-3001) เป็น 0 ` +
            `ทั้งที่เป็น swap ยุคที่ต้องมีขาคู่ — หักกลบในรอบจ่ายไม่ได้จนกว่าจะตั้งขา SHOP`,
          amounts: {
            swapCreditGross: row.swapCreditGross.toFixed(2),
            shopMirrorGross: row.shopMirrorGross.toFixed(2),
            intercoNet: row.intercoNet.toFixed(2),
          },
        });
      } else if (row.bookMismatch && !row.legacyOneBook) {
        // วินิจฉัยเฉพาะเจาะจง (สมุดเดียว) ชนะ — ไม่รายงานซ้ำสองใบบนสัญญาเดียว
        findings.push({
          kind: 'BOOK_MISMATCH',
          contractId: row.contractId,
          contractNumber: row.contractNumber,
          detail:
            `สัญญา ${row.contractNumber}: ฝั่ง FINANCE (11-2107) ` +
            `${formatAmount(row.intercoNet)} บาท vs ฝั่ง SHOP (S21-3001) ` +
            `${formatAmount(row.shopMirrorNet)} บาท — ห้ามหักกลบ/รับเงินจนกว่าจะตรงกัน`,
          amounts: {
            intercoNet: row.intercoNet.toFixed(2),
            shopMirrorNet: row.shopMirrorNet.toFixed(2),
            diff: row.intercoNet.minus(row.shopMirrorNet).toFixed(2),
            settledDeduction: row.settledDeduction.toFixed(2),
          },
        });
      }

    }

    for (const row of negativeRows) {
      for (const neg of negativeTypedFields(row)) {
        findings.push({
          kind: 'NEGATIVE_TYPED',
          contractId: row.contractId,
          contractNumber: row.contractNumber,
          detail:
            `สัญญา ${row.contractNumber}: ${neg.label} ติดลบ ` +
            `${formatAmount(neg.value)} บาท — ถูกหักกลบ/รับเงินคืนเกินยอดตั้งหนี้`,
          amounts: { field: neg.field, value: neg.value.toFixed(2) },
        });
      }
    }

    for (const pair of pairs) {
      if (!pair.mismatch) continue;
      const financeTotal = pair.financedGl.plus(pair.commissionGl);
      const shopTotal = pair.shopFinancedGl.plus(pair.shopCommissionGl);
      // รูปแบบที่รู้จัก: ต่างกันเฉพาะขาค่าคอม = สัญญาที่ storeCommission ว่าง
      // (1A ตั้ง fallback 10% แต่ขา SHOP ตั้ง 0 — ดู jsdoc `commissionDiff`).
      // ติดป้ายให้คนอ่านรู้ทันทีว่าเป็น gap เชิงระบบ ไม่ใช่ JV มือหลุด
      const commissionOnly =
        pair.commissionDiff.abs().gt(EPS) && pair.financedDiff.abs().lte(EPS);
      findings.push({
        kind: 'PAYABLE_PAIR_MISMATCH',
        contractId: pair.contractId,
        contractNumber: pair.contractNumber,
        detail:
          `สัญญา ${pair.contractNumber}: เจ้าหนี้ FINANCE (21-1101+21-1102) ` +
          `${formatAmount(financeTotal)} บาท vs ลูกหนี้ SHOP (S11-3001+S11-3002) ` +
          `${formatAmount(shopTotal)} บาท — ต่างกัน ${formatAmount(pair.diff)} บาท` +
          (commissionOnly
            ? ' (ต่างเฉพาะขาค่าคอม — รูปแบบสัญญาที่ไม่ได้ระบุค่าคอม: 1A ตั้ง 10% อัตโนมัติ แต่สมุด SHOP ตั้ง 0)'
            : ''),
        amounts: {
          financeTotal: financeTotal.toFixed(2),
          shopTotal: shopTotal.toFixed(2),
          financedDiff: pair.financedDiff.toFixed(2),
          commissionDiff: pair.commissionDiff.toFixed(2),
          diff: pair.diff.toFixed(2),
        },
        ...(commissionOnly ? { pattern: 'COMMISSION_ONLY_GAP' as const } : {}),
      });
    }

    // drift ของคิวรอจ่าย: **ต้องบวกกลับรอบที่ค้างอนุมัติก่อน** — รอบ
    // PENDING_APPROVAL จองสัญญาไว้แล้ว (หลุดจาก pendingTotal) แต่ยังไม่โพสต์ JE
    // ⇒ ยอดบัญชียังเต็ม ⇒ drift ติดลบเท่ายอดรอบนั้นพอดี ซึ่งเป็น **สภาพปกติ**
    // ไม่ใช่ "JE ที่ไม่ได้ stamp contractId". เตือนตรง ๆ = ส่งคนไปตามหา JE ที่
    // ไม่มีอยู่จริงทุกเดือนที่มีรอบค้าง (I2, Fix Round 1)
    const driftResidual = reconcileTotals.drift.plus(openBatchGross);
    if (driftResidual.abs().gt(EPS)) {
      findings.push({
        kind: 'ACCOUNT_DRIFT',
        detail:
          `คิวรอจ่ายกับยอดบัญชีเจ้าหนี้ (21-1101+21-1102) ต่างกัน ` +
          `${formatAmount(reconcileTotals.drift)} บาท · บวกกลับรอบที่ค้างอนุมัติ ` +
          `${formatAmount(openBatchGross)} บาทแล้วยังเหลือ ${formatAmount(driftResidual)} บาท — ` +
          `ส่วนที่เหลือคือ JE ที่ไม่ได้ stamp contractId (เลนส์ต่อสัญญามองไม่เห็น)`,
        amounts: {
          pendingTotal: reconcileTotals.pendingTotal.toFixed(2),
          glFinanceTotal: reconcileTotals.glFinanceTotal.toFixed(2),
          rawDrift: reconcileTotals.drift.toFixed(2),
          openBatchGross: openBatchGross.toFixed(2),
          residual: driftResidual.toFixed(2),
        },
      });
    } else if (reconcileTotals.drift.abs().gt(EPS)) {
      this.logger.log(
        `[interco-reconcile] drift คิวรอจ่าย ${formatAmount(reconcileTotals.drift)} บาท ` +
          `อธิบายได้ครบด้วยรอบที่ค้างอนุมัติ ${formatAmount(openBatchGross)} บาท — ไม่ใช่ความผิดปกติ`,
      );
    }

    for (const drift of accountDrifts) {
      if (!drift.mismatch) continue;
      findings.push({
        kind: 'ACCOUNT_DRIFT',
        detail:
          `บัญชี ${drift.accountCode} ${drift.label}: ยอดจริง ` +
          `${formatAmount(drift.accountTotal)} บาท แต่เลนส์ + รอบจ่ายอธิบายได้ ` +
          `${formatAmount(drift.expected)} บาท — ต่างกัน ${formatAmount(drift.drift)} บาท ` +
          `(มีบรรทัดที่ไม่มี stamp ประเภท/สัญญา เช่น กลับรายการของ swap ยุคเก่า หรือ JV มือ)`,
        amounts: {
          accountTotal: drift.accountTotal.toFixed(2),
          lensTotal: drift.lensTotal.toFixed(2),
          settledDeduction: drift.settledDeduction.toFixed(2),
          expected: drift.expected.toFixed(2),
          drift: drift.drift.toFixed(2),
        },
      });
    }

    return findings;
  }

  private countByKind(findings: ReconcileFinding[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    return counts;
  }

  /** yyyy-mm ตามเวลาไทย — คีย์ dedup ของ Todo รายเดือน */
  private bkkMonth(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  }

  /**
   * Todo **หนึ่งใบต่อเดือน** — dedup ด้วย (tag + title มี yyyy-mm + ยังไม่ DONE)
   * เพื่อให้รันซ้ำ/รันมือในเดือนเดียวกันไม่สร้างใบซ้ำ. คืน false เมื่อมีใบเดิม
   * อยู่แล้ว / ไม่มีผู้ใช้ SYSTEM / สร้างไม่สำเร็จ — Sentry ยิงไปก่อนหน้านี้แล้ว
   * ทุกกรณี (pattern `alarmResidualParkOnCompletion`: alarm มาก่อน Todo).
   */
  private async upsertMonthlyTodo(
    period: string,
    findings: ReconcileFinding[],
  ): Promise<boolean> {
    try {
      const existing = await this.prisma.todo.findFirst({
        where: {
          tags: { has: RECONCILE_TODO_TAG },
          title: { contains: period },
          status: { not: 'DONE' },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        this.logger.log(
          `[interco-reconcile] ${period}: มี Todo ค้างอยู่แล้ว (${existing.id}) — ไม่สร้างซ้ำ`,
        );
        return false;
      }

      const systemUser = await this.prisma.user.findFirst({
        where: { isSystemUser: true, deletedAt: null },
        select: { id: true },
      });
      if (!systemUser) {
        this.logger.error(
          `[interco-reconcile] ${period}: ไม่พบผู้ใช้ SYSTEM — ข้ามการสร้าง Todo (Sentry-alarmed)`,
        );
        return false;
      }

      await this.prisma.todo.create({
        data: {
          title: `กระทบยอดระหว่างกิจการ ${period} พบ ${findings.length} รายการไม่ตรง`,
          description: this.buildDescription(period, findings),
          priority: 'HIGH',
          tags: [RECONCILE_TODO_TAG],
          createdById: systemUser.id,
        },
      });
      return true;
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'interco-reconcile', scope: 'todo' } });
      this.logger.error(
        `[interco-reconcile] ${period}: สร้าง Todo ล้มเหลว — ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private buildDescription(period: string, findings: ReconcileFinding[]): string {
    const counts = this.countByKind(findings);
    const lines: string[] = [
      `กระทบยอดระหว่างกิจการประจำเดือน ${period} (เวลาไทย) พบ ${findings.length} รายการไม่ตรง:`,
      ...Object.entries(counts).map(
        ([kind, n]) => `- ${KIND_LABEL[kind as ReconcileFindingKind]}: ${n} รายการ`,
      ),
      '',
    ];

    // เรียงความรุนแรงก่อนตัด และกัน finding รูปแบบที่รู้จักออกจากโควตารายบรรทัด
    const unlabeled = findings
      .filter((f) => !f.pattern)
      .sort((a, b) => KIND_SEVERITY[a.kind] - KIND_SEVERITY[b.kind]);

    for (const f of unlabeled.slice(0, MAX_DESCRIPTION_LINES)) {
      lines.push(`• [${KIND_LABEL[f.kind]}] ${f.detail}`);
    }
    if (unlabeled.length > MAX_DESCRIPTION_LINES) {
      lines.push(`… และอีก ${unlabeled.length - MAX_DESCRIPTION_LINES} รายการ (ดูรายละเอียดที่แท็บ)`);
    }

    // รูปแบบที่รู้จัก: บรรทัดสรุปเดียวต่อรูปแบบ (ไม่ซ่อน — ยังนับในยอดรวมบนหัวเรื่อง)
    const patternSummary = summarizePatterns(findings);
    for (const [pattern, agg] of Object.entries(patternSummary)) {
      lines.push(
        `▪ ${PATTERN_LABEL[pattern as ReconcileFindingPattern]}: ${agg.count} สัญญา ` +
          `รวม ${formatAmount(agg.total)} บาท — ส่วนต่างจริงเชิงระบบ ` +
          `(1A ตั้งค่าคอม 10% อัตโนมัติ แต่สมุด SHOP ตั้ง 0) ดูรายสัญญาที่แท็บ`,
      );
    }

    lines.push('');
    lines.push(
      'ตรวจที่หน้าจ่ายให้หน้าร้าน (INTER-CO) → แท็บ "อายุลูกหนี้หน้าร้าน" · ' +
        'ระบบไม่ตั้ง JE ปรับปรุงให้อัตโนมัติ — ต้องให้ผู้มีอำนาจ/ผู้สอบบัญชีตัดสินก่อนแก้',
    );
    return lines.join('\n');
  }
}
