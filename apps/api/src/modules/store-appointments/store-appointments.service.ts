import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StoreAppointmentStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppointmentActor,
  AppointmentDb,
  AppointmentRow,
  appointmentInclude,
  appointmentView,
  branchAccess,
  customerAccess,
  liveLink,
  roomAccess,
  staffAccess,
  staffIsAvailable,
} from './appointment-access';
import {
  assertBookableStart,
  assertTransition,
  availableSlots,
  bangkokDay,
  DAY_MS,
  dayBounds,
  finalAppointmentStart,
  OPEN_STATUSES,
  SLOT_MS,
} from './appointment-policy';
import { lockBranchStaff, lockCustomer, requestMutation } from './appointment-transactions';

export interface CreateAppointmentInput {
  customerId: string;
  branchId: string;
  startsAt: string;
  sourceRoomId?: string;
  requestId: string;
}
export interface RescheduleInput {
  branchId: string;
  startsAt: string;
  version: number;
  requestId: string;
}
export interface ReassignInput {
  staffUserId: string;
  version: number;
  requestId: string;
  reason?: string;
}
export interface TransitionInput {
  status: string;
  version: number;
  requestId: string;
  reason?: string;
}
const snapshot = (row: AppointmentRow) => ({
  id: row.id,
  branchId: row.branchId,
  staffUserId: row.staffUserId,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  status: row.status,
  version: row.version,
  reason: row.reason,
});

@Injectable()
export class StoreAppointmentsService {
  constructor(private readonly db: PrismaService) {}

  async credit(db: AppointmentDb, customerId: string) {
    const check = await db.creditCheck.findFirst({
      where: { customerId, deletedAt: null, lastAppointmentDecision: { not: 'NONE' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      eligible: check?.lastAppointmentDecision === 'APPROVED',
      reason:
        check?.lastAppointmentDecision === 'REJECTED'
          ? 'ผลเครดิตล่าสุดไม่ผ่าน กรุณาติดต่อสาขา'
          : check?.lastAppointmentDecision === 'APPROVED'
            ? null
            : 'กรุณาตรวจสอบผลเครดิตก่อนนัด',
      check,
    };
  }
  async eligibility(customerId: string, actor: AppointmentActor) {
    await customerAccess(this.db, actor, customerId);
    const { eligible, reason } = await this.credit(this.db, customerId);
    return { eligible, reason };
  }
  async availability(branchId: string, day: string, actor: AppointmentActor, excludeId?: string) {
    await branchAccess(this.db, actor, branchId);
    const [from, to] = dayBounds(day);
    if ('linkId' in actor) {
      const link = await liveLink(this.db, actor.linkId);
      if (excludeId) await this.read(this.db, excludeId, actor);
      else if (link.bookingExpiresAt <= new Date())
        throw new GoneException('สิทธิ์สร้างนัดหมดอายุแล้ว');
      const result = await this.credit(this.db, link.customerId);
      if (!result.eligible) throw new BadRequestException(result.reason!);
    } else if (excludeId) await this.read(this.db, excludeId, actor);
    const windows = await this.db.staffAppointmentWindow.findMany({
      where: { branchId, deletedAt: null, startsAt: { gte: from, lt: to } },
      include: { staff: true },
    });
    const busy = await this.db.storeAppointment.findMany({
      where: {
        branchId,
        deletedAt: null,
        status: { in: [...OPEN_STATUSES] },
        id: { not: excludeId },
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
    });
    return availableSlots(
      windows.filter((w) => staffIsAvailable(w.staff, branchId)),
      busy,
      day,
    );
  }
  async read(db: AppointmentDb, id: string, actor: AppointmentActor) {
    const row = await db.storeAppointment.findFirst({
      where: { id, deletedAt: null },
      include: appointmentInclude,
    });
    if (!row) throw new NotFoundException('ไม่พบนัดหมาย');
    await branchAccess(db, actor, row.branchId, true);
    await customerAccess(db, actor, row.customerId);
    if ('linkId' in actor) {
      const access = await db.appointmentLinkAccess.findFirst({
        where: {
          linkId: actor.linkId,
          appointmentId: id,
          deletedAt: null,
          manageExpiresAt: { gt: new Date() },
        },
      });
      if (!access) throw new GoneException('ไม่พบลิงก์ หรือลิงก์นี้ใช้งานไม่ได้แล้ว');
    }
    return row;
  }
  async findOne(id: string, actor: AppointmentActor) {
    const row = await this.read(this.db, id, actor);
    const credit = await this.credit(this.db, row.customerId);
    return { ...appointmentView(row), creditEligible: credit.eligible };
  }
  async list(
    query: {
      day?: string;
      branchId?: string;
      customerId?: string;
      roomId?: string;
      open?: boolean;
    },
    actor: AppointmentActor,
  ) {
    const user = await staffAccess(this.db, actor);
    if (query.branchId) await branchAccess(this.db, actor, query.branchId, true);
    if (query.roomId) {
      if (!query.customerId) throw new BadRequestException('กรุณาระบุลูกค้าของห้อง');
      await roomAccess(this.db, actor, query.roomId, query.customerId);
    }
    if (query.customerId) await customerAccess(this.db, actor, query.customerId);
    const bounds = query.day ? dayBounds(query.day) : undefined;
    const where: Prisma.StoreAppointmentWhereInput = {
      deletedAt: null,
      branch: { company: { companyCode: 'SHOP', deletedAt: null }, deletedAt: null },
      ...(user.role === 'OWNER'
        ? query.branchId
          ? { branchId: query.branchId }
          : {}
        : { branchId: user.branchId! }),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.open ? { status: { in: [...OPEN_STATUSES] } } : {}),
      ...(bounds ? { startsAt: { gte: bounds[0], lt: bounds[1] } } : {}),
    };
    const rows = await this.db.storeAppointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: { startsAt: 'asc' },
      take: 200,
    });
    const decisions = await this.db.creditCheck.findMany({
      where: {
        customerId: { in: rows.map((r) => r.customerId) },
        deletedAt: null,
        lastAppointmentDecision: { not: 'NONE' },
      },
      select: { customerId: true, lastAppointmentDecision: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const credits = new Map<string, boolean>();
    for (const d of decisions)
      if (!credits.has(d.customerId))
        credits.set(d.customerId, d.lastAppointmentDecision === 'APPROVED');
    return rows.map((row) => ({
      ...appointmentView(row),
      creditEligible: credits.get(row.customerId) ?? false,
    }));
  }
  async roomSummaries(roomIds: string[], actor: AppointmentActor) {
    const user = await staffAccess(this.db, actor);
    if (roomIds.length > 500 || roomIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id)))
      throw new BadRequestException('รายการห้องไม่ถูกต้อง');
    const rooms = await this.db.chatRoom.findMany({
      where: {
        id: { in: roomIds },
        deletedAt: null,
        channel: { not: 'LINE_FINANCE' },
        ...(user.role === 'SALES'
          ? { OR: [{ assignedToId: null }, { assignedToId: user.id }] }
          : {}),
      },
      select: { id: true, customerId: true },
    });
    const rows = await this.db.storeAppointment.findMany({
      where: {
        customerId: { in: rooms.flatMap((r) => (r.customerId ? [r.customerId] : [])) },
        deletedAt: null,
        status: { in: [...OPEN_STATUSES] },
        ...(user.role !== 'OWNER' ? { branchId: user.branchId! } : {}),
        branch: { deletedAt: null, company: { companyCode: 'SHOP' } },
      },
      select: {
        id: true,
        customerId: true,
        startsAt: true,
        status: true,
        version: true,
        branch: { select: { name: true } },
      },
    });
    return Object.fromEntries(
      rooms.map((room) => {
        const a = rows.find((row) => row.customerId === room.customerId);
        return [
          room.id,
          a
            ? {
                id: a.id,
                kind: 'STORE_APPOINTMENT',
                title: `นัดเข้าร้าน · ${a.branch.name}`,
                dueDate: a.startsAt,
                status: a.status,
                version: a.version,
              }
            : null,
        ];
      }),
    );
  }
  async due(actor: AppointmentActor, now = new Date()) {
    const user = await staffAccess(this.db, actor);
    const rows = await this.db.storeAppointment.findMany({
      where: {
        deletedAt: null,
        status: 'BOOKED',
        startsAt: { gte: new Date(+now - DAY_MS), lte: new Date(+now + 15 * 60000) },
        ...(user.role !== 'OWNER' ? { branchId: user.branchId! } : {}),
        branch: { deletedAt: null, company: { companyCode: 'SHOP' } },
      },
      include: {
        customer: {
          select: {
            name: true,
            chatRooms: {
              where: {
                deletedAt: null,
                channel: { not: 'LINE_FINANCE' },
                ...(user.role === 'SALES'
                  ? { OR: [{ assignedToId: null }, { assignedToId: user.id }] }
                  : {}),
              },
              select: { id: true },
              take: 1,
            },
          },
        },
        branch: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 50,
    });
    return rows.map((a) => ({
      id: a.id,
      kind: 'STORE_APPOINTMENT',
      title: `นัดเข้าร้าน · ${a.branch.name}`,
      dueDate: a.startsAt,
      status: a.status,
      version: a.version,
      roomId: a.customer.chatRooms[0]?.id ?? null,
      room: { customer: { name: a.customer.name } },
    }));
  }
  private async chooseStaff(
    db: AppointmentDb,
    branchId: string,
    startsAt: Date,
    excludeId?: string,
    staffUserId?: string,
    requireGrid = true,
    transferringService = false,
  ) {
    const endsAt = new Date(+startsAt + SLOT_MS);
    const candidates = await db.staffAppointmentWindow.findMany({
      where: {
        branchId,
        deletedAt: null,
        startsAt: { lte: startsAt },
        endsAt: { gte: endsAt },
        ...(staffUserId ? { staffUserId } : {}),
      },
      include: { staff: true },
    });
    const [from, to] = dayBounds(bangkokDay(startsAt));
    const busy = await db.storeAppointment.findMany({
      where: {
        staffUserId: { in: candidates.map((w) => w.staffUserId) },
        deletedAt: null,
        status: { in: [...OPEN_STATUSES] },
        id: { not: excludeId },
        OR: [{ startsAt: { lt: to }, endsAt: { gt: from } }, { status: 'IN_SERVICE' }],
      },
      select: { staffUserId: true, startsAt: true, endsAt: true, status: true },
    });
    const valid = candidates.filter(
      (w) =>
        staffIsAvailable(w.staff, branchId) &&
        (!requireGrid ||
          (+startsAt - +w.startsAt) % SLOT_MS === 0 ||
          +startsAt === finalAppointmentStart(bangkokDay(startsAt))) &&
        !busy.some(
          (b) =>
            b.staffUserId === w.staffUserId &&
            ((b.startsAt < endsAt && b.endsAt > startsAt) ||
              (transferringService && b.status === 'IN_SERVICE')),
        ),
    );
    valid.sort(
      (a, b) =>
        busy.filter((x) => x.staffUserId === a.staffUserId).length -
          busy.filter((x) => x.staffUserId === b.staffUserId).length ||
        a.staffUserId.localeCompare(b.staffUserId),
    );
    if (!valid.length) throw new ConflictException('ช่วงเวลานี้เต็มแล้ว กรุณาเลือกเวลาใหม่');
    return valid[0];
  }
  private async event(
    db: AppointmentDb,
    kind: string,
    actor: AppointmentActor,
    row: AppointmentRow,
    old?: AppointmentRow,
  ) {
    await db.storeAppointmentEvent.create({
      data: {
        appointmentId: row.id,
        kind,
        actorId: 'staffId' in actor ? actor.staffId : actor.linkId,
        actorType: 'staffId' in actor ? 'STAFF' : 'CUSTOMER_LINK',
        ...(old ? { before: snapshot(old) } : {}),
        after: snapshot(row),
      },
    });
  }
  private assertVersion(row: AppointmentRow, version: number) {
    if (row.version !== version) throw new ConflictException('นัดเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่');
  }
  private async lockExisting(
    db: AppointmentDb,
    id: string,
    actor: AppointmentActor,
    credit = false,
  ) {
    const initial = await this.read(db, id, actor);
    await lockCustomer(db, initial.customerId, credit);
    await db.$queryRaw`SELECT id FROM store_appointments WHERE id=${id} FOR UPDATE`;
    return this.read(db, id, actor);
  }
  private async attachAccess(db: AppointmentDb, row: AppointmentRow, actor: AppointmentActor) {
    if ('linkId' in actor)
      await db.appointmentLinkAccess.upsert({
        where: { linkId_appointmentId: { linkId: actor.linkId, appointmentId: row.id } },
        create: {
          linkId: actor.linkId,
          appointmentId: row.id,
          manageExpiresAt: new Date(+row.endsAt + DAY_MS),
        },
        update: { manageExpiresAt: new Date(+row.endsAt + DAY_MS) },
      });
  }
  async create(input: CreateAppointmentInput, actor: AppointmentActor) {
    return requestMutation(
      this.db,
      actor,
      input.requestId,
      { action: 'create', ...input },
      async (tx) => {
        await branchAccess(tx, actor, input.branchId);
        await customerAccess(tx, actor, input.customerId);
        if (input.sourceRoomId) await roomAccess(tx, actor, input.sourceRoomId, input.customerId);
        await lockCustomer(tx, input.customerId, true);
        if ('linkId' in actor) {
          await tx.$queryRaw`SELECT id FROM store_appointment_links WHERE id=${actor.linkId} FOR UPDATE`;
          if ((await liveLink(tx, actor.linkId)).bookingExpiresAt <= new Date())
            throw new GoneException('สิทธิ์สร้างนัดหมดอายุแล้ว');
        }
        const credit = await this.credit(tx, input.customerId);
        if (!credit.eligible || !credit.check) throw new BadRequestException(credit.reason!);
        if (
          await tx.storeAppointment.count({
            where: {
              customerId: input.customerId,
              deletedAt: null,
              status: { in: [...OPEN_STATUSES] },
            },
          })
        )
          throw new ConflictException('มีนัดที่ยังไม่จบอยู่แล้ว กรุณาเปิดนัดเดิม');
        const startsAt = new Date(input.startsAt);
        assertBookableStart(startsAt);
        await lockBranchStaff(tx, [input.branchId]);
        const window = await this.chooseStaff(tx, input.branchId, startsAt);
        const row = await tx.storeAppointment.create({
          data: {
            reference: `AP-${randomUUID().slice(0, 12).toUpperCase()}`,
            customerId: input.customerId,
            branchId: input.branchId,
            staffUserId: window.staffUserId,
            windowId: window.id,
            sourceRoomId: input.sourceRoomId,
            startsAt,
            endsAt: new Date(+startsAt + SLOT_MS),
            creditCheckId: credit.check.id,
            creditCheckTypeAtBooking: credit.check.checkType,
            creditDecisionRecordedAtBooking: credit.check.appointmentDecisionRecordedAt,
            source: 'staffId' in actor ? 'STAFF' : 'CUSTOMER_LINK',
            createdById: 'staffId' in actor ? actor.staffId : undefined,
          },
          include: appointmentInclude,
        });
        await this.attachAccess(tx, row, actor);
        await this.event(tx, 'BOOKED', actor, row);
        return appointmentView(row);
      },
    );
  }
  async reschedule(id: string, input: RescheduleInput, actor: AppointmentActor) {
    return requestMutation(
      this.db,
      actor,
      input.requestId,
      { action: 'reschedule', id, ...input },
      async (tx) => {
        const old = await this.lockExisting(tx, id, actor, true);
        this.assertVersion(old, input.version);
        if (!['BOOKED', 'CHECKED_IN'].includes(old.status))
          throw new BadRequestException('นัดนี้เลื่อนไม่ได้แล้ว');
        if ('linkId' in actor && (old.status !== 'BOOKED' || old.startsAt <= new Date()))
          throw new BadRequestException('กรุณาติดต่อสาขาเพื่อเลื่อนนัด');
        await branchAccess(tx, actor, input.branchId);
        const credit = await this.credit(tx, old.customerId);
        if (!credit.eligible || !credit.check) throw new BadRequestException(credit.reason!);
        const startsAt = new Date(input.startsAt);
        assertBookableStart(startsAt);
        await lockBranchStaff(tx, [old.branchId, input.branchId], [old.staffUserId]);
        const window = await this.chooseStaff(tx, input.branchId, startsAt, id);
        const changedDay = bangkokDay(startsAt) !== bangkokDay(old.startsAt);
        const row = await tx.storeAppointment.update({
          where: { id, version: input.version },
          data: {
            branchId: input.branchId,
            staffUserId: window.staffUserId,
            windowId: window.id,
            startsAt,
            endsAt: new Date(+startsAt + SLOT_MS),
            version: { increment: 1 },
            creditCheckId: credit.check.id,
            creditCheckTypeAtBooking: credit.check.checkType,
            creditDecisionRecordedAtBooking: credit.check.appointmentDecisionRecordedAt,
            ...(changedDay ? { status: 'BOOKED', checkedInAt: null } : {}),
          },
          include: appointmentInclude,
        });
        if (old.branchId !== input.branchId) {
          const bindings = await tx.appointmentLinkAccess.findMany({
            where: {
              appointmentId: id,
              deletedAt: null,
              manageExpiresAt: { gt: new Date() },
              link: { revokedAt: null, deletedAt: null },
            },
            include: { link: true },
          });
          for (const binding of bindings)
            if (!binding.link.allowedBranchIds.includes(input.branchId))
              await tx.storeAppointmentLink.update({
                where: { id: binding.linkId },
                data: { allowedBranchIds: { push: input.branchId } },
              });
        }
        await tx.appointmentLinkAccess.updateMany({
          where: { appointmentId: id, deletedAt: null, link: { revokedAt: null, deletedAt: null } },
          data: { manageExpiresAt: new Date(+row.endsAt + DAY_MS) },
        });
        await this.event(tx, 'RESCHEDULED', actor, row, old);
        return appointmentView(row);
      },
    );
  }
  async reassign(id: string, input: ReassignInput, actor: AppointmentActor) {
    return requestMutation(
      this.db,
      actor,
      input.requestId,
      { action: 'reassign', id, ...input },
      async (tx) => {
        const user = await staffAccess(tx, actor);
        const old = await this.lockExisting(tx, id, actor);
        this.assertVersion(old, input.version);
        if (!OPEN_STATUSES.includes(old.status as (typeof OPEN_STATUSES)[number]))
          throw new BadRequestException('นัดนี้ปิดแล้ว');
        if (
          old.status === 'IN_SERVICE' &&
          (user.role === 'SALES' ||
            staffIsAvailable(old.staff, old.branchId) ||
            !input.reason?.trim())
        )
          throw new BadRequestException('ผู้จัดการต้องระบุเหตุผลรับช่วงงาน');
        await lockBranchStaff(tx, [old.branchId], [old.staffUserId, input.staffUserId]);
        const window = await this.chooseStaff(
          tx,
          old.branchId,
          old.startsAt,
          id,
          input.staffUserId,
          false,
          old.status === 'IN_SERVICE',
        );
        const row = await tx.storeAppointment.update({
          where: { id, version: input.version },
          data: {
            staffUserId: input.staffUserId,
            windowId: window.id,
            version: { increment: 1 },
            reason: input.reason,
          },
          include: appointmentInclude,
        });
        await this.event(tx, 'REASSIGNED', actor, row, old);
        return appointmentView(row);
      },
    );
  }
  async transition(id: string, input: TransitionInput, actor: AppointmentActor) {
    return requestMutation(
      this.db,
      actor,
      input.requestId,
      { action: 'status', id, ...input },
      async (tx) => {
        const old = await this.lockExisting(tx, id, actor);
        this.assertVersion(old, input.version);
        const now = new Date();
        if (
          'linkId' in actor &&
          (input.status !== 'CANCELED' || old.status !== 'BOOKED' || old.startsAt <= now)
        )
          throw new ForbiddenException('กรุณาติดต่อสาขาเพื่อจัดการนัดนี้');
        assertTransition(old.status, input.status, old.startsAt, now);
        if (input.status === 'CANCELED' && old.status === 'IN_SERVICE' && !input.reason?.trim())
          throw new BadRequestException('กรุณาระบุเหตุผลยกเลิก');
        await lockBranchStaff(tx, [old.branchId], [old.staffUserId]);
        if (input.status === 'IN_SERVICE') {
          const staff = await tx.user.findUnique({ where: { id: old.staffUserId } });
          if (!staff || !staffIsAvailable(staff, old.branchId))
            throw new ConflictException('กรุณาจัดพนักงานใหม่ก่อนเริ่มบริการ');
          if (
            await tx.storeAppointment.count({
              where: {
                staffUserId: old.staffUserId,
                status: 'IN_SERVICE',
                deletedAt: null,
                id: { not: id },
              },
            })
          )
            throw new ConflictException('พนักงานกำลังให้บริการอีกนัดอยู่');
        }
        const dates: Prisma.StoreAppointmentUpdateInput = {
          ...(input.status === 'CHECKED_IN' ? { checkedInAt: now } : {}),
          ...(input.status === 'IN_SERVICE' ? { serviceStartedAt: now } : {}),
          ...(input.status === 'COMPLETED' ? { completedAt: now } : {}),
          ...(input.status === 'CANCELED' ? { canceledAt: now } : {}),
          ...(input.status === 'NO_SHOW' ? { noShowAt: now } : {}),
        };
        const row = await tx.storeAppointment.update({
          where: { id, version: input.version },
          data: {
            ...dates,
            status: input.status as StoreAppointmentStatus,
            reason: input.reason,
            version: { increment: 1 },
          },
          include: appointmentInclude,
        });
        await this.event(tx, input.status, actor, row, old);
        return appointmentView(row);
      },
    );
  }
}
