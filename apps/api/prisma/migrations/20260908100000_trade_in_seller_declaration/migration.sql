-- Preserve historical signatures: no default and no backfill of new terms.
ALTER TABLE "trade_ins" ADD COLUMN "seller_declaration_snapshot" JSONB;
