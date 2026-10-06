-- CreateEnum
CREATE TYPE "ChatServiceRequestStatus" AS ENUM ('OPEN', 'WAITING_CUSTOMER', 'LINKED', 'RESOLVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "chat_service_requests" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "requested_product_id" TEXT,
    "contract_id" TEXT,
    "sale_id" TEXT,
    "todo_id" TEXT NOT NULL,
    "after_sales_case_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "symptom" TEXT NOT NULL,
    "status" "ChatServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chat_service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_service_request_sources" (
    "request_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,

    CONSTRAINT "chat_service_request_sources_pkey" PRIMARY KEY ("request_id","message_id")
);

-- CreateTable
CREATE TABLE "chat_service_request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "from_status" "ChatServiceRequestStatus",
    "to_status" "ChatServiceRequestStatus",
    "actor_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_service_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_service_requests_todo_id_key" ON "chat_service_requests"("todo_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_service_requests_after_sales_case_id_key" ON "chat_service_requests"("after_sales_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_service_requests_request_key_key" ON "chat_service_requests"("request_key");

-- CreateIndex
CREATE INDEX "chat_service_requests_room_id_deleted_at_created_at_idx" ON "chat_service_requests"("room_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "chat_service_requests_status_created_at_idx" ON "chat_service_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "chat_service_request_events_request_id_created_at_idx" ON "chat_service_request_events"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "chat_service_requests" ADD CONSTRAINT "chat_service_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_requests" ADD CONSTRAINT "chat_service_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_requests" ADD CONSTRAINT "chat_service_requests_requested_product_id_fkey" FOREIGN KEY ("requested_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_requests" ADD CONSTRAINT "chat_service_requests_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_requests" ADD CONSTRAINT "chat_service_requests_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_requests" ADD CONSTRAINT "chat_service_requests_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "todos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_requests" ADD CONSTRAINT "chat_service_requests_after_sales_case_id_fkey" FOREIGN KEY ("after_sales_case_id") REFERENCES "after_sales_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_requests" ADD CONSTRAINT "chat_service_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_request_sources" ADD CONSTRAINT "chat_service_request_sources_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "chat_service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_request_sources" ADD CONSTRAINT "chat_service_request_sources_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_request_events" ADD CONSTRAINT "chat_service_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "chat_service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_service_request_events" ADD CONSTRAINT "chat_service_request_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE FUNCTION prevent_chat_service_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Chat service request events are immutable'; END;
$$;
CREATE TRIGGER chat_service_events_immutable BEFORE UPDATE OR DELETE ON chat_service_request_events
FOR EACH ROW EXECUTE FUNCTION prevent_chat_service_event_mutation();
ALTER TABLE chat_service_requests ADD CONSTRAINT service_request_link_state
CHECK ((status = 'LINKED') = (after_sales_case_id IS NOT NULL));
