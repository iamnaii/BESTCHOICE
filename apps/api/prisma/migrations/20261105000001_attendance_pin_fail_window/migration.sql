-- ลงเวลา (ก้อน 10 D3 · รีวิว minor): ตัวนับรหัสผิดนับเฉพาะช่วง 15 นาที
ALTER TABLE "attendance_devices" ADD COLUMN "pin_last_fail_at" TIMESTAMP(3);
