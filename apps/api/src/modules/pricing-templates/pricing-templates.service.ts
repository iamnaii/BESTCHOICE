import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { currentDomainAccess } from '../employee-access/access-execution-context';
import { writeSharedReference } from '../employee-access/access-shared-reference';
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePricingTemplateDto, UpdatePricingTemplateDto } from './dto/pricing-template.dto';
import { Prisma, ProductCategory, ProductStatus, PricingDeviceOrigin } from '@prisma/client';
import { pickPricingTemplate, positiveDecimal, TEMPLATE_ORDER } from '../../utils/pricing-template-match.util';
import { syncFinancePriceRow, templateKeyOf } from '../../utils/product-finance-price.util';

/** "เครื่องในสต๊อก" ของปุ่มเติมราคาขาย GFIN — ยังไม่ขาย และมีราคาขายแล้ว (สเปค 2026-11-19 ข้อ 3.2) */
export const FINANCE_BACKFILL_STATUSES: ProductStatus[] = ['IN_STOCK', 'RESERVED', 'PHOTO_PENDING'];
const FINANCE_BACKFILL_CATEGORIES: ProductCategory[] = ['PHONE_NEW', 'PHONE_USED', 'TABLET'];
/** เขียนทีละชุด — tx เดียวทั้งสต๊อกอาจเกินเวลาของ interactive transaction */
const FINANCE_BACKFILL_CHUNK = 50;

@Injectable()
export class PricingTemplatesService {
  constructor(private readonly base: PrismaService) {}
  private get prisma() {
    return currentDomainAccess()?.client ?? this.base;
  }

  async findAll(query?: { brand?: string; category?: string; deviceOrigin?: string }) {
    const where: Prisma.PricingTemplateWhereInput = { isActive: true, deletedAt: null };
    if (query?.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
    if (query?.category) where.category = query.category as ProductCategory;
    if (query?.deviceOrigin) {
      if (!Object.values(PricingDeviceOrigin).includes(query.deviceOrigin as PricingDeviceOrigin))
        throw new BadRequestException('Invalid device origin');
      where.deviceOrigin = query.deviceOrigin as PricingDeviceOrigin;
    }

    return this.prisma.pricingTemplate.findMany({
      where,
      orderBy: [{ brand: 'asc' }, { model: 'asc' }, { storage: 'asc' }, { hasWarranty: 'desc' }],
    });
  }

  async findOne(id: string) {
    const template = await this.prisma.pricingTemplate.findUnique({
      where: { id, deletedAt: null },
    });
    if (!template) throw new NotFoundException('ไม่พบราคาตั้งต้น');
    return template;
  }

  /**
   * ค้นราคากลางของรุ่นตอนสร้างสินค้า / หน้า "ราคาและเรทผ่อน" / บอท
   * ไม่มีแถวของเครื่องไทย/เครื่องนอก → ถอยไปแถว "ไม่ระบุ" (สเปคข้อ 7.1) · ไม่ข้ามไปอีกฝั่ง
   * ในแต่ละที่มาเครื่อง: ความจุตรงก่อน แล้วค่อยแถวที่ไม่ระบุความจุ
   */
  async lookup(
    brand: string,
    model: string,
    storage: string | null,
    category: string,
    hasWarranty: boolean | null,
    deviceOrigin: PricingDeviceOrigin = 'UNSPECIFIED',
  ) {
    const origins: PricingDeviceOrigin[] =
      deviceOrigin === 'UNSPECIFIED' ? ['UNSPECIFIED'] : [deviceOrigin, 'UNSPECIFIED'];
    const storages = storage ? [storage, ''] : [''];
    for (const origin of origins) {
      for (const s of storages) {
        const template = await this.prisma.pricingTemplate.findFirst({
          where: {
            deviceOrigin: origin,
            brand: { equals: brand, mode: 'insensitive' },
            model: { equals: model, mode: 'insensitive' },
            storage: s,
            category: category as ProductCategory,
            hasWarranty: category === 'PHONE_USED' ? (hasWarranty ?? false) : false,
            isActive: true,
            deletedAt: null,
          },
        });
        if (template) return template;
      }
    }
    return null;
  }

  /**
   * ปุ่ม "เติมราคาขาย GFIN ให้เครื่องในสต๊อก" (สเปค 2026-11-19 ข้อ 3.2 / 7.5) — กลไกเดียวสำหรับเครื่องเดิม
   * เติมเฉพาะเครื่องพร้อมขายที่ช่องว่างและรุ่นมีราคาขาย GFIN ในราคากลาง (ตัวเลือกแถวเดียวกับตอนสร้างเครื่อง)
   * ไม่ทับค่าที่มี: เงื่อนไข `financePrice: null` อยู่ใน WHERE ของการเขียนเอง (มีคนตั้งราคาระหว่างนั้น = ข้าม)
   * เส้นทางนี้ OWNER เท่านั้น (ไม่มี access boundary) ⇒ ใช้ `this.base` ตรง
   */
  async backfillFinancePrice({
    dryRun,
    userId,
  }: {
    dryRun: boolean;
    userId: string | null;
  }): Promise<{ count: number }> {
    const [products, templates] = await Promise.all([
      this.base.product.findMany({
        where: {
          deletedAt: null,
          financePrice: null,
          status: { in: FINANCE_BACKFILL_STATUSES },
          category: { in: FINANCE_BACKFILL_CATEGORIES },
        },
        select: {
          id: true,
          brand: true,
          model: true,
          storage: true,
          category: true,
          deviceOrigin: true,
          warrantyExpired: true,
          warrantyExpireDate: true,
        },
        orderBy: { id: 'asc' },
      }),
      this.base.pricingTemplate.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: TEMPLATE_ORDER,
      }),
    ]);

    const fills = products.flatMap((p) => {
      const price = positiveDecimal(pickPricingTemplate(templates, templateKeyOf(p))?.installmentFinancePrice);
      return price ? [{ id: p.id, price }] : [];
    });
    if (dryRun || fills.length === 0) return { count: fills.length };

    const written: string[] = [];
    try {
      for (let i = 0; i < fills.length; i += FINANCE_BACKFILL_CHUNK) {
        const chunk = fills.slice(i, i + FINANCE_BACKFILL_CHUNK);
        const chunkWritten: string[] = [];
        await this.base.$transaction(async (tx) => {
          chunkWritten.length = 0; // กัน tx ถูกลองใหม่
          for (const fill of chunk) {
            const updated = await tx.product.updateMany({
              where: { id: fill.id, financePrice: null, deletedAt: null, status: { in: FINANCE_BACKFILL_STATUSES } },
              data: { financePrice: fill.price },
            });
            if (updated.count !== 1) continue;
            await syncFinancePriceRow(tx, fill.id, fill.price);
            chunkWritten.push(fill.id);
          }
        });
        written.push(...chunkWritten); // นับเฉพาะชุดที่ commit แล้ว
      }
    } finally {
      // ชุดที่ commit แล้วต้องมี audit เสมอ แม้ชุดถัดไปล้ม
      if (userId && written.length > 0) {
        await this.base.auditLog.create({
          data: {
            userId,
            action: 'PRODUCT_FINANCE_PRICE_BACKFILLED',
            entity: 'product',
            entityId: 'batch',
            newValue: { count: written.length, productIds: written },
          },
        });
      }
    }
    return { count: written.length };
  }

  async create(dto: CreatePricingTemplateDto) {
    return writeSharedReference(this.base, (tx) =>
      tx.pricingTemplate.create({
        data: {
          deviceOrigin: dto.deviceOrigin ?? 'UNSPECIFIED',
          brand: dto.brand,
          model: dto.model,
          storage: dto.storage || '',
          category: dto.category as ProductCategory,
          hasWarranty: dto.category === 'PHONE_USED' ? (dto.hasWarranty ?? false) : false,
          cashPrice: dto.cashPrice,
          installmentBestchoicePrice: dto.installmentBestchoicePrice,
          installmentFinancePrice: dto.installmentFinancePrice,
          rate1DownPayment: dto.rate1DownPayment,
          rate1TermMonths: dto.rate1TermMonths,
          rate2DownPayment: dto.rate2DownPayment,
          rate2TermMonths: dto.rate2TermMonths,
        },
      }),
    );
  }
  async update(id: string, dto: UpdatePricingTemplateDto) {
    return writeSharedReference(this.base, async (tx) => {
      await tx.$queryRaw`SELECT id FROM pricing_templates WHERE id = ${id} FOR UPDATE`;
      if (!(await tx.pricingTemplate.findFirst({ where: { id, deletedAt: null } })))
        throw new NotFoundException('ไม่พบราคาตั้งต้น');
      return tx.pricingTemplate.update({ where: { id }, data: dto });
    });
  }
  async remove(id: string) {
    return this.update(id, { isActive: false });
  }

  async bulkImport(items: CreatePricingTemplateDto[], deactivateIds?: unknown) {
    if (!Array.isArray(items) || items.length > 100)
      throw new BadRequestException('รายการนำเข้าต้องเป็นอาร์เรย์ไม่เกิน 100 แถว');
    if (
      deactivateIds !== undefined &&
      (!Array.isArray(deactivateIds) ||
        deactivateIds.some((id) => typeof id !== 'string'))
    )
      throw new BadRequestException('รายการแถวที่จะปิดไม่ถูกต้อง');
    // รวม id ซ้ำ/ว่างก่อน แล้วค่อยนับเพดาน 1000
    const requestedIds = [...new Set((deactivateIds as string[] | undefined) ?? [])].filter(Boolean);
    if (requestedIds.length > 1000) throw new BadRequestException('รายการแถวที่จะปิดไม่ถูกต้อง');
    const errors: string[] = [];
    const valid: CreatePricingTemplateDto[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`ROW_${i + 1}:INVALID_ROW`);
        continue;
      }
      const dto = plainToInstance(CreatePricingTemplateDto, item);
      if ((await validate(dto, { whitelist: true })).length)
        errors.push(`ROW_${i + 1}:INVALID_ROW`);
      else valid.push(dto);
    }
    if (errors.length) return { success: 0, skipped: items.length, errors };
    return writeSharedReference(this.base, async (tx) => {
      const written = new Set<string>();
      for (const item of valid) {
        const key = {
          brand: item.brand,
          model: item.model,
          storage: item.storage || '',
          category: item.category as ProductCategory,
          hasWarranty: item.category === 'PHONE_USED' ? (item.hasWarranty ?? false) : false,
          deviceOrigin: item.deviceOrigin ?? ('UNSPECIFIED' as PricingDeviceOrigin),
        };
        const existing = await tx.pricingTemplate.findUnique({
          where: { brand_model_storage_category_hasWarranty_deviceOrigin: key },
        });
        if (existing?.deletedAt) throw new ConflictException('ข้อมูลอ้างอิงถูกลบแล้ว');
        if (existing)
          await tx.$queryRaw`SELECT id FROM pricing_templates WHERE id = ${existing.id} FOR UPDATE`;
        // ไฟล์คือค่าจริงของรุ่น (สเปคข้อ 7.4) — งวด/ดาวน์ที่ว่างในไฟล์ = ใช้กติกาตั้งต้น จึงเขียน null
        const values = {
          cashPrice: item.cashPrice,
          installmentBestchoicePrice: item.installmentBestchoicePrice,
          installmentFinancePrice: item.installmentFinancePrice,
          rate1TermMonths: item.rate1TermMonths ?? null,
          rate1DownPayment: item.rate1DownPayment ?? null,
          rate2TermMonths: item.rate2TermMonths ?? null,
        };
        const row = await tx.pricingTemplate.upsert({
          where: { brand_model_storage_category_hasWarranty_deviceOrigin: key },
          update: { ...values, isActive: true },
          create: { ...key, ...values },
        });
        const writtenId = row?.id ?? existing?.id;
        if (writtenId) written.add(writtenId);
      }
      // "ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์" — หน้าเว็บส่ง id มากับชุดสุดท้าย
      // แถวที่เพิ่งนำเข้าในคำขอนี้ห้ามถูกปิด แม้ client จะส่ง id มาด้วย
      const ids = requestedIds.filter((id) => !written.has(id));
      const deactivated = ids.length
        ? (
            await tx.pricingTemplate.updateMany({
              where: { id: { in: ids }, isActive: true, deletedAt: null },
              data: { isActive: false },
            })
          ).count
        : 0;
      return {
        success: valid.length,
        skipped: 0,
        errors: [] as string[],
        ...(deactivateIds !== undefined ? { deactivated } : {}),
      };
    });
  }
}
