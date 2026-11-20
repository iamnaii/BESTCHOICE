-- GFIN: ดาวน์ขั้นต่ำ % ของกลุ่มรุ่น (เต็มร้อย: 30 = 30%) — null = ใช้ค่าตั้ง gfin.minDownPct (สเปค price-master-retire ข้อ 3.3)
ALTER TABLE "gfin_overprice_rules" ADD COLUMN "min_down_pct" INTEGER;
