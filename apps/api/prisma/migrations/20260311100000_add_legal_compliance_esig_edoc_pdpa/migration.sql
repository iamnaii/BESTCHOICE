-- ============================================================
-- Legal Compliance, e-Signature, e-Document, PDPA
-- ป.พ.พ. มาตรา 572-576, พ.ร.บ.ธุรกรรมอิเล็กทรอนิกส์ พ.ศ. 2544
-- พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
-- ============================================================

-- New enums
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'REVOKED');
CREATE TYPE "DSARRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'DELETION', 'DATA_PORTABILITY', 'OBJECTION');
CREATE TYPE "DSARStatus" AS ENUM ('SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');
CREATE TYPE "DocumentRetentionStatus" AS ENUM ('ACTIVE', 'PENDING_DELETION', 'LEGAL_HOLD', 'DELETED');

-- Update SignerType enum: add new signer types
ALTER TYPE "SignerType" ADD VALUE IF NOT EXISTS 'COMPANY';
ALTER TYPE "SignerType" ADD VALUE IF NOT EXISTS 'WITNESS_1';
ALTER TYPE "SignerType" ADD VALUE IF NOT EXISTS 'WITNESS_2';
ALTER TYPE "SignerType" ADD VALUE IF NOT EXISTS 'GUARDIAN';

-- Update ContractDocumentType enum: add new document types
ALTER TYPE "ContractDocumentType" ADD VALUE IF NOT EXISTS 'ID_CARD_BACK';
ALTER TYPE "ContractDocumentType" ADD VALUE IF NOT EXISTS 'KYC_SELFIE';
ALTER TYPE "ContractDocumentType" ADD VALUE IF NOT EXISTS 'DEVICE_PHOTO';
ALTER TYPE "ContractDocumentType" ADD VALUE IF NOT EXISTS 'DEVICE_IMEI_PHOTO';
ALTER TYPE "ContractDocumentType" ADD VALUE IF NOT EXISTS 'DOWN_PAYMENT_RECEIPT';
ALTER TYPE "ContractDocumentType" ADD VALUE IF NOT EXISTS 'PDPA_CONSENT';
ALTER TYPE "ContractDocumentType" ADD VALUE IF NOT EXISTS 'GUARDIAN_DOC';
ALTER TYPE "ContractDocumentType" ADD VALUE IF NOT EXISTS 'PAYMENT_SCHEDULE';
ALTER TYPE "ContractDocumentType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECEIPT';
ALTER TYPE "ContractDocumentType" ADD VALUE IF NOT EXISTS 'ADDENDUM';

-- ============================================================
-- Customer: add guardian fields
-- ============================================================
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "guardian_name" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "guardian_national_id" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "guardian_phone" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "guardian_relation" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "guardian_address" TEXT;

-- ============================================================
-- Contract: add legal compliance fields
-- ============================================================
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "pdpa_consent_id" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "contract_hash" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "has_ownership_clause" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "has_repossession_clause" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "has_early_payoff_clause" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "has_no_transfer_clause" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "has_acknowledgement" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "retention_status" "DocumentRetentionStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "retention_expiry" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "legal_hold_reason" TEXT;

CREATE INDEX IF NOT EXISTS "contracts_retention_status_idx" ON "contracts"("retention_status");

-- ============================================================
-- Signature: add full metadata for legal proof
-- ============================================================
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "signature_svg" TEXT;
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "signer_name" TEXT;
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "screen_size" TEXT;
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "gps_latitude" DOUBLE PRECISION;
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "gps_longitude" DOUBLE PRECISION;
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "staff_user_id" TEXT;
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "contract_hash" TEXT;

-- Update signature_image to TEXT type (for base64)
ALTER TABLE "signatures" ALTER COLUMN "signature_image" TYPE TEXT;

-- ============================================================
-- ContractDocument: add versioning, hash, immutability
-- ============================================================
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "original_name" TEXT;
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "mime_type" TEXT;
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "file_hash" TEXT;
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "is_latest" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "is_immutable" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "contract_documents_contract_type_latest_idx" ON "contract_documents"("contract_id", "document_type", "is_latest");

-- ============================================================
-- PDPA Consent
-- ============================================================
CREATE TABLE IF NOT EXISTS "pdpa_consents" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "consent_version" TEXT NOT NULL,
    "privacy_notice_text" TEXT NOT NULL,
    "purposes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "granted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "ip_address" TEXT,
    "device_info" TEXT,
    "signature_image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdpa_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pdpa_consents_customer_id_idx" ON "pdpa_consents"("customer_id");
CREATE INDEX IF NOT EXISTS "pdpa_consents_status_idx" ON "pdpa_consents"("status");

ALTER TABLE "pdpa_consents" ADD CONSTRAINT "pdpa_consents_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Link contract to PDPA consent
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_pdpa_consent_id_key" UNIQUE ("pdpa_consent_id");
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_pdpa_consent_id_fkey"
    FOREIGN KEY ("pdpa_consent_id") REFERENCES "pdpa_consents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- DSAR Request
-- ============================================================
CREATE TABLE IF NOT EXISTS "dsar_requests" (
    "id" TEXT NOT NULL,
    "request_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "request_type" "DSARRequestType" NOT NULL,
    "status" "DSARStatus" NOT NULL DEFAULT 'SUBMITTED',
    "description" TEXT NOT NULL,
    "response_notes" TEXT,
    "processed_by_id" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "due_date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dsar_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dsar_requests_request_number_key" ON "dsar_requests"("request_number");
CREATE INDEX IF NOT EXISTS "dsar_requests_customer_id_idx" ON "dsar_requests"("customer_id");
CREATE INDEX IF NOT EXISTS "dsar_requests_status_idx" ON "dsar_requests"("status");
CREATE INDEX IF NOT EXISTS "dsar_requests_request_type_idx" ON "dsar_requests"("request_type");

ALTER TABLE "dsar_requests" ADD CONSTRAINT "dsar_requests_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Receipt (ใบเสร็จรับเงินอิเล็กทรอนิกส์)
-- ============================================================
CREATE TABLE IF NOT EXISTS "receipts" (
    "id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "receipt_type" TEXT NOT NULL DEFAULT 'PAYMENT',
    "payer_name" TEXT NOT NULL,
    "receiver_name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "installment_no" INTEGER,
    "remaining_balance" DECIMAL(12,2),
    "remaining_months" INTEGER,
    "payment_method" TEXT,
    "transaction_ref" TEXT,
    "paid_date" TIMESTAMP(3) NOT NULL,
    "file_url" TEXT,
    "file_hash" TEXT,
    "is_voided" BOOLEAN NOT NULL DEFAULT false,
    "void_reason" TEXT,
    "voided_receipt_id" TEXT,
    "issued_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "receipts_receipt_number_key" ON "receipts"("receipt_number");
CREATE INDEX IF NOT EXISTS "receipts_contract_id_idx" ON "receipts"("contract_id");
CREATE INDEX IF NOT EXISTS "receipts_receipt_number_idx" ON "receipts"("receipt_number");
CREATE INDEX IF NOT EXISTS "receipts_payment_id_idx" ON "receipts"("payment_id");
CREATE INDEX IF NOT EXISTS "receipts_created_at_idx" ON "receipts"("created_at");

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Customer Access Token
-- ============================================================
CREATE TABLE IF NOT EXISTS "customer_access_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accessed_at" TIMESTAMP(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_access_tokens_token_key" ON "customer_access_tokens"("token");
CREATE INDEX IF NOT EXISTS "customer_access_tokens_token_idx" ON "customer_access_tokens"("token");
CREATE INDEX IF NOT EXISTS "customer_access_tokens_contract_id_idx" ON "customer_access_tokens"("contract_id");
CREATE INDEX IF NOT EXISTS "customer_access_tokens_expires_at_idx" ON "customer_access_tokens"("expires_at");

-- ============================================================
-- Document Audit Log
-- ============================================================
CREATE TABLE IF NOT EXISTS "document_audit_logs" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "document_audit_logs_document_id_idx" ON "document_audit_logs"("document_id");
CREATE INDEX IF NOT EXISTS "document_audit_logs_contract_id_idx" ON "document_audit_logs"("contract_id");
CREATE INDEX IF NOT EXISTS "document_audit_logs_user_id_idx" ON "document_audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "document_audit_logs_created_at_idx" ON "document_audit_logs"("created_at");

-- ============================================================
-- Company Info
-- ============================================================
CREATE TABLE IF NOT EXISTS "company_info" (
    "id" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT,
    "tax_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "director_name" TEXT NOT NULL,
    "director_position" TEXT,
    "director_national_id" TEXT,
    "director_address" TEXT,
    "logo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_info_pkey" PRIMARY KEY ("id")
);

-- Insert default company info
INSERT INTO "company_info" ("id", "name_th", "name_en", "tax_id", "address", "director_name", "director_position", "director_national_id", "director_address", "updated_at")
VALUES (
    gen_random_uuid()::text,
    'บริษัท เบสท์ช้อยส์โฟน จำกัด',
    'BESTCHOICEPHONE Co., Ltd.',
    '0165568000050',
    '456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000',
    'เอกนรินทร์ คงเดช',
    'กรรมการผู้จัดการ',
    '1-1601-00452-40-7',
    '517 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000',
    CURRENT_TIMESTAMP
) ON CONFLICT DO NOTHING;

-- Add late fee system configs if not exists
INSERT INTO "system_config" ("id", "key", "value", "label", "created_at", "updated_at")
VALUES
    (gen_random_uuid()::text, 'late_fee_per_day', '100', 'ค่าปรับจ่ายช้าต่อวัน (บาท)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'late_fee_cap_per_installment', '200', 'ค่าปรับสูงสุดต่องวด (บาท)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'pdpa_privacy_notice_version', '1.0', 'เวอร์ชัน Privacy Notice', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'retention_completed_years', '5', 'ระยะเวลาเก็บเอกสารหลังปิดสัญญา (ปี)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'retention_cancelled_years', '2', 'ระยะเวลาเก็บเอกสารหลังยกเลิกสัญญา (ปี)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'customer_access_token_hours', '48', 'อายุ Link เอกสารลูกค้า (ชั่วโมง)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'sla_approval_hours', '24', 'SLA อนุมัติสัญญา (ชั่วโมง)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'sla_escalation_hours', '48', 'SLA แจ้งเตือน Admin (ชั่วโมง)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
