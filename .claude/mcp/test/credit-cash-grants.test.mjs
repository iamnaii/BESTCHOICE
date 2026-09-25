import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decide } from '../sql/policy.mjs'

const GRANTS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'sql', 'grants.sql'), 'utf8')
const GRANT_LINE = /^GRANT SELECT \(([^)]*)\) ON public\."([^"]+)" TO mcp_ro;$/gm

function granted(table) {
  for (const m of GRANTS.matchAll(GRANT_LINE)) {
    if (m[2] === table) return m[1].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  }
  return null
}

// GFIN final review I4 (2026-09-25) — ตารางเหล่านี้เคยถูกตัดสินด้วยด่านชื่ออย่างเดียว แล้วหลุดข้อมูลการเงินลูกค้า/พาธเอกสาร
test('room_credit_analyses: ผลวิเคราะห์ statement (result) และ error ไม่ได้สิทธิ์ — เหลือ id/ความเชื่อมโยง/สถานะ/เวลา', () => {
  for (const c of ['result', 'error']) assert.equal(decide('room_credit_analyses', c, 'jsonb').allow, false, c)
  assert.deepEqual(granted('room_credit_analyses'), ['id', 'room_id', 'file_ids', 'status', 'credit_check_id', 'created_at', 'updated_at', 'deleted_at'])
})

test('room_credit_files: key (พาธเอกสารลูกค้าใน storage) ไม่ได้สิทธิ์', () => {
  assert.equal(decide('room_credit_files', 'key', 'text').allow, false)
  assert.ok(!granted('room_credit_files').includes('key'))
})

test('shop_cash_closes / shop_cash_deposits: พาธรูปสลิปใน storage ไม่ได้สิทธิ์ · คอลัมน์ใหม่ fail-closed', () => {
  assert.equal(decide('shop_cash_closes', 'deposit_slip_key', 'text').allow, false)
  assert.equal(decide('shop_cash_deposits', 'slip_key', 'text').allow, false)
  assert.ok(!granted('shop_cash_closes').includes('deposit_slip_key'))
  assert.ok(!granted('shop_cash_deposits').includes('slip_key'))
  assert.equal(decide('shop_cash_closes', 'future_column', 'text').allow, false)
})
