# bestchoice-db — MCP อ่านสถานะ production ตอนพัฒนา

ตอบคำถามที่เมื่อก่อนต้องเดา: *"prod มีแถวสิทธิ์นี้ไหม" · "แคตตาล็อกว่างจริงหรือเปล่า" ·
"migration ลงหรือยัง" · "system_config ตั้งค่าตัวนี้ไว้ว่าอะไร"*

## ทำไมอยู่ใน `.claude/`

`deploy-gcp.yml` มี `paths-ignore` ครอบ `.claude/**` — commit ที่นี่จึง**ไม่ทริกเกอร์ deploy**
ถ้าย้ายไป `tools/` หรือที่อื่น commit เดียวจะยิง `prisma migrate deploy` ขึ้น prod ทันที

> ⚠️ `.mcp.json` ที่รากเรโป **ไม่ได้** อยู่ใน paths-ignore — commit ไฟล์นั้นจะ deploy หนึ่งรอบ
> จึงใส่ `/.mcp.json` ไว้ใน `.gitignore` แล้ว (ดู "ต่อให้ Claude Code เห็น" ข้างล่าง)

## ตั้งค่า

```bash
cd .claude/mcp && npm install
bash setup.sh                  # สร้าง IAM DB user + ผูกเข้ากับ mcp_ro + ตรวจด้วยเส้นทางจริง
```

**ไม่มีรหัสผ่านอยู่ที่ไหนเลย** — ใช้ Cloud SQL IAM authentication: `cloud-sql-proxy --auto-iam-authn`
เอา token ของบัญชี gcloud ที่ล็อกอินอยู่ไปยืนยันตัวตนกับฐานให้

`~/.config/bestchoice-mcp/env` เก็บแค่ `MCP_USER` (อีเมล) กับ `MCP_DATABASE` — ไม่มีความลับ

## ต่อให้ Claude Code เห็น

```bash
claude mcp add --scope user bestchoice-db node \
  /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/mcp/src/index.mjs
claude mcp list      # ต้องขึ้น "bestchoice-db: ... ✓ Connected"
```

**ทำไมต้อง `--scope user` และทำไม path ต้องเป็น absolute** — Claude Code อ่าน `.mcp.json`
จาก**โฟลเดอร์ที่เปิด session** ไม่ใช่รากเรโป และเครื่องนี้เปิดจากทั้ง `~/Desktop/App`
(โฟลเดอร์รวมหลายโปรเจกต์) และ `~/Desktop/App/BESTCHOICE` ⇒ วาง `.mcp.json` ที่เดียวไม่ครอบทั้งสองแบบ
ส่วน path แบบ relative ใน `args` จะถูกตีความเทียบกับ cwd ของ session ซึ่งชี้ผิดทันทีที่เปิดจากที่อื่น

`.mcp.json` ที่รากเรโปยังมีอยู่ (gitignore ไว้) เป็นทางสำรองตอนเปิด session ที่ `BESTCHOICE/` โดยตรง

**ต้องเปิด session ใหม่หลังลงทะเบียน** — session ที่เปิดค้างอยู่จะยังไม่เห็น

## ต่อกับ Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "bestchoice-db": {
      "command": "/Users/<คุณ>/.nvm/versions/node/v24.14.1/bin/node",
      "args": ["/Users/<คุณ>/Desktop/App/BESTCHOICE/.claude/mcp/src/index.mjs"],
      "env": {
        "PATH": "/Users/<คุณ>/.local/google-cloud-sdk/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "CLOUD_SQL_PROXY_BIN": "/Users/<คุณ>/.local/google-cloud-sdk/bin/cloud-sql-proxy"
      }
    }
  }
}
```

🚨 **ทุก path ต้องเป็น absolute และต้องตั้ง `env` เอง** — Claude Desktop เปิด MCP server ด้วย
PATH ขั้นต่ำ ไม่ใช่ PATH ของ shell ⇒ `node` (nvm), `gcloud` และ `cloud-sql-proxy`
(`~/.local/google-cloud-sdk/bin`) หาไม่เจอทั้งหมด

`CLOUD_SQL_PROXY_BIN` มีไว้เพราะ `proxy.mjs` ต้อง **spawn** ตัว proxy เอง — ลำพัง `PATH` ใน `env`
ก็พอ แต่ระบุ path เต็มไว้ด้วยทำให้ข้อความ error ตรงจุดเวลาย้ายเครื่อง

ทดสอบก่อนเปิดแอปจริงได้ด้วยการจำลอง env แบบเดียวกัน (ดู `env -i` ในประวัติ commit นี้)

## ❌ Claude web (claude.ai) ต่อตัวนี้ไม่ได้

เว็บรันบนเซิร์ฟเวอร์ Anthropic ไม่ใช่เครื่องเรา จึงเปิด **stdio server ในเครื่องไม่ได้เลย**
รับได้เฉพาะ remote MCP (HTTP/SSE + OAuth) ซึ่งแปลว่าต้อง deploy ตัวนี้ขึ้นเน็ต **และทำ auth ใหม่ทั้งชุด**
เพราะ `--auto-iam-authn` พึ่ง gcloud ในเครื่อง ซึ่งบนเซิร์ฟเวอร์ไม่มี — เป็นงานคนละชิ้น
(เฟส 2: ผู้ช่วยของเจ้าของร้าน) ไม่ใช่แค่ตั้งค่าเพิ่ม
`sql/grants.sql` ถูก generate ไว้แล้วและ commit อยู่ในเรโป — `setup.sh` ใช้ไฟล์นั้นเลย

**สร้างใหม่หลัง migration ที่เพิ่มคอลัมน์** (ต้องมี proxy + `PGURL` เอง — `npm run grants` เฉย ๆ ไม่พอ):
```bash
cloud-sql-proxy --port 15432 bestchoice-prod:asia-southeast1:bestchoice-db &
PGURL="postgresql://bestchoice:<รหัส>@127.0.0.1:15432/bestchoice?sslmode=disable" npm run grants
psql "$PGURL" -v ON_ERROR_STOP=1 -f sql/grants.sql
```
(รหัสอยู่ใน Secret Manager `DATABASE_URL` — ต้องใช้ role เจ้าของตาราง ไม่ใช่ `mcp_ro`)
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

**นี่คือข้อมูลของคนจริง ไม่ใช่ข้อมูลทดสอบ** — ตรงกับที่ `docs/CONTRIBUTING.md` และ
`docs/runbooks/go-live-checklist.md` ระบุไว้แล้ว: "ข้อมูลทดสอบ" จริงเฉพาะฝั่ง ERP
(ลูกค้า 98 · ขาย 6 · สัญญา 23)

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

## เพิ่มเครื่อง / เพิ่มคน

เครื่องใหม่ของ**คนเดิม**: ล็อกอิน gcloud บัญชีเดิม → `npm install` → `bash setup.sh` → `claude mcp add`
**ไม่ต้องขนความลับข้ามเครื่องเลย** เพราะไม่มีความลับให้ขน

คนใหม่: เขารัน `setup.sh` เอง (สคริปต์สร้าง IAM DB user ของบัญชีเขาแล้วผูกเข้า `mcp_ro` ให้)
ต้องมี IAM role `roles/cloudsql.instanceUser` + `roles/cloudsql.client` บนโปรเจกต์

**ถอนคนออก** — ทันที ไม่กระทบคนอื่น ไม่ต้องหมุนรหัสของใคร:
```sql
REVOKE mcp_ro FROM "someone@example.com";
```

## ถอนออกทั้งหมด

```sql
\c bestchoice
DROP OWNED BY mcp_ro;
\c postgres
DROP OWNED BY mcp_ro;     -- DROP OWNED BY ทำงานต่อ database ข้ามขั้นนี้ DROP ROLE จะไม่ผ่าน
DROP ROLE mcp_ro;
```
แล้ว `gcloud sql users delete <อีเมล> --instance=bestchoice-db` + ลบ `~/.config/bestchoice-mcp/env`
+ `claude mcp remove --scope user bestchoice-db`

## ข้อจำกัดที่รู้อยู่

- **session บน remote sandbox ใช้ไม่ได้** (ไม่มี gcloud/proxy) — server จะจบพร้อมข้อความอธิบาย ไม่ค้าง
- grant กันไม่ให้*ดึง* PII ได้ แต่กันไม่ได้ว่าสิ่งที่อ่านมาจะไปค้างใน transcript ของ Claude Code บนเครื่อง — **นั่นเป็นนโยบาย ไม่ใช่กลไก**
- `ALTER ROLE ... SET` **ไม่ถ่ายทอด**ผ่านการเป็นสมาชิก group role ⇒ ต้องตั้ง guard ให้ผู้ใช้จริงทุกคน
  (`setup.sh` ทำให้แล้ว แต่ถ้าเพิ่มคนด้วยมือต้องไม่ลืม — ดู `sql/create-role.sql`)
- `system_config.value` อ่านได้ (จำเป็นต่องาน) แต่โดยธรรมชาติมันเก็บอะไรก็ได้
