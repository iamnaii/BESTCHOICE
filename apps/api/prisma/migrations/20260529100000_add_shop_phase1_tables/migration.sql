-- Phase 1: Online Shop Foundation
-- Adds 5 new tables + extends Product and Customer with nullable columns.
-- All changes are backwards compatible (nullable / default values).

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CONSUMED', 'CANCELLED', 'PREEMPTED');

-- CreateEnum
CREATE TYPE "BotType" AS ENUM ('AI_CRAWLER', 'GENERIC_BOT', 'SCRAPER', 'HEADLESS_BROWSER', 'RATE_ABUSE', 'PRICE_MONITOR', 'KNOWN_GOOD');

-- CreateEnum
CREATE TYPE "BotAction" AS ENUM ('LOGGED', 'RATE_LIMITED', 'CAPTCHA_REQUIRED', 'BLOCKED', 'CLOAKED');

-- AlterTable: Product — add online shop fields (all nullable / with defaults)
ALTER TABLE "products"
  ADD COLUMN "condition_grade"    TEXT,
  ADD COLUMN "gallery"            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "gallery360"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "is_online_visible"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "online_description" TEXT;

-- AlterTable: Customer — add online shop fields (all nullable / with defaults)
ALTER TABLE "customers"
  ADD COLUMN "facebook_user_id"   TEXT,
  ADD COLUMN "shipping_addresses" JSONB[] NOT NULL DEFAULT ARRAY[]::JSONB[];

-- CreateTable: ProductReservation (15-min hold pattern)
CREATE TABLE "product_reservations" (
    "id"             TEXT NOT NULL,
    "product_id"     TEXT NOT NULL,
    "customer_id"    TEXT,
    "session_id"     TEXT NOT NULL,
    "reserved_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"     TIMESTAMP(3) NOT NULL,
    "status"         "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "consumed_by_id" TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WebsiteVisit (raw analytics events)
CREATE TABLE "website_visits" (
    "id"           TEXT NOT NULL,
    "session_id"   TEXT NOT NULL,
    "customer_id"  TEXT,
    "ip_hash"      TEXT NOT NULL,
    "ip_country"   TEXT,
    "ip_province"  TEXT,
    "user_agent"   TEXT,
    "device"       TEXT,
    "browser"      TEXT,
    "os"           TEXT,
    "page_path"    TEXT NOT NULL,
    "referrer"     TEXT,
    "utm_source"   TEXT,
    "utm_medium"   TEXT,
    "utm_campaign" TEXT,
    "visited_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_sec" INTEGER,

    CONSTRAINT "website_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WebsiteSession (grouped sessions)
CREATE TABLE "website_sessions" (
    "id"               TEXT NOT NULL,
    "session_id"       TEXT NOT NULL,
    "customer_id"      TEXT,
    "ip_hash"          TEXT NOT NULL,
    "device"           TEXT,
    "browser"          TEXT,
    "started_at"       TIMESTAMP(3) NOT NULL,
    "ended_at"         TIMESTAMP(3),
    "page_count"       INTEGER NOT NULL DEFAULT 0,
    "duration_sec"     INTEGER,
    "reached_cart"     BOOLEAN NOT NULL DEFAULT false,
    "reached_checkout" BOOLEAN NOT NULL DEFAULT false,
    "completed_order"  BOOLEAN NOT NULL DEFAULT false,
    "order_id"         TEXT,
    "entry_page"       TEXT NOT NULL,
    "exit_page"        TEXT,
    "referrer"         TEXT,
    "utm_source"       TEXT,
    "utm_campaign"     TEXT,

    CONSTRAINT "website_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BotDetectionLog (immutable audit — no updatedAt/deletedAt)
CREATE TABLE "bot_detection_logs" (
    "id"            TEXT NOT NULL,
    "ip_hash"       TEXT NOT NULL,
    "user_agent"    TEXT NOT NULL,
    "detected_type" "BotType" NOT NULL,
    "signals"       JSONB NOT NULL,
    "page_path"     TEXT NOT NULL,
    "action"        "BotAction" NOT NULL,
    "detected_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_detection_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: IpRateLimit (keyed by ip_hash — no timestamps needed)
CREATE TABLE "ip_rate_limits" (
    "ip_hash"              TEXT NOT NULL,
    "window_start"         TIMESTAMP(3) NOT NULL,
    "request_count"        INTEGER NOT NULL DEFAULT 0,
    "blocked_until"        TIMESTAMP(3),
    "block_reason"         TEXT,
    "pages_visited"        INTEGER NOT NULL DEFAULT 0,
    "unique_pages_visited" INTEGER NOT NULL DEFAULT 0,
    "last_user_agent"      TEXT,

    CONSTRAINT "ip_rate_limits_pkey" PRIMARY KEY ("ip_hash")
);

-- CreateIndex: WebsiteSession unique session_id
CREATE UNIQUE INDEX "website_sessions_session_id_key" ON "website_sessions"("session_id");

-- CreateIndex: Product is_online_visible
CREATE INDEX "products_is_online_visible_idx" ON "products"("is_online_visible");

-- CreateIndex: ProductReservation
CREATE INDEX "product_reservations_product_id_status_idx" ON "product_reservations"("product_id", "status");
CREATE INDEX "product_reservations_customer_id_idx" ON "product_reservations"("customer_id");
CREATE INDEX "product_reservations_expires_at_idx" ON "product_reservations"("expires_at");

-- CreateIndex: WebsiteVisit
CREATE INDEX "website_visits_session_id_idx" ON "website_visits"("session_id");
CREATE INDEX "website_visits_customer_id_idx" ON "website_visits"("customer_id");
CREATE INDEX "website_visits_visited_at_idx" ON "website_visits"("visited_at");
CREATE INDEX "website_visits_ip_hash_visited_at_idx" ON "website_visits"("ip_hash", "visited_at");
CREATE INDEX "website_visits_page_path_visited_at_idx" ON "website_visits"("page_path", "visited_at");

-- CreateIndex: WebsiteSession
CREATE INDEX "website_sessions_customer_id_idx" ON "website_sessions"("customer_id");
CREATE INDEX "website_sessions_started_at_idx" ON "website_sessions"("started_at");
CREATE INDEX "website_sessions_ip_hash_started_at_idx" ON "website_sessions"("ip_hash", "started_at");

-- CreateIndex: BotDetectionLog
CREATE INDEX "bot_detection_logs_ip_hash_detected_at_idx" ON "bot_detection_logs"("ip_hash", "detected_at");
CREATE INDEX "bot_detection_logs_detected_type_detected_at_idx" ON "bot_detection_logs"("detected_type", "detected_at");

-- CreateIndex: IpRateLimit
CREATE INDEX "ip_rate_limits_blocked_until_idx" ON "ip_rate_limits"("blocked_until");

-- AddForeignKey: ProductReservation → Product
ALTER TABLE "product_reservations"
  ADD CONSTRAINT "product_reservations_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ProductReservation → Customer (nullable)
ALTER TABLE "product_reservations"
  ADD CONSTRAINT "product_reservations_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: WebsiteVisit → Customer (nullable)
ALTER TABLE "website_visits"
  ADD CONSTRAINT "website_visits_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: WebsiteSession → Customer (nullable)
ALTER TABLE "website_sessions"
  ADD CONSTRAINT "website_sessions_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
