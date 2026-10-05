/** Dry-run by default. No provider calls; legacy cycles are excluded from response-time metrics. */
import { PrismaService } from '../prisma/prisma.service';
import { ResponseCycleService } from '../modules/chat-engine/services/response-cycle.service';

async function main() {
  if (!process.env.EXPECTED_DB_NAME) throw new Error('EXPECTED_DB_NAME is required');
  const db = new PrismaService();
  try {
    const [actual] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (actual.name !== process.env.EXPECTED_DB_NAME)
      throw new Error('Database does not match EXPECTED_DB_NAME');
    const service = new ResponseCycleService(db);
    console.log(JSON.stringify(await service.seedLegacy()));
    if (process.env.CONFIRM_BACKFILL !== 'YES_I_AM_SURE') return;
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_PROD_BACKFILL !== 'YES_I_AM_SURE'
    ) {
      throw new Error('Production requires explicit ALLOW_PROD_BACKFILL');
    }
    console.log(JSON.stringify(await service.seedLegacy(false)));
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Backfill failed');
    process.exitCode = 1;
  });
