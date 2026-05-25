-- Add quick reply table
CREATE TYPE "QuickReplyType" AS ENUM ('POSTBACK', 'URL', 'MESSAGE');

CREATE TABLE "canned_response_quick_replies" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "canned_response_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "QuickReplyType" NOT NULL,
    "payload" TEXT,
    "url" TEXT,
    "message" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "canned_response_quick_replies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "canned_response_quick_replies_canned_response_id_sort_order_idx"
  ON "canned_response_quick_replies"("canned_response_id", "sort_order");

ALTER TABLE "canned_response_quick_replies"
  ADD CONSTRAINT "canned_response_quick_replies_canned_response_id_fkey"
  FOREIGN KEY ("canned_response_id") REFERENCES "canned_responses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Add channels[] to bubbles
ALTER TABLE "canned_response_bubbles" ADD COLUMN "channels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add flags to canned_responses
ALTER TABLE "canned_responses" ADD COLUMN "hide_from_chat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "canned_responses" ADD COLUMN "verified_only" BOOLEAN NOT NULL DEFAULT false;
