-- สร้าง role อ่านอย่างเดียวสำหรับ MCP — รันครั้งเดียว ต้องรันด้วย role ที่เป็นเจ้าของตาราง (bestchoice)
--
-- ไม่แตะข้อมูล ไม่แตะโครงตาราง ไม่ต้องรีสตาร์ท instance
-- GRANT ไม่ล็อกตาราง (ทดสอบแล้ว: คืนใน 0.028 วิ ขณะมี transaction ค้างอยู่บนตารางเดียวกัน)
--
-- ⚠️ ตัวที่กันการเขียนจริงคือ "การไม่มีสิทธิ์ INSERT/UPDATE/DELETE" เท่านั้น
--    ค่า SET ข้างล่างเป็น USERSET GUC ซึ่ง client สั่งทับได้ด้วย
--    SELECT set_config('statement_timeout','0',false)
--    จึงเป็นแค่กันเผลอ ไม่ใช่ขอบเขตความปลอดภัย — อย่าไปเชื่อว่ามันแข็ง

\set ON_ERROR_STOP on

-- ⚠️ ห้ามใส่ :'mcp_password' ไว้ใน DO $$ ... $$
--    psql ไม่แทนค่าตัวแปรข้างใน dollar-quoted string รหัสจะกลายเป็นข้อความ ":'mcp_password'" ตรง ๆ
--    ใช้ \gexec แทน: ประกอบคำสั่งด้วย format() นอก dollar-quote แล้วให้ psql รันผลลัพธ์
SELECT format('CREATE ROLE mcp_ro LOGIN PASSWORD %L', :'mcp_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_ro')
\gexec

SELECT format('ALTER ROLE mcp_ro LOGIN PASSWORD %L', :'mcp_password')
\gexec

-- กันเผลอ (ไม่ใช่ขอบเขตความปลอดภัย ดูหมายเหตุข้างบน)
ALTER ROLE mcp_ro SET default_transaction_read_only = on;
ALTER ROLE mcp_ro SET statement_timeout = '15s';
ALTER ROLE mcp_ro SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE mcp_ro SET lock_timeout = '3s';
ALTER ROLE mcp_ro SET application_name = 'bestchoice-mcp';   -- ให้ตามรอยได้ใน pg_stat_activity

-- สิทธิ์ขั้นต่ำที่ต้องมีไม่งั้น tool ทำงานไม่ได้เลย
GRANT CONNECT ON DATABASE bestchoice TO mcp_ro;
GRANT USAGE ON SCHEMA public TO mcp_ro;

-- ❌ ห้ามใส่ ALTER DEFAULT PRIVILEGES ที่นี่
--    มันสั่งระดับคอลัมน์ไม่ได้ และรูปแบบระดับตารางจะทำให้ "ตารางใหม่" อ่านได้อัตโนมัติ = fail-OPEN
--    สิทธิ์ทั้งหมดมาจาก grants.sql ที่ generate จากโครงจริงเท่านั้น

-- ปิดไม่ให้สร้างอะไรใน public
REVOKE CREATE ON SCHEMA public FROM mcp_ro;

-- ── วิธีถอนออกทั้งหมด ────────────────────────────────────────────────
-- ⚠️ DROP OWNED BY ทำงาน "ต่อ database" ไม่ใช่ทั้ง cluster
--    ต้องรันในทุก database ที่เคย grant ก่อน ไม่งั้น DROP ROLE จะไม่ผ่าน
--    และถ้าข้ามขั้นนี้จะเหลือ role ที่ล็อกอินได้ค้างอยู่บน prod
--
--   \c bestchoice
--   DROP OWNED BY mcp_ro;
--   \c postgres
--   DROP OWNED BY mcp_ro;
--   DROP ROLE mcp_ro;
