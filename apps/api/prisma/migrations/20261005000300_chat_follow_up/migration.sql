ALTER TYPE "TodoStatus" ADD VALUE 'CANCELLED';
CREATE TYPE "ChatWorkKind" AS ENUM ('GENERAL', 'CHAT_FOLLOW_UP', 'CHAT_HANDOFF', 'CHAT_SERVICE');
ALTER TABLE "todos"
  ADD COLUMN "work_kind" "ChatWorkKind" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "due_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "request_key" TEXT;
CREATE UNIQUE INDEX "todos_request_key_key" ON "todos"("request_key");
CREATE TABLE "todo_work_events" (
  "id" TEXT NOT NULL,
  "todo_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "from_due_at" TIMESTAMP(3),
  "to_due_at" TIMESTAMP(3),
  "from_assignee_id" TEXT,
  "to_assignee_id" TEXT,
  "from_status" "TodoStatus",
  "to_status" "TodoStatus" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "todo_work_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "todo_work_events_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "todos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "todo_work_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "todo_work_events_todo_id_created_at_idx" ON "todo_work_events"("todo_id", "created_at");
CREATE FUNCTION protect_todo_work_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Task work events are append-only'; END;
$$;
CREATE TRIGGER todo_work_events_immutable BEFORE UPDATE OR DELETE ON "todo_work_events"
FOR EACH ROW EXECUTE FUNCTION protect_todo_work_events();
