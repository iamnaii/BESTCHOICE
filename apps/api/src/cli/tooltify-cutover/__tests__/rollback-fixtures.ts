import { PrismaClient, type Prisma } from '@prisma/client';
import { writeStockItem } from '../stock-writer';
import { writeSalesItem } from '../sales-writer';
import type { PlannedItem } from '../types';

// This helper changes admission only on the project's ephemeral socket-only test database.
export function harnessClient(database = 'bc_vitest_test') {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    url.pathname !== '/bc_vitest_test' ||
    url.hostname !== 'localhost' ||
    !/^\/(?:private\/)?tmp\/bc-vitest-db\.[A-Za-z0-9]+\/socket$/.test(
      url.searchParams.get('host') ?? '',
    )
  )
    throw Error('ISOLATED_TEST_HARNESS_REQUIRED');
  url.pathname = '/' + database;
  url.searchParams.set('connection_limit', '1');
  return new PrismaClient({ datasourceUrl: url.toString() });
}
export async function frozen<T>(run: () => Promise<T>) {
  const admin = harnessClient('postgres');
  try {
    await admin.$executeRaw`ALTER DATABASE bc_vitest_test ALLOW_CONNECTIONS false`;
    return await run();
  } finally {
    await admin.$executeRaw`ALTER DATABASE bc_vitest_test ALLOW_CONNECTIONS true`;
    await admin.$disconnect();
  }
}
export function writer(tx: Prisma.TransactionClient, item: PlannedItem) {
  return item.kind === 'STOCK' ? writeStockItem(tx, item) : writeSalesItem(tx, item);
}
