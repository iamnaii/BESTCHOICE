-- Add missing createdAt to customer_scores
ALTER TABLE "customer_scores" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add missing createdAt + updatedAt to customer_line_links
-- linkedAt already exists as domain-meaningful timestamp; createdAt added for rule consistency.
ALTER TABLE "customer_line_links" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "customer_line_links" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
