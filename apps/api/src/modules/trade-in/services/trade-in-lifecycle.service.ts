import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import {
  CreateTradeInDto,
  AppraiseTradeInDto,
  AcceptTradeInDto,
  UpdateTradeInDto,
  QuickBuyTradeInDto,
} from '../dto/trade-in.dto';
import { TradeInVoucherService } from './voucher.service';
import { ContactResolverService } from '../../contacts/contact-resolver.service';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { Prisma } from '@prisma/client';
import {
  normalizeNationalId,
  buildTradeInPiiEncryptedFields,
  validateThaiNationalId,
  decodeBase64Image,
} from '../helpers/trade-in.helpers';
import { TradeInQueryService } from './trade-in-query.service';
import { TradeInValuationService } from './trade-in-valuation.service';
import { ShopTradeInTemplate } from '../../journal/cpa-templates/shop-trade-in.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

export class TradeInLifecycleService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private voucher: TradeInVoucherService,
    private contactResolver: ContactResolverService,
    private pii: CustomerPiiService,
    private query: TradeInQueryService,
    private valuation: TradeInValuationService,
    private shopTradeInTemplate: ShopTradeInTemplate,
    private shopAccountResolver: ShopAccountResolver,
  ) {}

  // ─── Create ───────────────────────────────────────────────
  async create(dto: CreateTradeInDto) {
    // Walk-in หรือ existing customer ก็ได้ — ต้องมีอย่างน้อยหนึ่งอย่าง:
    // customerId, sellerContactId (party-master), หรือ sellerName (free-text)
    if (!dto.customerId && !dto.sellerContactId && !dto.sellerName) {
      throw new BadRequestException(
        'ต้องระบุลูกค้าหรือข้อมูลผู้ขาย (ชื่อหรือรายชื่อผู้ขาย) อย่างน้อยหนึ่งอย่าง',
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
      !validateThaiNationalId(dto.sellerIdCardNumber)
    ) {
      throw new BadRequestException('เลขบัตรประชาชนไม่ถูกต้อง');
    }

    // เช็ค IMEI ซ้ำ (anti-stolen-goods พื้นฐาน)
    let imeiBlacklistResult: 'clean' | 'duplicate' | null = null;
    if (dto.imei) {
      const check = await this.query.checkImei(dto.imei);
      imeiBlacklistResult = check.result;
    }

    // อัปโหลดรูปบัตร ปชช. ถ้ามี
    let idCardPhotoKey: string | undefined;
    if (dto.idCardPhotoBase64) {
      const { buffer, contentType } = decodeBase64Image(dto.idCardPhotoBase64);
      const ext = contentType.split('/')[1] || 'jpg';
      const key = `trade-ins/_pending/${Date.now()}-id-card.${ext}`;
      await this.storage.upload(key, buffer, contentType);
      idCardPhotoKey = key;
    }

    return this.prisma.$transaction(async (tx) => {
      // Task 3 (contact-hardening): unify the trade-in seller with their
      // existing party Contact when we can derive a national-id hash.
      //  - customerId present → reuse the customer's own nationalIdHash so a
      //    buyer who also sells maps onto the SAME Contact.
      //  - else sellerIdCardNumber present → hash it the SAME way Customer
      //    does (normalize spaces/dashes + uppercase, then sha256) so the
      //    resolver matches an existing party keyed by that id.
      //  - neither → keyless (null): resolver creates a fresh Contact
      //    (safe no-auto-merge policy for anonymous walk-ins).
      let sellerNationalIdHash: string | null = null;
      if (dto.customerId) {
        const cust = await tx.customer.findUnique({
          where: { id: dto.customerId },
          select: { nationalIdHash: true },
        });
        sellerNationalIdHash = cust?.nationalIdHash ?? null;
      } else if (dto.sellerIdCardNumber) {
        sellerNationalIdHash = this.pii.hash(
          normalizeNationalId(dto.sellerIdCardNumber),
        );
      }

      // If the caller already resolved the Contact (e.g. via ensureRole), use it
      // directly; otherwise auto-resolve/create via natural-key lookup.
      let resolvedSellerContactId: string;
      if (dto.sellerContactId) {
        resolvedSellerContactId = dto.sellerContactId;
      } else {
        const sellerContact = await this.contactResolver.findOrCreateByNaturalKey(tx, {
          name: dto.sellerName ?? 'ไม่ระบุชื่อ',
          taxId: null,
          nationalIdHash: sellerNationalIdHash,
          phone: dto.sellerPhone ?? null,
          role: 'TRADE_IN_SELLER',
        });
        resolvedSellerContactId = sellerContact.id;
      }

      return tx.tradeIn.create({
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
          // Scalar FK form — the rest of this create uses scalar foreign keys
          // (customerId/productId/branchId), so we stay in the Unchecked variant.
          // Using the relation form (sellerContact.connect) here would trip the
          // Prisma XOR between TradeInCreateInput and TradeInUncheckedCreateInput.
          sellerContactId: resolvedSellerContactId,
        },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true } },
        },
      });
    });
  }

  // ─── Update (basic info) ──────────────────────────────────
  async update(id: string, dto: UpdateTradeInDto) {
    const existing = await this.query.findOne(id);
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
      !validateThaiNationalId(dto.sellerIdCardNumber)
    ) {
      throw new BadRequestException('เลขบัตรประชาชนไม่ถูกต้อง');
    }
    return this.prisma.tradeIn.update({
      where: { id },
      data: { ...dto },
    });
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
    const tradeIn = await this.query.findOne(id);

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

    // Instant-quote records (มี quoteBreakdown) ต้องยืนยันผ่าน appraise-online
    // (§7.4) — valuation-band ของ path นี้ใช้เกรด staff ซึ่งไม่สัมพันธ์กับราคา
    // ที่ engine หักไว้ และจะ block/หลุด guard แบบสุ่มตามว่ามีแถวเกรดนั้นไหม
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((tradeIn as any).quoteBreakdown) {
      throw new BadRequestException(
        'รายการนี้มาจากใบเสนอราคาออนไลน์ — กรุณายืนยันราคาผ่านหน้าจอยืนยันราคาออนไลน์',
      );
    }

    // Snapshot the valuation base price if we can find one for this spec.
    // If the table has no row (new brand/storage/condition combo) we allow
    // the price through — staff has no reference to compare against.
    const valuation = tradeIn.deviceStorage
      ? await this.valuation.lookupValuation(
          tradeIn.deviceBrand,
          tradeIn.deviceModel,
          tradeIn.deviceStorage,
          dto.deviceCondition,
        )
      : null;

    let basePriceAtAppraisal: number | null = null;
    if (valuation?.found && valuation.suggestedPrice !== null) {
      basePriceAtAppraisal = valuation.suggestedPrice;
      const ceiling = basePriceAtAppraisal * TradeInLifecycleService.PRICE_CEILING_RATIO;
      const floor = basePriceAtAppraisal * TradeInLifecycleService.PRICE_FLOOR_RATIO;
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

      // T5-C12: IMEI uniqueness check — เฉพาะ active products (soft-deleted
      // ถือว่าคืน IMEI กลับเข้า pool ได้) ตรงกับ partial unique index ใน DB
      // (migration 20260525200000_product_imei_partial_unique).
      if (tradeIn.imei) {
        const existing = await tx.product.findFirst({
          where: { imeiSerial: tradeIn.imei, deletedAt: null },
          select: { id: true, name: true },
        });
        if (existing) {
          throw new BadRequestException(
            `IMEI ${tradeIn.imei} มีอยู่ในระบบแล้ว: ${existing.name}`,
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
      // เทิร์น (EXCHANGE instant): ต้นทุนสต็อก = ราคาเงินสด — โบนัสเทิร์นเป็นส่วนลด
      // ฝั่งเครื่องใหม่ ไม่ใช่ต้นทุนเครื่องเก่า (spec /sell §1.5/§7.4) ไม่งั้น COGS
      // บวมเท่าโบนัสทุกเครื่อง; BUYBACK/walk-in = เงินที่จ่ายจริงเหมือนเดิม
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exchangeCash = tradeIn.flow === 'EXCHANGE' ? (tradeIn.quoteBreakdown as any)?.cashPrice : null;
      const costPrice = exchangeCash
        ? new Prisma.Decimal(exchangeCash)
        : (tradeIn.offeredPrice ?? tradeIn.estimatedValue ?? new Prisma.Decimal(0));

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

      const updated = await tx.tradeIn.update({
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
          ...buildTradeInPiiEncryptedFields({
            paymentMethod: dto.paymentMethod,
            transferAccountNumber: dto.transferAccountNumber,
            transferAccountName: dto.transferAccountName,
          }),
          sellerSignatureBase64: signatureBase64 ?? undefined,
        },
      });

      // SHOP-side: a BUYBACK buys the used device for cash → Dr S11-2002 / Cr cash.
      // EXCHANGE is intentionally skipped: its value is credited toward a purchase and is
      // booked with the companion sale/contract, not as a standalone cash-out (deferred).
      if (tradeIn.flow === 'BUYBACK' && costPrice.gt(0)) {
        const cashAccountCode = await this.shopAccountResolver.resolveOutflowCashAccount(
          tradeIn.branchId,
          dto.paymentMethod,
          tx,
        );
        await this.shopTradeInTemplate.execute(
          {
            idempotencyKey: `shop-trade-in:${tradeIn.id}`,
            tradeInId: tradeIn.id,
            cashAccountCode,
            tradeInPrice: costPrice,
          },
          tx,
        );
      }

      return updated;
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
  async quickBuy(
    dto: QuickBuyTradeInDto,
    userId: string,
    userBranchId?: string | null,
  ) {
    // Resolve branch — prefer DTO (explicit pick), fall back to user's home branch.
    // OWNER/cross-branch users have no default branch, so they must pass branchId
    // explicitly; surface a clear error instead of letting accept() fail later.
    const branchId = dto.branchId ?? userBranchId ?? null;
    if (!branchId) {
      throw new BadRequestException(
        'กรุณาเลือกสาขาที่รับซื้อก่อน — บัญชีของคุณไม่ได้ผูกกับสาขาเริ่มต้น',
      );
    }

    // ─── Stage 1: Create (PENDING_APPRAISAL) ───
    // ใช้ create() เดิม — validation seller/IMEI dup/ID card upload เกิดที่นี่
    const created = await this.create({
      branchId,
      deviceBrand: dto.deviceBrand,
      deviceModel: dto.deviceModel,
      deviceStorage: dto.deviceStorage,
      deviceColor: dto.deviceColor,
      deviceCondition: dto.deviceCondition,
      imei: dto.imei,
      estimatedValue: dto.agreedPrice,
      notes: dto.notes,
      sellerContactId: dto.sellerContactId,
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
}
