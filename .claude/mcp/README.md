# bestchoice-db — MCP อ่านสถานะ production ตอนพัฒนา

ตอบคำถามที่เมื่อก่อนต้องเดา: *"prod มีแถวสิทธิ์นี้ไหม" · "แคตตาล็อกว่างจริงหรือเปล่า" ·
"migration ลงหรือยัง" · "system_config ตั้งค่าตัวนี้ไว้ว่าอะไร"*

## ทำไมอยู่ใน `.claude/`

`deploy-gcp.yml` มี `paths-ignore` ครอบ `.claude/**` — commit ที่นี่จึง**ไม่ทริกเกอร์ deploy**
ถ้าย้ายไป `tools/` หรือที่อื่น commit เดียวจะยิง `prisma migrate deploy` ขึ้น prod ทันที

> ⚠️ `.mcp.json` ที่รากเรโป **ไม่ได้** อยู่ใน paths-ignore — commit ไฟล์นั้นจะ deploy หนึ่งรอบ
> ถ้าไม่อยากให้ deploy ให้ใส่ `.mcp.json` ใน `.gitignore` แล้วเก็บไว้ในเครื่องอย่างเดียว

## ตั้งค่า

```bash
cd .claude/mcp && npm install
npm run grants                 # อ่านโครงตารางจริง → sql/grants.sql + sql/grants-report.md
bash setup.sh                  # สร้าง role บน prod + ให้สิทธิ์ + เก็บรหัสไว้ ~/.config/bestchoice-mcp/env
```
`setup.sh` ทำกับ prod แค่ `CREATE ROLE` + `REVOKE` + `GRANT` — ไม่แตะข้อมูล ไม่แตะโครงตาราง ไม่รีสตาร์ท

## Tool

| tool | ใช้ทำอะไร |
|---|---|
| `db_query(sql, limit)` | รัน SELECT · cursor ฝั่งเซิร์ฟเวอร์ · เพดาน 100 แถว (สูงสุด 1000) และ 100 KB |
| `db_schema(table?)` | คอลัมน์ ชนิด คีย์ index (เห็น partial index ที่ไม่มีใน schema.prisma) และบอกว่าคอลัมน์ไหนถูกกันเพราะเป็น PII |
| `db_tables(pattern?)` | นับแถวจริงด้วย `count(*)` |

## ข้อมูลส่วนบุคคล

สำรวจ prod 2026-09-04: **`chat_messages` 115,437 แถว · `chat_rooms` 8,217 ห้อง (Facebook ล้วน)**
ในนั้น 488 ข้อความมีเบอร์มือถือ · 375 มีเลข 13 หลัก · **20,257 มีรูปแนบ** (ธุรกิจนี้ = บัตร/สลิป/ทะเบียนบ้าน)
· 8,201 ห้องมีชื่อจริงบน Facebook

**นี่คือข้อมูลของคนจริง ไม่ใช่ข้อมูลทดสอบ** แม้ `docs/CONTRIBUTING.md` จะบอกว่า prod เป็น throwaway
(ซึ่งจริงเฉพาะฝั่ง ERP — ลูกค้า 98 · ขาย 6 · สัญญา 23)

role `mcp_ro` จึงมองไม่เห็น `chat_messages.text`, `media_url`, `chat_rooms.display_name`,
`picture_url`, `ai_sales_state`, `line_user_id` และคอลัมน์ PII อื่นอีกรวม **567 จาก 2,964 คอลัมน์**

### กติกาที่ห้ามแก้
- **ห้าม `GRANT SELECT ON <table>` ทั้งตาราง** — ACL ระดับตารางครอบคอลัมน์ที่ migration เพิ่มทีหลังโดยอัตโนมัติ = fail-**open**
  ต้อง grant ราย column เสมอ คอลัมน์ใหม่จึงไม่มีสิทธิ์โดยปริยาย = fail-**closed**
- **ห้ามใส่ `ALTER DEFAULT PRIVILEGES`** — สั่งระดับคอลัมน์ไม่ได้ และรูปแบบระดับตารางทำให้ตารางใหม่อ่านได้อัตโนมัติ
- `ALTER ROLE ... SET statement_timeout` เป็น **USERSET GUC — client สั่งทับได้**
  ตัวกันการเขียนจริงคือ**การไม่มีสิทธิ์ INSERT/UPDATE/DELETE** เท่านั้น ที่เหลือคือกันเผลอ

### หลัง migration ที่เพิ่มคอลัมน์
คิวรี่จะพังด้วย `permission denied for table ...` (PostgreSQL ไม่มี error ระดับคอลัมน์ ข้อความจึงกำกวม —
ตัว MCP แปลให้แล้ว) แก้ด้วย `npm run grants` แล้ว apply `sql/grants.sql` ใหม่
ตอนสตาร์ททุกครั้ง server จะเทียบสิทธิ์จริงกับ `grants.sql` แล้วเตือนถ้าไม่ตรง

## ถอนออก

```sql
\c bestchoice
DROP OWNED BY mcp_ro;
\c postgres
DROP OWNED BY mcp_ro;     -- DROP OWNED BY ทำงานต่อ database ข้ามขั้นนี้จะเหลือ role ล็อกอินได้ค้างบน prod
DROP ROLE mcp_ro;
```
แล้วลบ `~/.config/bestchoice-mcp/env`

## ข้อจำกัดที่รู้อยู่

- **session บน remote sandbox ใช้ไม่ได้** (ไม่มี gcloud/proxy) — server จะจบพร้อมข้อความอธิบาย ไม่ค้าง
- grant กันไม่ให้*ดึง* PII ได้ แต่กันไม่ได้ว่าสิ่งที่อ่านมาจะไปค้างใน transcript ของ Claude Code บนเครื่อง — **นั่นเป็นนโยบาย ไม่ใช่กลไก**
- `system_config.value` อ่านได้ (จำเป็นต่องาน) แต่โดยธรรมชาติมันเก็บอะไรก็ได้
