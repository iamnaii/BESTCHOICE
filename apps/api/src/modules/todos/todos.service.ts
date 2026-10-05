import { ChatFollowUpService } from '../staff-chat/services/chat-follow-up.service';
import { ChatWorkAccessService, WORK_ROLES } from '../staff-chat/services/chat-work-access.service';
import type { WorkScope } from '@installment/shared';
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma, TodoStatus, TodoPriority } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { CreateTodoDto, UpdateTodoDto } from './dto/todo.dto';

export type TodoView = 'all' | 'today' | 'upcoming' | 'priority' | 'completed' | 'cancelled';

interface FindAllParams {
  view?: TodoView;
  search?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  assigneeId?: string; // 'me' | uuid
  branchId?: string;
  /** นัดของห้องแชทห้องเดียว */
  roomId?: string;
  page?: number;
  limit?: number;
  currentUserId: string;
  company?: WorkScope['company'];
}

const assigneeSelect = {
  id: true,
  name: true,
  nickname: true,
  avatarUrl: true,
};

@Injectable()
export class TodosService {
  constructor(private prisma: PrismaService, private followUps: ChatFollowUpService, private access: ChatWorkAccessService) {}
  private async roomVisibility(actorId: string, company: WorkScope['company'] | undefined, roomId?: string): Promise<Prisma.TodoWhereInput> {
    if (roomId) {
      const context = await this.followUps.context(roomId, actorId, company);
      return { room: await this.access.roomWhere(context.actor, context.scope) };
    }
    const actor = await this.access.currentActor({ id: actorId });
    let room: Prisma.ChatRoomWhereInput = { id: { in: [] } };
    if (WORK_ROLES.some(role => role === actor.role)) {
      try { room = await this.access.roomWhere(actor, { company: company ?? 'SHOP' }); }
      catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
    }
    return { AND: [{ OR: [{ roomId: null }, { room }] }] };
  }

  async findAll(params: FindAllParams) {
    const {
      view = 'all',
      search,
      status,
      priority,
      assigneeId,
      branchId,
      roomId,
      page = 1,
      limit = 50,
      currentUserId,
    } = params;

    const visibility = await this.roomVisibility(currentUserId, params.company, roomId);
    const where: Prisma.TodoWhereInput = { deletedAt: null, ...visibility };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (branchId) where.branchId = branchId;
    if (roomId) where.roomId = roomId;
    if (assigneeId) {
      where.assigneeId = assigneeId === 'me' ? currentUserId : assigneeId;
    }

    // View-specific filters
    const now = new Date();
    const date = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const startOfToday = new Date(`${date}T00:00:00+07:00`);
    const endOfToday = new Date(startOfToday.getTime() + 86400_000);

    switch (view) {
      case 'today':
        where.status = { in: ['TODO', 'DOING', 'REVIEW'] };
        where.dueDate = { gte: startOfToday, lt: endOfToday };
        break;
      case 'upcoming':
        where.status = { in: ['TODO', 'DOING', 'REVIEW'] };
        where.dueDate = { gte: endOfToday };
        break;
      case 'priority':
        where.status = { in: ['TODO', 'DOING', 'REVIEW'] };
        where.priority = 'HIGH';
        break;
      case 'completed':
        where.status = 'DONE';
        break;
      case 'cancelled':
        where.status = 'CANCELLED';
        break;
      case 'all':
      default:
        if (!status) where.status = { in: ['TODO', 'DOING', 'REVIEW'] };
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

    // Tab counts share the list scope; only the selected view is ignored.
    const baseWhere: Prisma.TodoWhereInput = { deletedAt: null, ...visibility };
    if (branchId) baseWhere.branchId = branchId;
    if (where.assigneeId) baseWhere.assigneeId = where.assigneeId;
    if (roomId) baseWhere.roomId = roomId;
    if (where.OR) baseWhere.OR = where.OR;

    const [allCount, todayCount, upcomingCount, priorityCount, completedCount, cancelledCount] = await Promise.all([
      this.prisma.todo.count({ where: { ...baseWhere, status: { in: ['TODO', 'DOING', 'REVIEW'] } } }),
      this.prisma.todo.count({
        where: {
          ...baseWhere,
          status: { in: ['TODO', 'DOING', 'REVIEW'] },
          dueDate: { gte: startOfToday, lt: endOfToday },
        },
      }),
      this.prisma.todo.count({
        where: { ...baseWhere, status: { in: ['TODO', 'DOING', 'REVIEW'] }, dueDate: { gte: endOfToday } },
      }),
      this.prisma.todo.count({
        where: { ...baseWhere, status: { in: ['TODO', 'DOING', 'REVIEW'] }, priority: 'HIGH' },
      }),
      this.prisma.todo.count({ where: { ...baseWhere, status: 'DONE' } }),
      this.prisma.todo.count({ where: { ...baseWhere, status: 'CANCELLED' } }),
    ]);

    return {
      ...paginatedResponse(data, total, page, limit),
      summary: {
        all: allCount,
        today: todayCount,
        upcoming: upcomingCount,
        priority: priorityCount,
        completed: completedCount,
        cancelled: cancelledCount,
      },
    };
  }

  async findOne(id: string, actorId?: string, company?: WorkScope['company']) {
    const todo = await this.prisma.todo.findUnique({
      where: { id },
      include: {
        assignee: { select: assigneeSelect },
        createdBy: { select: assigneeSelect },
      },
    });
    if (!todo || todo.deletedAt) throw new NotFoundException('ไม่พบรายการงาน');
    if (todo.roomId) {
      if (!actorId) throw new ForbiddenException('กรุณาระบุผู้ใช้งาน');
      await this.followUps.context(todo.roomId, actorId, company);
    }
    return todo;
  }

  async create(dto: CreateTodoDto, currentUserId: string, company?: WorkScope['company']) {
    if (dto.roomId) return this.followUps.createLegacy(dto, currentUserId, company);
    return this.prisma.todo.create({
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status ?? 'TODO',
        priority: dto.priority ?? 'MEDIUM',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        assigneeId: dto.assigneeId,
        branchId: dto.branchId,
        roomId: dto.roomId,
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

  async update(id: string, dto: UpdateTodoDto, actorId?: string, company?: WorkScope['company']) {
    const todo = await this.findOne(id, actorId, company);
    if (todo.roomId) return this.followUps.updateLegacy(todo, dto, actorId!, company);
    if (dto.roomId) throw new ForbiddenException('กรุณาสร้างงานที่ผูกห้องจากหน้าแชท');

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
    if (dto.roomId !== undefined) {
      data.room = dto.roomId ? { connect: { id: dto.roomId } } : { disconnect: true };
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

  async toggleDone(id: string, actorId?: string, company?: WorkScope['company'], expectedRevision?: number) {
    const todo = await this.findOne(id, actorId, company);
    if (todo.roomId) return this.followUps.updateLegacy(todo, { expectedRevision, status: todo.status === 'DONE' ? 'TODO' : 'DONE' }, actorId!, company);
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

  async getComments(todoId: string, actorId?: string, company?: WorkScope['company']) {
    await this.findOne(todoId, actorId, company); // verify todo exists
    return this.prisma.todoComment.findMany({
      where: { todoId },
      include: {
        user: { select: { id: true, name: true, nickname: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComment(todoId: string, userId: string, content: string, company?: WorkScope['company']) {
    await this.findOne(todoId, userId, company); // verify todo exists
    return this.prisma.todoComment.create({
      data: { todoId, userId, content },
      include: {
        user: { select: { id: true, name: true, nickname: true, avatarUrl: true } },
      },
    });
  }

  async remove(id: string, currentUserId: string, role: string, company?: WorkScope['company'], expectedRevision?: number) {
    const todo = await this.findOne(id, currentUserId, company);
    // Owner/Manager can delete any; others only own
    const canDelete =
      role === 'OWNER' ||
      role === 'BRANCH_MANAGER' ||
      todo.createdById === currentUserId;
    if (!canDelete) throw new ForbiddenException('ไม่มีสิทธิ์ลบรายการนี้');
    if (todo.roomId) return this.followUps.updateLegacy(todo, { expectedRevision, status: 'CANCELLED' }, currentUserId, company);
    return this.prisma.todo.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
