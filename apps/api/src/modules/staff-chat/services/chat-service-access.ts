import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ChatWorkActor, WorkScope } from '@installment/shared';
import { getBranchScope } from '../../auth/branch-access.util';
/** Resolve aliases without rewriting the historical customer on sales/repair documents. */
export async function canonicalServiceCustomer(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<string> {
  const seen = new Set<string>();
  for (let depth = 0; depth < 32; depth++) {
    if (seen.has(id)) throw new BadRequestException('ข้อมูลการรวมลูกค้าไม่ถูกต้อง');
    seen.add(id);
    const row = await tx.customer.findUnique({
      where: { id },
      select: { id: true, deletedAt: true, mergedIntoId: true },
    });
    if (!row) throw new NotFoundException('ไม่พบลูกค้า');
    if (row.mergedIntoId) {
      id = row.mergedIntoId;
      continue;
    }
    if (row.deletedAt) throw new NotFoundException('ข้อมูลลูกค้าถูกลบ');
    return row.id;
  }
  throw new BadRequestException('กรุณาตรวจการรวมข้อมูลลูกค้า');
}
export async function serviceCustomerFamily(tx: Prisma.TransactionClient, id: string) {
  const root = await canonicalServiceCustomer(tx, id);
  const family = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`WITH RECURSIVE family AS (SELECT id FROM customers WHERE id = ${root} UNION SELECT c.id FROM customers c JOIN family f ON c.merged_into_id = f.id) SELECT id FROM family`,
  );
  return { root, ids: family.map((row) => row.id) };
}
export function serviceBranchWhere(
  actor: ChatWorkActor,
  scope: WorkScope,
): Prisma.BranchWhereInput {
  const branch = getBranchScope(actor);
  const branchId = branch.all ? scope.branchId : branch.branchId;
  if (!branch.all && !branchId) throw new BadRequestException('บัญชียังไม่ระบุสาขา');
  return {
    deletedAt: null,
    ...(branchId ? { id: branchId } : {}),
    OR: [{ companyId: null }, { company: { companyCode: scope.company } }],
  };
}
