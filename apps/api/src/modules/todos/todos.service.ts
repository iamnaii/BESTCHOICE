import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma, TodoStatus, TodoPriority } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { CreateTodoDto, UpdateTodoDto } from './dto/todo.dto';

export type TodoView = 'all' | 'today' | 'upcoming' | 'priority' | 'completed';

interface FindAllParams {
  view?: TodoView;
  search?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  assigneeId?: string; // 'me' | uuid
  branchId?: string;
  page?: number;
  limit?: number;
  currentUserId: string;
}

const assigneeSelect = {
  id: true,
  name: true,
  nickname: true,
  avatarUrl: true,
};

@Injectable()
export class TodosService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: FindAllParams) {
    const {
      view = 'all',
      search,
      status,
      priority,
      assigneeId,
      branchId,
      page = 1,
      limit = 50,
      currentUserId,
    } = params;

    const where: Prisma.TodoWhereInput = { deletedAt: null };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (branchId) where.branchId = branchId;
    if (assigneeId) {
      where.assigneeId = assigneeId === 'me' ? currentUserId : assigneeId;
    }

    // View-specific filters
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    switch (view) {
      case 'today':
        where.status = { not: 'DONE' };
        where.dueDate = { gte: startOfToday, lt: endOfToday };
        break;
      case 'upcoming':
        where.status = { not: 'DONE' };
        where.dueDate = { gte: endOfToday };
        break;
      case 'priority':
        where.status = { not: 'DONE' };
        where.priority = 'HIGH';
        break;
      case 'completed':
        where.status = 'DONE';
        break;
      case 'all':
      default:
        break;
    }

    const [data, total] = await Promise.all([
      this.prisma.todo.findMany({
        where,
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          assignee: { select: assigneeSelect },
          createdBy: { select: assigneeSelect },
        },
      }),
      this.prisma.todo.count({ where }),
    ]);

    // Summary counts (ignoring view filter, but respecting search/branch)
    const baseWhere: Prisma.TodoWhereInput = { deletedAt: null };
    if (branchId) baseWhere.branchId = branchId;

    const [allCount, todayCount, upcomingCount, priorityCount, completedCount] = await Promise.all([
      this.prisma.todo.count({ where: { ...baseWhere, status: { not: 'DONE' } } }),
      this.prisma.todo.count({
        where: {
          ...baseWhere,
          status: { not: 'DONE' },
          dueDate: { gte: startOfToday, lt: endOfToday },
        },
      }),
      this.prisma.todo.count({
        where: { ...baseWhere, status: { not: 'DONE' }, dueDate: { gte: endOfToday } },
      }),
      this.prisma.todo.count({
        where: { ...baseWhere, status: { not: 'DONE' }, priority: 'HIGH' },
      }),
      this.prisma.todo.count({ where: { ...baseWhere, status: 'DONE' } }),
    ]);

    return {
      ...paginatedResponse(data, total, page, limit),
      summary: {
        all: allCount,
        today: todayCount,
        upcoming: upcomingCount,
        priority: priorityCount,
        completed: completedCount,
      },
    };
  }

  async findOne(id: string) {
    const todo = await this.prisma.todo.findUnique({
      where: { id },
      include: {
        assignee: { select: assigneeSelect },
        createdBy: { select: assigneeSelect },
      },
    });
    if (!todo || todo.deletedAt) throw new NotFoundException('ไม่พบรายการงาน');
    return todo;
  }

  async create(dto: CreateTodoDto, currentUserId: string) {
    return this.prisma.todo.create({
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status ?? 'TODO',
        priority: dto.priority ?? 'MEDIUM',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        assigneeId: dto.assigneeId,
        branchId: dto.branchId,
        tags: dto.tags ?? [],
        checklist: (dto.checklist as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        attachments: (dto.attachments as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        createdById: currentUserId,
      },
      include: {
        assignee: { select: assigneeSelect },
        createdBy: { select: assigneeSelect },
      },
    });
  }

  async update(id: string, dto: UpdateTodoDto) {
    await this.findOne(id);

    const data: Prisma.TodoUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (dto.assigneeId !== undefined) {
      data.assignee = dto.assigneeId
        ? { connect: { id: dto.assigneeId } }
        : { disconnect: true };
    }
    if (dto.tags !== undefined) data.tags = { set: dto.tags };
    if (dto.checklist !== undefined) {
      data.checklist = (dto.checklist as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    }
    if (dto.attachments !== undefined) {
      data.attachments = (dto.attachments as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.completedAt = dto.status === 'DONE' ? new Date() : null;
    }

    return this.prisma.todo.update({
      where: { id },
      data,
      include: {
        assignee: { select: assigneeSelect },
        createdBy: { select: assigneeSelect },
      },
    });
  }

  async toggleDone(id: string) {
    const todo = await this.findOne(id);
    const next = todo.status === 'DONE' ? 'TODO' : 'DONE';
    return this.prisma.todo.update({
      where: { id },
      data: {
        status: next,
        completedAt: next === 'DONE' ? new Date() : null,
      },
      include: {
        assignee: { select: assigneeSelect },
        createdBy: { select: assigneeSelect },
      },
    });
  }

  async remove(id: string, currentUserId: string, role: string) {
    const todo = await this.findOne(id);
    // Owner/Manager can delete any; others only own
    const canDelete =
      role === 'OWNER' ||
      role === 'BRANCH_MANAGER' ||
      todo.createdById === currentUserId;
    if (!canDelete) throw new ForbiddenException('ไม่มีสิทธิ์ลบรายการนี้');
    return this.prisma.todo.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
