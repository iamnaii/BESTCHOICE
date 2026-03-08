import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
    if (dto.minInstallmentMonths > dto.maxInstallmentMonths) {
      throw new BadRequestException('จำนวนงวดขั้นต่ำต้องน้อยกว่าหรือเท่ากับจำนวนงวดสูงสุด');
    }
    return this.prisma.interestConfig.create({
      data: {
        name: dto.name,
        productCategories: dto.productCategories,
        interestRate: dto.interestRate,
        minDownPaymentPct: dto.minDownPaymentPct,
        storeCommissionPct: dto.storeCommissionPct,
        vatPct: dto.vatPct,
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
    // Soft-delete to avoid breaking FK references from existing contracts
    return this.prisma.interestConfig.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
