/**
 * นโยบายว่า role `mcp_ro` มองเห็นคอลัมน์ไหนได้บ้าง
 *
 * หลักการที่ไม่ต่อรอง — มาจากผลตรวจที่พิสูจน์บน PostgreSQL 16.13 จริง:
 *
 *   ห้าม `GRANT SELECT ON <table>` (ทั้งตาราง) เด็ดขาด
 *   เพราะ ACL ระดับตารางครอบคอลัมน์ที่ migration เพิ่มทีหลัง "อัตโนมัติ" = fail-OPEN
 *   ต้อง grant ระดับคอลัมน์เสมอ คอลัมน์ใหม่จึงไม่มีสิทธิ์โดยปริยาย = fail-CLOSED
 *
 * ผลข้างเคียงที่ยอมรับ: หลัง migration ที่เพิ่มคอลัมน์ ต้อง generate + apply ใหม่
 * ไม่งั้นคิวรี่จะพังด้วย `permission denied for table ...` (PostgreSQL ไม่มี error
 * ระดับคอลัมน์ — ข้อความจะกำกวม ตัว MCP จึงต้องแปลให้เอง ดู src/db.mjs)
 */

/**
 * ตารางที่ถือข้อมูลส่วนบุคคลของคนจริง — grant เฉพาะคอลัมน์ที่ระบุตรงนี้เท่านั้น
 * อะไรที่ไม่ได้อยู่ในลิสต์ = ไม่ให้ ไม่ว่าชื่อจะดูปลอดภัยแค่ไหน
 *
 * สำรวจ prod 2026-09-04: chat_messages 115,437 แถว · chat_rooms 8,217 ห้อง (Facebook ทั้งหมด)
 * ในนั้น 488 ข้อความมีเบอร์มือถือ · 375 มีเลข 13 หลัก · 20,257 มีรูปแนบ
 * (ธุรกิจนี้ = บัตรประชาชน/สลิปเงินเดือน/ทะเบียนบ้านที่ลูกค้าส่งมาสมัครผ่อน)
 * · 8,201 ห้องมีชื่อจริงบน Facebook · 8,076 มีรูปโปรไฟล์
 */
export const PII_TABLE_ALLOWLIST = {
  // ── แชท: ตอบได้ว่า "มีกี่ข้อความ ห้องไหนค้าง บอทกินเงินเท่าไหร่" โดยไม่เห็นเนื้อความและไม่รู้ว่าใคร
  chat_messages: [
    'id', 'room_id', 'role', 'type', 'intent', 'confidence',
    'model_used', 'input_tokens', 'output_tokens', 'cost_usd',
    'created_at', 'deleted_at', 'delivered_at', 'read_at', 'delivery_status',
    'outbound_sent_at', 'staff_id', 'payment_id', 'receipt_id',
    // 👇 เจ้าของสั่งเปิด 2026-09-06 — ดู OWNER_APPROVED_PII
    'text', 'media_url',
  ],
  chat_rooms: [
    'id', 'customer_id', 'channel', 'status', 'verified_at', 'verification_attempts',
    'handoff_mode', 'handoff_tagged_at', 'handoff_staff_id',
    'total_messages', 'last_message_at', 'created_at', 'updated_at', 'deleted_at',
    'priority', 'assigned_to_id', 'first_response_at', 'resolved_at',
    'lead_score', 'lead_temperature', 'pinned_at', 'pinned_by_id', 'unread_count',
    'ai_paused', 'ai_paused_at', 'ai_paused_by_id',
    // 👇 เจ้าของสั่งเปิด 2026-09-06 — ดู OWNER_APPROVED_PII
    'display_name',
    // ยังไม่ให้: picture_url, ai_sales_state, line_user_id, external_user_id,
    //           handoff_reason, attribution_id
  ],
  // merged_into_id = uuid ชี้ลูกค้าปลายทางของ placeholder ที่ถูกรวม (ไม่ใช่ตัวตน) — ใช้เทียบกับ audit CUSTOMER_PLACEHOLDER_MERGED
  customers: ['id', 'created_at', 'updated_at', 'deleted_at', 'branch_id', 'customer_type', 'status', 'merged_into_id'],
  contacts: ['id', 'created_at', 'updated_at', 'deleted_at'],
  contracts: [
    'id', 'contract_number', 'customer_id', 'product_id', 'status',
    'created_at', 'updated_at', 'deleted_at',
  ],
  trade_ins: ['id', 'status', 'created_at', 'updated_at', 'deleted_at'],
  credit_checks: ['id', 'status', 'created_at', 'updated_at', 'deleted_at'],
  // ── การอนุมัติสินเชื่อ (CreditApproval) — ตั้งใจไม่ให้: verified_monthly_income / living_expenses /
  //    external_monthly_debt / internal_monthly_debt / remaining_income / maximum_monthly_payment /
  //    approved_monthly_payment (ตัวเลขการเงินผูกกับลูกค้าคนเดียว) · salary_pay_day (ชนแพทเทิร์น /^salary/i อยู่แล้ว) ·
  //    evidence_notes (ข้อความอิสระอ้างหลักฐานรายได้/รายจ่าย ≥20 ตัวอักษร) · source_financial_hash / customer_financial_hash
  //    (ชนแพทเทิร์น /_hash$/i อยู่แล้ว) · commitments (jsonb — รายการภาระผ่อนของลูกค้าคนนี้ ผูกเลขที่สัญญา+ยอดผ่อน)
  credit_approvals: [
    'id', 'credit_check_id', 'customer_id', 'approved_by_id', 'policy_version',
    'used_by_contract_id', 'used_at', 'used_first_payment_due', 'superseded_at',
    'created_at', 'updated_at', 'deleted_at',
  ],
  employees: ['id', 'status', 'created_at', 'updated_at', 'deleted_at'],
  employee_profiles: ['id', 'created_at', 'updated_at', 'deleted_at'],
  users: ['id', 'role', 'branch_id', 'acp_admin', 'is_active', 'created_at', 'updated_at', 'deleted_at'],
  audit_logs: ['id', 'action', 'entity_type', 'entity_id', 'user_id', 'created_at'],
  // จงใจไม่ให้ทั้งตาราง: old_value / new_value เก็บ payload ดิบของทุก mutation
  dsar_requests: ['id', 'status', 'created_at', 'updated_at'],
  ai_training_pairs: ['id', 'created_at', 'updated_at', 'deleted_at'],
  imported_sales: ['id', 'created_at', 'updated_at'],
  bot_detection_logs: ['id', 'reason', 'created_at'],
  website_visits: ['id', 'created_at'],
  refresh_tokens: ['id', 'user_id', 'created_at', 'expires_at', 'revoked_at'],
  ip_rate_limits: ['id', 'created_at'],
  staff_chat_activities: ['id', 'room_id', 'staff_id', 'action', 'created_at'],
  // ── การเดินทางของลูกค้า (migration 20261002100000_customer_journey) — ระบุคอลัมน์เป๊ะ
  //    ตั้งใจไม่ให้: note (บันทึกมือ ข้อความอิสระ ≤140 ตัว พนักงานอาจพิมพ์ชื่อ/รายละเอียดส่วนตัวลงไป แม้ DTO จะกันเลขยาว)
  //    data (jsonb) ให้ได้เพราะผ่าน JOURNEY_DATA_SCHEMAS (zod whitelist) ที่ห้ามข้อความแชท/เบอร์/เลขบัตร/ที่อยู่
  //    คอลัมน์ที่ migration เพิ่มทีหลังไม่ได้สิทธิ์จนกว่าจะใส่ในลิสต์นี้ = fail-closed
  customer_journey_entries: [
    'id', 'customer_id', 'origin_customer_id', 'origin', 'kind', 'occurred_at',
    'actor_type', 'actor_user_id', 'room_id', 'ref_type', 'ref_id', 'data',
    'channel', 'outcome', 'lost_reason', 'heard_from', 'dedupe_key',
    'created_at', 'deleted_at', 'deleted_by_id',
  ],
  // ── ใบยื่นไฟแนนซ์นอก (migration 20261010000000_external_finance_application) — ตั้งใจไม่ให้:
  //    summary / message_text / message_override (ข้อความ 12 ข้อ = ชื่อ อาชีพ IMEI เบอร์ อายุ) · occupation_override ·
  //    share_token_hash / share_token_enc (ลิงก์สาธารณะ) · line_request_id
  external_finance_applications: [
    'id', 'number', 'finance_company_id', 'room_id', 'customer_id', 'product_id', 'branch_id', 'status', 'result_source',
    'sent_at', 'sent_by_id', 'sent_via', 'share_expires_at', 'share_revoked_at', 'share_view_count', 'share_last_viewed_at',
    'last_partner_event_at', 'closed_at', 'files_purged_at', 'created_by_id', 'created_at', 'updated_at', 'deleted_at',
  ],
  //    ไม่ให้ original_name (ชื่อไฟล์ที่ลูกค้าตั้งอาจมีชื่อจริง) · storage_key (พาธไฟล์เอกสาร)
  external_finance_application_files: [
    'id', 'application_id', 'slot', 'mime_type', 'size', 'source', 'source_message_id', 'source_angle', 'sort_order',
    'sent_at', 'created_by_id', 'created_at', 'updated_at', 'deleted_at',
  ],
  //    ไม่ให้ actor_name / note (ข้อความอิสระจาก GFIN) / meta (ipHash + user agent)
  external_finance_application_events: ['id', 'application_id', 'kind', 'actor_type', 'actor_user_id', 'created_at'],
  // ── ตรวจเครดิตจากห้องแชท (GFIN final review I4, 2026-09-25) — เดิมไม่อยู่ในลิสต์ จึงถูกตัดสินด้วยด่านชื่ออย่างเดียว
  //    แล้วหลุด: `result` (jsonb ผลวิเคราะห์ statement ธนาคาร — ชื่อบัญชี ยอดเงินเข้าออก รายได้ของลูกค้าคนเดียว) ·
  //    `error` (ข้อความจาก AI/parser อาจยกเนื้อหา statement มา) · `key` ของไฟล์ (พาธเอกสารลูกค้าใน storage)
  //    ให้เฉพาะ id / ความเชื่อมโยง / สถานะ / เวลา
  room_credit_analyses: ['id', 'room_id', 'file_ids', 'status', 'credit_check_id', 'created_at', 'updated_at', 'deleted_at'],
  //    ไม่ให้ key (พาธเอกสารลูกค้า) · name (ชื่อไฟล์ — ชนด่าน /name/ อยู่แล้ว)
  room_credit_files: ['id', 'room_id', 'mime_type', 'size', 'source_message_id', 'created_at', 'updated_at', 'deleted_at'],
  // ── นับเงินปิดยอด/นำฝากของสาขา — ตั้งใจไม่ให้พาธรูปสลิปใน storage: `deposit_slip_key` / `slip_key`
  //    (receive_note / note / deposit_reference / reference ชนด่านชื่ออยู่แล้ว) · คอลัมน์อื่นคงชุดเดิมที่เคยได้
  //    variance_reason / sent_back_reason คงไว้ตามเดิม — เรื่อง *_reason ทั้งระบบรอเจ้าของตัดสิน (ledger GFIN Task 7)
  shop_cash_closes: [
    'id', 'branch_id', 'status', 'attempt_no', 'period_start', 'float_amount', 'cash_in', 'cash_out',
    'expected_amount', 'counted_amount', 'variance_amount', 'variance_reason', 'send_amount', 'counted_by_id', 'counted_at',
    'received_amount', 'receive_variance', 'destination', 'confirmed_by_id', 'confirmed_at',
    'sent_back_by_id', 'sent_back_at', 'sent_back_reason', 'created_at', 'updated_at', 'journal_entry_id',
  ],
  shop_cash_deposits: [
    'id', 'branch_id', 'source', 'amount', 'deposited_by_id', 'deposited_at', 'journal_entry_id', 'created_at', 'updated_at',
  ],
}

/**
 * 🔓 คอลัมน์ PII ที่ **เจ้าของสั่งเปิดเอง** — ระบุเป็นคู่ (ตาราง → คอลัมน์) เสมอ
 *
 * คำสั่งเจ้าของ 2026-09-06 "ต้องการให้อ่านได้" ยืนยันหลังเห็นตัวเลขความเสี่ยงแล้ว
 * บริบทที่แจ้งก่อนตัดสิน (สำรวจ prod 2026-09-04): 488 ข้อความมีเบอร์มือถือ ·
 * 375 มีเลข 13 หลัก · 20,257 มีรูปแนบ (บัตรประชาชน/สลิปเงินเดือน/ทะเบียนบ้าน) ·
 * 8,201 ห้องมีชื่อจริง · ไม่มีสัญญาประมวลผลข้อมูลกับ Anthropic และประกาศความเป็น
 * ส่วนตัวที่ลูกค้าเซ็นไม่ได้ระบุ Anthropic เป็นบุคคลที่สาม
 *
 * ⚠️ ผูกกับตารางเสมอ ห้ามย้ายไป ALWAYS_ALLOW_COLUMNS — `text` มีใน 3 ตาราง
 * (chat_messages, canned_response_bubbles, chat_side_messages) `media_url` ก็ 3 ตาราง
 * ยกเว้นแบบเหมาจะเปิดตารางที่ไม่มีใครตั้งใจเปิด
 *
 * 🔑 ถอนคืน: ลบบรรทัดในนี้ + คอลัมน์ใน PII_TABLE_ALLOWLIST แล้ว `npm run grants`
 *    + apply — สิทธิ์หายทันที ไม่ต้องหมุนรหัส ไม่ต้องแตะผู้ใช้
 */
export const OWNER_APPROVED_PII = {
  chat_messages: new Set(['text', 'media_url']),
  chat_rooms: new Set(['display_name']),
}

/**
 * ตารางที่ไม่ให้แตะเลยแม้แต่คอลัมน์เดียว
 */
export const DENIED_TABLES = new Set([
  'sessions',
  'password_reset_tokens',
  'verification_tokens',
])

/**
 * ชื่อคอลัมน์ที่ไม่ให้ ไม่ว่าจะอยู่ตารางไหน
 * นี่คือ "เข็มขัดเส้นที่สอง" — เส้นแรกคือการ grant ระดับคอลัมน์เสมอ
 * (denylist เพียว ๆ เชื่อไม่ได้ เพราะ PII ในระบบนี้อยู่ในข้อความอิสระที่ชื่อคอลัมน์ไม่บอกอะไร)
 */
export const DENIED_COLUMN_PATTERNS = [
  /national_id/i, /citizen_id/i, /id_card/i,
  /phone/i, /mobile/i, /tel(ephone)?$/i,
  /address/i, /^salary/i, /salary/i,
  /email/i, /line_id/i, /line_user/i, /external_user/i,
  /guardian/i, /reference/i, /emergency/i,
  /birth/i, /workplace/i, /employer/i, /occupation/i,
  // 🚨 บทเรียน 2026-09-04: เดิมเขียน /^name$/i ยึดหัวท้าย จึงไม่จับ payer_name / employee_name /
  //    signer_name เลย และไม่มี pattern ของ tax_id กับ recipient เลยแม้แต่ตัวเดียว
  //    ⇒ mcp_ro อ่านชื่อลูกค้าผู้จ่าย + เลขบัตรประชาชน 13 หลัก (tax_id ของบุคคลธรรมดา) ได้จริงบน prod
  //    ตอนนี้กลับด้าน: บล็อกทุกคอลัมน์ที่มีคำเหล่านี้ แล้วปล่อยคืนเฉพาะตัวที่พิสูจน์ว่าไม่ใช่คน
  //    (ดู NAME_LIKE_ALWAYS_ALLOW) — denylist ที่ยึดหัวท้ายคือตะแกรงที่ชื่อมี prefix ลอดได้เสมอ
  /name/i, /tax_id/i, /recipient/i, /nickname/i,
  /picture/i, /avatar/i, /photo/i, /image/i, /media_url/i, /signature/i, /document/i, /attachment/i,
  // 🚨 fix round 1 (Task 7 review, 2026-09-25): เดิม /^note/i /^comment/i /^remark/i ยึดหัวคำ — บทเรียน
  //    เดียวกับ /^name$/i ข้างบน (2026-09-04) — คอลัมน์ที่มีคำนี้เป็นส่วนหนึ่งของชื่อ (ไม่ใช่ prefix) หลุดหมด:
  //    `credit_approvals.evidence_notes` (ข้อความอิสระอ้างหลักฐานรายได้/รายจ่ายของลูกค้าคนเดียว) และ
  //    `shop_cash_closes.receive_note` เคยถูก grant จริงก่อน fix นี้ (พบระหว่างรีวิว `npm run grants`
  //    ที่กวาดสคีมาทั้งฐาน) ตอนนี้กลับด้าน: บล็อกทุกคอลัมน์ที่มีคำเหล่านี้เป็น substring — ยังไม่พบคอลัมน์ไหน
  //    ที่ต้องการ exception กลับมา (สแกน grants-report.md ทุกคอลัมน์ลงท้าย note/notes/remark/comment/reason
  //    แล้ว — ดู PR ของ fix round 1 สำหรับรายชื่อที่ตรวจ) — ถ้าเจอในอนาคตให้เพิ่มชื่อเป๊ะในลิสต์ยกเว้นแบบ
  //    NAME_LIKE_ALWAYS_ALLOW ห้ามคลาย pattern กลับเป็น anchored
  /^text$/i, /^content$/i, /^body$/i, /^message$/i, /note/i, /comment/i, /remark/i, /description/i,
  /password/i, /secret/i, /token/i, /api_key/i, /credential/i, /_hash$/i, /encrypted/i,
  /account_no/i, /account_number/i, /bank_account/i, /card_number/i,
  /ip_address/i, /user_agent/i, /snapshot/i, /payload/i, /old_value/i, /new_value/i,
  /facebook/i, /google_map/i,
]

/**
 * ยกเว้นแบบระบุชื่อตรงตัว — คอลัมน์ที่ชนด่านชื่อข้างบน แต่ตรวจแล้วว่าไม่ใช่ PII จริง
 * เก็บลิสต์นี้ให้สั้นและระบุชื่อเป๊ะเสมอ ห้ามใส่เป็น pattern เพราะจะกลายเป็นรูรั่วที่รีวิวไม่ทัน
 * (ตั้งใจไม่ใส่: salary — ถึงเป็นตัวเลขก็ยังเป็นข้อมูลส่วนบุคคล · birth_date ก็เช่นกัน)
 */
/**
 * คอลัมน์ที่มีคำว่า name/tax_id แต่พิสูจน์แล้วว่า **ไม่ใช่ตัวตนของคน**
 * ต้องระบุชื่อเป๊ะเสมอ ห้ามใส่เป็น pattern — เหตุผลเดียวกับที่ทำให้พลาดรอบแรก
 */
export const NAME_LIKE_ALWAYS_ALLOW = new Set([
  'migration_name',      // _prisma_migrations
  'campaign_name', 'ad_name', 'ad_set_name',   // ชื่อแคมเปญโฆษณา
  'file_name', 'filename', 'original_name',    // ชื่อไฟล์
  'table_name', 'column_name', 'check_name',   // ชื่อทางเทคนิค
  'template_name', 'item_name', 'report_name',
  'hostname',            // ชื่อเครื่องใน log
  'bank_name',           // ชื่อธนาคาร ไม่ใช่ชื่อคน
  'name_th', 'name_en',  // company_info = ชื่อนิติบุคคลของเราเอง จดทะเบียนเปิดเผยอยู่แล้ว
])

export const ALWAYS_ALLOW_COLUMNS = new Set([
  'input_tokens',        // int — จำนวนโทเคนที่บอทใช้ ไม่ใช่ความลับ
  'output_tokens',       // int
  'document_type',       // enum ประเภทเอกสาร ไม่ใช่ตัวเอกสาร
  'document_date',       // date
  'id_card_verified',    // boolean — ผ่าน/ไม่ผ่าน ไม่ใช่เลขบัตร
  'public_token_expires_at',
  'otp_expires_at',
  'token_expires_at',
])

/**
 * ชนิดข้อมูลที่ถือว่าเสี่ยงเก็บข้อความอิสระ — บนตารางที่ไม่ได้อยู่ใน PII_TABLE_ALLOWLIST
 * คอลัมน์ชนิดนี้ต้องผ่านด่านชื่อก่อนจึงจะได้
 */
export const FREE_TEXT_TYPES = new Set(['text', 'character varying', 'json', 'jsonb', 'ARRAY'])

/** ตัดสินว่าคอลัมน์หนึ่ง ๆ ได้สิทธิ์ไหม พร้อมเหตุผล (ใช้ทั้งตอน generate และตอนรีวิว) */
export function decide(table, column, dataType) {
  if (DENIED_TABLES.has(table)) return { allow: false, why: 'ตารางถูกห้ามทั้งใบ' }

  const exempt = ALWAYS_ALLOW_COLUMNS.has(column) || NAME_LIKE_ALWAYS_ALLOW.has(column)
  const pattern = exempt ? null : DENIED_COLUMN_PATTERNS.find(re => re.test(column))

  if (Object.hasOwn(PII_TABLE_ALLOWLIST, table)) {
    const listed = PII_TABLE_ALLOWLIST[table].includes(column)
    if (!listed) return { allow: false, why: 'ตาราง PII — ไม่อยู่ใน allowlist' }
    if (pattern && OWNER_APPROVED_PII[table]?.has(column)) {
      return { allow: true, why: `PII ที่เจ้าของสั่งเปิด 2026-09-06 (ชน ${pattern} — ยกเว้นเฉพาะตารางนี้)` }
    }
    if (pattern) return { allow: false, why: `ตาราง PII และชนชื่อต้องห้าม ${pattern}` }
    return { allow: true, why: 'อยู่ใน allowlist ของตาราง PII' }
  }

  if (pattern) return { allow: false, why: `ชนชื่อต้องห้าม ${pattern}` }
  if (FREE_TEXT_TYPES.has(dataType)) return { allow: true, why: `ข้อความอิสระ (${dataType}) แต่ชื่อผ่านด่าน` }
  return { allow: true, why: 'ตารางไม่ใช่ PII และชื่อผ่านด่าน' }
}
