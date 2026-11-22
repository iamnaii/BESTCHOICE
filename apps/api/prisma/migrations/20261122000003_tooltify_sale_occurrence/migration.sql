ALTER TABLE "imported_sales" ADD COLUMN "source_occurrence" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "imported_sales" ADD CONSTRAINT "imported_sales_source_occurrence_positive" CHECK ("source_occurrence" > 0);
CREATE UNIQUE INDEX "imported_sales_source_event_occurrence_key" ON "imported_sales"("source", "barcode", "order_number", "sold_at", "source_occurrence");
DROP INDEX "imported_sales_source_barcode_order_number_sold_at_key";
