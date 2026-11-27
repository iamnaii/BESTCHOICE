import { matchesDocumentMime } from '../contracts/services/document-mime.util';
import { Controller, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { PHOTO_ANGLES, PhotoAngle } from '../quality-control/photo-angles.util';
import { productReadinessWhere } from '../../utils/product-readiness.util';
import { readBoolFlag } from '../../utils/config.util';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';
import { SkipBotRateLimit } from '../shop-bot-defense/skip-bot-rate-limit.decorator';

/** Read the current angle, never evidence. No copied objects or stale orphan images. */
@Controller('shop/products')
@UseGuards(ShopBotDefenseGuard)
export class ShopProductPhotoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/photos/:angle')
  @SkipBotRateLimit()
  async photo(@Param('id') id: string, @Param('angle') angle: string, @Res() res: Response) {
    if (!PHOTO_ANGLES.includes(angle as PhotoAngle)) throw new NotFoundException('ไม่พบรูปสินค้า');
    const excludeDemo = await readBoolFlag(this.prisma, 'shop_hide_demo_products', false);
    const product = await this.prisma.product.findFirst({
      where: { id, ...productReadinessWhere({ requireInStock: false, excludeDemo }) },
      select: { productPhotos: { select: { deletedAt: true, [angle]: true } } },
    });
    const photos = product?.productPhotos;
    const source: unknown = (photos as Record<string, unknown> | null | undefined)?.[angle];
    const match = typeof source === 'string' && /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(source);
    if (!photos || photos.deletedAt || typeof source !== 'string' || !match) throw new NotFoundException('ไม่พบรูปสินค้า');
    const bytes = Buffer.from(match[2], 'base64');
    if (source.length > 15_000_000 || !bytes.length || bytes.toString('base64') !== match[2] || !matchesDocumentMime(bytes, match[1])) {
      throw new NotFoundException('ไม่พบรูปสินค้า');
    }
    // ลิงก์รูปมีเลขเวอร์ชัน (?v=เวลาแก้รูป — listingPhotoUrl) เปลี่ยนรูปเมื่อไรได้ลิงก์ใหม่ ⇒ ให้เบราว์เซอร์
    // จำได้ 1 วัน (เดิม no-store: เปิดหน้าไหนก็โหลดรูป 1080px ใหม่ทุกครั้ง — เจ้าของ 2026-11-27) · `private` =
    // เก็บเฉพาะเครื่องที่เคยเห็นรูปแล้ว CDN/proxy ไม่เก็บ ⇒ สินค้าที่ถูกซ่อนไม่ถูกส่งต่อให้คนใหม่ (กติกาสิทธิ์เห็นรูปเดิม)
    // app.setup.ts ใส่ Pragma/Expires ให้ /api/* ทุกเส้น — ถอดออกแบบ shop-share.controller ·
    // บนเว็บจริง Firebase Hosting ทับ Cache-Control ของ /api ทุกเส้นด้วย no-store ⇒ firebase.json
    // ต้องมีกฎของเส้นรูปค่าเดียวกันนี้ (เทสต์ใน spec ปักไว้) · Hosting ทับเฉพาะคำตอบที่สำเร็จ —
    // 404 ยังได้ no-store ของ API (ตรวจบนเว็บจริง 2026-11-27) จึงไม่จำรูปเสียไว้ทั้งวัน
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.removeHeader('Pragma');
    res.removeHeader('Expires');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(match[1]).send(bytes);
  }
}
