import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { paginatedResponse } from '../../../common/helpers/pagination.helper';
import { TradeInVoucherService } from './voucher.service';
import {
  decryptTradeInPII,
  decryptTradeInList,
  decodeBase64Image,
} from '../helpers/trade-in.helpers';

export class TradeInQueryService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private voucher: TradeInVoucherService,
  ) {}

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

  // ─── List / Find ──────────────────────────────────────────
  async findAll(filters: {
    customerId?: string;
    branchId?: string;
    status?: string;
    search?: string;
    submissionSource?: string;
    flow?: string;
    page?: number;
    limit?: number;
  }) {
    const {
      customerId,
      branchId,
      status,
      search,
      submissionSource,
      flow,
      page = 1,
      limit = 50,
    } = filters;
    const where: Record<string, unknown> = { deletedAt: null };
    if (customerId) where.customerId = customerId;
    // NOTE (launch-wave §2): findAll ไม่ scope ตามสาขาโดยเจตนา — record ออนไลน์
    // เกิดมา branchId=null; ถ้าอนาคตเพิ่ม branch scoping ต้อง OR branchId=null เสมอ
    // ไม่งั้นรายการออนไลน์หายจากตา BRANCH_MANAGER ก่อนได้ accept
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (submissionSource) where.submissionSource = submissionSource;
    if (flow) where.flow = flow;
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

    const decrypted = decryptTradeInList(data as Array<Record<string, unknown>>);
    return paginatedResponse(decrypted, total, page, limit);
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
    return decryptTradeInPII(tradeIn as unknown as Record<string, unknown>) as typeof tradeIn;
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

  // ─── ID card photo upload (เพิ่มภายหลัง create) ───────────
  async uploadIdCardPhoto(
    id: string,
    photoBase64: string,
    source: 'card_reader' | 'upload',
  ) {
    const tradeIn = await this.findOne(id);
    const { buffer, contentType } = decodeBase64Image(photoBase64);
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
