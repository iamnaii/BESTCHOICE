import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationCategory, NotificationTemplate, Prisma } from '@prisma/client';
import {
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
} from './dto/notification-template.dto';

@Injectable()
export class NotificationTemplateService {
  private readonly logger = new Logger(NotificationTemplateService.name);

  constructor(private prisma: PrismaService) {}

  async findByEventType(eventType: string): Promise<NotificationTemplate | null> {
    return this.prisma.notificationTemplate.findUnique({
      where: { eventType },
    });
  }

  async findAll(filter?: { category?: NotificationCategory; isActive?: boolean }) {
    return this.prisma.notificationTemplate.findMany({
      where: {
        deletedAt: null,
        ...(filter?.category ? { category: filter.category } : {}),
        ...(filter?.isActive !== undefined ? { isActive: filter.isActive } : {}),
      },
      orderBy: [{ category: 'asc' }, { eventType: 'asc' }],
    });
  }

  async create(dto: CreateNotificationTemplateDto, lastEditedBy?: string) {
    const existing = await this.prisma.notificationTemplate.findUnique({
      where: { eventType: dto.eventType },
    });
    if (existing) {
      throw new NotFoundException(`Template with eventType ${dto.eventType} already exists`);
    }
    return this.prisma.notificationTemplate.create({
      data: {
        eventType: dto.eventType,
        name: dto.name,
        category: dto.category,
        channelKey: dto.channelKey ?? null,
        channel: dto.channel,
        format: dto.format ?? 'text',
        subject: dto.subject ?? null,
        messageTemplate: dto.messageTemplate,
        flexTemplate: dto.flexTemplate ?? null,
        description: dto.description ?? null,
        isActive: dto.isActive ?? true,
        sampleData: dto.sampleData ? (dto.sampleData as Prisma.JsonObject) : Prisma.JsonNull,
        lastEditedBy: lastEditedBy ?? null,
      },
    });
  }

  async update(eventType: string, dto: UpdateNotificationTemplateDto, lastEditedBy?: string) {
    const tpl = await this.findByEventType(eventType);
    if (!tpl) throw new NotFoundException(`Template ${eventType} not found`);
    return this.prisma.notificationTemplate.update({
      where: { eventType },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.channelKey !== undefined ? { channelKey: dto.channelKey } : {}),
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
        ...(dto.format !== undefined ? { format: dto.format } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
        ...(dto.messageTemplate !== undefined ? { messageTemplate: dto.messageTemplate } : {}),
        ...(dto.flexTemplate !== undefined ? { flexTemplate: dto.flexTemplate } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sampleData !== undefined
          ? { sampleData: dto.sampleData as Prisma.JsonObject }
          : {}),
        lastEditedBy: lastEditedBy ?? tpl.lastEditedBy,
      },
    });
  }

  async softDelete(eventType: string, lastEditedBy?: string) {
    const tpl = await this.findByEventType(eventType);
    if (!tpl) throw new NotFoundException(`Template ${eventType} not found`);
    return this.prisma.notificationTemplate.update({
      where: { eventType },
      data: {
        deletedAt: new Date(),
        isActive: false,
        lastEditedBy: lastEditedBy ?? tpl.lastEditedBy,
      },
    });
  }

  /**
   * Renders template with data → returns rendered text + optional flex JSON.
   * Uses sampleData if no overrideData provided.
   */
  async renderPreview(eventType: string, overrideData?: Record<string, string>) {
    const tpl = await this.findByEventType(eventType);
    if (!tpl) throw new NotFoundException(`Template ${eventType} not found`);

    const data = overrideData ?? (tpl.sampleData as Record<string, string> | null) ?? {};
    const rendered = this.replacePlaceholders(tpl.messageTemplate, data);

    let flexJson: object | null = null;
    if (tpl.format === 'flex' && tpl.flexTemplate) {
      try {
        const parsed = JSON.parse(tpl.flexTemplate);
        flexJson = this.replacePlaceholdersInJson(parsed, data);
      } catch (err) {
        this.logger.warn(`Flex template parse error for ${eventType}: ${err}`);
      }
    }

    return { rendered, flexJson };
  }

  /** Extracts ${var} placeholders, deduplicated and ordered. */
  extractVariables(template: string): string[] {
    const regex = /\$\{([^}]+)\}/g;
    const seen = new Set<string>();
    const order: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(template)) !== null) {
      const varName = match[1].trim();
      if (!seen.has(varName)) {
        seen.add(varName);
        order.push(varName);
      }
    }
    return order;
  }

  private replacePlaceholders(tmpl: string, data: Record<string, string>): string {
    return tmpl.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
      const trimmed = (varName as string).trim();
      return data[trimmed] ?? `\${${trimmed}}`;
    });
  }

  private replacePlaceholdersInJson(obj: any, data: Record<string, string>): any {
    if (typeof obj === 'string') return this.replacePlaceholders(obj, data);
    if (Array.isArray(obj)) return obj.map((item) => this.replacePlaceholdersInJson(item, data));
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.replacePlaceholdersInJson(v, data);
      }
      return result;
    }
    return obj;
  }
}
