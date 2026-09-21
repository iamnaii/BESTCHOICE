import { isRetryablePrismaWriteError } from '../../../utils/transaction-retry.util';
import { ShopTenderRecorder } from '../../shop-tenders/shop-tender.recorder';
import { firstTransferReference, normalizeTenders } from '../../shop-tenders/shop-tender.util';
import { assertSaleProductEligible, type SaleProductActor } from './sale-product-policy';
import { assertBundleIsAccessory } from './bundle-policy';
import { TradeInCreditService } from '../../trade-in/services/trade-in-credit.service';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { captureProductDisclosure } from '../../../utils/product-disclosure.util';
import { readStringFlag } from '../../../utils/config.util';
import { closeRepossessionOnSale } from '../../repossessions/repossession-resale.util';
import { PaymentMethod, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSaleDto } from '../dto/sale.dto';
import { computeCommissionAmount } from '../../../utils/commission.util';
import { generateSaleNumber } from '../../../utils/sequence.util';
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
 * Each writer uses Serializable isolation and retries a complete transaction on
 * conflicts. Product eligibility and stock transitions stay in that transaction.
 */
@Injectable()
export class SaleWriterService {
  constructor(
    private prisma: PrismaService,
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
   * Stock/reservation conflicts may raise P2034. Unique document-number conflicts
   * may raise P2002. Retrying the entire transaction revalidates stock and rolls
   * back its money, document and reservation changes together. Other errors pass
   * through immediately.
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
        const isRetryable = isRetryablePrismaWriteError(err);
        if (isRetryable && attempt < MAX_RETRIES - 1) {
          continue;
        }
        if (isRetryable && prismaErr?.code !== 'P2002') {
          throw new ConflictException('มีรายการอื่นเปลี่ยนข้อมูลพร้อมกัน กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง');
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
    branchId: string,
    actor: SaleProductActor,
    acknowledged = false,
  ) {
    const product = await tx.product.findUnique({ where: { id: productId }, include: { po: { select: { poNumber: true } } } });
    if (!product) throw new BadRequestException('สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว');
    assertSaleProductEligible(product, branchId, actor, acknowledged);
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
    product: { category: string; shopWarrantyDays: number | null; deviceOrigin?: import('@prisma/client').DeviceOrigin | null; warrantyTerms?: string | null },
    soldAt: Date,
  ): Promise<{ shopWarrantyStartDate?: Date; shopWarrantyEndDate?: Date; productDisclosure: ReturnType<typeof captureProductDisclosure> }> {
    const defaultDays = await readStringFlag(tx, SHOP_WARRANTY_DAYS_CONFIG_KEY, '');
    const days = resolveShopWarrantyDays(product, defaultDays);
    const productDisclosure = captureProductDisclosure(product, defaultDays);
    if (days === null) return { productDisclosure };
    return { productDisclosure, shopWarrantyStartDate: soldAt, shopWarrantyEndDate: addDays(soldAt, days) };
  }

  /** Mark bundle (freebie) products as SOLD_CASH */
  private async markBundleProductsSold(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    bundleProductIds: string[],
    branchId: string,
    actor: SaleProductActor,
    acknowledged = false,
  ) {
    if (!bundleProductIds.length) return;
    // Verify all bundle products are IN_STOCK
    const products = await tx.product.findMany({
      where: { id: { in: bundleProductIds }, deletedAt: null },
      select: { id: true, status: true, name: true, branchId: true, deletedAt: true, wasPreviouslyDamaged: true, category: true },
    });
    for (const p of products) {
      assertSaleProductEligible(p, branchId, actor, acknowledged);
    }
    if (products.length !== bundleProductIds.length) {
      throw new BadRequestException('ไม่พบสินค้าของแถมบางรายการ');
    }
    assertBundleIsAccessory(products);
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

  async createCashSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number, actor: SaleProductActor = { role: 'SALES' }) {
    if (!dto.paymentMethod) throw new BadRequestException('กรุณาเลือกวิธีชำระเงิน');

    return this.runSaleTransaction(async (tx) => {
      const credits = new TradeInCreditService(this.prisma);
      const creditInput = { ...dto, tradeInId: dto.tradeInCreditId!, priceAfterDiscount: new Decimal(dto.sellingPrice).minus(dto.discount ?? 0).minus(dto.loyaltyPointsRedeemed ?? 0).toNumber() };
      const credit = dto.tradeInCreditId ? await credits.quote(tx, creditInput) : null;
      if (credit && !credit.net.eq(netAmount)) throw new BadRequestException('ราคาหลังโบนัสเทิร์นเปลี่ยนแล้ว กรุณาตรวจยอดอีกครั้ง');
      const cashDue = new Decimal(netAmount).minus(credit?.base ?? 0);
      if (credit && new Decimal(dto.amountReceived ?? cashDue).lt(cashDue)) throw new BadRequestException('ยอดเงินที่รับยังไม่ครบ');
      // ช่องรับเงิน: บิลเดียวจ่ายผสมได้ โอน/QR บังคับเลขอ้างอิง — tender แรก = primary ที่ JE ขายลงเต็มยอด
      const tenders = normalizeTenders(dto.tenders, cashDue, { method: dto.paymentMethod, reference: dto.downPaymentReference });
      const primaryMethod = (tenders[0]?.method ?? dto.paymentMethod) as PaymentMethod;
      const mainProduct = await this.verifyProductInStock(tx, dto.productId, dto.branchId, actor, dto.previouslyDamagedAcknowledged);
      await this.markBundleProductsSold(tx, dto.bundleProductIds || [], dto.branchId, actor, dto.previouslyDamagedAcknowledged);
      const saleNumber = await generateSaleNumber(tx);
      const warranty = await this.resolveSaleShopWarranty(tx, mainProduct, new Date());

      // Tax point (จุดความรับผิดทางภาษี): วันส่งมอบสินค้า = วันที่สร้างรายการขาย
      const sale = await tx.sale.create({
        data: {
          ...warranty,
          costSnapshot: { create: { mainProductCost: mainProduct.costPrice } },
          saleNumber,
          saleType: 'CASH',
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          sellingPrice: dto.sellingPrice,
          discount,
          netAmount,
          paymentMethod: primaryMethod,
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
        primaryMethod,
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

      // สมุดเงินหน้าร้าน + JE แยกยอดของบิลจ่ายผสม (ผู้รับเงิน = ผู้ใช้ที่บันทึกใบขาย)
      await new ShopTenderRecorder(this.prisma, { accounts: this.shopAccountResolver }).recordInflow(tx, {
        kind: 'CASH_SALE', branchId: dto.branchId, actorId: salespersonId, doc: { saleId: sale.id }, docNumber: saleNumber, tenders,
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

  async createExternalFinanceSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number, actor: SaleProductActor = { role: 'SALES' }) {
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
    // ช่องรับเงินของเงินดาวน์ไฟแนนซ์นอก (ดาวน์ 0 = ไม่มีบรรทัด) — tender แรก = primary ที่ JE ขายลงเต็มยอดดาวน์
    const extTenders = normalizeTenders(dto.tenders, down, { method: dto.paymentMethod, reference: dto.downPaymentReference });
    const extPrimaryMethod = (extTenders[0]?.method ?? dto.paymentMethod) as PaymentMethod;

    return this.runSaleTransaction(async (tx) => {
      const mainProduct = await this.verifyProductInStock(tx, dto.productId, dto.branchId, actor, dto.previouslyDamagedAcknowledged);
      await this.markBundleProductsSold(tx, dto.bundleProductIds || [], dto.branchId, actor, dto.previouslyDamagedAcknowledged);
      const saleNumber = await generateSaleNumber(tx);
      const warranty = await this.resolveSaleShopWarranty(tx, mainProduct, new Date());

      // Tax point (จุดความรับผิดทางภาษี): วันส่งมอบสินค้า = วันที่สร้างรายการขาย
      const sale = await tx.sale.create({
        data: {
          ...warranty,
          costSnapshot: { create: { mainProductCost: mainProduct.costPrice } },
          saleNumber,
          saleType: 'EXTERNAL_FINANCE',
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          sellingPrice: dto.sellingPrice,
          discount,
          netAmount,
          paymentMethod: extPrimaryMethod,
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
      let extSaleJe: Awaited<ReturnType<ShopExternalFinanceSaleTemplate['execute']>> = null;
      const extProduct = await tx.product.findUnique({ where: { id: dto.productId } });
      const extBundleProducts = dto.bundleProductIds?.length
        ? await tx.product.findMany({ where: { id: { in: dto.bundleProductIds } } })
        : [];
      if (extProduct) {
        const extCash = await this.shopAccountResolver.resolveInflowCashAccount(
          dto.branchId,
          extPrimaryMethod,
          tx,
        );
        const extAcc = this.shopAccountResolver.resolveProductAccounts(extProduct.category);
        extSaleJe = await this.shopExternalFinanceSaleTemplate.execute(
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

      // สมุดเงินหน้าร้านบันทึกเสมอ (เงินรับจริง) — JE แยกยอดโพสต์เฉพาะเมื่อ JE ขายถูกโพสต์
      // (template คืน null เมื่อบัญชีไฟแนนซ์นอกยังไม่พร้อม: ห้ามย้ายเงินที่ยังไม่เคยลงบัญชี)
      await new ShopTenderRecorder(this.prisma, { accounts: this.shopAccountResolver }).recordInflow(tx, {
        kind: 'EXTERNAL_FINANCE_DOWN', branchId: dto.branchId, actorId: salespersonId, doc: { saleId: sale.id }, docNumber: saleNumber,
        tenders: extTenders, postSplitJe: extSaleJe != null,
      });

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
