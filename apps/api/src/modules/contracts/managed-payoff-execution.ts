import { ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { accountingPeriodOf } from '../../utils/period-lock.util';
import { currentDomainAccess } from '../employee-access/access-execution-context';
import { AccessSnapshotService } from '../employee-access/access-snapshot.service';
import { lockFinanceContractReadSource } from '../employee-access/access-party-source.service';

const unavailable = () => new ForbiddenException('ไม่มีสิทธิ์ดำเนินการปิดสัญญานี้');

/** Legacy admission is decided from the persisted actor inside the money transaction.
 * An old signed slip, role label or approval object cannot stand in for this check. */
export async function assertUnmanagedPayoffActor(tx: Prisma.TransactionClient, actorId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR SHARE`;
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor || !actor.isActive || actor.deletedAt || actor.accessManaged) throw unavailable();
}

/** This has no serialized input authority. Only the server's current owned execution
 * can join the money producer. The future evidence consumer supplies proof separately. */
export async function managedPayoffExecution(
  base: PrismaService,
  contractId: string,
  actorId: string,
) {
  const ctx = currentDomainAccess();
  if (!ctx) return undefined;
  if (
    ctx.domain !== 'parties' ||
    ctx.scopeReads ||
    ctx.scope.company !== 'FINANCE' ||
    ctx.scope.permission !== 'payments.create' ||
    ctx.isolationLevel !== 'Serializable' ||
    !ctx.effects ||
    ctx.snapshot.userId !== actorId ||
    ctx.scope.userId !== actorId
  )
    throw unavailable();
  const tx = ctx.client;
  // AccessResourceService owns the authority fence and persisted grant locks.
  // Re-read rather than accepting an old role or revision from a caller.
  await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR SHARE`;
  const snapshot = await new AccessSnapshotService(base).forUserInTransaction(tx, actorId);
  if (!snapshot.managed) throw unavailable();
  await tx.$queryRaw`SELECT id FROM contracts WHERE id=${contractId} FOR UPDATE`;
  await lockFinanceContractReadSource(tx, contractId);
  const contract = await tx.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: {
      branchId: true,
      productId: true,
      assignedToId: true,
      branch: { include: { company: true } },
    },
  });
  const finance = await tx.companyInfo.findFirst({
    where: { companyCode: 'FINANCE', isActive: true, deletedAt: null },
    select: { id: true },
  });
  const origin = contract?.branch;
  if (
    !contract ||
    !finance ||
    !origin?.isActive ||
    origin.deletedAt ||
    !origin.company?.isActive ||
    origin.company.deletedAt ||
    origin.company.companyCode !== 'SHOP'
  )
    throw unavailable();
  const source = {
    company: 'FINANCE' as const,
    branchId: contract.branchId,
    assignedUserIds: contract.assignedToId ? [contract.assignedToId] : [],
  };
  if (
    !canAccess(snapshot, 'contracts.read', source) ||
    !canAccess(snapshot, 'payments.read', source) ||
    !canAccess(snapshot, 'payments.create', { company: source.company, branchId: source.branchId })
  )
    throw unavailable();
  await tx.$queryRaw`SELECT id FROM products WHERE id=${contract.productId} FOR UPDATE`;
  const product = await tx.product.findFirst({
    where: { id: contract.productId, deletedAt: null, ownedByCompanyId: finance.id },
    select: { id: true },
  });
  if (!product) throw unavailable();
  await tx.$queryRaw`SELECT id FROM payments WHERE contract_id=${contractId} AND deleted_at IS NULL ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM installment_schedules WHERE contract_id=${contractId} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM receipts WHERE contract_id=${contractId} ORDER BY id FOR SHARE`;
  // Include ECL, Contract ledger and schedule-based prior-clearing inputs. Locks do
  // not filter the canonical calculator or silently change historical money.
  await tx.$queryRaw`SELECT id FROM journal_entries WHERE metadata->>'contractId'=${contractId}
    OR metadata->>'installmentScheduleId' IN (SELECT id FROM installment_schedules WHERE contract_id=${contractId})
    ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM journal_lines WHERE journal_entry_id IN (
    SELECT id FROM journal_entries WHERE metadata->>'contractId'=${contractId}
    OR metadata->>'installmentScheduleId' IN (SELECT id FROM installment_schedules WHERE contract_id=${contractId})
  ) ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM bad_debt_provisions WHERE contract_id=${contractId} ORDER BY id FOR UPDATE`;
  return {
    client: tx,
    actorId,
    financeCompanyId: finance.id,
    originShopCompanyId: origin.company.id,
    originBranchId: origin.id,
    productId: product.id,
  };
}

export type ManagedPayoffExecution = NonNullable<
  Awaited<ReturnType<typeof managedPayoffExecution>>
>;

export async function lockPayoffPeriod(
  tx: Prisma.TransactionClient,
  date: Date,
  companyId: string,
) {
  const { year, month } = accountingPeriodOf(date); // the row validatePeriodOpen reads (Bangkok calendar)
  await tx.$queryRaw`SELECT id FROM accounting_periods WHERE company_id=${companyId}
    AND year=${year} AND month=${month} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM system_config WHERE key='period_grace_days' FOR SHARE`;
}
