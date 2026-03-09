import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductPriceDto, UpdateProductPriceDto } from './dto/product-price.dto';

@Injectable()
export class ProductsPricingService {
  private readonly logger = new Logger(ProductsPricingService.name);

  constructor(private prisma: PrismaService) {}

  async addPrice(productId: string, dto: CreateProductPriceDto) {
    // Verify product exists
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

    return this.prisma.$transaction(async (tx) => {
      // If new price is default, unset other defaults
      if (dto.isDefault) {
        await tx.productPrice.updateMany({
          where: { productId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.productPrice.create({
        data: {
          productId,
          label: dto.label,
          amount: dto.amount,
          isDefault: dto.isDefault ?? false,
        },
      });
    });
  }

  async updatePrice(productId: string, priceId: string, dto: UpdateProductPriceDto) {
    return this.prisma.$transaction(async (tx) => {
      const price = await tx.productPrice.findFirst({
        where: { id: priceId, productId },
      });
      if (!price) throw new NotFoundException('ไม่พบราคาขาย');

      // If updating to default, unset other defaults
      if (dto.isDefault) {
        await tx.productPrice.updateMany({
          where: { productId, isDefault: true, id: { not: priceId } },
          data: { isDefault: false },
        });
      }

      return tx.productPrice.update({
        where: { id: priceId },
        data: dto,
      });
    });
  }

  async removePrice(productId: string, priceId: string) {
    return this.prisma.$transaction(async (tx) => {
      const price = await tx.productPrice.findFirst({
        where: { id: priceId, productId },
      });
      if (!price) throw new NotFoundException('ไม่พบราคาขาย');

      // Check at least 1 price remains
      const count = await tx.productPrice.count({ where: { productId } });
      if (count <= 1) {
        throw new BadRequestException('ต้องมีอย่างน้อย 1 ราคาขาย');
      }

      await tx.productPrice.delete({ where: { id: priceId } });

      // If deleted price was default, set first remaining as default
      if (price.isDefault) {
        const first = await tx.productPrice.findFirst({
          where: { productId },
          orderBy: { createdAt: 'asc' },
        });
        if (first) {
          await tx.productPrice.update({
            where: { id: first.id },
            data: { isDefault: true },
          });
        }
      }

      return { message: 'ลบราคาขายสำเร็จ' };
    });
  }
}
