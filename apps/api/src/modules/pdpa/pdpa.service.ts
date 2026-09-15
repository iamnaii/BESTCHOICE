import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DSARRequestType, Prisma } from '@prisma/client';
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

/**
 * DSAR ACCESS — ช่องของบันทึกการเดินทางที่ส่งให้เจ้าของข้อมูล: เนื้อหาของเหตุการณ์ครบ (รวม note ของเขาเอง)
 * ไม่ส่ง id ภายใน (customerId / originCustomerId / dedupeKey / roomId) และไม่ส่ง actorUserId ของพนักงาน
 */
const JOURNEY_ENTRY_EXPORT_SELECT = {
  kind: true,
  origin: true,
  occurredAt: true,
  actorType: true,
  refType: true,
  refId: true,
  channel: true,
  outcome: true,
  lostReason: true,
  heardFrom: true,
  data: true,
  note: true,
  deletedAt: true,
} satisfies Prisma.CustomerJourneyEntrySelect;

/** แคชสรุปการเดินทาง — ทุกช่องยกเว้น customerId */
const JOURNEY_STATE_EXPORT_SELECT = {
  stage: true,
  stageEnteredAt: true,
  path: true,
  contactedAt: true,
  identifiedAt: true,
  interestedAt: true,
  creditAt: true,
  firstPurchaseAt: true,
  firstPurchaseKind: true,
  firstStaffReplyAt: true,
  firstChannel: true,
  firstSource: true,
  firstAdCampaignId: true,
  heardFrom: true,
  lastCustomerAt: true,
  lastTouchAt: true,
  lostAt: true,
  lostReason: true,
  computedAt: true,
} satisfies Prisma.CustomerJourneyStateSelect;

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
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');

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
    if (!consent || consent.deletedAt) throw new NotFoundException('ไม่พบข้อมูลความยินยอม');
    if (consent.status === 'REVOKED') throw new BadRequestException('ความยินยอมนี้ถูกเพิกถอนแล้ว');

    // Check if there's an active contract linked to this consent
    const linkedContract = await this.prisma.contract.findFirst({
      where: { pdpaConsentId: consentId, deletedAt: null, status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } },
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

  /** Check whether a customer currently has an active (GRANTED) PDPA consent */
  async hasActiveConsent(customerId: string): Promise<boolean> {
    const consent = await this.prisma.pDPAConsent.findFirst({
      where: { customerId, status: 'GRANTED', deletedAt: null },
      select: { id: true },
    });
    return !!consent;
  }

  /** Get all consents for a customer */
  async getCustomerConsents(customerId: string) {
    return this.prisma.pDPAConsent.findMany({
      where: { customerId, deletedAt: null },
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
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');

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
        requestType: requestType as DSARRequestType,
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
    const where: Record<string, unknown> = { deletedAt: null };
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
    if (!request || request.deletedAt) throw new NotFoundException('ไม่พบคำร้อง DSAR');

    const data: Record<string, unknown> = {
      status,
      responseNotes,
      processedById: userId,
      processedAt: new Date(),
    };

    // Auto-generate data export for ACCESS requests
    if (request.requestType === 'ACCESS') {
      const exportData = await this.generateCustomerDataExport(request.customerId);
      data.responseData = exportData;
    }

    if (status === 'COMPLETED') {
      data.completedAt = new Date();
    }

    // สิทธิ์ลบ (DELETION) ที่ปิดงาน: ลบประวัติการเดินทางของลูกค้า — บันทึกมือมี note อิสระ และแคชคัดลอก heardFrom/lostReason
    // ทำในทรานแซกชันเดียวกับการปิดคำร้อง: ลบไม่สำเร็จ = คำร้องไม่ถูกปิด · ปิดซ้ำได้ (รอบสองลบ 0 แถว)
    if (request.requestType === 'DELETION' && status === 'COMPLETED') {
      return this.prisma.$transaction(async (tx) => {
        const erased = await this.eraseCustomerJourney(tx, request.customerId);
        data.responseData = { journeyEntriesDeleted: erased.entries, journeyStatesDeleted: erased.states };
        return tx.dSARRequest.update({ where: { id }, data });
      });
    }

    return this.prisma.dSARRequest.update({ where: { id }, data });
  }

  /**
   * id ของเจ้าของประวัติการเดินทาง — ชุดเดียวกันทั้งสิทธิ์ลบ (DELETION) และสิทธิ์ขอเข้าถึง (ACCESS)
   * - คำร้องที่ยื่นตอนยังเป็น placeholder แล้วถูกรวมไปก่อนปิด → เจ้าของปัจจุบันคือ merged_into_id (คนเดียวกัน)
   * - ids = เจ้าของปัจจุบัน + placeholder ทุกตัวที่ถูกรวมเข้ามา (ชั้นเดียว เพราะ absorbPlaceholder ยุบ chain แล้ว)
   */
  private async journeySubjectIds(db: Pick<Prisma.TransactionClient, 'customer'>, customerId: string): Promise<string[]> {
    const subject = await db.customer.findUnique({ where: { id: customerId }, select: { mergedIntoId: true } });
    const ownerId = subject?.mergedIntoId ?? customerId;
    const absorbed = await db.customer.findMany({ where: { mergedIntoId: ownerId }, select: { id: true } });
    return [ownerId, ...absorbed.map((row) => row.id)];
  }

  /** entries จับทั้ง customerId (เจ้าของปัจจุบัน) และ originCustomerId (id ตอนเขียน) */
  private journeyEntriesWhere(ids: string[]): Prisma.CustomerJourneyEntryWhereInput {
    return { OR: [{ customerId: { in: ids } }, { originCustomerId: { in: ids } }] };
  }

  /**
   * ลบ customer_journey_entries + customer_journey_states ของเจ้าของข้อมูล (ids จาก journeySubjectIds)
   * แถว customers / สัญญา / ใบขาย ไม่แตะ — อยู่ใต้อายุความตามประกาศความเป็นส่วนตัว · แคช state คำนวณใหม่ได้จากข้อมูลธุรกิจที่เหลือ
   */
  private async eraseCustomerJourney(
    tx: Prisma.TransactionClient,
    customerId: string,
  ): Promise<{ entries: number; states: number }> {
    const ids = await this.journeySubjectIds(tx, customerId);
    const entries = await tx.customerJourneyEntry.deleteMany({ where: this.journeyEntriesWhere(ids) });
    const states = await tx.customerJourneyState.deleteMany({ where: { customerId: { in: ids } } });
    return { entries: entries.count, states: states.count };
  }

  /** Generate customer data export for DSAR ACCESS requests */
  async generateCustomerDataExport(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        contracts: {
          where: { deletedAt: null },
          select: {
            contractNumber: true,
            status: true,
            sellingPrice: true,
            downPayment: true,
            totalMonths: true,
            createdAt: true,
          },
        },
        pdpaConsents: {
          where: { deletedAt: null },
          select: {
            status: true,
            purposes: true,
            grantedAt: true,
            revokedAt: true,
          },
        },
      },
    });

    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');

    // ประวัติการเดินทาง — ids ชุดเดียวกับสิทธิ์ลบ ⇒ สิ่งที่ส่งให้ดู = สิ่งที่คำร้องลบจะลบ (รวมบันทึกมือที่ถูกเลิกทำ พร้อม deletedAt)
    const journeyIds = await this.journeySubjectIds(this.prisma, customerId);
    const [journeyEntries, journeyStates] = await Promise.all([
      this.prisma.customerJourneyEntry.findMany({
        where: this.journeyEntriesWhere(journeyIds),
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: JOURNEY_ENTRY_EXPORT_SELECT,
      }),
      this.prisma.customerJourneyState.findMany({
        where: { customerId: { in: journeyIds } },
        select: JOURNEY_STATE_EXPORT_SELECT,
      }),
    ]);

    return {
      exportDate: new Date().toISOString(),
      customer: {
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        // DO NOT include nationalId (sensitive, masked only)
        nationalIdMasked: customer.nationalId
          ? '****' + customer.nationalId.slice(-4)
          : null,
      },
      contracts: customer.contracts,
      consents: customer.pdpaConsents,
      journey: { entries: journeyEntries, states: journeyStates },
    };
  }
}
