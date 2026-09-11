import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStickerTemplateDto, UpdateStickerTemplateDto } from './dto/sticker.dto';

/**
 * ข้อมูลเครื่องสำหรับพิมพ์สติกเกอร์ติดเครื่อง — อ่านจาก "ตัวเครื่อง" ล้วน ๆ
 * (คำตัดสินเจ้าของ 2026-09-11: เลิกอ่านตารางราคากลาง PricingTemplate ซึ่งบน prod ราคาเงินสด = 0
 * ทุกแถวและไม่ตรงรุ่นจริง). ราคา/ค่างวดให้ฝั่ง web คำนวณด้วยสูตรเดียวกับหน้ารายละเอียดสินค้า
 * (getPositiveDisplayPrices + resolveQuotes) เพื่อให้สติกเกอร์ = สรุปส่งลูกค้าแบบย่อ
 */
export interface StickerProductData {
  productId: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  status: string;
  color: string | null;
  storage: string | null;
  batteryHealth: number | null;
  hasBox: boolean | null;
  /** ISO date YYYY-MM-DD เฉพาะประกันศูนย์ที่ยังไม่หมด — หมดแล้ว/ไม่ระบุ = null */
  warrantyExpireDate: string | null;
  imei: string | null;
  /** ISO datetime ของวันที่รับเข้าสต็อกล่าสุด */
  stockInDate: string | null;
  cashPrice: string | null;
  installmentPrice: string | null;
  prices: { label: string; amount: string; isDefault: boolean }[];
}

/** จำนวนเครื่องสูงสุดต่อคำขอ (ตรงกับด่านใน controller) */
export const STICKER_BATCH_LIMIT = 100;

const stickerProductArgs = Prisma.validator<Prisma.ProductDefaultArgs>()({
  include: { prices: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
});
type StickerProductRow = Prisma.ProductGetPayload<typeof stickerProductArgs>;

@Injectable()
export class StickersService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, limit = 50) {
    page = Math.max(1, page);
    limit = Math.min(200, Math.max(1, limit));

    const [data, total] = await Promise.all([
      this.prisma.stickerTemplate.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stickerTemplate.count({ where: { deletedAt: null } }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const template = await this.prisma.stickerTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('ไม่พบ Template สติกเกอร์');
    return template;
  }

  async create(dto: CreateStickerTemplateDto) {
    return this.prisma.stickerTemplate.create({ data: dto as Prisma.StickerTemplateCreateInput });
  }

  async update(id: string, dto: UpdateStickerTemplateDto) {
    await this.findOne(id);
    return this.prisma.stickerTemplate.update({
      where: { id },
      data: dto as Prisma.StickerTemplateUpdateInput,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.stickerTemplate.update({ where: { id }, data: { isActive: false } });
  }

  /** เครื่องเดียว — key เป็น Product ID หรือ IMEI ก็ได้ */
  async getStickerData(key: string): Promise<StickerProductData> {
    const [data] = await this.getStickerDataBatch([key]);
    if (!data) throw new NotFoundException('ไม่พบสินค้า');
    return data;
  }

  /**
   * หลายเครื่องในคำขอเดียว — key แต่ละตัวเป็น Product ID หรือ IMEI (ช่องสแกนยิงบาร์โค้ด IMEI ได้ตรง ๆ)
   * คืนตามลำดับ key ที่ขอ เครื่องเดียวกันที่ถูกอ้างสองทางส่งครั้งเดียว · key ที่หาไม่พบถูกข้าม
   */
  async getStickerDataBatch(keys: string[]): Promise<StickerProductData[]> {
    const wanted = [...new Set(keys.map((k) => k.trim()).filter(Boolean))].slice(0, STICKER_BATCH_LIMIT);
    if (wanted.length === 0) return [];

    const rows = await this.prisma.product.findMany({
      where: { deletedAt: null, OR: [{ id: { in: wanted } }, { imeiSerial: { in: wanted } }] },
      ...stickerProductArgs,
    });

    const byKey = new Map<string, StickerProductRow>();
    for (const row of rows) {
      byKey.set(row.id, row);
      if (row.imeiSerial) byKey.set(row.imeiSerial, row);
    }
    const seen = new Set<string>();
    const ordered: StickerProductRow[] = [];
    for (const key of wanted) {
      const row = byKey.get(key);
      if (row && !seen.has(row.id)) {
        seen.add(row.id);
        ordered.push(row);
      }
    }
    return ordered.map((row) => this.toStickerData(row));
  }

  private toStickerData(product: StickerProductRow): StickerProductData {
    return {
      productId: product.id,
      name: product.name,
      brand: product.brand,
      model: product.model,
      category: product.category,
      status: product.status,
      color: product.color,
      storage: product.storage,
      batteryHealth: product.batteryHealth,
      hasBox: product.hasBox,
      warrantyExpireDate: this.activeWarrantyDate(product.warrantyExpireDate, product.warrantyExpired),
      imei: product.imeiSerial,
      stockInDate: product.stockInDate ? product.stockInDate.toISOString() : null,
      cashPrice: product.cashPrice != null ? product.cashPrice.toString() : null,
      installmentPrice: product.installmentPrice != null ? product.installmentPrice.toString() : null,
      prices: product.prices.map((p) => ({
        label: p.label,
        amount: p.amount.toString(),
        isDefault: p.isDefault,
      })),
    };
  }

  /** ประกันศูนย์ที่ยังใช้ได้เท่านั้น — หมดแล้ว (flag หรือวันที่ผ่านมาแล้ว) ไม่ขึ้นบนสติกเกอร์ */
  private activeWarrantyDate(expireDate: Date | null, expired: boolean | null): string | null {
    if (!expireDate) return null;
    if (expired === true) return null;
    if (expireDate.getTime() < Date.now()) return null;
    return expireDate.toISOString().slice(0, 10);
  }
}
