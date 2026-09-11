-- GFIN: เรทขึ้นกับ (จำนวนงวด, % คอมมิชชั่นที่ร้านเลือก) — แถวเดิมทั้งหมดถือเป็นคอม 15%
ALTER TABLE "gfin_rate_factors" ADD COLUMN "shop_commission_pct" INTEGER NOT NULL DEFAULT 15;
DROP INDEX "gfin_rate_factors_months_key";
CREATE UNIQUE INDEX "gfin_rate_factors_months_shop_commission_pct_key" ON "gfin_rate_factors"("months", "shop_commission_pct");

-- GFIN: ผ่อนได้สูงสุด (งวด) ต่อซีรีส์/สภาพ ตามตารางราคา GFIN — null = ไม่จำกัด
ALTER TABLE "gfin_overprice_rules" ADD COLUMN "max_months" INTEGER;
