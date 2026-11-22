import { harnessClient, frozen } from './rollback-fixtures';
import { afterAll, expect, it } from 'vitest';
import { planSuppliers } from '../supplier-plan';
import { applySuppliers, verifySuppliers, rollbackSuppliers } from '../supplier-writer';
import { supplierFixture } from './supplier-fixtures';
const db = harnessClient();
afterAll(() => db.$disconnect());
const moneyCounts = () =>
  Promise.all([
    db.purchaseOrder.count(),
    db.sale.count(),
    db.payment.count(),
    db.journalEntry.count(),
  ]);
it('atomically creates the legal supplier, contact, credit, bank and receipt without money events; replay is idempotent', async () => {
  const { row, context } = await supplierFixture(db);
  row.hasVat = true;
  row.creditTermDays = 15;
  row.bankAccounts = [
    { bankName: 'Bank', bankAccountName: 'Another person', bankAccountNumber: '000100123456' },
  ];
  const plan = await planSuppliers(db, [row], context);
  const money = await moneyCounts();
  const before = await db.supplier.count();
  const first = await applySuppliers(db, plan);
  expect(first.created).toBe(1);
  expect(await applySuppliers(db, plan)).toEqual(first);
  expect(await db.supplier.count()).toBe(before + 1);
  const item = await db.tooltifyImportItem.findFirstOrThrow({ where: { batchId: plan.batchId } });
  const supplier = await db.supplier.findUniqueOrThrow({
    where: { id: item.targetId! },
    include: { paymentMethods: true, contact: true },
  });
  expect(supplier).toMatchObject({
    hasVat: true,
    contact: {
      name: row.legalName,
      accessCompanyCode: 'SHOP',
      accessBranchId: context.accessBranchId,
    },
  });
  expect(supplier.paymentMethods).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ paymentMethod: 'CREDIT', creditTermDays: 15, isDefault: true }),
      expect.objectContaining({
        bankAccountName: 'Another person',
        bankAccountNumber: '000100123456',
        isDefault: false,
      }),
    ]),
  );
  expect(await moneyCounts()).toEqual(money);
  expect((await verifySuppliers(db, plan)).verified).toBe(true);
});
it('rejects drift and tampering before creating a supplier or receipt', async () => {
  const { row, context } = await supplierFixture(db);
  const plan = await planSuppliers(db, [row], context);
  await db.supplier.create({ data: { name: row.legalName!, phone: '020000000' } });
  const count = await db.supplier.count();
  await expect(applySuppliers(db, plan)).rejects.toThrow('IMPORT_DEPENDENCY_CHANGED');
  expect(await db.supplier.count()).toBe(count);
  expect(await db.tooltifyImportBatch.findUnique({ where: { id: plan.batchId } })).toBeNull();
  const fake = structuredClone(plan);
  fake.items[0].payload.hasVat = true;
  await expect(applySuppliers(db, fake)).rejects.toThrow('IMPORT_PLAN_BLOCKED_OR_CHANGED');
});
it('rolls back every create in the batch when any later creation fails', async () => {
  const { row, context } = await supplierFixture(db);
  const row2 = {
    ...row,
    supplierRef: 'SUP002',
    displayName: row.displayName + ' second',
    legalName: row.legalName + ' second',
    aliases: [row.displayName + ' second'],
  };
  const plan = await planSuppliers(db, [row, row2], context);
  const before = await db.supplier.count();
  const contacts = await db.contact.count();
  // Force a real database failure on the second supplier without changing reviewed input.
  await db.$executeRawUnsafe(
    `CREATE FUNCTION reject_supplier_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name LIKE '% second' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER reject_supplier_fixture BEFORE INSERT ON suppliers FOR EACH ROW EXECUTE FUNCTION reject_supplier_fixture()',
  );
  try {
    await expect(applySuppliers(db, plan)).rejects.toThrow();
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER reject_supplier_fixture ON suppliers');
    await db.$executeRawUnsafe('DROP FUNCTION reject_supplier_fixture()');
  }
  expect(await db.supplier.count()).toBe(before);
  expect(await db.contact.count()).toBe(contacts);
  expect(await db.tooltifyImportBatch.findUnique({ where: { id: plan.batchId } })).toBeNull();
});
it('rollback preserves preexisting MATCH targets and removes only unused batch-owned supplier/contact records', async () => {
  const { row, context } = await supplierFixture(db);
  const plan = await planSuppliers(db, [row], context);
  await applySuppliers(db, plan);
  const receipt = await db.tooltifyImportItem.findFirstOrThrow({
    where: { batchId: plan.batchId },
  });
  const s = await db.supplier.findUniqueOrThrow({ where: { id: receipt.targetId! } });
  await frozen(() => rollbackSuppliers(db, plan));
  expect((await db.supplier.findUniqueOrThrow({ where: { id: s.id } })).deletedAt).not.toBeNull();
  expect(
    (await db.contact.findUniqueOrThrow({ where: { id: s.contactId! } })).deletedAt,
  ).not.toBeNull();
  await frozen(() => rollbackSuppliers(db, plan));
  await expect(applySuppliers(db, plan)).rejects.toThrow('ROLLED_BACK_NEW_INSPECTED_RUN_REQUIRED');
});
it('refuses rollback of a changed supplier or a supplier used by a product', async () => {
  const { row, context, stock } = await supplierFixture(db);
  const p = await planSuppliers(db, [row], context);
  await applySuppliers(db, p);
  const item = await db.tooltifyImportItem.findFirstOrThrow({ where: { batchId: p.batchId } });
  await db.product.create({
    data: {
      name: 'Fixture stock',
      brand: 'Test',
      model: 'Test',
      category: 'PHONE_NEW',
      status: 'QC_PENDING',
      branchId: stock.rows[0].branchId,
      costPrice: 1,
      supplierId: item.targetId,
    },
  });
  await expect(frozen(() => rollbackSuppliers(db, p))).rejects.toThrow('SUPPLIER_TARGET_IN_USE');
  await db.supplier.update({ where: { id: item.targetId! }, data: { hasVat: true } });
  await expect(verifySuppliers(db, p)).rejects.toThrow('SUPPLIER_TARGET_CHANGED');
});

it('preserves an explicitly matched supplier on rollback of the matching batch', async () => {
  const { row, context } = await supplierFixture(db);
  const first = await planSuppliers(db, [row], context);
  await applySuppliers(db, first);
  const receipt = await db.tooltifyImportItem.findFirstOrThrow({
    where: { batchId: first.batchId },
  });
  const next = await planSuppliers(db, [row], {
    ...context,
    canonicalSetId: context.canonicalSetId + '-matched',
    matchTargets: { [row.supplierRef]: receipt.targetId! },
  });
  expect(next.items[0].disposition).toBe('MATCH');
  await applySuppliers(db, next);
  await frozen(() => rollbackSuppliers(db, next));
  expect(
    (await db.supplier.findUniqueOrThrow({ where: { id: receipt.targetId! } })).deletedAt,
  ).toBeNull();
});
it('rejects changed contact ownership metadata before rollback can archive another contact', async () => {
  const { row, context } = await supplierFixture(db);
  const plan = await planSuppliers(db, [row], context);
  await applySuppliers(db, plan);
  const receipt = await db.tooltifyImportItem.findFirstOrThrow({
    where: { batchId: plan.batchId },
  });
  const innocent = await db.contact.create({
    data: { contactCode: 'SAFE-' + context.canonicalSetId, name: 'Untouched party', roles: [] },
  });
  await db.tooltifyImportItem.update({
    where: { id: receipt.id },
    data: { sourceRefs: [...row.evidenceRefs, { contactCreated: true, contactId: innocent.id }] },
  });
  await expect(frozen(() => rollbackSuppliers(db, plan))).rejects.toThrow(
    'SUPPLIER_TARGET_CHANGED',
  );
  expect((await db.contact.findUniqueOrThrow({ where: { id: innocent.id } })).deletedAt).toBeNull();
});

it('requires closed database admission before supplier reversal so an admitted writer cannot reference an archived supplier', async () => {
  const { row, context } = await supplierFixture(db);
  const plan = await planSuppliers(db, [row], context);
  await applySuppliers(db, plan);
  await expect(rollbackSuppliers(db, plan)).rejects.toThrow('ROLLBACK_FREEZE_REQUIRED');
});

it('observes admission closed after the rollback PID announcement', async () => {
  const { row, context } = await supplierFixture(db);
  const p = await planSuppliers(db, [row], context);
  await applySuppliers(db, p);
  const admin = harnessClient('postgres');
  let closing: Promise<unknown> | undefined;
  try {
    await rollbackSuppliers(db, p, () => {
      closing = admin.$executeRaw`ALTER DATABASE bc_vitest_test ALLOW_CONNECTIONS false`.then(
        (v) => v,
      );
    });
    expect(closing).toBeDefined();
    await closing;
  } finally {
    await admin.$executeRaw`ALTER DATABASE bc_vitest_test ALLOW_CONNECTIONS true`;
    await admin.$disconnect();
  }
}, 70000);
