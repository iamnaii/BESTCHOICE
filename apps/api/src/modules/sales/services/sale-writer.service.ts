import { claimCreditApproval } from '../../credit-check/services/credit-approval';
import { TradeInCreditService } from '../../trade-in/services/trade-in-credit.service';
import { lockCreditCustomer } from '../../credit-check/services/room-credit-history';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { closeRepossessionOnSale } from '../../repossessions/repossession-resale.util';
import { PaymentMethod, PlanType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
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
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopExternalFinanceSaleTemplate } from '../../journal/cpa-templates/shop-external-finance-sale.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { allocateCashSaleByCost } from '../shop-cash-sale-allocation.util';
import { preemptReservationsInTx } from '../../../utils/reservation-preempt.util';
import { addDays } from 'date-fns';
import {
  resolveShopWarrantyDays,
  SHOP_WARRANTY_DAYS_CONFIG_KEY,
} from '../../warranty/shop-warranty-policy';

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
@Injectable()
export class SaleWriterService {
  constructor(
    private prisma: PrismaService,
    private interCompanyService: InterCompanyService,
    private shopCashSaleTemplate: ShopCashSaleTemplate,
    private shopAccountResolver: ShopAccountResolver,
    private shopExternalFinanceSaleTemplate: ShopExternalFinanceSaleTemplate,
  ) {}

  /**
   * Retry wrapper around `this.prisma.$transaction` — same shape/constants AND
   * error-detection predicate as `ContractLifecycleService.create`'s retry loop
   * (contract-lifecycle.service.ts:255-259): up to 3 attempts, retry on a
   * Prisma unique-constraint violation (P2002) OR serialization failure
   * (P2034).
   *
   * B5 (fix round 1 — widened from P2034-only): `preemptReservationsInTx`
   * adds a `productReservation.updateMany` write-write surface inside these
   * `$transaction` calls, raising P2034 odds under Serializable isolation
   * (cash/external) — see `reservation-preempt.util.ts`'s doc-comment.
   * Separately, and unrelated to preempt: `generateSaleNumber`/
   * `generateContractNumber` (`sequence.util.ts`) have NO advisory lock —
   * plain unlocked `findFirst(desc)` + `parseInt+1`. `createInstallmentSale`
   * runs at default isolation (no `isolationLevel: 'Serializable'`), so two
   * concurrent installment sales can race past that unlocked read and both
   * try to `INSERT` the same `Contract.contractNumber`/`Sale.saleNumber`,
   * producing a genuine P2002 — not a P2034. This is exactly the race
   * `contract-lifecycle.service.ts`'s own P2002 branch exists for (same
   * `contractNumber` field), and retrying is safe here for the same reason:
   * `Sale` has no unique `idempotencyKey`, `productReservation` writes are
   * `updateMany`-only, and the whole callback reruns on retry so a fresh
   * number is generated each attempt — no duplicate-effect risk. Any other
   * error (e.g. P2003, P2025, or a non-Prisma error) is NOT retried — it
   * propagates immediately, unchanged.
   */
  private async runSaleTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T> {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(fn, options);
      } catch (err: unknown) {
        // Retry on unique constraint (P2002) or serialization failure (P2034)
        // — same predicate as ContractLifecycleService.create.
        const prismaErr = err instanceof Prisma.PrismaClientKnownRequestError ? err : null;
        const isRetryable = prismaErr?.code === 'P2002' || prismaErr?.code === 'P2034';
        if (isRetryable && attempt < MAX_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }
    // Unreachable — the loop above always returns (success) or throws
    // (exhausted retries / non-retryable error).
    throw new Error(
      'unreachable: runSaleTransaction retry loop exited without returning or throwing',
    );
  }

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

  /**
   * วันประกันร้านของ "เครื่องหลัก" ในใบขาย — คืน `{}` เมื่อสินค้าชิ้นนี้ไม่ได้ประกันร้าน
   * (spread ลง `sale.create` ได้เลย ⇒ คอลัมน์คงเป็น NULL เหมือนใบขายเก่า)
   *
   * ใช้เฉพาะ CASH / EXTERNAL_FINANCE — ขาผ่อนไม่ต้อง เพราะสัญญาได้ประกันจาก
   * `WarrantyService.setShopWarranty(contractId)` ตอน activate อยู่แล้ว ถ้าเขียนที่นี่ด้วย
   * จะกลายเป็นสองแหล่งบนใบเดียวกันแล้วต้องมาตัดสินว่าอันไหนชนะ
   *
   * `startDate` = เวลาที่ขาย (ส่งมอบเครื่องหน้าร้าน) ต่างจากขาสัญญาที่ใช้ `contract.createdAt`
   * ซึ่งเป็นวันเปิดสัญญา — ทั้งคู่คือ "วันที่ลูกค้าได้เครื่องไป" ของเส้นทางตัวเอง
   */
  private async resolveSaleShopWarranty(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    product: { category: string; shopWarrantyDays: number | null },
    soldAt: Date,
  ): Promise<{ shopWarrantyStartDate?: Date; shopWarrantyEndDate?: Date }> {
    const config = await tx.systemConfig.findUnique({
      where: { key: SHOP_WARRANTY_DAYS_CONFIG_KEY },
    });
    const days = resolveShopWarrantyDays(product, config?.value);
    if (days === null) return {};
    return { shopWarrantyStartDate: soldAt, shopWarrantyEndDate: addDays(soldAt, days) };
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
    // B5: ของแถมออกจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน (กันขายซ้ำ)
    await preemptReservationsInTx(tx, bundleProductIds);
  }

  /**
   * เครื่องยึดที่ขายผ่าน POS (คำตัดสินเจ้าของ 2026-09-05): ปิดรายการยึดเป็น "ขายแล้ว" ให้เอง
   * พร้อมราคาขายจริง — การ์ดกำไร/ขาดทุนหน้ายึดนับเฉพาะ SOLD และหน้ายึดไม่ให้ตั้งด้วยมืออีก
   * (เส้นทางเดิม "จัดการ→ขายแล้ว" ไม่ลง JE เลย). ไม่มีแถวยึด = no-op. void ใบขายเปิดกลับ
   * เป็น READY_FOR_SALE (SaleVoidService).
   */

  async createCashSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
    if (!dto.paymentMethod) throw new BadRequestException('กรุณาเลือกวิธีชำระเงิน');

    return this.runSaleTransaction(async (tx) => {
      const credits = new TradeInCreditService(this.prisma);
      const creditInput = { ...dto, tradeInId: dto.tradeInCreditId!, priceAfterDiscount: new Decimal(dto.sellingPrice).minus(dto.discount ?? 0).minus(dto.loyaltyPointsRedeemed ?? 0).toNumber() };
      const credit = dto.tradeInCreditId ? await credits.quote(tx, creditInput) : null;
      if (credit && !credit.net.eq(netAmount)) throw new BadRequestException('ราคาหลังโบนัสเทิร์นเปลี่ยนแล้ว กรุณาตรวจยอดอีกครั้ง');
      const cashDue = new Decimal(netAmount).minus(credit?.base ?? 0);
      if (credit && new Decimal(dto.amountReceived ?? cashDue).lt(cashDue)) throw new BadRequestException('ยอดเงินที่รับยังไม่ครบ');
      const mainProduct = await this.verifyProductInStock(tx, dto.productId);
      await this.markBundleProductsSold(tx, dto.bundleProductIds || []);
      const saleNumber = await generateSaleNumber(tx);
      const warranty = await this.resolveSaleShopWarranty(tx, mainProduct, new Date());

      // Tax point (จุดความรับผิดทางภาษี): วันส่งมอบสินค้า = วันที่สร้างรายการขาย
      const sale = await tx.sale.create({
        data: {
          ...warranty,
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
          amountReceived: dto.amountReceived ?? cashDue,
          bundleProductIds: dto.bundleProductIds || [],
          notes: dto.notes,
        },
      });

      // Update product status to SOLD_CASH
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'SOLD_CASH' },
      });
      // B5: เครื่องหลุดจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน
      await preemptReservationsInTx(tx, [dto.productId]);
      await closeRepossessionOnSale(tx, { productId: dto.productId, resellPrice: dto.sellingPrice });

      // SHOP-side: post one cash-sale JE per product (bundle-aware). Sale has no
      // per-product price, so revenue is allocated proportionally by product cost.
      const productIds = [dto.productId, ...(dto.bundleProductIds || [])];
      const prods = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, category: true, costPrice: true },
      });
      const ordered = productIds
        .map((id) => prods.find((p) => p.id === id))
        .filter((p): p is (typeof prods)[number] => !!p);
      const cashAccountCode = await this.shopAccountResolver.resolveInflowCashAccount(
        dto.branchId,
        dto.paymentMethod as PaymentMethod,
        tx,
      );
      const allocations = allocateCashSaleByCost(
        // Base value is tender; the existing sale JE is adjusted in this same transaction.
        new Decimal(netAmount.toString()),
        ordered.map((p) => ({ id: p.id, costPrice: new Decimal(p.costPrice.toString()) })),
      );
      for (const alloc of allocations) {
        if (!alloc.revenue.gt(0)) continue; // template requires revenueAmount > 0
        const prod = ordered.find((p) => p.id === alloc.productId)!;
        const acc = this.shopAccountResolver.resolveProductAccounts(prod.category);
        await this.shopCashSaleTemplate.execute(
          {
            idempotencyKey: `shop-cash-sale:${sale.id}:${alloc.productId}`,
            saleId: sale.id,
            productId: alloc.productId,
            cashAccountCode,
            revenueAccountCode: acc.revenueAccountCode,
            revenueAmount: alloc.revenue,
            cogsAccountCode: acc.cogsAccountCode,
            inventoryAccountCode: acc.inventoryAccountCode,
            inventoryCost: alloc.cost,
          },
          tx,
        );
      }

      if (credit) {
        const snapshot = await credits.claim(tx, { ...creditInput, target: { saleId: sale.id }, cashAmount: cashDue.toNumber(), actorId: salespersonId }, cashAccountCode);
        await tx.sale.update({ where: { id: sale.id }, data: { tradeInCreditSnapshot: snapshot } });
        sale.tradeInCreditSnapshot = snapshot;
      }

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

  async createInstallmentSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number, userRole = 'SALES') {
    // Default planType to STORE_DIRECT (single plan type)
    if (!dto.planType) dto.planType = 'STORE_DIRECT';
    if (!dto.downPayment && dto.downPayment !== 0) throw new BadRequestException('กรุณาใส่เงินดาวน์');
    if (!dto.totalMonths) throw new BadRequestException('กรุณาเลือกจำนวนงวด');
    const cashDown = dto.downPayment!;
    const credits = new TradeInCreditService(this.prisma);
    const creditInput = { ...dto, tradeInId: dto.tradeInCreditId!, priceAfterDiscount: new Decimal(dto.sellingPrice).minus(dto.discount ?? 0).minus(dto.loyaltyPointsRedeemed ?? 0).toNumber() };
    const credit = dto.tradeInCreditId ? await credits.quote(this.prisma, creditInput) : null;
    if (credit) {
      if (!credit.net.eq(netAmount)) throw new BadRequestException('ยอดหลังโบนัสเทิร์นไม่ตรงกัน');
      dto = { ...dto, downPayment: new Decimal(cashDown).plus(credit.base).toNumber() };
    }
    if (dto.downPayment! >= netAmount || dto.downPayment! < 0) throw new BadRequestException('ยอดดาวน์รวมต้องน้อยกว่าราคาขาย');

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

    if (dto.downPayment! < netAmount * params.minDownPaymentPct) {
      throw new BadRequestException(`เงินดาวน์ขั้นต่ำ ${(params.minDownPaymentPct * 100).toFixed(0)}%`);
    }
    if (dto.totalMonths! < params.minInstallmentMonths || dto.totalMonths! > params.maxInstallmentMonths) {
      throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${params.minInstallmentMonths}-${params.maxInstallmentMonths} เดือน`);
    }

    // Resolve total-contract rate via new lookup (feature-flagged; fallback = legacy rate × months)
    const ratePct = interestConfig
      ? Number(await getRateForMonths(this.prisma, interestConfig.id, dto.totalMonths!))
      : params.interestRate * dto.totalMonths!;
    const principalForInterest = roundBaht(netAmount - dto.downPayment!);
    const interestTotal = roundBaht(principalForInterest * ratePct);
    const calc = calculateInstallmentWithInterest(
      netAmount,
      dto.downPayment!,
      interestTotal,
      dto.totalMonths!,
      params.storeCommissionPct,
      params.vatPct,
    );

    return this.runSaleTransaction(async (tx) => {
      await lockCreditCustomer(tx, dto.customerId);
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
          financedAmount: calc.principal,
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
      await claimCreditApproval(tx, { customerId: dto.customerId, contractId: contract.id,
        creditApprovalId: dto.creditApprovalId, paymentDueDay: dto.paymentDueDay,
        monthlyAmounts: payments.map(payment => Number(payment.amountDue)), firstPaymentDue: payments[0]?.dueDate,
        actor: { id: salespersonId, role: userRole } });
      await tx.payment.createMany({ data: payments });

      // Tax point (จุดความรับผิดทางภาษี): วันส่งมอบสินค้า = วันที่สร้างรายการขาย
      // Create sale record linked to contract
      if (credit) {
        const snapshot = await credits.claim(tx, { ...creditInput, target: { contractId: contract.id }, cashAmount: cashDown, actorId: salespersonId });
        await tx.contract.update({ where: { id: contract.id }, data: { tradeInCreditSnapshot: snapshot } });
        contract.tradeInCreditSnapshot = snapshot;
      }
      const sale = await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'INSTALLMENT',
          tradeInCreditSnapshot: contract.tradeInCreditSnapshot ?? undefined,
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          sellingPrice: dto.sellingPrice,
          discount,
          netAmount,
          paymentMethod: dto.paymentMethod as PaymentMethod,
          amountReceived: cashDown,
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
      // B5: เครื่องหลุดจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน
      await preemptReservationsInTx(tx, [dto.productId]);

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

    const rawNet = new Decimal(netAmount);
    const rawDown = new Decimal(dto.downPayment ?? 0);
    const rawFinance = dto.financeAmount == null ? rawNet.minus(rawDown) : new Decimal(dto.financeAmount);
    if ([rawNet, rawDown, rawFinance].some(amount => !amount.isFinite() || amount.lt(0))) {
      throw new BadRequestException('ยอดขาย เงินดาวน์ และยอดจัดไฟแนนซ์ต้องเป็นจำนวนเงินที่ไม่ติดลบ');
    }
    // Currency columns and journal templates use satang precision. Normalize
    // browser subtraction (e.g. 10000.1 - 2000.2) before checking the split.
    const net = rawNet.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const down = rawDown.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const financed = rawFinance.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (!net.gt(0) || !down.plus(financed).equals(net)) {
      throw new BadRequestException('เงินดาวน์รวมกับยอดจัดไฟแนนซ์ต้องเท่ากับยอดขายสุทธิ');
    }
    netAmount = net.toNumber();
    const downPayment = down.toNumber();
    const financeAmount = financed.toNumber();

    return this.runSaleTransaction(async (tx) => {
      const mainProduct = await this.verifyProductInStock(tx, dto.productId);
      await this.markBundleProductsSold(tx, dto.bundleProductIds || []);
      const saleNumber = await generateSaleNumber(tx);
      const warranty = await this.resolveSaleShopWarranty(tx, mainProduct, new Date());

      // Tax point (จุดความรับผิดทางภาษี): วันส่งมอบสินค้า = วันที่สร้างรายการขาย
      const sale = await tx.sale.create({
        data: {
          ...warranty,
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
          amountReceived: downPayment,
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
      // B5: เครื่องหลุดจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน
      await preemptReservationsInTx(tx, [dto.productId]);
      await closeRepossessionOnSale(tx, { productId: dto.productId, resellPrice: dto.sellingPrice });

      // ── ลงบัญชีฝั่ง SHOP (C1 — คำวินิจฉัยผู้สอบ 2026-08-25 "แก้ไปข้างหน้า") ────
      // เดิมจุดนี้เป็นแค่ TODO ⇒ ส่งมอบเครื่องจริง รับดาวน์จริง ตั้งลูกหนี้จริง
      // แต่ไม่มีอะไรขึ้นสมุด SHOP เลย (ต่างจากขายสดที่โพสต์ครบตั้งแต่ 2026-06-23)
      //
      // ⛔ template จะ **ข้ามเงียบ ๆ (คืน null)** จนกว่าผังจะมี S11-3101 + S51-1106
      //    ซึ่งยังรอคำวินิจฉัยผู้สอบ (คำถามรอบ 3 ข้อ 3) — ไม่ throw เพราะการขาย
      //    ต้องไม่ล่มเพราะเรื่องผังบัญชี ลูกค้ายืนรออยู่หน้าเคาน์เตอร์
      const extProduct = await tx.product.findUnique({ where: { id: dto.productId } });
      const extBundleProducts = dto.bundleProductIds?.length
        ? await tx.product.findMany({ where: { id: { in: dto.bundleProductIds } } })
        : [];
      if (extProduct) {
        const extCash = await this.shopAccountResolver.resolveInflowCashAccount(
          dto.branchId,
          dto.paymentMethod as PaymentMethod,
          tx,
        );
        const extAcc = this.shopAccountResolver.resolveProductAccounts(extProduct.category);
        await this.shopExternalFinanceSaleTemplate.execute(
          {
            idempotencyKey: `shop-ext-finance-sale:${sale.id}`,
            saleId: sale.id,
            saleNumber,
            productId: dto.productId,
            cashAccountCode: extCash,
            inventoryAccountCode: extAcc.inventoryAccountCode,
            cogsAccountCode: extAcc.cogsAccountCode,
            revenueAccountCode: extAcc.revenueAccountCode,
            downPayment: new Prisma.Decimal(downPayment.toString()),
            financeAmount: new Prisma.Decimal(financeAmount.toString()),
            netAmount: new Prisma.Decimal(netAmount.toString()),
            inventoryCost: new Prisma.Decimal((extProduct.costPrice ?? 0).toString()),
            // ของแถมถูก flip เป็น SOLD_CASH ไปแล้วด้านบน (markBundleProductsSold)
            // แต่ต้นทุนยังค้างในสต็อก ⇒ ต้องส่งมาตัดด้วย ไม่งั้นสินค้าคงเหลือสูงเกินจริง
            // ถาวร · แยกบัญชีต่อชิ้นเพราะหมวดต่างกันได้ (อุปกรณ์เสริม vs เครื่อง)
            bundleCosts: extBundleProducts.map((bp) => {
              const bAcc = this.shopAccountResolver.resolveProductAccounts(bp.category);
              return {
                productId: bp.id,
                cogsAccountCode: bAcc.cogsAccountCode,
                inventoryAccountCode: bAcc.inventoryAccountCode,
                cost: new Prisma.Decimal((bp.costPrice ?? 0).toString()),
              };
            }),
            financeCompany: dto.financeCompany ?? undefined,
          },
          tx,
        );
      }

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
