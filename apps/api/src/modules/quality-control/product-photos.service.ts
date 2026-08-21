import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
type Angle = typeof ANGLES[number];

import {
  assertSellableOnEnterStock,
  enterStockAuditData,
} from '../products/product-enter-stock.util';

const ALLOWED_UPLOAD_STATUSES = ['PHOTO_PENDING', 'IN_STOCK', 'RESERVED'];

@Injectable()
export class ProductPhotosService {
  constructor(private prisma: PrismaService) {}

  async getPhotos(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, category: true, productPhotos: true },
    });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');

    // รูปถ่าย 6 มุมเฉพาะมือสอง
    if (product.category !== 'PHONE_USED') {
      return { productId, applicable: false };
    }

    if (!product.productPhotos) {
      return {
        productId,
        photos: { front: null, back: null, left: null, right: null, top: null, bottom: null },
        isCompleted: false,
        completedCount: 0,
        totalCount: 6,
      };
    }

    const pp = product.productPhotos;
    const completedCount = ANGLES.filter((a) => pp[a] !== null).length;

    return {
      productId,
      photos: {
        front: pp.front,
        back: pp.back,
        left: pp.left,
        right: pp.right,
        top: pp.top,
        bottom: pp.bottom,
      },
      isCompleted: pp.isCompleted,
      completedCount,
      totalCount: 6,
    };
  }

  async uploadPhoto(productId: string, angle: string, photo: string, userId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, category: true, deletedAt: true },
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

    if (product.category !== 'PHONE_USED') {
      throw new BadRequestException('ถ่ายรูป 6 มุมเฉพาะสินค้ามือสองเท่านั้น');
    }

    if (!ALLOWED_UPLOAD_STATUSES.includes(product.status)) {
      throw new BadRequestException(`ไม่สามารถอัปโหลดรูปในสถานะ ${product.status} ได้`);
    }

    if (!ANGLES.includes(angle as Angle)) {
      throw new BadRequestException('angle ไม่ถูกต้อง');
    }

    // Use upsert to avoid race condition between concurrent uploads
    const pp = await this.prisma.productPhoto.upsert({
      where: { productId },
      create: { productId, [angle]: photo, uploadedById: userId },
      update: { [angle]: photo, uploadedById: userId },
    });

    return {
      productId,
      angle,
      uploaded: true,
      completedCount: ANGLES.filter((a) => pp[a] !== null).length,
      totalCount: 6,
    };
  }

  async deletePhoto(productId: string, angle: string) {
    // Validate product exists and is in editable status
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, category: true, deletedAt: true },
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

    if (product.category !== 'PHONE_USED') {
      throw new BadRequestException('ลบรูป 6 มุมเฉพาะสินค้ามือสองเท่านั้น');
    }

    if (!ALLOWED_UPLOAD_STATUSES.includes(product.status)) {
      throw new BadRequestException(`ไม่สามารถลบรูปในสถานะ ${product.status} ได้`);
    }

    if (!ANGLES.includes(angle as Angle)) {
      throw new BadRequestException('angle ไม่ถูกต้อง');
    }

    const existing = await this.prisma.productPhoto.findUnique({ where: { productId } });
    if (!existing) throw new BadRequestException('ยังไม่มีรูปให้ลบ');

    const updated = await this.prisma.productPhoto.update({
      where: { productId },
      data: { [angle]: null, isCompleted: false },
    });

    return {
      productId,
      angle,
      deleted: true,
      completedCount: ANGLES.filter((a) => updated[a] !== null).length,
      totalCount: 6,
    };
  }

  /**
   * ยืนยันรูป 6 มุม — และเมื่อสถานะเป็น `PHOTO_PENDING` จะพาเครื่อง **เข้าคลังพร้อมขาย**
   *
   * Phase 5 fix round 2 [Important 1]: นี่คือประตูที่สามที่พาเครื่องเข้า `IN_STOCK`
   * และเป็นเส้นทางที่ **เป็นธรรมชาติที่สุดของเครื่องมือสอง** (ถ่ายรูปก่อนขาย) —
   * PATCH `REFURBISHED → PHOTO_PENDING` (deny-list ปิดแค่คู่ `REFURBISHED → IN_STOCK`)
   * แล้วอัปโหลดรูป+กดยืนยัน ก็เข้าคลังได้เงียบ ๆ โดยไม่เช็คราคา ไม่มี audit แถม route
   * นี้เปิดถึง `SALES` ขณะที่ปุ่ม/PATCH เป็น OWNER/BM
   * ⇒ ต่อ helper ชุดเดียวกับอีกสองประตู (`product-enter-stock.util.ts`) ห้ามเขียนกติกาซ้ำ
   */
  async completePhotos(productId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          status: true,
          category: true,
          deletedAt: true,
          // ด่านราคาของการเข้าคลัง (เฉพาะกิ่ง PHOTO_PENDING → IN_STOCK ด้านล่าง)
          cashPrice: true,
          installmentPrice: true,
          prices: { select: { amount: true, deletedAt: true } },
        },
      });
      if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

      if (product.category !== 'PHONE_USED') {
        throw new BadRequestException('ยืนยันรูป 6 มุมเฉพาะสินค้ามือสองเท่านั้น');
      }

      if (!ALLOWED_UPLOAD_STATUSES.includes(product.status)) {
        throw new BadRequestException(`ไม่สามารถยืนยันรูปในสถานะ ${product.status} ได้`);
      }

      const pp = await tx.productPhoto.findUnique({
        where: { productId },
      });
      if (!pp) throw new BadRequestException('ยังไม่ได้อัปโหลดรูปเลย');

      const missingAngles = ANGLES.filter((a) => pp[a] === null);
      if (missingAngles.length > 0) {
        throw new BadRequestException(`ยังขาดรูป: ${missingAngles.join(', ')}`);
      }

      // Mark photos as completed
      await tx.productPhoto.update({
        where: { productId },
        data: { isCompleted: true },
      });

      // If status is PHOTO_PENDING, advance to IN_STOCK
      if (product.status === 'PHOTO_PENDING') {
        assertSellableOnEnterStock(product);
        await tx.product.update({
          where: { id: productId },
          data: { status: 'IN_STOCK', stockInDate: new Date() },
        });
        // `userId` optional เพื่อไม่พังผู้เรียกภายใน — `AuditLog.userId` เป็น FK required
        if (userId) {
          await tx.auditLog.create({
            data: enterStockAuditData({
              productId,
              userId,
              fromStatus: product.status,
              via: 'PHOTO_COMPLETE',
              before: product,
            }),
          });
        }
      }

      return {
        productId,
        isCompleted: true,
        status: product.status === 'PHOTO_PENDING' ? 'IN_STOCK' : product.status,
      };
    });
  }
}
