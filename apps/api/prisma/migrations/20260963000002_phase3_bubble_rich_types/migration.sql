-- Phase 3: expand BubbleType + add rich-content columns to canned_response_bubbles

-- Expand BubbleType enum (Postgres-safe ALTER TYPE ADD VALUE)
ALTER TYPE "BubbleType" ADD VALUE IF NOT EXISTS 'CARD';
ALTER TYPE "BubbleType" ADD VALUE IF NOT EXISTS 'LOCATION';
ALTER TYPE "BubbleType" ADD VALUE IF NOT EXISTS 'VIDEO';
ALTER TYPE "BubbleType" ADD VALUE IF NOT EXISTS 'JSON';

-- Add columns to bubble table
ALTER TABLE "canned_response_bubbles" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "canned_response_bubbles" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "canned_response_bubbles" ADD COLUMN "address" TEXT;
ALTER TABLE "canned_response_bubbles" ADD COLUMN "location_title" TEXT;
ALTER TABLE "canned_response_bubbles" ADD COLUMN "json" JSONB;
