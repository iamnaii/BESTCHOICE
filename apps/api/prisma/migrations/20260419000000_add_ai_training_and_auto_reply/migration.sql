-- CreateTable
CREATE TABLE "ai_training_pairs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "session_id" TEXT,
    "customer_message" TEXT NOT NULL,
    "ai_draft" TEXT,
    "human_edit" TEXT,
    "intent" TEXT,
    "quality" DOUBLE PRECISION,
    "used_in_prompt" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_training_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_auto_reply_logs" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "customer_message" TEXT NOT NULL,
    "ai_reply" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "auto_sent" BOOLEAN NOT NULL,
    "handoff_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_auto_reply_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_training_pairs_intent_quality_idx" ON "ai_training_pairs"("intent", "quality");

-- CreateIndex
CREATE INDEX "ai_training_pairs_source_idx" ON "ai_training_pairs"("source");

-- CreateIndex
CREATE INDEX "ai_training_pairs_created_at_idx" ON "ai_training_pairs"("created_at");

-- CreateIndex
CREATE INDEX "ai_auto_reply_logs_session_id_idx" ON "ai_auto_reply_logs"("session_id");

-- CreateIndex
CREATE INDEX "ai_auto_reply_logs_auto_sent_created_at_idx" ON "ai_auto_reply_logs"("auto_sent", "created_at");

-- AddForeignKey
ALTER TABLE "ai_training_pairs" ADD CONSTRAINT "ai_training_pairs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_auto_reply_logs" ADD CONSTRAINT "ai_auto_reply_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
