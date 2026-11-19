import { domainAccessClient } from '../employee-access/access-execution-context';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FINANCE_LABEL } from '../../utils/product-price-sync.util';
import { CreateProductPriceDto, UpdateProductPriceDto } from './dto/product-price.dto';

const FINANCE_DEFAULT_MESSAGE =
  'แถว "ราคาผ่อนไฟแนนซ์" ตั้งเป็นราคาค่าเริ่มต้นไม่ได้ — เป็นสำเนาของราคาขาย GFIN ไม่ใช่ราคาที่ POS ขาย';

@Injectable()
export class ProductsPricingService {
  private get prisma(): PrismaService { return domainAccessClient(this.basePrisma); }
  private readonly logger = new Logger(ProductsPricingService.name);

  constructor(private readonly basePrisma: PrismaService) {}

  async addPrice(productId: string, dto: CreateProductPriceDto) {
    // Verify product exists
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

    if (dto.isDefault && dto.label.trim() === FINANCE_LABEL) {
      throw new BadRequestException(FINANCE_DEFAULT_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) => {
      // If new price is default, unset other defaults
      if (dto.isDefault) {
        await tx.productPrice.updateMany({
          where: { productId, isDefault: true, deletedAt: null },
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
        where: { id: priceId, productId, deletedAt: null },
      });
      if (!price) throw new NotFoundException('ไม่พบราคาขาย');

      const finalLabel = (dto.label ?? price.label ?? '').trim();
      // ผลลัพธ์เป็นแถวไฟแนนซ์ที่เป็นค่าเริ่มต้น และเป็นการ "ทำให้เป็น" ตอนนี้ (ตั้งค่าเริ่มต้น หรือเปลี่ยนชื่อมา)
      // — แถว legacy ที่เป็นค่าเริ่มต้นอยู่แล้วยังแก้ตัวเลข/ปลดค่าเริ่มต้นได้
      const becomesFinance = finalLabel === FINANCE_LABEL && (price.label ?? '').trim() !== FINANCE_LABEL;
      if ((dto.isDefault ?? price.isDefault) && finalLabel === FINANCE_LABEL && (dto.isDefault === true || becomesFinance)) {
        throw new BadRequestException(FINANCE_DEFAULT_MESSAGE);
      }

      // If updating to default, unset other defaults
      if (dto.isDefault) {
        await tx.productPrice.updateMany({
          where: { productId, isDefault: true, id: { not: priceId }, deletedAt: null },
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
        where: { id: priceId, productId, deletedAt: null },
      });
      if (!price) throw new NotFoundException('ไม่พบราคาขาย');

      // Check at least 1 price remains
      const count = await tx.productPrice.count({ where: { productId, deletedAt: null } });
      if (count <= 1) {
        throw new BadRequestException('ต้องมีอย่างน้อย 1 ราคาขาย');
      }

      await tx.productPrice.update({
        where: { id: priceId },
        data: { deletedAt: new Date() },
      });

      // If deleted price was default, set first remaining as default
      if (price.isDefault) {
        const first = await tx.productPrice.findFirst({
          where: { productId, deletedAt: null },
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
