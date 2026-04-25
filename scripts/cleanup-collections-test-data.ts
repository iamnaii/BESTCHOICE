/**
 * Cleanup Collections Test Data — soft-delete ทุก record ที่ marker matched
 *
 * ใช้:
 *   # Dry-run (preview)
 *   npx tsx scripts/cleanup-collections-test-data.ts
 *
 *   # ลบจริง (soft-delete + scramble unique fields เพื่อให้ re-seed ได้)
 *   npx tsx scripts/cleanup-collections-test-data.ts --commit
 *
 * Markers:
 *   - Customer.legacyMemberCode startsWith `__SEED_2026_04_25__`
 *   - Contract.notes = `__SEED_2026_04_25__`
 *
 * What this does (soft-delete per project rule — `database.md` ห้าม hard delete):
 *   - Customer/Contract/Payment.deletedAt = now()
 *   - Customer.legacyMemberCode → null  (free unique constraint for re-seed)
 *   - Customer.nationalId → `__DELETED_<uuid>` (free @unique constraint)
 *   - Customer.phone → `__DELETED_<uuid>` (free unique-ish lookup)
 *
 * Safety guards:
 *   - Customer must have name prefix `[TEST] ` (double-check)
 *   - Customer's contracts must ALL match marker (else skip — likely real data)
 *   - Refuse if > 25 records match (anti-blast)
 */
import { PrismaClient } from '@prisma/client';

const MARKER = '__SEED_2026_04_25__';
const NAME_PREFIX = '[TEST] ';
const MAX_DELETE_LIMIT = 25;

const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();

async function main() {
  console.log(`\n=== Cleanup Collections Test Data ===`);
  console.log(`Mode: ${COMMIT ? '🔥 COMMIT (soft-delete)' : '🧪 DRY-RUN'}`);
  console.log(`Marker: ${MARKER}\n`);

  // 1. Find marker-tagged contracts (active only — already-cleaned ones we leave alone)
  const contracts = await prisma.contract.findMany({
    where: { notes: MARKER, deletedAt: null },
    select: {
      id: true,
      contractNumber: true,
      customerId: true,
      customer: { select: { id: true, name: true, legacyMemberCode: true } },
      _count: { select: { payments: { where: { deletedAt: null } } } },
    },
  });
  console.log(`🔎 Found ${contracts.length} active contracts with marker`);

  const safeContracts = contracts.filter(
    (c) => c.customer.name.startsWith(NAME_PREFIX) && c.customer.legacyMemberCode?.startsWith(MARKER),
  );
  if (safeContracts.length !== contracts.length) {
    console.log(`⚠️  ${contracts.length - safeContracts.length} contracts skipped — customer doesn't match TEST pattern`);
  }
  if (safeContracts.length > MAX_DELETE_LIMIT) {
    console.error(`❌ Too many matches (${safeContracts.length} > ${MAX_DELETE_LIMIT}) — aborting`);
    process.exit(1);
  }

  // 2. Find marker-tagged customers (active only)
  const customers = await prisma.customer.findMany({
    where: { legacyMemberCode: { startsWith: MARKER }, deletedAt: null },
    select: {
      id: true,
      name: true,
      contracts: { where: { deletedAt: null }, select: { id: true, notes: true } },
    },
  });
  console.log(`🔎 Found ${customers.length} active customers with marker`);

  const safeCustomers = customers.filter((c) => {
    if (!c.name.startsWith(NAME_PREFIX)) return false;
    if (c.contracts.length === 0) return true;
    return c.contracts.every((ct) => ct.notes === MARKER);
  });
  if (safeCustomers.length !== customers.length) {
    console.log(
      `⚠️  ${customers.length - safeCustomers.length} customers skipped — name doesn't match TEST or contracts include non-marker rows`,
    );
  }
  if (safeCustomers.length > MAX_DELETE_LIMIT) {
    console.error(`❌ Too many customer matches (${safeCustomers.length} > ${MAX_DELETE_LIMIT}) — aborting`);
    process.exit(1);
  }

  if (safeContracts.length > 0) {
    console.log(`\n📋 Contracts to soft-delete:`);
    safeContracts.forEach((c) =>
      console.log(`  - ${c.contractNumber} (${c.customer.name}) — ${c._count.payments} payments`),
    );
  }
  if (safeCustomers.length > 0) {
    console.log(`\n👤 Customers to soft-delete:`);
    safeCustomers.forEach((c) => console.log(`  - ${c.name} [${c.contracts.length} contracts]`));
  }

  if (safeContracts.length === 0 && safeCustomers.length === 0) {
    console.log(`\n✋ ไม่มีอะไรต้องลบ`);
    return;
  }

  if (!COMMIT) {
    console.log(`\n✋ Dry-run — เพิ่ม --commit เพื่อ soft-delete จริง\n`);
    return;
  }

  console.log(`\n🗑️  Soft-deleting...`);
  const now = new Date();

  // 3. Soft-delete payments first (so a stale active payment doesn't surface
  //    in cron/queries after parents are gone). Order doesn't really matter
  //    for soft-delete but keeps things tidy.
  let totalPayments = 0;
  for (const c of safeContracts) {
    const r = await prisma.payment.updateMany({
      where: { contractId: c.id, deletedAt: null },
      data: { deletedAt: now },
    });
    totalPayments += r.count;
  }
  console.log(`  ${totalPayments} payments soft-deleted`);

  // 4. Soft-delete contracts
  if (safeContracts.length > 0) {
    const cr = await prisma.contract.updateMany({
      where: { id: { in: safeContracts.map((c) => c.id) } },
      data: { deletedAt: now },
    });
    console.log(`  ${cr.count} contracts soft-deleted`);
  }

  // 5. Soft-delete customers + scramble unique fields so re-seed can reuse markers/NIDs/phones
  for (const c of safeCustomers) {
    await prisma.customer.update({
      where: { id: c.id },
      data: {
        deletedAt: now,
        legacyMemberCode: null,
        nationalId: `__DELETED_${c.id}`,
        nationalIdHash: null,
        nationalIdEncrypted: null,
        phone: `__DELETED_${c.id}`,
        phoneHash: null,
        phoneEncrypted: null,
      },
    });
  }
  console.log(`  ${safeCustomers.length} customers soft-deleted + unique fields cleared`);

  console.log(`\n✅ Cleanup เสร็จ — re-seed ได้ทันที (idempotency guard ตรวจ deletedAt: null เท่านั้น)\n`);
}

main()
  .catch((err) => {
    console.error('\n❌ Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
