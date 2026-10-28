import { Prisma, type CommissionStatus } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { isCoveredByPayout, UNPAID_PAYOUT_STATUSES } from '../../commission/commission-payout-cover.util';

/**
 * Payroll D4 ส่วนที่ 2 — สถานะค่าคอมของพนักงานต่องวด: แหล่งเดียวของกติกา "จ่ายได้" และ "หักคืนได้"
 * `PayrollSystemRowsService.compute` แปลงผลนี้เป็นแถว/รายการ · ด่านอนุมัติ/ลงบัญชี (Task 4) ใช้ผลเดียวกันตรวจรายการที่เก็บไว้
 * (P2-R2 — ห้ามเขียนกติกาชุดที่สอง)
 *
 * - ยังมีผล (live) = `releasedAt` null เท่านั้น ไม่กรองสถานะเอกสาร — ชุดเดียวกับดัชนี `payroll_commission_items_one_active_pay`
 *   (P2-R12: กรองต่างจากดัชนี = รายการที่ปล่อยตกหล่นกลายเป็น P2002 ถาวร)
 * - ใบอื่น = `payrollLine.payroll.documentId ≠ excludeDocumentId` (ไม่ส่ง = ทุกใบเป็นใบอื่น — ทางสร้างใบใหม่)
 * - อ่านทุกอย่างผ่าน `client` ที่ส่งมา และไม่ล็อกเอง — ผู้เรียกถือ `payroll-clawback:${userId}` (Task 4, P2-R1) ⇒ ยอดหักคืนคงเหลือ
 *   ที่อ่านได้คงที่จนจบธุรกรรม (Decision 1)
 * - จับคู่ค่าคอมด้วย `salespersonId` (ผู้เขียนทุกตัวตั้ง `snapshotSalespersonId` เท่ากันอยู่แล้ว — P2-R21)
 */

type Client = Prisma.TransactionClient | PrismaService;

const CLAWBACK_STATUSES: CommissionStatus[] = ['CLAWED_BACK', 'PARTIALLY_CLAWED_BACK'];
const ZERO = new Prisma.Decimal(0);

const REFERENCE_SELECT = {
  id: true,
  salespersonId: true,
  period: true,
  createdAt: true,
  contract: { select: { contractNumber: true } },
  sale: { select: { saleNumber: true } },
} satisfies Prisma.SalesCommissionSelect;

const ITEM_SELECT = {
  salesCommissionId: true,
  kind: true,
  accountCode: true,
  amount: true,
  payrollLine: { select: { payroll: { select: { documentId: true, document: { select: { number: true, status: true } } } } } },
} satisfies Prisma.PayrollCommissionItemSelect;

export interface CommissionStateQuery {
  userIds: string[];
  /** 'YYYY-MM' — ดึงค่าคอมที่ `period ≤ payrollPeriod` */
  payrollPeriod: string;
  /** ใบที่กำลังบันทึก/ตรวจ — รายการของใบนี้เองไม่นับเป็น "ใบอื่น" */
  excludeDocumentId?: string;
  /** ใบ FINANCE: อ่านเฉพาะชุดจ่ายได้ (นับให้คำเตือน COMMISSION_FINANCE_BLOCKED) ไม่อ่านหักคืน — P2-R15 */
  payOnly?: boolean;
}

/** ค่าคอมที่จ่ายได้ในใบนี้ — APPROVED · period ≤ งวด · ไม่ถูกลบ · ยอด > 0 · ไม่อยู่ในรอบจ่ายเดิม · ไม่มีรายการ PAY ที่ยังมีผลในใบอื่น */
export interface PayableCommission {
  id: string;
  period: string;
  amount: Prisma.Decimal;
  createdAt: Date;
  reference: string;
}

/** ค่าคอมที่ผ่านกติกาจ่ายได้ทุกข้อ ยกเว้นมีรายการ PAY ที่ยังมีผลในใบอื่น — หนึ่งกลุ่มต่อใบ เรียงตามเลขที่ใบ */
export interface CommissionHeldElsewhere {
  documentId: string;
  documentNumber: string;
  commissionIds: string[];
}

/**
 * ค่าคอมที่จ่ายแล้ว (`paidAt` ตั้งอยู่ — P2-R8) แล้วถูกเรียกคืน: CLAWED_BACK / PARTIALLY_CLAWED_BACK · `clawbackAmount` > 0 · ไม่ถูกลบ
 * (จ่ายแล้วแต่ไม่เคยผ่านใบเงินเดือนที่ลงบัญชีแล้ว → `paidAccountCode` null · ไม่เคยจ่าย → ไม่อยู่ในชุดนี้เลย)
 */
export interface ClawbackCommission {
  id: string;
  clawbackAmount: Prisma.Decimal;
  clawbackAt: Date | null;
  clawbackReason: string | null;
  createdAt: Date;
  reference: string;
  /** บัญชีของรายการ PAY ที่ยังมีผลในใบเงินเดือน POSTED (= บัญชีที่หักคืนเข้า) · null = จ่ายนอกใบเงินเดือน ระบบไม่หักให้ */
  paidAccountCode: string | null;
  /** `clawbackAmount − Σ รายการ CLAWBACK ที่ยังมีผลในใบอื่น` (ร่างก็นับ) — ≤ 0 = หักครบแล้ว */
  outstanding: Prisma.Decimal;
}

export interface UserCommissionState {
  /** เรียง [period, createdAt, id] */
  payable: PayableCommission[];
  heldElsewhere: CommissionHeldElsewhere[];
  /** เรียง [clawbackAt, id] — ลำดับที่หักก่อน · `payOnly` = [] */
  clawbacks: ClawbackCommission[];
}

/** อ้างอิงของค่าคอม (P2-R21) = เลขสัญญา ?? เลขใบขาย ?? id — ใช้ร่วมกับป้าย diff / ข้อความกลับรายการ (Task 4) */
export const referenceOf = (c: { id: string; contract: { contractNumber: string } | null; sale: { saleNumber: string } | null }) =>
  c.contract?.contractNumber ?? c.sale?.saleNumber ?? c.id;

/** สถานะค่าคอมของทุกคนใน `userIds` (มีคีย์ครบทุกคน แม้ไม่มีค่าคอม) */
export async function loadCommissionState(client: Client, q: CommissionStateQuery): Promise<Map<string, UserCommissionState>> {
  const userIds = [...new Set(q.userIds)];
  const state = new Map<string, UserCommissionState>(userIds.map((u) => [u, { payable: [], heldElsewhere: [], clawbacks: [] }]));
  if (userIds.length === 0) return state;

  const [approved, payouts, clawedBack] = await Promise.all([
    client.salesCommission.findMany({
      where: { salespersonId: { in: userIds }, status: 'APPROVED', period: { lte: q.payrollPeriod }, deletedAt: null, commissionAmount: { gt: 0 } },
      select: { ...REFERENCE_SELECT, commissionAmount: true },
      orderBy: [{ period: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    client.commissionPayout.findMany({
      where: { salespersonId: { in: userIds }, period: { lte: q.payrollPeriod }, deletedAt: null, status: { notIn: [...UNPAID_PAYOUT_STATUSES] } }, // รอบจ่ายเดิมที่ "นับว่าจ่ายแล้ว" (P2-R27 — รายการเดียวกับ G4b ของการยกเลิกใบขาย)
      select: { salespersonId: true, period: true, generatedAt: true },
    }),
    q.payOnly
      ? Promise.resolve([])
      : client.salesCommission.findMany({
          where: { salespersonId: { in: userIds }, status: { in: CLAWBACK_STATUSES }, clawbackAmount: { gt: 0 }, paidAt: { not: null }, deletedAt: null },
          select: { ...REFERENCE_SELECT, clawbackAmount: true, clawbackAt: true, clawbackReason: true },
          orderBy: [{ clawbackAt: 'asc' }, { id: 'asc' }],
        }),
  ]);

  const candidates = approved.filter((c) => !payouts.some((p) => isCoveredByPayout(c, p)));
  const ids = [...candidates, ...clawedBack].map((c) => c.id);
  const items =
    ids.length === 0
      ? []
      : await client.payrollCommissionItem.findMany({
          where: { releasedAt: null, salesCommissionId: { in: ids } },
          select: ITEM_SELECT,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
  const itemsOf = new Map<string, typeof items>();
  for (const i of items) itemsOf.set(i.salesCommissionId, [...(itemsOf.get(i.salesCommissionId) ?? []), i]);
  const inOtherDocument = (i: (typeof items)[number]) => i.payrollLine.payroll.documentId !== q.excludeDocumentId;

  for (const c of candidates) {
    const s = state.get(c.salespersonId)!;
    const held = (itemsOf.get(c.id) ?? []).find((i) => i.kind === 'PAY' && inOtherDocument(i));
    if (!held) {
      s.payable.push({ id: c.id, period: c.period, amount: c.commissionAmount, createdAt: c.createdAt, reference: referenceOf(c) });
      continue;
    }
    const { documentId, document } = held.payrollLine.payroll;
    const group = s.heldElsewhere.find((g) => g.documentId === documentId);
    if (group) group.commissionIds.push(c.id);
    else s.heldElsewhere.push({ documentId, documentNumber: document.number, commissionIds: [c.id] });
  }
  for (const s of state.values()) s.heldElsewhere.sort((a, b) => (a.documentNumber < b.documentNumber ? -1 : a.documentNumber > b.documentNumber ? 1 : 0));

  for (const c of clawedBack) {
    const own = itemsOf.get(c.id) ?? [];
    const paidItem = own.find((i) => i.kind === 'PAY' && i.payrollLine.payroll.document.status === 'POSTED');
    const deductedElsewhere = own.filter((i) => i.kind === 'CLAWBACK' && inOtherDocument(i)).reduce((sum, i) => sum.plus(i.amount), ZERO);
    const clawbackAmount = c.clawbackAmount ?? ZERO; // where กรอง > 0 แล้ว
    state.get(c.salespersonId)!.clawbacks.push({
      id: c.id,
      clawbackAmount,
      clawbackAt: c.clawbackAt,
      clawbackReason: c.clawbackReason,
      createdAt: c.createdAt,
      reference: referenceOf(c),
      paidAccountCode: paidItem?.accountCode ?? null,
      outstanding: clawbackAmount.minus(deductedElsewhere),
    });
  }
  return state;
}
