import { BadRequestException, GoneException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppointmentActor,
  AppointmentRow,
  branchAccess,
  customerAccess,
  liveLink,
  staffAccess,
} from './appointment-access';
import { DAY_MS } from './appointment-policy';
import { transaction } from './appointment-transactions';
import { StoreAppointmentsService } from './store-appointments.service';
import { IssueLinkDto } from './appointment.dto';
export function publicAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    reference: row.reference,
    branch: row.branch,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    version: row.version,
  };
}
@Injectable()
export class AppointmentLinksService {
  constructor(
    private readonly db: PrismaService,
    private readonly appointments: StoreAppointmentsService,
  ) {}
  async issue(input: IssueLinkDto, actor: AppointmentActor) {
    const token = randomBytes(32).toString('base64url');
    return transaction(this.db, async (tx) => {
      const user = await staffAccess(tx, actor);
      await customerAccess(tx, actor, input.customerId);
      for (const id of input.branchIds) await branchAccess(tx, actor, id);
      const appointment = input.appointmentId
        ? await this.appointments.read(tx, input.appointmentId, actor)
        : null;
      if (
        appointment &&
        (appointment.customerId !== input.customerId ||
          !input.branchIds.includes(appointment.branchId))
      )
        throw new BadRequestException('นัดไม่ตรงกับลูกค้าหรือสาขา');
      if (!appointment && !(await this.appointments.credit(tx, input.customerId)).eligible)
        throw new BadRequestException('ลูกค้ายังไม่ผ่านเครดิตเบื้องต้น');
      const link = await tx.storeAppointmentLink.create({
        data: {
          customerId: input.customerId,
          allowedBranchIds: [...new Set(input.branchIds)],
          tokenHash: createHash('sha256').update(token).digest('hex'),
          bookingExpiresAt: new Date(Date.now() + 30 * DAY_MS),
          issuedById: user.id,
        },
      });
      if (appointment)
        await tx.appointmentLinkAccess.create({
          data: {
            linkId: link.id,
            appointmentId: appointment.id,
            manageExpiresAt: new Date(+appointment.endsAt + DAY_MS),
          },
        });
      return { id: link.id, token, bookingExpiresAt: link.bookingExpiresAt };
    });
  }
  async list(customerId: string, actor: AppointmentActor) {
    const user = await staffAccess(this.db, actor);
    await customerAccess(this.db, actor, customerId);
    const rows = await this.db.storeAppointmentLink.findMany({
      where: {
        customerId,
        deletedAt: null,
        ...(user.role !== 'OWNER' ? { allowedBranchIds: { equals: [user.branchId!] } } : {}),
      },
      select: {
        id: true,
        createdAt: true,
        bookingExpiresAt: true,
        revokedAt: true,
        allowedBranchIds: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows;
  }
  async revoke(id: string, actor: AppointmentActor) {
    return transaction(this.db, async (tx) => {
      await staffAccess(tx, actor);
      const link = await liveLink(tx, id);
      for (const branchId of link.allowedBranchIds) await branchAccess(tx, actor, branchId, true);
      await tx.storeAppointmentLink.update({ where: { id }, data: { revokedAt: new Date() } });
      return { id };
    });
  }
  async resolve(token: string | undefined): Promise<{ linkId: string }> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new GoneException('ไม่พบลิงก์ หรือลิงก์นี้ใช้งานไม่ได้แล้ว');
    const link = await this.db.storeAppointmentLink.findUnique({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });
    if (!link) throw new GoneException('ไม่พบลิงก์ หรือลิงก์นี้ใช้งานไม่ได้แล้ว');
    await liveLink(this.db, link.id);
    return { linkId: link.id };
  }
  async context(token: string | undefined) {
    const actor = await this.resolve(token),
      link = await liveLink(this.db, actor.linkId);
    const access = await this.db.appointmentLinkAccess.findFirst({
      where: {
        linkId: link.id,
        deletedAt: null,
        manageExpiresAt: { gt: new Date() },
        appointment: { deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    const canBook = link.bookingExpiresAt > new Date();
    if (!canBook && !access) throw new GoneException('ลิงก์หมดอายุแล้ว กรุณาติดต่อสาขา');
    const appointment = access
      ? publicAppointment(await this.appointments.read(this.db, access.appointmentId, actor))
      : null;
    const eligibility = await this.appointments.eligibility(link.customerId, actor);
    const branches = await this.db.branch.findMany({
      where: {
        id: { in: link.allowedBranchIds },
        deletedAt: null,
        isActive: true,
        company: { companyCode: 'SHOP', deletedAt: null },
      },
      select: { id: true, name: true, location: true, phone: true },
      orderBy: { name: 'asc' },
    });
    const existing = await this.db.storeAppointment.count({
      where: {
        customerId: link.customerId,
        deletedAt: null,
        status: { in: ['BOOKED', 'CHECKED_IN', 'IN_SERVICE'] },
      },
    });
    return {
      canBook,
      eligibility,
      branches,
      appointment,
      hasOtherAppointment: existing > 0 && !appointment,
    };
  }
  async customerId(actor: { linkId: string }) {
    return (await liveLink(this.db, actor.linkId)).customerId;
  }
}
