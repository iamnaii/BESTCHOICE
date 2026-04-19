/**
 * One-time backfill: encrypt existing Customer + TradeIn PII columns.
 *
 * Production run procedure:
 * 1. Confirm Cloud Run env vars set: PII_ENCRYPTION_KEY (64 hex), PII_HASH_SALT (>=32 chars)
 *    Both must be loaded from Secret Manager — NEVER commit values.
 * 2. Take Cloud SQL backup BEFORE running:
 *      gcloud sql backups create --instance=bestchoice-prod --description="pre-pii-backfill"
 * 3. Run during low-traffic window (post 22:00 ICT):
 *      cd apps/api && npx ts-node scripts/backfill-pii-encryption.ts
 * 4. Verify counts via SQL queries (see end of file).
 * 5. Idempotent: re-running skips already-backfilled rows (where *Encrypted column is NOT NULL).
 *
 * Rollback: if a row is partially encrypted (e.g., process killed mid-update),
 * the row remains in dual-state — both plaintext + encrypted populated. Phase 5
 * reads gracefully fall back to plaintext if encrypted is NULL. No data loss.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { encryptPII } from '../src/utils/crypto.util';
import { hashPII, encryptReferencesJson } from '../src/utils/pii.util';

const BATCH_SIZE = 100;

async function backfillCustomers(prisma: PrismaClient, key: string, salt: string) {
  let cursor: string | undefined;
  let processed = 0;
  let skipped = 0;

  console.log('Starting Customer PII backfill...');

  while (true) {
    const customers = await prisma.customer.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
    });
    if (customers.length === 0) break;

    for (const c of customers) {
      // Idempotency: skip if both nationalIdEncrypted + nationalIdHash already set
      if (c.nationalIdEncrypted && c.nationalIdHash) {
        skipped++;
        continue;
      }

      await prisma.customer.update({
        where: { id: c.id },
        data: {
          nationalIdEncrypted: c.nationalId ? encryptPII(c.nationalId, key) : null,
          nationalIdHash: c.nationalId ? hashPII(c.nationalId, salt) : null,
          phoneEncrypted: c.phone ? encryptPII(c.phone, key) : null,
          phoneHash: c.phone ? hashPII(c.phone, salt) : null,
          phoneSecondaryEncrypted: c.phoneSecondary ? encryptPII(c.phoneSecondary, key) : null,
          emailEncrypted: c.email ? encryptPII(c.email, key) : null,
          addressIdCardEncrypted: c.addressIdCard ? encryptPII(c.addressIdCard, key) : null,
          addressCurrentEncrypted: c.addressCurrent ? encryptPII(c.addressCurrent, key) : null,
          addressWorkEncrypted: c.addressWork ? encryptPII(c.addressWork, key) : null,
          guardianNationalIdEncrypted: c.guardianNationalId
            ? encryptPII(c.guardianNationalId, key)
            : null,
          guardianPhoneEncrypted: c.guardianPhone ? encryptPII(c.guardianPhone, key) : null,
          guardianAddressEncrypted: c.guardianAddress ? encryptPII(c.guardianAddress, key) : null,
          referencesEncrypted: c.references
            ? (encryptReferencesJson(c.references, key) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });
      processed++;
    }
    cursor = customers[customers.length - 1].id;
    console.log(`  Customers: processed=${processed}, skipped=${skipped}`);
  }

  console.log(`Customer backfill complete: ${processed} updated, ${skipped} skipped`);
  return { processed, skipped };
}

async function backfillTradeIns(prisma: PrismaClient, key: string) {
  let cursor: string | undefined;
  let processed = 0;
  let skipped = 0;

  console.log('Starting TradeIn PII backfill...');

  while (true) {
    const trades = await prisma.tradeIn.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
    });
    if (trades.length === 0) break;

    for (const t of trades) {
      if (t.transferAccountNumberEncrypted) {
        skipped++;
        continue;
      }
      await prisma.tradeIn.update({
        where: { id: t.id },
        data: {
          transferAccountNumberEncrypted: t.transferAccountNumber
            ? encryptPII(t.transferAccountNumber, key)
            : null,
          transferAccountNameEncrypted: t.transferAccountName
            ? encryptPII(t.transferAccountName, key)
            : null,
        },
      });
      processed++;
    }
    cursor = trades[trades.length - 1].id;
    console.log(`  TradeIns: processed=${processed}, skipped=${skipped}`);
  }

  console.log(`TradeIn backfill complete: ${processed} updated, ${skipped} skipped`);
  return { processed, skipped };
}

async function main() {
  const key = process.env.PII_ENCRYPTION_KEY;
  const salt = process.env.PII_HASH_SALT;

  if (!key || key.length !== 64 || !/^[0-9a-f]+$/i.test(key)) {
    throw new Error(
      'PII_ENCRYPTION_KEY must be 64 hex chars. Generate via: openssl rand -hex 32',
    );
  }
  if (!salt || salt.length < 32) {
    throw new Error('PII_HASH_SALT must be >= 32 chars. Generate via: openssl rand -hex 32');
  }

  const prisma = new PrismaClient();
  try {
    const customerStats = await backfillCustomers(prisma, key, salt);
    const tradeInStats = await backfillTradeIns(prisma, key);

    console.log('\n========================================');
    console.log('Backfill complete');
    console.log(`  Customers: ${customerStats.processed} updated, ${customerStats.skipped} skipped`);
    console.log(`  TradeIns:  ${tradeInStats.processed} updated, ${tradeInStats.skipped} skipped`);
    console.log('========================================');
    console.log('\nVerify with SQL:');
    console.log(
      '  SELECT COUNT(*) FROM customers WHERE national_id IS NOT NULL AND national_id_encrypted IS NULL;',
    );
    console.log('  -- Expected: 0');
    console.log(
      '  SELECT COUNT(*) FROM trade_ins WHERE transfer_account_number IS NOT NULL AND transfer_account_number_encrypted IS NULL;',
    );
    console.log('  -- Expected: 0');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
