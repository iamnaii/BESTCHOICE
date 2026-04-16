-- CreateTable
CREATE TABLE "todo_comments" (
    "id" TEXT NOT NULL,
    "todo_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todo_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "todo_comments_todo_id_created_at_idx" ON "todo_comments"("todo_id", "created_at");

-- AddForeignKey
ALTER TABLE "todo_comments" ADD CONSTRAINT "todo_comments_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "todos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_comments" ADD CONSTRAINT "todo_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
