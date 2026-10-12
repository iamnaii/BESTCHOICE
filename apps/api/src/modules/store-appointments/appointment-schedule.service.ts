import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppointmentActor,
  branchAccess,
  staffAccess,
  staffIsAvailable,
} from './appointment-access';
import { bangkokDay, dayBounds, OPEN_STATUSES } from './appointment-policy';
import { lockBranchStaff, transaction } from './appointment-transactions';

export interface SaveWindowInput {
  id?: string;
  version?: number;
  branchId: string;
  staffUserId: string;
  startsAt: string;
  endsAt: string;
}
@Injectable()
export class AppointmentScheduleService {
  constructor(private readonly db: PrismaService) {}
  async options(actor: AppointmentActor) {
    const user = await staffAccess(this.db, actor);
    const branches = await this.db.branch.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        company: { companyCode: 'SHOP', deletedAt: null },
        ...(user.role !== 'OWNER' ? { id: user.branchId! } : {}),
      },
      select: { id: true, name: true, location: true, phone: true },
      orderBy: { name: 'asc' },
    });
    const staff = await this.db.user.findMany({
      where: { deletedAt: null, isActive: true, branchId: { in: branches.map((b) => b.id) } },
      select: {
        id: true,
        name: true,
        branchId: true,
        role: true,
        accessibleCompanies: true,
        isActive: true,
        deletedAt: true,
      },
      orderBy: { name: 'asc' },
    });
    return {
      branches,
      staff: staff
        .filter((s) => staffIsAvailable(s, s.branchId!))
        .map(({ id, name, branchId }) => ({ id, name, branchId })),
      canManage: user.role !== 'SALES',
    };
  }
  async list(branchId: string, day: string, actor: AppointmentActor) {
    await branchAccess(this.db, actor, branchId);
    const [from, to] = dayBounds(day);
    return this.db.staffAppointmentWindow.findMany({
      where: { branchId, deletedAt: null, startsAt: { gte: from, lt: to } },
      include: { staff: { select: { id: true, name: true, isActive: true } } },
      orderBy: { startsAt: 'asc' },
    });
  }
  async save(input: SaveWindowInput, actor: AppointmentActor) {
    const startsAt = new Date(input.startsAt),
      endsAt = new Date(input.endsAt);
    if (
      !Number.isFinite(+startsAt) ||
      !Number.isFinite(+endsAt) ||
      endsAt <= startsAt ||
      bangkokDay(startsAt) !== bangkokDay(new Date(+endsAt - 1))
    )
      throw new BadRequestException('กรุณาระบุช่วงเวลาภายในวันเดียวกัน');
    return transaction(this.db, async (tx) => {
      const user = await staffAccess(tx, actor, true);
      await branchAccess(tx, actor, input.branchId);
      await lockBranchStaff(tx, [input.branchId], [input.staffUserId]);
      const staff = await tx.user.findUnique({ where: { id: input.staffUserId } });
      if (!staff || !staffIsAvailable(staff, input.branchId))
        throw new BadRequestException('พนักงานไม่พร้อมรับนัดในสาขานี้');
      if (input.id) {
        const old = await tx.staffAppointmentWindow.findFirst({
          where: { id: input.id, deletedAt: null },
        });
        if (!old || old.version !== input.version)
          throw new ConflictException('ตารางเปลี่ยนแล้ว กรุณาโหลดใหม่');
        await branchAccess(tx, actor, old.branchId);
        if (old.branchId !== input.branchId || old.staffUserId !== input.staffUserId)
          throw new BadRequestException('กรุณาสร้างช่วงเวลาใหม่เมื่อต้องเปลี่ยนพนักงานหรือสาขา');
        if (
          await tx.storeAppointment.count({
            where: {
              windowId: old.id,
              deletedAt: null,
              status: { in: [...OPEN_STATUSES] },
              OR: [{ startsAt: { lt: startsAt } }, { endsAt: { gt: endsAt } }],
            },
          })
        )
          throw new ConflictException('มีนัดที่ต้องย้ายหรือยกเลิกก่อนแก้ตาราง');
      }
      const overlap = await tx.staffAppointmentWindow.count({
        where: {
          staffUserId: input.staffUserId,
          deletedAt: null,
          id: { not: input.id },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      });
      if (overlap) throw new ConflictException('ช่วงเวลาของพนักงานซ้อนกัน');
      const data = { branchId: input.branchId, staffUserId: input.staffUserId, startsAt, endsAt };
      return input.id
        ? tx.staffAppointmentWindow.update({
            where: { id: input.id, version: input.version },
            data: { ...data, version: { increment: 1 } },
          })
        : tx.staffAppointmentWindow.create({ data: { ...data, createdById: user.id } });
    });
  }
  async copyDay(branchId: string, fromDay: string, toDay: string, actor: AppointmentActor) {
    const [from, until] = dayBounds(fromDay),
      [target] = dayBounds(toDay);
    if (fromDay === toDay) throw new BadRequestException('เลือกวันที่ปลายทางต่างจากวันต้นทาง');
    return transaction(this.db, async (tx) => {
      const user = await staffAccess(tx, actor, true);
      await branchAccess(tx, actor, branchId);
      await lockBranchStaff(tx, [branchId]);
      const windows = await tx.staffAppointmentWindow.findMany({
        where: { branchId, deletedAt: null, startsAt: { gte: from, lt: until } },
        include: { staff: true },
      });
      if (!windows.length) throw new BadRequestException('วันต้นทางยังไม่มีตาราง');
      const delta = +target - +from;
      const copies = windows.map((w) => ({
        branchId,
        staffUserId: w.staffUserId,
        startsAt: new Date(+w.startsAt + delta),
        endsAt: new Date(+w.endsAt + delta),
        createdById: user.id,
      }));
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i],
          copy = copies[i];
        if (!staffIsAvailable(w.staff, branchId))
          throw new BadRequestException('มีพนักงานที่ไม่พร้อมรับนัด กรุณาแก้ตารางต้นทาง');
        if (
          await tx.staffAppointmentWindow.count({
            where: {
              staffUserId: w.staffUserId,
              deletedAt: null,
              startsAt: { lt: copy.endsAt },
              endsAt: { gt: copy.startsAt },
            },
          })
        )
          throw new ConflictException('ตารางปลายทางซ้อนกัน ยังไม่ได้คัดลอกแถวใด');
      }
      await tx.staffAppointmentWindow.createMany({ data: copies });
      return { count: copies.length };
    });
  }
  async remove(id: string, version: number, actor: AppointmentActor) {
    return transaction(this.db, async (tx) => {
      await staffAccess(tx, actor, true);
      const window = await tx.staffAppointmentWindow.findFirst({ where: { id, deletedAt: null } });
      if (!window) throw new BadRequestException('ไม่พบช่วงเวลารับนัด');
      await branchAccess(tx, actor, window.branchId);
      await lockBranchStaff(tx, [window.branchId], [window.staffUserId]);
      if (
        await tx.storeAppointment.count({
          where: { windowId: id, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
        })
      )
        throw new ConflictException('มีนัดในช่วงนี้ กรุณาย้ายนัดก่อน');
      const result = await tx.staffAppointmentWindow.updateMany({
        where: { id, version, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      if (!result.count) throw new ConflictException('ตารางเปลี่ยนแล้ว กรุณาโหลดใหม่');
      return { id };
    });
  }
}
