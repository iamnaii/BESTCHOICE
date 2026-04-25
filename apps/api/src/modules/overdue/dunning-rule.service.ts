import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDunningRuleDto, UpdateDunningRuleDto } from './dto/dunning-rule.dto';

@Injectable()
export class DunningRuleService {
  constructor(private prisma: PrismaService) {}

  /** Returns all non-deleted rules ordered by sortOrder asc */
  async findAll() {
    return this.prisma.dunningRule.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Returns active, non-deleted rules for a specific triggerDay */
  async findActiveRulesForDay(triggerDay: number) {
    return this.prisma.dunningRule.findMany({
      where: { deletedAt: null, isActive: true, triggerDay },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Returns all active, non-deleted rules ordered by triggerDay asc */
  async findAllActiveRules() {
    return this.prisma.dunningRule.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { triggerDay: 'asc' },
    });
  }

  /** Creates a new dunning rule */
  async create(dto: CreateDunningRuleDto) {
    return this.prisma.dunningRule.create({
      data: {
        name: dto.name,
        triggerDay: dto.triggerDay,
        channel: dto.channel,
        messageTemplate: dto.messageTemplate,
        templateName: dto.templateName ?? null,
        includePaymentLink: dto.includePaymentLink ?? false,
        autoExecute: dto.autoExecute ?? true,
        escalateTo: dto.escalateTo ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  /** Updates a dunning rule. Throws NotFoundException if not found or deleted. */
  async update(id: string, dto: UpdateDunningRuleDto) {
    const rule = await this.prisma.dunningRule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('ไม่พบ Dunning Rule');

    return this.prisma.dunningRule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.triggerDay !== undefined && { triggerDay: dto.triggerDay }),
        ...(dto.channel !== undefined && { channel: dto.channel }),
        ...(dto.messageTemplate !== undefined && { messageTemplate: dto.messageTemplate }),
        ...(dto.templateName !== undefined && { templateName: dto.templateName }),
        ...(dto.includePaymentLink !== undefined && { includePaymentLink: dto.includePaymentLink }),
        ...(dto.autoExecute !== undefined && { autoExecute: dto.autoExecute }),
        ...(dto.escalateTo !== undefined && { escalateTo: dto.escalateTo }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  /** Soft-deletes a dunning rule. Throws NotFoundException if not found or already deleted. */
  async softDelete(id: string) {
    const rule = await this.prisma.dunningRule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('ไม่พบ Dunning Rule');

    return this.prisma.dunningRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
