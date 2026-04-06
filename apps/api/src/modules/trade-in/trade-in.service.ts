import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { CreateTradeInDto, AppraiseTradeInDto } from './dto/trade-in.dto';

@Injectable()
export class TradeInService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTradeInDto) {
    // Validate customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }

    // Validate product if provided
    if (dto.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
      });
      if (!product || product.deletedAt) {
        throw new NotFoundException('ไม่พบสินค้า');
      }
    }

    return this.prisma.tradeIn.create({
      data: {
        customerId: dto.customerId,
        productId: dto.productId,
        deviceBrand: dto.deviceBrand,
        deviceModel: dto.deviceModel,
        deviceStorage: dto.deviceStorage,
        deviceCondition: dto.deviceCondition,
        imei: dto.imei,
        estimatedValue: dto.estimatedValue,
        notes: dto.notes,
        status: 'PENDING_APPRAISAL',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    });
  }

  async findAll(filters: {
    customerId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const { customerId, status, page = 1, limit = 50 } = filters;
    const where: Record<string, unknown> = { deletedAt: null };

    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.tradeIn.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
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
        customer: { select: { id: true, name: true, phone: true, nationalId: true } },
        product: { select: { id: true, name: true, brand: true, model: true } },
        appraisedBy: { select: { id: true, name: true } },
      },
    });
    if (!tradeIn || tradeIn.deletedAt) {
      throw new NotFoundException('ไม่พบรายการเทรดอิน');
    }
    return tradeIn;
  }

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

  async accept(id: string) {
    const tradeIn = await this.findOne(id);
    if (tradeIn.status !== 'APPRAISED') {
      throw new BadRequestException('รายการนี้ยังไม่ได้ประเมินราคา');
    }

    return this.prisma.tradeIn.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        agreedPrice: tradeIn.offeredPrice, // agreedPrice = offeredPrice
      },
    });
  }

  async reject(id: string) {
    const tradeIn = await this.findOne(id);
    if (tradeIn.status !== 'APPRAISED') {
      throw new BadRequestException('รายการนี้ยังไม่ได้ประเมินราคา');
    }

    return this.prisma.tradeIn.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
  }

  async complete(id: string) {
    const tradeIn = await this.findOne(id);
    if (tradeIn.status !== 'ACCEPTED') {
      throw new BadRequestException('รายการนี้ยังไม่ได้ตอบรับ');
    }

    return this.prisma.tradeIn.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });
  }
}
