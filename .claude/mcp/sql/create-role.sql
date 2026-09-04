-- สร้าง "ถุงสิทธิ์" สำหรับ MCP — รันครั้งเดียว ต้องรันด้วย role ที่เป็นเจ้าของตาราง (bestchoice)
--
-- ไม่แตะข้อมูล ไม่แตะโครงตาราง ไม่ต้องรีสตาร์ท instance
-- GRANT ไม่ล็อกตาราง (ทดสอบแล้ว: คืนใน 0.028 วิ ขณะมี transaction ค้างอยู่บนตารางเดียวกัน)
--
-- 🔑 mcp_ro เป็น **NOLOGIN group role** — ตัวมันเองล็อกอินไม่ได้และไม่มีรหัสผ่าน
--    หน้าที่เดียวคือถือ GRANT ราย column ไว้ที่เดียว แล้วแจกให้คนด้วย
--        GRANT mcp_ro TO "<อีเมล gcloud>";
--    การยืนยันตัวตนใช้ Cloud SQL IAM authentication (flag cloudsql.iam_authentication=on)
--    ⇒ ไม่มีรหัสผ่านอยู่ที่ไหนเลย · เพิกถอนรายคนด้วย REVOKE ไม่ต้องหมุนรหัสของใคร
--
-- ⚠️ ตัวที่กันการเขียนจริงคือ "การไม่มีสิทธิ์ INSERT/UPDATE/DELETE" เท่านั้น
--    ค่า SET ข้างล่างเป็น USERSET GUC ซึ่ง client สั่งทับได้ด้วย
--    SELECT set_config('statement_timeout','0',false)
--    จึงเป็นแค่กันเผลอ ไม่ใช่ขอบเขตความปลอดภัย — พิสูจน์บน prod แล้วว่าปลดได้จริง
--    (แต่ปลดแล้วก็ยังเขียนไม่ได้ ติด permission denied ทุกคำสั่ง — นั่นคือขอบเขตจริง)

\set ON_ERROR_STOP on

SELECT 'CREATE ROLE mcp_ro NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_ro')
\gexec

-- ปิดทางล็อกอินเดิม เผื่อ role ถูกสร้างไว้แบบมีรหัสจากรุ่นก่อน
ALTER ROLE mcp_ro NOLOGIN;
ALTER ROLE mcp_ro PASSWORD NULL;

-- สิทธิ์ขั้นต่ำที่ต้องมีไม่งั้น tool ทำงานไม่ได้เลย (สมาชิกสืบทอดสองอย่างนี้ได้)
GRANT CONNECT ON DATABASE bestchoice TO mcp_ro;
GRANT USAGE ON SCHEMA public TO mcp_ro;

-- ❌ ห้ามใส่ ALTER DEFAULT PRIVILEGES ที่นี่
--    มันสั่งระดับคอลัมน์ไม่ได้ และรูปแบบระดับตารางจะทำให้ "ตารางใหม่" อ่านได้อัตโนมัติ = fail-OPEN
--    สิทธิ์ทั้งหมดมาจาก grants.sql ที่ generate จากโครงจริงเท่านั้น

REVOKE CREATE ON SCHEMA public FROM mcp_ro;

-- ── เพิ่มคน ────────────────────────────────────────────────────────
--   gcloud sql users create <อีเมล> --instance=bestchoice-db --type=cloud_iam_user
--   GRANT mcp_ro TO "<อีเมล>";
--   ⚠️ ALTER ROLE ... SET **ไม่ถ่ายทอด**ผ่านการเป็นสมาชิก ต้องตั้งให้ผู้ใช้จริงเองด้วย:
--   ALTER ROLE "<อีเมล>" SET default_transaction_read_only = on;
--   ALTER ROLE "<อีเมล>" SET statement_timeout = '15s';
--   ALTER ROLE "<อีเมล>" SET idle_in_transaction_session_timeout = '30s';
--   ALTER ROLE "<อีเมล>" SET lock_timeout = '3s';
--   ALTER ROLE "<อีเมล>" SET application_name = 'bestchoice-mcp';
--   และให้ IAM role: roles/cloudsql.instanceUser + roles/cloudsql.client
--
-- ── ถอนคนออก (ทันที ไม่กระทบคนอื่น) ──────────────────────────────
--   REVOKE mcp_ro FROM "<อีเมล>";
--
-- ── ถอนออกทั้งหมด ────────────────────────────────────────────────
-- ⚠️ DROP OWNED BY ทำงาน "ต่อ database" ไม่ใช่ทั้ง cluster
--    ต้องรันในทุก database ที่เคย grant ก่อน ไม่งั้น DROP ROLE จะไม่ผ่าน
--
--   \c bestchoice
--   DROP OWNED BY mcp_ro;
--   \c postgres
--   DROP OWNED BY mcp_ro;
--   DROP ROLE mcp_ro;
