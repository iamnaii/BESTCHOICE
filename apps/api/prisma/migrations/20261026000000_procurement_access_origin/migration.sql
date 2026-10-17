-- No guessed defaults or historical backfill. Origin is supplied by authorized new workflows.
ALTER TABLE purchase_orders ADD COLUMN access_company_code TEXT, ADD COLUMN access_branch_id TEXT;
ALTER TABLE suppliers ADD COLUMN access_company_code TEXT, ADD COLUMN access_branch_id TEXT;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_access_company_code_fkey FOREIGN KEY (access_company_code) REFERENCES company_info(company_code) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_access_branch_id_fkey FOREIGN KEY (access_branch_id) REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_access_company_code_fkey FOREIGN KEY (access_company_code) REFERENCES company_info(company_code) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_access_branch_id_fkey FOREIGN KEY (access_branch_id) REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX purchase_orders_access_company_code_access_branch_id_idx ON purchase_orders(access_company_code, access_branch_id);
CREATE INDEX suppliers_access_company_code_access_branch_id_idx ON suppliers(access_company_code, access_branch_id);
