import { prepareLoyaltySale, recordLoyaltySale } from '../../loyalty/loyalty-sale-proof';
import { preparePromotionBenefit, recordPromotionBenefit } from '../../promotions/promotion-benefit';
import { currentDomainAccess, domainAccessClient, onDomainCommit } from '../../employee-access/access-execution-context';
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
 * Owns sale validation and dispatch to the canonical per-type writers.
 * Managed loyalty proof, debit and required audit join the owned Sale transaction;
 * the unmigrated path retains its original best-effort redemption behavior.
 */
export class SaleCreationService {
  private readonly logger = new Logger(SaleCreationService.name);

  private get prisma(): PrismaService { return domainAccessClient(this.basePrisma); }

  constructor(
    private readonly basePrisma: PrismaService,
    private writer: SaleWriterService,
    private interCompanyService: InterCompanyService,
    private warrantyNotifier: SaleWarrantyNotifierService,
  ) {}

  async create(dto: CreateSaleDto, salespersonId: string, userRole = 'SALES', userBranchId?: string | null) {
    // ขายผ่อนในเครือทำผ่านหน้าสัญญาทางเดียว (2026-09-20) — เปิดใช้สัญญาแล้ว ContractWorkflowService.activate ตัดสต๊อก
    // + ออกใบขาย INSTALLMENT + ตั้งค่าคอมให้เอง. ปฏิเสธก่อนแตะแต้ม/เครดิตเทิร์น/ส่วนลด/ฐานข้อมูลใด ๆ
    if (dto.saleType === 'INSTALLMENT') throw new BadRequestException(INSTALLMENT_VIA_CONTRACT_MSG);
    const managed = currentDomainAccess();
    if (!managed && (dto.loyaltyPointsRedeemed ?? 0) !== 0) {
      const actor = await this.basePrisma.user.findUnique({
        where: { id: salespersonId },
        select: { accessManaged: true, isActive: true, deletedAt: true },
      });
      if (!actor || actor.accessManaged || !actor.isActive || actor.deletedAt)
        throw new ForbiddenException('ต้องตรวจสิทธิ์บัญชีแต้มในธุรกรรมการขายปัจจุบัน');
    }
    if (managed) {
      const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: managed.snapshot.userId } });
      userRole = managed.snapshot.isOwner ? 'OWNER' : actor.role;
    }
    const baseDiscount = dto.discount || 0;
    if (managed && baseDiscount > 0) {
      if (!managed.snapshot.isOwner) throw new ForbiddenException('ส่วนลดนอกโปรต้องได้รับอนุมัติจากเจ้าของ');
      if (typeof dto.discountReason !== 'string' || dto.discountReason.trim().length < 3 || dto.discountReason.trim().length > 500) throw new BadRequestException('กรุณาระบุเหตุผลส่วนลด 3–500 ตัวอักษร');
    }

    const promotion = await preparePromotionBenefit(dto, salespersonId);
    const promotionDiscount = promotion?.discount ?? new Prisma.Decimal(0);

    // One point remains one baht. Managed account authority, sources, balance
    // and daily cap are checked under the outer transaction's current locks;
    // the canonical writer's money and subsequent typed debit commit together.
    const loyaltyPoints = dto.loyaltyPointsRedeemed ?? 0;
    if (managed) await prepareLoyaltySale(dto, salespersonId);
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
      if (loyaltyPoints > new Prisma.Decimal(dto.sellingPrice).minus(baseDiscount).minus(promotionDiscount).toNumber()) {
        throw new BadRequestException(
          'จำนวนแต้มที่แลกเกินยอดสุทธิ — ลดจำนวนแต้มให้ไม่เกินยอดคงเหลือ',
        );
      }
    }

    if (dto.tradeInCreditId && dto.saleType === 'EXTERNAL_FINANCE') throw new BadRequestException('เครดิตเทิร์นยังไม่รองรับไฟแนนซ์ภายนอก');
    const tradeCredit = dto.tradeInCreditId ? await new TradeInCreditService(this.prisma).quote(this.prisma, {
      ...dto, tradeInId: dto.tradeInCreditId, priceAfterDiscount: new Prisma.Decimal(dto.sellingPrice).minus(baseDiscount).minus(promotionDiscount).minus(loyaltyPoints).toNumber(),
    }) : null;
    const discount = new Prisma.Decimal(baseDiscount).plus(promotionDiscount).plus(loyaltyPoints).plus(tradeCredit?.bonus ?? 0).toNumber();
    const netAmount = new Prisma.Decimal(dto.sellingPrice).minus(discount).toNumber();

    if (promotion && new Prisma.Decimal(netAmount).lt(0)) throw new BadRequestException('ยอดสุทธิต้องไม่ติดลบ');

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
      promotion ? new Prisma.Decimal(discount).minus(promotionDiscount).toNumber() : discount,
      userRole,
      costPrice,
      dto.secondApproverId,
    );

    let sale: { id: string; contractId?: string | null };
    switch (dto.saleType) {
      case 'CASH':
        sale = await this.writer.createCashSale(dto, salespersonId, netAmount, discount, { role: userRole, branchId: userBranchId }, ...(promotion ? [promotionDiscount] as const : [] as const));
        break;
      case 'EXTERNAL_FINANCE':
        sale = await this.writer.createExternalFinanceSale(dto, salespersonId, netAmount, discount, { role: userRole, branchId: userBranchId });
        break;
      default:
        throw new BadRequestException('ประเภทการขายไม่ถูกต้อง');
    }

    if (promotion) await recordPromotionBenefit(dto, sale.id, promotion);

    if (managed && baseDiscount > 0) {
      await managed.client.auditLog.create({ data: {
        userId: managed.snapshot.userId, action: 'SALE_DISCOUNT_OWNER_APPROVED', entity: 'sale', entityId: sale.id,
        newValue: { requesterId: managed.snapshot.userId, approverId: managed.snapshot.userId, saleId: sale.id,
          reason: dto.discountReason!.trim(), sellingPrice: String(dto.sellingPrice), baseDiscount: String(baseDiscount), totalDiscount: String(discount), netAmount: String(netAmount) },
      } });
    }

    // Managed proof/debit/audit join the outer Sale transaction. Only the
    // original unmigrated compatibility path retains best-effort behavior.
    let loyaltyProof: Awaited<ReturnType<typeof recordLoyaltySale>> | undefined;
    if (managed && loyaltyPoints > 0) {
      loyaltyProof = await recordLoyaltySale(dto, sale.id, {
        baseDiscount, promotionDiscount, tradeBonus: tradeCredit?.bonus ?? 0,
      });
    } else if (loyaltyPoints > 0) {
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
          await tx.customer.update({ where: { id: dto.customerId }, data: { loyaltyBalance: { decrement: loyaltyPoints } } });
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
      if (managed) onDomainCommit(() => this.warrantyNotifier.notify(sale.id));
      else void this.warrantyNotifier.notify(sale.id).catch((err) => this.logger.error(`[warranty-line] notify ไม่ถูกเรียก: ${String(err)}`));
    }

    return loyaltyProof ? { ...sale, loyaltyRedemption: loyaltyProof } : sale;
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
