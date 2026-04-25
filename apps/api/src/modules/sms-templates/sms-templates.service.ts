import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SmsTemplate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSmsTemplateDto } from './dto/create.dto';
import { UpdateSmsTemplateDto } from './dto/update.dto';
import { CreateVariantDto } from './dto/variant.dto';

const DEFAULT_SAMPLE_DATA: Record<string, string> = {
  customerName: 'สมชาย ใจดี',
  contractNumber: 'CT-2026-000123',
  amount: '5,400',
  amountDue: '5,400',
  dueDate: '25 เม.ย. 2569',
  daysOverdue: '7',
  installmentNo: '4',
  paymentLink: 'https://pay.bestchoice.com/abc123',
};

@Injectable()
export class SmsTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all non-deleted templates. Optional `channel` filter narrows to
   * SMS or LINE. Variants are eager-loaded so the table can render the
   * "variant of" column without N+1 queries.
   */
  async list(channel?: string): Promise<SmsTemplate[]> {
    const where: Prisma.SmsTemplateWhereInput = { deletedAt: null };
    if (channel) {
      if (channel !== 'SMS' && channel !== 'LINE') {
        throw new BadRequestException('channel ต้องเป็น SMS หรือ LINE');
      }
      where.channel = channel;
    }
    return this.prisma.smsTemplate.findMany({
      where,
      orderBy: [{ variantOf: 'asc' }, { name: 'asc' }],
      include: {
        parent: { select: { id: true, name: true } },
      },
    });
  }

  async findOne(id: string): Promise<SmsTemplate> {
    const tpl = await this.prisma.smsTemplate.findFirst({
      where: { id, deletedAt: null },
      include: {
        parent: { select: { id: true, name: true } },
        variants: {
          where: { deletedAt: null },
          select: { id: true, name: true, active: true },
        },
      },
    });
    if (!tpl) {
      throw new NotFoundException('ไม่พบ template');
    }
    return tpl;
  }

  async create(dto: CreateSmsTemplateDto): Promise<SmsTemplate> {
    const dup = await this.prisma.smsTemplate.findFirst({
      where: { name: dto.name, deletedAt: null },
    });
    if (dup) {
      throw new ConflictException('ชื่อ template นี้ถูกใช้แล้ว');
    }
    return this.prisma.smsTemplate.create({
      data: {
        name: dto.name,
        channel: dto.channel,
        subject: dto.subject ?? null,
        body: dto.body,
        variables: dto.variables as unknown as Prisma.InputJsonValue,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateSmsTemplateDto): Promise<SmsTemplate> {
    await this.findOne(id);

    if (dto.name) {
      const dup = await this.prisma.smsTemplate.findFirst({
        where: { name: dto.name, deletedAt: null, NOT: { id } },
      });
      if (dup) {
        throw new ConflictException('ชื่อ template นี้ถูกใช้แล้ว');
      }
    }

    const data: Prisma.SmsTemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.channel !== undefined) data.channel = dto.channel;
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.variables !== undefined) {
      data.variables = dto.variables as unknown as Prisma.InputJsonValue;
    }
    if (dto.active !== undefined) data.active = dto.active;

    return this.prisma.smsTemplate.update({ where: { id }, data });
  }

  /**
   * Soft delete. The DunningRule.templateName reference is kept intact —
   * the engine simply falls back to the inline `messageTemplate` when the
   * referenced template is missing or inactive.
   */
  async remove(id: string): Promise<{ id: string; deletedAt: Date }> {
    await this.findOne(id);
    const updated = await this.prisma.smsTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
    return { id: updated.id, deletedAt: updated.deletedAt! };
  }

  /**
   * Server-side template renderer. Replaces `{{variableName}}` with the
   * provided sample data, leaving unknown variables in-place so the operator
   * can spot typos. We render server-side (rather than client) so the same
   * rendering pipeline that ships actual messages produces the preview —
   * eliminating "looked fine in editor, broken in production" drift.
   */
  renderTemplate(body: string, sampleData: Record<string, string | number>): string {
    return body.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = sampleData[key];
      if (value === undefined || value === null) return match;
      return String(value);
    });
  }

  async preview(
    id: string,
    sampleData?: Record<string, string | number>,
  ): Promise<{ rendered: string; usedSampleData: Record<string, string | number> }> {
    const tpl = await this.findOne(id);
    const merged: Record<string, string | number> = {
      ...DEFAULT_SAMPLE_DATA,
      ...(sampleData ?? {}),
    };
    return {
      rendered: this.renderTemplate(tpl.body, merged),
      usedSampleData: merged,
    };
  }

  /**
   * Create an A/B variant linked to a parent template. The parent must not
   * itself be a variant (we only allow a single layer of variants — keeps
   * reporting math simple). The new variant inherits channel + subject +
   * variables; only `name` and `body` may be overridden via DTO.
   */
  async createVariant(parentId: string, dto: CreateVariantDto): Promise<SmsTemplate> {
    const parent = await this.prisma.smsTemplate.findFirst({
      where: { id: parentId, deletedAt: null },
    });
    if (!parent) {
      throw new NotFoundException('ไม่พบ template ต้นทาง');
    }
    if (parent.variantOf) {
      throw new BadRequestException(
        'ไม่สามารถสร้าง variant ของ variant ได้ — กรุณาเลือก template ต้นทาง',
      );
    }

    const baseName = dto.name ?? `${parent.name} (variant)`;
    const finalName = await this.resolveUniqueName(baseName);

    return this.prisma.smsTemplate.create({
      data: {
        name: finalName,
        channel: parent.channel,
        subject: parent.subject,
        body: dto.body ?? parent.body,
        variables: parent.variables as unknown as Prisma.InputJsonValue,
        active: true,
        variantOf: parent.id,
      },
    });
  }

  private async resolveUniqueName(base: string): Promise<string> {
    let candidate = base;
    let suffix = 2;
    // Cap iterations to avoid pathological loops.
    while (suffix < 100) {
      const exists = await this.prisma.smsTemplate.findFirst({
        where: { name: candidate, deletedAt: null },
      });
      if (!exists) return candidate;
      candidate = `${base} #${suffix}`;
      suffix += 1;
    }
    throw new ConflictException('ไม่สามารถสร้างชื่อ variant ที่ไม่ซ้ำได้');
  }
}
