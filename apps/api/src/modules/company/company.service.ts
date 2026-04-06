import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCompanyDto } from './dto/company.dto';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.companyInfo.findMany({
      where: { deletedAt: null },
      include: { branches: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const company = await this.prisma.companyInfo.findFirst({
      where: { id, deletedAt: null },
      include: { branches: { where: { deletedAt: null } } },
    });

    if (!company) {
      throw new NotFoundException('ไม่พบข้อมูลบริษัท');
    }

    return company;
  }

  async findByCode(companyCode: string) {
    return this.prisma.companyInfo.findFirst({
      where: { companyCode, deletedAt: null },
      include: { branches: { where: { deletedAt: null } } },
    });
  }

  async update(id: string, dto: UpdateCompanyDto) {
    await this.findOne(id);

    return this.prisma.companyInfo.update({
      where: { id },
      data: dto,
      include: { branches: { where: { deletedAt: null } } },
    });
  }
}
