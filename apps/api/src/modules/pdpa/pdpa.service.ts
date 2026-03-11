import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_PRIVACY_NOTICE = `ประกาศความเป็นส่วนตัว (Privacy Notice)

บริษัท เบสท์ช้อยส์โฟน จำกัด ("บริษัท") ให้ความสำคัญกับการคุ้มครองข้อมูลส่วนบุคคลของท่าน ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562

วัตถุประสงค์ในการเก็บรวบรวมข้อมูล:
1. เพื่อการทำสัญญาผ่อนชำระสินค้า
2. เพื่อการติดตามหนี้และบริหารสัญญา
3. เพื่อการจัดทำเอกสารทางกฎหมาย
4. เพื่อการติดต่อสื่อสารเกี่ยวกับสัญญา

ข้อมูลที่เก็บรวบรวม:
- ชื่อ-นามสกุล, เลขบัตรประชาชน
- ที่อยู่, เบอร์โทรศัพท์, อีเมล, Line ID
- ข้อมูลอาชีพและรายได้
- ข้อมูลบุคคลอ้างอิง/ผู้ค้ำประกัน
- รูปถ่ายบัตรประชาชน, รูปถ่ายลูกค้า
- ข้อมูลสินค้า (IMEI/Serial Number)

สิทธิ์ของท่านตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล:
- สิทธิ์ในการเข้าถึงข้อมูลส่วนบุคคล
- สิทธิ์ในการแก้ไขข้อมูลให้ถูกต้อง
- สิทธิ์ในการลบข้อมูล (หลังสิ้นสุดสัญญาและหมดระยะเก็บ)
- สิทธิ์ในการคัดค้านการประมวลผล
- สิทธิ์ในการโอนย้ายข้อมูล

ระยะเวลาเก็บข้อมูล:
- ตลอดอายุสัญญา + 5 ปีหลังปิดสัญญา (ตามอายุความทางกฎหมาย)

ข้าพเจ้ายินยอมให้เก็บรวบรวม ใช้ เปิดเผยข้อมูลส่วนบุคคลเพื่อวัตถุประสงค์ข้างต้น`;

@Injectable()
export class PDPAService {
  constructor(private prisma: PrismaService) {}

  /** Get current privacy notice version */
  async getPrivacyNotice() {
    const versionConfig = await this.prisma.systemConfig.findUnique({
      where: { key: 'pdpa_privacy_notice_version' },
    });
    return {
      version: versionConfig?.value || '1.0',
      text: DEFAULT_PRIVACY_NOTICE,
    };
  }

  /** Record PDPA consent from customer */
  async recordConsent(
    customerId: string,
    req: { ip?: string; userAgent?: string },
    signatureImage?: string,
  ) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');

    const notice = await this.getPrivacyNotice();

    const consent = await this.prisma.pDPAConsent.create({
      data: {
        customerId,
        consentVersion: notice.version,
        privacyNoticeText: notice.text,
        purposes: [
          'สัญญาผ่อนชำระสินค้า',
          'ติดตามหนี้และบริหารสัญญา',
          'จัดทำเอกสารทางกฎหมาย',
          'ติดต่อสื่อสารเกี่ยวกับสัญญา',
        ],
        status: 'GRANTED',
        grantedAt: new Date(),
        ipAddress: req.ip || null,
        deviceInfo: req.userAgent || null,
        signatureImage: signatureImage || null,
      },
    });

    return consent;
  }

  /** Revoke PDPA consent */
  async revokeConsent(consentId: string, reason: string) {
    const consent = await this.prisma.pDPAConsent.findUnique({ where: { id: consentId } });
    if (!consent) throw new NotFoundException('ไม่พบ Consent');
    if (consent.status === 'REVOKED') throw new BadRequestException('Consent ถูกเพิกถอนแล้ว');

    // Check if there's an active contract linked to this consent
    const linkedContract = await this.prisma.contract.findFirst({
      where: { pdpaConsentId: consentId, status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } },
    });
    if (linkedContract) {
      throw new BadRequestException(
        'ไม่สามารถเพิกถอน Consent ได้ เนื่องจากยังมีสัญญาที่ใช้งานอยู่ ' +
        `(สัญญาเลขที่ ${linkedContract.contractNumber})`
      );
    }

    return this.prisma.pDPAConsent.update({
      where: { id: consentId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: reason,
      },
    });
  }

  /** Get all consents for a customer */
  async getCustomerConsents(customerId: string) {
    return this.prisma.pDPAConsent.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── DSAR (Data Subject Access Request) ────────────────

  /** Submit a DSAR request */
  async submitDSAR(
    customerId: string,
    requestType: string,
    description: string,
  ) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');

    // Generate request number
    const now = new Date();
    const year = now.getFullYear();
    const count = await this.prisma.dSARRequest.count({
      where: {
        submittedAt: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      },
    });
    const requestNumber = `DSAR-${year}-${String(count + 1).padStart(3, '0')}`;

    // Due date: 30 days from submission (ตาม พ.ร.บ.)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    return this.prisma.dSARRequest.create({
      data: {
        requestNumber,
        customerId,
        requestType: requestType as any,
        description,
        dueDate,
      },
    });
  }

  /** Get all DSAR requests (for admin dashboard) */
  async getDSARRequests(filters: {
    status?: string;
    customerId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;

    const [data, total] = await Promise.all([
      this.prisma.dSARRequest.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.dSARRequest.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Process a DSAR request */
  async processDSAR(
    id: string,
    userId: string,
    status: string,
    responseNotes: string,
  ) {
    const request = await this.prisma.dSARRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('ไม่พบคำร้อง DSAR');

    const data: Record<string, unknown> = {
      status,
      responseNotes,
      processedById: userId,
      processedAt: new Date(),
    };
    if (status === 'COMPLETED') {
      data.completedAt = new Date();
    }

    return this.prisma.dSARRequest.update({ where: { id }, data });
  }
}
