import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
type Angle = typeof ANGLES[number];

const ALLOWED_UPLOAD_STATUSES = ['PHOTO_PENDING', 'IN_STOCK'];

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

  async completePhotos(productId: string) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, status: true, category: true, deletedAt: true },
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
        await tx.product.update({
          where: { id: productId },
          data: { status: 'IN_STOCK', stockInDate: new Date() },
        });
      }

      return {
        productId,
        isCompleted: true,
        status: product.status === 'PHOTO_PENDING' ? 'IN_STOCK' : product.status,
      };
    });
  }
}
