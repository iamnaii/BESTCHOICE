import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStickerTemplateDto, UpdateStickerTemplateDto } from './dto/sticker.dto';

@Injectable()
export class StickersService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, limit = 50) {
    page = Math.max(1, page);
    limit = Math.min(200, Math.max(1, limit));

    const [data, total] = await Promise.all([
      this.prisma.stickerTemplate.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stickerTemplate.count({ where: { deletedAt: null } }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const template = await this.prisma.stickerTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('ไม่พบ Template สติกเกอร์');
    return template;
  }

  async create(dto: CreateStickerTemplateDto) {
    return this.prisma.stickerTemplate.create({ data: dto as Prisma.StickerTemplateCreateInput });
  }

  async update(id: string, dto: UpdateStickerTemplateDto) {
    await this.findOne(id);
    return this.prisma.stickerTemplate.update({ where: { id }, data: dto as Prisma.StickerTemplateUpdateInput });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.stickerTemplate.update({ where: { id }, data: { isActive: false } });
  }

  async getStickerData(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        branch: { select: { name: true } },
        prices: { where: { isDefault: true }, take: 1 },
        inspection: { select: { overallGrade: true, gradeOverride: true } },
      },
    });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');

    const defaultPrice = product.prices[0];
    const grade = product.inspection?.gradeOverride || product.inspection?.overallGrade;

    return {
      product_code: product.id.slice(0, 8).toUpperCase(),
      brand: product.brand,
      model: product.model,
      imei: product.imeiSerial || '',
      grade: grade || '',
      selling_price: defaultPrice ? Number(defaultPrice.amount) : 0,
      cost_price: Number(product.costPrice),
      branch: product.branch.name,
      date_received: product.createdAt.toISOString().split('T')[0],
      qr_url: `/products/${product.id}`,
    };
  }
}
