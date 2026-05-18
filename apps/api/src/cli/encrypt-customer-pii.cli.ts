/**
 * Phase 3 SP4 — PDPA PII backfill CLI.
 *
 * Encrypts + hashes any Customer rows whose `*Encrypted` columns are still
 * NULL. Idempotent — re-runs skip rows that are already done.
 *
 * Usage:
 *   CONFIRM_BACKFILL=YES_I_AM_SURE \
 *   EXPECTED_DB_NAME=bestchoice_dev \
 *   PII_ENCRYPTION_KEY=<64-hex-chars> \
 *   PII_HASH_SALT=<>=32-chars> \
 *   npm --prefix apps/api run backfill:encrypt-pii
 *
 * Production: also add ALLOW_PROD_BACKFILL=YES_I_AM_SURE.
 *
 * Architectural notes:
 *   - We don't bootstrap the full NestJS DI container — instantiating
 *     PdpaEncryptionService directly with PrismaClient keeps the CLI fast
 *     and lets it run inside Cloud Run Jobs without the HTTP server.
 *   - The service writes one PdpaBackfillRun row regardless of CLI vs UI
 *     trigger, so ops gets a single auditable history.
 *   - NEVER prints decrypted PII. Progress lines only carry counters.
 */
import { PrismaClient } from '@prisma/client';
import { PdpaEncryptionService } from '../modules/pdpa/pdpa-encryption.service';
import { CustomerPiiService } from '../modules/customers/customer-pii.service';
import type { PrismaService } from '../prisma/prisma.service';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  if (process.env.CONFIRM_BACKFILL !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to run without CONFIRM_BACKFILL=${REQUIRED_CONSENT}`);
    console.error('');
    console.error('This script encrypts + hashes plaintext PII columns on the `customers`');
    console.error('table in-place. It is idempotent (already-encrypted rows are skipped) but');
    console.error('it WRITES to production data. Run a Cloud SQL backup first if in doubt.');
    console.error('');
    console.error('Required env vars:');
    console.error(`  CONFIRM_BACKFILL=${REQUIRED_CONSENT}      (consent)`);
    console.error('  EXPECTED_DB_NAME=<db-name>              (must match current_database())');
    console.error('  PII_ENCRYPTION_KEY=<64 hex chars>       (AES-256-GCM key)');
    console.error('  PII_HASH_SALT=<32+ chars>               (HMAC salt for lookup hashes)');
    console.error('');
    console.error('Optional:');
    console.error('  ALLOW_PROD_BACKFILL=YES_I_AM_SURE       (required when NODE_ENV=production)');
    console.error('  PDPA_BACKFILL_BATCH_SIZE=100            (rows per batch; default 100)');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to backfill in NODE_ENV=production without ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: Refusing to run without EXPECTED_DB_NAME=<exact-db-name>');
    process.exit(1);
  }

  if (!process.env.PII_ENCRYPTION_KEY || process.env.PII_ENCRYPTION_KEY.length !== 64) {
    console.error('ERROR: PII_ENCRYPTION_KEY must be set to 64 hex chars (32 bytes for AES-256)');
    process.exit(1);
  }
  if (!process.env.PII_HASH_SALT || process.env.PII_HASH_SALT.length < 32) {
    console.error('ERROR: PII_HASH_SALT must be set to >=32 chars');
    process.exit(1);
  }

  const batchSize = parseBatchSize(process.env.PDPA_BACKFILL_BATCH_SIZE);

  const prisma = new PrismaClient();
  const [{ current_database: actualDb }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected to "${actualDb}" but EXPECTED_DB_NAME="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[pdpa-backfill] DB: ${actualDb}`);
  console.log(`[pdpa-backfill] Batch size: ${batchSize}`);
  console.log('[pdpa-backfill] Press Ctrl+C within 5 seconds to abort.');
  await new Promise((r) => setTimeout(r, 5000));

  try {
    // Instantiate the service with the bare PrismaClient. CustomerPiiService
    // depends on PrismaService only for the strict-mode SystemConfig read,
    // which the backfill itself doesn't need, so we cast the client.
    const piiService = new CustomerPiiService(prisma as unknown as PrismaService);
    const pdpaService = new PdpaEncryptionService(prisma as unknown as PrismaService, piiService);

    console.log('[pdpa-backfill] Starting backfill...');
    const result = await pdpaService.runBackfill({
      triggeredBy: 'cli',
      triggeredByUserId: null,
      batchSize,
      onProgress: (p) => {
        const pct = p.total > 0 ? Math.round((p.processed * 100) / p.total) : 100;
        console.log(`[pdpa-backfill]   batch ${p.batchNumber}: processed=${p.processed}/${p.total} (${pct}%), skipped=${p.skipped}`);
      },
    });

    console.log('');
    console.log(`[pdpa-backfill] Run id: ${result.id}`);
    console.log(`[pdpa-backfill] Status: ${result.status}`);
    console.log(`[pdpa-backfill] Total:     ${result.totalRecords}`);
    console.log(`[pdpa-backfill] Processed: ${result.processedRecords}`);
    console.log(`[pdpa-backfill] Skipped:   ${result.skippedRecords}`);
    console.log(`[pdpa-backfill] Duration:  ${(result.durationMs / 1000).toFixed(1)}s`);
    if (result.errorMessage) {
      console.error(`[pdpa-backfill] Error: ${result.errorMessage}`);
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function parseBatchSize(raw: string | undefined): number {
  if (!raw) return PdpaEncryptionService.DEFAULT_BATCH_SIZE;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) {
    return PdpaEncryptionService.DEFAULT_BATCH_SIZE;
  }
  return n;
}

main().catch((err) => {
  console.error('[pdpa-backfill] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
