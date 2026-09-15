/**
 * จำแนกทุกตารางเป็น "เก็บ" หรือ "ล้าง" — แหล่งความจริงเดียวของ factory reset
 *
 * ## ทำไมต้องจำแนกครบสองทาง ไม่ใช่ "เก็บรายการสั้น ที่เหลือล้างหมด"
 *
 * รอบแรกเจ้าของสั่งว่าเก็บแค่ **นิติบุคคล + สาขา + ผู้ใช้** — ตอนนั้นการกลับด้าน
 * ("ล้างทุกอย่างที่ไม่อยู่ในรายการ") ปลอดภัย เพราะตารางที่ลืมจำแนก = ถูกล้าง
 * ซึ่งตรงกับเจตนาอยู่แล้ว
 *
 * 2026-08-25 เจ้าของแก้ขอบเขตเป็น **"ล้างเฉพาะข้อมูลที่สร้างขึ้นมาเทส"** —
 * เก็บสาขา/บัญชีผู้ใช้/ดอกเบี้ย/ค่าคอม/งวด/ประวัติแชท/ลูกค้า/สินค้า ⇒ รายการ "เก็บ"
 * โตจาก 3 เป็น ~65 ตาราง และในนั้นมี **11 ตารางที่ seed อยู่ใน migration เท่านั้น
 * ไม่มี seed script ใด ๆ** (`account_role_map`, `payment_method_configs`, `sso_config`,
 * `bank_accounts`, `reverse_reasons`, `notification_templates`, `template_categories`,
 * `supplier_payment_methods` ฯลฯ) — ล้างแล้ว **สร้างกลับไม่ได้**
 *
 * ⇒ ผลของการ "ลืมจำแนก" พลิกจาก *ปลอดภัย* เป็น *สูญหายถาวร* จึงต้องจำแนกครบสองทาง
 *   และให้สคริปต์ **หยุด** เมื่อเจอตารางที่ไม่อยู่ในลิสต์ไหนเลย (ตารางใหม่ที่เพิ่มวันหลัง)
 *   แทนที่จะเดาแล้วล้างทิ้ง
 *
 * ## กติกาแบ่ง
 *
 *   เก็บ = ตั้งค่า · เทมเพลต · ทะเบียนหลัก (ลูกค้า/สินค้า/คู่ค้า/พนักงาน) · ประวัติแชท
 *   ล้าง = รายการเคลื่อนไหว (สัญญา ใบขาย ใบเสร็จ JE ค่าคอม) · log · ของที่คำนวณจากรายการ
 */

/**
 * ตารางที่ **เก็บ** — ไม่ถูกแตะ
 *
 * `_prisma_migrations` ต้องเก็บเสมอ ไม่งั้น `migrate deploy` ครั้งถัดไปจะพยายาม
 * รัน migration ทั้งหมดซ้ำบน schema ที่มีตารางอยู่แล้ว = พังทันที
 */
export const KEEP_TABLES: ReadonlySet<string> = new Set([
  '_prisma_migrations',

  // ── องค์กร / คน ────────────────────────────────────────────────
  'company_info',
  'branches',
  'users',
  'employee_profiles',              // ทะเบียนพนักงาน (เงินเดือน/ปกส./เลขบัญชีโอน) 1-1 กับ users
  'shareholders',                   // ทะเบียนผู้ถือหุ้น บอจ.5 — ใช้ออก ภ.ง.ด.2

  // ── ผังบัญชี / งวด / ช่องทางเงิน ────────────────────────────────
  'chart_of_accounts',
  'account_role_map',               // ⚠️ seed อยู่ใน migration เท่านั้น
  'accounting_periods',             // "งวด" ที่เจ้าของสั่งเก็บ
  'bank_accounts',                  // ⚠️ seed อยู่ใน migration เท่านั้น
  'payment_method_configs',         // ⚠️ seed อยู่ใน migration เท่านั้น — map วิธีชำระ→บัญชี
  'reverse_reasons',                // ⚠️ seed อยู่ใน migration เท่านั้น
  'sso_config',                     // ⚠️ seed อยู่ใน migration เท่านั้น — เพดานสมทบ ปกส.

  // ── ตั้งค่าธุรกิจ (ดอกเบี้ย / ค่าคอม / ราคา) ─────────────────────
  'system_config',
  'interest_configs',               // "ดอกเบี้ย" ที่เจ้าของสั่งเก็บ
  'interest_config_rates',
  'commission_rules',               // "ค่าคอม" ที่เจ้าของสั่งเก็บ
  'pricing_templates',
  'trade_in_valuations',            // ตารางกลางราคารับซื้อมือสอง
  'buyback_questions',
  'buyback_choices',
  'gfin_model_mappings',
  'gfin_overprice_rules',
  'gfin_rate_factors',
  'promotions',                     // นิยามโปรโมชัน (การ "ใช้" อยู่ที่ promotion_usages = ล้าง)
  'reorder_points',

  // ── เทมเพลตเอกสาร / กติกา ──────────────────────────────────────
  'contract_templates',
  'sticker_templates',
  'inspection_templates',
  'inspection_template_items',
  'expense_templates',
  'user_expense_templates',
  'other_income_templates',
  'notification_templates',         // ⚠️ seed อยู่ใน migration เท่านั้น
  'sms_templates',
  'template_categories',            // ⚠️ seed อยู่ใน migration เท่านั้น
  'supplier_payment_methods',       // ⚠️ seed อยู่ใน migration เท่านั้น
  'dunning_rules',

  // ── แชท / บอท ("ประวัติแชท" ที่เจ้าของสั่งเก็บ) ───────────────────
  'chat_rooms',
  'chat_messages',
  'chat_notes',
  'chat_snoozes',
  'chat_side_messages',
  'chat_feedbacks',
  'conversation_tags',
  'staff_chat_activities',
  'chat_knowledge_base',
  'chat_auto_triggers',
  'chat_kb_suggestions',
  'canned_responses',
  'canned_response_bubbles',
  'canned_response_quick_replies',
  'ai_settings',
  'customer_line_links',            // สายเชื่อม LINE↔ลูกค้า — ล้างแล้วแชทหาเจ้าของไม่เจอ

  // ── ทะเบียนลูกค้า (เจ้าของเลือก "เก็บทั้งหมด") ────────────────────
  'customers',
  'customer_tags',
  'contacts',                       // รายชื่อผู้ติดต่อ (party master)
  'pdpa_consents',                  // ความยินยอมจริงของลูกค้าจริง — หลักฐานตามกฎหมาย

  // ── ทะเบียนสินค้า / คู่ค้า (เจ้าของเลือก "เก็บทั้งหมด") ───────────
  'products',
  'product_prices',
  'product_photos',
  'suppliers',
  'external_finance_companies',
  'finance_company_contacts',       // ผู้ติดต่อของบริษัทไฟแนนซ์ภายนอก — ทะเบียน ไม่ใช่ธุรกรรม
  'purchase_orders',                // ที่มาของสินค้าที่เก็บไว้ (Product.poId ชี้มาที่นี่)
  'po_items',
  'inspections',                    // ผลตรวจสภาพเครื่อง (Product.inspectionId ชี้มาที่นี่)
  'inspection_results',

  // ── อื่น ๆ ──────────────────────────────────────────────────────
  'filter_presets',                 // ตัวกรองที่ผู้ใช้บันทึกไว้เอง

  'webhook_subscriptions',          // ปลายทาง webhook + secret

  // ── ประวัติขายที่นำเข้าจากระบบเดิม (Tooltify) ──────────────────────
  // ⚠️ **ไม่ใช่ข้อมูลทดสอบ** — ตรวจบน prod 2026-08-25: 3,403 รายการ ช่วงวันขาย
  // 2026-01-05 ถึง 2026-08-18 นำเข้า 3 batch เมื่อ 2026-08-18 ผ่าน
  // `import-tooltify.cli.ts` (EXTERNAL_FINANCE 1,554 / INSTALLMENT 1,344 / CASH 505)
  // คือประวัติขาย 7 เดือนครึ่งของกิจการจริง ที่เจ้าของสั่งให้ "ดึงจากระบบเดิม"
  // ล้างแล้วต้องนำเข้าใหม่ทั้งหมด · standalone ไม่มี FK ออก จึงเก็บได้ปลอดภัย
  'imported_sales',

  // ── ไม่อยู่ใน schema.prisma แต่มีจริงบน DB ─────────────────────────
  // สร้างโดย migration ตรง ๆ (`CREATE TABLE ... AS SELECT`) ⇒ Prisma มองไม่เห็น
  // แต่ `pg_tables` เห็น — ด่าน "ตารางที่ยังไม่จำแนก" จับได้ตอน DRY_RUN รอบแรก
  // (ดีไซน์เดิมที่ล้างทุกอย่างนอก keep list จะลบตารางสำรองนี้ทิ้งเงียบ ๆ)
  //
  // สำรอง `product_prices` ก่อน dedupe (migration 20260985000000) — เป็นตัว rollback
  // ของตารางที่เก็บไว้ จึงต้องเก็บคู่กัน ไม่งั้นย้อนกลับไม่ได้ถ้า dedupe ผิด
  '_b0_default_price_dedupe_backup',
]);

/**
 * FK ที่ต้อง **ถอด constraint ก่อน TRUNCATE แล้วสร้างกลับ** — ไม่ใช่แค่ NULL ค่า
 *
 * ## บทเรียนที่แลกมาเกือบแพง (2026-08-25)
 *
 * เวอร์ชันแรกของไฟล์นี้มี `PRE_TRUNCATE_NULLIFY` ที่ SET คอลัมน์เป็น NULL ก่อน TRUNCATE
 * ด้วยความเข้าใจว่า "ไม่มีแถวชี้แล้ว CASCADE ก็ลามไม่ได้" — **ผิด**
 *
 * `TRUNCATE ... CASCADE` ของ PostgreSQL ลามตาม **การมีอยู่ของ FK constraint**
 * ไม่ใช่ตามว่ามีแถวชี้จริงหรือไม่ (เอกสาร PostgreSQL: *"Checking validity in such cases
 * would require table scans, and the whole point is not to do one"*)
 *
 * พิสูจน์บน production จริงแล้ว — สองคำสั่งใน `BEGIN ... ROLLBACK`:
 *
 * ```
 * BEGIN; TRUNCATE ads_attributions; ROLLBACK;
 *   ERROR: cannot truncate a table referenced in a foreign key constraint
 *   DETAIL: Table "chat_rooms" references "ads_attributions".
 *
 * BEGIN; UPDATE chat_rooms SET attribution_id=NULL WHERE attribution_id IS NOT NULL;
 *        TRUNCATE ads_attributions; ROLLBACK;
 *   UPDATE 0                    ← เป็น NULL อยู่แล้วทุกแถวตั้งแต่แรก
 *   ERROR: cannot truncate a table referenced in a foreign key constraint   ← error เดิมเป๊ะ
 * ```
 *
 * ⇒ ถ้ารันจริงพร้อม `CASCADE` มันจะลบ `chat_rooms` (7,551) แล้วลามต่อไป `chat_messages`
 * (104,632 แถว, `onDelete: Cascade`) `chat_notes` `chat_snoozes` `chat_side_messages`
 * `chat_feedbacks` `conversation_tags` = **ประวัติแชทที่เจ้าของสั่งให้เก็บ หายทั้งหมด**
 *
 * ร้ายกว่านั้น: guard 3 ใน CLI ยกเว้น FK ที่อยู่ในลิสต์ NULLIFY ⇒ **"ทางแก้" ที่ไม่ทำงาน
 * ไปปิดปากด่านที่ควรหยุดเราก่อนเขียน** เหลือแค่ด่านตรวจหลัง commit = ชันสูตรหลังตาย
 *
 * ## ทางแก้ที่ถูก
 *
 * ถอด FK constraint จริง ๆ ก่อน TRUNCATE แล้วสร้างกลับ **ในทรานแซกชันเดียวกัน**
 * (PostgreSQL ทำ DDL ใน transaction ได้ ⇒ ถ้าล้มกลางทาง constraint กลับมาเองครบ)
 *
 * นิยาม constraint **อ่านสดจาก `pg_get_constraintdef()` ตอนรัน ไม่ hardcode** —
 * สร้างกลับได้ตรงต้นฉบับเสมอแม้ `ON DELETE`/`ON UPDATE` เปลี่ยนวันหลัง
 *
 * ค่าจริงบน prod ณ 2026-08-25 (เอาไว้เทียบ ไม่ได้ใช้ในโค้ด):
 *   `chat_sessions_attribution_id_fkey` บน `chat_rooms`
 *   `FOREIGN KEY (attribution_id) REFERENCES ads_attributions(id)
 *    ON UPDATE CASCADE ON DELETE SET NULL`
 *   (ชื่อยังเป็น `chat_sessions_*` จากยุคที่ตารางชื่อ `chat_sessions`)
 */
export const FK_DROP_RECREATE: ReadonlyArray<{
  table: string;
  column: string;
  why: string;
}> = [
  {
    table: 'chat_rooms',
    column: 'attribution_id',
    why: 'กัน TRUNCATE ads_attributions CASCADE ลบห้องแชท + ข้อความทั้งหมด',
  },
];

/**
 * คืนสถานะสินค้าที่ค้างเพราะใบขาย/สัญญาถูกล้าง
 *
 * เก็บสินค้าไว้แต่ล้างใบขาย ⇒ เครื่องที่เคยขายตอนเทสจะค้างสถานะ `SOLD_*` โดยไม่มี
 * ใบขายอยู่จริง = ขายซ้ำไม่ได้ ทั้งที่ของอยู่บนชั้น
 *
 * ## ทำไมคืนแค่ 3 สถานะ ไม่ใช่บังคับทุกตัวเป็น IN_STOCK
 *
 * `.claude/rules/database.md` ("ประตูเข้า IN_STOCK") กำหนดว่าการเข้า `IN_STOCK`
 * ต้องผ่าน **ด่านยืนยันราคา** เพราะเครื่องมือสองถือราคาเครื่องใหม่ติดตัวมา —
 * การ flip ทุกสถานะเป็น IN_STOCK คือการอ้อมด่านนั้นทั้งคลัง
 *
 * 3 สถานะนี้เป็น **ข้อยกเว้นที่กติกาเขียนรับรองไว้แล้ว** ไม่ใช่ข้อยกเว้นที่คิดขึ้นใหม่:
 *
 *   SOLD_CASH / SOLD_INSTALLMENT — คลาสเดียวกับ `SaleVoidService` (ยกเลิกใบขาย):
 *     ตอนขายบังคับว่าต้องเป็น `IN_STOCK` มาก่อน และไม่มี flow ไหนแตะราคาระหว่างขาย
 *     ⇒ เครื่องกลับมาพร้อมราคาของตัวเอง · การล้างใบขายทั้งหมด = การ void หมู่
 *   RESERVED — กติกาเรียกว่า "benign โดยโครงสร้าง": ต้องเป็น IN_STOCK มีราคาอยู่ก่อน
 *     จึงถูกจองได้ การปลดจองคือคืนสภาพเดิม (`product_reservations` ถูกล้างไปแล้ว)
 *
 * สถานะที่ **ไม่แตะ** และรายงานให้คนตัดสินแทน: `REPOSSESSED` / `REFURBISHED` /
 * `SOLD_RESELL` — เครื่องยึด/เปลี่ยนเครื่องต้อง **ตีราคาใหม่** ก่อนขาย
 * (`markReadyForSale` / ปุ่ม "นำเข้าคลังพร้อมขาย") การ flip ให้เองคือการข้ามด่านราคา
 */
export const PRODUCT_STATUS_RESTORE: ReadonlyArray<string> = [
  'SOLD_CASH',
  'SOLD_INSTALLMENT',
  'RESERVED',
];

/** สถานะที่ปล่อยไว้ + รายงานให้คนตัดสิน (ต้องตีราคาใหม่ก่อนขาย) */
export const PRODUCT_STATUS_REPORT_ONLY: ReadonlyArray<string> = [
  'REPOSSESSED',
  'REFURBISHED',
  'SOLD_RESELL',
];

/**
 * ตารางที่ **ล้าง** — รายการเคลื่อนไหว/log/ของที่คำนวณจากรายการ
 *
 * ระบุครบทุกตัวโดยเจตนา — สคริปต์จะ **หยุด** ถ้าเจอตารางใน DB ที่ไม่อยู่ทั้งใน
 * KEEP_TABLES และ WIPE_TABLES (เช่น model ใหม่ที่เพิ่มหลังเขียนไฟล์นี้)
 * เพื่อบังคับให้มีคนตัดสินใจ แทนที่จะเดาแล้วล้างของที่กู้ไม่ได้ทิ้ง
 */
export const WIPE_TABLES: ReadonlySet<string> = new Set([
  // ── ไม่อยู่ใน schema.prisma แต่มีจริงบน DB (สร้างโดย migration ตรง ๆ) ──
  '_b5_active_hold_dedupe_backup',  // สำรอง product_reservations ก่อน dedupe — ต้นฉบับก็ล้าง
  'quotes',                         // ใบเสนอราคา SP5 (migration 20260940000000) — model ถูกถอด
  'quote_items',                    // ออกจาก schema.prisma แล้ว เหลือแต่ตาราง = schema drift

  'ads_attributions',  // ชี้ต่อไปที่ contracts — ดู FK_DROP_RECREATE
  'ads_campaigns',  // ลูกค้าของ ads_attributions ที่กำลังล้าง
  'ai_auto_reply_logs',
  // คำสั่งเจ้าของ 2026-08-25: "ไม่ลง AI TRAINING" ⇒ ล้าง
  // (94,583 แถวบน prod ทั้งหมดเป็น SYSTEM_EXTRACT สกัดจากแชทที่เก็บไว้ ไม่มีแถวที่
  //  คนนั่งกำกับเอง ⇒ สร้างใหม่ได้ด้วย chat-history-extractor แต่ต้องรัน embedding ใหม่
  //  74,968 แถว — เจ้าของรับทราบและเลือกล้าง)
  'ai_training_pairs',
  'ai_usage_logs',
  'asset_transfer_history',
  'audit_logs',  // TRUNCATE ผ่าน trigger กัน DELETE ได้ (row-level ไม่จุดตอน TRUNCATE)
  'bad_debt_provisions',
  'bad_debt_write_off_audit_logs',  // trigger กัน DELETE เช่นกัน — TRUNCATE ผ่าน
  'booking_items',
  'bookings',
  'bot_detection_logs',
  'branch_receiving_items',
  'branch_receivings',
  'broadcast_approvals',
  'broadcast_messages',
  'call_logs',
  'chatbot_otp_requests',
  'commission_payouts',
  'contract_cancellations',
  'contract_daily_snapshots',
  'contract_documents',
  'contract_exchange_requests',
  'contract_letters',
  'contract_snoozes',
  'contracts',
  'credit_checks',
  'credit_note_details',
  'crm_lead_assignments',
  'crm_lead_stage_history',
  'crm_leads',  // FK ไป contracts
  'crm_notes',
  'customer_access_tokens',
  'customer_journey_entries',  // log การเดินทาง (Plan 2) — อ้างสัญญา/ใบขายที่ถูกล้างไปพร้อมกัน
  'customer_journey_states',   // แคชสรุป คำนวณใหม่ได้จาก journey-state.sql
  'customer_scores',
  'daily_assignments',
  'data_audit_logs',
  'depreciation_entries',
  'document_audit_logs',
  'dsar_requests',
  'dunning_actions',
  'e_documents',
  'equity_attachments',
  'equity_documents',
  'equity_shareholder_lines',
  'etax_submissions',
  'expense_adjustments',
  'expense_details',
  'expense_documents',
  'expense_lines',
  'external_finance_commissions',
  'fee_waiver_approvals',
  'finance_receivable_contact_logs',
  'finance_receivables',
  'fixed_assets',
  'goods_receiving_items',
  'goods_receivings',  // ใบรับของ — ชี้ไป purchase_orders ที่เก็บไว้ ล้างได้ไม่ลาม
  'installment_schedules',
  'inter_co_settlement_batches',
  'inter_co_settlement_items',  // FK Restrict ทั้งสองขา — ต้องล้างพร้อม batches
  'inter_company_transactions',
  'invite_tokens',
  'ip_rate_limits',
  'journal_entries',
  'journal_lines',
  'journal_post_audit_logs',
  'known_devices',
  'kyc_verifications',  // FK บังคับไป contracts — เก็บไม่ได้แม้อยากเก็บ
  'late_fee_waiver_requests',
  'legal_case_documents',
  'legal_cases',
  'login_audit_logs',
  'loyalty_points',  // FK บังคับไป payments
  'loyalty_redemptions',
  'mdm_lock_requests',
  'notification_logs',
  'offsite_backup_runs',
  'online_installment_applications',
  'online_orders',
  'other_income_adjustments',
  'other_income_attachments',
  'other_income_items',
  'other_incomes',
  'outbox_events',
  'partial_payment_links',
  'password_reset_tokens',
  'payment_drafts',
  'payment_evidences',
  'payment_links',
  'payments',
  'payroll_custom_deduction',
  'payroll_custom_income',
  'payroll_details',
  'payroll_lines',
  'pdpa_backfill_runs',
  'processed_webhook_events',
  'product_reservations',
  'promise_slots',
  'promotion_usages',  // การ "ใช้" โปรโมชัน — ตัวนิยาม (promotions) เก็บไว้
  'receipts',
  'receivable_recon_logs',
  'refresh_tokens',  // ล้างแล้วทุกคนต้องล็อกอินใหม่ (ตั้งใจ)
  'refunds',
  'repair_status_logs',
  'repair_tickets',
  'repossessions',
  'reviews',
  'sales',
  'sales_commissions',
  'saving_plan_payments',
  'saving_plans',
  'settlement_lines',
  'signatures',
  'slip_fingerprints',
  'stock_adjustments',
  'stock_alerts',
  'stock_count_items',
  'stock_counts',
  'stock_transfers',
  'tax_reports',
  'todo_comments',
  'todos',
  'trade_ins',
  'vendor_settlement_details',
  'warranty_audit_logs',
  'webhook_anomalies',
  'webhook_deliveries',
  'website_sessions',
  'website_visits',
]);

/**
 * ตารางในฝั่ง **ล้าง** ที่ถือหลักฐานซึ่งประกอบกลับจากที่อื่นไม่ได้
 *
 * ถ้าตารางกลุ่มนี้ **มีข้อมูล** สคริปต์จะ **หยุด** และบังคับให้มนุษย์ตัดสินใจ
 * (ข้ามได้ด้วย `ACK_IRREPLACEABLE=<ชื่อตาราง,คั่นด้วยจุลภาค>`)
 *
 * ## ที่มา — audit 2026-08-25 (finding ระดับ HIGH)
 *
 * `saving_plans` / `saving_plan_payments` คือ **หลักฐานเดียว**ของเงินที่ลูกค้าจ่ายเข้ามา
 * จริงผ่าน QR PromptPay: `paysolutions-confirmation.service.ts` ทั้งทรานแซกชันมีแค่
 * `savingPlanPayment.create` + `savingPlan.update({ totalSaved })` — **ไม่มี `Payment`
 * ไม่มี `JournalEntry` ไม่มี `Receipt`** ⇒ ล้างแล้วไม่เหลืออะไรให้ประกอบกลับเลย
 * ต่างจากธุรกรรมอื่นทุกตัวที่มีคู่ในสมุดบัญชี
 *
 * ณ 2026-08-25 บน prod ทั้งสองตารางเป็น **0 แถว** ⇒ รอบนี้ด่านนี้เป็น no-op
 * แต่ถ้าวันหน้ามีลูกค้าใช้แผนออมจริงแล้วมีคนรันสคริปต์นี้ซ้ำ ด่านนี้จะหยุดให้
 *
 * FK closure เอื้อให้ย้ายไปฝั่งเก็บได้ทันทีถ้าตัดสินใจแบบนั้น (ตรวจแล้ว: ปลายทางทุกตัว
 * — `customers` `products` — อยู่ฝั่งเก็บ และ `payment_links` ที่ชี้มาเป็น**ลูก**
 * จึงลามย้อนขึ้นไม่ได้)
 */
export const IRREPLACEABLE_IF_NONEMPTY: ReadonlyArray<{ table: string; why: string }> = [
  {
    table: 'saving_plans',
    why: 'ยอดเงินออมของลูกค้า — ไม่มีคู่ในสมุดบัญชี ล้างแล้วประกอบกลับไม่ได้',
  },
  {
    table: 'saving_plan_payments',
    why: 'รายการรับเงินออมจริงผ่าน QR — ไม่มี Payment/JE/ใบเสร็จคู่กัน',
  },
];
