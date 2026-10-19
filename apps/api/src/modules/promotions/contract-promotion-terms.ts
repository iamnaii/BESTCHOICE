import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { canAccess, ContractQuote } from '@installment/shared';
import { Contract, Payment, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ContractQuoteDto } from '../contracts/dto/contract-quote.dto';
import { promotionBaseline, validatePromotion } from './promotion-policy';
import { assertNamedSources, namedExecution } from './contract-promotion-source';

const hash = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, v[k]]),
            )
          : v,
      ),
    )
    .digest('hex');
export type NamedRateSelection = {
  promotionId: string;
  baselineSource: string;
  baselineAmount: string;
  monthlyRate: string;
  definition: Prisma.InputJsonObject;
  fingerprint: string;
};
export type NamedContractQuote = ContractQuote & { namedPromotion?: NamedRateSelection };
export async function prepareContractPromotion(
  dto: ContractQuoteDto & { bundleProductIds?: string[] },
  actorId: string,
  client: object,
): Promise<NamedRateSelection | undefined> {
  if (!dto.promotionId) return undefined;
  const ctx = namedExecution(actorId, client),
    tx = ctx.client;
  if (dto.interestRate !== undefined)
    throw new BadRequestException('ห้ามระบุอัตราดอกเบี้ยเพิ่มเติมพร้อมโปรโมชัน');
  const source = { company: 'SHOP' as const, branchId: dto.branchId };
  if (
    !canAccess(ctx.snapshot, 'contracts.create', source) ||
    !canAccess(ctx.snapshot, 'promotions.apply', source)
  )
    throw new ForbiddenException('ไม่มีสิทธิ์ใช้โปรโมชันสัญญาในสาขานี้');
  await tx.$queryRaw`SELECT id FROM promotions WHERE id = ${dto.promotionId} FOR UPDATE`;
  await assertNamedSources(dto);
  await tx.$queryRaw`SELECT id FROM product_prices WHERE product_id = ${dto.productId} ORDER BY id FOR SHARE`;
  const p = await tx.promotion.findFirst({ where: { id: dto.promotionId, deletedAt: null } });
  if (!p || p.type !== 'SPECIAL_RATE')
    throw new BadRequestException('ต้องเลือกโปรโมชันอัตราดอกเบี้ย');
  const c = validatePromotion(p),
    now = new Date();
  if (!p.specialInterestRate || !p.specialInterestRate.eq(p.specialInterestRate.toDecimalPlaces(4)))
    throw new BadRequestException('อัตราโปรโมชันต้องตรงความละเอียดของสัญญา');
  if (
    !p.isActive ||
    now < p.startDate ||
    now > p.endDate ||
    (p.maxUsageCount !== null && p.currentUsageCount >= p.maxUsageCount)
  )
    throw new BadRequestException('โปรโมชันไม่พร้อมใช้งานหรือครบจำนวน');
  const product = await tx.product.findUniqueOrThrow({
    where: { id: dto.productId },
    include: { prices: { where: { deletedAt: null } } },
  });
  if (product.status !== 'IN_STOCK') throw new BadRequestException('สินค้าไม่พร้อมสร้างสัญญา');
  // INSTALLMENT uses the same established installment price chain as external finance.
  const baseline = promotionBaseline(product, 'EXTERNAL_FINANCE', dto.priceId);
  if (!baseline.amount.eq(dto.sellingPrice))
    throw new BadRequestException('ราคาขายเปลี่ยนแปลง กรุณาเลือกราคาปัจจุบัน');
  if (
    (c.minPurchase !== undefined && baseline.amount.lt(c.minPurchase)) ||
    (c.productIds && !c.productIds.includes(product.id)) ||
    (c.categories && !c.categories.includes(product.category))
  )
    throw new BadRequestException('สินค้าไม่ตรงเงื่อนไขโปรโมชัน');
  const definition = {
    id: p.id,
    type: p.type,
    specialInterestRate: p.specialInterestRate!.toFixed(4),
    discountValue: null,
    conditions: {
      ...(c.minPurchase === undefined ? {} : { minPurchase: c.minPurchase }),
      ...(c.productIds ? { productIds: [...c.productIds].sort() } : {}),
      ...(c.categories ? { categories: [...c.categories].sort() } : {}),
    },
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    maxUsageCount: p.maxUsageCount,
  };
  const selection = {
    promotionId: p.id,
    baselineSource: baseline.source,
    baselineAmount: baseline.amount.toFixed(2),
    monthlyRate: p.specialInterestRate!.toFixed(4),
    definition,
  };
  return { ...selection, fingerprint: hash(selection) };
}
const money = (v: Prisma.Decimal | string | number | null) => new Prisma.Decimal(v ?? 0).toFixed(2);
export function contractPromotionFinancials(
  c: Pick<
    Contract,
    | 'customerId'
    | 'productId'
    | 'branchId'
    | 'sellingPrice'
    | 'downPayment'
    | 'interestRate'
    | 'financedAmount'
    | 'interestTotal'
    | 'storeCommission'
    | 'vatAmount'
    | 'vatPct'
    | 'monthlyPayment'
    | 'totalMonths'
    | 'paymentDueDay'
    | 'bundleProductIds'
    | 'tradeInCreditSnapshot'
    | 'planType'
    | 'interestConfigId'
    | 'downPaymentMethod'
    | 'downPaymentReceivedAt'
    | 'downPaymentReference'
    | 'createdAt'
  >,
) {
  return {
    provenance: {
      planType: c.planType,
      interestConfigId: c.interestConfigId,
      downPaymentMethod: c.downPaymentMethod,
      downPaymentReceivedAt: c.downPaymentReceivedAt?.toISOString() ?? null,
      downPaymentReference: c.downPaymentReference,
      createdAt: c.createdAt.toISOString(),
    },
    customerId: c.customerId,
    productId: c.productId,
    branchId: c.branchId,
    sellingPrice: money(c.sellingPrice),
    downPayment: money(c.downPayment),
    monthlyRate: new Prisma.Decimal(c.interestRate).toFixed(4),
    financedAmount: money(c.financedAmount),
    interestTotal: money(c.interestTotal),
    storeCommission: money(c.storeCommission),
    vatAmount: money(c.vatAmount),
    vatPct: new Prisma.Decimal(c.vatPct ?? 0).toFixed(4),
    monthlyPayment: money(c.monthlyPayment),
    totalMonths: c.totalMonths,
    paymentDueDay: c.paymentDueDay,
    bundleProductIds: [...c.bundleProductIds].sort(),
    tradeInCreditSnapshot: c.tradeInCreditSnapshot,
  };
}
export function promotionSchedule(
  payments: Pick<
    Payment,
    | 'installmentNo'
    | 'dueDate'
    | 'amountDue'
    | 'monthlyPrincipal'
    | 'monthlyInterest'
    | 'monthlyCommission'
    | 'vatAmount'
  >[],
) {
  return [...payments]
    .sort((a, b) => a.installmentNo - b.installmentNo)
    .map((p) => ({
      installmentNo: p.installmentNo,
      dueDate: p.dueDate.toISOString(),
      amountDue: money(p.amountDue),
      monthlyPrincipal: money(p.monthlyPrincipal),
      monthlyInterest: money(p.monthlyInterest),
      monthlyCommission: money(p.monthlyCommission),
      vatAmount: money(p.vatAmount),
    }));
}
export async function reserveContractPromotion(contract: Contract, quote: NamedContractQuote) {
  const selected = quote.namedPromotion;
  if (!selected) return;
  const ctx = namedExecution(),
    tx = ctx.client;
  const p = await tx.promotion.findUniqueOrThrow({ where: { id: selected.promotionId } });
  const changed = await tx.promotion.updateMany({
    where: {
      id: p.id,
      isActive: true,
      deletedAt: null,
      ...(p.maxUsageCount === null ? {} : { currentUsageCount: { lt: p.maxUsageCount } }),
    },
    data: { currentUsageCount: { increment: 1 } },
  });
  if (changed.count !== 1) throw new ConflictException('โปรโมชันครบจำนวนแล้ว');
  await tx.$queryRaw`SELECT id FROM payments WHERE contract_id = ${contract.id} ORDER BY id FOR SHARE`;
  const payments = await tx.payment.findMany({
    where: { contractId: contract.id, deletedAt: null },
  });
  const financials = contractPromotionFinancials(contract),
    schedule = promotionSchedule(payments);
  const fingerprint = hash({ selected, financials, schedule });
  const amounts = {
    sellingPrice: financials.sellingPrice,
    downPayment: financials.downPayment,
    monthlyRate: financials.monthlyRate,
    financedAmount: financials.financedAmount,
    interestTotal: financials.interestTotal,
    storeCommission: financials.storeCommission,
    vatAmount: financials.vatAmount,
    vatPct: financials.vatPct,
    monthlyPayment: financials.monthlyPayment,
    totalMonths: financials.totalMonths,
    paymentDueDay: financials.paymentDueDay,
    bundleProductIds: financials.bundleProductIds,
  };
  const terms = await tx.contractPromotionTerms.create({
    data: {
      contractId: contract.id,
      promotionId: p.id,
      baselineSource: selected.baselineSource,
      baselineAmount: selected.baselineAmount,
      ...amounts,
      schedule,
      definition: { selection: selected, financials },
      fingerprint,
      reservation: { create: {} },
    },
  });
  await tx.contract.update({
    where: { id: contract.id },
    data: { promotionFingerprint: fingerprint },
  });
  await auditNamed('CONTRACT_PROMOTION_RESERVED', contract.id, terms.id, p.id, fingerprint);
}
export async function assertContractPromotionTerms(contract: Contract) {
  if (!contract.promotionFingerprint) return undefined;
  const { client: tx } = namedExecution();
  await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contract.id} FOR UPDATE`;
  const current = await tx.contract.findUniqueOrThrow({ where: { id: contract.id } });
  const terms = await tx.contractPromotionTerms.findUnique({
    where: { contractId: contract.id },
    include: { reservation: true },
  });
  if (
    !terms ||
    terms.fingerprint !== current.promotionFingerprint ||
    terms.reservation?.state !== 'RESERVED'
  )
    throw new ConflictException('หลักฐานโปรโมชันสัญญาไม่ตรงกัน');
  await tx.$queryRaw`SELECT id FROM payments WHERE contract_id = ${contract.id} ORDER BY id FOR SHARE`;
  const payments = await tx.payment.findMany({
    where: { contractId: contract.id, deletedAt: null },
  });
  const definition = terms.definition as { selection: unknown; financials: unknown };
  const fingerprint = hash({
    selected: definition.selection,
    financials: contractPromotionFinancials(current),
    schedule: promotionSchedule(payments),
  });
  if (fingerprint !== terms.fingerprint)
    throw new ConflictException('เงื่อนไขสัญญาเปลี่ยนจากหลักฐานโปรโมชัน');
  return terms;
}
export async function auditNamed(
  action: string,
  contractId: string,
  termsId: string,
  promotionId: string,
  fingerprint: string,
) {
  const ctx = namedExecution();
  await ctx.client.auditLog.create({
    data: {
      userId: ctx.snapshot.userId,
      action,
      entity: 'contract',
      entityId: contractId,
      newValue: { contractId, termsId, promotionId, fingerprint },
    },
  });
}
export async function releaseContractPromotion(contract: Contract) {
  if (!contract.promotionFingerprint) return;
  const ctx = namedExecution(),
    tx = ctx.client;
  const terms = await assertContractPromotionTerms(contract);
  if (!terms) throw new ConflictException('ไม่พบหลักฐานโปรโมชัน');
  await tx.$queryRaw`SELECT id FROM promotions WHERE id = ${terms.promotionId} FOR UPDATE`;
  const released = await tx.contractPromotionReservation.updateMany({
    where: { termsId: terms.id, state: 'RESERVED' },
    data: { state: 'RELEASED' },
  });
  if (released.count !== 1) throw new ConflictException('สถานะการจองโปรโมชันเปลี่ยนแล้ว');
  const count = await tx.promotion.updateMany({
    where: { id: terms.promotionId, currentUsageCount: { gt: 0 } },
    data: { currentUsageCount: { decrement: 1 } },
  });
  if (count.count !== 1) throw new ConflictException('จำนวนการจองโปรโมชันไม่ตรงกัน');
  await auditNamed(
    'CONTRACT_PROMOTION_RELEASED',
    contract.id,
    terms.id,
    terms.promotionId,
    terms.fingerprint,
  );
}
export async function consumeContractPromotion(contract: Contract, saleId: string) {
  const ctx = namedExecution(),
    tx = ctx.client;
  const terms = await assertContractPromotionTerms(contract);
  if (!terms) return;
  const consumed = await tx.contractPromotionReservation.updateMany({
    where: { termsId: terms.id, state: 'RESERVED' },
    data: { state: 'CONSUMED' },
  });
  if (consumed.count !== 1) throw new ConflictException('สถานะการจองโปรโมชันเปลี่ยนแล้ว');
  const benefit = await tx.salePromotionBenefit.create({
    data: {
      saleId,
      contractTermsId: terms.id,
      promotionId: terms.promotionId,
      customerId: contract.customerId,
      productId: contract.productId,
      branchId: contract.branchId,
      type: 'SPECIAL_RATE',
      baselineSource: terms.baselineSource,
      baselineAmount: terms.baselineAmount,
      discountAmount: 0,
      definition: terms.definition as Prisma.InputJsonValue,
      fingerprint: terms.fingerprint,
    },
  });
  await tx.promotionUsage.create({
    data: {
      promotionId: terms.promotionId,
      saleId,
      customerId: contract.customerId,
      discountApplied: 0,
      benefitId: benefit.id,
    },
  });
  await auditNamed(
    'CONTRACT_PROMOTION_APPLIED',
    contract.id,
    terms.id,
    terms.promotionId,
    terms.fingerprint,
  );
}

/** Named signatures additionally bind the immutable complete money/schedule proof. */
export function namedSignatureHash(
  contract: Contract & { product?: { imeiSerial?: string | null } | null },
) {
  return hash({
    promotionFingerprint: contract.promotionFingerprint,
    financials: contractPromotionFinancials(contract),
    imei: contract.product?.imeiSerial ?? null,
  });
}
export function assertNamedSignatures(
  contract: Contract & {
    product?: { imeiSerial?: string | null } | null;
    signatures: { contractHash: string | null }[];
  },
) {
  if (contract.signatures.some((s) => s.contractHash !== namedSignatureHash(contract))) {
    throw new ConflictException('ลายเซ็นไม่ตรงกับเงื่อนไขโปรโมชันสัญญา');
  }
}
