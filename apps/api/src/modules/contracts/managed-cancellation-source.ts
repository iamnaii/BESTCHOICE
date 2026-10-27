import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { canAccess, PermissionKey } from '@installment/shared';
import { Prisma, Contract } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  currentDomainAccess,
  isCurrentDomainClient,
} from '../employee-access/access-execution-context';
import { exchangeContractSource } from '../employee-access/access-exchange-source.service';
import { currentFinanceReadWhere } from '../employee-access/access-contract-read-scope';
import { currentPreparationSource } from '../employee-access/access-contract-preparation-source';
import { PreparationReadProjection } from '../employee-access/access-contract-preparation-projection';
import { AccessResourceService } from '../employee-access/access-resource.service';
import { AccessSnapshotService } from '../employee-access/access-snapshot.service';
import { creditSnapshot } from '../trade-in/services/trade-in-credit.service';

const denied = () => new ForbiddenException('ไม่มีสิทธิ์ดำเนินการคำขอยกเลิกนี้');
export function cancellationReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000)
    throw new BadRequestException('กรุณาระบุเหตุผล 1–2000 ตัวอักษร');
  return value.trim();
}
export async function cancellationActor(
  base: PrismaService,
  actorId: string,
  permission: PermissionKey,
  company: 'SHOP' | 'FINANCE',
) {
  const ctx = currentDomainAccess();
  if (!ctx) {
    const actor = await base.user.findUnique({
      where: { id: actorId },
      select: { accessManaged: true },
    });
    if (actor?.accessManaged) throw denied();
    return undefined;
  }
  if (
    ctx.scopeReads ||
    ctx.isolationLevel !== 'Serializable' ||
    !ctx.effects ||
    ctx.snapshot.userId !== actorId ||
    ctx.scope.userId !== actorId ||
    ctx.scope.company !== company ||
    ctx.scope.permission !== permission ||
    !isCurrentDomainClient(ctx.client)
  )
    throw denied();
  return ctx;
}
/** Exact current source, independently scoped reads, and canonical affected identities.
 * Rejection calls only the parent part: closing stale work needs no executable stock. */
export async function cancellationSource(
  base: PrismaService,
  id: string,
  mode: 'request' | 'approve' | 'reject' | 'delete',
) {
  const ctx = currentDomainAccess();
  if (!ctx) throw denied();
  const tx = ctx.client;
  const deleting = mode === 'delete';
  if (mode !== 'request' && !ctx.snapshot.isOwner) throw denied();
  await tx.$queryRaw`SELECT id FROM contracts WHERE id=${id} FOR UPDATE`;
  const source = deleting
    ? (await currentPreparationSource(id, ['contracts.update'])).source
    : await exchangeContractSource(tx, id, true);
  const permission = deleting
    ? 'contracts.update'
    : mode === 'request'
      ? 'sales.cancel.request'
      : 'sales.cancel.approve';
  if (!canAccess(ctx.snapshot, permission, source)) throw denied();
  if (
    mode === 'request' &&
    !(await tx.contract.count({
      where: { id, AND: await currentFinanceReadWhere('contracts.read') },
    }))
  )
    throw denied();
  const contract = await tx.contract.findFirst({ where: { id, deletedAt: null } });
  if (!contract) throw denied();
  if (mode === 'reject')
    return { contract, books: [] as Array<{ id: string; companyCode: string | null }> };
  await tx.$queryRaw`SELECT id FROM customers WHERE id=${contract.customerId} FOR UPDATE`;
  const projection = await new PreparationReadProjection().initialize();
  if (!(await tx.contract.count({ where: { id, AND: projection.customerWhere() } })))
    throw denied();
  const resources = new AccessResourceService(base, new AccessSnapshotService(base));
  const productIds = [...new Set([contract.productId, ...contract.bundleProductIds])].sort();
  if (productIds.length > 10000) throw denied();
  for (const productId of productIds) {
    await tx.$queryRaw`SELECT id FROM products WHERE id=${productId} FOR UPDATE`;
    const p = await tx.product.findUnique({ where: { id: productId } });
    // The canonical accessory executor deliberately skips these rows. Retain that
    // outcome; do not invent mutation authority over nonexistent work.
    const affected =
      productId === contract.productId ||
      (deleting ? p?.status === 'RESERVED' : p?.status === 'SOLD_CASH' && !p.deletedAt);
    if (!affected) continue;
    const productSource = await resources.product(tx, productId, true);
    if (!canAccess(ctx.snapshot, 'products.read', productSource)) throw denied();
  }
  const books = await tx.companyInfo.findMany({
    where: { companyCode: { in: ['SHOP', 'FINANCE'] }, isActive: true, deletedAt: null },
    select: { id: true, companyCode: true },
  });
  if (
    !books.some((b) => b.companyCode === 'SHOP') ||
    (!deleting && !books.some((b) => b.companyCode === 'FINANCE'))
  )
    throw denied();
  await lockCancellationDependents(tx, contract);
  // Sale and credit provenance uses its own persisted origin, never the Contract's
  // branch as a substitute. Owners still need a real live source.
  const credit = creditSnapshot(contract.tradeInCreditSnapshot);
  const sales = await tx.sale.findMany({
    where: { contractId: id, deletedAt: null },
    select: { id: true, branchId: true },
  });
  for (const sale of !deleting || credit ? sales : []) {
    const saleSource = await resources.branch(tx, sale.branchId, true);
    if (
      saleSource.company !== 'SHOP' ||
      (mode !== 'request' && !canAccess(ctx.snapshot, permission, saleSource))
    )
      throw denied();
  }
  if (credit) {
    const redemption = await tx.tradeInCreditRedemption.findUnique({
      where: { id: credit.redemptionId },
    });
    const trade = await tx.tradeIn.findUnique({ where: { id: credit.tradeInId } });
    if (
      !redemption ||
      redemption.tradeInId !== credit.tradeInId ||
      redemption.contractId !== id ||
      redemption.saleId ||
      !trade ||
      trade.deletedAt ||
      !trade.branchId
    )
      throw denied();
    const tradeSource = await resources.branch(tx, trade.branchId, true);
    if (
      tradeSource.company !== 'SHOP' ||
      (mode !== 'request' && !canAccess(ctx.snapshot, permission, tradeSource))
    )
      throw denied();
  }
  // These rows have independent persisted provenance. Only rows the canonical
  // executor will mutate require it; received receivables remain untouched.
  const receivables =
    !deleting || credit
      ? await tx.financeReceivable.findMany({
          where: {
            saleId: { in: sales.map((s) => s.id) },
            deletedAt: null,
            status: { notIn: ['RECEIVED', 'PARTIALLY_RECEIVED'] },
            OR: [{ receivedAmount: null }, { receivedAmount: 0 }],
          },
          select: { branchId: true },
          take: 10001,
        })
      : [];
  if (receivables.length > 10000) throw denied();
  for (const row of receivables) {
    const rowSource = await resources.branch(tx, row.branchId, true);
    if (
      rowSource.company !== 'SHOP' ||
      (mode !== 'request' && !canAccess(ctx.snapshot, permission, rowSource))
    )
      throw denied();
  }
  if (credit) {
    const intercompany = await tx.interCompanyTransaction.findMany({
      where: {
        OR: [{ contractId: id }, { saleId: { in: sales.map((s) => s.id) } }],
        deletedAt: null,
        status: { not: 'RECONCILED' },
        reconciledAt: null,
        journalEntryId: null,
      },
      select: { branchId: true, fromCompanyId: true, toCompanyId: true },
      take: 10001,
    });
    if (intercompany.length > 10000) throw denied();
    for (const row of intercompany) {
      const rowSource = await resources.branch(tx, row.branchId, true);
      if (
        rowSource.company !== 'SHOP' ||
        !books.some((b) => b.id === row.fromCompanyId) ||
        !books.some((b) => b.id === row.toCompanyId) ||
        (mode !== 'request' && !canAccess(ctx.snapshot, permission, rowSource))
      )
        throw denied();
    }
  }
  const tenders = await tx.shopTender.findMany({
    where: { contractId: id },
    select: { branchId: true },
  });
  for (const branchId of [...new Set(tenders.map((t) => t.branchId))].sort()) {
    const tenderSource = await resources.branch(tx, branchId, true);
    if (
      tenderSource.company !== 'SHOP' ||
      (mode !== 'request' && !canAccess(ctx.snapshot, permission, tenderSource))
    )
      throw denied();
  }
  const redemption = credit
    ? await tx.tradeInCreditRedemption.findUnique({
        where: { id: credit.redemptionId },
        select: { applicationJournalEntryId: true },
      })
    : null;
  const journalWhere: Prisma.JournalEntryWhereInput = {
    status: 'POSTED',
    deletedAt: null,
    OR: [
      { metadata: { path: ['contractId'], equals: id } },
      ...(contract.inputVatJournalEntryId ? [{ id: contract.inputVatJournalEntryId }] : []),
      { metadata: { path: ['idempotencyKey'], equals: `shop-down-payment:${id}` } },
      { metadata: { path: ['idempotencyKey'], equals: `shop-tender-split:contract:${id}` } },
      ...(redemption?.applicationJournalEntryId
        ? [{ id: redemption.applicationJournalEntryId }]
        : []),
    ],
  };
  const entries = await tx.journalEntry.findMany({
    where: journalWhere,
    select: { companyId: true },
  });
  if (entries.some((e) => !books.some((b) => b.id === e.companyId))) throw denied();
  const shopId = books.find((b) => b.companyCode === 'SHOP')!.id;
  const shopOriginals = await tx.journalEntry.findMany({
    where: {
      deletedAt: null,
      OR: [
        { metadata: { path: ['idempotencyKey'], equals: `shop-down-payment:${id}` } },
        { metadata: { path: ['idempotencyKey'], equals: `shop-tender-split:contract:${id}` } },
        ...(redemption?.applicationJournalEntryId
          ? [{ id: redemption.applicationJournalEntryId }]
          : []),
      ],
    },
    select: { companyId: true, metadata: true },
  });
  if (
    shopOriginals.some(
      (e) =>
        e.companyId !== shopId ||
        ((e.metadata as Record<string, unknown> | null)?.contractId != null &&
          (e.metadata as Record<string, unknown>).contractId !== id),
    )
  )
    throw denied();
  if (
    contract.inputVatStatus === 'CLAIMED' &&
    contract.inputVatJournalEntryId &&
    !(await tx.journalEntry.count({
      where: {
        id: contract.inputVatJournalEntryId,
        metadata: { path: ['contractId'], equals: id },
        companyId: books.find((b) => b.companyCode === 'FINANCE')?.id,
      },
    }))
  )
    throw denied();
  const settled = await tx.interCoSettlementItem.findMany({
    where: {
      contractId: id,
      deletedAt: null,
      itemType: 'SETTLEMENT',
      batch: { status: 'POSTED', deletedAt: null },
    },
    select: {
      shopFinancedGl: true,
      shopCommissionGl: true,
      batch: { select: { financeJournalEntryId: true, shopJournalEntryId: true } },
    },
    take: 10001,
  });
  if (settled.length > 10000) throw denied();
  for (const item of settled)
    for (const [code, entryId, required] of [
      ['FINANCE', item.batch.financeJournalEntryId, true],
      [
        'SHOP',
        item.batch.shopJournalEntryId,
        item.shopFinancedGl.plus(item.shopCommissionGl).gt(0),
      ],
    ] as const) {
      if (!entryId) {
        if (required) throw denied();
        continue;
      }
      await tx.$queryRaw`SELECT id FROM journal_entries WHERE id=${entryId} FOR SHARE`;
      if (
        !(await tx.journalEntry.count({
          where: {
            id: entryId,
            status: 'POSTED',
            deletedAt: null,
            companyId: books.find((b) => b.companyCode === code)?.id,
          },
        }))
      )
        throw denied();
    }
  if (!deleting) {
    const restored = await tx.repossession.findMany({
      where: { productId: contract.productId, status: 'SOLD', deletedAt: null },
      select: { contractId: true },
    });
    for (const origin of restored) await exchangeContractSource(tx, origin.contractId, true);
  }
  return { contract, books };
}
/** Locks every existing canonical dependency in deterministic table/ID order.
 * Serializable and the locked parent also protect canonical membership changes. */
async function lockCancellationDependents(tx: Prisma.TransactionClient, c: Contract) {
  const id = c.id,
    products = [...new Set([c.productId, ...c.bundleProductIds])].sort();
  await tx.$queryRaw`SELECT id FROM payments WHERE contract_id=${id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM installment_schedules WHERE contract_id=${id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM receipts WHERE contract_id=${id} ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM inter_co_settlement_items WHERE contract_id=${id} ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM inter_co_settlement_batches WHERE id IN (SELECT batch_id FROM inter_co_settlement_items WHERE contract_id=${id}) ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM sales WHERE contract_id=${id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM finance_receivables WHERE sale_id IN (SELECT id FROM sales WHERE contract_id=${id}) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM inter_company_transactions WHERE contract_id=${id} OR sale_id IN (SELECT id FROM sales WHERE contract_id=${id}) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sales_commissions WHERE contract_id=${id} OR sale_id IN (SELECT id FROM sales WHERE contract_id=${id}) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT p.id FROM commission_payouts p WHERE EXISTS (SELECT 1 FROM sales_commissions c WHERE (c.contract_id=${id} OR c.sale_id IN (SELECT id FROM sales WHERE contract_id=${id})) AND c.salesperson_id=p.salesperson_id AND c.period=p.period) ORDER BY p.id FOR UPDATE OF p`;
  await tx.$queryRaw`SELECT id FROM bad_debt_provisions WHERE contract_id=${id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM repossessions WHERE product_id=ANY(${products}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM signatures WHERE contract_id=${id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM kyc_verifications WHERE contract_id=${id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM credit_checks WHERE contract_id=${id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM bookings WHERE locked_product_id=ANY(${products}::text[]) OR converted_to_sale_id IN (SELECT id FROM sales WHERE contract_id=${id}) ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM shop_tenders WHERE contract_id=${id} ORDER BY id FOR UPDATE`;
  const credit = creditSnapshot(c.tradeInCreditSnapshot);
  if (credit) {
    await tx.$queryRaw`SELECT id FROM trade_in_credit_redemptions WHERE id=${credit.redemptionId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM trade_ins WHERE id=${credit.tradeInId} FOR UPDATE`;
  }
  // Include metadata-free legacy application journal references as well.
  await tx.$queryRaw`SELECT id FROM journal_entries WHERE metadata->>'contractId'=${id}
    OR id=${c.inputVatJournalEntryId}
    OR metadata->>'idempotencyKey' IN (${`shop-down-payment:${id}`},${`shop-tender-split:contract:${id}`})
    OR id IN (SELECT application_journal_entry_id FROM trade_in_credit_redemptions WHERE contract_id=${id}) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM journal_lines WHERE journal_entry_id IN (
    SELECT id FROM journal_entries WHERE metadata->>'contractId'=${id}
    OR id=${c.inputVatJournalEntryId}
    OR metadata->>'idempotencyKey' IN (${`shop-down-payment:${id}`},${`shop-tender-split:contract:${id}`})
    OR id IN (SELECT application_journal_entry_id FROM trade_in_credit_redemptions WHERE contract_id=${id})
  ) ORDER BY id FOR SHARE`;
}
