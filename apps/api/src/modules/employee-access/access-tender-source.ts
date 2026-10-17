import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException } from '@nestjs/common';
import { AccessSnapshot, PermissionKey, canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { currentDomainAccess, isCurrentDomainClient } from './access-execution-context';
import { permissionScopes } from './access-context';
import { AccessSnapshotService } from './access-snapshot.service';
import { customerPartyWhere } from './access-party-scope';

export const tenderAccess = new AsyncLocalStorage<TenderSourcePlan>();
const SOURCE_INCLUDE = {
  sale: {
    select: {
      branchId: true,
      saleType: true,
      salespersonId: true,
      customerId: true,
      deletedAt: true,
    },
  },
  booking: { select: { branchId: true, customerId: true, deletedAt: true } },
  contract: { select: { branchId: true, customerId: true, assignedToId: true, deletedAt: true } },
  tradeIn: { select: { branchId: true, customerId: true, flow: true, deletedAt: true } },
  reverses: true,
} satisfies Prisma.ShopTenderInclude;
type TenderSource = Prisma.ShopTenderGetPayload<{ include: typeof SOURCE_INCLUDE }>;
const REFUNDS = {
  SALE_VOID_REFUND: ['CASH_SALE', 'EXTERNAL_FINANCE_DOWN'],
  CONTRACT_DOWN_REFUND: ['CONTRACT_DOWN'],
  BOOKING_DEPOSIT_REFUND: ['BOOKING_DEPOSIT'],
};

/** Historical operators are never current assignments. Original tuples stay intact. */
export function tenderAllows(
  snapshot: AccessSnapshot,
  permission: PermissionKey,
  branchId: string,
): boolean {
  return canAccess(snapshot, permission, { company: 'SHOP', branchId });
}
/** Valid money history deliberately includes archived/voided source documents. */
function correlated(row: TenderSource): boolean {
  const keys = [row.saleId, row.bookingId, row.contractId, row.tradeInId].filter(Boolean);
  if (keys.length !== 1 || !row.amount.gt(0) || row.seq < 1 || row.seqTotal < row.seq) return false;
  const originalKind = row.kind in REFUNDS ? row.reverses?.kind : row.kind;
  const source = row.sale ?? row.booking ?? row.contract ?? row.tradeIn;
  if (!source || source.branchId !== row.branchId) return false;
  if (originalKind === 'CASH_SALE' && (!row.sale || row.sale.saleType !== 'CASH')) return false;
  if (
    originalKind === 'EXTERNAL_FINANCE_DOWN' &&
    (!row.sale || row.sale.saleType !== 'EXTERNAL_FINANCE')
  )
    return false;
  if (originalKind === 'CONTRACT_DOWN' && !row.contract) return false;
  if (originalKind === 'BOOKING_DEPOSIT' && !row.booking) return false;
  if (originalKind === 'TRADE_IN_PAYOUT' && (!row.tradeIn || row.tradeIn.flow !== 'BUYBACK'))
    return false;
  if (row.kind in REFUNDS) {
    const r = row.reverses;
    return (
      !!r &&
      row.direction === 'OUT' &&
      r.direction === 'IN' &&
      !r.reversesTenderId &&
      REFUNDS[row.kind as keyof typeof REFUNDS].includes(r.kind) &&
      r.branchId === row.branchId &&
      r.method === row.method &&
      r.amount.eq(row.amount) &&
      r.reference === row.reference &&
      r.seq === row.seq &&
      r.seqTotal === row.seqTotal &&
      r.saleId === row.saleId &&
      r.bookingId === row.bookingId &&
      r.contractId === row.contractId &&
      r.tradeInId === row.tradeInId
    );
  }
  return !row.reversesTenderId && row.direction === (row.kind === 'TRADE_IN_PAYOUT' ? 'OUT' : 'IN');
}

/** Owned exact-client source plan. Visibility is separate from complete drawer
 * authority: future money callers MUST assertComplete, never use visibleClient
 * to compute a drawer after excluding malformed contributions. */
export class TenderSourcePlan {
  readonly sources = new Map<string, TenderSource>();
  readonly invalidBranches = new Set<string>();
  private financeActive = false;
  private readonly customerIds = new Set<string>();
  private constructor(
    readonly tx: Prisma.TransactionClient,
    readonly snapshot: AccessSnapshot,
    readonly branches: readonly { id: string; name: string }[],
    readonly selectableBranches: readonly { id: string; name: string }[],
  ) {}
  get branchIds() {
    return this.branches.map((branch) => branch.id);
  }
  static async create(
    tx: Prisma.TransactionClient,
    requestedBranch?: string,
    permission: PermissionKey = 'shop-tenders.read',
  ) {
    const ctx = currentDomainAccess();
    if (!ctx || ctx.scope.company !== 'SHOP' || !isCurrentDomainClient(tx))
      throw new ForbiddenException('ไม่มีขอบเขตเงินหน้าร้าน');
    const tuples = permissionScopes(
      { id: ctx.snapshot.userId, access: ctx.snapshot },
      permission,
      'SHOP',
    );
    const company = tuples.some((t) => t.scope === 'COMPANY');
    const ids = tuples.flatMap((t) => (t.scope === 'BRANCHES' ? [...t.branchIds] : []));
    if (!company && !ids.length) throw new ForbiddenException('ไม่มีขอบเขตสาขา');
    if (requestedBranch && !tenderAllows(ctx.snapshot, permission, requestedBranch))
      throw new ForbiddenException('ไม่มีสิทธิ์ในสาขานี้');
    const where: Prisma.BranchWhereInput = {
      isActive: true,
      deletedAt: null,
      company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
      ...(company ? {} : { id: { in: ids } }),
    };
    const selectable = await tx.branch.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    const found = requestedBranch
      ? selectable.filter((branch) => branch.id === requestedBranch)
      : selectable;
    if (requestedBranch && !found.length)
      throw new ForbiddenException('ไม่พบสาขาหน้าร้านที่เปิดใช้งาน');
    const plan = new TenderSourcePlan(tx, ctx.snapshot, found, selectable);
    plan.financeActive = !!(await tx.companyInfo.count({
      where: { companyCode: 'FINANCE', isActive: true, deletedAt: null },
    }));
    if (!found.length) return plan;
    const selected = Prisma.join(plan.branchIds);
    // Lock current provenance before read, in deterministic table/ID order.
    // Serializable forces a fresh whole attempt if a held row changed.
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM branches WHERE id IN (${Prisma.join(selectable.map((branch) => branch.id))}) ORDER BY id FOR SHARE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM shop_tenders WHERE branch_id IN (${selected}) ORDER BY id FOR SHARE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM sales WHERE id IN (SELECT sale_id FROM shop_tenders WHERE branch_id IN (${selected})) ORDER BY id FOR SHARE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM bookings WHERE id IN (SELECT booking_id FROM shop_tenders WHERE branch_id IN (${selected})) ORDER BY id FOR SHARE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM contracts WHERE id IN (SELECT contract_id FROM shop_tenders WHERE branch_id IN (${selected})) ORDER BY id FOR SHARE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM trade_ins WHERE id IN (SELECT trade_in_id FROM shop_tenders WHERE branch_id IN (${selected})) ORDER BY id FOR SHARE`,
    );
    const rows = await tx.shopTender.findMany({
      where: { branchId: { in: plan.branchIds } },
      include: SOURCE_INCLUDE,
    });
    const reversalCounts = new Map<string, number>();
    for (const row of rows)
      if (row.reversesTenderId)
        reversalCounts.set(
          row.reversesTenderId,
          (reversalCounts.get(row.reversesTenderId) ?? 0) + 1,
        );
    for (const row of rows) {
      if (
        correlated(row) &&
        (!row.reversesTenderId || reversalCounts.get(row.reversesTenderId) === 1)
      )
        plan.sources.set(row.id, row);
      else plan.invalidBranches.add(row.branchId);
    }
    const customerIds = [
      ...new Set(
        rows
          .map((r) => (r.sale ?? r.booking ?? r.contract ?? r.tradeIn)?.customerId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (customerIds.length) {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customers WHERE id IN (${Prisma.join(customerIds)}) ORDER BY id FOR SHARE`,
      );
      const scope = {
        ...ctx.scope,
        company: 'SHOP' as const,
        permission: 'customers.read' as const,
        tuples: permissionScopes(
          { id: ctx.snapshot.userId, access: ctx.snapshot },
          'customers.read',
          'SHOP',
        ),
      };
      const customers = await tx.customer.findMany({
        where: { id: { in: customerIds }, AND: customerPartyWhere(scope) },
        select: { id: true },
      });
      for (const customer of customers) plan.customerIds.add(customer.id);
    }
    return plan;
  }
  allows(permission: PermissionKey, branchId: string) {
    return this.branchIds.includes(branchId) && tenderAllows(this.snapshot, permission, branchId);
  }
  complete(branchId: string) {
    return this.branchIds.includes(branchId) && !this.invalidBranches.has(branchId);
  }
  moneyVisible(branchId: string) {
    return this.complete(branchId) && this.allows('sensitive.cost.read', branchId);
  }
  assertComplete(branchId: string, permission: PermissionKey, costRequired: boolean) {
    if (
      !isCurrentDomainClient(this.tx) ||
      !this.complete(branchId) ||
      !this.allows(permission, branchId) ||
      (costRequired && !this.moneyVisible(branchId))
    )
      throw new ForbiddenException('ไม่สามารถใช้ข้อมูลเงินครบถ้วนของสาขานี้');
  }
  navigate(id: string): boolean {
    const row = this.sources.get(id);
    if (!row) return false;
    if (row.sale)
      return (
        !row.sale.deletedAt &&
        canAccess(this.snapshot, 'sales.read', {
          company: 'SHOP',
          branchId: row.branchId,
          assignedUserIds: [row.sale.salespersonId],
        })
      );
    if (row.booking)
      return (
        !row.booking.deletedAt &&
        canAccess(this.snapshot, 'bookings.read', { company: 'SHOP', branchId: row.branchId })
      );
    if (row.contract)
      return (
        this.financeActive &&
        !row.contract.deletedAt &&
        canAccess(this.snapshot, 'contracts.read', {
          company: 'FINANCE',
          branchId: row.branchId,
          assignedUserIds: row.contract.assignedToId ? [row.contract.assignedToId] : [],
        })
      );
    return (
      !!row.tradeIn &&
      !row.tradeIn.deletedAt &&
      canAccess(this.snapshot, 'trade-in.read', { company: 'SHOP', branchId: row.branchId })
    );
  }
  customerVisible(id: string) {
    const row = this.sources.get(id),
      source = row && (row.sale ?? row.booking ?? row.contract ?? row.tradeIn);
    return !!source?.customerId && this.customerIds.has(source.customerId);
  }
  async counters(branchId: string, snapshots: AccessSnapshotService) {
    if (!this.branchIds.includes(branchId)) return [];
    await this.tx
      .$queryRaw`SELECT id FROM users WHERE access_managed = true AND is_active = true AND deleted_at IS NULL AND is_system_user = false ORDER BY id FOR SHARE`;
    await this.tx
      .$queryRaw`SELECT id FROM employee_access_assignments WHERE user_id IN (SELECT id FROM users WHERE access_managed = true AND is_active = true AND deleted_at IS NULL AND is_system_user = false) ORDER BY id FOR SHARE`;
    await this.tx
      .$queryRaw`SELECT id FROM access_positions WHERE id IN (SELECT position_id FROM employee_access_assignments WHERE user_id IN (SELECT id FROM users WHERE access_managed = true AND is_active = true AND deleted_at IS NULL AND is_system_user = false)) ORDER BY id FOR SHARE`;
    const users = await this.tx.user.findMany({
      where: { accessManaged: true, isActive: true, deletedAt: null, isSystemUser: false },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const result: { id: string; name: string; role: null }[] = [];
    for (const user of users) {
      const snapshot = await snapshots.forUserInTransaction(this.tx, user.id);
      if (tenderAllows(snapshot, 'shop-tenders.count', branchId))
        result.push({ ...user, role: null });
    }
    return result;
  }
  /** Read-only filtered adapter, never a business mutation client. */
  visibleClient(): PrismaService {
    const predicates: Record<string, object> = {
      branch: { id: { in: this.branchIds } },
      shopTender: { id: { in: [...this.sources.keys()] } },
      shopCashClose: { branchId: { in: this.branchIds } },
      shopCashDeposit: { branchId: { in: this.branchIds } },
    };
    const reads = new Set([
      'findMany',
      'findFirst',
      'findUnique',
      'findUniqueOrThrow',
      'findFirstOrThrow',
      'count',
      'aggregate',
      'groupBy',
    ]);
    return new Proxy(this.tx as PrismaService, {
      get: (target, key) => {
        const value = Reflect.get(target, key);
        if (typeof key === 'string' && predicates[key])
          return new Proxy(value, {
            get: (delegate, op) => {
              const method = Reflect.get(delegate, op);
              if (typeof method !== 'function') return method;
              if (!reads.has(String(op)))
                return () => {
                  throw new Error('Tender visible client is read-only');
                };
              return (args: { where?: object } = {}) =>
                method.call(delegate, {
                  ...args,
                  where: { ...args.where, AND: [args.where ?? {}, predicates[key]] },
                });
            },
          });
        if (typeof key === 'string' && key.startsWith('$'))
          return () => {
            throw new Error('Tender visible client cannot own transactions or raw queries');
          };
        throw new Error('Unreviewed tender read model');
      },
    });
  }
}

/** Canonical legacy reads get the exact scoped managed adapter only inside its plan. */
export function tenderReadClient(base: PrismaService) {
  return tenderAccess.getStore()?.visibleClient() ?? base;
}
