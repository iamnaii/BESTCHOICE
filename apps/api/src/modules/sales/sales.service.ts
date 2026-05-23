import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSaleDto } from './dto/sale.dto';
import {
  calculateInstallmentWithInterest,
  generatePaymentSchedule,
  roundBaht,
} from '../../utils/installment.util';
import { getRateForMonths } from '../../utils/get-rate-for-months.util';
import { loadInstallmentConfig, resolveInstallmentParams, resolveVatPctForBranch } from '../../utils/config.util';
import { generateContractNumber, generateSaleNumber } from '../../utils/sequence.util';
import { InterCompanyService } from '../inter-company/inter-company.service';

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private interCompanyService: InterCompanyService,
  ) {}

  async findAll(filters: {
    saleType?: string;
    branchId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    paymentMethod?: string;
    salespersonId?: string;
    contractStatus?: string;
    page?: number;
    limit?: number;
    userRole?: string;
  }) {
    const { saleType, branchId, search, startDate, endDate, paymentMethod, salespersonId, contractStatus, page = 1, limit = 50, userRole } = filters;
    const where: Record<string, unknown> = { deletedAt: null };

    if (saleType) where.saleType = saleType;
    if (branchId) where.branchId = branchId;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (salespersonId) where.salespersonId = salespersonId;
    if (contractStatus) where.contract = { status: contractStatus };

    // Date range filter
    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    if (search) {
      where.OR = [
        { saleNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { financeCompany: { contains: search, mode: 'insensitive' } },
        { financeRefNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total, agg, groupBySaleType] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, costPrice: true } },
          branch: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
          contract: { select: { id: true, contractNumber: true, status: true, monthlyPayment: true, totalMonths: true } },
        },
      }),
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({
        where,
        _sum: { netAmount: true, discount: true },
      }),
      this.prisma.sale.groupBy({
        by: ['saleType'],
        where,
        _count: true,
        _sum: { netAmount: true },
      }),
    ]);

    // Build summary from aggregate + groupBy
    const getGroup = (type: string) => groupBySaleType.find(g => g.saleType === type);
    let totalProfit = 0;

    if (userRole === 'OWNER') {
      // Calculate profit from already-fetched data to avoid duplicate query
      totalProfit = data.reduce(
        (sum, s) => sum
          .add(new Prisma.Decimal(s.netAmount ?? 0))
          .sub(new Prisma.Decimal(s.product?.costPrice ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber();
    }

    const summary = {
      totalAmount: new Prisma.Decimal(agg._sum.netAmount ?? 0).toNumber(),
      totalDiscount: new Prisma.Decimal(agg._sum.discount ?? 0).toNumber(),
      totalProfit,
      cashCount: getGroup('CASH')?._count || 0,
      cashAmount: new Prisma.Decimal(getGroup('CASH')?._sum.netAmount ?? 0).toNumber(),
      installmentCount: getGroup('INSTALLMENT')?._count || 0,
      installmentAmount: new Prisma.Decimal(getGroup('INSTALLMENT')?._sum.netAmount ?? 0).toNumber(),
      financeCount: getGroup('EXTERNAL_FINANCE')?._count || 0,
      financeAmount: new Prisma.Decimal(getGroup('EXTERNAL_FINANCE')?._sum.netAmount ?? 0).toNumber(),
    };

    // Strip costPrice from response for non-OWNER roles
    const responseData = userRole === 'OWNER'
      ? data
      : data.map(s => {
          const { costPrice: _, ...productWithoutCost } = s.product;
          return { ...s, product: productWithoutCost };
        });

    return { data: responseData, total, page, limit, totalPages: Math.ceil(total / limit), summary };
  }

  async getSalespersons(user: { role: string; branchId?: string }) {
    const where: Record<string, unknown> = { isActive: true, deletedAt: null };
    if (user.role === 'BRANCH_MANAGER' && user.branchId) {
      where.branchId = user.branchId;
    }
    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true, nationalId: true } },
        product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, costPrice: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        contract: true,
      },
    });
    if (!sale || sale.deletedAt) throw new NotFoundException('ไม่พบใบขาย');
    return sale;
  }

  // T5-C1 — POS discount cost-floor + role cap.
  // Phone-shop margin is ~10%, so an unbounded discount hidden in a sale
  // turns into direct loss. Every role has a max discount %; anything over
  // the soft threshold must carry a second approver.
  private static readonly MAX_DISCOUNT_PCT: Record<string, number> = {
    SALES: 0.05,
    BRANCH_MANAGER: 0.15,
    FINANCE_MANAGER: 0.25,
    ACCOUNTANT: 0.05, // same as SALES — accountant isn't expected to discount
    OWNER: 1.0, // effectively unlimited
  };
  private static readonly DISCOUNT_SECOND_APPROVER_THRESHOLD = 0.1;

  private assertDiscountAllowed(
    sellingPrice: number,
    discount: number,
    userRole: string,
    costPrice: number | null | undefined,
    secondApproverId: string | null | undefined,
  ): void {
    if (!discount || discount <= 0) return;
    if (sellingPrice <= 0) {
      throw new BadRequestException('ราคาขายไม่ถูกต้อง');
    }
    const pct = discount / sellingPrice;
    const maxForRole =
      SalesService.MAX_DISCOUNT_PCT[userRole] ?? SalesService.MAX_DISCOUNT_PCT.SALES;

    if (pct > maxForRole) {
      throw new BadRequestException(
        `ส่วนลด ${(pct * 100).toFixed(1)}% เกินขีดจำกัด ${(maxForRole * 100).toFixed(0)}% ของ role ${userRole}`,
      );
    }

    // Second-approver requirement kicks in before the hard role cap —
    // anything over 10% must be co-signed, regardless of role (OWNER is the
    // only exception because they are the approver authority).
    if (
      userRole !== 'OWNER' &&
      pct > SalesService.DISCOUNT_SECOND_APPROVER_THRESHOLD &&
      !secondApproverId
    ) {
      throw new BadRequestException(
        'ส่วนลดเกิน 10% ต้องมีผู้อนุมัติเพิ่มเติม (secondApproverId)',
      );
    }

    // Cost floor: net selling price must not drop below costPrice × (1 - maxForRole).
    // OWNER is allowed to override this (they can sell below cost deliberately
    // for strategic reasons such as clearing dead stock).
    if (costPrice != null && costPrice > 0 && userRole !== 'OWNER') {
      const netAfterDiscount = sellingPrice - discount;
      const floor = costPrice * (1 - maxForRole);
      if (netAfterDiscount < floor) {
        throw new BadRequestException(
          `ราคาขายสุทธิ ${netAfterDiscount.toLocaleString()} ต่ำกว่าขั้นต่ำ ${floor.toLocaleString()} (ต้นทุน ${costPrice.toLocaleString()})`,
        );
      }
    }
  }

  async create(dto: CreateSaleDto, salespersonId: string, userRole = 'SALES') {
    const baseDiscount = dto.discount || 0;

    // T6-C1: loyalty redeem at POS — validate customer balance and fold the
    // redeemed value into discount (1 pt = 1 ฿). The redemption itself is
    // applied after the sale is created so we have saleId/contractId to
    // reference. If the downstream redemption ever fails after the sale is
    // persisted, follow-up reconciliation is manual — but pre-validation
    // makes that corner case very unlikely.
    const loyaltyPoints = dto.loyaltyPointsRedeemed ?? 0;
    if (loyaltyPoints > 0) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
        select: { loyaltyBalance: true, deletedAt: true },
      });
      if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
      if (customer.loyaltyBalance < loyaltyPoints) {
        throw new BadRequestException(
          `แต้มไม่เพียงพอ — มี ${customer.loyaltyBalance} แต้ม ต้องการ ${loyaltyPoints} แต้ม`,
        );
      }
      if (loyaltyPoints > dto.sellingPrice - baseDiscount) {
        throw new BadRequestException(
          'จำนวนแต้มที่แลกเกินยอดสุทธิ — ลดจำนวนแต้มให้ไม่เกินยอดคงเหลือ',
        );
      }
    }

    const discount = baseDiscount + loyaltyPoints;
    const netAmount = dto.sellingPrice - discount;

    // T5-C8 pre-check (before sub-methods' own verifyProductInStock which
    // only validates stock state). We resolve wasPreviouslyDamaged upfront
    // so we can fail fast with the right Thai error before touching the
    // tx, and so the downstream verifyProductInStock inside the tx just
    // needs to re-confirm in-stock — not duplicate role checks.
    if (dto.productId) {
      const productFlags = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { wasPreviouslyDamaged: true, deletedAt: true },
      });
      if (productFlags?.wasPreviouslyDamaged && !productFlags.deletedAt) {
        if (!dto.previouslyDamagedAcknowledged) {
          throw new BadRequestException(
            'สินค้านี้เคยมีสถานะ DAMAGED/LOST/WRITTEN_OFF — ต้องยืนยัน previouslyDamagedAcknowledged=true และต้องได้รับอนุมัติจาก OWNER/FINANCE_MANAGER',
          );
        }
        const allowedRoles = ['OWNER', 'FINANCE_MANAGER'];
        if (!allowedRoles.includes(userRole)) {
          throw new ForbiddenException(
            `ขายสินค้าที่เคย DAMAGED ต้องทำโดย ${allowedRoles.join(' / ')} เท่านั้น`,
          );
        }
      }
    }

    // Look up product cost so the service can enforce a cost floor.
    let costPrice: number | null = null;
    if (dto.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { costPrice: true },
      });
      if (product?.costPrice != null) {
        costPrice = Number(product.costPrice);
      }
    }

    this.assertDiscountAllowed(
      dto.sellingPrice,
      discount,
      userRole,
      costPrice,
      dto.secondApproverId,
    );

    let sale: { id: string; contractId?: string | null };
    switch (dto.saleType) {
      case 'CASH':
        sale = await this.createCashSale(dto, salespersonId, netAmount, discount);
        break;
      case 'INSTALLMENT':
        sale = await this.createInstallmentSale(dto, salespersonId, netAmount, discount);
        break;
      case 'EXTERNAL_FINANCE':
        sale = await this.createExternalFinanceSale(dto, salespersonId, netAmount, discount);
        break;
      default:
        throw new BadRequestException('ประเภทการขายไม่ถูกต้อง');
    }

    // Apply loyalty redemption after sale is confirmed. Wrap in try/catch so a
    // redemption failure doesn't hide the sale response — the sale already
    // posted, support flow will reconcile if the point deduction fell through.
    if (loyaltyPoints > 0) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.loyaltyRedemption.create({
            data: {
              customerId: dto.customerId,
              points: loyaltyPoints,
              reason: `Sale ${sale.id}`,
              discountAmount: new Prisma.Decimal(loyaltyPoints),
              contractId: sale.contractId ?? null,
            },
          });
          await tx.customer.update({
            where: { id: dto.customerId },
            data: { loyaltyBalance: { decrement: loyaltyPoints } },
          });
        });
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sale as any)._loyaltyRedemptionFailed = err instanceof Error ? err.message : String(err);
      }
    }

    return sale;
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

  private async createCashSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
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
          commissionAmount: Math.round(netAmount * commissionRate * 100) / 100,
          status: 'PENDING',
        },
      });

      return sale;
    }, { isolationLevel: 'Serializable' });
  }

  private async createInstallmentSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
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
      await tx.financeReceivable.create({
        data: {
          saleId: sale.id,
          branchId: dto.branchId,
          financeCompany: 'BESTCHOICE FINANCE',
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
          commissionAmount: Math.round(netAmount * commissionRate * 100) / 100,
          status: 'PENDING',
        },
      });

      return sale;
    });
  }

  private async createExternalFinanceSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
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
      await tx.financeReceivable.create({
        data: {
          saleId: sale.id,
          branchId: dto.branchId,
          financeCompany: dto.financeCompany!,
          financeRefNumber: dto.contractNumber || dto.financeRefNumber || null,
          expectedAmount: financeAmount,
          netExpectedAmount: financeAmount, // Commission can be updated later
          expectedDate,
        },
      });

      return sale;
    }, { isolationLevel: 'Serializable' });
  }

  async getPosConfig() {
    return loadInstallmentConfig(this.prisma);
  }

  async getTopSellingProducts(limit = 6) {
    const results = await this.prisma.sale.groupBy({
      by: ['productId'],
      where: { deletedAt: null },
      _count: { productId: true },
      orderBy: { _count: { productId: 'desc' } },
      take: limit,
    });

    if (results.length === 0) return [];

    const products = await this.prisma.product.findMany({
      where: { id: { in: results.map(r => r.productId) }, deletedAt: null },
      select: { id: true, name: true, brand: true, model: true },
    });

    const productMap = new Map(products.map(p => [p.id, p]));
    return results
      .map(r => {
        const p = productMap.get(r.productId);
        return p ? { ...p, count: r._count.productId } : null;
      })
      .filter(Boolean);
  }

  async getDailySummary(date: string, branchId?: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const where: Record<string, unknown> = {
      createdAt: { gte: startOfDay, lte: endOfDay },
      deletedAt: null,
    };
    if (branchId) where.branchId = branchId;

    const sales = await this.prisma.sale.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        product: { select: { name: true, brand: true, model: true } },
        salesperson: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const summary = {
      totalSales: sales.length,
      cashSales: sales.filter(s => s.saleType === 'CASH').length,
      installmentSales: sales.filter(s => s.saleType === 'INSTALLMENT').length,
      externalFinanceSales: sales.filter(s => s.saleType === 'EXTERNAL_FINANCE').length,
      totalRevenue: sales.reduce(
        (sum, s) => sum.add(new Prisma.Decimal(s.netAmount ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber(),
      sales,
    };

    return summary;
  }
}
