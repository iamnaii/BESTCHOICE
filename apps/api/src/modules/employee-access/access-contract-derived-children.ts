import { BadRequestException } from '@nestjs/common';
import {
  FINANCE_CONTRACT_READ_LIMIT,
  lockFinanceContractReadSources,
} from './access-party-source.service';
import { partyRoomReadWhere } from './access-party-scope';
import { Prisma } from '@prisma/client';
import { ContractReadAvailability, canAccess } from '@installment/shared';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PartyQueryPlan } from './access-party-query-plan';
import { currentDomainAccess } from './access-execution-context';

export function categoryAvailability(
  plan: PartyQueryPlan,
  permission: Parameters<PartyQueryPlan['has']>[0],
): ContractReadAvailability {
  return plan.company(permission, 'FINANCE')
    ? 'VISIBLE_CURRENT'
    : plan.has(permission, 'FINANCE')
      ? 'PARTIAL'
      : 'UNAVAILABLE';
}
export const customerLabelSelect = {
  id: true,
  name: true,
  phone: true,
  phoneEncrypted: true,
} satisfies Prisma.CustomerSelect;
export const productLabelSelect = {
  id: true,
  name: true,
  brand: true,
  model: true,
  category: true,
} satisfies Prisma.ProductSelect;

/** Authorize IDs in SQL, then lock current identities/dependencies before reading labels.
 * These finite label projections do not read national identity, salary, cost or profit. */
export async function derivedLabels(
  plan: PartyQueryPlan,
  rows: readonly { id?: string; customerId: string; productId?: string; salespersonId?: string }[],
) {
  const db = plan.db;
  const customerIds = [...new Set(rows.map((r) => r.customerId))];
  const productIds = [...new Set(rows.flatMap((r) => (r.productId ? [r.productId] : [])))];
  const staffIds = [...new Set(rows.flatMap((r) => (r.salespersonId ? [r.salespersonId] : [])))];
  const [customers, products] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: customerIds }, AND: plan.customer },
      select: { id: true },
      orderBy: { id: 'asc' },
    }),
    db.product.findMany({
      where: { id: { in: productIds }, AND: plan.product },
      select: { id: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  // Customer label authority can come from another current case or assigned room.
  // Lock those genuine contributors as well as the identity itself; otherwise a
  // concurrent reassignment could leave a stale label after a source wait.
  if (customers.length) {
    const ids = customers.map((r) => r.id);
    const cases = await db.contract.findMany({
      where: { customerId: { in: ids }, AND: [plan.contract, plan.finance('customers.read')] },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: FINANCE_CONTRACT_READ_LIMIT + 1,
    });
    await lockFinanceContractReadSources(db, [
      ...new Set([...rows.flatMap((r) => (r.id ? [r.id] : [])), ...cases.map((r) => r.id)]),
    ]);
    const rooms = await db.chatRoom.findMany({
      where: {
        customerId: { in: ids },
        AND: [
          partyRoomReadWhere(plan.scope('chat.read', 'FINANCE')),
          partyRoomReadWhere(plan.scope('customers.read', 'FINANCE')),
        ],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: FINANCE_CONTRACT_READ_LIMIT + 1,
    });
    if (rooms.length > FINANCE_CONTRACT_READ_LIMIT)
      throw new BadRequestException('กรุณาระบุตัวกรองให้แคบลงแล้วลองอีกครั้ง');
    if (rooms.length)
      await db.$queryRaw(
        Prisma.sql`SELECT id FROM chat_rooms WHERE id IN (${Prisma.join(rooms.map((r) => r.id))}) ORDER BY id FOR SHARE`,
      );
  }
  if (customers.length) {
    const ids = customers.map((r) => r.id);
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM customers WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
    );
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM branches WHERE id IN (SELECT access_branch_id FROM customers WHERE id IN (${Prisma.join(ids)})) ORDER BY id FOR SHARE`,
    );
  }
  if (products.length) {
    const ids = products.map((r) => r.id);
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM products WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
    );
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM branches WHERE id IN (SELECT branch_id FROM products WHERE id IN (${Prisma.join(ids)})) ORDER BY id FOR SHARE`,
    );
  }
  // The current execution already holds both actual company rows before policy.
  const [customerRows, productRows] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: customers.map((r) => r.id) }, AND: plan.customer },
      select: customerLabelSelect,
    }),
    db.product.findMany({
      where: { id: { in: products.map((r) => r.id) }, AND: plan.product },
      select: productLabelSelect,
    }),
  ]);
  const pii = new CustomerPiiService(db as PrismaService);
  const strict = customerRows.length ? await pii.isStrictMode(db) : false;
  const customerMap = new Map(
    customerRows.map((row) => {
      const value = pii.decryptCustomerFields(row, { strict })!;
      return [row.id, { id: row.id, name: row.name, phone: value.phone ?? null }];
    }),
  );
  const snapshot = currentDomainAccess()!.snapshot;
  const owner = snapshot.isOwner && canAccess(snapshot, 'users.manage', { company: 'FINANCE' });
  // A User's own branch/company is the only non-owner attribution source.
  const staffWhere: Prisma.UserWhereInput = {
    id: { in: staffIds },
    deletedAt: null,
    isSystemUser: false,
    ...(owner
      ? {}
      : {
          OR: [...plan.live].flatMap((company) =>
            plan.scope('employees.read', company).tuples.flatMap((tuple) => {
              if (tuple.scope === 'ASSIGNED') return [];
              return [
                {
                  branch: {
                    isActive: true,
                    deletedAt: null,
                    company: { companyCode: company, isActive: true, deletedAt: null },
                    ...(tuple.scope === 'BRANCHES' ? { id: { in: [...tuple.branchIds] } } : {}),
                  },
                },
              ];
            }),
          ),
        }),
  };
  const staff = staffIds.length
    ? await db.user.findMany({ where: staffWhere, select: { id: true }, orderBy: { id: 'asc' } })
    : [];
  if (staff.length) {
    const ids = staff.map((r) => r.id);
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
    );
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM branches WHERE id IN (SELECT branch_id FROM users WHERE id IN (${Prisma.join(ids)})) ORDER BY id FOR SHARE`,
    );
  }
  const staffRows = staff.length
    ? await db.user.findMany({ where: staffWhere, select: { id: true, name: true } })
    : [];
  return {
    customers: customerMap,
    products: new Map(productRows.map((r) => [r.id, r])),
    staff: new Map(staffRows.map((r) => [r.id, r])),
  };
}
