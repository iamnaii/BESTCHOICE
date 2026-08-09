import { Controller, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { ShopCatalogService, ProductUnit } from './shop-catalog.service';
import { buildSharePage, buildShareDescription } from './share-page.util';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';
import { SkipBotRateLimit } from '../shop-bot-defense/skip-bot-rate-limit.decorator';
import { shopBaseUrl } from '../../utils/shop-base-url.util';

const FALLBACK_BASE_URL = 'https://www.bestchoicephone.com';

/**
 * หน้าแชร์สินค้า — เสิร์ฟ HTML ที่มี Open Graph + JSON-LD ให้ LINE/Facebook
 * ดึงการ์ดได้ แล้วเด้งคนจริงไป /products/:id ของ SPA
 *
 * ทำไมไม่ rewrite /products/** มาที่ API: image ของ api ไม่มี index.html ของ
 * web-shop (Dockerfile build เฉพาะ apps/api) และ setGlobalPrefix('api') ไม่มี
 * exclude → rewrite แบบนั้นทำให้ทั้งเว็บ 404 endpoint นี้จึงอยู่ใต้ /api/**
 * ซึ่ง Firebase Hosting rewrite ไป Cloud Run อยู่แล้ว
 */
@Controller('shop')
@UseGuards(ShopBotDefenseGuard)
export class ShopShareController {
  constructor(private catalogService: ShopCatalogService) {}

  @Get('share/:id')
  @SkipBotRateLimit()
  async share(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const detail = await this.catalogService.getProductDetail(id);
    if (!detail) throw new NotFoundException('สินค้านี้ไม่พบ');

    const units: ProductUnit[] = Object.values(detail.tiers).flatMap((t) => t.units);
    const cheapest = units.reduce<ProductUnit | undefined>(
      (min, u) => (min == null || u.cashPrice < min.cashPrice ? u : min),
      undefined,
    );

    const title = [detail.brand, detail.model, detail.storage, detail.color]
      .filter(Boolean)
      .join(' ');
    const rawPrice = cheapest?.cashPrice ?? detail.cashPrice ?? null;
    const price = rawPrice != null && rawPrice > 0 ? rawPrice : null;
    const imageUrl = detail.gallery[0] ?? cheapest?.gallery[0];

    const description =
      detail.description?.trim() ||
      buildShareDescription({
        title,
        condition: detail.condition,
        conditionGrade: cheapest?.conditionGrade !== 'unknown' ? cheapest?.conditionGrade : undefined,
        batteryHealth: cheapest?.batteryHealth,
        shopWarrantyDays: cheapest?.shopWarrantyDays,
        price,
      });

    // productId มาจากแถวใน DB (detail.id) ไม่ใช่ param ดิบ — กัน path injection
    const base = shopBaseUrl() ?? FALLBACK_BASE_URL;
    const canonicalUrl = `${base}/products/${encodeURIComponent(detail.id)}`;
    const nonce = randomBytes(16).toString('base64');

    const html = buildSharePage({
      title,
      description,
      brand: detail.brand,
      condition: detail.condition,
      price,
      imageUrl,
      inStock: units.length > 0,
      canonicalUrl,
      nonce,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // main.ts:56-62 ใส่ Cache-Control:no-store + Pragma:no-cache + Expires:0
    // ให้ทุก /api/* — หน้านี้ทับด้วย cache สั้น ๆ เพื่อลดภาระตอนลิงก์ถูกกระจาย
    // ในกลุ่มแชท (ข้อมูลล้าได้ไม่เกิน 5 นาที) และต้อง "ถอด" Pragma/Expires ทิ้ง
    // ด้วย ไม่งั้น proxy/CDN ที่ยังอ่าน header เก่าจะไม่ยอม cache
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.removeHeader('Pragma');
    res.removeHeader('Expires');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // helmet ปิด CSP ทั้งระบบ (API ไม่เคยเสิร์ฟ HTML) — ใส่เฉพาะ response นี้
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src https: data:; base-uri 'none'; form-action 'none'`,
    );
    res.status(200).send(html);
  }
}
