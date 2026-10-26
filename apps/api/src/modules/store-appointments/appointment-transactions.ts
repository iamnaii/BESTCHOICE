import { ConflictException, GoneException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppointmentActor,
  AppointmentDb,
  actorKey,
  staffAccess,
  liveLink,
  branchAccess,
  customerAccess,
} from './appointment-access';

export async function transaction<T>(
  db: PrismaService,
  work: (tx: AppointmentDb) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, { timeout: 20_000, maxWait: 10_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034' && attempt < 2) continue;
        if (error.code === 'P2002')
          throw new ConflictException('มีนัดที่ยังไม่จบอยู่แล้ว กรุณาเปิดนัดเดิม');
      }
      throw error;
    }
  }
}

export async function requestMutation<T>(
  db: PrismaService,
  actor: AppointmentActor,
  requestId: string,
  payload: unknown,
  work: (tx: AppointmentDb) => Promise<T>,
): Promise<T> {
  const key = actorKey(actor),
    hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return transaction(db, async (tx) => {
    if ('staffId' in actor) await staffAccess(tx, actor);
    else await liveLink(tx, actor.linkId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key + ':' + requestId},0))`;
    const previous = await tx.appointmentRequest.findUnique({
      where: { actorKey_requestId: { actorKey: key, requestId } },
    });
    if (previous) {
      if (previous.requestHash !== hash)
        throw new ConflictException('คำขอเดิมมีข้อมูลต่างกัน กรุณาลองใหม่');
      const result = previous.result as { id?: string; branchId?: string; customerId?: string };
      const current = result.id
        ? await tx.storeAppointment.findFirst({
            where: { id: result.id, deletedAt: null },
            select: { branchId: true, customerId: true },
          })
        : null;
      if (!current) throw new GoneException('นัดนี้ใช้งานไม่ได้แล้ว');
      await branchAccess(tx, actor, current.branchId, true);
      await customerAccess(tx, actor, current.customerId);
      if (result.branchId) await branchAccess(tx, actor, result.branchId, true);
      if (result.customerId) await customerAccess(tx, actor, result.customerId);
      if (
        'linkId' in actor &&
        !(await tx.appointmentLinkAccess.count({
          where: {
            linkId: actor.linkId,
            appointmentId: result.id,
            deletedAt: null,
            manageExpiresAt: { gt: new Date() },
          },
        }))
      )
        throw new GoneException('สิทธิ์จัดการนัดหมดอายุแล้ว');
      return previous.result as T;
    }
    const result = await work(tx);
    if ('linkId' in actor) {
      await tx.$queryRaw`SELECT id FROM store_appointment_links WHERE id=${actor.linkId} FOR SHARE`;
      await liveLink(tx, actor.linkId);
    }
    await tx.appointmentRequest.create({
      data: {
        actorKey: key,
        requestId,
        requestHash: hash,
        result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
      },
    });
    return result;
  });
}

export async function lockCustomer(db: AppointmentDb, id: string, credit = false) {
  await db.$queryRaw`SELECT id FROM customers WHERE id=${id} FOR NO KEY UPDATE`;
  if (credit)
    await db.$queryRaw`SELECT id FROM credit_checks WHERE customer_id=${id} ORDER BY id FOR UPDATE`;
}
export async function lockBranchStaff(
  db: AppointmentDb,
  branchIds: string[],
  extraIds: string[] = [],
) {
  // NO KEY UPDATE prevents schedule/account races without conflicting with FK key-share locks.
  await db.$queryRaw(
    Prisma.sql`SELECT id FROM users WHERE branch_id IN (${Prisma.join(branchIds)}) ${extraIds.length ? Prisma.sql`OR id IN (${Prisma.join(extraIds)})` : Prisma.empty} ORDER BY id FOR NO KEY UPDATE`,
  );
}
