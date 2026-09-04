#!/usr/bin/env node
/**
 * MCP server อ่านอย่างเดียวสำหรับถามสถานะ production ของ BESTCHOICE ตอนพัฒนา
 *
 * stdout ของ process นี้คือช่อง JSON-RPC — ห้ามพิมพ์อะไรลงไปนอกจาก protocol
 * ข้อความสำหรับคนอ่านทั้งหมดต้องไปทาง stderr เท่านั้น
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { Proxy, unavailableReason } from './proxy.mjs'
import { Db } from './db.mjs'
import { TOOLS } from './tools.mjs'

const CONFIG = join(homedir(), '.config', 'bestchoice-mcp', 'env')
const log = (...a) => process.stderr.write(a.join(' ') + '\n')

/**
 * รหัสอ่านจากไฟล์นอกเรโป ไม่ใช่ดึงจาก Secret Manager ตอนสตาร์ท
 * gcloud ค้างได้ ~31 วินาทีถ้า token หมดอายุ และ MCP handshake จะค้างตามไปด้วย
 * ตั้งค่าครั้งเดียวด้วย: bash .claude/mcp/setup.sh
 */
function readConfig() {
  if (!existsSync(CONFIG)) return null
  const env = {}
  for (const line of readFileSync(CONFIG, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env.MCP_RO_PASSWORD ? env : null
}

const proxy = new Proxy()
let db = null
let banner = ''

async function connect() {
  const why = unavailableReason()
  if (why) throw new Error(why)

  const cfg = readConfig()
  if (!cfg) throw new Error(`ยังไม่ได้ตั้งค่า — รัน \`bash .claude/mcp/setup.sh\` (จะเขียน ${CONFIG})`)

  const socketPath = await proxy.start()
  db = new Db({
    socketDir: socketPath.slice(0, socketPath.lastIndexOf('/')),
    database: cfg.MCP_DATABASE || 'bestchoice',
    user: cfg.MCP_USER || 'mcp_ro',
    password: cfg.MCP_RO_PASSWORD,
  })

  const id = await db.assertIdentity()      // ต่อผิดฐาน = ตอบผิดแบบไม่รู้ตัว ต้องตายตรงนี้
  const drift = await db.aclDrift()
  if (drift.missing.length || drift.extra.length) {
    banner =
      `⚠️ สิทธิ์บนฐานไม่ตรงกับ sql/grants.sql ที่ commit ไว้ ` +
      `(ขาด ${drift.missing.length} · เกิน ${drift.extra.length} จากที่คาดไว้ ${drift.expected})\n` +
      `   สาเหตุที่พบบ่อย: migration เพิ่มคอลัมน์ใหม่ หรือฐานถูก restore/provision ใหม่จนสิทธิ์หาย\n` +
      `   แก้: รัน \`npm run grants\` ใน .claude/mcp แล้ว apply sql/grants.sql ใหม่\n` +
      (drift.extra.length ? `   ⚠️ "เกิน" อันตรายกว่า — แปลว่ามีคอลัมน์ที่นโยบายไม่อนุญาตแต่กลับอ่านได้: ${drift.extra.slice(0, 8).join(', ')}\n` : '')
    log(banner)
  }
  log(`bestchoice-mcp: ต่อ ${id.db} ในนาม ${id.usr} · สิทธิ์ ${drift.live} คอลัมน์`)
}

const server = new Server(
  { name: 'bestchoice-db', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}))

server.setRequestHandler(CallToolRequestSchema, async req => {
  const tool = TOOLS.find(t => t.name === req.params.name)
  if (!tool) return { isError: true, content: [{ type: 'text', text: `ไม่รู้จัก tool: ${req.params.name}` }] }

  if (!db) {
    try { await connect() } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `ต่อฐานไม่ได้: ${e.message}` }] }
    }
  }
  const r = await tool.run(db, req.params.arguments || {})
  return {
    isError: !!r.isError,
    content: [{ type: 'text', text: (banner ? banner + '\n' : '') + r.text }],
  }
})

const shutdown = () => { try { proxy.stop() } catch {}; db?.close?.(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('exit', () => { try { proxy.stop() } catch {} })

await server.connect(new StdioServerTransport())
log('bestchoice-mcp: พร้อม (ต่อฐานจริงตอนเรียก tool ครั้งแรก)')
