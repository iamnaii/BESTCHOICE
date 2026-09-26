// PR 3 Task 6 — LIFF endpoint "เคสของฉัน" (หลังการขาย) สำหรับหน้า /liff/warranty
//
// อ่านอย่างเดียว: ลูกค้าถูกระบุตัวตนจาก `customer.lineIdShop` (LiffTokenGuard ยืนยัน LINE ID
// token กับ LINE จริงแล้วเซ็ต req.liffUserId — ดู liff-warranty.controller.ts) ไม่ใช่ตาราง
// `CustomerLineLink` (ไม่มีแถวช่อง SHOP เลยสักแถว — เหตุผลเดียวกับ LiffWarrantyService).
//
// คืนเฉพาะเคสที่เปิดอยู่ + เคสที่ปิด/ยกเลิกภายใน 14 วัน (ใหม่สุดก่อน, สูงสุด 10 แถว) ด้วยถ้อยคำฝั่งลูกค้า
// ล้วน — ห้ามมี id ภายใน/IMEI เต็ม/ชื่อพนักงานหลุดออกไป (มี "poison field" ในเทสต์ (c) ปักไว้).
//
// stage ที่เก็บไว้บนแถวอาจดริฟท์จากความจริง (ดู after-sales-stage-reconcile.ts) — reconcile ก่อน
// map ทุกแถวเสมอ ไม่ใช้ `row.stage` ดิบ.

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RECONCILE_SELECT,
  reconcileStage,
} from '../after-sales/services/after-sales-stage-reconcile';
import { stageSince } from '../after-sales/utils/after-sales-stage.util';
import {
  PRICED_EXCHANGE_COST_LINE,
  thaiShortYearDate,
} from '../after-sales/utils/after-sales-line-copy.util';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/** select ที่ `getMyCases` โหลดเคสมาด้วย — spread RECONCILE_SELECT (fields ที่ reconcileStage
 * ต้องใช้ตัดสินความจริงของ stage) + fields ที่หน้าจอลูกค้าต้องใช้จริง (PF-7) */
const SELECT = {
  ...RECONCILE_SELECT,
  caseNumber: true,
  receivedAt: true,
  approvedAt: true,
  updatedAt: true,
  deviceBrand: true,
  deviceModel: true,
  branch: { select: { name: true } },
  repairTicket: {
    select: {
      ...RECONCILE_SELECT.repairTicket.select,
      payer: true,
      estimatedCost: true,
      actualCost: true,
      sentToRepairAt: true,
      repairedAt: true,
    },
  },
} satisfies Prisma.AfterSalesCaseSelect;

type CaseForLiff = Prisma.AfterSalesCaseGetPayload<{ select: typeof SELECT }>;
type CaseStage = CaseForLiff['stage'];
type CaseOutcome = CaseForLiff['outcome'];
type CaseTicket = NonNullable<CaseForLiff['repairTicket']>;

export interface LiffAfterSalesCase {
  caseNumber: string;
  outcome: 'REPAIR' | 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE' | 'CASH_SAME_MODEL_EXCHANGE' | null;
  /** ป้ายมุมขวา */
  stageLabel: string;
  deviceName: string;
  branchName: string;
  /** 4 ขั้นตามทางออก (ข้อความลูกค้า) */
  steps: { title: string; state: 'done' | 'now' | 'idle'; hint: string | null }[];
  updatedAt: string;
  costLine: string;
}

export interface LiffAfterSalesResponse {
  linked: boolean;
  /** เคสเปิด + ปิดใน 14 วัน เรียงใหม่สุดก่อน — ไม่มี id/IMEI เต็ม/ชื่อพนักงาน */
  cases: LiffAfterSalesCase[];
}

type OutcomeGroup = 'REPAIR' | 'EXCHANGE' | 'PRICED';

/**
 * Ruling PF-8 (fix round 1) — `deriveStage()` (`after-sales-stage.util.ts:47-51`) routes a
 * `REPAIR` case whose repair ticket has been marked `REPLACED` (defect-exchange `markReplaced`)
 * through `OPEN_EXCHANGE_STAGE` — the exact same AWAITING_APPROVAL → READY_FOR_PICKUP → CLOSED
 * path SAME_MODEL_EXCHANGE uses — even though `outcome` itself stays `'REPAIR'` on the row. The
 * title group must follow that same signal, or the customer sees a contradictory pairing like
 * stageLabel 'รอผู้จัดการยืนยัน' next to a step titled 'กำลังซ่อม'.
 */
function outcomeGroup(outcome: CaseOutcome, repairTicket: CaseTicket | null): OutcomeGroup {
  if (outcome === 'PRICED_EXCHANGE') return 'PRICED';
  if (outcome === 'SAME_MODEL_EXCHANGE' || outcome === 'CASH_SAME_MODEL_EXCHANGE')
    return 'EXCHANGE';
  if (outcome === 'REPAIR' && repairTicket?.status === 'REPLACED') return 'EXCHANGE';
  return 'REPAIR'; // REPAIR (ticket ไม่ใช่ REPLACED) หรือ null — brief: "outcome null → treat like REPAIR titles"
}

/** ขั้นของลูกค้า (ต่างจากหน้าพนักงาน — ห้ามคำว่า "รับเครื่อง" เปล่า ๆ) ต่อกลุ่มทางออก */
const STEP_TITLES: Record<OutcomeGroup, [string, string, string, string]> = {
  REPAIR: ['รับเรื่องแล้ว', 'กำลังซ่อม', 'รอรับเครื่อง', 'ปิดเคส'],
  EXCHANGE: ['รับเรื่องแล้ว', 'รอผู้จัดการยืนยัน', 'รอรับเครื่องใหม่', 'ปิดเคส'],
  PRICED: ['รับเรื่องแล้ว', 'รออนุมัติ', 'ทำสัญญาใหม่', 'ปิดเคส'],
};

/** ตำแหน่งขั้น (0..3) — เหมือนกันทุกทางออก เพราะ index อ้างอิงตำแหน่งไม่ใช่ป้าย (มิเรอร์
 * `stageIndex` ของหน้าพนักงาน `apps/web/src/pages/after-sales/after-sales.ts`) · CANCELLED
 * ไม่มีตำแหน่งบนแถบนี้ — จัดการแยกที่ผู้เรียก */
function stagePosition(stage: CaseStage): number {
  switch (stage) {
    case 'RECEIVED':
      return 0;
    case 'IN_REPAIR':
    case 'AWAITING_APPROVAL':
      return 1;
    case 'READY_FOR_PICKUP':
      return 2;
    case 'CLOSED':
      return 3;
    default:
      return -1;
  }
}

/** ป้ายมุมขวา — ค่าคงที่ 8 แบบ (AWAITING_APPROVAL และ READY_FOR_PICKUP แยกป้ายตามทางออก) */
function stageLabel(stage: CaseStage, outcome: CaseOutcome): string {
  switch (stage) {
    case 'RECEIVED':
      return 'รับเรื่องแล้ว';
    case 'IN_REPAIR':
      return 'กำลังซ่อม';
    case 'AWAITING_APPROVAL':
      return outcome === 'PRICED_EXCHANGE' ? 'รออนุมัติ' : 'รอผู้จัดการยืนยัน';
    case 'READY_FOR_PICKUP':
      // final fix M-2 — PRICED อนุมัติแล้ว ขั้นปัจจุบันคือ "ทำสัญญาใหม่" ⇒ ป้ายต้องไม่ขัดกับขั้น
      return outcome === 'PRICED_EXCHANGE' ? 'รอทำสัญญาใหม่' : 'รอรับเครื่อง';
    case 'CLOSED':
      return 'ปิดเคส';
    case 'CANCELLED':
      return 'ยกเลิก';
    default:
      return 'รับเรื่องแล้ว';
  }
}

/** คำนำหน้าวันที่ของขั้น "now" — ใช้คู่กับ `thaiShortYearDate(stageSince(...))` */
const NOW_HINT_LABEL: Partial<Record<CaseStage, string>> = {
  RECEIVED: 'รับเรื่อง',
  IN_REPAIR: 'ส่งศูนย์',
  AWAITING_APPROVAL: 'รออนุมัติ',
  READY_FOR_PICKUP: 'พร้อมรับ',
  CLOSED: 'ปิดเคส',
};

function buildSteps(
  stage: CaseStage,
  outcome: CaseOutcome,
  receivedAt: Date,
  approvedAt: Date | null,
  closedAt: Date | null,
  updatedAt: Date,
  repairTicket: CaseTicket | null,
): LiffAfterSalesCase['steps'] {
  const titles = STEP_TITLES[outcomeGroup(outcome, repairTicket)];

  // CANCELLED — brief: "all steps idle except step 0 done" (ต่างจากหน้าพนักงานที่ปล่อย idle
  // ทั้งหมด — ยึดตามบรีฟของงานนี้ เพราะเป็นหน้าจอลูกค้าคนละบริบท)
  if (stage === 'CANCELLED') {
    return titles.map((title, i) => ({ title, state: i === 0 ? 'done' : 'idle', hint: null }));
  }

  const pos = stagePosition(stage);
  // stageSince() ไม่รู้จัก CLOSED (fallback เป็น receivedAt) — ใช้ closedAt จริงเมื่อมี ไม่งั้น
  // fallback เป็น updatedAt (fix round 1 Minor — ใกล้เวลาปิดจริงกว่า receivedAt สำหรับแถวเก่า
  // ที่ไม่เคยมี closedAt เขียนไว้) ให้ตรงกับวันที่ปิดเคสจริงแทนวันที่รับเรื่อง
  const since =
    stage === 'CLOSED'
      ? (closedAt ?? updatedAt)
      : stageSince(
          stage,
          repairTicket
            ? { sentToRepairAt: repairTicket.sentToRepairAt, repairedAt: repairTicket.repairedAt }
            : null,
          receivedAt,
          approvedAt,
        );
  const hintLabel = NOW_HINT_LABEL[stage];
  const nowHint = hintLabel ? `${hintLabel} ${thaiShortYearDate(since)}` : null;

  return titles.map((title, i) => ({
    title,
    state: i < pos ? 'done' : i === pos ? 'now' : 'idle',
    hint: i === pos ? nowHint : null,
  }));
}

function isExchangeOutcome(outcome: CaseOutcome): boolean {
  return (
    outcome === 'SAME_MODEL_EXCHANGE' ||
    outcome === 'PRICED_EXCHANGE' ||
    outcome === 'CASH_SAME_MODEL_EXCHANGE'
  );
}

// final fix M-9 — เก็บเศษสตางค์ (1500.5 → "1,500.5") เหมือน baht() ของข้อความ LINE
const baht = (v: Prisma.Decimal | null | undefined): string | null =>
  v == null ? null : Number(v.toString()).toLocaleString('th-TH', { maximumFractionDigits: 2 });

/** ถ้อยคำค่าใช้จ่ายฝั่งลูกค้า — ตามบรีฟเป๊ะ:
 * - PRICED_EXCHANGE → ถ้อยคำเดียวกับ costLine ของข้อความ LINE (`PRICED_EXCHANGE_COST_LINE`) —
 *   จ่ายผ่านสัญญาใหม่ ไม่ใช่ "ไม่มี" (final fix I-4)
 * - ไม่มีใบซ่อม + ทางออกซ่อม (REPAIR/null) → "ไม่มี (ในประกันร้าน)"
 * - ไม่มีใบซ่อม + ทางออกเปลี่ยนเครื่องรุ่นเดิม → "ไม่มี (เปลี่ยนเครื่องตามประกัน)"
 * - payer SHOP → "ไม่มี (ในประกันร้าน)" · SUPPLIER_CLAIM → "ไม่มี (เคลมศูนย์)" (สอดคล้องกับ
 *   ถ้อยคำ LINE เดิมใน after-sales-line-copy.util.ts)
 * - payer CUSTOMER: actualCost ก่อน (ชำระที่สาขาแล้ว/รู้ยอดจริง) ไม่งั้นใช้ estimatedCost (ประมาณ)
 *   ไม่มีทั้งคู่ → "แจ้งราคาก่อนซ่อม" (ลูกค้าเป็นผู้จ่าย ห้ามบอกว่า "ไม่มี" — final fix I-4)
 */
function computeCostLine(outcome: CaseOutcome, repairTicket: CaseTicket | null): string {
  if (outcome === 'PRICED_EXCHANGE') return PRICED_EXCHANGE_COST_LINE;
  if (!repairTicket) {
    return isExchangeOutcome(outcome) ? 'ไม่มี (เปลี่ยนเครื่องตามประกัน)' : 'ไม่มี (ในประกันร้าน)';
  }
  if (repairTicket.payer === 'SHOP') return 'ไม่มี (ในประกันร้าน)';
  if (repairTicket.payer === 'SUPPLIER_CLAIM') return 'ไม่มี (เคลมศูนย์)';

  const actual = baht(repairTicket.actualCost);
  if (actual) return `ค่าซ่อม ${actual} บาท ชำระที่สาขา`;
  const estimated = baht(repairTicket.estimatedCost);
  if (estimated) return `ค่าซ่อมประมาณ ${estimated} บาท`;
  return 'แจ้งราคาก่อนซ่อม';
}

function toLiffCase(row: CaseForLiff): LiffAfterSalesCase {
  const deviceName =
    [row.deviceBrand, row.deviceModel].filter(Boolean).join(' ') || 'เครื่องของคุณ';
  return {
    caseNumber: row.caseNumber,
    outcome: row.outcome,
    stageLabel: stageLabel(row.stage, row.outcome),
    deviceName,
    branchName: row.branch.name,
    steps: buildSteps(
      row.stage,
      row.outcome,
      row.receivedAt,
      row.approvedAt,
      row.closedAt,
      row.updatedAt,
      row.repairTicket,
    ),
    updatedAt: row.updatedAt.toISOString(),
    costLine: computeCostLine(row.outcome, row.repairTicket),
  };
}

@Injectable()
export class LiffAfterSalesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyCases(lineUserId: string): Promise<LiffAfterSalesResponse> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineIdShop: lineUserId, deletedAt: null },
      select: { id: true },
    });

    // ยังไม่ผูกบัญชี — หน้าจอจะบอกวิธีผูก ไม่ใช่ error (เหมือน LiffWarrantyService)
    if (!customer) return { linked: false, cases: [] };

    const closedSince = new Date(Date.now() - FOURTEEN_DAYS_MS);
    const rows = await this.prisma.afterSalesCase.findMany({
      where: {
        customerId: customer.id,
        deletedAt: null,
        // final fix M-3 — เคสที่ยกเลิกโชว์ 14 วันเหมือนเคสที่ปิด (เดิมหลุดทันทีเพราะ stored CANCELLED)
        OR: [
          { stage: { notIn: ['CLOSED', 'CANCELLED'] } },
          { closedAt: { gte: closedSince } },
          { cancelledAt: { gte: closedSince } },
        ],
      },
      select: SELECT,
      orderBy: { receivedAt: 'desc' },
      take: 10,
    });

    const cases: LiffAfterSalesCase[] = [];
    for (const row of rows) {
      // stage ที่เก็บไว้อาจดริฟท์จากความจริง (ดู after-sales-stage-reconcile.ts) — reconcile
      // ก่อนแปลงเป็นถ้อยคำลูกค้าเสมอ ไม่ใช้ row.stage ดิบ
      const reconciled = await reconcileStage(this.prisma, row);
      cases.push(toLiffCase(reconciled));
    }

    return { linked: true, cases };
  }
}
