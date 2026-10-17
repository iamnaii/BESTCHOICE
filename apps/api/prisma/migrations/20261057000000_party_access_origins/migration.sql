-- Additive only: no inferred origins or business assignments for historical parties.
ALTER TABLE "customers" ADD COLUMN "access_company_code" TEXT, ADD COLUMN "access_branch_id" TEXT, ADD COLUMN "assigned_to_id" TEXT;
ALTER TABLE "customers" ADD CONSTRAINT "customers_access_company_code_fkey" FOREIGN KEY ("access_company_code") REFERENCES "company_info"("company_code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_access_branch_id_fkey" FOREIGN KEY ("access_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_access_origin_shape" CHECK ((access_company_code IS NULL AND access_branch_id IS NULL) OR (access_company_code IS NOT NULL AND ((access_company_code = 'SHOP' AND access_branch_id IS NOT NULL) OR access_company_code = 'FINANCE')));
CREATE INDEX "customers_access_company_code_access_branch_id_idx" ON "customers"("access_company_code", "access_branch_id");
CREATE INDEX "customers_assigned_to_id_idx" ON "customers"("assigned_to_id");
ALTER TABLE "contacts" ADD COLUMN "access_company_code" TEXT, ADD COLUMN "access_branch_id" TEXT, ADD COLUMN "assigned_to_id" TEXT;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_access_company_code_fkey" FOREIGN KEY ("access_company_code") REFERENCES "company_info"("company_code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_access_branch_id_fkey" FOREIGN KEY ("access_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_access_origin_shape" CHECK ((access_company_code IS NULL AND access_branch_id IS NULL) OR (access_company_code IS NOT NULL AND ((access_company_code = 'SHOP' AND access_branch_id IS NOT NULL) OR access_company_code = 'FINANCE')));
CREATE INDEX "contacts_access_company_code_access_branch_id_idx" ON "contacts"("access_company_code", "access_branch_id");
CREATE INDEX "contacts_assigned_to_id_idx" ON "contacts"("assigned_to_id");
CREATE FUNCTION immutable_party_access_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.access_company_code IS DISTINCT FROM OLD.access_company_code OR NEW.access_branch_id IS DISTINCT FROM OLD.access_branch_id THEN
  RAISE EXCEPTION 'Party access origin is immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "customers_immutable_access_origin" BEFORE UPDATE ON "customers" FOR EACH ROW EXECUTE FUNCTION immutable_party_access_origin();
CREATE TRIGGER "contacts_immutable_access_origin" BEFORE UPDATE ON "contacts" FOR EACH ROW EXECUTE FUNCTION immutable_party_access_origin();
