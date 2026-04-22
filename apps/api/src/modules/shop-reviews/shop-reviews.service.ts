import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ShopReviewsService {
  constructor(private prisma: PrismaService) {}

  async listPublic(productId: string) {
    return this.prisma.review.findMany({
      where: { productId, status: 'PUBLISHED', deletedAt: null },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async summary(productId: string) {
    const rows = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { productId, status: 'PUBLISHED', deletedAt: null },
      _count: { _all: true },
    });
    const byRating = rows.map((r) => ({ rating: r.rating, count: r._count._all }));
    const total = byRating.reduce((acc, r) => acc + r.count, 0);
    const sum = byRating.reduce((acc, r) => acc + r.rating * r.count, 0);
    const average = total ? Math.round((sum / total) * 10) / 10 : 0;
    return { total, average, byRating };
  }

  async create(dto: CreateReviewDto, customerId: string) {
    const dup = await this.prisma.review.findUnique({
      where: { productId_customerId: { productId: dto.productId, customerId } },
    });
    if (dup) {
      throw new BadRequestException('คุณรีวิวสินค้านี้ไปแล้ว');
    }

    // Verified-purchase gate: customer must have a non-deleted Sale for this product
    const verified = await this.prisma.sale.findFirst({
      where: {
        customerId,
        productId: dto.productId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!verified) {
      throw new ForbiddenException('รีวิวได้เฉพาะสินค้าที่คุณเคยซื้อ');
    }

    return this.prisma.review.create({
      data: {
        productId: dto.productId,
        customerId,
        rating: dto.rating,
        title: dto.title,
        comment: dto.comment,
        verified: true,
        verifiedSource: verified.id,
        status: 'PUBLISHED',
      },
    });
  }

  async moderate(
    id: string,
    status: 'HIDDEN' | 'PUBLISHED',
    reason: string | undefined,
    moderatorId: string,
  ) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review || review.deletedAt) {
      throw new NotFoundException('ไม่พบรีวิว');
    }
    return this.prisma.review.update({
      where: { id },
      data: {
        status: status as ReviewStatus,
        hiddenReason: status === 'HIDDEN' ? reason ?? null : null,
        moderatedById: moderatorId,
        moderatedAt: new Date(),
      },
    });
  }

  async adminList(productId?: string, status?: string) {
    return this.prisma.review.findMany({
      where: {
        deletedAt: null,
        ...(productId ? { productId } : {}),
        ...(status ? { status: status as ReviewStatus } : {}),
      },
      include: {
        customer: { select: { name: true, phone: true } },
        product: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
