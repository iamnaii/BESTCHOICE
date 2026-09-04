#!/usr/bin/env node
/**
 * อ่านโครงตารางจริงจาก pg_catalog แล้วสร้าง sql/grants.sql + sql/grants-report.md
 *
 * ต้องรันใหม่ทุกครั้งหลัง migration ที่เพิ่ม/เปลี่ยนคอลัมน์ ไม่งั้นคิวรี่จะพัง
 * (นั่นคือพฤติกรรมที่ตั้งใจ — fail-closed ดีกว่าเผลอเปิดคอลัมน์ใหม่ให้เงียบ ๆ)
 *
 * อ่านอย่างเดียว ไม่เขียนอะไรลงฐาน · ไม่พิมพ์ "ค่า" ในตารางออกมาเลย มีแต่ชื่อ
 *
 *   PGURL=postgresql://... node sql/generate-grants.mjs
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { decide, PII_TABLE_ALLOWLIST, DENIED_TABLES } from './policy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROLE = process.env.MCP_ROLE || 'mcp_ro'

const PGURL = process.env.PGURL
if (!PGURL) {
  console.error('ต้องมี PGURL — เช่น PGURL=postgresql://user:pass@127.0.0.1:15432/bestchoice?sslmode=disable')
  process.exit(1)
}

// pg_catalog ไม่ถูกกรองตามสิทธิ์ ต่างจาก information_schema ที่ซ่อนคอลัมน์ที่ผู้เรียกไม่มีสิทธิ์
// (ผลตรวจรอบแรกจับได้ว่าถ้าใช้ information_schema ตัว db_schema จะมองไม่เห็นคอลัมน์ที่ตัวเองโดนตัดพอดี)
const SQL_COLUMNS = `
SELECT c.relname AS table_name,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnum
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','p')          -- ตารางธรรมดา + partitioned
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;
`

const q = s => '"' + String(s).replace(/"/g, '""') + '"'

const client = new pg.Client({ connectionString: PGURL })
await client.connect()
await client.query('SET default_transaction_read_only = on')

const { rows } = await client.query(SQL_COLUMNS)
await client.end()

const tables = new Map()
for (const r of rows) {
  if (!tables.has(r.table_name)) tables.set(r.table_name, [])
  tables.get(r.table_name).push(r)
}

const sql = []
const report = []
let nAllow = 0, nDeny = 0, nTablesGranted = 0, nTablesFullyDenied = 0

sql.push('-- สร้างอัตโนมัติจาก .claude/mcp/sql/generate-grants.mjs — ห้ามแก้ด้วยมือ')
sql.push(`-- โครงตารางจาก pg_catalog ของฐานจริง · role = ${ROLE}`)
sql.push('--')
sql.push('-- ห้ามเปลี่ยนเป็น GRANT SELECT ON <table> (ทั้งตาราง) เด็ดขาด:')
sql.push('-- ACL ระดับตารางครอบคอลัมน์ที่ migration เพิ่มทีหลังโดยอัตโนมัติ = fail-OPEN')
sql.push('')
sql.push('BEGIN;')
sql.push('')

for (const [table, cols] of [...tables].sort()) {
  const allowed = [], denied = []
  for (const c of cols) {
    const d = decide(table, c.column_name, c.data_type)
    ;(d.allow ? allowed : denied).push({ ...c, why: d.why })
  }
  nAllow += allowed.length
  nDeny += denied.length

  // REVOKE ก่อนเสมอ — ถ้าเคยมี grant ระดับตารางค้างอยู่ การ GRANT ราย column ทับไม่ได้ลบมันออก
  sql.push(`REVOKE ALL ON public.${q(table)} FROM ${ROLE};`)
  if (allowed.length) {
    nTablesGranted++
    const list = allowed.map(c => q(c.column_name)).join(', ')
    sql.push(`GRANT SELECT (${list}) ON public.${q(table)} TO ${ROLE};`)
  } else {
    nTablesFullyDenied++
    sql.push(`-- (ไม่ให้สิทธิ์คอลัมน์ใดเลยในตารางนี้)`)
  }
  sql.push('')

  const flag = DENIED_TABLES.has(table) ? '⛔' : Object.hasOwn(PII_TABLE_ALLOWLIST, table) ? '🔒' : '  '
  report.push({ table, flag, allowed, denied })
}

sql.push('COMMIT;')
writeFileSync(join(HERE, 'grants.sql'), sql.join('\n') + '\n')

// ── รายงานให้คนอ่านก่อนอนุมัติ ─────────────────────────────────────────────
const md = []
md.push('# grants.sql — สรุปให้รีวิวก่อนรันบน prod')
md.push('')
md.push('> สร้างอัตโนมัติ ห้ามแก้ด้วยมือ · แก้ที่ `policy.mjs` แล้ว `npm run grants` ใหม่')
md.push('')
md.push(`- ตารางทั้งหมด **${tables.size}** · ให้สิทธิ์บางคอลัมน์ **${nTablesGranted}** · ไม่ให้เลยทั้งใบ **${nTablesFullyDenied}**`)
md.push(`- คอลัมน์ทั้งหมด **${nAllow + nDeny}** · ให้ **${nAllow}** · ไม่ให้ **${nDeny}**`)
md.push('')
md.push('🔒 = ตารางที่ถือ PII (ให้เฉพาะที่อยู่ใน allowlist) · ⛔ = ห้ามทั้งใบ')
md.push('')
md.push('## ตารางที่ถือ PII — ตรวจให้ละเอียด')
md.push('')
for (const r of report.filter(r => r.flag !== '  ').sort((a, b) => a.table.localeCompare(b.table))) {
  md.push(`### ${r.flag} \`${r.table}\``)
  md.push(`ให้ ${r.allowed.length} · ไม่ให้ ${r.denied.length}`)
  md.push('')
  md.push(`- **ให้**: ${r.allowed.length ? r.allowed.map(c => '`' + c.column_name + '`').join(' ') : '_ไม่มี_'}`)
  md.push(`- **ไม่ให้**: ${r.denied.length ? r.denied.map(c => '`' + c.column_name + '`').join(' ') : '_ไม่มี_'}`)
  md.push('')
}
md.push('## ตารางอื่นที่มีคอลัมน์ถูกตัดออก')
md.push('')
md.push('| ตาราง | ให้ | ไม่ให้ | คอลัมน์ที่ไม่ให้ |')
md.push('|---|---:|---:|---|')
for (const r of report.filter(r => r.flag === '  ' && r.denied.length).sort((a, b) => b.denied.length - a.denied.length)) {
  md.push(`| \`${r.table}\` | ${r.allowed.length} | ${r.denied.length} | ${r.denied.map(c => '`' + c.column_name + '`').join(' ')} |`)
}
writeFileSync(join(HERE, 'grants-report.md'), md.join('\n') + '\n')

console.log(`ตาราง ${tables.size} · ให้สิทธิ์บางคอลัมน์ ${nTablesGranted} · ไม่ให้เลย ${nTablesFullyDenied}`)
console.log(`คอลัมน์ ${nAllow + nDeny} · ให้ ${nAllow} · ไม่ให้ ${nDeny}`)
console.log('เขียน sql/grants.sql และ sql/grants-report.md แล้ว')
