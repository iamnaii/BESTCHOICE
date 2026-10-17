-- Preserve historical orphan source IDs without guessing or rewriting ownership.
-- Existing unresolved rows fail closed in relational authorization predicates.
-- NOT VALID still enforces valid references for future inserts/key updates.
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
