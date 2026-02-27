import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTemplateDto, UpdateTemplateDto,
  CreateTemplateItemDto, UpdateTemplateItemDto,
  CreateInspectionDto, UpdateInspectionDto, OverrideGradeDto,
} from './dto/inspection.dto';

@Injectable()
export class InspectionsService {
  constructor(private prisma: PrismaService) {}

  // === Template Management ===

  async findAllTemplates() {
    return this.prisma.inspectionTemplate.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true, inspections: true } } },
    });
  }

  async findOneTemplate(id: string) {
    const template = await this.prisma.inspectionTemplate.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw new NotFoundException('ไม่พบ Template');
    return template;
  }

  async createTemplate(dto: CreateTemplateDto) {
    return this.prisma.inspectionTemplate.create({ data: dto });
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto) {
    await this.findOneTemplate(id);
    return this.prisma.inspectionTemplate.update({ where: { id }, data: dto });
  }

  async deleteTemplate(id: string) {
    await this.findOneTemplate(id);
    return this.prisma.inspectionTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // === Template Items ===

  async addTemplateItem(templateId: string, dto: CreateTemplateItemDto) {
    await this.findOneTemplate(templateId);
    return this.prisma.inspectionTemplateItem.create({
      data: { templateId, ...dto } as Prisma.InspectionTemplateItemUncheckedCreateInput,
    });
  }

  async updateTemplateItem(templateId: string, itemId: string, dto: UpdateTemplateItemDto) {
    const item = await this.prisma.inspectionTemplateItem.findFirst({
      where: { id: itemId, templateId },
    });
    if (!item) throw new NotFoundException('ไม่พบหัวข้อตรวจ');
    return this.prisma.inspectionTemplateItem.update({ where: { id: itemId }, data: dto as Prisma.InspectionTemplateItemUncheckedUpdateInput });
  }

  async deleteTemplateItem(templateId: string, itemId: string) {
    const item = await this.prisma.inspectionTemplateItem.findFirst({
      where: { id: itemId, templateId },
    });
    if (!item) throw new NotFoundException('ไม่พบหัวข้อตรวจ');
    return this.prisma.inspectionTemplateItem.delete({ where: { id: itemId } });
  }

  // === Inspections ===

  async findAllInspections(filters: { isCompleted?: string; productId?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.isCompleted === 'true') where.isCompleted = true;
    if (filters.isCompleted === 'false') where.isCompleted = false;
    if (filters.productId) where.productId = filters.productId;

    return this.prisma.inspection.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { id: true, name: true } },
        inspector: { select: { id: true, name: true } },
        products: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true } },
      },
    });
  }

  async findOneInspection(id: string) {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
      include: {
        template: { include: { items: { orderBy: { sortOrder: 'asc' } } } },
        inspector: { select: { id: true, name: true } },
        products: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true } },
        results: { include: { templateItem: true } },
      },
    });
    if (!inspection) throw new NotFoundException('ไม่พบการตรวจ');
    return inspection;
  }

  async createInspection(dto: CreateInspectionDto, inspectorId: string) {
    // Verify product exists
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');

    // Verify template
    const template = await this.findOneTemplate(dto.templateId);

    const inspection = await this.prisma.inspection.create({
      data: {
        productId: dto.productId,
        templateId: dto.templateId,
        inspectorId,
      },
    });

    // Update product status to INSPECTION
    await this.prisma.product.update({
      where: { id: dto.productId },
      data: { status: 'INSPECTION', inspectionId: inspection.id },
    });

    return inspection;
  }

  async updateInspection(id: string, dto: UpdateInspectionDto) {
    const inspection = await this.findOneInspection(id);
    if (inspection.isCompleted) throw new BadRequestException('ตรวจเสร็จแล้ว ไม่สามารถแก้ไขได้');

    // Upsert results
    for (const result of dto.results) {
      const existing = await this.prisma.inspectionResult.findFirst({
        where: { inspectionId: id, templateItemId: result.templateItemId },
      });

      if (existing) {
        await this.prisma.inspectionResult.update({
          where: { id: existing.id },
          data: result as Prisma.InspectionResultUncheckedUpdateInput,
        });
      } else {
        await this.prisma.inspectionResult.create({
          data: { inspectionId: id, ...result } as Prisma.InspectionResultUncheckedCreateInput,
        });
      }
    }

    // Update notes and photos
    const updateData: Record<string, unknown> = {};
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.photos !== undefined) updateData.photos = dto.photos;
    if (Object.keys(updateData).length > 0) {
      await this.prisma.inspection.update({ where: { id }, data: updateData });
    }

    return this.findOneInspection(id);
  }

  async completeInspection(id: string) {
    const inspection = await this.findOneInspection(id);
    if (inspection.isCompleted) throw new BadRequestException('ตรวจเสร็จแล้ว');

    // Calculate auto grade
    const grade = await this.calculateGrade(id);

    await this.prisma.inspection.update({
      where: { id },
      data: {
        isCompleted: true,
        inspectedAt: new Date(),
        overallGrade: grade,
      },
    });

    // Update product grade and status
    if (inspection.products.length > 0) {
      await this.prisma.product.update({
        where: { id: inspection.products[0].id },
        data: { conditionGrade: grade, status: 'IN_STOCK' },
      });
    }

    return this.findOneInspection(id);
  }

  async overrideGrade(id: string, dto: OverrideGradeDto) {
    const inspection = await this.findOneInspection(id);
    if (!inspection.isCompleted) throw new BadRequestException('กรุณาตรวจให้เสร็จก่อน');

    await this.prisma.inspection.update({
      where: { id },
      data: { gradeOverride: dto.grade as 'A' | 'B' | 'C' | 'D', overrideReason: dto.reason },
    });

    // Update product grade
    if (inspection.products.length > 0) {
      await this.prisma.product.update({
        where: { id: inspection.products[0].id },
        data: { conditionGrade: dto.grade as 'A' | 'B' | 'C' | 'D' },
      });
    }

    return this.findOneInspection(id);
  }

  // === Auto-Grading Logic ===

  private async calculateGrade(inspectionId: string): Promise<'A' | 'B' | 'C' | 'D'> {
    const results = await this.prisma.inspectionResult.findMany({
      where: { inspectionId },
      include: { templateItem: true },
    });

    // Get grade thresholds from system config
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: ['grade_a_threshold', 'grade_b_threshold', 'grade_c_threshold'] } },
    });
    const thresholds = {
      A: parseInt(configs.find((c) => c.key === 'grade_a_threshold')?.value || '90'),
      B: parseInt(configs.find((c) => c.key === 'grade_b_threshold')?.value || '70'),
      C: parseInt(configs.find((c) => c.key === 'grade_c_threshold')?.value || '50'),
    };

    let totalWeight = 0;
    let totalScore = 0;
    let hasRequiredFail = false;

    for (const result of results) {
      const weight = Number(result.templateItem.weight);
      totalWeight += weight;

      let itemScore = 0;
      switch (result.templateItem.scoreType) {
        case 'PASS_FAIL':
          itemScore = result.passFail ? 100 : 0;
          if (!result.passFail && result.templateItem.isRequired) hasRequiredFail = true;
          break;
        case 'GRADE': {
          const gradeScores: Record<string, number> = { A: 100, B: 75, C: 50, D: 25 };
          itemScore = gradeScores[result.grade || 'D'] || 0;
          break;
        }
        case 'SCORE_1_5':
          itemScore = ((Number(result.score) || 0) / 5) * 100;
          break;
        case 'NUMBER':
          itemScore = Math.min(Number(result.numberValue) || 0, 100);
          break;
      }

      totalScore += itemScore * weight;
    }

    const percentage = totalWeight > 0 ? totalScore / totalWeight : 0;

    // If required item failed, cap at C
    if (hasRequiredFail && percentage >= thresholds.B) {
      return 'C';
    }

    if (percentage >= thresholds.A) return 'A';
    if (percentage >= thresholds.B) return 'B';
    if (percentage >= thresholds.C) return 'C';
    return 'D';
  }
}
