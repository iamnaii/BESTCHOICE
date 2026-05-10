import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpenseDocumentsService } from './expense-documents.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { hasCrossBranchAccess } from '../auth/branch-access.util';

interface UserContext {
  id: string;
  branchId?: string | null;
  role?: string;
}

@Injectable()
export class ExpenseTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ExpenseDocumentsService))
    private readonly docs: ExpenseDocumentsService,
  ) {}

  private assertBranchAccess(branchId: string, user: UserContext) {
    if (hasCrossBranchAccess(user)) return;
    if (user.branchId !== branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึง template ในสาขาอื่นได้');
    }
  }

  async create(dto: CreateTemplateDto, user: UserContext) {
    this.assertBranchAccess(dto.branchId, user);
    if (dto.isRecurring && (dto.recurringDay == null || dto.recurringDay < 1 || dto.recurringDay > 31)) {
      throw new BadRequestException('Recurring template ต้องระบุ recurringDay 1-31');
    }
    return this.prisma.expenseTemplate.create({
      data: {
        name: dto.name,
        documentType: dto.documentType as never,
        branchId: dto.branchId,
        prefilledData: dto.prefilledData as Prisma.InputJsonValue,
        isRecurring: dto.isRecurring ?? false,
        recurringDay: dto.recurringDay ?? null,
        createdById: user.id,
      },
    });
  }

  async list(filters: { branchId?: string; type?: string }, user: UserContext) {
    const where: Prisma.ExpenseTemplateWhereInput = { deletedAt: null };
    const branchId = hasCrossBranchAccess(user) ? filters.branchId : (user.branchId ?? filters.branchId);
    if (branchId) where.branchId = branchId;
    if (filters.type) where.documentType = filters.type as never;
    return this.prisma.expenseTemplate.findMany({
      where,
      orderBy: [{ isRecurring: 'desc' }, { updatedAt: 'desc' }],
      include: { branch: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
    });
  }

  async findOne(id: string, user: UserContext) {
    const tpl = await this.prisma.expenseTemplate.findUniqueOrThrow({ where: { id } });
    if (tpl.deletedAt) throw new NotFoundException('Template ถูกลบไปแล้ว');
    this.assertBranchAccess(tpl.branchId, user);
    return tpl;
  }

  async update(id: string, dto: UpdateTemplateDto, user: UserContext) {
    const tpl = await this.findOne(id, user);
    if (dto.isRecurring === true && (dto.recurringDay ?? tpl.recurringDay) == null) {
      throw new BadRequestException('Recurring template ต้องระบุ recurringDay 1-31');
    }
    const data: Prisma.ExpenseTemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.prefilledData !== undefined) data.prefilledData = dto.prefilledData as Prisma.InputJsonValue;
    if (dto.isRecurring !== undefined) data.isRecurring = dto.isRecurring;
    if (dto.recurringDay !== undefined) data.recurringDay = dto.recurringDay;
    return this.prisma.expenseTemplate.update({ where: { id }, data });
  }

  async softDelete(id: string, user: UserContext) {
    const tpl = await this.prisma.expenseTemplate.findUniqueOrThrow({ where: { id } });
    if (tpl.deletedAt) throw new BadRequestException('Template ถูกลบไปแล้ว');
    this.assertBranchAccess(tpl.branchId, user);
    return this.prisma.expenseTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Create new DRAFT document from template's prefilledData.
   * Maps each documentType to the right ExpenseDocumentsService.create*() method.
   */
  async instantiate(id: string, user: UserContext, override?: { documentDate?: Date }) {
    const tpl = await this.findOne(id, user);
    const today = override?.documentDate ?? new Date();
    const documentDate = today.toISOString();
    const data = tpl.prefilledData as Record<string, unknown>;

    switch (tpl.documentType) {
      case 'EXPENSE': {
        return this.docs.create({
          ...data,
          documentType: 'EXPENSE',
          branchId: tpl.branchId,
          documentDate,
          subtotal: 0.01, // Placeholder — user must fill before posting
          fromTemplateId: tpl.id,
          detail: { category: data.category as string },
        } as never, user.id);
      }
      case 'CREDIT_NOTE': {
        return this.docs.createCreditNote({
          ...data,
          branchId: tpl.branchId,
          documentDate,
          fromTemplateId: tpl.id,
        } as never, user.id);
      }
      case 'PAYROLL': {
        // payrollPeriod = current month YYYY-MM
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        return this.docs.createPayroll({
          ...data,
          branchId: tpl.branchId,
          documentDate,
          payrollPeriod: `${y}-${m}`,
          lines: (data.lines as unknown[]) ?? [],
          fromTemplateId: tpl.id,
        } as never, user);
      }
      case 'VENDOR_SETTLEMENT': {
        return this.docs.createSettlement({
          ...data,
          branchId: tpl.branchId,
          documentDate,
          lines: (data.lines as unknown[]) ?? [],
          fromTemplateId: tpl.id,
        } as never, user);
      }
      default:
        throw new BadRequestException(`Unknown documentType ${tpl.documentType}`);
    }
  }
}
