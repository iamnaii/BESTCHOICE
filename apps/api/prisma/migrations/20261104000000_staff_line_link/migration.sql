-- ก้อน 7 (A16) แจ้งพนักงานทาง LINE: ผูก userId ของ Staff OA รายคน (สเปก §13.1)
ALTER TABLE "users"
  ADD COLUMN "line_staff_user_id" TEXT,
  ADD COLUMN "line_link_code" TEXT,
  ADD COLUMN "line_link_code_expires_at" TIMESTAMP(3);

-- backfill: ถ้าเคยกรอก userId จริง (U + hex 32 ตัว) ไว้ในช่อง LINE ID และไม่ซ้ำกับคนอื่น ให้ใช้ต่อได้เลย
UPDATE "users" u
SET "line_staff_user_id" = u."line_id"
WHERE u."line_id" ~ '^U[0-9a-f]{32}$'
  AND u."line_staff_user_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."id" <> u."id" AND o."line_id" = u."line_id");

CREATE UNIQUE INDEX "users_line_staff_user_id_key" ON "users"("line_staff_user_id");
