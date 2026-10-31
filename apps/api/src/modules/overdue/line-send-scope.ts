import { Prisma } from '@prisma/client';
import { getBranchScope } from '../auth/branch-access.util';
import { collectionsSessionDay } from '../collections-session/collections-session.service';

/**
 * ผู้ส่ง/ผู้อ่าน LINE การเงินของลูกค้าจากหน้าจอทวงถาม — role/branchId ใช้ตัดขอบเขตสาขา (`getBranchScope`) · id = ผู้ทวงของงานรายวัน
 * (+ ลง audit ของผู้เรียก)
 */
export type LineSendActor = { id: string; role: string; branchId: string | null };

/**
 * **ขอบเขตเดียว**ของการเข้าถึง LINE การเงินของลูกค้าจากหน้าจอทวงถาม — สัญญาที่ผู้ใช้ส่ง LINE ได้ (ปุ่ม "ส่ง LINE" ad-hoc และส่งรวด
 * `OverdueBulkService`) = ขอบเขตเดียวกับหน้าจอที่ปุ่มอยู่:
 * - role ข้ามสาขา (`CROSS_BRANCH_ROLES`) — ทุกสัญญา
 * - นอกนั้น — สัญญาในสาขาตัวเอง (คิวทวงถาม / `queue-row` / แบนเนอร์นัดครบกำหนด — Task 24 fix round 1 M-3) **หรือ** สัญญาที่ผู้ใช้มีงานรายวันวันนี้
 *   (โหมดโฟกัส `GET /collections/session/mine` อ่านตามงานที่จ่าย ซึ่งจ่ายข้ามสาขาได้โดยตั้งใจ: round-robin · เติมขั้นต่ำ · ความสัมพันธ์เดิม · หยิบจาก pool —
 *   Task 24 fix round 2 I-R1) · "วันนี้" = `collectionsSessionDay` นิยามเดียวกับหน้าจอ · ไม่มีสาขาและไม่มีงาน = ไม่มีอะไร (fail closed)
 *
 * ระดับลูกค้าใช้ `lineSendCustomerScope` (ประกอบจากตัวนี้ — ห้ามเขียนกติกาชุดที่สอง)
 */
export function lineSendContractScope(
  actor: LineSendActor,
  now: Date = new Date(),
): Prisma.ContractWhereInput {
  const scope = getBranchScope(actor);
  if (scope.all) return {};
  const assignedToday: Prisma.ContractWhereInput = {
    dailyAssignments: {
      some: { collectorId: actor.id, date: collectionsSessionDay(now), deletedAt: null },
    },
  };
  return { OR: scope.branchId ? [{ branchId: scope.branchId }, assignedToday] : [assignedToday] };
}

/**
 * Task 29 #3 (เจ้าของตัดสิน 31 ต.ค. 2026) — ลูกค้าที่ผู้ใช้เปิดแท็บ "แชท LINE" ของแผง 360 ได้ (`GET`/`POST /staff-chat/customer/:customerId/messages`)
 * = ลูกค้าที่มีสัญญา (ไม่ถูกลบ) อย่างน้อยหนึ่งสัญญาใน `lineSendContractScope` · role ข้ามสาขา = ทุกลูกค้า (รวมผู้สนใจที่ไม่มีสัญญา) ·
 * นอกขอบเขต = 404 เหมือนปุ่มส่ง · การยกเลิกผูก LINE ไม่ใช้ขอบเขตนี้ (เจ้าของตัดสิน — ไม่จำกัดสาขา)
 */
export function lineSendCustomerScope(
  actor: LineSendActor,
  now: Date = new Date(),
): Prisma.CustomerWhereInput {
  if (getBranchScope(actor).all) return {};
  return { contracts: { some: { deletedAt: null, ...lineSendContractScope(actor, now) } } };
}
