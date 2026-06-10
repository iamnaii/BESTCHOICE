import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ListRepairTicketsDto } from '../dto/list-repair-tickets.dto';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';

type ReqUser = { id: string; role: string; branchId?: string | null };

/**
 * Query (read-only, branch-scoped) half of RepairTicketsService.
 * Constructed internally by the RepairTicketsService facade.
 */
@Injectable()
export class RepairTicketQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Paginated list with filtering + branch scoping. */
  async findAll(dto: ListRepairTicketsDto, user: ReqUser) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.RepairTicketWhereInput = { deletedAt: null };
    if (dto.status) where.status = dto.status;
    if (dto.customerId) where.customerId = dto.customerId;
    if (dto.repairSupplierId) where.repairSupplierId = dto.repairSupplierId;
    if (dto.from || dto.to) {
      where.createdAt = {};
      if (dto.from) where.createdAt.gte = new Date(dto.from);
      if (dto.to) where.createdAt.lte = new Date(dto.to);
    }

    // Branch scope — OWNER/ACCOUNTANT/FINANCE_MANAGER are cross-branch
    if (!hasCrossBranchAccess(user)) {
      if (user.branchId) {
        where.branchId = user.branchId;
      }
      // no branchId on user → scope to guaranteed-empty set
      else {
        return { data: [], total: 0, page, limit };
      }
    } else if (dto.branchId) {
      where.branchId = dto.branchId;
    }

    // Search across ticketNumber / customer.name / deviceImei
    if (dto.q) {
      where.OR = [
        { ticketNumber: { contains: dto.q, mode: 'insensitive' } },
        { customer: { name: { contains: dto.q, mode: 'insensitive' } } },
        { deviceImei: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.repairTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          repairSupplier: { select: { id: true, name: true } },
        },
      }),
      this.prisma.repairTicket.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /** Full detail with relations + timeline. Branch-scoped defense. */
  async findOne(id: string, user: ReqUser) {
    const ticket = await this.prisma.repairTicket.findUnique({
      where: { id, deletedAt: null },
      include: {
        customer: true,
        contract: { include: { product: true } },
        product: true,
        repairSupplier: true,
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        expenseDocument: { select: { id: true, number: true, status: true, totalAmount: true } },
        otherIncome: { select: { id: true, docNumber: true, status: true, totalAmount: true } },
        replacementContract: { select: { id: true, contractNumber: true } },
        statusLogs: {
          include: { changedBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!ticket) throw new NotFoundException('ไม่พบ ticket');

    if (!hasCrossBranchAccess(user) && user.branchId && ticket.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้');
    }
    return ticket;
  }
}
