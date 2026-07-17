-- Buyback instant-quote (yellobe-style, iPhone only): condition questionnaire
-- + snapshot fields on TradeIn to record the answers/quote at submit time.

-- CreateEnum: BuybackDeductType
CREATE TYPE "BuybackDeductType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum: BuybackSelectType
CREATE TYPE "BuybackSelectType" AS ENUM ('SINGLE', 'MULTI');

-- CreateTable: buyback_questions
CREATE TABLE "buyback_questions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "help_text" TEXT,
    "select_type" "BuybackSelectType" NOT NULL DEFAULT 'SINGLE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "buyback_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: buyback_choices
CREATE TABLE "buyback_choices" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "deduct_type" "BuybackDeductType" NOT NULL DEFAULT 'PERCENT',
    "deduct_value" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "buyback_choices_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex: buyback_questions key
CREATE UNIQUE INDEX "buyback_questions_key_key" ON "buyback_questions"("key");

-- CreateIndex: buyback_questions deleted_at
CREATE INDEX "buyback_questions_deleted_at_idx" ON "buyback_questions"("deleted_at");

-- CreateIndex: buyback_choices question_id
CREATE INDEX "buyback_choices_question_id_idx" ON "buyback_choices"("question_id");

-- CreateIndex: buyback_choices deleted_at
CREATE INDEX "buyback_choices_deleted_at_idx" ON "buyback_choices"("deleted_at");

-- AddForeignKey: buyback_choices -> buyback_questions
ALTER TABLE "buyback_choices" ADD CONSTRAINT "buyback_choices_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "buyback_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: trade_ins — buyback instant-quote snapshot fields
ALTER TABLE "trade_ins" ADD COLUMN "condition_answers" JSONB;
ALTER TABLE "trade_ins" ADD COLUMN "quote_breakdown" JSONB;
ALTER TABLE "trade_ins" ADD COLUMN "preferred_visit_date" TIMESTAMP(3);
