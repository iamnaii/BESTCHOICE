import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import {
  CreateTradeInDto,
  AppraiseTradeInDto,
  AcceptTradeInDto,
  UpdateTradeInDto,
  QuickBuyTradeInDto,
  UpsertValuationDto,
} from './dto/trade-in.dto';
import { TradeInVoucherService } from './services/voucher.service';
import { Prisma, PrismaClient } from '@prisma/client';

// tradeInValuation is added via migration — cast prisma to any until `prisma generate` runs
type PrismaAny = PrismaClient & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

@Injectable()
export class TradeInService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private voucher: TradeInVoucherService,
  ) {}

  // ─── Validation helpers ───────────────────────────────────
  private validateThaiNationalId(id: string): boolean {
    if (!/^\d{13}$/.test(id)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(id[i]) * (13 - i);
    const check = (11 - (sum % 11)) % 10;
    return check === parseInt(id[12]);
  }

  /** Decode `data:image/jpeg;base64,...` หรือ raw base64 → Buffer + size guard */
  private decodeBase64Image(input: string): { buffer: Buffer; contentType: string } {
    const MAX_BYTES = 5 * 1024 * 1024; // 5MB
    const match = input.match(/^data:(image\/\w+);base64,(.+)$/);
    const base64 = match ? match[2] : input;
    const contentType = match ? match[1] : 'image/jpeg';
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > MAX_BYTES) {
      throw new BadRequestException('รูปบัตรประชาชนต้องไม่เกิน 5MB');
    }
    if (buffer.length < 100) {
      throw new BadRequestException('รูปบัตรประชาชนเสียหายหรือว่างเปล่า');
    }
    return { buffer, contentType };
  }

  // ─── IMEI duplicate / blacklist check ─────────────────────
  /**
   * เช็คว่า IMEI นี้เคยถูกรับซื้อ/อยู่ในระบบหรือไม่
   * Returns: 'clean' | 'duplicate'
   */
  async checkImei(imei: string): Promise<{
    result: 'clean' | 'duplicate';
    occurrences: Array<{ id: string; status: string; createdAt: Date }>;
  }> {
    if (!/^\d{15}$/.test(imei)) {
      throw new BadRequestException('IMEI ต้องเป็นตัวเลข 15 หลัก');
    }
    const matches = await this.prisma.tradeIn.findMany({
      where: { imei, deletedAt: null },
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return {
      result: matches.length > 0 ? 'duplicate' : 'clean',
      occurrences: matches,
    };
  }

  // ─── Create ───────────────────────────────────────────────
  async create(dto: CreateTradeInDto) {
    // Walk-in หรือ existing customer ก็ได้ — แต่ต้องมีอย่างใดอย่างหนึ่ง
    if (!dto.customerId && !dto.sellerName) {
      throw new BadRequestException(
        'ต้องระบุลูกค้าหรือข้อมูลผู้ขาย (ชื่อ) อย่างน้อยหนึ่งอย่าง',
      );
    }

    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer || customer.deletedAt) {
        throw new NotFoundException('ไม่พบลูกค้า');
      }
    }

    if (dto.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
      });
      if (!product || product.deletedAt) {
        throw new NotFoundException('ไม่พบสินค้า');
      }
    }

    if (
      dto.sellerIdCardNumber &&
      !this.validateThaiNationalId(dto.sellerIdCardNumber)
    ) {
      throw new BadRequestException('เลขบัตรประชาชนไม่ถูกต้อง');
    }

    // เช็ค IMEI ซ้ำ (anti-stolen-goods พื้นฐาน)
    let imeiBlacklistResult: 'clean' | 'duplicate' | null = null;
    if (dto.imei) {
      const check = await this.checkImei(dto.imei);
      imeiBlacklistResult = check.result;
    }

    // อัปโหลดรูปบัตร ปชช. ถ้ามี
    let idCardPhotoKey: string | undefined;
    if (dto.idCardPhotoBase64) {
      const { buffer, contentType } = this.decodeBase64Image(dto.idCardPhotoBase64);
      const ext = contentType.split('/')[1] || 'jpg';
      const key = `trade-ins/_pending/${Date.now()}-id-card.${ext}`;
      await this.storage.upload(key, buffer, contentType);
      idCardPhotoKey = key;
    }

    return this.prisma.tradeIn.create({
      data: {
        customerId: dto.customerId,
        productId: dto.productId,
        branchId: dto.branchId,
        deviceBrand: dto.deviceBrand,
        deviceModel: dto.deviceModel,
        deviceStorage: dto.deviceStorage,
        deviceColor: dto.deviceColor,
        deviceCondition: dto.deviceCondition,
        imei: dto.imei,
        estimatedValue: dto.estimatedValue,
        notes: dto.notes,
        sellerName: dto.sellerName,
        sellerPhone: dto.sellerPhone,
        sellerIdCardNumber: dto.sellerIdCardNumber,
        sellerAddress: dto.sellerAddress,
        idCardPhotoUrl: idCardPhotoKey,
        idCardSource: dto.idCardSource,
        sellerConsentSigned: dto.sellerConsentSigned ?? false,
        policeReportAcknowledged: dto.policeReportAcknowledged ?? false,
        imeiBlacklistResult,
        imeiBlacklistCheckedAt: dto.imei ? new Date() : null,
        status: 'PENDING_APPRAISAL',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Update (basic info) ──────────────────────────────────
  async update(id: string, dto: UpdateTradeInDto) {
    const existing = await this.findOne(id);
    // ห้ามแก้ข้อมูลผู้ขายหลังจาก accept แล้ว — กันลบหลักฐาน anti-stolen-goods
    if (existing.status === 'ACCEPTED' || existing.status === 'COMPLETED') {
      const sellerFields = [
        dto.sellerName,
        dto.sellerPhone,
        dto.sellerIdCardNumber,
        dto.sellerAddress,
      ];
      if (sellerFields.some((v) => v !== undefined)) {
        throw new BadRequestException(
          'ไม่สามารถแก้ข้อมูลผู้ขายหลังจากยอมรับรายการแล้ว',
        );
      }
    }
    if (
      dto.sellerIdCardNumber &&
      !this.validateThaiNationalId(dto.sellerIdCardNumber)
    ) {
      throw new BadRequestException('เลขบัตรประชาชนไม่ถูกต้อง');
    }
    return this.prisma.tradeIn.update({
      where: { id },
      data: { ...dto },
    });
  }

  // ─── List / Find ──────────────────────────────────────────
  async findAll(filters: {
    customerId?: string;
    branchId?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { customerId, branchId, status, search, page = 1, limit = 50 } = filters;
    const where: Record<string, unknown> = { deletedAt: null };
    if (customerId) where.customerId = customerId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    // Search by device, IMEI, seller name/phone, voucher number, customer name
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { deviceBrand: { contains: q, mode: 'insensitive' } },
        { deviceModel: { contains: q, mode: 'insensitive' } },
        { imei: { contains: q } },
        { sellerName: { contains: q, mode: 'insensitive' } },
        { sellerPhone: { contains: q } },
        { voucherNumber: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.tradeIn.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true } },
          appraisedBy: { select: { id: true, name: true } },
          idCardVerifiedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.tradeIn.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async findOne(id: string) {
    const tradeIn = await this.prisma.tradeIn.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true, nationalId: true, addressIdCard: true } },
        product: { select: { id: true, name: true, brand: true, model: true } },
        branch: { select: { id: true, name: true } },
        appraisedBy: { select: { id: true, name: true } },
        idCardVerifiedBy: { select: { id: true, name: true } },
      },
    });
    if (!tradeIn || tradeIn.deletedAt) {
      throw new NotFoundException('ไม่พบรายการเทรดอิน');
    }
    return tradeIn;
  }

  // ─── Appraise ─────────────────────────────────────────────
  /** offeredPrice must stay within ±15% of the valuation base table (P2Q2=A). */
  static readonly PRICE_CEILING_RATIO = 1.15;
  static readonly PRICE_FLOOR_RATIO = 0.85;

  /**
   * T5-C17: appraise() is now idempotent per price.
   * - First call sets offeredPrice and locks it (appraisalLocked=true,
   *   firstAppraisedAt=now).
   * - Subsequent calls with the SAME offeredPrice are no-ops (return current).
   * - Subsequent calls with a DIFFERENT offeredPrice are rejected unless
   *   userRole === 'OWNER' AND dto.force === true AND dto.forceReason supplied.
   *   In that case an AuditLog entry is written.
   *
   * Why: prevents price drift (staff re-appraising downward until the seller
   * agrees). The lock is authoritative; the existing ±15% ceiling guard
   * stays for the first-appraise path.
   */
  async appraise(
    id: string,
    dto: AppraiseTradeInDto,
    userId: string,
    userRole?: string,
  ) {
    const tradeIn = await this.findOne(id);

    // T5-C17: If already locked, enforce immutability unless OWNER-forced.
    const previousPrice =
      tradeIn.offeredPrice !== null && tradeIn.offeredPrice !== undefined
        ? Number(tradeIn.offeredPrice)
        : null;

    if (tradeIn.appraisalLocked) {
      const sameRequest = previousPrice !== null && previousPrice === dto.offeredPrice;
      if (sameRequest) {
        // Idempotent no-op: caller asked to set the same price again.
        return tradeIn;
      }
      // Different price requested — OWNER override gate
      if (!dto.force) {
        throw new ForbiddenException(
          `รายการนี้ถูกตีราคาไปแล้ว (${previousPrice?.toLocaleString()} บาท) — ` +
            `ไม่สามารถแก้ราคาซ้ำโดยไม่ผ่านการอนุมัติจากเจ้าของร้าน`,
        );
      }
      if (userRole !== 'OWNER') {
        throw new ForbiddenException(
          'เฉพาะเจ้าของร้าน (OWNER) เท่านั้นที่สามารถบังคับแก้ราคาที่ตีไปแล้ว',
        );
      }
      if (!dto.forceReason || dto.forceReason.trim().length < 3) {
        throw new BadRequestException(
          'ต้องระบุเหตุผลในการแก้ราคาที่ตีไปแล้ว (forceReason) อย่างน้อย 3 ตัวอักษร',
        );
      }

      // Write audit trail before mutating — so even if update fails, we see the attempt
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'TRADE_IN_APPRAISAL_FORCE_OVERRIDE',
          entity: 'trade_in',
          entityId: id,
          oldValue: { offeredPrice: previousPrice, firstAppraisedAt: tradeIn.firstAppraisedAt },
          newValue: {
            offeredPrice: dto.offeredPrice,
            deviceCondition: dto.deviceCondition,
            forceReason: dto.forceReason,
          },
        },
      });
    } else if (tradeIn.status !== 'PENDING_APPRAISAL') {
      // Only enforce the "must be PENDING_APPRAISAL" rule for first-time
      // appraisals. Re-appraisal under OWNER force-override bypasses the
      // status check (auditLog above captures the move).
      throw new BadRequestException('รายการนี้ไม่อยู่ในสถานะรอประเมิน');
    }

    // Snapshot the valuation base price if we can find one for this spec.
    // If the table has no row (new brand/storage/condition combo) we allow
    // the price through — staff has no reference to compare against.
    const valuation = tradeIn.deviceStorage
      ? await this.lookupValuation(
          tradeIn.deviceBrand,
          tradeIn.deviceModel,
          tradeIn.deviceStorage,
          dto.deviceCondition,
        )
      : null;

    let basePriceAtAppraisal: number | null = null;
    if (valuation?.found && valuation.suggestedPrice !== null) {
      basePriceAtAppraisal = valuation.suggestedPrice;
      const ceiling = basePriceAtAppraisal * TradeInService.PRICE_CEILING_RATIO;
      const floor = basePriceAtAppraisal * TradeInService.PRICE_FLOOR_RATIO;
      if (dto.offeredPrice > ceiling || dto.offeredPrice < floor) {
        throw new BadRequestException(
          `ราคาที่เสนอ ${dto.offeredPrice.toLocaleString()} บาท อยู่นอกช่วง ±15% ` +
            `ของราคากลาง (${basePriceAtAppraisal.toLocaleString()} บาท, ` +
            `ช่วง ${floor.toLocaleString()}–${ceiling.toLocaleString()} บาท) — ` +
            `ต้องได้รับอนุมัติจากหัวหน้างาน`,
        );
      }
    }

    return this.prisma.tradeIn.update({
      where: { id },
      data: {
        offeredPrice: dto.offeredPrice,
        deviceCondition: dto.deviceCondition,
        notes: dto.notes ?? tradeIn.notes,
        appraisedById: userId,
        status: 'APPRAISED',
        basePriceAtAppraisal: basePriceAtAppraisal ?? undefined,
        // T5-C17: Lock the price on first appraise (don't overwrite firstAppraisedAt on re-appraise)
        appraisalLocked: true,
        firstAppraisedAt: tradeIn.firstAppraisedAt ?? new Date(),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        appraisedBy: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Accept (with anti-theft gate) ────────────────────────
  // เมื่อ ACCEPTED → auto-create Product (PHONE_USED, PHOTO_PENDING) + ลิงก์ TradeIn.productId
  // ตาม pattern เดียวกับ PurchaseOrder.receive() — สินค้ามือสองต้องถ่ายรูป 6 มุมก่อนเข้าคลังจริง
  async accept(id: string, dto: AcceptTradeInDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const tradeIn = await tx.tradeIn.findUnique({ where: { id } });
      if (!tradeIn || tradeIn.deletedAt) {
        throw new NotFoundException('ไม่พบรายการเทรดอิน');
      }
      if (tradeIn.status !== 'APPRAISED') {
        throw new BadRequestException('รายการนี้ยังไม่ได้ประเมินราคา');
      }
      if (!dto.idCardVerified) {
        throw new BadRequestException('ต้องยืนยันว่าตรวจบัตรประชาชนผู้ขายแล้ว');
      }
      if (!dto.sellerConsentSigned) {
        throw new BadRequestException('ต้องให้ผู้ขายเซ็นยืนยันความเป็นเจ้าของก่อน');
      }
      if (dto.paymentMethod === 'TRANSFER') {
        if (!dto.transferBankName || !dto.transferAccountNumber || !dto.transferAccountName) {
          throw new BadRequestException(
            'กรณีโอนต้องระบุธนาคาร, เลขบัญชี และชื่อบัญชีผู้รับโอน',
          );
        }
      }
      if (!tradeIn.branchId) {
        throw new BadRequestException(
          'รายการเทรดอินไม่มีข้อมูลสาขา — ไม่สามารถรับเข้าสต๊อคได้',
        );
      }

      // เก็บลายเซ็นผู้ขายเป็น base64 ตรง ๆ (ไม่พึ่ง S3)
      // size guard: ลายเซ็นจาก SignaturePadFull canvas ปกติ < 30KB
      let signatureBase64: string | null = null;
      if (dto.sellerSignatureBase64) {
        if (dto.sellerSignatureBase64.length > 200_000) {
          throw new BadRequestException('ลายเซ็นมีขนาดใหญ่เกินไป');
        }
        signatureBase64 = dto.sellerSignatureBase64;
      }

      // IMEI uniqueness check — Product.imeiSerial เป็น @unique, ต้องไม่ชนกับสินค้าที่มีอยู่
      // (รวม soft-deleted เพราะ DB constraint ไม่สนใจ deletedAt)
      if (tradeIn.imei) {
        const existing = await tx.product.findFirst({
          where: { imeiSerial: tradeIn.imei },
          select: { id: true, name: true, deletedAt: true },
        });
        if (existing) {
          const suffix = existing.deletedAt ? ' [ตัดจำหน่ายแล้ว]' : '';
          throw new BadRequestException(
            `IMEI ${tradeIn.imei} มีอยู่ในระบบแล้ว: ${existing.name}${suffix}`,
          );
        }
      }

      // ─── สร้าง Product (PHONE_USED → PHOTO_PENDING) ───
      // mirror pattern จาก purchase-orders.service.ts receive() เพื่อ workflow สอดคล้อง
      const nameParts = [
        tradeIn.deviceBrand,
        tradeIn.deviceModel,
        tradeIn.deviceColor,
        tradeIn.deviceStorage,
      ].filter(Boolean);
      const productName = nameParts.join(' ');
      const costPrice = tradeIn.offeredPrice ?? tradeIn.estimatedValue ?? new Prisma.Decimal(0);

      const product = await tx.product.create({
        data: {
          name: productName,
          brand: tradeIn.deviceBrand,
          model: tradeIn.deviceModel,
          color: tradeIn.deviceColor ?? null,
          storage: tradeIn.deviceStorage ?? null,
          category: 'PHONE_USED',
          costPrice,
          branchId: tradeIn.branchId,
          status: 'PHOTO_PENDING',
          imeiSerial: tradeIn.imei ?? null,
          checklistResults: {
            source: 'trade-in',
            tradeInId: tradeIn.id,
            deviceCondition: tradeIn.deviceCondition ?? null,
            agreedPrice: Number(costPrice),
            notes: tradeIn.notes ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return tx.tradeIn.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          agreedPrice: tradeIn.offeredPrice,
          productId: product.id,
          idCardVerifiedAt: new Date(),
          idCardVerifiedById: userId,
          sellerConsentSigned: true,
          policeReportAcknowledged: dto.policeReportAcknowledged ?? false,
          paymentMethod: dto.paymentMethod,
          transferBankName: dto.paymentMethod === 'TRANSFER' ? dto.transferBankName : null,
          transferAccountNumber:
            dto.paymentMethod === 'TRANSFER' ? dto.transferAccountNumber : null,
          transferAccountName:
            dto.paymentMethod === 'TRANSFER' ? dto.transferAccountName : null,
          sellerSignatureBase64: signatureBase64 ?? undefined,
        },
      });
    });
  }

  // ─── Quick Buy: orchestrator ที่เรียก stages เดิมตามลำดับ ──
  /**
   * Orchestrator pattern — เรียก service methods ที่มีอยู่จริงตามลำดับ:
   *   create() → appraise() → accept() → voucher.allocate()
   *
   * ข้อดี:
   *  - "Full layer" — ทุก stage รัน validation + business logic ของตัวเอง (single source of truth)
   *  - Audit trail ครบ: PENDING_APPRAISAL → APPRAISED → ACCEPTED → voucher allocated
   *  - ไม่ duplicate logic — บั๊กแก้ที่เดียว fix ทุก flow
   *  - User experience: คลิกครั้งเดียว แต่ backend run 4 stage
   *
   * Trade-off:
   *  - ไม่ atomic ใน 1 transaction (แต่ละ stage มี tx ของตัวเอง)
   *  - ถ้า fail กลางทาง → record ค้างใน intermediate state (PENDING/APPRAISED)
   *    ซึ่งสามารถกู้คืนได้ผ่าน legacy modals (appraise/accept ทีละขั้น)
   */
  async quickBuy(dto: QuickBuyTradeInDto, userId: string) {
    // ─── Stage 1: Create (PENDING_APPRAISAL) ───
    // ใช้ create() เดิม — validation seller/IMEI dup/ID card upload เกิดที่นี่
    const created = await this.create({
      branchId: dto.branchId,
      deviceBrand: dto.deviceBrand,
      deviceModel: dto.deviceModel,
      deviceStorage: dto.deviceStorage,
      deviceColor: dto.deviceColor,
      deviceCondition: dto.deviceCondition,
      imei: dto.imei,
      estimatedValue: dto.agreedPrice,
      notes: dto.notes,
      sellerName: dto.sellerName,
      sellerPhone: dto.sellerPhone,
      sellerIdCardNumber: dto.sellerIdCardNumber,
      sellerAddress: dto.sellerAddress,
      idCardPhotoBase64: dto.idCardPhotoBase64,
      idCardSource: dto.idCardSource,
    });

    // ─── Stage 2: Appraise (PENDING_APPRAISAL → APPRAISED) ───
    await this.appraise(
      created.id,
      {
        offeredPrice: dto.agreedPrice,
        deviceCondition: dto.deviceCondition || 'B',
      },
      userId,
    );

    // ─── Stage 3: Accept (APPRAISED → ACCEPTED) ───
    // Validation consent + payment + signature เกิดที่นี่
    await this.accept(
      created.id,
      {
        idCardVerified: dto.idCardVerified,
        sellerConsentSigned: dto.sellerConsentSigned,
        policeReportAcknowledged: true,
        paymentMethod: dto.paymentMethod,
        transferBankName: dto.transferBankName,
        transferAccountNumber: dto.transferAccountNumber,
        transferAccountName: dto.transferAccountName,
        sellerSignatureBase64: dto.sellerSignatureBase64,
      },
      userId,
    );

    // ─── Stage 4: Allocate voucher number ───
    const voucher = await this.voucher.allocate(created.id);

    // Re-fetch เพื่อตอบ IMEI warning (create() บันทึก imeiBlacklistResult ให้แล้ว)
    const final = await this.prisma.tradeIn.findUnique({
      where: { id: created.id },
      select: { imeiBlacklistResult: true },
    });

    return {
      id: created.id,
      voucherNumber: voucher.voucherNumber,
      voucherDate: voucher.voucherDate,
      imeiWarning: final?.imeiBlacklistResult === 'duplicate',
    };
  }

  // ─── Seller history (auto-fill + repeat warning) ─────────
  async sellerHistory(idCardNumber: string) {
    if (!/^\d{13}$/.test(idCardNumber)) {
      throw new BadRequestException('เลขบัตรประชาชนต้อง 13 หลัก');
    }
    const records = await this.prisma.tradeIn.findMany({
      where: { sellerIdCardNumber: idCardNumber, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sellerName: true,
        sellerPhone: true,
        sellerAddress: true,
        deviceBrand: true,
        deviceModel: true,
        agreedPrice: true,
        createdAt: true,
        status: true,
      },
      take: 20,
    });

    // นับจำนวนใน 30 วันล่าสุด
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentCount = records.filter((r) => r.createdAt >= thirtyDaysAgo).length;

    const latest = records[0];
    return {
      found: records.length > 0,
      totalCount: records.length,
      recentCount,
      warning: recentCount >= 3, // 3+ ครั้งใน 30 วัน → ผิดปกติ
      lastSeller: latest
        ? {
            sellerName: latest.sellerName,
            sellerPhone: latest.sellerPhone,
            sellerAddress: latest.sellerAddress,
          }
        : null,
      history: records.map((r) => ({
        id: r.id,
        device: `${r.deviceBrand} ${r.deviceModel}`,
        amount: Number(r.agreedPrice ?? 0),
        date: r.createdAt,
        status: r.status,
      })),
    };
  }

  // ─── Reject / Complete ────────────────────────────────────
  async reject(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const tradeIn = await tx.tradeIn.findUnique({ where: { id } });
      if (!tradeIn || tradeIn.deletedAt) throw new NotFoundException('ไม่พบรายการเทรดอิน');
      if (tradeIn.status !== 'APPRAISED') {
        throw new BadRequestException('รายการนี้ยังไม่ได้ประเมินราคา');
      }
      return tx.tradeIn.update({ where: { id }, data: { status: 'REJECTED' } });
    });
  }

  async complete(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const tradeIn = await tx.tradeIn.findUnique({ where: { id } });
      if (!tradeIn || tradeIn.deletedAt) throw new NotFoundException('ไม่พบรายการเทรดอิน');
      if (tradeIn.status !== 'ACCEPTED') {
        throw new BadRequestException('รายการนี้ยังไม่ได้ตอบรับ');
      }
      return tx.tradeIn.update({ where: { id }, data: { status: 'COMPLETED' } });
    });
  }

  // ─── ID card photo upload (เพิ่มภายหลัง create) ───────────
  async uploadIdCardPhoto(
    id: string,
    photoBase64: string,
    source: 'card_reader' | 'upload',
  ) {
    const tradeIn = await this.findOne(id);
    const { buffer, contentType } = this.decodeBase64Image(photoBase64);
    const ext = contentType.split('/')[1] || 'jpg';
    const key = `trade-ins/${tradeIn.id}/id-card-${Date.now()}.${ext}`;
    await this.storage.upload(key, buffer, contentType);
    return this.prisma.tradeIn.update({
      where: { id },
      data: { idCardPhotoUrl: key, idCardSource: source },
      select: { id: true, idCardPhotoUrl: true, idCardSource: true },
    });
  }

  // ─── Public verify (สำหรับ QR scan) ──────────────────────
  async verifyByVoucherNumber(voucherNumber: string) {
    const tradeIn = await this.prisma.tradeIn.findUnique({
      where: { voucherNumber },
      select: {
        voucherNumber: true,
        voucherDate: true,
        agreedPrice: true,
        offeredPrice: true,
        deviceBrand: true,
        deviceModel: true,
        sellerName: true,
        status: true,
        deletedAt: true,
      },
    });
    if (!tradeIn || tradeIn.deletedAt) {
      throw new NotFoundException('ไม่พบใบสำคัญจ่ายเลขนี้');
    }
    return {
      voucherNumber: tradeIn.voucherNumber,
      voucherDate: tradeIn.voucherDate,
      amount: Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0),
      device: `${tradeIn.deviceBrand} ${tradeIn.deviceModel}`,
      sellerName: tradeIn.sellerName ?? '-',
      status: tradeIn.status,
      verified: true,
    };
  }

  // ─── Voucher ──────────────────────────────────────────────
  async generateVoucher(id: string) {
    // Allocate เลขเท่านั้น — PDF render on-demand ตอนดาวน์โหลด
    return this.voucher.allocate(id);
  }

  async getVoucherPdf(id: string) {
    // ถ้ายังไม่มีเลข ให้ allocate ก่อน (one-shot UX: คลิกแล้วได้ PDF เลย)
    const tradeIn = await this.findOne(id);
    if (!tradeIn.voucherNumber) {
      await this.voucher.allocate(id);
    }
    return this.voucher.renderPdf(id);
  }

  // ─── Valuation table lookup ───────────────────────────────

  /**
   * Lookup suggested price from the valuation table.
   * Returns null if no record found (staff can still enter price manually).
   */
  async lookupValuation(
    brand: string,
    model: string,
    storage: string,
    condition: string,
  ): Promise<{
    found: boolean;
    suggestedPrice: number | null;
    brand: string;
    model: string;
    storage: string;
    condition: string;
    note: string | null;
  }> {
    const db = this.prisma as unknown as PrismaAny;
    const record = await db.tradeInValuation.findFirst({
      where: {
        brand: { equals: brand, mode: 'insensitive' },
        model: { equals: model, mode: 'insensitive' },
        storage: { equals: storage, mode: 'insensitive' },
        condition,
        deletedAt: null,
      },
    });

    return {
      found: !!record,
      suggestedPrice: record ? Number(record.basePrice) : null,
      brand,
      model,
      storage,
      condition,
      note: record?.note ?? null,
    };
  }

  /** List all brands in the valuation table (for autocomplete) */
  async getValuationBrands(): Promise<string[]> {
    const db = this.prisma as unknown as PrismaAny;
    const rows = await db.tradeInValuation.findMany({
      where: { deletedAt: null },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    });
    return rows.map((r) => r.brand);
  }

  /** List all models for a given brand */
  async getValuationModels(brand: string): Promise<string[]> {
    const db = this.prisma as unknown as PrismaAny;
    const rows = await db.tradeInValuation.findMany({
      where: { brand: { equals: brand, mode: 'insensitive' }, deletedAt: null },
      select: { model: true },
      distinct: ['model'],
      orderBy: { model: 'asc' },
    });
    return rows.map((r) => r.model);
  }

  /** Upsert a valuation record (admin use) */
  async upsertValuation(dto: UpsertValuationDto) {
    const db = this.prisma as unknown as PrismaAny;
    const existing = await db.tradeInValuation.findFirst({
      where: {
        brand: { equals: dto.brand, mode: 'insensitive' },
        model: { equals: dto.model, mode: 'insensitive' },
        storage: { equals: dto.storage, mode: 'insensitive' },
        condition: dto.condition,
        deletedAt: null,
      },
    });

    if (existing) {
      return db.tradeInValuation.update({
        where: { id: existing.id },
        data: {
          basePrice: new Prisma.Decimal(dto.basePrice),
          note: dto.note ?? existing.note,
        },
      });
    }

    return db.tradeInValuation.create({
      data: {
        brand: dto.brand,
        model: dto.model,
        storage: dto.storage,
        condition: dto.condition,
        basePrice: new Prisma.Decimal(dto.basePrice),
        note: dto.note,
      },
    });
  }

  /** List all valuation records with optional brand/model filter */
  async listValuations(filters: { brand?: string; model?: string; page?: number; limit?: number }) {
    const { brand, model, page = 1, limit = 50 } = filters;
    const db = this.prisma as unknown as PrismaAny;
    const where: Record<string, unknown> = { deletedAt: null };
    if (brand) where['brand'] = { equals: brand, mode: 'insensitive' };
    if (model) where['model'] = { contains: model, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      db.tradeInValuation.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ brand: 'asc' }, { model: 'asc' }, { storage: 'asc' }, { condition: 'asc' }],
      }),
      db.tradeInValuation.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }
}
