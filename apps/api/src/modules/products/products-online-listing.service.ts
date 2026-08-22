import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BulkOnlineVisibilityDto, PromoteListingPhotoDto, UpdateOnlineListingDto } from './dto/online-listing.dto';
import {
  SHOP_BRAND,
  SHOP_PHONE_CATEGORIES,
  evaluateReadiness,
} from '../../utils/product-readiness.util';
import { getBranchScope } from '../auth/branch-access.util';

const MAX_GALLERY = 8;
/** ดึงมาประเมินความพร้อมได้สูงสุดกี่แถวต่อครั้ง — ร้านมีของหลักร้อย ไม่ใช่หลักแสน */
const MAX_BULK_SCAN = 2000;
const DATA_URL_RE = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/;
const EXT_BY_MIME: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };

@Injectable()
export class ProductsOnlineListingService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  private async findProduct(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');
    return product;
  }

  async updateOnlineListing(id: string, dto: UpdateOnlineListingDto) {
    const product = await this.findProduct(id);

    if (dto.gallery) {
      if (new Set(dto.gallery).size !== dto.gallery.length) {
        // defense-in-depth: DTO-level @ArrayUnique should already catch this,
        // but keep a service-level check so the invariant holds even if a
        // caller bypasses the validation pipe (e.g. internal service call).
        throw new BadRequestException('มีรูปซ้ำในรายการ');
      }
      const current = new Set(product.gallery);
      const outside = dto.gallery.filter((url) => !current.has(url));
      if (outside.length > 0) {
        throw new BadRequestException('จัดเรียง/ลบได้เฉพาะรูปที่อยู่ในแกลเลอรีเดิม — เพิ่มรูปใหม่ผ่านการเลือกจากรูปในระบบเท่านั้น');
      }
    }

    // B0 §2.3: สวิตช์นี้กลายเป็น "ปิดจากเว็บ" ล้วนๆ — การขึ้นเว็บจริงตัดสินที่
    // readiness fragment (product-readiness.util) ไม่ใช่ที่นี่ ดังนั้นกดเปิดได้เสมอ
    // เครื่องที่เปิดไว้แต่ข้อมูลไม่ครบจะไม่ปรากฏบนเว็บอยู่ดี (GET /products/:id/readiness บอกเหตุผล)

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.gallery !== undefined ? { gallery: dto.gallery } : {}),
        ...(dto.isOnlineVisible !== undefined ? { isOnlineVisible: dto.isOnlineVisible } : {}),
        ...(dto.onlineDescription !== undefined ? { onlineDescription: dto.onlineDescription } : {}),
      },
    });
  }

  async promotePhoto(id: string, dto: PromoteListingPhotoDto): Promise<{ gallery: string[] }> {
    const product = await this.findProduct(id);
    // Best-effort cap check — this is check-then-act against a value read
    // before the atomic push below, so two concurrent requests can both
    // pass this check and jointly land the gallery 1 photo over MAX_GALLERY.
    // Acceptable narrow race (soft cap, not a money/safety invariant); the
    // write itself is still race-safe via Prisma's atomic `push`.
    if (product.gallery.length >= MAX_GALLERY) {
      throw new BadRequestException(`แกลเลอรีขึ้นเว็บได้สูงสุด ${MAX_GALLERY} รูป — ลบรูปเดิมออกก่อน`);
    }

    let candidate: string | null | undefined;
    if (dto.source === 'LEGACY') {
      candidate = dto.index !== undefined ? product.photos[dto.index] : undefined;
    } else {
      const row = await this.prisma.productPhoto.findUnique({ where: { productId: id } });
      candidate = dto.angle && row ? (row as Record<string, unknown>)[dto.angle] as string | null : undefined;
    }
    if (!candidate) throw new BadRequestException('ไม่พบรูปที่เลือก');

    const match = DATA_URL_RE.exec(candidate);
    if (!match) throw new BadRequestException('รูปที่เลือกไม่อยู่ในรูปแบบที่รองรับ');

    const [, mime, b64] = match;
    const buffer = Buffer.from(b64, 'base64');
    const key = `shop/product-gallery/${id}/${randomUUID()}.${EXT_BY_MIME[mime]}`;
    await this.storage.upload(key, buffer, `image/${mime}`);
    const publicUrl = this.storage.getPublicUrl(key);

    // Atomic push instead of read-modify-write with an in-memory array —
    // avoids a lost update if two promotePhoto calls race on the same
    // product (each would otherwise read the same base array and clobber
    // the other's append).
    const updated = await this.prisma.product.update({
      where: { id },
      data: { gallery: { push: publicUrl } },
      select: { gallery: true },
    });
    return { gallery: updated.gallery };
  }

  /**
   * เปิด/ปิด "แสดงบนเว็บ" ทีเดียวหลายเครื่อง
   *
   * ปลอดภัยที่จะเปิดยกล็อต เพราะสวิตช์นี้เป็นแค่ "ปิดจากเว็บ" — ตัวตัดสินว่า
   * เครื่องจะโผล่จริงไหมคือ readiness fragment (ราคาสด/รูป/เกรด) ที่ฝั่งเว็บใช้
   * กรองอยู่แล้ว เครื่องที่ข้อมูลไม่ครบจึงเปิดค้างไว้ได้โดยไม่หลุดขึ้นหน้าร้าน
   *
   * คืนสรุปตามจริงว่าเปิดไปกี่เครื่อง **และจะขึ้นเว็บจริงกี่เครื่อง** พร้อม
   * รายการว่าที่เหลือติดอะไร — ตัวเลขสองอันนี้ไม่เท่ากันเป็นเรื่องปกติ
   */
  async bulkSetVisibility(
    dto: BulkOnlineVisibilityDto,
    user: { role?: string | null; branchId?: string | null } | undefined,
  ) {
    if (dto.scope === 'SELECTED' && (!dto.productIds || dto.productIds.length === 0)) {
      throw new BadRequestException('เลือกอย่างน้อย 1 เครื่อง หรือเปลี่ยนเป็นทั้งสต็อก');
    }

    const where: Record<string, unknown> = {
      deletedAt: null,
      brand: SHOP_BRAND,
      category: { in: [...SHOP_PHONE_CATEGORIES] },
      status: 'IN_STOCK',
    };
    if (dto.scope === 'SELECTED') where.id = { in: dto.productIds };

    // ผจก.สาขาแตะได้เฉพาะสาขาตัวเอง — ใช้ util เดียวกับ read endpoint อื่น
    const scope = getBranchScope(user);
    if (!scope.all) {
      if (!scope.branchId) {
        throw new BadRequestException('บัญชีนี้ยังไม่ได้ผูกสาขา จึงยังส่งสินค้าขึ้นเว็บไม่ได้');
      }
      where.branchId = scope.branchId;
    }

    const rows = await this.prisma.product.findMany({
      where,
      take: MAX_BULK_SCAN,
      select: {
        id: true,
        name: true,
        brand: true,
        category: true,
        status: true,
        cashPrice: true,
        gallery: true,
        conditionGrade: true,
        isOnlineVisible: true,
        deletedAt: true,
      },
    });

    if (rows.length === 0) {
      return {
        matched: 0,
        changed: 0,
        alreadySet: 0,
        willAppear: 0,
        blockedBy: [] as Array<{ reason: string; count: number }>,
      };
    }

    const toChange = rows.filter((r) => r.isOnlineVisible !== dto.isOnlineVisible);
    if (toChange.length > 0) {
      await this.prisma.product.updateMany({
        where: { id: { in: toChange.map((r) => r.id) } },
        data: { isOnlineVisible: dto.isOnlineVisible },
      });
    }

    // สรุปตามจริงว่าหลังกดแล้วจะเห็นบนเว็บกี่เครื่อง — ใช้ evaluateReadiness ตัว
    // เดียวกับเช็คลิสต์ในหน้าสินค้า จะได้ไม่มีกติกาชุดที่สอง
    const blocked = new Map<string, number>();
    let willAppear = 0;
    for (const r of rows) {
      const result = evaluateReadiness({
        name: r.name,
        brand: r.brand,
        category: r.category,
        status: r.status,
        cashPrice: r.cashPrice,
        gallery: r.gallery,
        conditionGrade: r.conditionGrade,
        // ประเมินบนค่าใหม่ที่เพิ่งเขียนลงไป ไม่ใช่ค่าเก่าที่อ่านมา
        isOnlineVisible: dto.isOnlineVisible,
        deletedAt: r.deletedAt,
      });
      if (result.ready) {
        willAppear += 1;
        continue;
      }
      for (const c of result.checks) {
        if (c.severity === 'blocking' && !c.ok) {
          blocked.set(c.label, (blocked.get(c.label) ?? 0) + 1);
        }
      }
    }

    return {
      matched: rows.length,
      changed: toChange.length,
      alreadySet: rows.length - toChange.length,
      willAppear,
      blockedBy: [...blocked.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
