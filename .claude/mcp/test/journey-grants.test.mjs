import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decide } from '../sql/policy.mjs'

const GRANTS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'sql', 'grants.sql'), 'utf8')
const GRANT_LINE = /^GRANT SELECT \(([^)]*)\) ON public\."([^"]+)" TO mcp_ro;$/gm

/** คอลัมน์ใน GRANT SELECT (...) ของตารางหนึ่ง — อ่านรูปแบบเดียวกับ aclDrift() ใน src/db.mjs */
function granted(table) {
  for (const m of GRANTS.matchAll(GRANT_LINE)) {
    if (m[2] === table) return m[1].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  }
  return null
}

// ลำดับตาม field ใน schema.prisma (= attnum ของ CREATE TABLE ใน migration 20261002100000_customer_journey)
const ENTRY_COLUMNS = [
  'id', 'customer_id', 'origin_customer_id', 'origin', 'kind', 'occurred_at',
  'actor_type', 'actor_user_id', 'room_id', 'ref_type', 'ref_id', 'data',
  'channel', 'outcome', 'lost_reason', 'heard_from', 'dedupe_key',
  'created_at', 'deleted_at', 'deleted_by_id',
]
const STATE_COLUMNS = [
  'customer_id', 'stage', 'stage_entered_at', 'path', 'contacted_at', 'identified_at',
  'interested_at', 'credit_at', 'first_purchase_at', 'first_purchase_kind', 'first_staff_reply_at',
  'first_channel', 'first_source', 'first_ad_campaign_id', 'heard_from',
  'last_customer_at', 'last_touch_at', 'lost_at', 'lost_reason', 'computed_at',
]

test('customer_journey_entries: note (บันทึกมือ ข้อความอิสระ) ไม่ได้สิทธิ์ทั้งใน policy และใน grants.sql', () => {
  assert.equal(decide('customer_journey_entries', 'note', 'character varying(140)').allow, false)
  assert.deepEqual(granted('customer_journey_entries'), ENTRY_COLUMNS)
})

test('customer_journey_entries: คอลัมน์ที่ migration เพิ่มทีหลังไม่ได้สิทธิ์จนกว่าจะใส่ allowlist (fail-closed)', () => {
  assert.equal(decide('customer_journey_entries', 'future_column', 'text').allow, false)
})

test('customer_journey_states: แคชสรุปอ่านได้ทุกคอลัมน์', () => {
  assert.deepEqual(granted('customer_journey_states'), STATE_COLUMNS)
})

test('customers: merged_into_id อ่านได้ (ตามรอยการรวม placeholder เทียบกับ audit)', () => {
  assert.deepEqual(granted('customers'), ['id', 'created_at', 'updated_at', 'deleted_at', 'status', 'merged_into_id'])
})

test('ทุกคอลัมน์ที่ grants.sql ให้สิทธิ์ต้องผ่าน policy.mjs และไม่มี grant ทั้งตาราง (กันแก้ไฟล์ด้วยมือแล้วเปิด PII)', () => {
  const violations = []
  for (const m of GRANTS.matchAll(GRANT_LINE)) {
    for (const c of m[1].split(',').map(s => s.trim().replace(/^"|"$/g, ''))) {
      if (!decide(m[2], c, 'unknown').allow) violations.push(`${m[2]}.${c}`)
    }
  }
  assert.deepEqual(violations, [])
  assert.doesNotMatch(GRANTS, /^GRANT SELECT ON /m)
})
