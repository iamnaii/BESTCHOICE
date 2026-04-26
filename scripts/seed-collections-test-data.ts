/**
 * Seed Collections Test Data — สร้างลูกค้าทดสอบ + สัญญา + การชำระเงิน
 * เพื่อทดสอบหน้า /collections บน production
 *
 * ใช้:
 *   # Dry-run (แสดงสิ่งที่จะสร้าง ไม่บันทึก DB)
 *   npx tsx scripts/seed-collections-test-data.ts
 *
 *   # Commit จริง (เขียน DB)
 *   npx tsx scripts/seed-collections-test-data.ts --commit
 *
 *   # ระบุ branch (default: branch แรกที่ไม่ใช่ warehouse)
 *   BRANCH_ID=<id> npx tsx scripts/seed-collections-test-data.ts --commit
 *
 * ต้องมี env: DATABASE_URL, PII_ENCRYPTION_KEY (32+ chars), PII_HASH_SALT (32+ chars)
 *
 * Markers (สำหรับ cleanup):
 *   - Customer.legacyMemberCode = `__SEED_2026_04_25__-N` (N = 1..20)
 *   - Contract.notes = `__SEED_2026_04_25__`
 *   ใช้ scripts/cleanup-collections-test-data.ts ลบทิ้ง
 *
 * จะสร้าง:
 *   - 20 Test Customers (name prefix "[TEST] ", phone "099-99-XXXXX", NID "9999XXXXXXXXX")
 *   - 20 Contracts ACTIVE/OVERDUE (1 ต่อ 1 customer) — ใช้ existing product (ไม่สร้างใหม่)
 *   - ~240 Payments (12 งวด × 20) — กระจายอายุหนี้ 5 buckets
 *
 * ⚠️ One-off — ห้ามรันซ้ำ. มี idempotency guard เช็ค marker ก่อน
 * ⚠️ ทดสอบ end-to-end ได้บน prod เท่านั้น — dev DB อาจขาด migration บางตัว
 *    ให้รัน dry-run บน dev เพื่อตรวจ lookups แล้วรัน --commit บน prod
 */
import { PrismaClient, Prisma, type ContractStatus, type PaymentStatus } from '@prisma/client';
import { encryptPII } from '../apps/api/src/utils/crypto.util';
import { hashPII } from '../apps/api/src/utils/pii.util';

const MARKER = '__SEED_2026_04_25__';
const NAME_PREFIX = '[TEST] ';
const NID_PREFIX = '9999'; // Real Thai NIDs start with 1-8
const PHONE_PREFIX = '09999'; // 099-99-XXXXX is rare/unused

const KEY = process.env.PII_ENCRYPTION_KEY || '';
const SALT = process.env.PII_HASH_SALT || '';
const COMMIT = process.argv.includes('--commit');

const prisma = new PrismaClient();

/** Disconnect Prisma then exit with code 1. Ensures connection is closed on early-exit. */
async function bail(msg: string): Promise<never> {
  console.error(msg);
  await prisma.$disconnect();
  process.exit(1);
}

const FAKE_PEOPLE: Array<{ prefix: string; first: string; last: string; nickname: string; salary: number; occupation: string }> = [
  { prefix: 'นาย', first: 'ทดสอบหนึ่ง', last: 'นามสมมติ', nickname: 'หนึ่ง', salary: 18000, occupation: 'พนักงานบริษัท' },
  { prefix: 'นางสาว', first: 'ทดสอบสอง', last: 'นามสมมติ', nickname: 'สอง', salary: 22000, occupation: 'รับจ้างทั่วไป' },
  { prefix: 'นาย', first: 'ทดสอบสาม', last: 'นามสมมติ', nickname: 'สาม', salary: 16000, occupation: 'ค้าขาย' },
  { prefix: 'นางสาว', first: 'ทดสอบสี่', last: 'นามสมมติ', nickname: 'สี่', salary: 25000, occupation: 'พนักงานโรงงาน' },
  { prefix: 'นาย', first: 'ทดสอบห้า', last: 'นามสมมติ', nickname: 'ห้า', salary: 20000, occupation: 'ขับรถส่งของ' },
  { prefix: 'นางสาว', first: 'ทดสอบหก', last: 'นามสมมติ', nickname: 'หก', salary: 17000, occupation: 'พนักงานบริษัท' },
  { prefix: 'นาย', first: 'ทดสอบเจ็ด', last: 'นามสมมติ', nickname: 'เจ็ด', salary: 19000, occupation: 'ช่างซ่อม' },
  { prefix: 'นางสาว', first: 'ทดสอบแปด', last: 'นามสมมติ', nickname: 'แปด', salary: 23000, occupation: 'พนักงานบริษัท' },
  { prefix: 'นาย', first: 'ทดสอบเก้า', last: 'นามสมมติ', nickname: 'เก้า', salary: 21000, occupation: 'รับจ้างทั่วไป' },
  { prefix: 'นางสาว', first: 'ทดสอบสิบ', last: 'นามสมมติ', nickname: 'สิบ', salary: 24000, occupation: 'ค้าขาย' },
  { prefix: 'นาย', first: 'ทดสอบสิบเอ็ด', last: 'นามสมมติ', nickname: 'เอ็ด', salary: 18500, occupation: 'พนักงานโรงงาน' },
  { prefix: 'นางสาว', first: 'ทดสอบสิบสอง', last: 'นามสมมติ', nickname: 'สอบ', salary: 22500, occupation: 'พนักงานบริษัท' },
  { prefix: 'นาย', first: 'ทดสอบสิบสาม', last: 'นามสมมติ', nickname: 'สาม-สาม', salary: 16500, occupation: 'ขับรถส่งของ' },
  { prefix: 'นางสาว', first: 'ทดสอบสิบสี่', last: 'นามสมมติ', nickname: 'สี่-สี่', salary: 25500, occupation: 'พนักงานบริษัท' },
  { prefix: 'นาย', first: 'ทดสอบสิบห้า', last: 'นามสมมติ', nickname: 'ห้า-ห้า', salary: 20500, occupation: 'รับจ้างทั่วไป' },
  { prefix: 'นางสาว', first: 'ทดสอบสิบหก', last: 'นามสมมติ', nickname: 'หก-หก', salary: 17500, occupation: 'ค้าขาย' },
  { prefix: 'นาย', first: 'ทดสอบสิบเจ็ด', last: 'นามสมมติ', nickname: 'เจ็ด-เจ็ด', salary: 19500, occupation: 'ช่างซ่อม' },
  { prefix: 'นางสาว', first: 'ทดสอบสิบแปด', last: 'นามสมมติ', nickname: 'แปด-แปด', salary: 23500, occupation: 'พนักงานบริษัท' },
  { prefix: 'นาย', first: 'ทดสอบสิบเก้า', last: 'นามสมมติ', nickname: 'เก้า-เก้า', salary: 21500, occupation: 'พนักงานโรงงาน' },
  { prefix: 'นางสาว', first: 'ทดสอบยี่สิบ', last: 'นามสมมติ', nickname: 'ยี่สิบ', salary: 24500, occupation: 'พนักงานบริษัท' },
];

interface OverdueBucket {
  label: string;
  daysOverdue: number;
  paidInstallments: number;
  contractStatus: ContractStatus;
}

const OVERDUE_BUCKETS: OverdueBucket[] = [
  { label: 'current', daysOverdue: 0,   paidInstallments: 3, contractStatus: 'ACTIVE' },
  { label: '1-30',    daysOverdue: 15,  paidInstallments: 2, contractStatus: 'OVERDUE' },
  { label: '31-60',   daysOverdue: 45,  paidInstallments: 2, contractStatus: 'OVERDUE' },
  { label: '61-90',   daysOverdue: 75,  paidInstallments: 1, contractStatus: 'OVERDUE' },
  { label: '90+',     daysOverdue: 120, paidInstallments: 1, contractStatus: 'OVERDUE' },
];

const fakeNationalId = (idx: number) => `${NID_PREFIX}${String(idx).padStart(9, '0')}`;
const fakePhone = (idx: number) => `${PHONE_PREFIX}${String(idx).padStart(5, '0')}`;
function generateContractNumber(idx: number): string {
  const now = new Date();
  const yymm = `${String(now.getFullYear() + 543).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `BC-TEST-${yymm}-${String(idx).padStart(5, '0')}`;
}

async function main() {
  console.log(`\n=== Seed Collections Test Data ===`);
  console.log(`Mode: ${COMMIT ? '🔥 COMMIT' : '🧪 DRY-RUN'}`);
  console.log(`Marker: ${MARKER}\n`);

  // Dev path: PII keys missing → skip encryption (mirrors customers.service.ts behavior).
  // Prod path: keys must be ≥32 chars (validated by encryptPII / hashPII themselves).
  const hasEncryption = !!KEY && KEY.length >= 32 && !!SALT && SALT.length >= 32;
  if (COMMIT) {
    if (!hasEncryption && (KEY || SALT)) {
      await bail('❌ PII_ENCRYPTION_KEY และ PII_HASH_SALT ต้องตั้งทั้งคู่ และยาว ≥32 ตัวอักษร');
    }
    if (!hasEncryption) {
      console.log('⚠️  ไม่มี PII keys — จะ seed แบบ dev (ไม่ encrypt) — อย่ารันแบบนี้บน prod');
    }
  }

  // 1. Pick branch
  const requestedBranchId = process.env.BRANCH_ID;
  const branch = requestedBranchId
    ? await prisma.branch.findFirst({ where: { id: requestedBranchId, deletedAt: null } })
    : await prisma.branch.findFirst({
        where: { deletedAt: null, isMainWarehouse: false },
        orderBy: { createdAt: 'asc' },
      });
  if (!branch) {
    await bail('❌ ไม่พบ branch — ระบุ BRANCH_ID หรือเช็คว่ามี non-warehouse branch ใน DB');
  }
  console.log(`📍 Branch: ${branch.id} — ${branch.name}`);

  // 2. Pick salesperson
  const salesperson =
    (await prisma.user.findFirst({ where: { branchId: branch.id, role: 'SALES', deletedAt: null } })) ||
    (await prisma.user.findFirst({ where: { role: 'SALES', deletedAt: null } })) ||
    (await prisma.user.findFirst({ where: { role: 'OWNER' } }));
  if (!salesperson) {
    await bail('❌ ไม่พบ user สำหรับเป็น salesperson');
  }
  console.log(`👤 Salesperson: ${salesperson.id} — ${salesperson.name} (${salesperson.role})`);

  // 3. Pick existing product (don't create — keep cleanup simple).
  //    Script reuses the same product for all 20 contracts to avoid SKU pollution.
  //    If this product is later deleted, contracts remain valid (FK is to productId which allows soft-deleted products).
  const product =
    (await prisma.product.findFirst({ where: { branchId: branch.id, deletedAt: null }, orderBy: { createdAt: 'asc' } })) ||
    (await prisma.product.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }));
  if (!product) {
    await bail('❌ ไม่พบ Product ใน DB — ต้องมี product อย่างน้อย 1 ตัว');
  }
  console.log(`📦 Product: ${product.id} — ${product.brand} ${product.model}`);

  // 4. Idempotency guard (active rows only — soft-deleted re-runs are fine)
  const existing = await prisma.customer.count({
    where: { legacyMemberCode: { startsWith: MARKER }, deletedAt: null },
  });
  if (existing > 0) {
    await bail(
      `\n❌ พบ ${existing} customer ที่มี marker เดียวกันแล้ว — รัน cleanup ก่อน:\n` +
      `   npx tsx scripts/cleanup-collections-test-data.ts --commit`,
    );
  }

  console.log(`\n📋 Plan: 20 customers + 20 contracts + 240 payments (12 งวด × 20 สัญญา)`);
  console.log(`   Aging: 4 current + 4×(1-30d) + 4×(31-60d) + 4×(61-90d) + 4×(90+d)`);

  if (!COMMIT) {
    console.log(`\n✋ Dry-run — เพิ่ม --commit เพื่อเขียน DB จริง\n`);
    return;
  }

  // 5. Create — each customer+contract+payments in a single transaction so a mid-loop
  //    crash doesn't leave orphan contracts without payments.
  let cIdx = 0;
  for (let bucketIdx = 0; bucketIdx < OVERDUE_BUCKETS.length; bucketIdx++) {
    const bucket = OVERDUE_BUCKETS[bucketIdx];
    for (let inBucket = 0; inBucket < 4; inBucket++) {
      cIdx++;
      const person = FAKE_PEOPLE[cIdx - 1];
      const nid = fakeNationalId(cIdx);
      const phone = fakePhone(cIdx);
      const fullName = `${NAME_PREFIX}${person.first} ${person.last}`;

      // Contract financials — 12-month plan, 8% flat interest
      const sellingPrice = new Prisma.Decimal(15000);
      const downPayment = new Prisma.Decimal(3000);
      const financedAmount = new Prisma.Decimal(12000);
      const interestRate = new Prisma.Decimal('0.0800');
      const totalMonths = 12;
      const interestTotal = financedAmount.mul(interestRate); // 960
      const totalDue = financedAmount.add(interestTotal);    // 12960
      const monthlyPayment = totalDue.div(totalMonths).toDecimalPlaces(2); // 1080

      // Backdate contract creation so payments land in the right aging bucket.
      // Uses 30-day months — close enough for test data.
      const monthsBack = bucket.paidInstallments + (bucket.daysOverdue > 0 ? 1 : 0);
      const contractCreatedAt = new Date(Date.now() - (monthsBack * 30 + bucket.daysOverdue) * 86400000);

      const { customer, contract } = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            nationalId: nid,
            nationalIdEncrypted: hasEncryption ? encryptPII(nid, KEY) : null,
            nationalIdHash: hasEncryption ? hashPII(nid, SALT) : null,
            phone,
            phoneEncrypted: hasEncryption ? encryptPII(phone, KEY) : null,
            phoneHash: hasEncryption ? hashPII(phone, SALT) : null,
            prefix: person.prefix,
            name: fullName,
            nickname: person.nickname,
            occupation: person.occupation,
            salary: new Prisma.Decimal(person.salary),
            creditCheckStatus: 'FULL_CHECK_PASSED',
            status: 'ACTIVE',
            legacyMemberCode: `${MARKER}-${cIdx}`, // marker ผ่าน unique field
          },
        });

        const contract = await tx.contract.create({
          data: {
            contractNumber: generateContractNumber(cIdx),
            customerId: customer.id,
            productId: product.id,
            branchId: branch.id,
            salespersonId: salesperson.id,
            planType: 'STORE_WITH_INTEREST',
            sellingPrice,
            downPayment,
            interestRate,
            totalMonths,
            interestTotal,
            financedAmount,
            monthlyPayment,
            status: bucket.contractStatus,
            paymentDueDay: 5,
            workflowStatus: 'APPROVED',
            createdAt: contractCreatedAt,
            notes: MARKER,
          },
        });

        const payments: Prisma.PaymentCreateManyInput[] = [];
        for (let i = 1; i <= totalMonths; i++) {
          const dueDate = new Date(contractCreatedAt.getTime() + i * 30 * 86400000);
          let status: PaymentStatus = 'PENDING';
          let amountPaid = new Prisma.Decimal(0);
          let paidAt: Date | null = null;

          if (i <= bucket.paidInstallments) {
            status = 'PAID';
            amountPaid = monthlyPayment;
            paidAt = new Date(dueDate.getTime() - 2 * 86400000);
          } else if (i === bucket.paidInstallments + 1 && bucket.daysOverdue > 0) {
            status = 'OVERDUE';
          }

          payments.push({
            contractId: contract.id,
            installmentNo: i,
            dueDate,
            amountDue: monthlyPayment,
            amountPaid,
            paidAt,
            status,
          });
        }
        await tx.payment.createMany({ data: payments });

        return { customer, contract };
      });

      console.log(
        `  [${bucket.label.padEnd(7)}] ${customer.id.slice(0, 8)}.. ${fullName.padEnd(40)} ${contract.contractNumber} → ${bucket.paidInstallments}/${totalMonths} paid${bucket.daysOverdue > 0 ? `, ${bucket.daysOverdue}d overdue` : ''}`,
      );
    }
  }

  console.log(`\n✅ เสร็จ — ${cIdx} customer + ${cIdx} contract + ${cIdx * 12} payments`);
  console.log(`\n🔍 ตรวจที่: /collections — กรองสาขา "${branch.name}"`);
  console.log(`🧹 Cleanup: npx tsx scripts/cleanup-collections-test-data.ts --commit\n`);
}

main()
  .catch((err) => {
    console.error('\n❌ Failed:', err);
    process.exitCode = 1; // set exit code without skipping .finally()
  })
  .finally(() => prisma.$disconnect());
