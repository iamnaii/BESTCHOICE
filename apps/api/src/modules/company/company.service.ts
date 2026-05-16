import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

/** D1.2.2.* — Public-safe slice of CompanyInfo for voucher rendering. */
export interface PublicCompanyInfo {
  id: string;
  nameTh: string;
  nameEn: string | null;
  taxId: string;
  companyCode: string | null;
  address: string;
  phone: string | null;
  logoUrl: string | null;
}

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

  /**
   * D1.2.2.1+ — Public-safe CompanyInfo for voucher/receipt rendering.
   * Returns the SHOP and FINANCE companies with only the fields needed to
   * print a header: id, nameTh, nameEn, taxId, companyCode, address, phone,
   * logoUrl. Excludes director PII, bank account numbers, VAT internals.
   * Authenticated but accessible to all roles (any user printing a voucher).
   */
  async findPublic(): Promise<{
    shop: PublicCompanyInfo | null;
    finance: PublicCompanyInfo | null;
  }> {
    const rows = await this.prisma.companyInfo.findMany({
      where: {
        companyCode: { in: ['SHOP', 'FINANCE'] },
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        nameTh: true,
        nameEn: true,
        taxId: true,
        companyCode: true,
        address: true,
        phone: true,
        logoUrl: true,
      },
    });
    return {
      shop: (rows.find((r) => r.companyCode === 'SHOP') ?? null) as PublicCompanyInfo | null,
      finance:
        (rows.find((r) => r.companyCode === 'FINANCE') ?? null) as PublicCompanyInfo | null,
    };
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
