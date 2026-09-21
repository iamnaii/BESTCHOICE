import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TradeInCreditService } from '../../trade-in/services/trade-in-credit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSaleDto } from '../dto/sale.dto';
import { InterCompanyService } from '../../inter-company/inter-company.service';
import { DiscountPolicy } from './discount-policy.util';
import { SaleWriterService } from './sale-writer.service';
import { SaleWarrantyNotifierService } from './sale-warranty-notifier.service';
import { assertCustomerHasPhone } from '../../contracts/services/contract-create-policy';
import { PLACEHOLDER_FIELDS_SELECT } from '../../chat-prospects/chat-placeholder';
import {
  assertSameTestSide,
  TEST_SIDE_CUSTOMER_SELECT,
  TEST_SIDE_PRODUCT_SELECT,
} from '../../../utils/test-data-markers';

/**
 * ปลายทางตรวจแล้ว 2026-09-20: เมนูข้าง "สัญญาผ่อนชำระ" / แถบล่างมือถือ "สัญญา" (`/contracts`, menu.ts) มีปุ่ม "สร้างสัญญา"
 * (ContractsPage) → `/contracts/create` และ `POST /contracts` เปิดให้ OWNER / BRANCH_MANAGER / SALES ชุดเดียวกับ
 * `POST /sales` — ใครเจอข้อความนี้ก็ไปต่อได้จริง
 */
export const INSTALLMENT_VIA_CONTRACT_MSG =
  'ขายผ่อนในเครือไม่บันทึกที่หน้าขายแล้ว — ไปที่เมนู "สัญญาผ่อนชำระ" (บนมือถือชื่อ "สัญญา") แล้วกดปุ่ม "สร้างสัญญา" เมื่อเปิดใช้สัญญา ระบบจะตัดสต๊อกและออกใบขายให้เอง';

/**
 * Sale-creation orchestrator extracted from SalesService.create.
 *
 * Owns the pre-tx validation (loyalty pre-validation, wasPreviouslyDamaged
 * pre-check, costPrice lookup, discount policy assertion), the saleType switch
 * dispatch to the per-type writers, and the post-commit best-effort loyalty
 * redemption $transaction (with the stamped `_loyaltyRedemptionFailed` flag).
 *
 * Body is verbatim from the original SalesService.create — only `this.<dep>`
 * resolution changed (discount → DiscountPolicy, create*Sale → writer).
 */
export class SaleCreationService {
  private readonly logger = new Logger(SaleCreationService.name);

  constructor(
    private prisma: PrismaService,
    private writer: SaleWriterService,
    private interCompanyService: InterCompanyService,
    private warrantyNotifier: SaleWarrantyNotifierService,
  ) {}

  async create(dto: CreateSaleDto, salespersonId: string, userRole = 'SALES', userBranchId?: string | null) {
    // ขายผ่อนในเครือทำผ่านหน้าสัญญาทางเดียว (2026-09-20) — เปิดใช้สัญญาแล้ว ContractWorkflowService.activate ตัดสต๊อก
    // + ออกใบขาย INSTALLMENT + ตั้งค่าคอมให้เอง. ปฏิเสธก่อนแตะแต้ม/เครดิตเทิร์น/ส่วนลด/ฐานข้อมูลใด ๆ
    if (dto.saleType === 'INSTALLMENT') throw new BadRequestException(INSTALLMENT_VIA_CONTRACT_MSG);
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

    if (dto.tradeInCreditId && dto.saleType === 'EXTERNAL_FINANCE') throw new BadRequestException('เครดิตเทิร์นยังไม่รองรับไฟแนนซ์ภายนอก');
    const tradeCredit = dto.tradeInCreditId ? await new TradeInCreditService(this.prisma).quote(this.prisma, {
      ...dto, tradeInId: dto.tradeInCreditId, priceAfterDiscount: new Prisma.Decimal(dto.sellingPrice).minus(baseDiscount).minus(loyaltyPoints).toNumber(),
    }) : null;
    const discount = new Prisma.Decimal(baseDiscount).plus(loyaltyPoints).plus(tradeCredit?.bonus ?? 0).toNumber();
    const netAmount = new Prisma.Decimal(dto.sellingPrice).minus(discount).toNumber();

    // test-data fence (spec 2026-09-05 §5.1): เครื่องทุกชิ้นในใบกับลูกค้าต้องอยู่ฝั่งเดียวกัน
    // — ตรวจก่อนแตะ tx ใด ๆ; ของแถมผิดฝั่งก็ต้องดัง
    await this.assertSameTestSideForSale(dto);

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

    DiscountPolicy.assertDiscountAllowed(
      dto.sellingPrice,
      discount,
      userRole,
      costPrice,
      dto.secondApproverId,
    );

    let sale: { id: string; contractId?: string | null };
    switch (dto.saleType) {
      case 'CASH':
        sale = await this.writer.createCashSale(dto, salespersonId, netAmount, discount, { role: userRole, branchId: userBranchId });
        break;
      case 'EXTERNAL_FINANCE':
        sale = await this.writer.createExternalFinanceSale(dto, salespersonId, netAmount, discount, { role: userRole, branchId: userBranchId });
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

    // แจ้งประกันทาง LINE OA ร้าน — fire-and-forget **หลัง** tx ของการขาย commit แล้ว
    // (pattern เดียวกับใบลดหนี้). ห้าม await: LINE ช้า/ล่ม ต้องไม่ทำให้หน้า POS ค้าง
    // และ notifier ไม่ throw ออกมาอยู่แล้ว — `.catch` เป็นตาข่ายชั้นสุดท้ายเผื่อ throw
    // แบบ synchronous ก่อนเข้า try ข้างใน. ขาผ่อน (INSTALLMENT) ไม่เข้าเพราะประกัน
    // ผูกกับสัญญาและมีเส้นทางแจ้งของตัวเอง
    if (dto.saleType === 'CASH' || dto.saleType === 'EXTERNAL_FINANCE') {
      void this.warrantyNotifier
        .notify(sale.id)
        .catch((err) => this.logger.error(`[warranty-line] notify ไม่ถูกเรียก: ${String(err)}`));
    }

    return sale;
  }

  /**
   * รั้วกันข้ามฝั่ง — โหลดลูกค้า + เครื่องหลัก + ของแถม ด้วย select ขั้นต่ำ (รวม po.poNumber
   * ที่ชนิดของ isTestProduct บังคับ) แล้วให้ util ตัดสิน. ไม่พบลูกค้า = NotFound ข้อความเดิม
   * ของโมดูลนี้ (writer จะโยนแบบเดียวกันอยู่แล้ว แต่รั้วต้องอ่านลูกค้าก่อน writer)
   *
   * ด่านเบอร์ (spec 2026-09-13-chat-prospects) อยู่ที่นี่เพราะ `create()` เรียกก่อน writer ทุกประเภท
   * (CASH / INSTALLMENT / EXTERNAL_FINANCE) — writer เงินสด/ไฟแนนซ์นอกไม่โหลดลูกค้าเลย ⇒ ตรวจเบอร์
   * ก่อนดูรายการเครื่อง ไม่ให้ใบที่ไม่มีรหัสสินค้าหลุดด่าน
   */
  private async assertSameTestSideForSale(dto: CreateSaleDto): Promise<void> {
    const productIds = [dto.productId, ...(dto.bundleProductIds ?? [])].filter(
      (id): id is string => !!id,
    );
    const [customer, products] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, deletedAt: null },
        // PLACEHOLDER_FIELDS_SELECT — ด่านเบอร์แยกข้อความผู้สนใจ/ลูกค้าทั่วไป (A12)
        select: { ...TEST_SIDE_CUSTOMER_SELECT, ...PLACEHOLDER_FIELDS_SELECT },
      }),
      productIds.length === 0
        ? Promise.resolve([])
        : this.prisma.product.findMany({
            where: { id: { in: productIds }, deletedAt: null },
            select: TEST_SIDE_PRODUCT_SELECT,
          }),
    ]);
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    assertCustomerHasPhone(customer, 'เปิดใบขาย');
    for (const product of products) assertSameTestSide(customer, product);
  }
}
