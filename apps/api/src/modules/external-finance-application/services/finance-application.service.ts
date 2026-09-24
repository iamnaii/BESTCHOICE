import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExternalFinanceActorType, ExternalFinanceEventKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashLockKey } from '../../../utils/advisory-lock.util';
import { FinanceApplicationNumberService } from './finance-application-number.service';
import { FinanceActor, GFIN_COMPANY_NAME } from '../constants';
import { isClosed } from '../finance-application-status.util';
import { UpdateFinanceApplicationDto } from '../dto/finance-application.dto';

const OPEN_STATUSES = ['DRAFT', 'SENT', 'ACKNOWLEDGED', 'MORE_INFO'] as const;
const EDITABLE_STATUSES = ['DRAFT', 'MORE_INFO'] as const;

export const applicationInclude = {
  files: { where: { deletedAt: null }, orderBy: [{ slot: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
  events: { orderBy: { createdAt: 'asc' } },
  customer: { select: { id: true, name: true, phone: true, occupation: true, birthDate: true } },
  product: { select: { id: true, name: true, brand: true, model: true, storage: true, imeiSerial: true, serialNumber: true, category: true, batteryHealth: true, hasBox: true, accessoriesIncluded: true, status: true } },
  sentBy: { select: { id: true, name: true } },
} satisfies Prisma.ExternalFinanceApplicationInclude;

@Injectable()
export class FinanceApplicationService {
  constructor(
    private prisma: PrismaService,
    private numbers: FinanceApplicationNumberService,
  ) {}

  /** กติกาเดียวกับตรวจเครดิต (room-credit.service.ts:92-98): SALES เข้าได้เฉพาะห้องว่างหรือห้องตัวเอง */
  async access(db: Prisma.TransactionClient | PrismaService, roomId: string, actor: FinanceActor) {
    const room = await db.chatRoom.findFirst({ where: { id: roomId, deletedAt: null } });
    if (!room) throw new NotFoundException('ไม่พบห้องแชท');
    if (actor.role === 'SALES' && room.assignedToId && room.assignedToId !== actor.id)
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
    return room;
  }

  async addEvent(
    db: Prisma.TransactionClient | PrismaService,
    applicationId: string,
    kind: ExternalFinanceEventKind,
    actorType: ExternalFinanceActorType,
    fields: { actorUserId?: string | null; actorName?: string | null; note?: string | null; meta?: Prisma.InputJsonValue } = {},
  ) {
    return db.externalFinanceApplicationEvent.create({ data: { applicationId, kind, actorType, ...fields } });
  }

  private async gfinCompanyId(db: Prisma.TransactionClient | PrismaService) {
    // แถวถูก seed ด้วย migration แล้ว — upsert เผื่อฐานที่ยังไม่รัน migration (แบบ sale-writer.service.ts:85-94)
    const company = await db.externalFinanceCompany.upsert({
      where: { name: GFIN_COMPANY_NAME }, create: { name: GFIN_COMPANY_NAME, isActive: true }, update: {},
    });
    return company.id;
  }

  async createDraft(roomId: string, actor: FinanceActor) {
    const room = await this.access(this.prisma, roomId, actor);
    return this.prisma.$transaction(async (tx) => {
      // ล็อกระดับห้องก่อนเช็คใบเปิด — กัน createDraft พร้อมกันสองคำขอสร้างซ้ำ (finding รอบ 1)
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${hashLockKey(`finance-app-room:${roomId}`)})`);
      const open = await tx.externalFinanceApplication.findFirst({
        where: { roomId, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
        include: applicationInclude,
      });
      if (open) return open;
      const number = await this.numbers.next(tx);
      const app = await tx.externalFinanceApplication.create({
        data: {
          number, roomId, status: 'DRAFT', createdById: actor.id, branchId: actor.branchId ?? null,
          customerId: room.customerId ?? null, financeCompanyId: await this.gfinCompanyId(tx),
        },
        include: applicationInclude,
      });
      await this.addEvent(tx, app.id, 'CREATED', 'STAFF', { actorUserId: actor.id });
      return app;
    });
  }

  /** ใบเปิดของห้อง + ประวัติ: ห้องผูกลูกค้า → ทุกใบของลูกค้า (ทุกห้อง) ไม่งั้นเฉพาะห้องนี้ (spec §5.1) */
  async listForRoom(roomId: string, actor: FinanceActor) {
    const room = await this.access(this.prisma, roomId, actor);
    const where: Prisma.ExternalFinanceApplicationWhereInput = room.customerId
      ? { deletedAt: null, OR: [{ roomId }, { customerId: room.customerId }] }
      : { deletedAt: null, roomId };
    const rows = await this.prisma.externalFinanceApplication.findMany({
      where, include: applicationInclude, orderBy: { createdAt: 'desc' },
    });
    const current = rows.find((r) => r.roomId === roomId && !isClosed(r.status)) ?? null;
    return { current, history: rows.filter((r) => r.id !== current?.id) };
  }

  async get(id: string, actor: FinanceActor) {
    const app = await this.prisma.externalFinanceApplication.findFirst({
      where: { id, deletedAt: null }, include: { ...applicationInclude, room: true },
    });
    if (!app) throw new NotFoundException('ไม่พบใบยื่น');
    await this.access(this.prisma, app.roomId, actor);
    return app;
  }

  async update(id: string, dto: UpdateFinanceApplicationDto, actor: FinanceActor) {
    const app = await this.get(id, actor);
    if (!EDITABLE_STATUSES.includes(app.status as (typeof EDITABLE_STATUSES)[number]))
      throw new ConflictException('แก้ได้เฉพาะใบยื่นที่ยังเป็นร่างหรือ GFIN ขอเอกสารเพิ่ม');
    if (dto.productId) {
      const product = await this.prisma.product.findFirst({ where: { id: dto.productId, deletedAt: null }, select: { id: true, status: true } });
      if (!product) throw new NotFoundException('ไม่พบสินค้า');
      if (!['IN_STOCK', 'RESERVED'].includes(product.status))
        throw new BadRequestException('เลือกได้เฉพาะเครื่องที่พร้อมขายหรือจองอยู่');
    }
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, deletedAt: null }, select: { id: true } });
      if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    }
    return this.prisma.externalFinanceApplication.update({
      where: { id },
      data: {
        ...(dto.productId !== undefined ? { productId: dto.productId } : {}),
        ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
        ...(dto.occupationOverride !== undefined ? { occupationOverride: dto.occupationOverride || null } : {}),
        ...(dto.messageOverride !== undefined ? { messageOverride: dto.messageOverride || null } : {}),
      },
      include: applicationInclude,
    });
  }
}
