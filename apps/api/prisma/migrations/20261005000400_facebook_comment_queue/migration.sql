-- CreateEnum
CREATE TYPE "FacebookCommentStatus" AS ENUM ('OPEN', 'RESPONDED', 'RESOLVED');

-- CreateTable
CREATE TABLE "facebook_comment_pages" (
    "page_id" VARCHAR(128) NOT NULL,
    "company" VARCHAR(16) NOT NULL DEFAULT 'SHOP',
    "branch_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_comment_pages_pkey" PRIMARY KEY ("page_id")
);

-- CreateTable
CREATE TABLE "facebook_comment_threads" (
    "id" TEXT NOT NULL,
    "page_id" VARCHAR(128) NOT NULL,
    "post_id" VARCHAR(256) NOT NULL,
    "root_comment_id" VARCHAR(256) NOT NULL,
    "company" VARCHAR(16) NOT NULL,
    "branch_id" TEXT NOT NULL,
    "assignee_id" TEXT,
    "customer_id" TEXT,
    "room_id" TEXT,
    "status" "FacebookCommentStatus" NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "inbound_sequence" INTEGER NOT NULL DEFAULT 0,
    "waiting_since" TIMESTAMP(3),
    "last_customer_at" TIMESTAMP(3),
    "root_deleted" BOOLEAN NOT NULL DEFAULT false,
    "needs_reconciliation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facebook_comment_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facebook_comment_records" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "page_id" VARCHAR(128) NOT NULL,
    "comment_id" VARCHAR(256) NOT NULL,
    "parent_id" VARCHAR(256),
    "author_id" VARCHAR(128),
    "author_name" VARCHAR(255),
    "text" TEXT,
    "provider_revision" VARCHAR(128),
    "needs_reconciliation" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facebook_comment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facebook_comment_events" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "page_id" VARCHAR(128) NOT NULL,
    "comment_id" VARCHAR(256) NOT NULL,
    "event_key" VARCHAR(64) NOT NULL,
    "verb" VARCHAR(16) NOT NULL,
    "provider_revision" VARCHAR(128),
    "provider_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_comment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "facebook_comment_threads_company_branch_id_status_waiting_s_idx" ON "facebook_comment_threads"("company", "branch_id", "status", "waiting_since");

-- CreateIndex
CREATE INDEX "facebook_comment_threads_assignee_id_status_idx" ON "facebook_comment_threads"("assignee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "facebook_comment_threads_page_id_root_comment_id_key" ON "facebook_comment_threads"("page_id", "root_comment_id");

-- CreateIndex
CREATE INDEX "facebook_comment_records_thread_id_created_at_idx" ON "facebook_comment_records"("thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "facebook_comment_records_page_id_comment_id_key" ON "facebook_comment_records"("page_id", "comment_id");

-- CreateIndex
CREATE UNIQUE INDEX "facebook_comment_events_event_key_key" ON "facebook_comment_events"("event_key");

-- CreateIndex
CREATE INDEX "facebook_comment_events_thread_id_created_at_idx" ON "facebook_comment_events"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "facebook_comment_pages" ADD CONSTRAINT "facebook_comment_pages_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_comment_threads" ADD CONSTRAINT "facebook_comment_threads_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "facebook_comment_pages"("page_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_comment_threads" ADD CONSTRAINT "facebook_comment_threads_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_comment_threads" ADD CONSTRAINT "facebook_comment_threads_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_comment_threads" ADD CONSTRAINT "facebook_comment_threads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_comment_threads" ADD CONSTRAINT "facebook_comment_threads_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_comment_records" ADD CONSTRAINT "facebook_comment_records_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "facebook_comment_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_comment_events" ADD CONSTRAINT "facebook_comment_events_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "facebook_comment_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "facebook_comment_pages" ADD CONSTRAINT "facebook_comment_pages_shop_only" CHECK ("company" = 'SHOP');
ALTER TABLE "facebook_comment_threads" ADD CONSTRAINT "facebook_comment_threads_shop_only" CHECK ("company" = 'SHOP');
CREATE FUNCTION preserve_facebook_comment_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Facebook comment events are immutable'; END;
$$;
CREATE TRIGGER preserve_facebook_comment_events BEFORE UPDATE OR DELETE ON "facebook_comment_events"
FOR EACH ROW EXECUTE FUNCTION preserve_facebook_comment_events();
