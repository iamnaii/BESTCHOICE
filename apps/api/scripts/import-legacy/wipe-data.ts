/**
 * Wipe customer-related data only
 *
 * Usage:
 *   npx tsx scripts/import-legacy/wipe-data.ts                   # dry-run
 *   npx tsx scripts/import-legacy/wipe-data.ts --confirm-wipe    # ลบจริง
 *
 * Scope: ลบเฉพาะข้อมูลที่เกี่ยวกับลูกค้า
 *   - customers (รายชื่อลูกค้า)
 *   - contracts (สัญญา) + payments + receipts + ฯลฯ ที่ผูกกับ contract
 *   - sales (POS sales ที่มี customer)
 *   - credit_checks, kyc_verifications, pdpa_consents
 *   - loyalty_*, trade_ins, promotion_usages
 *   - call_logs, customer_access_tokens
 *
 * Keep ALL of:
 *   - companies, branches, users
 *   - products (รวม legacy + ที่ test สร้างไว้)
 *   - suppliers, purchase_orders, stock_*
 *   - chart_of_accounts, journal_entries (รายการบัญชี)
 *   - templates (contract, sticker, pricing, inspection)
 *   - system_configs, interest_configs
 *   - todos
 *
 * ⚠️ Production: ต้องมี backup ก่อนรัน
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const dryRun = !process.argv.includes('--confirm-wipe');

// ลำดับสำคัญ: ลบ child ก่อน parent
// Customer-linked tables only
const WIPE_ORDER = [
  // ── Documents/audit attached to contract ──
  'documentAuditLog',
  'paymentEvidence',
  'paymentLink',
  'receipt',
  'signature',
  'eDocument',
  'contractDocument',
  // ── Loyalty / commission attached to payments/contracts ──
  'loyaltyRedemption',
  'loyaltyPoint',
  'salesCommission',
  'badDebtProvision',
  'interCompanyTransaction',
  // ── Repossession (attached to contract) ──
  'repossession',
  // ── Customer-related verifications ──
  'kycVerification',
  'creditCheck',
  'pDPAConsent',
  'dSARRequest',
  'customerAccessToken',
  // ── Promotion usage / trade-in (linked to customer) ──
  'promotionUsage',
  'tradeIn',
  // ── Call logs (linked to contract/customer) ──
  'callLog',
  // ── Core ──
  'payment',
  'sale',
  'contract',
  'customer',
];

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Wipe Customer-Related Data');
  console.log('═══════════════════════════════════════════════');
  console.log(`Mode: ${dryRun ? '🟡 DRY-RUN' : '🔴 LIVE WIPE'}\n`);

  // What's kept
  const [companies, users, branches, products, suppliers, journals] = await Promise.all([
    p.companyInfo.count(),
    p.user.count(),
    p.branch.count(),
    p.product.count(),
    p.supplier.count(),
    p.journalEntry.count(),
  ]);
  console.log('─── Keeping (NOT touched) ───');
  console.log(`  CompanyInfo:   ${companies}`);
  console.log(`  User:          ${users}`);
  console.log(`  Branch:        ${branches}`);
  console.log(`  Product:       ${products}`);
  console.log(`  Supplier:      ${suppliers}`);
  console.log(`  JournalEntry:  ${journals}`);
  console.log(`  + chart_of_accounts, templates, configs, todos, stock_*\n`);

  console.log('─── Will be wiped ───');
  let totalRows = 0;
  for (const model of WIPE_ORDER) {
    try {
      const count = await (p as any)[model].count();
      if (count > 0) {
        console.log(`  ${model.padEnd(28)} ${count}`);
        totalRows += count;
      }
    } catch (e: any) {
      console.log(`  ${model.padEnd(28)} [skip: ${e.code || 'no model'}]`);
    }
  }
  console.log(`  ${'TOTAL'.padEnd(28)} ${totalRows}\n`);

  if (dryRun) {
    console.log('🟡 Dry-run mode. To actually wipe, add --confirm-wipe');
    await p.$disconnect();
    return;
  }

  console.log('🔴 Wiping in 3 seconds... (Ctrl+C to abort)');
  await new Promise((r) => setTimeout(r, 3000));

  console.log('\n─── Deleting ───');
  let deleted = 0;
  for (const model of WIPE_ORDER) {
    try {
      const result = await (p as any)[model].deleteMany();
      if (result.count > 0) {
        console.log(`  ${model.padEnd(28)} ${result.count} deleted`);
        deleted += result.count;
      }
    } catch (e: any) {
      console.log(`  ${model.padEnd(28)} [error: ${(e.message || '').substring(0, 80)}]`);
    }
  }

  console.log(`\n✅ Total deleted: ${deleted} rows`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error('💥 FATAL:', e);
  process.exit(1);
});
