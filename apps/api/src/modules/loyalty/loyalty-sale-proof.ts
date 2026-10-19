import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccessSnapshot, Company, PermissionKey, canAccess } from '@installment/shared';
import { LoyaltyRedemption, Prisma, Sale } from '@prisma/client';
import { currentDomainAccess } from '../employee-access/access-execution-context';
import { permissionScopes } from '../employee-access/access-context';
import { customerPartyWhere } from '../employee-access/access-party-scope';
import { productScopeWhere } from '../employee-access/access-query-scope';
import { bangkokCalendarParts, bangkokMidnight } from '../../utils/date.util';
import { CreateSaleDto } from '../sales/dto/sale.dto';

const unavailable = () => new ForbiddenException('ไม่มีสิทธิ์ใช้บัญชีแต้มสะสม');
export function loyaltyAccountAllows(
  snapshot: AccessSnapshot,
  permission: 'loyalty.account.read' | 'loyalty.account.redeem',
) {
  return (
    canAccess(snapshot, permission, { company: 'SHOP', branchId: null }) &&
    permissionScopes({ id: snapshot.userId, access: snapshot }, permission, 'SHOP').some(
      (t) => t.scope === 'COMPANY',
    )
  );
}
function execution(actorId?: string) {
  const ctx = currentDomainAccess();
  if (
    !ctx ||
    ctx.scopeReads ||
    ctx.isolationLevel !== 'Serializable' ||
    (actorId && actorId !== ctx.snapshot.userId)
  )
    throw unavailable();
  return ctx;
}
function scope(permission: PermissionKey, company: Company) {
  const { snapshot } = execution();
  return {
    userId: snapshot.userId,
    company,
    permission,
    tuples: permissionScopes({ id: snapshot.userId, access: snapshot }, permission, company),
  };
}
export function loyaltyDayRange(now = new Date()) {
  const { year, month, day } = bangkokCalendarParts(now);
  return { gte: bangkokMidnight(year, month, day), lt: bangkokMidnight(year, month, day + 1) };
}
/** Authorization precedes all account/balance/cap observations. Caller owns the Sale transaction. */
export async function prepareLoyaltySale(dto: CreateSaleDto, actorId: string) {
  const points = dto.loyaltyPointsRedeemed ?? 0;
  if (points === 0) return;
  const ctx = execution(actorId),
    tx = ctx.client;
  if (
    !loyaltyAccountAllows(ctx.snapshot, 'loyalty.account.read') ||
    !loyaltyAccountAllows(ctx.snapshot, 'loyalty.account.redeem')
  )
    throw unavailable();
  if (
    !canAccess(ctx.snapshot, 'sales.create', {
      company: 'SHOP',
      branchId: dto.branchId,
      assignedUserIds: [actorId],
    })
  )
    throw unavailable();
  if (!Number.isSafeInteger(points) || points <= 0)
    throw new BadRequestException('จำนวนแต้มต้องเป็นจำนวนเต็มบวก');
  await tx.$queryRaw`SELECT id FROM customers WHERE id=${dto.customerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM branches WHERE id=${dto.branchId} FOR SHARE`;
  const branch = await tx.branch.count({
    where: {
      id: dto.branchId,
      isActive: true,
      deletedAt: null,
      company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
    },
  });
  const customer = await tx.customer.findFirst({
    where: {
      id: dto.customerId,
      deletedAt: null,
      OR: (['SHOP', 'FINANCE'] as const).map((c) => customerPartyWhere(scope('customers.read', c))),
    },
    select: { loyaltyBalance: true },
  });
  if (!branch || !customer) throw unavailable();
  const productIds = [...new Set([dto.productId, ...(dto.bundleProductIds ?? [])])].sort();
  for (const id of productIds)
    await tx.$queryRaw`SELECT id FROM products WHERE id=${id} FOR UPDATE`;
  const count = await tx.product.count({
    where: {
      id: { in: productIds },
      branchId: dto.branchId,
      deletedAt: null,
      AND: productScopeWhere(scope('products.read', 'SHOP')),
    },
  });
  if (count !== productIds.length) throw unavailable();
  if (customer.loyaltyBalance < points) throw new BadRequestException('แต้มไม่เพียงพอ');
  const used = await tx.loyaltyRedemption.aggregate({
    where: { customerId: dto.customerId, deletedAt: null, createdAt: loyaltyDayRange() },
    _sum: { points: true },
  });
  if ((used._sum.points ?? 0) + points > 5000)
    throw new BadRequestException('เกินโควต้าแลกแต้ม 5,000 แต้มต่อวัน');
}
function saleTerms(sale: Sale) {
  return {
    saleId: sale.id,
    customerId: sale.customerId,
    productId: sale.productId,
    branchId: sale.branchId,
    salespersonId: sale.salespersonId,
    saleType: sale.saleType,
    contractId: sale.contractId,
    bundleProductIds: [...sale.bundleProductIds].sort(),
    sellingPrice: sale.sellingPrice.toFixed(2),
    discount: sale.discount.toFixed(2),
    netAmount: sale.netAmount.toFixed(2),
    paymentMethod: sale.paymentMethod,
    amountReceived: sale.amountReceived?.toFixed(2) ?? null,
    financeAmount: sale.financeAmount?.toFixed(2) ?? null,
    downPaymentAmount: sale.downPaymentAmount?.toFixed(2) ?? null,
  };
}
// Canonical key order also survives JSONB's key reordering.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function loyaltyFingerprint(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
/** Same exact Sale transaction, no independent financial executor or post-commit debit. */
export async function recordLoyaltySale(
  dto: CreateSaleDto,
  saleId: string,
  components: {
    baseDiscount: number;
    promotionDiscount: Prisma.Decimal;
    tradeBonus: number | Prisma.Decimal;
  },
) {
  const ctx = execution(),
    tx = ctx.client,
    points = dto.loyaltyPointsRedeemed!;
  await prepareLoyaltySale(dto, ctx.snapshot.userId);
  // A committed Sale's aggregate discount is never authorization to attach a
  // new debit. Only the canonical Sale written in this actual attempt qualifies.
  const [origin] = await tx.$queryRaw<Array<{ fresh: boolean }>>`
    SELECT xmin::text = (txid_current() % 4294967296)::text
      AND created_at >= date_trunc('milliseconds', transaction_timestamp() AT TIME ZONE 'UTC') AS fresh
    FROM sales WHERE id=${saleId}`;
  if (!origin?.fresh) throw new BadRequestException('ต้องใช้แต้มพร้อมสร้างใบขายในธุรกรรมเดียวกัน');
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
  const other = new Prisma.Decimal(components.baseDiscount)
    .plus(components.promotionDiscount)
    .plus(components.tradeBonus);
  if (
    sale.customerId !== dto.customerId ||
    sale.productId !== dto.productId ||
    sale.branchId !== dto.branchId ||
    sale.salespersonId !== ctx.snapshot.userId ||
    !['CASH', 'EXTERNAL_FINANCE'].includes(sale.saleType) ||
    !sale.sellingPrice.eq(dto.sellingPrice) ||
    !sale.discount.eq(other.plus(points)) ||
    !sale.netAmount.eq(sale.sellingPrice.minus(sale.discount)) ||
    sale.netAmount.lt(0) ||
    new Prisma.Decimal(points).gt(sale.sellingPrice.minus(other))
  )
    throw new BadRequestException('ยอดใช้แต้มไม่ตรงกับใบขาย');
  const evidence = {
    version: 1,
    accountCompany: 'SHOP',
    points,
    discountAmount: new Prisma.Decimal(points).toFixed(2),
    ...saleTerms(sale),
    baseDiscount: new Prisma.Decimal(components.baseDiscount).toFixed(2),
    promotionDiscount: components.promotionDiscount.toFixed(2),
    tradeBonus: new Prisma.Decimal(components.tradeBonus).toFixed(2),
  };
  const fingerprint = loyaltyFingerprint(evidence);
  await tx.loyaltyRedemption.create({
    data: {
      saleId,
      customerId: sale.customerId,
      contractId: sale.contractId,
      points,
      discountAmount: points,
      reason: 'SALE',
      evidence,
      fingerprint,
    },
  });
  const debit = await tx.customer.updateMany({
    where: { id: sale.customerId, deletedAt: null, loyaltyBalance: { gte: points } },
    data: { loyaltyBalance: { decrement: points } },
  });
  if (debit.count !== 1) throw new BadRequestException('แต้มไม่เพียงพอ');
  await tx.auditLog.create({
    data: {
      userId: ctx.snapshot.userId,
      action: 'LOYALTY_SALE_REDEEMED',
      entity: 'sale',
      entityId: saleId,
      newValue: { saleId, points, discountAmount: evidence.discountAmount, fingerprint },
    },
  });
  return { saleId, points, fingerprint };
}
/** Proof validation only. Callers must independently authorize Customer and actual Sale source. */
export async function verifiedLoyaltySale(tx: Prisma.TransactionClient, row: LoyaltyRedemption) {
  if (
    !row.saleId ||
    !row.evidence ||
    !row.fingerprint ||
    row.deletedAt ||
    row.points <= 0 ||
    !row.discountAmount.eq(row.points)
  )
    return null;
  const sale = await tx.sale.findUnique({ where: { id: row.saleId } });
  if (!sale || sale.customerId !== row.customerId || sale.contractId !== row.contractId)
    return null;
  const evidence = row.evidence as Record<string, unknown>;
  if (
    evidence.version !== 1 ||
    evidence.accountCompany !== 'SHOP' ||
    evidence.points !== row.points ||
    evidence.discountAmount !== row.discountAmount.toFixed(2) ||
    loyaltyFingerprint(evidence) !== row.fingerprint
  )
    return null;
  const terms = saleTerms(sale);
  if (Object.entries(terms).some(([key, value]) => canonical(evidence[key]) !== canonical(value)))
    return null;
  return sale;
}
