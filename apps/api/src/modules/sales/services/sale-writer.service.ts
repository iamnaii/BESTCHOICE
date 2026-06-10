import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentMethod, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSaleDto } from '../dto/sale.dto';
import {
  calculateInstallmentWithInterest,
  generatePaymentSchedule,
  roundBaht,
} from '../../../utils/installment.util';
import { computeCommissionAmount } from '../../../utils/commission.util';
import { getRateForMonths } from '../../../utils/get-rate-for-months.util';
import { loadInstallmentConfig, resolveInstallmentParams, resolveVatPctForBranch } from '../../../utils/config.util';
import { generateContractNumber, generateSaleNumber } from '../../../utils/sequence.util';
import { InterCompanyService } from '../../inter-company/inter-company.service';

/**
 * Per-sale-type transactional writers extracted from SalesService.
 *
 * Each `create*Sale` runs its own `$transaction` with EXACTLY the original
 * isolation level (cash/external = Serializable, installment = default).
 * The tx-scoped helpers (`verifyProductInStock`, `markBundleProductsSold`,
 * `resolveExternalFinanceCompanyId`) are co-located because they take the tx
 * client and must run inside the owning transaction for race-safety.
 *
 * Bodies are verbatim from the original SalesService — only `this.<dep>`
 * resolution and import paths changed.
 */
export class SaleWriterService {
  constructor(
    private prisma: PrismaService,
    private interCompanyService: InterCompanyService,
  ) {}

  private async resolveExternalFinanceCompanyId(
    tx: Prisma.TransactionClient,
    name: string,
  ): Promise<string> {
    const company = await tx.externalFinanceCompany.upsert({
      where: { name },
      create: { name, isActive: true },
      update: {},
    });
    return company.id;
  }

  /**
   * Check product availability inside transaction to prevent race conditions.
   *
   * T5-C8: products that were ever flagged DAMAGED/LOST/WRITTEN_OFF keep
   * `wasPreviouslyDamaged=true` permanently. Selling such a phone is
   * allowed only when the caller (a) passes `previouslyDamagedAcknowledged`
   * in the DTO — proof that the customer was told the phone has a damage
   * history — and (b) is OWNER/FINANCE_MANAGER. BRANCH_MANAGER/SALES can't
   * push these through alone.
   */
  private async verifyProductInStock(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    productId: string,
    opts?: {
      userRole?: string;
      acknowledged?: boolean;
    },
  ) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || product.deletedAt || product.status !== 'IN_STOCK') {
      throw new BadRequestException('สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว');
    }
    if (product.wasPreviouslyDamaged) {
      const allowedRoles = ['OWNER', 'FINANCE_MANAGER'];
      if (!opts?.acknowledged) {
        throw new BadRequestException(
          'สินค้านี้เคยมีสถานะ DAMAGED/LOST/WRITTEN_OFF — ต้องยืนยันว่าได้แจ้งลูกค้าแล้ว ' +
            '(previouslyDamagedAcknowledged=true) และได้รับอนุมัติจาก OWNER/FINANCE_MANAGER',
        );
      }
      if (opts.userRole && !allowedRoles.includes(opts.userRole)) {
        throw new ForbiddenException(
          `ขายสินค้าที่เคย DAMAGED ต้องทำโดย ${allowedRoles.join(' / ')} เท่านั้น`,
        );
      }
    }
    return product;
  }

  /** Mark bundle (freebie) products as SOLD_CASH */
  private async markBundleProductsSold(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    bundleProductIds: string[],
  ) {
    if (!bundleProductIds.length) return;
    // Verify all bundle products are IN_STOCK
    const products = await tx.product.findMany({
      where: { id: { in: bundleProductIds }, deletedAt: null },
      select: { id: true, status: true, name: true },
    });
    for (const p of products) {
      if (p.status !== 'IN_STOCK') {
        throw new BadRequestException(`ของแถม "${p.name}" ไม่พร้อมขาย`);
      }
    }
    if (products.length !== bundleProductIds.length) {
      throw new BadRequestException('ไม่พบสินค้าของแถมบางรายการ');
    }
    // Update all bundle products to SOLD_CASH
    await tx.product.updateMany({
      where: { id: { in: bundleProductIds } },
      data: { status: 'SOLD_CASH' },
    });
  }

  async createCashSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
    if (!dto.paymentMethod) throw new BadRequestException('กรุณาเลือกวิธีชำระเงิน');

    return this.prisma.$transaction(async (tx) => {
      await this.verifyProductInStock(tx, dto.productId);
      await this.markBundleProductsSold(tx, dto.bundleProductIds || []);
      const saleNumber = await generateSaleNumber(tx);

      // Tax point (จุดความรับผิดทางภาษี): วันส่งมอบสินค้า = วันที่สร้างรายการขาย
      const sale = await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'CASH',
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          sellingPrice: dto.sellingPrice,
          discount,
          netAmount,
          paymentMethod: dto.paymentMethod as PaymentMethod,
          amountReceived: dto.amountReceived || netAmount,
          bundleProductIds: dto.bundleProductIds || [],
          notes: dto.notes,
        },
      });

      // Update product status to SOLD_CASH
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'SOLD_CASH' },
      });

      // W-007: COGS tracked via sale.product.costPrice relationship.
      // P&L report (AccountingService.getProfitLossReport) captures product cost
      // by joining Sale → Product.costPrice, including bundle products.
      // TODO: Implement perpetual inventory journal for real-time COGS ledger entries.

      // Auto-create sales commission (read from CommissionRule, fallback to 3%)
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const rule = await tx.commissionRule.findFirst({
        where: { isActive: true, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const commissionRate = rule?.rate ? Number(rule.rate) : 0.03;
      await tx.salesCommission.create({
        data: {
          salespersonId,
          // T4-C10: cash sale has no contract — snapshot = current earner
          snapshotSalespersonId: salespersonId,
          saleId: sale.id,
          period,
          saleAmount: netAmount,
          commissionRate,
          commissionAmount: computeCommissionAmount(netAmount, commissionRate),
          status: 'PENDING',
        },
      });

      return sale;
    }, { isolationLevel: 'Serializable' });
  }

  async createInstallmentSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
    // Default planType to STORE_DIRECT (single plan type)
    if (!dto.planType) dto.planType = 'STORE_DIRECT';
    if (!dto.downPayment && dto.downPayment !== 0) throw new BadRequestException('กรุณาใส่เงินดาวน์');
    if (!dto.totalMonths) throw new BadRequestException('กรุณาเลือกจำนวนงวด');

    // Look up product to find matching InterestConfig
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    const interestConfig = (product && !product.deletedAt)
      ? await this.prisma.interestConfig.findFirst({
          where: { isActive: true, deletedAt: null, productCategories: { has: product.category } },
        })
      : null;

    const systemConfig = await loadInstallmentConfig(this.prisma);
    const baseParams = resolveInstallmentParams(interestConfig, systemConfig, dto.interestRate);
    // Override vatPct based on the selling branch's VAT registration status
    // BESTCHOICE SHOP (vatRegistered=false) → 0%, BESTCHOICE FINANCE → 7%
    const effectiveVatPct = await resolveVatPctForBranch(this.prisma, dto.branchId, baseParams.vatPct);
    const params = { ...baseParams, vatPct: effectiveVatPct };

    if (dto.downPayment < netAmount * params.minDownPaymentPct) {
      throw new BadRequestException(`เงินดาวน์ขั้นต่ำ ${(params.minDownPaymentPct * 100).toFixed(0)}%`);
    }
    if (dto.totalMonths < params.minInstallmentMonths || dto.totalMonths > params.maxInstallmentMonths) {
      throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${params.minInstallmentMonths}-${params.maxInstallmentMonths} เดือน`);
    }

    // Resolve total-contract rate via new lookup (feature-flagged; fallback = legacy rate × months)
    const ratePct = interestConfig
      ? Number(await getRateForMonths(this.prisma, interestConfig.id, dto.totalMonths))
      : params.interestRate * dto.totalMonths;
    const principalForInterest = roundBaht(netAmount - dto.downPayment);
    const interestTotal = roundBaht(principalForInterest * ratePct);
    const calc = calculateInstallmentWithInterest(
      netAmount,
      dto.downPayment,
      interestTotal,
      dto.totalMonths,
      params.storeCommissionPct,
      params.vatPct,
    );

    return this.prisma.$transaction(async (tx) => {
      await this.verifyProductInStock(tx, dto.productId);
      await this.markBundleProductsSold(tx, dto.bundleProductIds || []);
      const saleNumber = await generateSaleNumber(tx);

      // Use provided contract number or auto-generate
      let contractNumber = dto.contractNumber;
      if (!contractNumber) {
        contractNumber = await generateContractNumber(tx);
      }

      // Create contract (with storeCommission)
      const contract = await tx.contract.create({
        data: {
          contractNumber,
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          planType: dto.planType as PlanType,
          sellingPrice: netAmount,
          downPayment: dto.downPayment!,
          interestRate: params.interestRate,
          totalMonths: dto.totalMonths!,
          interestTotal: calc.interestTotal,
          financedAmount: calc.financedAmount,
          storeCommission: calc.storeCommission,
          vatAmount: calc.vatAmount,
          vatPct: params.vatPct,
          monthlyPayment: calc.monthlyPayment,
          status: 'DRAFT',
          workflowStatus: 'CREATING',
          paymentDueDay: dto.paymentDueDay,
          interestConfigId: interestConfig?.id,
          notes: dto.notes,
        },
      });

      // Create payment schedule
      const payments = generatePaymentSchedule(
        contract.id, dto.totalMonths!, calc.financedAmount, calc.monthlyPayment, dto.paymentDueDay,
        { principal: calc.principal, interestTotal: calc.interestTotal, storeCommission: calc.storeCommission, vatAmount: calc.vatAmount },
      );
      await tx.payment.createMany({ data: payments });

      // Tax point (จุดความรับผิดทางภาษี): วันส่งมอบสินค้า = วันที่สร้างรายการขาย
      // Create sale record linked to contract
      const sale = await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'INSTALLMENT',
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          sellingPrice: dto.sellingPrice,
          discount,
          netAmount,
          paymentMethod: dto.paymentMethod as PaymentMethod,
          amountReceived: dto.downPayment,
          downPaymentAmount: dto.downPayment,
          contractId: contract.id,
          bundleProductIds: dto.bundleProductIds || [],
          notes: dto.notes,
        },
      });

      // Reserve product
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'RESERVED' },
      });

      // W-007: COGS tracked via sale.product.costPrice + InterCompanyTransaction.costPrice.
      // P&L report captures product cost by joining Sale → Product.costPrice.
      // TODO: Implement perpetual inventory journal for real-time COGS ledger entries.

      // ── Inter-Company Transaction: BESTCHOICE SHOP ↔ BESTCHOICE FINANCE ──
      const costPrice = product ? Number(product.costPrice) : 0;
      const downPaymentNum = dto.downPayment!;
      // Shop profit = downPayment + principal + commission - costPrice
      const shopProfit = downPaymentNum + calc.principal + calc.storeCommission - costPrice;
      // Finance profit = interestTotal - commission (late fees added later)
      const financeProfit = calc.interestTotal - calc.storeCommission;

      // CR-8: Delegate inter-company transaction to InterCompanyService
      await this.interCompanyService.createFromSaleInTx(tx, {
        saleId: sale.id,
        contractId: contract.id,
        branchId: dto.branchId,
        principal: calc.principal,
        commission: calc.storeCommission,
        commissionPct: params.storeCommissionPct,
        vatAmount: calc.vatAmount,
        vatPct: params.vatPct,
        totalAmount: calc.principal + calc.storeCommission,
        interestTotal: calc.interestTotal,
        costPrice,
        downPayment: downPaymentNum,
        sellingPrice: netAmount,
        shopProfit,
        financeProfit,
      });

      // ── Finance Receivable for BESTCHOICE FINANCE (internal) ──
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 1); // Internal: expect next day
      const bcFinanceId = await this.resolveExternalFinanceCompanyId(tx, 'BESTCHOICE FINANCE');
      await tx.financeReceivable.create({
        data: {
          saleId: sale.id,
          branchId: dto.branchId,
          financeCompany: 'BESTCHOICE FINANCE',
          externalFinanceCompanyId: bcFinanceId,
          expectedAmount: calc.principal + calc.storeCommission,
          commissionRate: params.storeCommissionPct,
          commissionAmount: calc.storeCommission,
          netExpectedAmount: calc.principal,
          expectedDate,
        },
      });

      // Auto-create sales commission (read from CommissionRule, fallback to 3%)
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const rule = await tx.commissionRule.findFirst({
        where: { isActive: true, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const commissionRate = rule?.rate ? Number(rule.rate) : 0.03;
      await tx.salesCommission.create({
        data: {
          salespersonId,
          // T4-C10: snapshot earner from the contract at creation time. If
          // the contract is later reassigned (admin action), commission
          // stays tied to the original earner.
          snapshotSalespersonId: contract.salespersonId,
          contractId: contract.id,
          saleId: sale.id,
          period,
          saleAmount: netAmount,
          commissionRate,
          commissionAmount: computeCommissionAmount(netAmount, commissionRate),
          status: 'PENDING',
        },
      });

      return sale;
    });
  }

  async createExternalFinanceSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
    if (!dto.financeCompany) throw new BadRequestException('กรุณาใส่ชื่อบริษัทไฟแนนซ์');

    const downPayment = dto.downPayment || 0;
    const financeAmount = dto.financeAmount || (netAmount - downPayment);

    return this.prisma.$transaction(async (tx) => {
      await this.verifyProductInStock(tx, dto.productId);
      await this.markBundleProductsSold(tx, dto.bundleProductIds || []);
      const saleNumber = await generateSaleNumber(tx);

      // Tax point (จุดความรับผิดทางภาษี): วันส่งมอบสินค้า = วันที่สร้างรายการขาย
      const sale = await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'EXTERNAL_FINANCE',
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          sellingPrice: dto.sellingPrice,
          discount,
          netAmount,
          paymentMethod: dto.paymentMethod as PaymentMethod,
          amountReceived: downPayment > 0 ? downPayment : financeAmount,
          downPaymentAmount: downPayment,
          financeCompany: dto.financeCompany,
          financeRefNumber: dto.contractNumber || dto.financeRefNumber,
          financeAmount,
          bundleProductIds: dto.bundleProductIds || [],
          notes: dto.notes,
        },
      });

      // Update product status
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'SOLD_INSTALLMENT' },
      });

      // W-007: COGS tracked via sale.product.costPrice relationship.
      // P&L report captures product cost by joining Sale → Product.costPrice.
      // TODO: Implement perpetual inventory journal for real-time COGS ledger entries.

      // Auto-create FinanceReceivable to track money from finance company
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 7); // Default: expect within 7 days
      const extFinanceId = await this.resolveExternalFinanceCompanyId(tx, dto.financeCompany!);
      await tx.financeReceivable.create({
        data: {
          saleId: sale.id,
          branchId: dto.branchId,
          financeCompany: dto.financeCompany!,
          externalFinanceCompanyId: extFinanceId,
          financeRefNumber: dto.contractNumber || dto.financeRefNumber || null,
          expectedAmount: financeAmount,
          netExpectedAmount: financeAmount, // Commission can be updated later
          expectedDate,
        },
      });

      return sale;
    }, { isolationLevel: 'Serializable' });
  }
}
