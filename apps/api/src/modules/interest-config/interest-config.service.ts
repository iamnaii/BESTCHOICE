import { currentDomainAccess } from '../employee-access/access-execution-context';
import { writeSharedReference } from '../employee-access/access-shared-reference';
import { resolveBcConfig } from './resolve-bc-config';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveInstallmentVat } from '../../utils/config.util';
import { CreateInterestConfigDto, UpdateInterestConfigDto } from './dto/interest-config.dto';

@Injectable()
export class InterestConfigService {
  constructor(private readonly base: PrismaService) {}

  private get prisma() {
    return currentDomainAccess()?.client ?? this.base;
  }

  /**
   * คำตัดสินเจ้าของ #22 (2026-10-31): VAT ของตั้งค่าดอกเบี้ย = VAT ของบริษัท FINANCE ที่เดียว — `vatPct` ที่ส่งออกถูกแทนด้วยค่านั้น
   * (`resolveInstallmentVat`) ⇒ ผู้อ่านทุกตัวบนเว็บ (หน้าตั้งค่าดอกเบี้ย · พรีวิวสร้างสัญญา) ได้ค่าเดียวกับใบเสนอยอด ·
   * คอลัมน์ `interest_configs.vat_pct` ยังอยู่แต่ไม่ถูกอ่านไปคำนวณ และ create/update ไม่เขียน
   */
  private async withFinanceVat<T extends { vatPct: unknown }>(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows;
    const { vatPct } = await resolveInstallmentVat(this.prisma);
    return rows.map((row) => ({ ...row, vatPct: new Prisma.Decimal(vatPct) }));
  }

  async findAll() {
    return this.withFinanceVat(
      await this.prisma.interestConfig.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async findOne(id: string) {
    const config = await this.prisma.interestConfig.findFirst({
      where: { id, deletedAt: null },
    });
    if (!config) throw new NotFoundException('ไม่พบการตั้งค่าดอกเบี้ย');
    const [withVat] = await this.withFinanceVat([config]);
    return withVat;
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
    if (!config) return config;
    const [withVat] = await this.withFinanceVat([config]);
    return withVat;
  }

  async create(dto: CreateInterestConfigDto) {
    this.validateMonths(dto.minInstallmentMonths, dto.maxInstallmentMonths);
    const created = await writeSharedReference(this.base, (tx) =>
      tx.interestConfig.create({
        data: {
          name: dto.name,
          productCategories: dto.productCategories,
          interestRate: dto.interestRate,
          minDownPaymentPct: dto.minDownPaymentPct,
          storeCommissionPct: dto.storeCommissionPct,
          // vat_pct ไม่เขียน (#22 — VAT มาจาก FINANCE) · คอลัมน์ได้ค่า default ของตาราง ไม่มีใครอ่าน
          minInstallmentMonths: dto.minInstallmentMonths,
          maxInstallmentMonths: dto.maxInstallmentMonths,
        },
      }),
    );
    // managed path คืน `{ id }` (boundary) — ทางปกติคืนแถว ⇒ แทน vatPct ด้วยค่า FINANCE เหมือนตอนอ่าน
    return 'vatPct' in created ? (await this.withFinanceVat([created]))[0] : created;
  }

  async update(id: string, dto: UpdateInterestConfigDto) {
    const updated = await writeSharedReference(this.base, async (tx) => {
      const config = await tx.interestConfig.findFirst({ where: { id, deletedAt: null } });
      if (!config) throw new NotFoundException('ไม่พบการตั้งค่าดอกเบี้ย');
      this.validateMonths(
        dto.minInstallmentMonths ?? config.minInstallmentMonths,
        dto.maxInstallmentMonths ?? config.maxInstallmentMonths,
      );
      // #22: vatPct จากหน้าเว็บรุ่นเก่า (ถ้ามี) ไม่ถูกเขียน — VAT ของการผ่อนมาจาก FINANCE
      const { vatPct: _ignoredVatPct, ...data } = dto as UpdateInterestConfigDto & {
        vatPct?: unknown;
      };
      void _ignoredVatPct;
      return tx.interestConfig.update({ where: { id }, data });
    });
    return 'vatPct' in updated ? (await this.withFinanceVat([updated]))[0] : updated;
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
