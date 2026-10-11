import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { hasCompanyAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';

export type AppointmentActor = { staffId: string } | { linkId: string };
export type AppointmentDb = Prisma.TransactionClient;
export const actorKey = (actor: AppointmentActor) =>
  'staffId' in actor ? `STAFF:${actor.staffId}` : `LINK:${actor.linkId}`;

export async function staffAccess(db: AppointmentDb, actor: AppointmentActor, manager = false) {
  if (!('staffId' in actor)) throw new ForbiddenException('เฉพาะพนักงาน');
  const user = await db.user.findFirst({
    where: { id: actor.staffId, deletedAt: null, isActive: true },
  });
  if (
    !user ||
    !(manager ? ['OWNER', 'BRANCH_MANAGER'] : ['OWNER', 'BRANCH_MANAGER', 'SALES']).includes(
      user.role,
    ) ||
    !hasCompanyAccess(user.role, user.accessibleCompanies, 'SHOP')
  ) {
    throw new ForbiddenException('ไม่มีสิทธิ์จัดการนัดหน้าร้าน');
  }
  if (user.role !== 'OWNER' && !user.branchId) throw new ForbiddenException('ยังไม่ได้กำหนดสาขา');
  return user;
}

export async function liveLink(db: AppointmentDb, linkId: string) {
  const link = await db.storeAppointmentLink.findFirst({
    where: { id: linkId, revokedAt: null, deletedAt: null, customer: { deletedAt: null } },
  });
  if (!link) throw new GoneException('ไม่พบลิงก์ หรือลิงก์นี้ใช้งานไม่ได้แล้ว');
  return link;
}

export async function branchAccess(
  db: AppointmentDb,
  actor: AppointmentActor,
  branchId: string,
  allowInactive = false,
) {
  if (!branchId || !/^[0-9a-f-]{36}$/i.test(branchId))
    throw new BadRequestException('กรุณาเลือกสาขา');
  const branch = await db.branch.findFirst({
    where: {
      id: branchId,
      deletedAt: null,
      ...(!allowInactive ? { isActive: true } : {}),
      company: { companyCode: 'SHOP', deletedAt: null },
    },
  });
  if (!branch) throw new NotFoundException('ไม่พบสาขาที่เปิดรับนัด');
  if ('staffId' in actor) {
    const user = await staffAccess(db, actor);
    if (user.role !== 'OWNER' && user.branchId !== branch.id)
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงนัดของสาขานี้');
  } else if (!(await liveLink(db, actor.linkId)).allowedBranchIds.includes(branchId))
    throw new ForbiddenException('ลิงก์นี้ไม่มีสิทธิ์สาขาที่เลือก');
  return branch;
}

export async function customerAccess(
  db: AppointmentDb,
  actor: AppointmentActor,
  customerId: string,
) {
  if(!customerId||! /^[0-9a-f-]{36}$/i.test(customerId))throw new BadRequestException('กรุณาเลือกลูกค้า');
  if ('staffId' in actor) await staffAccess(db, actor);
  else if ((await liveLink(db, actor.linkId)).customerId !== customerId)
    throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงนัดนี้');
  const customer = await db.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
  return customer;
}

export async function roomAccess(
  db: AppointmentDb,
  actor: AppointmentActor,
  roomId: string,
  customerId: string,
) {
  const user = await staffAccess(db, actor);
  const room = await db.chatRoom.findFirst({
    where: {
      id: roomId,
      customerId,
      deletedAt: null,
      channel: { not: 'LINE_FINANCE' },
      ...(user.role === 'SALES' ? { OR: [{ assignedToId: null }, { assignedToId: user.id }] } : {}),
    },
    select: { id: true },
  });
  if (!room) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทของลูกค้านี้');
}

export const staffIsAvailable = (
  staff: {
    isActive: boolean;
    deletedAt: Date | null;
    branchId: string | null;
    role: string;
    accessibleCompanies: string[];
  },
  branchId: string,
) =>
  staff.isActive &&
  !staff.deletedAt &&
  staff.branchId === branchId &&
  ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(staff.role) &&
  hasCompanyAccess(staff.role, staff.accessibleCompanies, 'SHOP');

export const appointmentInclude = {
  staff: {
    select: {
      id: true,
      name: true,
      isActive: true,
      deletedAt: true,
      branchId: true,
      role: true,
      accessibleCompanies: true,
    },
  },
  customer: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true, location: true, phone: true, isActive: true } },
} satisfies Prisma.StoreAppointmentInclude;
export type AppointmentRow = Prisma.StoreAppointmentGetPayload<{
  include: typeof appointmentInclude;
}>;
export const appointmentView = (row: AppointmentRow) => ({
  ...row,
  assignmentIssue: !staffIsAvailable(row.staff, row.branchId),
});
