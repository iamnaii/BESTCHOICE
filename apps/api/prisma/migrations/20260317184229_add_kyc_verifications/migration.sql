-- CreateTable
CREATE TABLE "kyc_verifications" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "otp_hash" TEXT,
    "otp_phone" TEXT NOT NULL,
    "otp_channel" TEXT NOT NULL,
    "otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "otp_sent_count" INTEGER NOT NULL DEFAULT 0,
    "otp_verified_at" TIMESTAMP(3),
    "id_card_image_url" TEXT,
    "id_card_verified" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" TEXT,
    "device_info" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_verifications_contract_id_idx" ON "kyc_verifications"("contract_id");

-- CreateIndex
CREATE INDEX "kyc_verifications_customer_id_idx" ON "kyc_verifications"("customer_id");

-- CreateIndex
CREATE INDEX "kyc_verifications_status_idx" ON "kyc_verifications"("status");

-- AddForeignKey
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
