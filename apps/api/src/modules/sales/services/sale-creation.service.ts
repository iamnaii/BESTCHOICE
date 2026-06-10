import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSaleDto } from '../dto/sale.dto';
import { InterCompanyService } from '../../inter-company/inter-company.service';
import { DiscountPolicy } from './discount-policy.util';
import { SaleWriterService } from './sale-writer.service';

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
  constructor(
    private prisma: PrismaService,
    private writer: SaleWriterService,
    private interCompanyService: InterCompanyService,
  ) {}

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
        sale = await this.writer.createCashSale(dto, salespersonId, netAmount, discount);
        break;
      case 'INSTALLMENT':
        sale = await this.writer.createInstallmentSale(dto, salespersonId, netAmount, discount);
        break;
      case 'EXTERNAL_FINANCE':
        sale = await this.writer.createExternalFinanceSale(dto, salespersonId, netAmount, discount);
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
}
