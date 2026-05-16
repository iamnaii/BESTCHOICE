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

  /**
   * D1.2.4.1 — global feature flag for Expense Templates. Read direct from
   * SystemConfig (avoids SettingsService injection — keeps the ctor lean
   * and dodges potential audit↔settings circular dep). Default true so
   * legacy behaviour is preserved when the SystemConfig row is missing.
   *
   * Gates WRITE paths only (create/update/delete/instantiate). Read paths
   * (list/findOne) stay open so OWNER can disable the feature without
   * hiding pre-existing templates from auditors.
   */
  private async assertTemplatesEnabled(): Promise<void> {
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: 'templates_enabled', deletedAt: null },
        select: { value: true },
      });
      const raw = row?.value?.trim().toLowerCase();
      // Only explicit 'false' / '0' disables. Missing row or any other
      // value keeps the feature on (fail-open default).
      if (raw === 'false' || raw === '0') {
        throw new ForbiddenException(
          'ระบบรายการโปรดถูกปิดใช้งานชั่วคราว — กรุณาติดต่อผู้ดูแลระบบ',
        );
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      // DB read failure → fail-open (preserve existing behaviour)
    }
  }

  async create(dto: CreateTemplateDto, user: UserContext) {
    await this.assertTemplatesEnabled();
    this.assertBranchAccess(dto.branchId, user);
    // CN ผูกกับเอกสารต้นฉบับเฉพาะตัว — บันทึกเป็น template ไม่ได้
    // (originalDocumentId จะ stale + cumulative cap จะหมดเมื่อใช้รอบสอง)
    if (dto.documentType === 'CREDIT_NOTE') {
      throw new BadRequestException(
        'ใบลดหนี้บันทึกเป็นรายการโปรดไม่ได้ — แต่ละใบลดหนี้ต้องผูกกับเอกสารต้นฉบับเฉพาะ',
      );
    }
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
    // Hard cap on rows returned. Favorites are user-curated so this should
    // never realistically be hit, but it prevents an unbounded findMany if a
    // future caller floods the table.
    // TODO: switch to cursor pagination when a shop legitimately exceeds this.
    // Returning the cap silently is acceptable today because the UI only
    // surfaces the most recent + recurring entries first via the orderBy.
    return this.prisma.expenseTemplate.findMany({
      where,
      orderBy: [{ isRecurring: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
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
    await this.assertTemplatesEnabled();
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
    await this.assertTemplatesEnabled();
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
    await this.assertTemplatesEnabled();
    const tpl = await this.findOne(id, user);
    const today = override?.documentDate ?? new Date();
    const documentDate = today.toISOString();
    const data = tpl.prefilledData as Record<string, unknown>;

    switch (tpl.documentType) {
      case 'EXPENSE': {
        // V4 multi-line: synthesize one line from the legacy single-category template.
        // amount is placeholder (0.01); user must edit unitPrice before posting.
        return this.docs.create({
          ...data,
          documentType: 'EXPENSE',
          branchId: tpl.branchId,
          documentDate,
          fromTemplateId: tpl.id,
          lines: [{
            category: (data.category as string) || '53-1302',
            description: (data.description as string) || tpl.name,
            quantity: 1,
            unitPrice: (data.sampleAmount as number) ?? 0.01,
            discount: 0,
            vatPercent: 0,
            whtPercent: 0,
          }],
        } as never, user.id);
      }
      case 'CREDIT_NOTE': {
        // Defensive — create() rejects CREDIT_NOTE templates, but legacy rows
        // from before that guard could still exist.
        throw new BadRequestException(
          'ใบลดหนี้สร้างจากรายการโปรดไม่ได้ — กรุณาเปิดเอกสารต้นฉบับแล้วกด "ออกใบลดหนี้"',
        );
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
