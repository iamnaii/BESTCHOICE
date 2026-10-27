import type { ContractSnapshotRead } from '@installment/shared';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractReadAvailability } from '@installment/shared';
import { outstandingOf, UNPAID_INSTALLMENT_WHERE } from '../contracts/contract-outstanding';
import { PartyQueryPlan } from './access-party-query-plan';
import { derivedLabels, categoryAvailability } from './access-contract-derived-children';
import { FINANCE_CONTRACT_READ_LIMIT } from './access-party-source.service';

export async function contractDerivedSnapshot(
  plan: PartyQueryPlan,
  id: string,
): Promise<ContractSnapshotRead> {
  const db = plan.db;
  const row = await db.contract.findFirst({
    where: { id, AND: plan.contract },
    select: {
      id: true,
      contractNumber: true,
      customerId: true,
      productId: true,
      status: true,
      totalMonths: true,
      collectionNotes: true,
      updatedAt: true,
    },
  });
  if (!row) throw new ForbiddenException('ไม่มีสิทธิ์อ่านสัญญานี้');
  const permits = async (...permissions: Parameters<PartyQueryPlan['finance']>[0][]) =>
    !!(await db.contract.count({
      where: {
        id,
        AND: [plan.contract, ...permissions.map((permission) => plan.finance(permission))],
      },
    }));
  const [payments, contacts, promises, labels] = await Promise.all([
    permits('payments.read'),
    permits('collections.read', 'collection-contacts.read'),
    permits('collections.read', 'payment-promises.read'),
    derivedLabels(plan, [row]),
  ]);
  const [all, unpaid, paidCount, lastPromise] = await Promise.all([
    payments
      ? db.payment.aggregate({
          where: { contractId: id, deletedAt: null },
          _sum: { amountDue: true },
        })
      : null,
    payments
      ? db.payment.aggregate({
          where: { contractId: id, ...UNPAID_INSTALLMENT_WHERE },
          _sum: { amountDue: true, amountPaid: true },
        })
      : null,
    payments
      ? db.payment.count({ where: { contractId: id, deletedAt: null, status: 'PAID' } })
      : null,
    promises
      ? db.callLog.findFirst({
          where: { contractId: id, deletedAt: null, settlementDate: { not: null } },
          orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
          select: {
            settlementDate: true,
            result: true,
            brokenAt: true,
            ...(contacts ? { settlementNotes: true, notes: true } : {}),
          },
        })
      : null,
  ]);
  const chat = categoryAvailability(plan, 'chat.read');
  let lastLine: { timestamp: string; read: boolean } | null = null;
  if (chat !== 'UNAVAILABLE') {
    const roomWhere: Prisma.ChatRoomWhereInput = {
      customerId: row.customerId,
      channel: 'LINE_FINANCE',
      AND: plan.room,
    };
    const rooms = await db.chatRoom.findMany({
      where: roomWhere,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: FINANCE_CONTRACT_READ_LIMIT + 1,
    });
    if (rooms.length > FINANCE_CONTRACT_READ_LIMIT)
      throw new BadRequestException('กรุณาระบุตัวกรองให้แคบลงแล้วลองอีกครั้ง');
    if (rooms.length) {
      await db.$queryRaw(
        Prisma.sql`SELECT id FROM chat_rooms WHERE id IN (${Prisma.join(rooms.map((room) => room.id))}) ORDER BY id FOR SHARE`,
      );
      const message = await db.chatMessage.findFirst({
        where: {
          deletedAt: null,
          room: { AND: [roomWhere, { id: { in: rooms.map((room) => room.id) } }] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true, readAt: true },
      });
      if (message)
        lastLine = { timestamp: message.createdAt.toISOString(), read: !!message.readAt };
    }
  }
  const customer = labels.customers.get(row.customerId) ?? null;
  const product = labels.products.get(row.productId);
  const note = contacts ? (row.collectionNotes ?? '').trim() : '';
  const visible = (allowed: boolean): ContractReadAvailability =>
    allowed ? 'VISIBLE_CURRENT' : 'UNAVAILABLE';
  return {
    scope: 'authorized-sources' as const,
    categoryScope: 'authorized-sources' as const,
    contractId: row.id,
    contractNumber: row.contractNumber,
    status: payments ? row.status : null,
    customer,
    product: product ? { name: product.name } : null,
    totals: payments
      ? {
          totalAmount: all!._sum.amountDue?.toNumber() ?? 0,
          outstanding: outstandingOf([
            { amountDue: unpaid!._sum.amountDue, amountPaid: unpaid!._sum.amountPaid },
          ]),
          installmentsTotal: row.totalMonths,
          installmentsRemaining: Math.max(0, row.totalMonths - paidCount!),
        }
      : null,
    lastPromise: lastPromise?.settlementDate
      ? {
          settlementDate: lastPromise.settlementDate.toISOString(),
          result: lastPromise.brokenAt ? 'BROKEN' : lastPromise.result,
          notes: contacts ? (lastPromise.settlementNotes ?? lastPromise.notes ?? null) : null,
        }
      : null,
    lastLine,
    lastCollectorComment: note
      ? {
          text: note.length > 100 ? `${note.slice(0, 100)}…` : note,
          truncated: note.length > 100,
          by: null,
          at: row.updatedAt.toISOString(),
        }
      : null,
    availability: {
      customer: visible(!!customer),
      product: visible(!!product),
      payments: visible(payments),
      collectionContacts: visible(contacts),
      paymentPromises: visible(promises),
      promiseNotes: visible(promises && contacts),
      chat,
    },
  };
}
