/**
 * เปิด cloud-sql-proxy ของตัวเองบน Unix socket ในโฟลเดอร์แยกต่อ PID
 *
 * ทำไมไม่ใช้พอร์ต TCP แล้ว "เจอเปิดอยู่ก็ใช้ต่อ" แบบที่คิดไว้รอบแรก:
 *   1. process ลูกไม่ตายตามแม่ถ้าแม่โดน SIGKILL — มันถูกยกไปห้อยกับ PID 1 แล้วยึดพอร์ตต่อ
 *      (reproduce แล้วบน Node 24 / macOS) พอบวกกับกฎ "ใช้ตัวที่ฟังอยู่" จะกลายเป็น
 *      ตอบคำถามจากฐานผิดตัวแบบเงียบ ๆ
 *   2. เรโปนี้เปิดหลาย session พร้อมกันเป็นปกติ (7 worktree + agent teams)
 *      session A ออก proxy ตาย session B ที่ยืมใช้อยู่ก็ขาดกลางคัน
 * socket ต่อ PID = ไม่มีการแชร์ ความเป็นเจ้าของชัดเจน ไม่มีทางต่อผิดฐาน
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const INSTANCE = 'bestchoice-prod:asia-southeast1:bestchoice-db'

export class Proxy {
  #child = null
  #dir = null
  socketPath = null

  async start({ instance = INSTANCE, logPath } = {}) {
    this.#dir = mkdtempSync(join(tmpdir(), `bcmcp-${process.pid}-`))
    // node-postgres รับ host เป็น "โฟลเดอร์" แล้วต่อท้ายเองเป็น <dir>/.s.PGSQL.<port>
    // ถ้าตั้งชื่อ socket เป็นอย่างอื่น (เช่นชื่อ instance) จะได้ ENOENT ตอนต่อ
    this.socketPath = join(this.#dir, '.s.PGSQL.5432')

    const log = createWriteStream(logPath || join(this.#dir, 'proxy.log'))

    this.#child = spawn(
      'cloud-sql-proxy',
      [`${instance}?unix-socket-path=${this.socketPath}`],
      {
        // stdout ของ process นี้คือช่อง JSON-RPC ของ MCP
        // ถ้าปล่อยให้ลูก inherit แล้วมันพิมพ์อะไรออกมาบรรทัดเดียว protocol พังทันที
        // และถ้าใช้ 'pipe' แล้วไม่ระบาย ลูกจะค้างเมื่อ buffer เต็ม ~64KB
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
      },
    )
    this.#child.stderr.pipe(log)
    this.#child.on('exit', code => { this.#exited = code })
    // ไม่มี handler นี้ = spawn ที่ล้มเหลว (ไม่เจอ binary, สิทธิ์ไม่พอ) จะโยน ENOENT
    // แบบ unhandled แล้วฆ่าทั้ง server ทิ้งโดยไม่มีคำอธิบายให้ผู้ใช้เลย
    this.#child.on('error', err => { this.#spawnError = err })

    try {
      for (let i = 0; i < 100; i++) {
        if (this.#spawnError) {
          throw new Error(
            this.#spawnError.code === 'ENOENT'
              ? 'ไม่พบคำสั่ง cloud-sql-proxy ใน PATH — ติดตั้งก่อน (มากับ google-cloud-sdk)'
              : `เปิด cloud-sql-proxy ไม่ได้: ${this.#spawnError.message}`,
          )
        }
        if (this.#exited != null) {
          throw new Error(`cloud-sql-proxy ออกก่อนพร้อม (code ${this.#exited}) — ดู ${logPath || 'proxy.log'}`)
        }
        if (existsSync(this.socketPath)) return this.socketPath
        await new Promise(r => setTimeout(r, 100))
      }
      throw new Error('cloud-sql-proxy ไม่พร้อมภายใน 10 วินาที')
    } catch (e) {
      this.stop()   // ทุกเส้นทางที่ล้มต้องเก็บกวาด ไม่งั้นเหลือ process + โฟลเดอร์ชั่วคราวค้าง
      throw e
    }
  }

  #exited = null
  #spawnError = null

  stop() {
    try { this.#child?.kill('SIGTERM') } catch {}
    try { if (this.#dir) rmSync(this.#dir, { recursive: true, force: true }) } catch {}
    this.#child = null
  }
}

/**
 * session ที่รันในกล่องทราย remote ไม่มี gcloud และไม่มี cloud-sql-proxy
 * (.claude/hooks/session-start.sh บูตสภาพแวดล้อมแบบนั้นอยู่จริงเมื่อ CLAUDE_CODE_REMOTE=true)
 * ต้องบอกเหตุผลแล้วจบสวย ๆ ไม่ใช่ปล่อยให้ MCP handshake ค้างหรือพังแบบไม่มีคำอธิบาย
 */
export function unavailableReason() {
  if (process.env.CLAUDE_CODE_REMOTE === 'true') {
    return 'session นี้รันบน remote sandbox ซึ่งไม่มี gcloud และไม่มี cloud-sql-proxy — ตั้งใจไม่ให้ต่อ prod จากตรงนี้'
  }
  return null
}
