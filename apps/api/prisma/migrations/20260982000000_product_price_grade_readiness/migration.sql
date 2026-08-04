-- AlterTable
ALTER TABLE "products" ADD COLUMN     "accessories_included" JSONB,
ADD COLUMN     "cosmetic_notes" TEXT,
ADD COLUMN     "price_autofilled_at" TIMESTAMP(3);

-- === B0: บังคับ invariant "1 product = 1 แถว isDefault" ===
-- ผู้อ่านที่พึ่ง invariant นี้: write-through util, search_products tool,
-- calculate_installment tool (ทั้งคู่ take:1 โดยไม่มี orderBy = สุ่มแถวถ้ามี 2)

-- 1) pre-check: log แถวที่ซ้ำไว้ก่อน (ดูใน migration output ตอนรัน)
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

-- 2) dedupe: เก็บแถวที่เก่าที่สุด (createdAt asc, id เป็น tie-breaker) เหลือ default เดียว
UPDATE product_prices p SET is_default = false
WHERE p.is_default AND p.deleted_at IS NULL
  AND p.id <> (
    SELECT q.id FROM product_prices q
    WHERE q.product_id = p.product_id AND q.is_default AND q.deleted_at IS NULL
    ORDER BY q.created_at ASC, q.id ASC
    LIMIT 1
  );

-- 3) index จริง
CREATE UNIQUE INDEX IF NOT EXISTS product_prices_one_default
  ON product_prices(product_id)
  WHERE is_default AND deleted_at IS NULL;
