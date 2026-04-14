-- CreateEnum
CREATE TYPE "DunningChannel" AS ENUM ('LINE', 'SMS', 'CALL_TASK', 'INTERNAL_ALERT');

-- CreateEnum
CREATE TYPE "DunningActionStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "dunning_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger_day" INTEGER NOT NULL,
    "channel" "DunningChannel" NOT NULL,
    "message_template" TEXT NOT NULL,
    "include_payment_link" BOOLEAN NOT NULL DEFAULT false,
    "auto_execute" BOOLEAN NOT NULL DEFAULT true,
    "escalate_to" "UserRole",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "dunning_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dunning_actions" (
    "id" TEXT NOT NULL,
    "dunning_rule_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "channel" "DunningChannel" NOT NULL,
    "status" "DunningActionStatus" NOT NULL DEFAULT 'PENDING',
    "message_content" TEXT,
    "result" TEXT,
    "payment_link_url" TEXT,
    "executed_at" TIMESTAMP(3),
    "executed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "dunning_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dunning_rules_trigger_day_idx" ON "dunning_rules"("trigger_day");

-- CreateIndex
CREATE INDEX "dunning_rules_is_active_idx" ON "dunning_rules"("is_active");

-- CreateIndex
CREATE INDEX "dunning_actions_contract_id_idx" ON "dunning_actions"("contract_id");

-- CreateIndex
CREATE INDEX "dunning_actions_status_idx" ON "dunning_actions"("status");

-- CreateIndex
CREATE INDEX "dunning_actions_created_at_idx" ON "dunning_actions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dunning_actions_dunning_rule_id_contract_id_payment_id_key" ON "dunning_actions"("dunning_rule_id", "contract_id", "payment_id");

-- AddForeignKey
ALTER TABLE "dunning_actions" ADD CONSTRAINT "dunning_actions_dunning_rule_id_fkey" FOREIGN KEY ("dunning_rule_id") REFERENCES "dunning_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dunning_actions" ADD CONSTRAINT "dunning_actions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dunning_actions" ADD CONSTRAINT "dunning_actions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dunning_actions" ADD CONSTRAINT "dunning_actions_executed_by_id_fkey" FOREIGN KEY ("executed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
