import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

const PRODUCT_INCLUDE = {
  prices: { orderBy: { createdAt: 'asc' as const } },
  supplier: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  po: { select: { id: true, poNumber: true } },
  inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
  productPhotos: { select: { id: true, isCompleted: true } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class StockReservationService {
  constructor(private prisma: PrismaService) {}

  // === Stock Reservation ===

  /**
   * Reserve a product (link to contract/sale in progress)
   *
   * จอง/ปลดจองเป็น compare-and-swap ใน statement เดียว (updateMany + เงื่อนไข status)
   * — เดิมเป็น read-check-write แยกกัน สองคนกดจองเครื่องเดียวกันพร้อมกันผ่านได้ทั้งคู่
   * count = 0 แปลว่าแพ้การแข่ง/สถานะไม่ใช่ แล้วค่อยแยกสาเหตุเพื่อคงข้อความ error เดิม
   */
  async reserve(productId: string, _reason?: string) {
    const claimed = await this.prisma.product.updateMany({
      where: { id: productId, deletedAt: null, status: 'IN_STOCK' },
      data: { status: 'RESERVED' },
    });
    if (claimed.count === 0) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { deletedAt: true },
      });
      if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
      throw new BadRequestException('สามารถจองได้เฉพาะสินค้าที่อยู่ IN_STOCK เท่านั้น');
    }
    return this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: PRODUCT_INCLUDE,
    });
  }

  /**
   * Unreserve a product (release back to IN_STOCK)
   */
  async unreserve(productId: string) {
    // PR 2: เครื่องที่ใบจองล็อกไว้ปลดได้ทางเดียวคือยกเลิกใบ/หมดอายุ (bookings.service) — ปุ่มปลดจองทั่วไปห้ามแย่ง
    const lockedBy = await this.prisma.booking.findFirst({
      where: { lockedProductId: productId, status: 'PAID', deletedAt: null },
      select: { id: true, bookingNumber: true },
    });
    if (lockedBy) {
      throw new ConflictException(
        `เครื่องนี้ถูกล็อกโดยใบจอง ${lockedBy.bookingNumber} — ยกเลิกใบจองก่อน (หรือรอให้หมดอายุ) แล้วเครื่องจะกลับมาพร้อมขายเอง`,
      );
    }
    const released = await this.prisma.product.updateMany({
      where: { id: productId, deletedAt: null, status: 'RESERVED' },
      data: { status: 'IN_STOCK' },
    });
    if (released.count === 0) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { deletedAt: true },
      });
      if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
      throw new BadRequestException('สินค้านี้ไม่ได้อยู่ในสถานะ RESERVED');
    }
    return this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: PRODUCT_INCLUDE,
    });
  }
}
