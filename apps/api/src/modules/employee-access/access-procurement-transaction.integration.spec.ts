import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AccessResourceService } from './access-resource.service';
import { AccessSnapshotService, lockEmployeeAccess } from './access-snapshot.service';
import { currentDomainAccess, domainAccessClient, onDomainCommit, onDomainRollback } from './access-execution-context';
import { PrismaService } from '../../prisma/prisma.service';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-')) throw new Error('Isolated URL required');
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as PrismaService;
const resources = new AccessResourceService(prisma, new AccessSnapshotService(prisma));
let actor: string;
beforeAll(async () => {
  actor = (await db.user.create({ data: { name: 'Transaction fixture', email: `${randomUUID()}@test.invalid`, password: 'unused', role: 'OWNER', accessManaged: true } })).id;
});
afterAll(() => db.$disconnect());
const execute = (handler: () => Promise<unknown>) => resources.execute(actor, 'purchase-orders.read', 'SHOP', undefined, handler, true, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxAttempts: 3 });

test('nested callbacks retain Serializable and cannot silently demand stronger isolation', async () => {
  await execute(async () => {
    const rows = await domainAccessClient(prisma).$transaction(async tx => tx.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation`, { isolationLevel: 'Serializable' });
    expect(rows[0].transaction_isolation).toBe('serializable');
  });
  await expect(resources.execute(actor, 'purchase-orders.read', 'SHOP', undefined, () => domainAccessClient(prisma).$transaction(async () => 1, { isolationLevel: 'Serializable' }))).rejects.toThrow('isolation');
});
test('whole transaction retries reload authorization and discard failed effects/writes', async () => {
  let attempts = 0;
  const committed: number[] = [], rolledBack: number[] = [];
  await execute(async () => {
    const attempt = ++attempts;
    onDomainCommit(async () => { committed.push(attempt); });
    onDomainRollback(async () => { rolledBack.push(attempt); });
    await currentDomainAccess()!.client.todo.create({ data: { title: 'Retry fixture', createdById: actor } });
    if (attempt === 1) throw new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: 'fixture' });
  });
  expect(committed).toEqual([2]);
  expect(rolledBack).toEqual([1]);
  expect(await db.todo.count({ where: { title: 'Retry fixture', createdById: actor } })).toBe(1);
});
test('failed outer execution rolls back nested writes and invokes cleanup only', async () => {
  const effects: string[] = [];
  await expect(execute(async () => {
    onDomainCommit(async () => { effects.push('commit'); });
    onDomainRollback(async () => { effects.push('cleanup'); });
    await domainAccessClient(prisma).$transaction(tx => tx.todo.create({ data: { title: 'Rollback fixture', createdById: actor } }));
    throw new Error('outer failure');
  })).rejects.toThrow('outer failure');
  expect(effects).toEqual(['cleanup']);
  expect(await db.todo.count({ where: { title: 'Rollback fixture', createdById: actor } })).toBe(0);
});
test('failed post-commit notification is observable without failing or replaying the committed mutation', async () => {
  let attempts = 0;
  const result = await execute(async () => {
    attempts++;
    onDomainCommit(async () => { throw new Error('external unavailable'); });
    return 'committed';
  });
  expect(result.result).toBe('committed');
  expect(result.effectFailures).toBe(1);
  expect(attempts).toBe(1);
});
test('ordinary position revocation while waiting restarts Serializable authorization', async () => {
  await db.companyInfo.upsert({ where: { companyCode: 'SHOP' }, create: { companyCode: 'SHOP', nameTh: 'Fixture', taxId: 'TEST', address: 'TEST', directorName: 'TEST' }, update: {} });
  const employee = await db.user.create({ data: { name: 'Grant fixture', email: `${randomUUID()}@test.invalid`, password: 'unused', role: 'SALES', accessManaged: true } });
  const position = await db.accessPosition.create({ data: { code: randomUUID(), name: 'Fixture', permissions: ['purchase-orders.read'] } });
  await db.employeeAccessAssignment.create({ data: { userId: employee.id, positionId: position.id, companyCode: 'SHOP', scope: 'COMPANY' } });
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>(resolve => { locked = resolve; });
  const unlock = new Promise<void>(resolve => { release = resolve; });
  const revocation = db.$transaction(async tx => {
    await lockEmployeeAccess(tx);
    await tx.accessPosition.update({ where: { id: position.id }, data: { permissions: [] } });
    await tx.user.update({ where: { id: employee.id }, data: { accessRevision: { increment: 1 } } });
    locked(); await unlock;
  });
  await held;
  let executed = false;
  const pending = resources.execute(employee.id, 'purchase-orders.read', 'SHOP', undefined, async () => { executed = true; }, true, { isolationLevel: 'Serializable', maxAttempts: 3 });
  try {
    for (let i = 0; i < 100; i++) {
      const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event = 'advisory' AND datname = current_database()) AS waiting`;
      if (rows[0].waiting) break;
      if (i === 99) throw new Error('Access transaction did not wait');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally { release(); }
  await revocation;
  await expect(pending).rejects.toThrow('ไม่มีสิทธิ์');
  expect(executed).toBe(false);
});
test('Serializable access lock waiter reloads owner demotion rather than using its old snapshot', async () => {
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>(resolve => { locked = resolve; });
  const unlock = new Promise<void>(resolve => { release = resolve; });
  const revocation = db.$transaction(async tx => {
    await lockEmployeeAccess(tx);
    await tx.user.update({ where: { id: actor }, data: { role: 'SALES', accessRevision: { increment: 1 } } });
    locked();
    await unlock;
  });
  await held;
  const pending = execute(async () => { throw new Error('stale authority executed'); });
  // Wait for the actual DB lock waiter, not a timing assumption.
  for (let i = 0; i < 100; i++) {
    const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event = 'advisory' AND datname = current_database()) AS waiting`;
    if (rows[0].waiting) break;
    if (i === 99) throw new Error('Access transaction did not wait');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  release();
  await revocation;
  await expect(pending).rejects.toThrow('ไม่มีสิทธิ์');
});
