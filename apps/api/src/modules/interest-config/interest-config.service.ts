import { currentDomainAccess } from '../employee-access/access-execution-context';
import { writeSharedReference } from '../employee-access/access-shared-reference';
import { resolveBcConfig } from './resolve-bc-config';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInterestConfigDto, UpdateInterestConfigDto } from './dto/interest-config.dto';

@Injectable()
export class InterestConfigService {
  constructor(private readonly base: PrismaService) {}

  private get prisma() {
    return currentDomainAccess()?.client ?? this.base;
  }

  async findAll() {
    return this.prisma.interestConfig.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const config = await this.prisma.interestConfig.findFirst({
      where: { id, deletedAt: null },
    });
    if (!config) throw new NotFoundException('ไม่พบการตั้งค่าดอกเบี้ย');
    return config;
  }

  async findByCategory(category: string) {
    const config = await this.prisma.interestConfig.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        productCategories: { has: category },
      },
      // Deterministic pick — MUST match resolveConfig (below) and
      // ProductQuoteService.getQuotes: oldest-active wins. Without this, a category
      // with ≥2 active configs could quote different numbers on the contract-create
      // screen vs the bot/admin page (B2 Task 4 C2-residual).
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return config;
  }

  async create(dto: CreateInterestConfigDto) {
    this.validateMonths(dto.minInstallmentMonths, dto.maxInstallmentMonths);
    return writeSharedReference(this.base, (tx) =>
      tx.interestConfig.create({
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
      }),
    );
  }

  async update(id: string, dto: UpdateInterestConfigDto) {
    return writeSharedReference(this.base, async (tx) => {
      const config = await tx.interestConfig.findFirst({ where: { id, deletedAt: null } });
      if (!config) throw new NotFoundException('ไม่พบการตั้งค่าดอกเบี้ย');
      this.validateMonths(
        dto.minInstallmentMonths ?? config.minInstallmentMonths,
        dto.maxInstallmentMonths ?? config.maxInstallmentMonths,
      );
      return tx.interestConfig.update({ where: { id }, data: dto });
    });
  }

  async remove(id: string) {
    return writeSharedReference(this.base, async (tx) => {
      const config = await tx.interestConfig.findFirst({ where: { id, deletedAt: null } });
      if (!config) throw new NotFoundException('ไม่พบการตั้งค่าดอกเบี้ย');
      // Preserve existing Contract references and hide deleted definitions from finders.
      return tx.interestConfig.update({
        where: { id },
        data: { isActive: false, deletedAt: new Date() },
      });
    });
  }

  private validateMonths(min: number, max: number) {
    if (min > max)
      throw new BadRequestException('จำนวนงวดขั้นต่ำต้องน้อยกว่าหรือเท่ากับจำนวนงวดสูงสุด');
  }

  resolveConfig(category: string) {
    return resolveBcConfig(this.prisma, category);
  }
}
