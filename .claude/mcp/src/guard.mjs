/**
 * ด่านกันคำสั่งที่ไม่ใช่การอ่าน
 *
 * ⚠️ อ่านให้ชัด: นี่ไม่ใช่ขอบเขตความปลอดภัย
 * ตัวที่กันการเขียนจริงคือ role `mcp_ro` ไม่มีสิทธิ์ INSERT/UPDATE/DELETE บนอะไรเลย
 * ด่านนี้มีไว้เพื่อ (ก) ให้ error อ่านรู้เรื่องแทนที่จะเป็น permission denied ดิบ ๆ
 * และ (ข) กันคำสั่งที่ "อ่านอย่างเดียว" แต่ยังทำร้ายได้ เช่น set_config ที่ปลด statement_timeout
 *
 * ที่ด่านแบบนี้จับไม่ได้แน่ ๆ: SQL ที่ซ่อนเจตนาไว้ใน string literal, dollar-quoted body,
 * หรือ function ที่ผู้อื่นสร้างไว้ — ซึ่งเป็นเหตุผลว่าทำไมสิทธิ์ระดับ DB ต้องเป็นตัวหลัก
 */

const BLOCKED = [
  // เขียนข้อมูล
  [/\b(insert|update|delete|merge|truncate|copy)\b/i, 'เป็นคำสั่งเขียนข้อมูล'],
  // เปลี่ยนโครงสร้าง / สิทธิ์
  [/\b(create|alter|drop|grant|revoke|reindex|vacuum|analyze|cluster|refresh)\b/i, 'เป็นคำสั่งเปลี่ยนโครงสร้างหรือสิทธิ์'],
  // ปลดกันเผลอของตัวเอง — SELECT set_config(...) เป็น SELECT แท้ ๆ แต่ปิด statement_timeout ได้ถาวรทั้ง backend
  [/\bset_config\s*\(/i, 'set_config ปลด statement_timeout / read-only ของ session ได้'],
  [/^\s*set\b/i, 'SET เปลี่ยนพารามิเตอร์ของ session'],
  [/^\s*reset\b/i, 'RESET เปลี่ยนพารามิเตอร์ของ session'],
  // large object — role ที่มีแค่ SELECT ก็ยังเขียน large object ลง prod ได้
  [/\blo_(create|import|from_bytea|put|write|unlink|truncate)\s*\(/i, 'ฟังก์ชัน large object เขียนลงฐานได้'],
  [/\bpg_(read_file|read_binary_file|ls_dir|stat_file)\s*\(/i, 'อ่านไฟล์บนเครื่องเซิร์ฟเวอร์'],
  // ดูด CPU
  [/\bpg_sleep(_for|_until)?\s*\(/i, 'pg_sleep ถือคอนเนกชันไว้เปล่า ๆ'],
  // SELECT ... INTO สร้างตารางใหม่
  [/\binto\s+(temp|temporary|unlogged\s+)?\w+\s*(\(|from|;|$)/i, 'SELECT ... INTO สร้างตารางใหม่'],
]

/** ลบคอมเมนต์ออกก่อนตรวจ เพื่อไม่ให้ซ่อนคำสั่งไว้หลัง -- หรือ block comment */
export function stripComments(sql) {
  let out = '', i = 0
  while (i < sql.length) {
    const two = sql.slice(i, i + 2)
    if (two === '--') { const nl = sql.indexOf('\n', i); i = nl === -1 ? sql.length : nl; continue }
    if (two === '/*') {
      // PostgreSQL ยอมให้ block comment ซ้อนกันได้ ต้องนับชั้น
      let depth = 1; i += 2
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === '/*') { depth++; i += 2 }
        else if (sql.slice(i, i + 2) === '*/') { depth--; i += 2 }
        else i++
      }
      continue
    }
    if (sql[i] === "'") { // ข้าม string literal ทั้งก้อน
      out += ' '; i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue }
        if (sql[i] === "'") { i++; break }
        i++
      }
      continue
    }
    out += sql[i]; i++
  }
  return out
}

/** @returns {{ok:true}|{ok:false,reason:string}} */
export function checkReadOnly(sql) {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'SQL ว่าง' }

  const bare = stripComments(sql).trim()
  if (!bare) return { ok: false, reason: 'เหลือแต่คอมเมนต์' }

  // หลายคำสั่งในนัดเดียว: ยอมให้มี ; ปิดท้ายได้ตัวเดียว
  const trimmed = bare.replace(/;\s*$/, '')
  if (trimmed.includes(';')) return { ok: false, reason: 'ส่งได้ครั้งละหนึ่งคำสั่ง (พบ ; คั่นกลาง)' }

  if (!/^\s*(select|with|table|values|explain|show)\b/i.test(trimmed)) {
    return { ok: false, reason: 'ต้องขึ้นต้นด้วย SELECT / WITH / TABLE / VALUES / EXPLAIN / SHOW' }
  }
  // WITH x AS (DELETE ... RETURNING ...) SELECT ... — ขึ้นต้นด้วย WITH แต่เขียนจริง
  for (const [re, why] of BLOCKED) {
    if (re.test(trimmed)) return { ok: false, reason: why }
  }
  return { ok: true }
}
