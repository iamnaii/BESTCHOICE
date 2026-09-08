CREATE TABLE "room_credit_files" (
  "id" TEXT NOT NULL,
  "room_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "source_message_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "room_credit_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "room_credit_files_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "room_credit_files_key_key" ON "room_credit_files"("key");
CREATE INDEX "room_credit_files_room_id_deleted_at_idx" ON "room_credit_files"("room_id", "deleted_at");
CREATE UNIQUE INDEX "room_credit_files_active_message_key" ON "room_credit_files"("room_id", "source_message_id") WHERE "deleted_at" IS NULL;

CREATE TABLE "room_credit_analyses" (
  "id" TEXT NOT NULL,
  "room_id" TEXT NOT NULL,
  "file_ids" TEXT[] NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ANALYZING',
  "result" JSONB,
  "error" TEXT,
  "credit_check_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "room_credit_analyses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "room_credit_analyses_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "room_credit_analyses_credit_check_id_fkey" FOREIGN KEY ("credit_check_id") REFERENCES "credit_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "room_credit_analyses_status_check" CHECK ("status" IN ('ANALYZING', 'COMPLETED', 'FAILED'))
);
CREATE UNIQUE INDEX "room_credit_analyses_credit_check_id_key" ON "room_credit_analyses"("credit_check_id");
CREATE INDEX "room_credit_analyses_room_id_created_at_idx" ON "room_credit_analyses"("room_id", "created_at");
CREATE UNIQUE INDEX "room_credit_analyses_running_room_key" ON "room_credit_analyses"("room_id") WHERE "status" = 'ANALYZING' AND "deleted_at" IS NULL;
