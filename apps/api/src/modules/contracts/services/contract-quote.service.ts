import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { ContractQuote } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { loadInstallmentConfig, resolveInstallmentParams, resolveBranchVat } from '../../../utils/config.util';
import { getRateForMonths } from '../../../utils/get-rate-for-months.util';
import { calculateInstallmentWithInterest, generatePaymentSchedule, roundBaht } from '../../../utils/installment.util';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { TradeInCreditService } from '../../trade-in/services/trade-in-credit.service';
import { DiscountPolicy } from '../../sales/services/discount-policy.util';
import { ContractQuoteDto } from '../dto/contract-quote.dto';

export type ContractQuoteActor = { id: string; role: string; branchId?: string | null };
const money = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value).toFixed(2);

@Injectable()
export class ContractQuoteService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(dto: ContractQuoteDto, actor: ContractQuoteActor, tx: Prisma.TransactionClient = this.prisma): Promise<ContractQuote> {
    if (!hasCrossBranchAccess(actor) && (!actor.branchId || actor.branchId !== dto.branchId)) {
      throw new ForbiddenException('ไม่มีสิทธิ์คำนวณสัญญาของสาขานี้');
    }
    if (![dto.sellingPrice, dto.downPayment].every(Number.isFinite) || dto.sellingPrice <= 0 || dto.downPayment < 0) {
      throw new BadRequestException('ราคาขายหรือเงินดาวน์ไม่ถูกต้อง');
    }
    // PostgreSQL stores money at two decimal places. Resolve from those same values.
    dto = { ...dto, sellingPrice: new Prisma.Decimal(dto.sellingPrice).toDecimalPlaces(2).toNumber(),
      downPayment: new Prisma.Decimal(dto.downPayment).toDecimalPlaces(2).toNumber() };
    if (!Number.isInteger(dto.totalMonths) || dto.totalMonths < 1 || dto.totalMonths > 120) {
      throw new BadRequestException('จำนวนงวดต้องเป็นจำนวนเต็มระหว่าง 1-120');
    }
    if (dto.paymentDueDay != null && (!Number.isInteger(dto.paymentDueDay) || dto.paymentDueDay < 1 || dto.paymentDueDay > 31)) {
      throw new BadRequestException('วันครบกำหนดชำระต้องอยู่ระหว่าง 1-31 (31 คือสิ้นเดือน)');
    }
    const product = await tx.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.deletedAt) throw new BadRequestException('ไม่พบสินค้าที่ต้องการคำนวณ');
    if (product.branchId !== dto.branchId) throw new ForbiddenException('สินค้าต้องอยู่สาขาเดียวกับสัญญา');
    const credit = dto.tradeInCreditId ? await new TradeInCreditService(this.prisma).quote(tx, {
      tradeInId: dto.tradeInCreditId, customerId: dto.customerId, productId: dto.productId,
      branchId: dto.branchId, priceAfterDiscount: dto.sellingPrice,
    }) : null;
    if (credit) DiscountPolicy.assertDiscountAllowed(dto.sellingPrice, credit.bonus.toNumber(), actor.role, Number(product.costPrice), undefined);
    const sellingPrice = credit?.net ?? new Prisma.Decimal(dto.sellingPrice);
    const downPayment = new Prisma.Decimal(dto.downPayment).plus(credit?.base ?? 0);
    const config = await tx.interestConfig.findFirst({
      where: { isActive: true, deletedAt: null, productCategories: { has: product.category } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const params = resolveInstallmentParams(config, await loadInstallmentConfig(tx), dto.interestRate);
    const vat = await resolveBranchVat(tx, dto.branchId, params.vatPct);
    if (downPayment.gte(sellingPrice)) throw new BadRequestException('เงินดาวน์รวมต้องน้อยกว่าราคาขาย');
    if (downPayment.lt(sellingPrice.mul(params.minDownPaymentPct))) {
      throw new BadRequestException(`เงินดาวน์ขั้นต่ำ ${(params.minDownPaymentPct * 100).toFixed(0)}%`);
    }
    if (dto.totalMonths < params.minInstallmentMonths || dto.totalMonths > params.maxInstallmentMonths) {
      throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${params.minInstallmentMonths}-${params.maxInstallmentMonths} เดือน`);
    }
    const rate = config ? await getRateForMonths(tx, config.id, dto.totalMonths)
      : new Prisma.Decimal(params.interestRate).mul(dto.totalMonths);
    const interestTotal = roundBaht(roundBaht(sellingPrice.minus(downPayment).toNumber()) * Number(rate));
    const calc = calculateInstallmentWithInterest(sellingPrice.toNumber(), downPayment.toNumber(), interestTotal,
      dto.totalMonths, params.storeCommissionPct, vat.vatPct);
    const schedule = generatePaymentSchedule('', dto.totalMonths, calc.financedAmount, calc.monthlyPayment, dto.paymentDueDay,
      { principal: calc.principal, interestTotal: calc.interestTotal, storeCommission: calc.storeCommission, vatAmount: calc.vatAmount }, new Date())
      .map(row => ({ installmentNo: row.installmentNo, dueDate: row.dueDate.toISOString(), amountDue: money(row.amountDue),
        monthlyPrincipal: money(row.monthlyPrincipal ?? 0), monthlyInterest: money(row.monthlyInterest ?? 0),
        monthlyCommission: money(row.monthlyCommission ?? 0), vatAmount: money(row.vatAmount ?? 0) }));
    const amounts = {
      sellingPrice: money(sellingPrice), downPayment: money(downPayment), cashDownPayment: money(dto.downPayment),
      tradeInCreditAmount: money(credit?.base ?? 0), configId: config?.id ?? null,
      vatSource: vat.source, effectiveVatPct: vat.vatPct.toFixed(4), interestRate: new Prisma.Decimal(rate).div(dto.totalMonths).toFixed(4),
      storeCommissionPct: params.storeCommissionPct.toFixed(4), minDownPaymentPct: params.minDownPaymentPct.toFixed(4),
      minInstallmentMonths: params.minInstallmentMonths, maxInstallmentMonths: params.maxInstallmentMonths,
      ratePct: new Prisma.Decimal(rate).toFixed(8), principal: money(calc.principal), interestTotal: money(calc.interestTotal),
      storeCommission: money(calc.storeCommission), vatAmount: money(calc.vatAmount), totalPayable: money(calc.financedAmount),
      monthlyPayment: money(calc.monthlyPayment), lastPayment: schedule[schedule.length - 1].amountDue,
      totalMonths: dto.totalMonths, firstDueDate: schedule[0].dueDate, schedule,
    };
    const fingerprint = createHash('sha256').update(JSON.stringify({ customerId: dto.customerId, productId: dto.productId,
      branchId: dto.branchId, paymentDueDay: dto.paymentDueDay ?? null, tradeInCreditId: dto.tradeInCreditId ?? null, grossSellingPrice: money(dto.sellingPrice), ...amounts })).digest('hex');
    return { fingerprint, ...amounts };
  }
}

export function contractQuotePayments(quote: ContractQuote, contractId: string): Array<Prisma.PaymentCreateManyInput & { dueDate: Date }> {
  return quote.schedule.map(row => ({ ...row, contractId, dueDate: new Date(row.dueDate), status: 'PENDING' }));
}
