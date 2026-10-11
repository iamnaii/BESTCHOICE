import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * งานแจ้งฝ่ายบัญชี "ตีกลับเครื่องขณะใบมีมัดจำค้าง" (คำตัดสินเจ้าของ 2026-10-06/11 — Todo ตีกลับ):
 * เครื่องจากใบสั่งซื้อที่กด "ไม่รับเข้าคลัง" จากคิวรอถ่ายรูปไม่เคยลงบัญชี จึงไม่มีรายการให้กลับ — แต่ถ้าใบนั้นจ่ายมัดจำไว้
 * มัดจำส่วนของเครื่องนั้นจะค้างใน S11-4201 โดยไม่มีเจ้าหนี้มาหัก ⇒ แจ้งฝ่ายบัญชีหนึ่งใบต่อใบสั่งซื้อ (ไม่ซ้ำขณะยังเปิดอยู่)
 * และปิดให้เองเมื่อมัดจำค้างเป็นศูนย์ (ปิดใบ รับไม่ครบ / ยกเลิกใบ ระบุผลมัดจำแล้ว หรือมัดจำถูกหักเข้าเจ้าหนี้ของเครื่องอื่นจนหมด).
 */
export const PO_DEPOSIT_REJECT_TODO_TAG = 'po-deposit-reject';
export const poDepositRejectTodoKey = (poId: string) => `po:${poId}`;

const money = (v: Decimal) => v.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface DepositRejectTodoInput {
  poId: string;
  poNumber: string;
  depositOutstanding: Decimal;
  rejectedCount: number;
  reason: string;
  createdById: string;
}

/** สร้างงานถ้ายังไม่มีใบที่เปิดอยู่ของใบสั่งซื้อนี้ — คืน true เมื่อสร้างใหม่ */
export async function ensureDepositRejectTodo(tx: Prisma.TransactionClient, input: DepositRejectTodoInput): Promise<boolean> {
  const key = poDepositRejectTodoKey(input.poId);
  const open = await tx.todo.findFirst({
    where: { tags: { hasEvery: [PO_DEPOSIT_REJECT_TODO_TAG, key] }, status: { not: 'DONE' }, deletedAt: null },
    select: { id: true },
  });
  if (open) return false;
  await tx.todo.create({
    data: {
      title: `ใบสั่งซื้อ ${input.poNumber} ตีกลับเครื่อง ${input.rejectedCount} ชิ้น ขณะมีมัดจำค้าง ${money(input.depositOutstanding)} บาท`,
      description:
        `เครื่องจากใบสั่งซื้อนี้ถูกกด "ไม่รับเข้าคลัง" จากคิวรอถ่ายรูป (เหตุผล: ${input.reason}) — เครื่องยังไม่เคยลงบัญชี ` +
        `จึงไม่มีรายการให้กลับ แต่มัดจำ ${money(input.depositOutstanding)} บาทยังค้างใน S11-4201 โดยไม่มีเจ้าหนี้มาหัก\n` +
        'ถ้าผู้จัดจำหน่ายส่งเครื่องทดแทน: รับของตามใบเดิม มัดจำจะถูกหักเข้าเจ้าหนี้เอง · ' +
        'ถ้าไม่ส่งแล้ว: ให้เจ้าของกิจการหรือผู้จัดการสาขากด "ปิดใบ รับไม่ครบ" ในใบสั่งซื้อ แล้วระบุว่ามัดจำได้คืนหรือไม่ได้คืน — ' +
        'ระบบปิดงานนี้ให้เองเมื่อมัดจำค้างของใบเป็นศูนย์ ไม่มีรายการบัญชีอัตโนมัติจากงานนี้',
      priority: 'MEDIUM',
      tags: [PO_DEPOSIT_REJECT_TODO_TAG, key],
      createdById: input.createdById,
    },
  });
  return true;
}

/** ปิดงานตีกลับที่ยังเปิดอยู่ของใบสั่งซื้อนี้ (เรียกเมื่อมัดจำค้าง = 0) — คืนจำนวนที่ปิด */
export async function closeDepositRejectTodos(tx: Prisma.TransactionClient, poId: string): Promise<number> {
  const res = await tx.todo.updateMany({
    where: { tags: { hasEvery: [PO_DEPOSIT_REJECT_TODO_TAG, poDepositRejectTodoKey(poId)] }, status: { not: 'DONE' }, deletedAt: null },
    data: { status: 'DONE' },
  });
  return res.count;
}
