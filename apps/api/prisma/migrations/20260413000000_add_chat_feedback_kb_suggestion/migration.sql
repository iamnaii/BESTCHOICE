-- ChatFeedback: customer feedback on bot responses
CREATE TABLE "chat_feedbacks" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "message_id" TEXT,
    "rating" INTEGER NOT NULL,
    "feedback_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chat_feedbacks_pkey" PRIMARY KEY ("id")
);

-- ChatKbSuggestion: KB improvement suggestions
CREATE TABLE "chat_kb_suggestions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "customer_question" TEXT NOT NULL,
    "staff_answer" TEXT,
    "suggested_intent" TEXT NOT NULL,
    "suggested_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggested_template" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "kb_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_kb_suggestions_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "chat_feedbacks_session_id_idx" ON "chat_feedbacks"("session_id");
CREATE INDEX "chat_feedbacks_rating_idx" ON "chat_feedbacks"("rating");
CREATE INDEX "chat_kb_suggestions_status_idx" ON "chat_kb_suggestions"("status");
CREATE INDEX "chat_kb_suggestions_source_idx" ON "chat_kb_suggestions"("source");
CREATE INDEX "chat_kb_suggestions_session_id_idx" ON "chat_kb_suggestions"("session_id");

-- Foreign keys
ALTER TABLE "chat_feedbacks" ADD CONSTRAINT "chat_feedbacks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_kb_suggestions" ADD CONSTRAINT "chat_kb_suggestions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
