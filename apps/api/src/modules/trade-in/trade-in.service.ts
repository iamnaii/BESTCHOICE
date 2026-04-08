import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import {
  CreateTradeInDto,
  AppraiseTradeInDto,
  AcceptTradeInDto,
  UpdateTradeInDto,
} from './dto/trade-in.dto';
import { TradeInVoucherService } from './services/voucher.service';

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
    page?: number;
    limit?: number;
  }) {
    const { customerId, branchId, status, page = 1, limit = 50 } = filters;
    const where: Record<string, unknown> = { deletedAt: null };
    if (customerId) where.customerId = customerId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.tradeIn.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true } },
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
  async appraise(id: string, dto: AppraiseTradeInDto, userId: string) {
    const tradeIn = await this.findOne(id);
    if (tradeIn.status !== 'PENDING_APPRAISAL') {
      throw new BadRequestException('รายการนี้ไม่อยู่ในสถานะรอประเมิน');
    }
    return this.prisma.tradeIn.update({
      where: { id },
      data: {
        offeredPrice: dto.offeredPrice,
        deviceCondition: dto.deviceCondition,
        notes: dto.notes ?? tradeIn.notes,
        appraisedById: userId,
        status: 'APPRAISED',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        appraisedBy: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Accept (with anti-theft gate) ────────────────────────
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

      // เก็บลายเซ็นผู้ขายเป็น base64 ตรง ๆ (ไม่พึ่ง S3)
      // size guard: ลายเซ็นจาก SignaturePadFull canvas ปกติ < 30KB
      let signatureBase64: string | null = null;
      if (dto.sellerSignatureBase64) {
        if (dto.sellerSignatureBase64.length > 200_000) {
          throw new BadRequestException('ลายเซ็นมีขนาดใหญ่เกินไป');
        }
        signatureBase64 = dto.sellerSignatureBase64;
      }

      return tx.tradeIn.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          agreedPrice: tradeIn.offeredPrice,
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
}
