-- Clear all seed/demo data, keep only admin user

-- Reset admin branchId FIRST (before deleting branches)
UPDATE "users" SET "branch_id" = NULL WHERE "email" = 'admin@bestchoice.com';

-- Truncate all data tables (CASCADE handles FK automatically)
TRUNCATE TABLE
  "payment_evidences",
  "payment_links",
  "receipts",
  "payments",
  "customer_access_tokens",
  "kyc_verifications",
  "dsar_requests",
  "pdpa_consents",
  "credit_checks",
  "contract_documents",
  "signatures",
  "e_documents",
  "contracts",
  "sales",
  "branch_receiving_items",
  "branch_receivings",
  "stock_count_items",
  "stock_counts",
  "stock_alerts",
  "reorder_points",
  "stock_adjustments",
  "goods_receiving_items",
  "goods_receivings",
  "stock_transfers",
  "repossessions",
  "product_photos",
  "product_prices",
  "inspection_results",
  "inspections",
  "products",
  "po_items",
  "purchase_orders",
  "supplier_payment_methods",
  "suppliers",
  "pricing_templates",
  "interest_configs",
  "inspection_template_items",
  "inspection_templates",
  "contract_templates",
  "sticker_templates",
  "notification_logs",
  "call_logs",
  "audit_logs",
  "document_audit_logs",
  "customers",
  "refresh_tokens",
  "password_reset_tokens",
  "invite_tokens",
  "company_info"
CASCADE;

-- Delete all users except admin
DELETE FROM "users" WHERE "email" != 'admin@bestchoice.com';

-- Delete all branches
DELETE FROM "branches";
