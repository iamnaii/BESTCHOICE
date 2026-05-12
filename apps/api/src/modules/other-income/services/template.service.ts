import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { replaceVariables } from './template-vars.util';

interface TemplateItem {
  lineNo: number;
  accountCode: string;
  description?: string | null;
  quantity: number;
  unitAmount: number;
  discountAmount: number;
  vatPct: number;
  whtPct: number;
}

interface CreateInput {
  name: string;
  itemsJson: TemplateItem[];
  priceType: 'EXCLUSIVE' | 'INCLUSIVE';
}

interface UpdateInput {
  name?: string;
  isFavorite?: boolean;
}

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveFinanceCompanyId(): Promise<string> {
    const co = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!co) throw new BadRequestException('CompanyInfo FINANCE not found');
    return co.id;
  }

  async create(dto: CreateInput, userId: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('กรุณาระบุชื่อ Template');
    }
    if (!dto.itemsJson || dto.itemsJson.length === 0) {
      throw new BadRequestException('Template ต้องมีรายการอย่างน้อย 1 รายการ');
    }
    const companyId = await this.resolveFinanceCompanyId();
    return this.prisma.otherIncomeTemplate.create({
      data: {
        companyId,
        name: dto.name.trim(),
        itemsJson: dto.itemsJson as any,
        priceType: dto.priceType,
        createdById: userId,
      },
    });
  }

  async createFromDoc(docId: string, name: string, userId: string) {
    if (!name?.trim()) throw new BadRequestException('กรุณาระบุชื่อ Template');
    const doc = await this.prisma.otherIncome.findFirst({
      where: { id: docId, deletedAt: null },
      include: { items: { orderBy: { lineNo: 'asc' } } },
    });
    if (!doc) throw new NotFoundException(`OtherIncome ${docId} not found`);

    const itemsJson: TemplateItem[] = doc.items.map((it) => ({
      lineNo: it.lineNo,
      accountCode: it.accountCode,
      description: it.description,
      quantity: Number(it.quantity),
      unitAmount: Number(it.unitAmount),
      discountAmount: Number(it.discountAmount),
      vatPct: Number(it.vatPct),
      whtPct: Number(it.whtPct),
    }));

    return this.create(
      { name: name.trim(), itemsJson, priceType: doc.priceType },
      userId,
    );
  }

  async list(query: { q?: string; favoritesOnly?: boolean }) {
    const where: any = { deletedAt: null };
    if (query.favoritesOnly) where.isFavorite = true;
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

    return this.prisma.otherIncomeTemplate.findMany({
      where,
      orderBy: [{ isFavorite: 'desc' }, { lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async update(id: string, dto: UpdateInput) {
    const tpl = await this.prisma.otherIncomeTemplate.findFirst({
      where: { id, deletedAt: null },
    });
    if (!tpl) throw new NotFoundException(`Template ${id} not found`);
    return this.prisma.otherIncomeTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.isFavorite !== undefined ? { isFavorite: dto.isFavorite } : {}),
      },
    });
  }

  async softDelete(id: string) {
    const tpl = await this.prisma.otherIncomeTemplate.findFirst({
      where: { id, deletedAt: null },
    });
    if (!tpl) throw new NotFoundException(`Template ${id} not found`);
    return this.prisma.otherIncomeTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * "Use" a template: return its items with variables resolved + bump usage counters.
   * Does NOT create the OtherIncome doc — the caller (frontend) pre-fills the entry form.
   */
  async use(id: string, now: Date = new Date()) {
    const tpl = await this.prisma.otherIncomeTemplate.findFirst({
      where: { id, deletedAt: null },
    });
    if (!tpl) throw new NotFoundException(`Template ${id} not found`);

    const items = (tpl.itemsJson as unknown as TemplateItem[]).map((it) => ({
      ...it,
      description: it.description ? replaceVariables(it.description, now) : it.description,
    }));

    await this.prisma.otherIncomeTemplate.update({
      where: { id },
      data: { useCount: { increment: 1 }, lastUsedAt: now },
    });

    return { id: tpl.id, name: tpl.name, priceType: tpl.priceType, items };
  }
}
