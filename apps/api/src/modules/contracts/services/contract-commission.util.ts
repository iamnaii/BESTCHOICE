import { PayoutStatus, Prisma } from '@prisma/client';
import { computeCommissionAmount } from '../../../utils/commission.util';
import { bangkokDateString } from '../../../utils/date.util';

/**
 * ค่าคอมพนักงานขายของสัญญาผ่อน BESTCHOICE — คำตัดสินเจ้าของ 2026-09-20:
 *   "เหมือนขายสด · ตั้งตอนเปิดใช้สัญญา · ยกเลิกสัญญา = เรียกคืนค่าคอมที่ยังไม่จ่าย"
 *
 * เดิมค่าคอมของสัญญาผ่อนเกิดได้ทางเดียวคือเส้นทางเก่า `POST /sales` แบบ INSTALLMENT (ถอดแล้ว 2026-09-20)
 * ซึ่งสร้างตั้งแต่สัญญายังเป็นร่าง — สัญญาที่ทำผ่านหน้าสัญญาไม่มีค่าคอมเลย. ตอนนี้ `ContractWorkflowService.activate`
 * เป็นผู้สร้างทางเดียว (สัญญาที่ไม่ถูกเปิดใช้ = ยังไม่ได้ขาย = ยังไม่มีค่าคอม).
 * สัญญาจากการเปลี่ยนเครื่อง (device swap) ไม่เข้าเส้นนี้ — ไม่ใช่การขายใหม่ของพนักงาน.
 */
const FALLBACK_RATE = 0.03;

/** เรียกคืนได้ = ยังไม่ได้จ่าย (ชุดเดียวกับ SaleVoidService) */
const CLAWABLE_STATUSES: readonly string[] = ['PENDING', 'APPROVED'];
/** รอบจ่ายที่ยังไม่ผูกมัดเงิน — DRAFT ถูกลบให้สร้างใหม่ · CANCELLED ไม่เกี่ยว · ที่เหลือ = ล็อกแล้ว */
const UNLOCKED_PAYOUT_STATUSES: readonly PayoutStatus[] = [PayoutStatus.DRAFT, PayoutStatus.CANCELLED];

export async function ensureContractCommission(
  tx: Prisma.TransactionClient,
  input: { contractId: string; saleId: string; salespersonId: string; netAmount: Prisma.Decimal; now?: Date },
): Promise<'CREATED' | 'EXISTS'> {
  // ร่างจากเส้นทางเก่า (ถอดแล้ว — อาจยังค้างในฐาน) มีค่าคอมตั้งแต่ตอนร่างแล้ว — ห้ามสร้างซ้ำ
  const existing = await tx.salesCommission.findFirst({ where: { contractId: input.contractId, deletedAt: null }, select: { id: true } });
  if (existing) return 'EXISTS';

  // กติกาเดียวกับขายสด (sale-writer.service.ts): อัตราจากกฎที่ active ล่าสุด · ไม่มีกฎ = 3%
  const rule = await tx.commissionRule.findFirst({ where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'desc' } });
  const commissionRate = rule?.rate ? Number(rule.rate) : FALLBACK_RATE;
  const saleAmount = Number(input.netAmount);
  await tx.salesCommission.create({
    data: {
      salespersonId: input.salespersonId,
      // T4-C10: ผู้ได้ค่าคอม = พนักงานขายของสัญญา ณ วันเปิดใช้ — เปลี่ยนพนักงานขายทีหลังไม่ย้ายค่าคอม
      snapshotSalespersonId: input.salespersonId,
      contractId: input.contractId,
      saleId: input.saleId,
      // งวดจ่ายตามปฏิทินไทย — เปิดใช้สัญญาตี 1 ของวันที่ 1 ต้องเป็นงวดเดือนใหม่ (เซิร์ฟเวอร์เป็น UTC)
      period: bangkokDateString(input.now ?? new Date()).slice(0, 7),
      saleAmount,
      commissionRate,
      commissionAmount: computeCommissionAmount(saleAmount, commissionRate),
      status: 'PENDING',
    },
  });
  return 'CREATED';
}

export interface ContractCommissionClawback {
  clawedBackIds: string[];
  /** จ่ายไปแล้ว — ไม่เรียกคืนตามคำตัดสินเจ้าของ (เก็บไว้ใน audit ให้ตามดูได้) */
  keptPaidIds: string[];
  /** รอบจ่ายฉบับร่างที่นับค่าคอมนี้ — ลบให้กดสร้างใหม่ (generatePayouts ไม่คำนวณรอบที่มีอยู่แล้วซ้ำ) */
  voidedDraftPayoutIds: string[];
  /** รอบจ่ายที่อนุมัติ/จ่ายแล้วและนับค่าคอมนี้ — ยอดของรอบนั้นไม่ถูกแก้ ต้องให้เจ้าของ/ผจก.การเงินดู */
  lockedPayoutIds: string[];
}

/**
 * ยกเลิกสัญญา (C-1/C-2) → เรียกคืนค่าคอมที่ยังไม่จ่าย. **ไม่บล็อกการยกเลิกสัญญา** (ต่างจากยกเลิกใบขาย):
 * การยกเลิกสัญญาเป็นเรื่องทางกฎหมาย/การเงินกับลูกค้า ห้ามติดเพราะรอบจ่ายค่าคอมภายใน — รอบที่ล็อกแล้วถูกรายงานกลับ
 * ให้ผู้เรียกบันทึกใน audit แทน.
 *
 * ข้อยกเว้นที่อยู่นอกไฟล์นี้: สัญญาที่ใช้เครดิตเทิร์นผ่าน `cleanupCreditContractSale` ก่อนถึงตรงนี้ และด่านของมันยังปฏิเสธเมื่อค่าคอม
 * จ่ายแล้ว/อยู่ในรอบจ่ายที่อนุมัติแล้ว — รอเจ้าของเคาะ (ดู `.claude/rules/accounting.md` หัวข้อค่าคอมสัญญาผ่อน).
 */
export async function clawbackContractCommission(
  tx: Prisma.TransactionClient,
  input: { contractId: string; contractNumber: string; reason: string; now: Date },
): Promise<ContractCommissionClawback> {
  const commissions = await tx.salesCommission.findMany({
    where: { contractId: input.contractId, deletedAt: null },
    select: { id: true, status: true, salespersonId: true, period: true, createdAt: true },
  });
  const clawable = commissions.filter((c) => CLAWABLE_STATUSES.includes(c.status));
  const result: ContractCommissionClawback = {
    clawedBackIds: clawable.map((c) => c.id),
    keptPaidIds: commissions.filter((c) => c.status === 'PAID' || c.status === 'PARTIALLY_CLAWED_BACK').map((c) => c.id),
    voidedDraftPayoutIds: [],
    lockedPayoutIds: [],
  };
  if (!clawable.length) return result;

  await tx.salesCommission.updateMany({
    where: { id: { in: result.clawedBackIds } },
    data: {
      status: 'CLAWED_BACK', clawbackAt: input.now, clawbackPercent: 100,
      clawbackReason: `ยกเลิกสัญญา ${input.contractNumber}: ${input.reason}`,
    },
  });

  // รอบจ่ายที่ "ครอบค่าคอมนี้จริง" = พนักงาน+งวดเดียวกัน และถูกสร้างหลังค่าคอมเกิด (generatedAt null = พิสูจน์ไม่ได้ ถือว่าครอบ)
  const payouts = await tx.commissionPayout.findMany({
    where: { deletedAt: null, OR: clawable.map((c) => ({ salespersonId: c.salespersonId, period: c.period })) },
    select: { id: true, status: true, salespersonId: true, period: true, generatedAt: true },
  });
  const covering = payouts.filter((p) => clawable.some((c) =>
    c.salespersonId === p.salespersonId && c.period === p.period && (p.generatedAt === null || c.createdAt <= p.generatedAt)));
  result.voidedDraftPayoutIds = covering.filter((p) => p.status === PayoutStatus.DRAFT).map((p) => p.id);
  result.lockedPayoutIds = covering.filter((p) => !UNLOCKED_PAYOUT_STATUSES.includes(p.status)).map((p) => p.id);
  if (result.voidedDraftPayoutIds.length) {
    await tx.commissionPayout.updateMany({ where: { id: { in: result.voidedDraftPayoutIds } }, data: { deletedAt: input.now } });
  }
  return result;
}
