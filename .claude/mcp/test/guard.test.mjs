import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkReadOnly, stripComments } from '../src/guard.mjs'

const ok = sql => assert.equal(checkReadOnly(sql).ok, true, `ควรผ่าน: ${sql}`)
const no = sql => assert.equal(checkReadOnly(sql).ok, false, `ควรถูกปัด: ${sql}`)

test('ยอมให้อ่าน', () => {
  ok('SELECT 1')
  ok('select count(*) from products where deleted_at is null')
  ok('WITH x AS (SELECT 1 AS a) SELECT * FROM x')
  ok('SELECT * FROM system_config WHERE key = \'shop_bot_persona_base\'')
  ok('SELECT 1;')                                   // ; ปิดท้ายตัวเดียวยอมได้
  ok('EXPLAIN SELECT * FROM products')
  ok('SELECT * FROM refresh_tokens')                // ชื่อตารางมีคำว่า refresh/token แต่ไม่ใช่คำสั่ง
  ok('SELECT updated_at, created_at FROM products') // created_at ไม่ใช่ CREATE
})

test('ปัดคำสั่งเขียน', () => {
  no('INSERT INTO products VALUES (1)')
  no('UPDATE products SET name = \'x\'')
  no('DELETE FROM products')
  no('TRUNCATE products')
  no('DROP TABLE products')
  no('ALTER TABLE products ADD COLUMN x int')
  no('GRANT SELECT ON products TO mcp_ro')
  no('CREATE TABLE t (x int)')
  no('COPY products TO \'/tmp/x\'')
})

test('ปัดหลายคำสั่งในนัดเดียว', () => {
  no('SELECT 1; DROP TABLE products')
  no('SELECT 1;SELECT 2')
})

test('ปัด CTE ที่เขียนจริงทั้งที่ขึ้นต้นด้วย WITH', () => {
  no('WITH x AS (DELETE FROM products RETURNING *) SELECT * FROM x')
  no('WITH x AS (UPDATE products SET a=1 RETURNING *) SELECT * FROM x')
})

test('ปัดตัวปลดกันเผลอของตัวเอง — นี่คือช่องที่แบบรอบแรกพลาด', () => {
  // เป็น SELECT แท้ ๆ ไม่มี ; ไม่มีคำสั่งเขียน แต่ปิด statement_timeout ได้ถาวรทั้ง backend
  no("SELECT set_config('statement_timeout','0',false)")
  no("select SET_CONFIG('default_transaction_read_only','off',false)")
  no('SET statement_timeout = 0')
  no('RESET ALL')
})

test('ปัดช่องเขียนที่เหลือของ role ที่มีแค่ SELECT', () => {
  no('SELECT lo_create(0)')                       // large object เขียนลง prod ได้จริง
  no("SELECT lo_import('/etc/passwd')")
  no("SELECT pg_read_file('/etc/passwd')")
  no('SELECT pg_sleep(30)')
  no('SELECT * INTO new_table FROM products')
})

test('ซ่อนคำสั่งไว้ในคอมเมนต์ไม่ช่วย', () => {
  no('SELECT 1 -- \n; DROP TABLE products')
  no('/* ทัก */ DELETE FROM products')
  no('/* ซ้อน /* ชั้นใน */ ยังอยู่ */ DROP TABLE products')
})

test('คำต้องห้ามที่อยู่ใน string literal ไม่ทำให้ถูกปัด', () => {
  ok("SELECT * FROM audit_logs WHERE action = 'DELETE'")
  ok("SELECT * FROM system_config WHERE key = 'update_mode'")
})

test('stripComments นับ block comment ซ้อนถูกต้อง', () => {
  assert.equal(stripComments('a /* x /* y */ z */ b').replace(/\s+/g, ' ').trim(), 'a b')
  assert.equal(stripComments('a -- ทิ้ง\nb').replace(/\s+/g, ' ').trim(), 'a b')
})

test('อินพุตเพี้ยน', () => {
  no('')
  no('   ')
  no('-- แค่คอมเมนต์')
  no(null)
  no(undefined)
})
