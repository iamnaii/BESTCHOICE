-- Leave existing warranty terms unspecified; keep shop_warranty_days unchanged.
ALTER TABLE "products" ADD COLUMN "warranty_terms" TEXT;
