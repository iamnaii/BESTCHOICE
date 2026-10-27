import { BadRequestException } from '@nestjs/common';
import { ContractExchangeRequest, Prisma } from '@prisma/client';
import { FINANCE_CONTRACT_READ_LIMIT } from './access-party-source.service';
import { PartyQueryPlan } from './access-party-query-plan';

export const CONTRACT_JOURNAL_LIMIT = 2000;
export const CONTRACT_JOURNAL_LINE_LIMIT = 8000;
export const journalOverflow = () =>
  new BadRequestException('กรุณาระบุตัวกรองให้แคบลงแล้วลองอีกครั้ง');
export interface JournalIdentity {
  id: string;
  entryNumber: string;
  companyId: string;
  referenceType: string | null;
  referenceId: string | null;
  meta: Record<string, string | null>;
}
// Identity-only discovery never reads arbitrary narrative, line amounts or JSON objects.
// The finite settlement amount token establishes exact opposite-book identity.
const IDENTITY_KEYS = [
  'contractId',
  'tag',
  'flow',
  'installmentScheduleId',
  'paymentId',
  'portion',
  'originalEntryId',
  'originalEntryNumber',
  'reversesEntryId',
  'reversesEntry',
  'originalJournalEntryId',
  'reversed',
  'reversedByEntryNumber',
  'reversedByIdempotencyKey',
  'reversedByBatchId',
  'idempotencyKey',
  'productId',
  'oldProductId',
  'oldContractId',
  'newContractId',
  'receivingId',
  'batchId',
  'cogsJournalEntryId',
  'deviceReturnId',
  'saleId',
  'requestId',
  'amount',
  'shopReceivableType',
  'period',
  'runDate',
  'direction',
  'fromBucket',
  'toBucket',
  'refno',
  'variant',
  'redemptionId',
  'tradeInId',
] as const;
export async function discoverContractJournal(tx: Prisma.TransactionClient, contractId: string) {
  const projection = Prisma.join(
    IDENTITY_KEYS.flatMap((key) => [
      Prisma.sql`${key}::text`,
      Prisma.sql`CASE WHEN jsonb_typeof(j.metadata->${key}) IN ('string','boolean','number')
      AND length(j.metadata->>${key}) <= 160 THEN j.metadata->>${key}
      WHEN j.metadata->${key} IS NULL OR j.metadata->${key}='null'::jsonb THEN NULL ELSE '__INVALID__' END`,
    ]),
  );
  const primary = await tx.$queryRaw<JournalIdentity[]>`
    SELECT j.id, CASE WHEN length(j.entry_number)<=128 THEN j.entry_number ELSE '' END AS "entryNumber", j.company_id AS "companyId",
      j.reference_type AS "referenceType", CASE WHEN j.reference_id IS NULL OR length(j.reference_id)<=350 THEN j.reference_id ELSE '__INVALID__' END AS "referenceId",
      jsonb_build_object(${projection}) AS meta
    FROM journal_entries j
    WHERE j.deleted_at IS NULL AND j.status='POSTED' AND j.metadata->>'contractId'=${contractId}
    ORDER BY j.id LIMIT ${CONTRACT_JOURNAL_LIMIT + 1}`;
  if (primary.length > CONTRACT_JOURNAL_LIMIT) throw journalOverflow();
  const ids = primary.map((e) => e.id);
  const reversals = ids.length
    ? await tx.$queryRaw<JournalIdentity[]>`
    SELECT j.id, CASE WHEN length(j.entry_number)<=128 THEN j.entry_number ELSE '' END AS "entryNumber", j.company_id AS "companyId",
      j.reference_type AS "referenceType", CASE WHEN j.reference_id IS NULL OR length(j.reference_id)<=350 THEN j.reference_id ELSE '__INVALID__' END AS "referenceId",
      jsonb_build_object(${projection}) AS meta
    FROM journal_entries j
    WHERE j.deleted_at IS NULL AND j.status='POSTED'
      AND (j.metadata->>'originalEntryId'=ANY(${ids}::text[]) OR j.metadata->>'reversesEntryId'=ANY(${ids}::text[]))
    ORDER BY j.id LIMIT ${CONTRACT_JOURNAL_LIMIT + 1}`
    : [];
  const entries = [...new Map([...primary, ...reversals].map((e) => [e.id, e])).values()];
  if (entries.length > CONTRACT_JOURNAL_LIMIT) throw journalOverflow();
  if (entries.length)
    await tx.$queryRaw`SELECT id FROM journal_entries WHERE id=ANY(${entries.map((e) => e.id)}::text[]) ORDER BY id FOR SHARE`;
  return entries;
}

/** All dependency probes are capped, identity-only and locked in this exact attempt.
 * Serializable lock waits on changed versions abort/retry through AccessResourceService. */
export async function loadContractJournalSources(
  plan: PartyQueryPlan,
  contractId: string,
  entries: JournalIdentity[],
) {
  const tx = plan.db;
  let count = 0;
  async function lock<T extends { id: string }>(table: string, rows: T[]): Promise<T[]> {
    count += rows.length;
    if (count > CONTRACT_JOURNAL_LIMIT) throw journalOverflow();
    if (rows.length)
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE id=ANY(${rows.map((r) => r.id)}::text[]) ORDER BY id FOR SHARE`,
      );
    return rows;
  }
  const take = CONTRACT_JOURNAL_LIMIT + 1;
  const orderBy = { id: 'asc' as const };
  const values = (key: string) => [
    ...new Set(entries.map((e) => e.meta[key]).filter((v): v is string => !!v)),
  ];
  type ExchangeIdentity = Pick<
    ContractExchangeRequest,
    | 'id'
    | 'oldContractId'
    | 'newContractId'
    | 'oldProductId'
    | 'newProductId'
    | 'je1aId'
    | 'je2Id'
    | 'je3Id'
    | 'je4Id'
    | 'eclReversalJeId'
    | 'reversalJeIds'
    | 'status'
    | 'cancelWindow'
  >;
  const exchanges = await lock(
    'contract_exchange_requests',
    await tx.$queryRaw<ExchangeIdentity[]>`
    SELECT id, status, cancel_window AS "cancelWindow", old_contract_id AS "oldContractId", new_contract_id AS "newContractId",
      old_product_id AS "oldProductId", new_product_id AS "newProductId",
      je_1a_id AS "je1aId", je_2_id AS "je2Id", je_3_id AS "je3Id", je_4_id AS "je4Id",
      ecl_reversal_je_id AS "eclReversalJeId", ARRAY[]::text[] AS "reversalJeIds"
    FROM contract_exchange_requests WHERE deleted_at IS NULL
      AND (old_contract_id=${contractId} OR new_contract_id=${contractId})
    ORDER BY id LIMIT ${take}`,
  );
  // Expand only candidate links, with one shared cap across all requests.
  // Never materialize each source's arbitrary retained array in application memory.
  const reversalLinks =
    exchanges.length && entries.length
      ? await tx.$queryRaw<Array<{ id: string; entryId: string }>>`
    SELECT r.id, link AS "entryId" FROM contract_exchange_requests r
    CROSS JOIN LATERAL unnest(r.reversal_je_ids) AS link
    WHERE r.id=ANY(${exchanges.map((r) => r.id)}::text[])
      AND link=ANY(${entries.map((entry) => entry.id)}::text[])
    ORDER BY r.id, link LIMIT ${take}`
      : [];
  if (reversalLinks.length > CONTRACT_JOURNAL_LIMIT) throw journalOverflow();
  const exchangeById = new Map(exchanges.map((row) => [row.id, row]));
  for (const link of reversalLinks) exchangeById.get(link.id)!.reversalJeIds.push(link.entryId);
  const defectKeys = ['oldContractId', 'newContractId', 'oldProductId', 'newProductId'];
  const defectProjection = Prisma.join(
    defectKeys.flatMap((key) => [
      Prisma.sql`${key}::text`,
      Prisma.sql`CASE WHEN jsonb_typeof(new_value->${key})='string' AND length(new_value->>${key})<=160 THEN new_value->>${key} ELSE NULL END`,
    ]),
  );
  const defects = await lock(
    'audit_logs',
    await tx.$queryRaw<
      Array<{ id: string; entityId: string; newValue: Record<string, string | null> }>
    >`
    SELECT id, entity_id AS "entityId", jsonb_build_object(${defectProjection}) AS "newValue"
    FROM audit_logs WHERE action='DEFECT_EXCHANGE' AND entity='contract'
      AND new_value->>'oldContractId'=${contractId} ORDER BY id LIMIT ${take}`,
  );
  const otherIds = [
    ...new Set(
      [
        contractId,
        ...exchanges.flatMap((e) => [e.oldContractId, e.newContractId]),
        ...defects.map((e) => e.entityId),
      ].filter((id): id is string => !!id),
    ),
  ];
  await plan.lockContractContributors(otherIds);
  const contracts = await tx.contract.findMany({
    where: { id: { in: otherIds }, AND: plan.contract },
    take: FINANCE_CONTRACT_READ_LIMIT + 1,
    orderBy,
    select: {
      id: true,
      productId: true,
      customerId: true,
      parentContractId: true,
      inputVatJournalEntryId: true,
    },
  });
  const customers = await lock(
    'customers',
    await tx.customer.findMany({
      where: { id: { in: contracts.map((c) => c.customerId) }, deletedAt: null },
      take,
      orderBy,
      select: { id: true, contactId: true },
    }),
  );
  const schedules = await lock(
    'installment_schedules',
    await tx.installmentSchedule.findMany({
      where: { id: { in: values('installmentScheduleId') }, deletedAt: null },
      take,
      orderBy,
      select: {
        id: true,
        contractId: true,
        installmentNo: true,
        accrualJournalEntryId: true,
        vat60dayJournalEntryId: true,
      },
    }),
  );
  const payments = await lock(
    'payments',
    await tx.payment.findMany({
      where: { id: { in: values('paymentId') }, deletedAt: null },
      take,
      orderBy,
      select: { id: true, contractId: true, installmentNo: true },
    }),
  );
  const repos = await lock(
    'repossessions',
    await tx.repossession.findMany({
      where: { contractId, deletedAt: null },
      take,
      orderBy,
      select: { id: true, contractId: true, productId: true },
    }),
  );
  const returns = await lock(
    'device_returns',
    await tx.deviceReturn.findMany({
      where: { contractId, deletedAt: null },
      take,
      orderBy,
      select: {
        id: true,
        contractId: true,
        productId: true,
        repossessionId: true,
        receivingBranchId: true,
      },
    }),
  );
  const redemptions = await lock(
    'trade_in_credit_redemptions',
    await tx.tradeInCreditRedemption.findMany({
      where: { contractId },
      take,
      orderBy,
      select: {
        id: true,
        tradeInId: true,
        contractId: true,
        saleId: true,
        applicationJournalEntryId: true,
        releasedAt: true,
      },
    }),
  );
  const tradeIns = await lock(
    'trade_ins',
    await tx.tradeIn.findMany({
      where: { id: { in: redemptions.map((r) => r.tradeInId) }, deletedAt: null },
      take,
      orderBy,
      select: { id: true, branchId: true, customerId: true, sellerContactId: true },
    }),
  );
  const branches = await lock(
    'branches',
    await tx.branch.findMany({
      where: {
        id: {
          in: [
            ...returns.map((r) => r.receivingBranchId),
            ...tradeIns.flatMap((t) => (t.branchId ? [t.branchId] : [])),
          ],
        },
        deletedAt: null,
      },
      take,
      orderBy,
      select: { id: true, companyId: true, isActive: true },
    }),
  );
  const products = await lock(
    'products',
    await tx.product.findMany({
      where: {
        id: {
          in: [
            ...contracts.map((c) => c.productId),
            ...exchanges.flatMap((e) => [e.oldProductId, e.newProductId]),
          ],
        },
        deletedAt: null,
      },
      take,
      orderBy,
      select: { id: true },
    }),
  );
  const receivingItems = await lock(
    'goods_receiving_items',
    await tx.goodsReceivingItem.findMany({
      where: { productId: { in: contracts.map((c) => c.productId) }, deletedAt: null },
      take,
      orderBy,
      select: { id: true, productId: true, receivingId: true },
    }),
  );
  const receivings = await lock(
    'goods_receivings',
    await tx.goodsReceiving.findMany({
      where: { id: { in: receivingItems.map((r) => r.receivingId) }, deletedAt: null },
      take,
      orderBy,
      select: { id: true, poId: true },
    }),
  );
  const purchaseOrders = await lock(
    'purchase_orders',
    await tx.purchaseOrder.findMany({
      where: { id: { in: receivings.map((r) => r.poId) }, deletedAt: null },
      take,
      orderBy,
      select: { id: true, supplierId: true },
    }),
  );
  const suppliers = await lock(
    'suppliers',
    await tx.supplier.findMany({
      where: { id: { in: purchaseOrders.map((r) => r.supplierId) }, deletedAt: null },
      take,
      orderBy,
      select: { id: true },
    }),
  );
  const writeoffs = await lock(
    'bad_debt_write_off_audit_logs',
    await tx.badDebtWriteOffAuditLog.findMany({
      where: { contractId },
      take,
      orderBy,
      select: { id: true },
    }),
  );
  const cancellations = await lock(
    'contract_cancellations',
    await tx.contractCancellation.findMany({
      where: { contractId, deletedAt: null },
      take,
      orderBy,
      select: { id: true, status: true },
    }),
  );
  const links = await lock(
    'payment_links',
    await tx.paymentLink.findMany({
      where: { token: { in: values('refno') }, deletedAt: null },
      take,
      orderBy,
      select: { id: true, token: true, contractId: true, paymentId: true },
    }),
  );
  const evidence = await lock(
    'managed_payoff_evidence',
    await tx.managedPayoffEvidence.findMany({
      where: { contractId, consumedAt: { not: null } },
      take,
      orderBy,
      select: {
        id: true,
        contractId: true,
        financeCompanyId: true,
        receiptId: true,
        requestId: true,
      },
    }),
  );
  const receipts = await lock(
    'receipts',
    await tx.receipt.findMany({
      where: {
        OR: [
          { sourceJournalEntryId: { in: entries.map((e) => e.id) } },
          { id: { in: evidence.flatMap((e) => (e.receiptId ? [e.receiptId] : [])) } },
        ],
        deletedAt: null,
      },
      take,
      orderBy,
      select: { id: true, sourceJournalEntryId: true, contractId: true, paymentId: true },
    }),
  );
  const approvals = await lock(
    'payment_approval_requests',
    await tx.paymentApprovalRequest.findMany({
      where: {
        id: { in: evidence.flatMap((e) => (e.requestId ? [e.requestId] : [])) },
        deletedAt: null,
      },
      take,
      orderBy,
      select: { id: true, contractId: true },
    }),
  );
  return {
    contracts,
    customers,
    schedules,
    payments,
    repos,
    returns,
    branches,
    products,
    exchanges,
    defects,
    receivingItems,
    receivings,
    purchaseOrders,
    suppliers,
    writeoffs,
    cancellations,
    links,
    evidence,
    receipts,
    approvals,
    redemptions,
    tradeIns,
    count,
  };
}
export type ContractJournalSources = Awaited<ReturnType<typeof loadContractJournalSources>>;
