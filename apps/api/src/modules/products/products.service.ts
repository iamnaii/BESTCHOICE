import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDateShort } from '../../utils/thai-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { syncPriceRowsFromColumns } from '../../utils/product-price-sync.util';
import { assertManualStatusChangeAllowed, productStatusLabel } from './product-status.util';
import { assertProductNotHeld, changedIdentityFields } from './product-hold.util';
import { autofillProductPriceFromTemplate } from '../../utils/product-price-autofill.util';
import { evaluateReadiness } from '../../utils/product-readiness.util';

const productInclude = {
  prices: { orderBy: { createdAt: 'asc' as const } },
  supplier: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  po: { select: { id: true, poNumber: true } },
  inspection: { select: { id: true, overallGrade: true, isCompleted: true } },
  productPhotos: { select: { id: true, isCompleted: true } },
};

// Re-export for use by other services if needed
export { productInclude };

/** ค่าที่ "เป็นราคาจริง" — null/ว่าง/0/ติดลบ ถือว่ายังไม่ได้ตั้งราคา */
function isPositiveAmount(v: Prisma.Decimal | string | number | null | undefined): boolean {
  if (v === null || v === undefined || v === '') return false;
  return new Prisma.Decimal(v.toString()).gt(0);
}

/** number จาก DTO → Decimal เมื่อเป็นค่าบวกจริงเท่านั้น (ไม่งั้น null) */
function positiveDecimalOrNull(v: number | null | undefined): Prisma.Decimal | null {
  return isPositiveAmount(v) ? new Prisma.Decimal(v as number) : null;
}

interface ProductPriceShape {
  cashPrice?: Prisma.Decimal | string | number | null;
  installmentPrice?: Prisma.Decimal | string | number | null;
  prices?: Array<{ amount: Prisma.Decimal | string | number; deletedAt?: Date | null }>;
}

/**
 * เครื่องนี้มีราคาขายแล้วหรือยัง — **ด่านปลายทาง IN_STOCK** ของ `update()`
 *
 * ต่างจาก `evaluateReadiness` (product-readiness.util.ts) ที่ถามว่า "พร้อม**ขึ้นเว็บ**ไหม"
 * — อันนั้นบังคับ cashPrice, gallery, แบรนด์ Apple, isOnlineVisible. ที่นี่ถามแค่ว่า
 * "ขายหน้าร้านได้ไหม" ⇒ ราคาเงินสด **หรือ** ราคาผ่อนก็พอ และยอมรับ `prices[]` เป็น
 * fallback สำหรับเครื่องเก่าที่ตั้งราคาไว้ก่อนยุคคอลัมน์ (B0 write-through)
 *
 * Fix round 1 (minor): กรองแถว `prices[]` ที่ถูก soft-delete ออก — `productInclude.prices`
 * ไม่ได้กรอง `deletedAt: null` ให้ (มันเป็น include ที่ผู้อ่านหลายตัวใช้ร่วมกัน) ⇒ ถ้าไม่กรอง
 * ตรงนี้ ราคาที่ "ลบทิ้งไปแล้ว" จะยังนับเป็นราคาที่ใช้ได้
 */
function hasSellingPrice(product: ProductPriceShape): boolean {
  if (isPositiveAmount(product.cashPrice) || isPositiveAmount(product.installmentPrice)) {
    return true;
  }
  return (product.prices ?? []).some((r) => !r.deletedAt && isPositiveAmount(r.amount));
}

/** ข้อความเดียวของด่านราคา — ใช้ทั้งฝั่ง PATCH และฝั่งปุ่ม เพื่อไม่ให้กติกาแตกเป็นสองสำนวน */
const NO_PRICE_MESSAGE =
  'ยังไม่ได้ตั้งราคาขายของเครื่องนี้ — ตั้งราคาขาย (เงินสด/ผ่อน) ก่อนจึงจะนำเข้าคลังพร้อมขายได้ ' +
  '(เครื่องที่อยู่ในคลังต้องขายที่ POS ได้ทันที)';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(filters: {
    search?: string;
    branchId?: string;
    status?: string | string[];
    category?: string;
    brand?: string;
    model?: string;
    storage?: string;
    supplierId?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.branchId) where.branchId = filters.branchId;
    // status รับได้ทั้ง ?status=A, ?status=A&status=B (array) และ ?status=A,B
    // — FE ของ B1 ส่งแบบ comma เพื่อไม่ต้องพึ่ง query serializer ของ axios
    const statuses = (Array.isArray(filters.status) ? filters.status : [filters.status ?? ''])
      .flatMap((s) => String(s).split(','))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (statuses.length === 1) where.status = statuses[0];
    else if (statuses.length > 1) where.status = { in: statuses };
    if (filters.category) where.category = filters.category;
    if (filters.brand) where.brand = filters.brand;
    if (filters.model) where.model = filters.model;
    if (filters.storage) where.storage = filters.storage;
    if (filters.supplierId) where.supplierId = filters.supplierId;

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { model: { contains: filters.search, mode: 'insensitive' } },
        { imeiSerial: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: productInclude,
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
    return product;
  }

  async create(dto: CreateProductDto) {
    const { prices, costPrice, warrantyExpireDate, cashPrice, installmentPrice, accessoriesIncluded, ...data } = dto;

    // DTO guard: prices[] ที่มี isDefault:true (หรือ fallback ของ element แรกที่ไม่ได้ระบุ)
    // มากกว่า 1 รายการ จะชน DB partial unique index `product_prices_one_default` เป็น P2002
    // ดิบ → ต้องคำนวณ "effective default" หลัง apply fallback `isDefault ?? (i===0)` ก่อนนับ
    // (นับแค่ isDefault===true ตรงๆ พลาดเคส element 0 ที่ fallback เป็น true โดยปริยาย เช่น
    // [{...}, {..., isDefault:true}] → element 0 fallback true + element 1 explicit true = ชน)
    const effectiveDefaultCount = (prices ?? []).filter((p, i) => p.isDefault ?? i === 0).length;
    if (effectiveDefaultCount > 1) {
      throw new BadRequestException('ตั้งราคา default ได้เพียงรายการเดียว');
    }

    const isInStock = !data.status || data.status === 'IN_STOCK';
    // 3 สถานะ: undefined = ไม่แตะ | null = เคลียร์คอลัมน์ | Decimal = ตั้งราคา
    // ห้ามยุบเป็น `!== undefined ? new Prisma.Decimal(x) : undefined` — new Prisma.Decimal(null) throw
    const cashDecimal =
      cashPrice === undefined ? undefined : cashPrice === null ? null : new Prisma.Decimal(cashPrice);
    const installmentDecimal =
      installmentPrice === undefined
        ? undefined
        : installmentPrice === null
          ? null
          : new Prisma.Decimal(installmentPrice);
    // Json? column: ส่ง JS `null` ตรงๆ เขียนเป็น JSON literal null (column ไม่เป็น SQL NULL —
    // `accessories_included IS NULL` จะ false, Prisma filter หา null ไม่เจอ) ต้องแปลงเป็น
    // Prisma.DbNull ตอนต้องการ "เคลียร์" คอลัมน์จริงๆ
    const accessoriesIncludedValue =
      accessoriesIncluded === undefined
        ? undefined
        : accessoriesIncluded === null
          ? Prisma.DbNull
          : accessoriesIncluded;

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          ...data,
          costPrice,
          ...(cashDecimal !== undefined ? { cashPrice: cashDecimal } : {}),
          ...(installmentDecimal !== undefined ? { installmentPrice: installmentDecimal } : {}),
          ...(accessoriesIncludedValue !== undefined
            ? { accessoriesIncluded: accessoriesIncludedValue }
            : {}),
          warrantyExpireDate: warrantyExpireDate ? new Date(warrantyExpireDate) : null,
          ...(isInStock ? { stockInDate: new Date() } : {}),
          ...(prices && prices.length > 0
            ? {
                prices: {
                  create: prices.map((p, i) => ({
                    label: p.label,
                    amount: p.amount,
                    isDefault: p.isDefault ?? (i === 0),
                  })),
                },
              }
            : {}),
        } as Prisma.ProductUncheckedCreateInput,
      });

      // B0 §2.1: ไม่ได้กรอกราคาเงินสดมา → ลองเติมจากตารางราคากลาง
      // `=== undefined` ตั้งใจ: ส่ง `cashPrice: null` มาชัดๆ = "ยืนยันว่ายังไม่มีราคา"
      // ห้าม autofill ทับ (ไม่งั้นกดล้างราคาแล้วราคาเด้งกลับมาเอง)
      //
      // Fix round 1 [Critical]: guard เดิมเช็คแค่คอลัมน์ cashPrice อย่างเดียว — แต่
      // ProductCreatePage (หน้าเพิ่มสินค้าหลัก) ไม่เคยส่งคอลัมน์ cashPrice เลย ส่งแต่
      // prices[] เสมอ ⇒ autofill ทำงานทุกครั้งที่เพิ่มสินค้าผ่านหน้าจอ แล้ว
      // syncPriceRowsFromColumns ภายใน util จะ relabel+overwrite แถว default ที่พนักงาน
      // กรอกเอง (repro จริง: กรอก 25,000 → โดนเทมเพลตทับเป็น 28,900 เงียบๆ) — เลือกวิธี
      // "skip autofill ไปเลยเมื่อมี prices[]" แทนการ derive currentCashPrice จาก
      // effective-default row เพราะเรียบกว่า/ไม่ต้อง duplicate logic การหา default row
      // ที่มีอยู่แล้วด้านบน (บรรทัด ~90) — ผู้ใช้ที่ตั้งใจส่ง prices[] มา ถือว่า "มีราคาแล้ว"
      // เสมอไม่ว่า amount จะเท่าไหร่ (แม้จะเป็น 0 หรือราคาพิเศษก็ตาม ไม่ใช่หน้าที่ autofill
      // ตัดสินใจแทน)
      const hasManualPrices = (prices?.length ?? 0) > 0;
      if (cashDecimal === undefined && !hasManualPrices) {
        await autofillProductPriceFromTemplate(
          tx,
          {
            productId: product.id,
            brand: product.brand,
            model: product.model,
            storage: product.storage,
            category: product.category,
            hasWarranty: resolveHasWarranty(product),
            currentCashPrice: null,
          },
          this.logger,
        );
      }

      // B0 §2.1: write-through คอลัมน์ → prices[] (ผู้อ่านเดิม POS/สัญญา/บอท ไม่พัง)
      // null ส่งเข้าไปได้ — util จะ "ข้ามฟิลด์นั้น" (ไม่ sync ไม่ลบแถว) ตามกติกาข้อ 4
      await syncPriceRowsFromColumns(tx, product.id, {
        cashPrice: cashDecimal ?? null,
        installmentPrice: installmentDecimal ?? null,
      });

      return tx.product.findUnique({ where: { id: product.id }, include: productInclude });
    });
  }

  async update(id: string, dto: UpdateProductDto, actorUserId?: string) {
    const existing = await this.findOne(id);
    // สถานะขาย/จอง/ยึด ระบบตั้งผ่าน flow — ห้ามแก้ข้าม lifecycle จากหน้าแก้ไขสินค้า
    if (dto.status !== undefined) {
      assertManualStatusChangeAllowed(existing.status, dto.status);
    }

    /**
     * Fix round 1 [Important 1] — **ด่านปลายทาง** ไม่ใช่ด่านราย transition
     *
     * `MANUAL_TRANSITION_DENY` ปิดได้แค่คู่ `REFURBISHED → IN_STOCK` ตรง ๆ; ผู้ใช้ที่
     * เพิ่งโดนด่านราคาบล็อกจากปุ่ม สามารถ "ฟอกสถานะ" ผ่านสถานะกลาง
     * (`REFURBISHED → QC_PENDING → IN_STOCK`) แล้วเข้าคลังได้ในสองคลิก — เดิมขาที่สอง
     * ไม่มีเช็คราคา ไม่มี `stockInDate` ไม่มี AuditLog ⇒ ได้ผลลัพธ์ที่ "เงียบกว่า" ปุ่ม
     *
     * ตอนนี้ทุกเส้นทางที่ลงเอยที่ IN_STOCK ต้องผ่านกติกาเดียวกัน: มีราคาขาย +
     * `stockInDate` ใหม่ + AuditLog `PRODUCT_RETURNED_TO_STOCK` ⇒ การฟอกสถานะไม่ได้
     * ประโยชน์อะไรเลยนอกจากเสีย audit trail เพิ่มหนึ่งแถว
     *
     * เช็ค "ราคาหลังอัปเดต" ไม่ใช่ราคาปัจจุบัน — ผู้ใช้ตั้งราคาพร้อมเปลี่ยนสถานะในใบเดียวได้
     */
    const entersStock = dto.status === 'IN_STOCK' && existing.status !== 'IN_STOCK';
    if (entersStock) {
      const effective: ProductPriceShape = {
        cashPrice: dto.cashPrice !== undefined ? dto.cashPrice : existing.cashPrice,
        installmentPrice:
          dto.installmentPrice !== undefined ? dto.installmentPrice : existing.installmentPrice,
        prices: existing.prices,
      };
      if (!hasSellingPrice(effective)) {
        throw new BadRequestException(NO_PRICE_MESSAGE);
      }
    }
    // แก้ IMEI/Serial บนเครื่องที่ยังถูกถือครอง = ปลด IMEI เดิมให้ว่างโดยไม่ต้องลบ
    // (ช่องเดียวกับ remove() และเปิดกว้างกว่าเพราะ PATCH ให้สิทธิ์ถึง BRANCH_MANAGER)
    const identityFields = changedIdentityFields(existing, dto);
    if (identityFields.length > 0) {
      await assertProductNotHeld(this.prisma, existing, 'CHANGE_IDENTITY', identityFields);
    }
    const { costPrice, warrantyExpireDate, cashPrice, installmentPrice, accessoriesIncluded, ...data } = dto;
    const touchesPrice = cashPrice !== undefined || installmentPrice !== undefined;
    // 3 สถานะเหมือน create — null ต้องเขียนลงคอลัมน์ได้ (ล้างราคา) ห้ามส่งเข้า Prisma.Decimal
    const cashDecimal =
      cashPrice === undefined ? undefined : cashPrice === null ? null : new Prisma.Decimal(cashPrice);
    const installmentDecimal =
      installmentPrice === undefined
        ? undefined
        : installmentPrice === null
          ? null
          : new Prisma.Decimal(installmentPrice);
    // Json? column — เหมือน create: null ต้องแปลงเป็น Prisma.DbNull ไม่งั้นเขียนเป็น JSON
    // literal null (SQL column ไม่เป็น NULL จริง)
    const accessoriesIncludedValue =
      accessoriesIncluded === undefined
        ? undefined
        : accessoriesIncluded === null
          ? Prisma.DbNull
          : accessoriesIncluded;

    return this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...data,
          // เข้าคลังเมื่อไร = วันที่เครื่องกลายเป็นสต็อกที่ขายได้ (นิยามเดียวกับ PO receiving /
          // markReadyForSale / ปุ่มนำเข้าคลัง) — เส้นทาง PATCH ต้องสตางค์ให้ตรงกัน
          ...(entersStock ? { stockInDate: new Date() } : {}),
          ...(costPrice !== undefined ? { costPrice } : {}),
          ...(cashDecimal !== undefined ? { cashPrice: cashDecimal } : {}),
          ...(installmentDecimal !== undefined ? { installmentPrice: installmentDecimal } : {}),
          ...(accessoriesIncludedValue !== undefined
            ? { accessoriesIncluded: accessoriesIncludedValue }
            : {}),
          // แก้ราคามือ = เลิกเป็นราคาที่เติมอัตโนมัติ (badge ฝั่ง B1 อ่านฟิลด์นี้)
          ...(touchesPrice ? { priceAutofilledAt: null } : {}),
          ...(warrantyExpireDate !== undefined
            ? { warrantyExpireDate: warrantyExpireDate ? new Date(warrantyExpireDate) : null }
            : {}),
        } as Prisma.ProductUncheckedUpdateInput,
      });

      if (touchesPrice) {
        await syncPriceRowsFromColumns(tx, id, {
          cashPrice: cashDecimal ?? null,
          installmentPrice: installmentDecimal ?? null,
        });
      }

      // audit ชุดเดียวกับปุ่ม (action เดียวกัน) — `actorUserId` มาจาก controller เสมอ;
      // ผู้เรียกภายในที่ไม่มีตัวตนผู้ใช้จะข้ามการเขียน audit แต่ยังได้ stockInDate
      if (entersStock && actorUserId) {
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: 'PRODUCT_RETURNED_TO_STOCK',
            entity: 'product',
            entityId: id,
            oldValue: { status: existing.status, via: 'PATCH' },
            newValue: { status: 'IN_STOCK', via: 'PATCH' },
          },
        });
      }

      return tx.product.findUnique({ where: { id }, include: productInclude });
    });
  }

  /**
   * นำเครื่องมือสองที่รับคืนมา (ยึดเครื่อง / เปลี่ยนเครื่อง) กลับเข้าคลังพร้อมขาย
   *
   * คำตัดสินเจ้าของ 2026-08-21: **หน้าร้านกดเอง** — POS ยังขายเฉพาะ `IN_STOCK`
   * ตามเดิม (`sale-writer.service.ts`) เพราะระหว่าง REFURBISHED กับพร้อมขายจริงมี
   * จังหวะตรวจสภาพ/ตั้งราคา. endpoint นี้คือจุดที่บันทึกว่าใครยืนยัน
   *
   * **ด่านราคา = บังคับ "ยืนยันราคา" ไม่ใช่แค่ "มีราคา" (fix round 1, Important 2).**
   * รอบแรกเขียนด่านเป็น `hasSellingPrice(product)` ด้วยเหตุผลที่ **กลับด้านกับความจริง**:
   * สำรวจแล้วพบว่า **ไม่มี flow ไหนล้าง `cashPrice`/`installmentPrice` เลย** — A.4
   * (เปลี่ยนเครื่อง) เขียนแค่ `costPrice`, ยึดเครื่องเขียน `cashPrice` จาก resellPrice
   * ⇒ เครื่องมือสองที่คืนมา **ยังถือราคาเครื่องใหม่ติดมาเต็ม ๆ** ด่านแบบเดิมจึงผ่านเสมอ
   * และให้ความมั่นใจผิด ๆ ว่า "มีคนตั้งราคาแล้ว" ทั้งที่ราคาที่ค้างอยู่คือราคาเครื่องใหม่
   * ⇒ เครื่องมือสองจะเข้าคลังไปขายที่ราคาเครื่องใหม่
   *
   * ตอนนี้ผู้กดต้องส่งราคาที่ยืนยัน (เงินสด และ/หรือ ผ่อน) มาด้วยเสมอ แล้วราคานั้นถูก
   * **เขียนทับใน tx เดียวกับการเปลี่ยนสถานะ** + บันทึกราคาเก่า→ใหม่ลง AuditLog
   * (UI เติมราคาปัจจุบันให้ล่วงหน้าพร้อมป้ายว่าเป็นราคาจากตอนขายครั้งก่อน — กดยืนยัน
   * โดยไม่แก้ก็ได้ แต่ต้องผ่านตาคน ซึ่งคือเจตนา "มีจังหวะตรวจสภาพ/ตั้งราคาก่อนขาย")
   *
   * `stockInDate` ตั้งใหม่ทุกครั้ง: นิยามของคอลัมน์นี้คือ "วันที่เครื่องกลายเป็นสต็อกที่
   * ขายได้" (PO receiving / `markReadyForSale` ก็ตั้งด้วยนิยามนี้) — ไม่งั้นเครื่องจาก
   * เปลี่ยนเครื่องจะติดวันที่รับเข้าครั้งแรก (เก่าหลายเดือน) แล้วรายงานอายุสต็อกอ่านผิด
   */
  async returnToStock(
    id: string,
    userId: string,
    input: { cashPrice?: number; installmentPrice?: number; note?: string },
  ) {
    const product = await this.findOne(id);

    if (product.status !== 'REFURBISHED') {
      throw new BadRequestException(
        `สินค้าอยู่สถานะ ${productStatusLabel(product.status)} — ปุ่มนี้ใช้ได้เฉพาะเครื่องมือสองที่รับคืนแล้ว ` +
          '(สถานะ REFURBISHED (ซ่อมแล้ว)) เท่านั้น: เครื่องที่ขาย/จอง/ยึดอยู่ต้องจัดการผ่าน flow ของมันก่อน',
      );
    }

    const cashDecimal = positiveDecimalOrNull(input.cashPrice);
    const installmentDecimal = positiveDecimalOrNull(input.installmentPrice);
    if (!cashDecimal && !installmentDecimal) {
      throw new BadRequestException(
        'กรุณายืนยันราคาขายของเครื่องนี้ก่อนนำเข้าคลัง (ราคาเงินสด และ/หรือ ราคาผ่อน ต้องมากกว่า 0) — ' +
          'ราคาที่ค้างอยู่บนเครื่องคือราคาจากตอนขายครั้งก่อน ต้องให้คนตรวจก่อนขายซ้ำ',
      );
    }

    const before = {
      cashPrice: product.cashPrice?.toString() ?? null,
      installmentPrice: product.installmentPrice?.toString() ?? null,
    };

    return this.prisma.$transaction(async (tx) => {
      // updateMany + count===1 = ด่านกันแข่ง (double-click / สองคนกดพร้อมกัน): เงื่อนไข
      // สถานะอยู่ใน WHERE เอง ⇒ ผู้กดคนที่สองไม่ได้แถว และไม่มี AuditLog ใบซ้ำตามมา
      const locked = await tx.product.updateMany({
        where: { id, status: 'REFURBISHED', deletedAt: null },
        data: {
          status: 'IN_STOCK',
          stockInDate: new Date(),
          // ไม่ส่งราคาไหนมา = ไม่แตะคอลัมน์นั้น (ไม่ล้างเป็น null)
          ...(cashDecimal ? { cashPrice: cashDecimal } : {}),
          ...(installmentDecimal ? { installmentPrice: installmentDecimal } : {}),
          // ราคาที่มนุษย์ยืนยัน = เลิกเป็นราคาที่เติมอัตโนมัติ (badge ฝั่ง B1 อ่านฟิลด์นี้)
          priceAutofilledAt: null,
        },
      });
      if (locked.count !== 1) {
        throw new ConflictException('สถานะสินค้าเปลี่ยนไปแล้ว — โหลดหน้าใหม่แล้วลองอีกครั้ง');
      }

      // write-through คอลัมน์ → แถว `ProductPrice` เหมือนเส้นทางแก้ราคาปกติ (B0 §2.1)
      await syncPriceRowsFromColumns(tx, id, {
        cashPrice: cashDecimal,
        installmentPrice: installmentDecimal,
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'PRODUCT_RETURNED_TO_STOCK',
          entity: 'product',
          entityId: id,
          oldValue: { status: product.status, ...before },
          newValue: {
            status: 'IN_STOCK',
            cashPrice: cashDecimal?.toString() ?? before.cashPrice,
            installmentPrice: installmentDecimal?.toString() ?? before.installmentPrice,
            note: input.note ?? null,
          },
        },
      });

      return tx.product.findUnique({ where: { id }, include: productInclude });
    });
  }

  async remove(id: string) {
    const product = await this.findOne(id);

    // ด่านเดียวกับตอนแก้ IMEI (product-hold.util.ts) — ลบ = ปลด IMEI ออกจาก
    // partial unique index ⇒ รับเครื่องเดิมเข้าสต็อกแล้วขายซ้ำได้
    await assertProductNotHeld(this.prisma, product, 'DELETE');

    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // === Ownership Tracking (SHOP ↔ FINANCE) ===

  /**
   * Transfer legal ownership of a product to another company entity.
   *
   * Use cases:
   *  - Installment contract activated → SHOP → FINANCE
   *  - Customer completes payoff  → FINANCE → customer (ownership cleared)
   *  - Repossession / early termination → stays with FINANCE
   *
   * Must run inside a Prisma transaction together with the triggering
   * contract/inter-company record so ownership cannot drift from the
   * journal. Pass `tx` when calling from a larger transaction.
   */
  async transferOwnership(
    productId: string,
    toCompanyId: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const product = await client.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, ownedByCompanyId: true },
    });
    if (!product) {
      throw new NotFoundException('ไม่พบสินค้า');
    }
    if (product.ownedByCompanyId === toCompanyId) {
      return product;
    }
    this.logger.log(
      `Product ${productId} ownership: ${product.ownedByCompanyId ?? 'null'} → ${toCompanyId ?? 'null'}`,
    );
    return client.product.update({
      where: { id: productId },
      data: { ownedByCompanyId: toCompanyId },
      select: { id: true, ownedByCompanyId: true },
    });
  }

  // === Workflow Tracker ===

  /**
   * Get workflow status for a product showing which step it's at
   * Steps: 1.เช็ค Stock → 2.สั่งสินค้า → 3.ตรวจรับ → 4.ถ่ายรูป 6 มุม → 5.เข้าคลัง → 6.ส่งไปสาขา → 7.สาขาเช็ครับ
   */
  async getWorkflowStatus(productId: string) {
    const stockTransferSelect = {
      id: true,
      batchNumber: true,
      productId: true,
      fromBranchId: true,
      toBranchId: true,
      transferredBy: true,
      notes: true,
      status: true,
      confirmedById: true,
      confirmedAt: true,
      dispatchedById: true,
      dispatchedAt: true,
      trackingNote: true,
      expectedDeliveryDate: true,
      createdAt: true,
    };

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        po: { select: { id: true, poNumber: true, status: true, approvedBy: { select: { name: true } } } },
        branch: { select: { id: true, name: true, isMainWarehouse: true } },
        supplier: { select: { id: true, name: true } },
        receivingItem: {
          select: {
            id: true, status: true, createdAt: true,
            receiving: { select: { receivedBy: { select: { name: true } } } },
          },
        },
        productPhotos: { select: { id: true, isCompleted: true } },
      },
    });

    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

    // Get photo completion count without loading base64 data
    let photoAngles = 0;
    if (product.productPhotos) {
      const raw = await this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT (CASE WHEN front IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN back IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN "left" IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN "right" IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN top IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN bottom IS NOT NULL THEN 1 ELSE 0 END) as count
        FROM product_photos WHERE product_id = ${productId}`;
      photoAngles = Number(raw[0]?.count || 0);
    }

    // Find transfer history
    const transfers = await this.prisma.stockTransfer.findMany({
      where: { productId, deletedAt: null },
      select: {
        ...stockTransferSelect,
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        branchReceiving: { select: { id: true, status: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestTransfer = transfers[0] || null;

    const isUsedPhone = product.category === 'PHONE_USED';
    const photoCompleted = product.productPhotos?.isCompleted === true;

    const rawSteps: { name: string; status: 'completed' | 'in_progress' | 'pending'; description: string }[] = [
      {
        name: 'เช็ค Stock',
        status: 'completed',
        description: 'ตรวจสอบสต๊อคก่อนสั่งซื้อ',
      },
      {
        name: 'สั่งสินค้า (PO)',
        status: product.poId ? 'completed' : 'pending',
        description: product.po ? `PO: ${product.po.poNumber} (${product.po.status})` : 'ยังไม่ได้สั่งซื้อ',
      },
      {
        name: 'ตรวจรับสินค้า (QC)',
        status: product.receivingItem ? 'completed' : 'pending',
        description: product.receivingItem
          ? `QC: ${product.receivingItem.status} (${formatDateShort(product.receivingItem.createdAt)})`
          : 'ยังไม่ได้ตรวจรับ',
      },
    ];

    // ถ่ายรูป 6 มุม เฉพาะมือสอง
    if (isUsedPhone) {
      rawSteps.push({
        name: 'ถ่ายรูปสินค้า 6 มุม',
        status: photoCompleted
          ? 'completed'
          : product.status === 'PHOTO_PENDING' ? 'in_progress'
          : photoAngles > 0 ? 'in_progress'
          : 'pending',
        description: photoCompleted
          ? 'ถ่ายรูปครบ 6 มุมแล้ว'
          : photoAngles > 0
          ? `ถ่ายแล้ว ${photoAngles}/6 มุม`
          : 'รอถ่ายรูปสินค้า',
      });
    }

    rawSteps.push(
      {
        name: 'สินค้าเข้าคลัง',
        status: (['IN_STOCK', 'RESERVED', 'SOLD_INSTALLMENT', 'SOLD_CASH', 'SOLD_RESELL'].includes(product.status))
          ? 'completed'
          : product.status === 'QC_PENDING' ? 'in_progress'
          : product.status === 'PHOTO_PENDING' ? 'pending'
          : 'pending',
        description: product.status === 'QC_PENDING' ? 'รอยืนยัน QC เข้าคลัง'
          : product.status === 'PHOTO_PENDING' ? 'รอถ่ายรูป 6 มุมก่อนเข้าคลัง'
          : product.status === 'IN_STOCK' ? 'อยู่ในคลัง'
          : 'รอดำเนินการ',
      },
      {
        name: 'ส่งไปสาขา',
        status: latestTransfer
          ? latestTransfer.status === 'CONFIRMED' ? 'completed'
            : latestTransfer.status === 'REJECTED' ? 'pending'
            : latestTransfer.status === 'IN_TRANSIT' ? 'in_progress'
            : 'pending'
          : 'pending',
        description: latestTransfer
          ? `${latestTransfer.fromBranch.name} → ${latestTransfer.toBranch.name} (${latestTransfer.status})`
          : 'ยังไม่ได้โอนไปสาขา',
      },
      {
        name: 'สาขาเช็ครับ',
        status: latestTransfer?.branchReceiving
          ? 'completed'
          : latestTransfer?.status === 'IN_TRANSIT' ? 'pending'
          : 'pending',
        description: latestTransfer?.branchReceiving
          ? `ตรวจรับแล้ว (${latestTransfer.branchReceiving.status})`
          : 'ยังไม่ได้ตรวจรับที่สาขา',
      },
    );

    const steps = rawSteps.map((s, i) => ({ step: i + 1, ...s }));

    let currentStep = 1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].status === 'completed' || steps[i].status === 'in_progress') {
        currentStep = steps[i].step;
        break;
      }
    }

    return {
      productId: product.id,
      productName: product.name,
      currentStep,
      status: product.status,
      branch: product.branch,
      steps,
    };
  }

  // === Get available brands for filter ===
  async getBrands() {
    const brands = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    });
    return brands.map((b) => b.brand);
  }

  /** B0 §2.3 — checklist "พร้อมขึ้นเว็บ" รายข้อ (หน้าสินค้า admin ใน B1 กินอันนี้) */
  async getReadiness(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: {
        id: true, name: true, brand: true, category: true, status: true,
        cashPrice: true, installmentPrice: true, gallery: true,
        conditionGrade: true, isOnlineVisible: true, deletedAt: true,
        priceAutofilledAt: true,
      },
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
    const result = evaluateReadiness(product);
    return {
      productId: product.id,
      // ⚠️ ชื่อคีย์ต้องเป็น `isReady` — B1 (useProductReadiness/ReadinessCard/fixture)
      // อ่าน `data.isReady` ทั้งหมด; ถ้าส่ง `ready` B1 จะได้ undefined = โชว์
      // "ยังขึ้นเว็บไม่ได้" ตลอด โดยไม่มีเทสต์ไหนแดง
      isReady: result.ready,
      checks: result.checks,
      // non-blocking note (owner decision 2026-08) — B1 ใช้โชว์ป้ายเตือน "สินค้าตัวอย่าง"
      // ไม่กระทบ isReady (ดู evaluateReadiness/ProductReadinessOptions.excludeDemo)
      isDemo: result.isDemo,
      // B1 โชว์สวิตช์ "แสดงบนเว็บ" คู่กับการ์ดนี้ — ส่งค่ามาด้วยจะได้ไม่ต้องยิงซ้ำ
      isOnlineVisible: product.isOnlineVisible,
      priceAutofilledAt: product.priceAutofilledAt,
      hasInstallmentPrice: product.installmentPrice != null,
    };
  }
}

/** สรุปสถานะประกันของเครื่องสำหรับเลือกแถวตารางราคากลาง — null = ไม่รู้ */
function resolveHasWarranty(p: {
  category: string;
  warrantyExpired: boolean | null;
  warrantyExpireDate: Date | null;
}): boolean | null {
  if (p.category !== 'PHONE_USED') return false;
  if (p.warrantyExpired === true) return false;
  if (p.warrantyExpired === false) return true;
  if (p.warrantyExpireDate) return p.warrantyExpireDate.getTime() > Date.now();
  return null;
}
