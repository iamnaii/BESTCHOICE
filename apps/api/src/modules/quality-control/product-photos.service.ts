import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { enterStockAuditData, hasSellingPrice } from '../products/product-enter-stock.util';

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
type Angle = typeof ANGLES[number];

const ALLOWED_UPLOAD_STATUSES = ['PHOTO_PENDING', 'IN_STOCK', 'RESERVED'];

/**
 * สถานะเดียวที่ "ยืนยันรูปครบ" ยังพาเครื่องเข้าคลังได้ — ใช้ร่วมกันระหว่าง `getPhotos`
 * (บอกหน้าจอว่าปุ่มยังต้องอยู่ไหม) กับ `completePhotos` (ตัวบังคับจริง) เพื่อไม่ให้เกิด
 * กติกาชุดที่สองที่หน้าจอประกอบเองจากสถานะสินค้า
 */
const PENDING_STOCK_ENTRY_STATUS = 'PHOTO_PENDING';

/** ข้อความที่ UI เอาไปโชว์ตรง ๆ — เส้นทางเดียว ไม่ให้หน้าจอเดาเองว่าเข้าคลังหรือยัง */
const PHOTOS_DONE_ENTERED_STOCK = 'ยืนยันรูปครบแล้ว — สินค้าเข้าคลังพร้อมขายเรียบร้อย';
/**
 * Fix round 4 [Important 1]: ข้อความต้องชี้ทางออกที่ **คนที่กดปุ่มนี้ทำได้จริง** —
 * route นี้เปิดถึง `SALES` แต่การตั้งราคา (PATCH `/products/:id`,
 * `POST /products/:id/prices`) เป็น OWNER/BRANCH_MANAGER ⇒ สั่งให้ SALES "ไปตั้งราคา"
 * เฉย ๆ คือส่งไปชนกำแพง. และรอบก่อนหน้ายังบอกให้ "กดยืนยันอีกครั้ง" ทั้งที่ปุ่มหายไปแล้ว
 * (หน้าจอ render ด้วย `!isCompleted`) — ตอนนี้ปุ่มอยู่จนกว่าเครื่องจะเข้าคลังจริง
 * (`pendingStockEntry` ใน `getPhotos`) ข้อความนี้จึงเป็นจริงได้
 */
const PHOTOS_DONE_NEEDS_PRICE =
  'บันทึกรูปครบแล้ว แต่ยังไม่เข้าคลัง เพราะเครื่องนี้ยังไม่มีราคาขาย — ' +
  'ให้ผู้จัดการสาขา/เจ้าของตั้งราคาขาย (เงินสด/ผ่อน) ที่หน้ารายละเอียดสินค้า ' +
  'แล้วกดปุ่ม "ยืนยันรูปครบ" อีกครั้ง (ปุ่มยังอยู่จนกว่าเครื่องจะเข้าคลัง)';
const PHOTOS_DONE_ONLY = 'ยืนยันรูปครบแล้ว';

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

    /**
     * Fix round 4 [Important 1] — "กดยืนยันรูปซ้ำแล้วยังมีผลอยู่ไหม"
     *
     * หน้าจอเดิมซ่อนปุ่มด้วย `!isCompleted` ⇒ พอ `completePhotos` (soft gate ของรอบ 3)
     * เซ็ต `isCompleted = true` แล้วไม่เลื่อนสถานะเพราะยังไม่มีราคา ปุ่มก็หายถาวร
     * และเครื่องค้าง `PHOTO_PENDING` เงียบ ๆ — ต้องบอกหน้าจอจากที่นี่ทางเดียว
     */
    const pendingStockEntry = product.status === PENDING_STOCK_ENTRY_STATUS;

    if (!product.productPhotos) {
      return {
        productId,
        photos: { front: null, back: null, left: null, right: null, top: null, bottom: null },
        isCompleted: false,
        completedCount: 0,
        totalCount: 6,
        pendingStockEntry,
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
      pendingStockEntry,
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
   *
   * Phase 5 fix round 3 [Minor 4]: ด่านนั้นเป็น **soft gate ไม่ใช่ hard block** —
   * `trade-in` สร้างเครื่องรับซื้อเป็น `PHOTO_PENDING` โดย **ไม่มีราคาขาย** แล้ว autofill
   * จากตารางราคากลางแบบ fail-soft (`trade-in-lifecycle.service.ts`) ⇒ template ไม่ match
   * เมื่อไร พนักงาน `SALES` ที่อัปโหลดรูปครบจะได้ 400 และตั้งราคาเองไม่ได้ (PATCH และ
   * `POST /products/:id/prices` เป็น OWNER/BM) = flow หน้าร้านตัน. งานของ endpoint นี้
   * (บันทึกว่ารูปครบ) จึงต้องสำเร็จเสมอ ส่วนการ **เลื่อนเป็น IN_STOCK** เกิดเฉพาะเมื่อ
   * ราคาผ่านด่าน — เครื่องค้างที่ `PHOTO_PENDING` พร้อมข้อความบอกว่าต้องตั้งราคาก่อน
   * (invariant เดิมยังอยู่ครบ: ไม่มีเครื่องไหนเข้า `IN_STOCK` โดยไม่มีราคา)
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

      // If status is PHOTO_PENDING, advance to IN_STOCK — เฉพาะเมื่อมีราคาขายแล้ว
      const enterStock =
        product.status === PENDING_STOCK_ENTRY_STATUS && hasSellingPrice(product);
      if (enterStock) {
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

      const needsPrice = product.status === PENDING_STOCK_ENTRY_STATUS && !enterStock;
      return {
        productId,
        isCompleted: true,
        status: enterStock ? ('IN_STOCK' as const) : product.status,
        /** UI ใช้ตัดสินข้อความ/ไอคอน — อย่าเดาจาก `status` ฝั่งหน้าจอเอง */
        enteredStock: enterStock,
        needsPrice,
        message: enterStock
          ? PHOTOS_DONE_ENTERED_STOCK
          : needsPrice
            ? PHOTOS_DONE_NEEDS_PRICE
            : PHOTOS_DONE_ONLY,
      };
    });
  }
}
