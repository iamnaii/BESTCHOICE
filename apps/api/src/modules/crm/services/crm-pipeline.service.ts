import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeadStage, LeadSource, Prisma } from '@prisma/client';

@Injectable()
export class CrmPipelineService {
  private readonly logger = new Logger(CrmPipelineService.name);

  constructor(private prisma: PrismaService) {}

  async createLead(data: {
    customerId?: string;
    source: LeadSource;
    channel?: string;
    assignedToId?: string;
    branchId?: string;
    interestedProduct?: string;
    estimatedValue?: number;
  }) {
    return this.prisma.crmLead.create({
      data: {
        customerId: data.customerId,
        source: data.source,
        channel: data.channel,
        assignedToId: data.assignedToId,
        branchId: data.branchId,
        interestedProduct: data.interestedProduct,
        estimatedValue: data.estimatedValue
          ? new Prisma.Decimal(data.estimatedValue)
          : undefined,
        stage: LeadStage.NEW_LEAD,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
  }

  async listLeads(params: {
    stage?: LeadStage;
    assignedToId?: string;
    branchId?: string;
    source?: LeadSource;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const where: Prisma.CrmLeadWhereInput = { deletedAt: null };

    if (params.stage) where.stage = params.stage;
    if (params.assignedToId) where.assignedToId = params.assignedToId;
    if (params.branchId) where.branchId = params.branchId;
    if (params.source) where.source = params.source;
    if (params.search) {
      where.customer = { name: { contains: params.search, mode: 'insensitive' } };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.crmLead.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          assignedTo: { select: { id: true, name: true, avatarUrl: true } },
          branch: { select: { id: true, name: true } },
          _count: { select: { notes: true } },
        },
      }),
      this.prisma.crmLead.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findById(id: string) {
    const lead = await this.prisma.crmLead.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        assignedTo: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { staff: { select: { id: true, name: true } } },
        },
        contract: { select: { id: true, contractNumber: true, status: true } },
      },
    });
    if (!lead) throw new NotFoundException('ไม่พบ Lead');
    return lead;
  }

  async moveStage(id: string, stage: LeadStage, lostReason?: string) {
    const data: Prisma.CrmLeadUpdateInput = { stage };
    if (stage === LeadStage.WON) data.wonAt = new Date();
    if (stage === LeadStage.LOST) {
      data.lostAt = new Date();
      data.lostReason = lostReason;
    }
    return this.prisma.crmLead.update({ where: { id }, data });
  }

  /**
   * Reassign a lead. Writes an immutable history row alongside the update
   * so any later "who took my lead?" question has a definitive answer.
   * `changedById` is the user making the change (often a manager reassigning
   * a junior's lead); `toUserId` is the new owner.
   */
  async assignLead(
    id: string,
    staffId: string,
    changedById: string,
    reason?: string,
  ) {
    const existing = await this.prisma.crmLead.findUnique({
      where: { id },
      select: { id: true, assignedToId: true },
    });
    if (!existing) {
      throw new Error(`CRM lead ${id} not found`);
    }
    if (existing.assignedToId === staffId) {
      // No-op — don't pad the history log with repeats of the same owner
      return this.prisma.crmLead.findUnique({ where: { id } });
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.crmLead.update({
        where: { id },
        data: { assignedToId: staffId },
      }),
      this.prisma.crmLeadAssignment.create({
        data: {
          leadId: id,
          fromUserId: existing.assignedToId,
          toUserId: staffId,
          changedById,
          reason: reason?.trim() || null,
        },
      }),
    ]);
    return updated;
  }

  async getAssignmentHistory(leadId: string) {
    return this.prisma.crmLeadAssignment.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      include: {
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } },
        changedBy: { select: { id: true, name: true } },
      },
    });
  }

  async addNote(leadId: string, staffId: string, content: string) {
    return this.prisma.crmNote.create({
      data: { leadId, staffId, content },
      include: { staff: { select: { id: true, name: true } } },
    });
  }

  /** Dashboard summary: count per stage + conversion rate */
  async getDashboard(branchId?: string) {
    const where: Prisma.CrmLeadWhereInput = { deletedAt: null };
    if (branchId) where.branchId = branchId;

    const stages = await this.prisma.crmLead.groupBy({
      by: ['stage'],
      where,
      _count: { id: true },
    });

    const stageMap: Record<string, number> = {};
    for (const s of stages) {
      stageMap[s.stage] = s._count.id;
    }

    const total = Object.values(stageMap).reduce((a, b) => a + b, 0);
    const won = stageMap[LeadStage.WON] ?? 0;
    const conversionRate = total > 0 ? Math.round((won / total) * 100) : 0;

    return { stages: stageMap, total, conversionRate };
  }
}
