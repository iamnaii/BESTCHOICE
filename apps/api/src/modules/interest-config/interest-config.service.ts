import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInterestConfigDto, UpdateInterestConfigDto } from './dto/interest-config.dto';

@Injectable()
export class InterestConfigService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.interestConfig.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const config = await this.prisma.interestConfig.findUnique({ where: { id } });
    if (!config) throw new NotFoundException('ไม่พบการตั้งค่าดอกเบี้ย');
    return config;
  }

  async findByCategory(category: string) {
    const config = await this.prisma.interestConfig.findFirst({
      where: {
        isActive: true,
        productCategories: { has: category },
      },
    });
    return config;
  }

  async create(dto: CreateInterestConfigDto) {
    return this.prisma.interestConfig.create({
      data: {
        name: dto.name,
        productCategories: dto.productCategories,
        interestRate: dto.interestRate,
        minDownPaymentPct: dto.minDownPaymentPct,
        minInstallmentMonths: dto.minInstallmentMonths,
        maxInstallmentMonths: dto.maxInstallmentMonths,
      },
    });
  }

  async update(id: string, dto: UpdateInterestConfigDto) {
    await this.findOne(id);
    return this.prisma.interestConfig.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.interestConfig.delete({ where: { id } });
  }
}
