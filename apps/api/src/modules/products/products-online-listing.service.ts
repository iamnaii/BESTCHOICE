import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PromoteListingPhotoDto, UpdateOnlineListingDto } from './dto/online-listing.dto';

const MAX_GALLERY = 8;
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

    const effectiveGallery = dto.gallery ?? product.gallery;
    // The "visible ⇒ has photo + graded" invariant must hold for the
    // resulting row regardless of whether THIS request flips the toggle —
    // e.g. `PATCH { gallery: [] }` on an already-visible product must not
    // silently leave it visible with an empty gallery.
    const nextVisible = dto.isOnlineVisible ?? product.isOnlineVisible;
    if (nextVisible === true) {
      if (effectiveGallery.length < 1) {
        throw new BadRequestException('ต้องมีรูปขึ้นเว็บอย่างน้อย 1 รูปก่อนเปิดแสดงบนเว็บ');
      }
      if (product.category === 'PHONE_USED' && !product.conditionGrade) {
        throw new BadRequestException('กรุณาระบุเกรดเครื่องก่อนเปิดแสดงบนเว็บ');
      }
    }

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
}
