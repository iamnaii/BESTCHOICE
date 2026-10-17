import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { CreateSaleDto } from '../sales/dto/sale.dto';
import {
  currentDomainAccess,
  currentPermissionScope,
} from '../employee-access/access-execution-context';
import { productScopeWhere } from '../employee-access/access-query-scope';
import { customerPartyWhere } from '../employee-access/access-party-scope';
import { promotionBaseline, validatePromotion } from './promotion-policy';

/** Runs only in the canonical managed Sale transaction; never a second monetary writer. */
export async function preparePromotionBenefit(dto: CreateSaleDto, salespersonId: string) {
  if (!dto.promotionId) return null;
  const ctx = currentDomainAccess();
  if (!ctx) throw new ForbiddenException('โปรโมชันมาตรฐานต้องใช้ผ่านสิทธิ์การขายปัจจุบัน');
  const tx = ctx.client;
  const source = {
    company: 'SHOP' as const,
    branchId: dto.branchId,
    assignedUserIds: [salespersonId],
  };
  if (
    !canAccess(ctx.snapshot, 'sales.create', source) ||
    !canAccess(ctx.snapshot, 'promotions.apply', source)
  )
    throw new ForbiddenException('ไม่มีสิทธิ์ใช้โปรโมชันในสาขานี้');
  await tx.$queryRaw`SELECT id FROM promotions WHERE id = ${dto.promotionId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${dto.customerId} FOR UPDATE`;
  const productIds = [...new Set([dto.productId, ...(dto.bundleProductIds ?? [])])].sort();
  for (const id of productIds)
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM product_prices WHERE product_id = ${dto.productId} ORDER BY id FOR SHARE`;
  if (
    !(await tx.customer.count({
      where: {
        id: dto.customerId,
        AND: customerPartyWhere(currentPermissionScope('customers.read')!),
      },
    }))
  )
    throw new ForbiddenException('ไม่มีสิทธิ์เลือกลูกค้า');
  const products = await tx.product.findMany({
    where: {
      id: { in: productIds },
      deletedAt: null,
      branchId: dto.branchId,
      AND: productScopeWhere(currentPermissionScope('products.read')!),
    },
  });
  if (products.length !== productIds.length || products.some((p) => p.status !== 'IN_STOCK'))
    throw new ForbiddenException('สินค้าไม่พร้อมหรือไม่มีสิทธิ์');
  const product = await tx.product.findUniqueOrThrow({
    where: { id: dto.productId },
    include: { prices: { where: { deletedAt: null } } },
  });
  const promotion = await tx.promotion.findFirst({
    where: { id: dto.promotionId, deletedAt: null },
  });
  if (!promotion) throw new BadRequestException('ไม่พบโปรโมชัน');
  const c = validatePromotion(promotion),
    now = new Date();
  if (promotion.type === 'SPECIAL_RATE')
    throw new BadRequestException('โปรอัตราดอกเบี้ยต้องใช้ผ่านขั้นตอนสัญญา');
  if (
    !promotion.isActive ||
    now < promotion.startDate ||
    now > promotion.endDate ||
    (promotion.maxUsageCount !== null && promotion.currentUsageCount >= promotion.maxUsageCount)
  )
    throw new BadRequestException('โปรโมชันไม่พร้อมใช้งานหรือครบจำนวน');
  const baseline = promotionBaseline(product, dto.saleType, dto.priceId);
  if (!baseline.amount.eq(dto.sellingPrice))
    throw new BadRequestException('ราคาขายเปลี่ยนแปลง กรุณาเลือกราคาปัจจุบัน');
  if (
    (c.minPurchase !== undefined && baseline.amount.lt(c.minPurchase)) ||
    (c.productIds && !c.productIds.includes(product.id)) ||
    (c.categories && !c.categories.includes(product.category))
  )
    throw new BadRequestException('สินค้าไม่ตรงเงื่อนไขโปรโมชัน');
  const accessories = promotion.type === 'FREE_ACCESSORY' ? [...c.accessoryProductIds!].sort() : [];
  if (
    promotion.type === 'FREE_ACCESSORY' &&
    (JSON.stringify([...(dto.bundleProductIds ?? [])].sort()) !== JSON.stringify(accessories) ||
      products.filter((p) => accessories.includes(p.id)).some((p) => p.category !== 'ACCESSORY'))
  )
    throw new BadRequestException('ของแถมไม่ตรงเงื่อนไขโปรโมชัน');
  const discount =
    promotion.type === 'PERCENTAGE_DISCOUNT'
      ? baseline.amount
          .mul(promotion.discountValue!)
          .div(100)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : promotion.type === 'FIXED_DISCOUNT'
        ? promotion.discountValue!
        : new Prisma.Decimal(0);
  if (discount.gt(baseline.amount)) throw new BadRequestException('ส่วนลดโปรโมชันเกินราคาขาย');
  const definition = {
    id: promotion.id,
    type: promotion.type,
    discountValue: promotion.discountValue?.toString() ?? null,
    specialInterestRate: promotion.specialInterestRate?.toString() ?? null,
    conditions: {
      ...(c.minPurchase === undefined ? {} : { minPurchase: c.minPurchase }),
      ...(c.productIds ? { productIds: [...c.productIds].sort() } : {}),
      ...(c.categories ? { categories: [...c.categories].sort() } : {}),
      ...(accessories.length ? { accessoryProductIds: accessories } : {}),
    },
    startDate: promotion.startDate.toISOString(),
    endDate: promotion.endDate.toISOString(),
    maxUsageCount: promotion.maxUsageCount,
  };
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        definition,
        productId: product.id,
        customerId: dto.customerId,
        branchId: dto.branchId,
        baselineSource: baseline.source,
        baselineAmount: baseline.amount.toFixed(2),
        quantity: 1,
        discountAmount: discount.toFixed(2),
        accessories,
      }),
    )
    .digest('hex');
  return { promotion, baseline, discount, accessories, definition, fingerprint };
}
export async function recordPromotionBenefit(
  dto: CreateSaleDto,
  saleId: string,
  prepared: NonNullable<Awaited<ReturnType<typeof preparePromotionBenefit>>>,
) {
  const ctx = currentDomainAccess()!,
    tx = ctx.client;
  const p = prepared.promotion;
  const bumped = await tx.promotion.updateMany({
    where: {
      id: p.id,
      deletedAt: null,
      isActive: true,
      ...(p.maxUsageCount === null ? {} : { currentUsageCount: { lt: p.maxUsageCount } }),
    },
    data: { currentUsageCount: { increment: 1 } },
  });
  if (bumped.count !== 1) throw new BadRequestException('โปรโมชันครบจำนวนหรือเปลี่ยนแปลง');
  const benefit = await tx.salePromotionBenefit.create({
    data: {
      saleId,
      promotionId: p.id,
      customerId: dto.customerId,
      productId: dto.productId,
      branchId: dto.branchId,
      type: p.type,
      baselineSource: prepared.baseline.source,
      baselineAmount: prepared.baseline.amount,
      discountAmount: prepared.discount,
      accessoryProductIds: prepared.accessories,
      definition: prepared.definition,
      fingerprint: prepared.fingerprint,
    },
  });
  await tx.promotionUsage.create({
    data: {
      promotionId: p.id,
      saleId,
      customerId: dto.customerId,
      discountApplied: prepared.discount,
      benefitId: benefit.id,
    },
  });
  await tx.auditLog.create({
    data: {
      userId: ctx.snapshot.userId,
      action: 'SALE_PROMOTION_APPLIED',
      entity: 'sale',
      entityId: saleId,
      newValue: {
        saleId,
        promotionId: p.id,
        benefitId: benefit.id,
        fingerprint: benefit.fingerprint,
        type: p.type,
      },
    },
  });
}
