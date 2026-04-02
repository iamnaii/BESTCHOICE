-- Clear all seed/demo data, keep only admin user
-- Order: delete from leaf tables first to respect FK constraints

-- Payment & Evidence
DELETE FROM "payment_evidences";
DELETE FROM "payment_links";
DELETE FROM "receipts";
DELETE FROM "payments";

-- Customer related
DELETE FROM "customer_access_tokens";
DELETE FROM "kyc_verifications";
DELETE FROM "dsar_requests";
DELETE FROM "pdpa_consents";
DELETE FROM "credit_checks";

-- Contract related
DELETE FROM "contract_documents";
DELETE FROM "signatures";
DELETE FROM "e_documents";
DELETE FROM "contracts";

-- Sales
DELETE FROM "sales";

-- Stock & Inventory
DELETE FROM "branch_receiving_items";
DELETE FROM "branch_receivings";
DELETE FROM "stock_count_items";
DELETE FROM "stock_counts";
DELETE FROM "stock_alerts";
DELETE FROM "reorder_points";
DELETE FROM "stock_adjustments";
DELETE FROM "goods_receiving_items";
DELETE FROM "goods_receivings";
DELETE FROM "stock_transfers";
DELETE FROM "repossessions";

-- Products & Suppliers
DELETE FROM "product_photos";
DELETE FROM "product_prices";
DELETE FROM "inspection_results";
DELETE FROM "inspections";
DELETE FROM "products";
DELETE FROM "po_items";
DELETE FROM "purchase_orders";
DELETE FROM "supplier_payment_methods";
DELETE FROM "suppliers";

-- Templates & Config
DELETE FROM "pricing_templates";
DELETE FROM "interest_configs";
DELETE FROM "inspection_template_items";
DELETE FROM "inspection_templates";
DELETE FROM "contract_templates";
DELETE FROM "sticker_templates";

-- Notifications & Logs
DELETE FROM "notification_logs";
DELETE FROM "call_logs";
DELETE FROM "audit_logs";
DELETE FROM "document_audit_logs";

-- Customers
DELETE FROM "customers";

-- Auth tokens
DELETE FROM "refresh_tokens";
DELETE FROM "password_reset_tokens";
DELETE FROM "invite_tokens";

-- Users (except admin)
DELETE FROM "users" WHERE "email" != 'admin@bestchoice.com';

-- Branches (all - admin will create real ones)
DELETE FROM "branches";

-- Reset admin branchId since branch is deleted
UPDATE "users" SET "branch_id" = NULL WHERE "email" = 'admin@bestchoice.com';
