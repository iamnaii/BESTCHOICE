import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

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

  async create(dto: CreateCompanyDto) {
    // Enforce unique companyCode (SHOP / FINANCE) across active rows.
    if (dto.companyCode) {
      const existing = await this.prisma.companyInfo.findFirst({
        where: { companyCode: dto.companyCode, deletedAt: null },
      });
      if (existing) {
        throw new ConflictException(`มีบริษัทรหัส ${dto.companyCode} อยู่แล้ว`);
      }
    }

    return this.prisma.companyInfo.create({
      data: { ...dto, taxId: dto.taxId ?? '' },
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

  async remove(id: string) {
    const company = await this.findOne(id);

    // Guard: refuse to delete if company still owns branches or products.
    // We check branches (most common) here — the FK on Product.ownedByCompanyId
    // uses ON DELETE SET NULL so it won't block, but ownership would silently drop.
    const [branchCount, productCount] = await Promise.all([
      this.prisma.branch.count({ where: { companyId: id, deletedAt: null } }),
      this.prisma.product.count({ where: { ownedByCompanyId: id, deletedAt: null } }),
    ]);

    if (branchCount > 0) {
      throw new BadRequestException(
        `ไม่สามารถลบบริษัทได้: ยังมี ${branchCount} สาขาอยู่ใต้บริษัทนี้`,
      );
    }
    if (productCount > 0) {
      throw new BadRequestException(
        `ไม่สามารถลบบริษัทได้: ยังมีสินค้า ${productCount} ชิ้นที่ถือกรรมสิทธิ์โดยบริษัทนี้`,
      );
    }

    return this.prisma.companyInfo.update({
      where: { id: company.id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }
}
