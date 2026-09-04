import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const HERE = dirname(fileURLToPath(import.meta.url))
const GRANTS_SQL = join(HERE, '..', 'sql', 'grants.sql')

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 1000
export const MAX_BYTES = 100_000

/** ตัวเลขใหญ่กว่า 2^53 และ Decimal ต้องคงความแม่น — ส่งเป็น string ดีกว่าเพี้ยนเงียบ ๆ */
pg.types.setTypeParser(20, v => (Number.isSafeInteger(Number(v)) ? Number(v) : v)) // int8
pg.types.setTypeParser(1700, v => v)                                              // numeric → string

export class Db {
  #pool = null
  #expectedDb

  constructor({ socketDir, database = 'bestchoice', user = 'mcp_ro', password }) {
    this.#expectedDb = database
    this.#pool = new pg.Pool({
      host: socketDir,          // node-postgres ต่อ unix socket โดยให้ host เป็น "โฟลเดอร์" ที่มี socket อยู่
      database, user, password,
      // instance เป็น db-g1-small (1 vCPU) และแอปจริงถือ connection_limit=10 อยู่แล้ว
      // เครื่องพัฒนาไม่มีเหตุผลจะกินมากกว่านี้
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'bestchoice-mcp',
    })
    this.#pool.on('error', () => {})   // คอนเนกชันที่ตายตอน idle ไม่ควรทำให้ process ล้ม
  }

  async close() { await this.#pool?.end().catch(() => {}) }

  /**
   * ยืนยันว่าต่อถูกฐานจริง ๆ ก่อนตอบคำถามใด ๆ
   * ถ้า proxy ชี้ผิด instance เราจะตอบคำถามเรื่อง prod ด้วยข้อมูลของฐานอื่นแบบไม่รู้ตัว
   */
  async assertIdentity() {
    const { rows } = await this.#pool.query(
      'SELECT current_database() AS db, current_user AS usr, version() AS ver',
    )
    const r = rows[0]
    if (r.db !== this.#expectedDb) {
      throw new Error(`ต่อผิดฐาน: ได้ "${r.db}" แต่ต้องการ "${this.#expectedDb}"`)
    }
    return r
  }

  /**
   * เทียบสิทธิ์ที่มีอยู่จริงกับ grants.sql ที่ commit ไว้
   * ต้องมีด่านนี้เพราะ grant อยู่นอกทุกกลไกที่ provision ฐานนี้ —
   * prisma migrate ไม่สร้างให้ การ restore ไป instance ใหม่ก็ไม่พามาด้วย
   * และแผน SP7 (1 ม.ค. 2027) จะแยก prod เป็นสอง instance
   * ถ้าไม่เทียบ จะได้ error "permission denied for table" ที่แยกไม่ออกจาก "คอลัมน์นี้เป็น PII"
   */
  async aclDrift() {
    const expected = new Set()
    for (const m of readFileSync(GRANTS_SQL, 'utf8')
      .matchAll(/^GRANT SELECT \(([^)]*)\) ON public\."([^"]+)"/gm)) {
      const table = m[2]
      for (const c of m[1].split(',')) expected.add(`${table}.${c.trim().replace(/^"|"$/g, '')}`)
    }
    const { rows } = await this.#pool.query(`
      SELECT table_name, column_name FROM information_schema.column_privileges
      WHERE grantee = current_user AND privilege_type = 'SELECT' AND table_schema = 'public'`)
    const live = new Set(rows.map(r => `${r.table_name}.${r.column_name}`))
    const missing = [...expected].filter(k => !live.has(k))
    const extra = [...live].filter(k => !expected.has(k))
    return { expected: expected.size, live: live.size, missing, extra }
  }

  /**
   * รัน SELECT แล้วคืนไม่เกิน `limit` แถว
   *
   * ใช้ cursor ฝั่งเซิร์ฟเวอร์ ไม่ใช่การครอบด้วย `SELECT * FROM (<sql>) t LIMIT n`
   * เพราะการครอบพังทันทีที่ผลลัพธ์มีชื่อคอลัมน์ซ้ำ ซึ่งเกิดกับ join ธรรมดาที่ดึง id ทั้งสองฝั่ง
   * (`ERROR: column "id" specified more than once`) — cursor ไม่ต้องแตะ SQL ของผู้ใช้เลย
   * และหยุดดึงกลางทางได้จริง ไม่ต้องรอ materialize ทั้งชุดมาไว้ในหน่วยความจำ
   */
  async runSelect(sql, limit = DEFAULT_LIMIT) {
    const n = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
    const client = await this.#pool.connect()
    const started = Date.now()
    try {
      await client.query('BEGIN READ ONLY')
      await client.query(`DECLARE mcp_cur NO SCROLL CURSOR FOR ${sql}`)
      const res = await client.query(`FETCH FORWARD ${n + 1} FROM mcp_cur`)  // +1 เพื่อรู้ว่ามีต่อไหม
      const truncatedByRows = res.rows.length > n
      let rows = truncatedByRows ? res.rows.slice(0, n) : res.rows

      // เพดานขนาด: คอลัมน์ jsonb/array ทำให้ไม่กี่แถวก็ท่วม context ได้
      let truncatedByBytes = false
      while (rows.length > 1 && Buffer.byteLength(JSON.stringify(rows)) > MAX_BYTES) {
        rows = rows.slice(0, Math.floor(rows.length / 2))
        truncatedByBytes = true
      }

      return {
        rows,
        rowCount: rows.length,
        truncated: truncatedByRows || truncatedByBytes,
        truncatedReason: truncatedByBytes ? `เกิน ${MAX_BYTES} ไบต์` : truncatedByRows ? `ถึงเพดาน ${n} แถว` : null,
        columns: (res.fields || []).map(f => f.name),
        durationMs: Date.now() - started,
      }
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
    }
  }

  async query(text, params) { return this.#pool.query(text, params) }
}

/**
 * PostgreSQL ไม่มี error ระดับคอลัมน์สำหรับ SELECT — ต่อให้โดนตัดแค่คอลัมน์เดียว
 * มันก็ตอบ `permission denied for table <t>` ซึ่งอ่านแล้วเข้าใจผิดว่าทั้งตารางห้าม
 * แปลให้ตรงกับความจริงของระบบนี้ ไม่งั้นจะเสียเวลาไล่ผิดทางทุกครั้ง
 */
export function explainError(err) {
  const msg = String(err?.message || err)
  const m = msg.match(/permission denied for table (\w+)/i)
  if (m) {
    return `${msg}\n\n` +
      `→ ข้อความนี้กำกวมโดยธรรมชาติของ PostgreSQL: มันขึ้นแบบเดียวกันทั้งกรณี "ทั้งตารางห้าม" ` +
      `และกรณี "คิวรี่ไปแตะคอลัมน์ที่ไม่ได้ให้สิทธิ์" ซึ่งกรณีหลังพบบ่อยกว่ามาก\n` +
      `→ ใช้ db_schema("${m[1]}") ดูว่าคอลัมน์ไหนใช้ได้ แล้วระบุชื่อคอลัมน์แทน SELECT *\n` +
      `→ ถ้าคอลัมน์นั้นควรใช้ได้ แปลว่า migration เพิ่มคอลัมน์ใหม่หลัง generate ครั้งล่าสุด — ` +
      `รัน \`npm run grants\` ใน .claude/mcp แล้ว apply grants.sql ใหม่`
  }
  if (/canceling statement due to statement timeout/i.test(msg)) {
    return `${msg}\n\n→ คิวรี่เกิน statement_timeout (15 วิ) ลองจำกัดช่วงเวลา ใส่เงื่อนไข หรือใช้ count(*) แทนการดึงแถว`
  }
  return msg
}
