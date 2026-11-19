import { currentDomainAccess } from '../employee-access/access-execution-context';
import { writeSharedReference } from '../employee-access/access-shared-reference';
import { resolveBcConfig } from './resolve-bc-config';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveInstallmentVat } from '../../utils/config.util';
import {
  CreateInterestConfigDto,
  UpdateInterestConfigDto,
  InterestRateRowDto,
} from './dto/interest-config.dto';

const RATES_INCLUDE = {
  rates: {
    where: { deletedAt: null },
    select: { months: true, ratePct: true },
    orderBy: { months: 'asc' as const },
  },
};

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
        include: RATES_INCLUDE,
      }),
    );
  }

  async findOne(id: string) {
    const config = await this.prisma.interestConfig.findFirst({
      where: { id, deletedAt: null },
      include: RATES_INCLUDE,
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
    // งวดที่หน้าสร้างสัญญาให้เลือก — กติกาเดียวกับ getRateForMonths: มีแถวรายงวด = รับเฉพาะงวดที่มีแถว
    const rates = await this.prisma.interestConfigRate.findMany({
      where: { configId: config.id, deletedAt: null },
      select: { months: true },
      orderBy: { months: 'asc' },
    });
    return { ...withVat, allowedMonths: rates.map((r) => r.months) };
  }

  async create(dto: CreateInterestConfigDto) {
    this.validateMonths(dto.minInstallmentMonths, dto.maxInstallmentMonths);
    this.assertHasInterest(dto.interestRate, dto.rates?.length ?? 0);
    const created = await writeSharedReference(this.base, async (tx) => {
      const row = await tx.interestConfig.create({
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
      });
      if (dto.rates !== undefined) {
        await this.replaceRates(tx, row.id, dto.rates, dto.minInstallmentMonths, dto.maxInstallmentMonths);
      }
      return row;
    });
    // managed path คืน `{ id }` (boundary) — ทางปกติคืนแถว ⇒ แทน vatPct ด้วยค่า FINANCE เหมือนตอนอ่าน
    return 'vatPct' in created ? (await this.withFinanceVat([created]))[0] : created;
  }

  async update(id: string, dto: UpdateInterestConfigDto) {
    const updated = await writeSharedReference(this.base, async (tx) => {
      const config = await tx.interestConfig.findFirst({ where: { id, deletedAt: null } });
      if (!config) throw new NotFoundException('ไม่พบการตั้งค่าดอกเบี้ย');
      const minMonths = dto.minInstallmentMonths ?? config.minInstallmentMonths;
      const maxMonths = dto.maxInstallmentMonths ?? config.maxInstallmentMonths;
      this.validateMonths(minMonths, maxMonths);
      // #22: vatPct จากหน้าเว็บรุ่นเก่า (ถ้ามี) ไม่ถูกเขียน — VAT ของการผ่อนมาจาก FINANCE
      const { vatPct: _ignoredVatPct, rates, ...data } = dto as UpdateInterestConfigDto & {
        vatPct?: unknown;
      };
      void _ignoredVatPct;
      // กันสัญญาดอกเบี้ย 0%: ต่อเดือน 0 ต้องมีแถวรายงวดอย่างน้อย 1 แถว (นับก่อนเขียนอะไร)
      const monthly = dto.interestRate ?? config.interestRate;
      const rowCount =
        rates !== undefined
          ? rates.length
          : monthly !== undefined && Number(monthly) <= 0
            ? (await tx.interestConfigRate.findMany({ where: { configId: id, deletedAt: null }, select: { months: true } })).length
            : 1;
      this.assertHasInterest(monthly, rowCount);
      if (rates !== undefined) {
        await this.replaceRates(tx, id, rates, minMonths, maxMonths);
      } else if (dto.minInstallmentMonths !== undefined || dto.maxInstallmentMonths !== undefined) {
        // ช่วงงวดเปลี่ยนแต่ไม่ได้ส่งตาราง — แถวเดิมต้องยังอยู่ในช่วง (ไม่งั้นหน้าราคาเสนองวดที่สัญญาปฏิเสธ)
        const current = await tx.interestConfigRate.findMany({
          where: { configId: id, deletedAt: null },
          select: { months: true },
        });
        const outside = current.find((r) => r.months < minMonths || r.months > maxMonths);
        if (outside) {
          throw new BadRequestException(
            `${this.outsideRangeMessage(outside.months, minMonths, maxMonths)} — แก้ตารางรายงวดก่อน`,
          );
        }
      }
      // แก้เฉพาะตาราง → ยังต้องแตะแถว config เพื่อให้ updatedAt ตรงความจริง (row fence ของใบเสนอสัญญา)
      return tx.interestConfig.update({
        where: { id },
        data: rates !== undefined ? { ...data, updatedAt: new Date() } : data,
      });
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

  /** แทนตารางรายงวดของ config ทั้งชุด — แถวที่ไม่อยู่ในชุดถูก soft delete · แถวที่เคยลบถูกชุบ (unique รวมแถวที่ลบ) */
  private async replaceRates(
    tx: Prisma.TransactionClient,
    configId: string,
    rates: InterestRateRowDto[],
    minMonths: number,
    maxMonths: number,
  ) {
    const seen = new Set<number>();
    for (const r of rates) {
      if (seen.has(r.months)) {
        throw new BadRequestException(`จำนวนงวดซ้ำกันในตารางรายงวด: ${r.months} งวด`);
      }
      seen.add(r.months);
      if (r.months < minMonths || r.months > maxMonths) {
        throw new BadRequestException(this.outsideRangeMessage(r.months, minMonths, maxMonths));
      }
    }
    const months = rates.map((r) => r.months);
    await tx.interestConfigRate.updateMany({
      where: { configId, deletedAt: null, months: { notIn: months } },
      data: { deletedAt: new Date() },
    });
    for (const r of rates) {
      await tx.interestConfigRate.upsert({
        where: { configId_months: { configId, months: r.months } },
        update: { ratePct: r.ratePct, deletedAt: null },
        create: { configId, months: r.months, ratePct: r.ratePct },
      });
    }
  }

  private outsideRangeMessage(months: number, minMonths: number, maxMonths: number) {
    return `ตารางรายงวดมี ${months} งวด ซึ่งอยู่นอกช่วงงวดต่ำสุด–สูงสุด (${minMonths}–${maxMonths} งวด)`;
  }

  /** ต่อเดือน ≤ 0 และไม่มีแถวรายงวด = สัญญาได้ดอกเบี้ย 0% — ไม่รับ */
  private assertHasInterest(monthly: unknown, rowCount: number) {
    if (Number(monthly) <= 0 && rowCount === 0) {
      throw new BadRequestException(
        'ต้องมีดอกเบี้ยต่อเดือนมากกว่า 0 หรือมีตารางดอกเบี้ยรายงวดอย่างน้อย 1 แถว',
      );
    }
  }

  private validateMonths(min: number, max: number) {
    if (min > max)
      throw new BadRequestException('จำนวนงวดขั้นต่ำต้องน้อยกว่าหรือเท่ากับจำนวนงวดสูงสุด');
  }

  resolveConfig(category: string) {
    return resolveBcConfig(this.prisma, category);
  }
}
