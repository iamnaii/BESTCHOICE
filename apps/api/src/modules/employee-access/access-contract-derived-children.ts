import { Prisma } from '@prisma/client';
import { ContractReadAvailability } from '@installment/shared';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PartyQueryPlan } from './access-party-query-plan';
import { lockContractStaffSources } from './access-contract-staff-source';
import { lockContractCustomerSources } from './access-contract-customer-sources';

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
  await lockContractCustomerSources(
    plan,
    customers.map((row) => row.id),
  );
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
  const staffWhere = await lockContractStaffSources(plan, staffIds);
  const staffRows = staffIds.length
    ? await db.user.findMany({ where: staffWhere, select: { id: true, name: true } })
    : [];
  return {
    customers: customerMap,
    products: new Map(productRows.map((r) => [r.id, r])),
    staff: new Map(staffRows.map((r) => [r.id, r])),
  };
}
