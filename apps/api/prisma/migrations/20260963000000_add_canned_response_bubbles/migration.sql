-- Phase 1 Task P1.1 — multi-bubble rich-content support for CannedResponse.
-- Max 5 bubbles per template, enforced at service layer.
-- Cascade delete: removing parent template also removes its bubbles.

-- CreateEnum
CREATE TYPE "BubbleType" AS ENUM ('TEXT', 'IMAGE', 'STICKER');

-- CreateTable
CREATE TABLE "canned_response_bubbles" (
    "id" TEXT NOT NULL,
    "canned_response_id" TEXT NOT NULL,
    "type" "BubbleType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT,
    "media_url" TEXT,
    "thumbnail_url" TEXT,
    "sticker_package_id" TEXT,
    "sticker_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "canned_response_bubbles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canned_response_bubbles_canned_response_id_sort_order_idx" ON "canned_response_bubbles"("canned_response_id", "sort_order");

-- AddForeignKey
ALTER TABLE "canned_response_bubbles" ADD CONSTRAINT "canned_response_bubbles_canned_response_id_fkey" FOREIGN KEY ("canned_response_id") REFERENCES "canned_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
