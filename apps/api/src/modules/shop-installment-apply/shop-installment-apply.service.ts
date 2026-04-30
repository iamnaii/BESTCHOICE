import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { FlexMessagePayload } from '../line-oa/flex-messages/base-template';
import { CreateApplicationDto } from './dto/create-application.dto';

/**
 * Flat-rate interest approximation used for the storefront monthly-payment estimate.
 * Real rates are recomputed from InterestConfig at admin approval time / contract creation.
 */
const DEFAULT_INTEREST_MONTHLY = 0.013; // ~1.3% monthly flat

const ACTIVE_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.SCHEDULED,
  ApplicationStatus.IN_REVIEW,
  ApplicationStatus.APPROVED,
];

@Injectable()
export class ShopInstallmentApplyService {
  constructor(private prisma: PrismaService, private line: LineOaService) {}

  async submit(dto: CreateApplicationDto, customerId: string | undefined) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');

    const duplicate = await this.prisma.onlineInstallmentApplication.findFirst({
      where: {
        productId: dto.productId,
        phone: dto.phone,
        status: { in: ACTIVE_STATUSES },
        deletedAt: null,
      },
    });
    if (duplicate) {
      throw new BadRequestException('มีใบสมัครของท่านอยู่แล้ว ทีมงานจะติดต่อกลับ');
    }

    const price = Number(product.costPrice);
    const financed = Math.max(0, price - dto.proposedDownPayment);
    const interestTotal = financed * DEFAULT_INTEREST_MONTHLY * dto.proposedTotalMonths;
    const monthly = Math.ceil((financed + interestTotal) / dto.proposedTotalMonths);

    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const rnd = Math.floor(100 + Math.random() * 900);
    const applicationNumber = `APP-${yy}${mm}${dd}-${rnd}`;

    const app = await this.prisma.onlineInstallmentApplication.create({
      data: {
        applicationNumber,
        customerId,
        productId: dto.productId,
        reservationId: dto.reservationId,
        fullName: dto.fullName,
        phone: dto.phone,
        nationalId: dto.nationalId,
        proposedDownPayment: dto.proposedDownPayment,
        proposedTotalMonths: dto.proposedTotalMonths,
        proposedMonthlyPayment: monthly,
        lineUserId: dto.lineUserId,
        notes: dto.notes,
        status: 'SUBMITTED',
      },
    });

    if (dto.lineUserId) {
      try {
        await this.line.sendFlexMessage(dto.lineUserId, this.buildSubmittedFlex(app.applicationNumber), 'line-shop');
      } catch {
        // non-fatal — staff will follow up by phone
      }
    }

    return {
      id: app.id,
      applicationNumber: app.applicationNumber,
      proposedMonthlyPayment: monthly,
    };
  }

  async getByNumber(applicationNumber: string, customerId: string | undefined) {
    const app = await this.prisma.onlineInstallmentApplication.findUnique({
      where: { applicationNumber },
      include: { product: { select: { id: true, name: true, gallery: true } } },
    });
    if (!app) throw new NotFoundException('ไม่พบใบสมัคร');
    if (customerId && app.customerId && app.customerId !== customerId) {
      throw new NotFoundException('ไม่พบใบสมัคร');
    }
    return app;
  }

  async listMine(customerId: string) {
    return this.prisma.onlineInstallmentApplication.findMany({
      where: { customerId, deletedAt: null },
      include: { product: { select: { name: true, gallery: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async adminList(status?: string) {
    const normalizedStatus =
      status && status in ApplicationStatus ? (status as ApplicationStatus) : undefined;
    return this.prisma.onlineInstallmentApplication.findMany({
      where: {
        deletedAt: null,
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      include: {
        product: { select: { name: true, gallery: true, conditionGrade: true } },
        customer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async schedule(id: string, scheduledAt: Date, reviewerId: string) {
    return this.prisma.onlineInstallmentApplication.update({
      where: { id },
      data: {
        status: 'SCHEDULED',
        scheduledAt,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });
  }

  async approve(id: string, reviewerId: string) {
    return this.prisma.onlineInstallmentApplication.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });
  }

  async reject(id: string, reviewerId: string, reason: string) {
    const app = await this.prisma.onlineInstallmentApplication.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        rejectReason: reason,
      },
    });
    if (app.lineUserId) {
      try {
        await this.line.sendFlexMessage(
          app.lineUserId,
          this.buildRejectedFlex(app.applicationNumber, reason),
          'line-shop',
        );
      } catch {
        // non-fatal — staff will follow up by phone
      }
    }
    return app;
  }

  async linkContract(id: string, contractId: string) {
    return this.prisma.onlineInstallmentApplication.update({
      where: { id },
      data: { status: 'CONTRACT_SIGNED', contractId },
    });
  }

  // ─── Flex builders ────────────────────────────────────────────

  private buildSubmittedFlex(applicationNumber: string): FlexMessagePayload {
    return {
      type: 'flex',
      altText: `ใบสมัครผ่อน ${applicationNumber} ได้รับแล้ว`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'บันทึกใบสมัครแล้ว', weight: 'bold', size: 'lg' },
            { type: 'text', text: applicationNumber, margin: 'md' },
            {
              type: 'text',
              text: 'ทีมงานจะติดต่อกลับภายใน 2 ชั่วโมง (เวลาทำการ)',
              size: 'xs',
              color: '#888888',
              margin: 'md',
              wrap: true,
            },
          ],
        },
      },
    };
  }

  private buildRejectedFlex(applicationNumber: string, reason: string): FlexMessagePayload {
    return {
      type: 'flex',
      altText: `ใบสมัคร ${applicationNumber} ไม่ผ่านการอนุมัติ`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'ใบสมัครไม่ผ่านการอนุมัติ', weight: 'bold', size: 'lg' },
            { type: 'text', text: applicationNumber, margin: 'md' },
            {
              type: 'text',
              text: reason || 'กรุณาติดต่อทีมงานสำหรับรายละเอียดเพิ่มเติม',
              size: 'sm',
              color: '#888888',
              margin: 'md',
              wrap: true,
            },
          ],
        },
      },
    };
  }
}
