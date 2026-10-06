-- CreateEnum
CREATE TYPE "FacebookCommentReplyStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "StaffInboxKind" ADD VALUE 'FACEBOOK_COMMENT';

-- AlterTable
ALTER TABLE "staff_inbox_items" ADD COLUMN     "facebook_comment_id" TEXT;

-- CreateTable
CREATE TABLE "facebook_comment_replies" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "page_id" VARCHAR(128) NOT NULL,
    "author_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "FacebookCommentReplyStatus" NOT NULL DEFAULT 'PENDING',
    "external_id" VARCHAR(256),
    "error_code" VARCHAR(64),
    "inbound_sequence" INTEGER NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facebook_comment_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "facebook_comment_replies_request_key_key" ON "facebook_comment_replies"("request_key");

-- CreateIndex
CREATE INDEX "facebook_comment_replies_thread_id_attempted_at_idx" ON "facebook_comment_replies"("thread_id", "attempted_at");

-- CreateIndex
CREATE UNIQUE INDEX "facebook_comment_replies_page_id_external_id_key" ON "facebook_comment_replies"("page_id", "external_id");

-- AddForeignKey
ALTER TABLE "staff_inbox_items" ADD CONSTRAINT "staff_inbox_items_facebook_comment_id_fkey" FOREIGN KEY ("facebook_comment_id") REFERENCES "facebook_comment_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_comment_replies" ADD CONSTRAINT "facebook_comment_replies_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "facebook_comment_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_comment_replies" ADD CONSTRAINT "facebook_comment_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "facebook_comment_replies_one_uncertain_per_thread" ON "facebook_comment_replies"("thread_id") WHERE "status" IN ('PENDING', 'UNKNOWN');
CREATE INDEX "staff_inbox_items_facebook_comment_id_idx" ON "staff_inbox_items"("facebook_comment_id");
