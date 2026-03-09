-- AlterTable
ALTER TABLE "contract_templates" ADD COLUMN "blocks" JSONB DEFAULT '[]';
ALTER TABLE "contract_templates" ADD COLUMN "settings" JSONB;
