import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCommissionDto, MarkReceivedDto } from './dto/commission.dto';

@Injectable()
export class ExternalFinanceCommissionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: { externalFinanceCompanyId?: string; status?: string } = {}) {
    return this.prisma.externalFinanceCommission.findMany({
      where: {
        deletedAt: null,
        ...(opts.externalFinanceCompanyId && {
          externalFinanceCompanyId: opts.externalFinanceCompanyId,
        }),
        ...(opts.status && { status: opts.status as any }),
      },
      include: { externalFinanceCompany: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async accrue(dto: CreateCommissionDto) {
    // Validate rate range 0–1
    if (dto.commissionRate < 0 || dto.commissionRate > 1) {
      throw new BadRequestException('commissionRate ต้องอยู่ระหว่าง 0 ถึง 1');
    }
    const amount = new Prisma.Decimal(dto.financedAmount).mul(
      new Prisma.Decimal(dto.commissionRate),
    );
    return this.prisma.externalFinanceCommission.create({
      data: {
        externalFinanceCompanyId: dto.externalFinanceCompanyId,
        saleReferenceId: dto.saleReferenceId,
        customerId: dto.customerId,
        financedAmount: new Prisma.Decimal(dto.financedAmount),
        commissionRate: new Prisma.Decimal(dto.commissionRate),
        commissionAmount: amount,
        status: 'PENDING',
      },
    });
  }

  async markReceived(id: string, dto: MarkReceivedDto) {
    const c = await this.prisma.externalFinanceCommission.findFirst({
      where: { id, deletedAt: null },
    });
    if (!c) throw new NotFoundException('ไม่พบ commission');
    if (c.status !== 'PENDING') {
      throw new BadRequestException(`commission status = ${c.status}; ต้อง PENDING ก่อน`);
    }

    return this.prisma.externalFinanceCommission.update({
      where: { id },
      data: {
        status: 'RECEIVED',
        receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
        bankSlipUrl: dto.bankSlipUrl,
      },
    });
  }

  async cancel(id: string, reason: string) {
    return this.prisma.externalFinanceCommission.update({
      where: { id },
      data: { status: 'CANCELLED', notes: reason },
    });
  }
}
