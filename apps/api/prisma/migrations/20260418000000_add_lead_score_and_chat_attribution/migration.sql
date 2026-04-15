-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "attribution_id" TEXT,
ADD COLUMN     "lead_score" INTEGER,
ADD COLUMN     "lead_temperature" TEXT;

-- CreateIndex
CREATE INDEX "chat_sessions_lead_score_idx" ON "chat_sessions"("lead_score");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_attribution_id_fkey" FOREIGN KEY ("attribution_id") REFERENCES "ads_attributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
