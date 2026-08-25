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
]);

/**
 * คอลัมน์ที่ต้อง **NULL ทิ้งก่อน TRUNCATE** — ไม่งั้น CASCADE ลามมาลบตารางที่เก็บ
 *
 * `ChatRoom.attributionId → AdsAttribution → Contract` คือโซ่ที่อันตรายที่สุดในงานนี้:
 * เก็บ `ads_attributions` ไม่ได้ (มันชี้ต่อไปที่ `contracts` ซึ่งต้องล้าง) แต่ถ้าปล่อยให้
 * `TRUNCATE ads_attributions CASCADE` ทำงาน มันจะลบ `chat_rooms` **และ `chat_messages`
 * (onDelete: Cascade)** ทั้งหมด = ประวัติแชทที่เจ้าของสั่งให้เก็บหายเกลี้ยงแบบเงียบ ๆ
 *
 * คอลัมน์เป็น nullable อยู่แล้ว ⇒ NULL ทิ้งได้โดยไม่เสียห้องแชท เสียแค่สายโยงว่าแชทนี้
 * มาจากโฆษณาตัวไหน ซึ่งผูกอยู่กับ**สัญญาทดสอบ**ที่กำลังจะล้างอยู่แล้ว
 */
export const PRE_TRUNCATE_NULLIFY: ReadonlyArray<{
  table: string;
  column: string;
  why: string;
}> = [
  {
    table: 'chat_rooms',
    column: 'attribution_id',
    why: 'กัน TRUNCATE ads_attributions CASCADE ลบห้องแชท+ข้อความทั้งหมด',
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
  'ads_attributions',  // ชี้ต่อไปที่ contracts — ดู PRE_TRUNCATE_NULLIFY
  'ads_campaigns',  // ลูกค้าของ ads_attributions ที่กำลังล้าง
  'ai_auto_reply_logs',
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
  'imported_sales',
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
