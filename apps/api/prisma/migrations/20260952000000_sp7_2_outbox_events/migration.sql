-- SP7.2 — Cross-entity transaction outbox

CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "flow_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_entity" TEXT NOT NULL,
    "target_entity" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbox_events_idempotency_key_key" ON "outbox_events"("idempotency_key");
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");
CREATE INDEX "outbox_events_flow_type_idx" ON "outbox_events"("flow_type");
