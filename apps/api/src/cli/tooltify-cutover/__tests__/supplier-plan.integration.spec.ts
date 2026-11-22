import { PrismaClient } from '@prisma/client';
import { afterAll, expect, it } from 'vitest';
import { planSuppliers } from '../supplier-plan';
import { supplierFixture } from './supplier-fixtures';
const db = new PrismaClient();
afterAll(() => db.$disconnect());
it('plans suppliers read-only and binds VAT, credit, branch, evidence and database to its hash', async () => {
  const { row, context } = await supplierFixture(db);
  const before = await db.supplier.count();
  const a = await planSuppliers(db, [row], context);
  expect(a.issues).toEqual([]);
  expect(a.items[0].disposition).toBe('CREATE');
  expect(a.kind).toBe('SUPPLIER');
  expect((await planSuppliers(db, [row], context)).planHash).toBe(a.planHash);
  expect(
    (await planSuppliers(db, [{ ...row, hasVat: true, creditTermDays: 15 }], context)).planHash,
  ).not.toBe(a.planHash);
  expect(await db.supplier.count()).toBe(before);
});
it('reports incomplete rows instead of falling through to the sales importer', async () => {
  const { row, context } = await supplierFixture(db);
  row.phone = null;
  row.type = null;
  const p = await planSuppliers(db, [row], context);
  expect(p.issues.map((x) => x.code)).toContain('SUPPLIER_PHONE_REQUIRED');
  expect(p.items[0].disposition).toBe('CONFLICT');
});
it('requires reviewed exact matching and detects an existing same-bank different-name vendor', async () => {
  const { row, context } = await supplierFixture(db);
  row.bankAccounts = [
    {
      bankName: 'Synthetic bank',
      bankAccountName: 'Third party',
      bankAccountNumber: '000123450099',
    },
  ];
  const s = await db.supplier.create({
    data: {
      name: 'Different ' + row.legalName,
      phone: '020000000',
      paymentMethods: {
        create: {
          paymentMethod: 'BANK_TRANSFER',
          bankName: 'Synthetic bank',
          bankAccountName: 'Third party',
          bankAccountNumber: '000123450099',
        },
      },
    },
  });
  const p = await planSuppliers(db, [row], context);
  expect(p.items[0].disposition).toBe('CONFLICT');
  expect(p.items[0].targetId).toBeNull();
  expect(await db.supplier.findUnique({ where: { id: s.id } })).not.toBeNull();
});
it('rejects an origin branch belonging to a different company', async () => {
  const { row, context } = await supplierFixture(db);
  const company = await db.companyInfo.create({
    data: {
      companyCode: 'fixture-' + context.canonicalSetId,
      nameTh: 'Other',
      address: '',
      taxId: 'fixture',
      directorName: '',
    },
  });
  const branch = await db.branch.create({ data: { name: 'Other', companyId: company.id } });
  await expect(planSuppliers(db, [row], { ...context, accessBranchId: branch.id })).rejects.toThrow(
    'SUPPLIER_ORIGIN_SCOPE_MISMATCH',
  );
});

it('blocks reuse of a same-tax Contact belonging to FINANCE', async () => {
  const { row, context } = await supplierFixture(db);
  row.taxId = '0100000000012';
  await db.contact.create({
    data: {
      contactCode: context.canonicalSetId,
      name: row.legalName!,
      taxId: row.taxId,
      roles: ['SUPPLIER'],
      accessCompanyCode: 'FINANCE',
      accessBranchId: context.accessBranchId,
    },
  });
  const plan = await planSuppliers(db, [row], context);
  expect(plan.items[0].reason).toBe('SUPPLIER_CONTACT_CONFLICT');
});
it('blocks two supplier references explicitly claiming the same existing target', async () => {
  const { row, context } = await supplierFixture(db);
  const row2 = {
    ...row,
    supplierRef: 'SUP002',
    legalName: row.legalName + ' second',
    displayName: row.displayName + ' second',
    aliases: [row.displayName + ' second'],
  };
  const plan = await planSuppliers(db, [row, row2], {
    ...context,
    matchTargets: { SUP001: 'same-target', SUP002: 'same-target' },
  });
  expect(plan.issues.map((i) => i.code)).toContain('SUPPLIER_TARGET_CONFLICT');
});
