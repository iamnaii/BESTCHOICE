/**
 * Production Seed Script — safe to run on production database.
 *
 * Seeds ONLY master data (idempotent — uses upsert):
 *   1. CompanyInfo (SHOP + FINANCE)
 *   2. SystemConfig (business settings)
 *   3. Chart of Accounts
 *   4. Trade-in valuation tables
 *   5. Knowledge base (chatbot FAQ)
 *   6. Collections foundation (SYSTEM user, event-triggered dunning rules, MDM/letter configs)
 *      — event rules are created with isActive=false on first deploy so LINE
 *        auto-send stays off until OWNER toggles them on via /settings/dunning
 *
 * Does NOT create: branches, users (except SYSTEM), customers, suppliers, products, contracts, payments
 * Branches and staff users should be created via the app UI by the owner.
 *
 * Usage:
 *   npx tsx apps/api/prisma/seed-production.ts
 *
 * Safe to re-run — all operations are upsert/createMany with skipDuplicates.
 * Re-running does NOT overwrite OWNER's manual isActive toggles on event rules.
 */
import { PrismaClient } from '@prisma/client';
import { seedChartOfAccounts } from './seeds/chart-of-accounts';
import { seedTradeInValuations } from './seeds/trade-in-valuations';
import { seedKnowledgeBase } from './seeds/knowledge-base';
import { seedCollectionsFoundation } from './seeds/collections-foundation.seed';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Production Seed: Master Data Only ===');
  console.log('Environment:', process.env.NODE_ENV || 'not set');

  // ============================================================
  // STEP 1: CompanyInfo (upsert)
  // ============================================================
  console.log('\n[1/6] CompanyInfo...');

  await prisma.companyInfo.upsert({
    where: { id: 'company-shop' },
    update: {},
    create: {
      id: 'company-shop',
      nameTh: 'เบสท์ชอยส์ ช็อป',
      nameEn: 'BESTCHOICE Shop',
      companyCode: 'SHOP',
      taxId: '0105566012345',
      address: '99 ถ.วิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900',
      phone: '02-100-0000',
      directorName: 'สุรชัย เจ้าของร้าน',
      directorPosition: 'กรรมการผู้จัดการ',
      directorNationalId: '1100100100000',
      directorAddress: '99 ถ.วิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900',
      vatRegistered: false,
      bankName: 'ธนาคารกสิกรไทย',
      bankAccountName: 'บจ. เบสท์ชอยส์ ช็อป',
      bankAccountNumber: '012-3-45678-9',
    },
  });

  await prisma.companyInfo.upsert({
    where: { id: 'company-finance' },
    update: {},
    create: {
      id: 'company-finance',
      nameTh: 'เบสท์ชอยส์ ไฟแนนซ์',
      nameEn: 'BESTCHOICE Finance',
      companyCode: 'FINANCE',
      taxId: '0105566012346',
      address: '99 ถ.วิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900',
      phone: '02-100-0001',
      directorName: 'สุรชัย เจ้าของร้าน',
      directorPosition: 'กรรมการผู้จัดการ',
      directorNationalId: '1100100100000',
      directorAddress: '99 ถ.วิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900',
      vatRegistered: true,
      vatRate: 0.07,
      bankName: 'ธนาคารกรุงเทพ',
      bankAccountName: 'บจ. เบสท์ชอยส์ ไฟแนนซ์',
      bankAccountNumber: '098-7-65432-1',
    },
  });

  console.log('  ✅ CompanyInfo: 2 (SHOP + FINANCE)');

  // ============================================================
  // STEP 2: SystemConfig (upsert by key)
  // ============================================================
  console.log('[2/6] SystemConfig...');

  const configs = [
    { key: 'company_name', value: 'BEST CHOICE Mobile', label: 'ชื่อบริษัท' },
    { key: 'company_phone', value: '02-100-0000', label: 'เบอร์โทรบริษัท' },
    { key: 'late_fee_per_day', value: '50', label: 'ค่าปรับล่าช้า/วัน (บาท)' },
    { key: 'max_late_fee', value: '500', label: 'ค่าปรับล่าช้าสูงสุด (บาท)' },
    { key: 'default_interest_rate', value: '0.08', label: 'อัตราดอกเบี้ยเริ่มต้น' },
    { key: 'min_down_payment_pct', value: '0.20', label: 'เปอร์เซ็นต์เงินดาวน์ขั้นต่ำ' },
    { key: 'max_installment_months', value: '12', label: 'จำนวนงวดสูงสุด' },
    { key: 'contract_number_prefix', value: 'BCP', label: 'Prefix เลขสัญญา' },
    { key: 'receipt_number_prefix', value: 'RCP', label: 'Prefix เลขใบเสร็จ' },
    { key: 'po_number_prefix', value: 'PO', label: 'Prefix เลข PO' },
    { key: 'sale_number_prefix', value: 'SL', label: 'Prefix เลขขาย' },
    { key: 'overdue_notification_days', value: '3', label: 'แจ้งเตือนก่อนครบกำหนด (วัน)' },
    { key: 'default_threshold_days', value: '90', label: 'จำนวนวันก่อนเปลี่ยนสถานะผิดนัด' },
    { key: 'notification_line_enabled', value: 'true', label: 'เปิดแจ้งเตือน LINE' },
    { key: 'notification_sms_enabled', value: 'false', label: 'เปิดแจ้งเตือน SMS' },
    { key: 'line_channel_access_token', value: '', label: 'LINE Channel Access Token' },
    { key: 'line_channel_secret', value: '', label: 'LINE Channel Secret' },
    { key: 'promptpay_id', value: '', label: 'PromptPay ID' },
    {
      key: 'line_oa_welcome_message',
      value: 'ยินดีต้อนรับสู่ BESTCHOICE Mobile! พิมพ์เลขสัญญาเพื่อตรวจสอบยอดชำระ',
      label: 'ข้อความต้อนรับ LINE OA',
    },
    {
      key: 'line_oa_payment_reminder_template',
      value:
        'แจ้งเตือน: สัญญา {contractNo} ครบกำหนดชำระงวดที่ {installment} จำนวน {amount} บาท ภายในวันที่ {dueDate}',
      label: 'เทมเพลตแจ้งเตือนชำระเงิน LINE OA',
    },
    {
      key: 'line_oa_overdue_template',
      value:
        'แจ้งเตือน: สัญญา {contractNo} เลยกำหนดชำระ {overdueDays} วัน กรุณาชำระโดยเร็ว',
      label: 'เทมเพลตแจ้งเตือนค้างชำระ LINE OA',
    },
    {
      key: 'bad_debt_provision_rates',
      value: JSON.stringify({
        '1-30': 0.02,
        '31-60': 0.1,
        '61-90': 0.25,
        '91-180': 0.5,
        '181-360': 0.75,
        '360+': 1.0,
      }),
      label: 'อัตราค่าเผื่อหนี้สงสัยจะสูญ ตามอายุหนี้',
    },
  ];

  for (const c of configs) {
    await prisma.systemConfig.upsert({
      where: { key: c.key },
      update: {}, // don't overwrite existing values
      create: c,
    });
  }

  console.log(`  ✅ SystemConfig: ${configs.length} keys`);

  // NOTE: Branches are NOT seeded here.
  // Owner creates branches via /branches in the app with real data.

  // ============================================================
  // STEP 3: Chart of Accounts (upsert by code — idempotent)
  // ============================================================
  console.log('[3/6] Chart of Accounts...');
  await seedChartOfAccounts(prisma);
  console.log('  ✅ Chart of Accounts seeded');

  // ============================================================
  // STEP 4: Trade-in Valuations (upsert — idempotent)
  // ============================================================
  console.log('[4/6] Trade-in Valuations...');
  await seedTradeInValuations(prisma);
  console.log('  ✅ Trade-in Valuations seeded');

  // ============================================================
  // STEP 5: Knowledge Base (upsert — idempotent)
  // ============================================================
  console.log('[5/6] Knowledge Base...');
  await seedKnowledgeBase(prisma);
  console.log('  ✅ Knowledge Base seeded');

  // ============================================================
  // STEP 6: Collections foundation (SYSTEM user + event rules OFF by default + configs)
  // ============================================================
  console.log('[6/6] Collections foundation...');
  await seedCollectionsFoundation(prisma, { eventRulesActive: false });
  console.log('  ✅ Collections foundation seeded (event rules inactive — toggle via /settings/dunning)');

  // ============================================================
  console.log('\n=== Production Seed COMPLETED ===');
  console.log('Master data ready. Create user accounts via /users in the app.');
}

main()
  .catch((err) => {
    console.error('❌ Production seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
