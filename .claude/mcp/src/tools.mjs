import { checkReadOnly } from './guard.mjs'
import { DEFAULT_LIMIT, MAX_LIMIT, explainError } from './db.mjs'

const SOFT_DELETE_WARNING =
  'ฐานนี้ใช้ soft delete: 131 จาก 198 โมเดลมีคอลัมน์ deleted_at และ Prisma ไม่ได้กรองให้อัตโนมัติ ' +
  '(PrismaService เป็น PrismaClient เปล่า ๆ ไม่มี $extends) — ถ้าไม่ใส่ `deleted_at IS NULL` เอง ' +
  'จะได้แถวที่ถูกลบไปแล้วปนมาด้วย เช่น การขายที่ถูก void. ' +
  'และตัวเลขรวมจะเพี้ยนถ้าไม่กรอง branch_id หรือ scope SHOP/FINANCE ตามที่โจทย์ต้องการ'

export const TOOLS = [
  {
    name: 'db_query',
    description:
      'รัน SELECT อ่านอย่างเดียวบนฐานข้อมูล production ของ BESTCHOICE แล้วคืนแถวข้อมูล\n' +
      'ใช้ตอบคำถามอย่าง "prod มีแถวสิทธิ์นี้ไหม" "แคตตาล็อกว่างจริงหรือเปล่า" "migration ลงหรือยัง" ' +
      '"system_config ตั้งค่าตัวนี้ไว้ว่าอะไร" แทนการเดา\n\n' +
      '⚠️ ' + SOFT_DELETE_WARNING + '\n\n' +
      '⚠️ role นี้มองไม่เห็นคอลัมน์ที่เป็นข้อมูลส่วนบุคคล (เนื้อความแชท ชื่อ เบอร์ ที่อยู่ เลขบัตร รูป) ' +
      'ถ้าเจอ "permission denied for table X" ส่วนใหญ่แปลว่าไปแตะคอลัมน์ต้องห้าม ไม่ใช่ทั้งตารางถูกห้าม — ' +
      'ใช้ db_schema ดูก่อนว่าคอลัมน์ไหนใช้ได้ และเลี่ยง SELECT *',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'คำสั่ง SELECT เดียว (ห้ามหลายคำสั่งคั่นด้วย ;)' },
        limit: { type: 'integer', description: `จำนวนแถวสูงสุด ค่าเริ่มต้น ${DEFAULT_LIMIT} สูงสุด ${MAX_LIMIT}`, minimum: 1, maximum: MAX_LIMIT },
      },
      required: ['sql'],
    },
    async run(db, { sql, limit }) {
      const g = checkReadOnly(sql)
      if (!g.ok) return { isError: true, text: `ปฏิเสธคำสั่ง: ${g.reason}` }
      try {
        const r = await db.runSelect(sql, limit ?? DEFAULT_LIMIT)
        const head = `${r.rowCount} แถว · ${r.durationMs} ms` +
          (r.truncated ? ` · ตัดแล้ว (${r.truncatedReason})` : '')
        return { text: `${head}\n\n${JSON.stringify(r.rows, null, 2)}` }
      } catch (e) {
        return { isError: true, text: explainError(e) }
      }
    },
  },

  {
    name: 'db_schema',
    description:
      'ดูโครงตารางจริงจากฐาน production — คอลัมน์ ชนิด ค่าเริ่มต้น คีย์ และ index ทั้งหมด\n' +
      'อ่านจาก pg_catalog ไม่ใช่ information_schema (information_schema กรองตามสิทธิ์ จะมองไม่เห็นคอลัมน์ที่ตัวเองถูกตัดพอดี) ' +
      'จึงเห็นคอลัมน์ครบและบอกได้ว่าอันไหนใช้ได้ อันไหนถูกกันเพราะเป็น PII\n' +
      'ดีกว่าอ่าน schema.prisma ตรงที่เห็น partial index ซึ่งมีอยู่แค่ใน SQL migration ' +
      '(เช่น product_prices_one_default, IMEI partial unique, contacts_national_id_hash_active_key)',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string', description: 'ชื่อตาราง ถ้าไม่ใส่จะลิสต์ตารางทั้งหมด' } },
    },
    async run(db, { table }) {
      try {
        if (!table) {
          const { rows } = await db.query(`
            SELECT c.relname AS ตาราง,
                   pg_size_pretty(pg_total_relation_size(c.oid)) AS ขนาด
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p')
            ORDER BY pg_total_relation_size(c.oid) DESC`)
          return { text: `${rows.length} ตาราง\n\n${JSON.stringify(rows, null, 2)}` }
        }

        const cols = await db.query(`
          SELECT a.attname AS คอลัมน์,
                 format_type(a.atttypid, a.atttypmod) AS ชนิด,
                 NOT a.attnotnull AS "null_ได้",
                 pg_get_expr(d.adbin, d.adrelid) AS "ค่าเริ่มต้น",
                 has_column_privilege(c.oid, a.attnum, 'SELECT') AS "อ่านได้"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
          LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
          WHERE n.nspname='public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`, [table])
        if (!cols.rows.length) return { isError: true, text: `ไม่พบตาราง "${table}" ใน schema public` }

        const idx = await db.query(
          `SELECT indexname AS ชื่อ, indexdef AS นิยาม FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`,
          [table])
        const fkOut = await db.query(`
          SELECT conname AS ชื่อ, pg_get_constraintdef(oid) AS นิยาม
          FROM pg_constraint WHERE conrelid = to_regclass('public.' || $1) AND contype='f'`, [table])
        const fkIn = await db.query(`
          SELECT conrelid::regclass::text AS "ตารางที่อ้างมา", conname AS ชื่อ, pg_get_constraintdef(oid) AS นิยาม
          FROM pg_constraint WHERE confrelid = to_regclass('public.' || $1) AND contype='f'
          ORDER BY 1`, [table])

        const denied = cols.rows.filter(r => !r['อ่านได้']).map(r => r['คอลัมน์'])
        const out = {
          ตาราง: table,
          คอลัมน์: cols.rows,
          'คอลัมน์ที่ถูกกันไว้ (PII)': denied.length ? denied : 'ไม่มี',
          index: idx.rows,
          'foreign key ออก': fkOut.rows,
          'ถูกอ้างจาก': fkIn.rows,
        }
        return { text: JSON.stringify(out, null, 2) }
      } catch (e) {
        return { isError: true, text: explainError(e) }
      }
    },
  },

  {
    name: 'db_tables',
    description:
      'นับจำนวนแถวจริงในตาราง ใช้ตอบ "prod มีข้อมูลจริงแล้วหรือยัง"\n' +
      'ใช้ count(*) จริง ไม่ใช้ค่าประมาณจาก reltuples เพราะ reltuples คืน -1 (ไม่ใช่ 0) ' +
      'สำหรับตารางที่ไม่เคยถูก ANALYZE ซึ่งจะกลายเป็นคำตอบที่ผิดแบบดูน่าเชื่อ',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'กรองชื่อตารางแบบ SQL LIKE เช่น chat_% (ไม่ใส่ = ทุกตาราง)' },
        maxTables: { type: 'integer', description: 'นับได้ไม่เกินกี่ตาราง ค่าเริ่มต้น 40', minimum: 1, maximum: 250 },
      },
    },
    async run(db, { pattern, maxTables }) {
      try {
        const cap = Math.min(maxTables ?? 40, 250)
        const { rows: names } = await db.query(`
          SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p') AND ($1::text IS NULL OR c.relname LIKE $1)
          ORDER BY c.relname`, [pattern ?? null])
        if (!names.length) return { text: `ไม่มีตารางที่ตรงกับ ${pattern ?? '(ทั้งหมด)'}` }

        const picked = names.slice(0, cap).map(r => r.relname)
        // นับทุกตารางในคิวรี่เดียว เร็วกว่ายิงทีละนัดมาก
        // ชื่อตารางมาจาก pg_catalog อยู่แล้ว แต่ escape ทั้งสองแบบไว้กันเหนียว
        const lit = s => `'${String(s).replace(/'/g, "''")}'`
        const ident = s => `"${String(s).replace(/"/g, '""')}"`
        const union = picked
          .map(t => `SELECT ${lit(t)} AS "ตาราง", count(*) AS "แถว" FROM public.${ident(t)}`)
          .join(' UNION ALL ')
        const { rows } = await db.query(`${union} ORDER BY 2 DESC`)
        const note = names.length > picked.length
          ? `\n\n⚠️ มี ${names.length} ตารางที่ตรงเงื่อนไข แต่นับให้แค่ ${picked.length} ตัวแรกตามลำดับตัวอักษร — ใส่ pattern ให้แคบลงหรือเพิ่ม maxTables`
          : ''
        return { text: `${rows.length} ตาราง${note}\n\n${JSON.stringify(rows, null, 2)}` }
      } catch (e) {
        return { isError: true, text: explainError(e) }
      }
    },
  },
]
