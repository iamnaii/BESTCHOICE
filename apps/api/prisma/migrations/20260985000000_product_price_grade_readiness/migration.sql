-- AlterTable
ALTER TABLE "products" ADD COLUMN     "accessories_included" JSONB,
ADD COLUMN     "cosmetic_notes" TEXT,
ADD COLUMN     "price_autofilled_at" TIMESTAMP(3);

-- === B0: บังคับ invariant "1 product = 1 แถว isDefault" ===
-- ผู้อ่านที่พึ่ง invariant นี้: write-through util, search_products tool,
-- calculate_installment tool (ทั้งคู่ take:1 โดยไม่มี orderBy = สุ่มแถวถ้ามี 2)

-- 1) pre-check: log แถวที่ซ้ำไว้ก่อน
-- ⚠️ Fix round 1: RAISE NOTICE ไม่ถูกส่งออก stdout ตอนรันผ่าน `prisma migrate deploy`
-- (Prisma migration engine ไม่ forward Postgres NOTICE) — ห้ามพึ่งบรรทัดนี้เป็นหลักฐาน
-- กู้คืน ใช้ตารางสำรองที่ข้อ 2 แทน ข้อนี้เก็บไว้เผื่อรันผ่าน psql ตรงๆ ที่เห็น NOTICE ได้
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT product_id FROM product_prices
    WHERE is_default AND deleted_at IS NULL
    GROUP BY product_id HAVING count(*) > 1
  ) d;
  RAISE NOTICE 'B0: products with >1 default price row = %', dup_count;
END $$;

-- 2) backup: เก็บของจริงของทุกแถวที่กำลังจะโดนปลด is_default ก่อน UPDATE
-- (Fix round 1: ทำให้ rollback ได้ด้วย SQL เดียวโดยไม่ต้องพึ่ง NOTICE log ที่มองไม่เห็นบน
-- `migrate deploy` — ดูคำสั่ง rollback เต็มในรายงาน task-2-report.md)
-- IF NOT EXISTS + "... AS SELECT" เป็น no-op ถ้าตารางมีอยู่แล้ว (Postgres ไม่รัน SELECT ซ้ำ) — idempotent เหมือน CREATE UNIQUE INDEX IF NOT EXISTS ด้านล่าง
CREATE TABLE IF NOT EXISTS "_b0_default_price_dedupe_backup" AS
SELECT p.id, p.product_id, p.is_default, p.created_at, now() AS backed_up_at
FROM product_prices p
WHERE p.is_default AND p.deleted_at IS NULL
  AND p.id <> (
    SELECT q.id FROM product_prices q
    WHERE q.product_id = p.product_id AND q.is_default AND q.deleted_at IS NULL
    ORDER BY q.created_at DESC, q.id DESC
    LIMIT 1
  );

-- 3) dedupe: เก็บแถว "ใหม่ที่สุด" (createdAt DESC, id เป็น tie-breaker) เหลือ default เดียว
-- ⚠️ Fix round 1 [Important]: เดิมเขียนไว้ ASC (เก็บแถวเก่าสุด) — ผิด เพราะทุก writer ใน
-- ระบบวันนี้เป็น last-write-wins (products-pricing.service.ts addPrice/updatePrice ปลด
-- default เดิมด้วย updateMany ก่อนตั้งแถวใหม่เป็น default เสมอ) ถ้ามีแถวซ้ำหลุดมาจริง แถว
-- ใหม่สุดคือเจตนาล่าสุดของคนตั้งราคา — เก็บแถวเก่าจะดันราคาเก่ากลับมาเป็น default เงียบๆ
-- แล้วบอท (search-products.tool.ts) จะควอตราคาเก่าให้ลูกค้า จึงเปลี่ยนเป็น DESC
UPDATE product_prices p SET is_default = false
WHERE p.is_default AND p.deleted_at IS NULL
  AND p.id <> (
    SELECT q.id FROM product_prices q
    WHERE q.product_id = p.product_id AND q.is_default AND q.deleted_at IS NULL
    ORDER BY q.created_at DESC, q.id DESC
    LIMIT 1
  );

-- 4) index จริง
CREATE UNIQUE INDEX IF NOT EXISTS product_prices_one_default
  ON product_prices(product_id)
  WHERE is_default AND deleted_at IS NULL;
