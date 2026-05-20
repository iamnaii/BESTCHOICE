-- Walk-in customer support: allow Customer.national_id to be NULL.
-- PostgreSQL unique indexes permit multiple NULLs by default — each walk-in
-- customer row with nationalId = NULL is treated as a distinct null value
-- and does NOT violate the unique constraint.
-- Staff can fill in the real ID later from the customer detail page.
ALTER TABLE "customers" ALTER COLUMN "national_id" DROP NOT NULL;
