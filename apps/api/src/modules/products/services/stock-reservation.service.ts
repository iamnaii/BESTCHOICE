import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class StockReservationService {
  constructor(private prisma: PrismaService) {}

  // === Stock Reservation ===

  /**
   * Reserve a product (link to contract/sale in progress)
   */
  async reserve(productId: string, _reason?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        prices: { orderBy: { createdAt: 'asc' as const } },
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        po: { select: { id: true, poNumber: true } },
        inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
        productPhotos: { select: { id: true, isCompleted: true } },
      },
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
    if (product.status !== 'IN_STOCK') {
      throw new BadRequestException('สามารถจองได้เฉพาะสินค้าที่อยู่ IN_STOCK เท่านั้น');
    }
    return this.prisma.product.update({
      where: { id: productId },
      data: { status: 'RESERVED' },
      include: {
        prices: { orderBy: { createdAt: 'asc' as const } },
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        po: { select: { id: true, poNumber: true } },
        inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
        productPhotos: { select: { id: true, isCompleted: true } },
      },
    });
  }

  /**
   * Unreserve a product (release back to IN_STOCK)
   */
  async unreserve(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        prices: { orderBy: { createdAt: 'asc' as const } },
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        po: { select: { id: true, poNumber: true } },
        inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
        productPhotos: { select: { id: true, isCompleted: true } },
      },
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
    if (product.status !== 'RESERVED') {
      throw new BadRequestException('สินค้านี้ไม่ได้อยู่ในสถานะ RESERVED');
    }
    return this.prisma.product.update({
      where: { id: productId },
      data: { status: 'IN_STOCK' },
      include: {
        prices: { orderBy: { createdAt: 'asc' as const } },
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        po: { select: { id: true, poNumber: true } },
        inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
        productPhotos: { select: { id: true, isCompleted: true } },
      },
    });
  }
}
