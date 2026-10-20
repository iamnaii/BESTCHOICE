import { ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { currentDomainAccess } from '../employee-access/access-execution-context';
import { AccessSnapshotService } from '../employee-access/access-snapshot.service';
import { lockFinanceContractReadSource } from '../employee-access/access-party-source.service';
import { lockPayoffPeriod } from './managed-payoff-execution';

const unavailable = () => new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');

/** Remittance follows payoff/recovery: neither a live loan nor FINANCE-owned
 * Product is its source. Authority comes from the actual case and both books. */
export async function managedShopSettlement(
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
  const checkedDate = new Date();
  const snapshot = await new AccessSnapshotService(base).forUserInTransaction(tx, actorId);
  if (!snapshot.managed) throw unavailable();
  await tx.$queryRaw`SELECT id FROM contracts WHERE id=${contractId} FOR UPDATE`;
  await lockFinanceContractReadSource(tx, contractId);
  const contract = await tx.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    include: { branch: { include: { company: true } } },
  });
  const finance = await tx.companyInfo.findFirst({
    where: { companyCode: 'FINANCE', isActive: true, deletedAt: null },
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
  const shop = origin.company;
  const source = {
    company: 'FINANCE' as const,
    branchId: contract.branchId,
    assignedUserIds: contract.assignedToId ? [contract.assignedToId] : [],
  };
  if (
    !canAccess(snapshot, 'contracts.read', source) ||
    !canAccess(snapshot, 'payments.read', source) ||
    !canAccess(snapshot, 'payments.create', { company: 'FINANCE', branchId: contract.branchId }) ||
    !canAccess(snapshot, 'payments.create', { company: 'SHOP' })
  )
    throw unavailable();

  // Lock the complete candidate set before reading its current versions. These
  // are provenance checks, never extra filters on the canonical money queries.
  await tx.$queryRaw`SELECT id FROM journal_entries WHERE metadata->>'contractId'=${contractId} ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM journal_lines WHERE journal_entry_id IN (
    SELECT id FROM journal_entries WHERE metadata->>'contractId'=${contractId}) ORDER BY id FOR SHARE`;
  const entries = await tx.journalEntry.findMany({
    where: { metadata: { path: ['contractId'], equals: contractId } },
    include: { lines: true },
  });
  for (const entry of entries) {
    if (entry.deletedAt) continue;
    const metadata = entry.metadata as Record<string, unknown> | null;
    if (entry.status === 'POSTED') {
      // Ordinary outstanding deliberately includes soft-deleted lines. Typed
      // history/payable lenses do not; preserve both original definitions.
      if (entry.lines.some((l) => l.accountCode === '11-2107') && entry.companyId !== finance.id)
        throw unavailable();
      if (
        metadata?.shopReceivableType === 'SHOP_COLLECT' &&
        entry.lines.some((l) => l.accountCode === 'S21-1104' && !l.deletedAt) &&
        entry.companyId !== shop.id
      )
        throw unavailable();
    }
    if (metadata?.flow === 'shop-collect-settlement') {
      // Canonical dedupe reads these rows even before outstanding. An arbitrary
      // matching metadata object is not evidence of a posted remittance.
      if (
        entry.status !== 'POSTED' ||
        entry.companyId !== finance.id ||
        typeof metadata.amount !== 'string' ||
        typeof metadata.depositAccountCode !== 'string'
      )
        throw unavailable();
      let amount: Prisma.Decimal;
      try {
        amount = new Prisma.Decimal(metadata.amount);
      } catch {
        throw unavailable();
      }
      if (
        !amount.isFinite() ||
        amount.lte(0) ||
        !entry.lines.some(
          (l) =>
            !l.deletedAt && l.accountCode === '11-2107' && l.credit.eq(amount) && l.debit.isZero(),
        ) ||
        !entry.lines.some(
          (l) =>
            !l.deletedAt &&
            l.accountCode === metadata.depositAccountCode &&
            l.debit.eq(amount) &&
            l.credit.isZero(),
        )
      )
        throw unavailable();
    }
  }
  // Batch has no company/branch fields. Its actual linked journals establish
  // provenance; canonical deduction items remain the monetary source.
  await tx.$queryRaw`SELECT id FROM inter_co_settlement_items WHERE contract_id=${contractId} ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM inter_co_settlement_batches WHERE id IN (
    SELECT batch_id FROM inter_co_settlement_items WHERE contract_id=${contractId}) ORDER BY id FOR SHARE`;
  const items = await tx.interCoSettlementItem.findMany({
    where: {
      contractId,
      deletedAt: null,
      OR: [
        { swapCreditAmount: { gt: 0 } },
        { recallAmount: { gt: 0 } },
        { deviceReturnAmount: { gt: 0 } },
      ],
      batch: { status: { in: ['PENDING_APPROVAL', 'POSTED'] }, deletedAt: null },
    },
    include: { batch: true },
  });
  const linkedIds = [
    ...new Set(
      items
        .flatMap((i) => [i.batch.financeJournalEntryId, i.batch.shopJournalEntryId])
        .filter((id): id is string => !!id),
    ),
  ].sort();
  if (linkedIds.length) {
    await tx.$queryRaw`SELECT id FROM journal_entries WHERE id=ANY(${linkedIds}::text[]) ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM journal_lines WHERE journal_entry_id=ANY(${linkedIds}::text[]) ORDER BY id FOR SHARE`;
  }
  const linked = await tx.journalEntry.findMany({
    where: { id: { in: linkedIds } },
    include: { lines: true },
  });
  for (const item of items) {
    const amounts = [item.swapCreditAmount, item.recallAmount, item.deviceReturnAmount];
    const selected = item.itemType === 'SETTLEMENT' ? 0 : item.itemType === 'RECALL' ? 1 : 2;
    if (
      !amounts[selected].gt(0) ||
      amounts.some((amount, index) => index !== selected && !amount.isZero())
    )
      throw unavailable();
    if (item.batch.status !== 'POSTED') continue; // Genuine pending state reaches the canonical pending guard.
    for (const [id, companyId, code, side] of [
      [item.batch.financeJournalEntryId, finance.id, '11-2107', 'credit'],
      [item.batch.shopJournalEntryId, shop.id, 'S21-1104', 'debit'],
    ] as const) {
      const entry = linked.find((e) => e.id === id);
      const metadata = entry?.metadata as Record<string, unknown> | null;
      if (
        !entry ||
        entry.deletedAt ||
        entry.status !== 'POSTED' ||
        entry.companyId !== companyId ||
        metadata?.flow !== 'interco-settlement-batch' ||
        metadata.settlementBatchId !== item.batchId ||
        !entry.lines.some(
          (l) => !l.deletedAt && l.accountCode === code && l[side].gte(amounts[selected]),
        )
      )
        throw unavailable();
    }
  }
  return {
    client: tx,
    actorId,
    financeCompanyId: finance.id,
    shopCompanyId: shop.id,
    originBranchId: origin.id,
    checkedDate,
    async beforePost(client: Prisma.TransactionClient, companyId: string) {
      if (
        client !== tx ||
        currentDomainAccess() !== ctx ||
        ![finance.id, shop.id].includes(companyId)
      )
        throw unavailable();
      await lockPayoffPeriod(tx, checkedDate, companyId);
      await validatePeriodOpen(tx, checkedDate, companyId);
    },
  };
}
