-- Payroll D4 ส่วนที่ 2 — หัก ณ ที่จ่ายค่าคอม 3% (คำตัดสินเจ้าของ 2026-10-29)
-- รายการหักที่ server เขียน: 3% ของค่าคอมงวดนี้หลังหักคืน · Cr บัญชีภ.ง.ด.1 ค้างจ่าย · ยื่น ภ.ง.ด.1 ใบเดียวกับภาษีเงินเดือน
ALTER TYPE "PayrollDeductionSource" ADD VALUE IF NOT EXISTS 'COMMISSION_WHT';
