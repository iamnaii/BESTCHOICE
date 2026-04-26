-- Audit quick-wins: 3 compound indexes for hot cron paths.
-- Idempotent (IF NOT EXISTS) so this can re-run on partially-migrated dev DBs.
--
-- NotificationLog: per-payment dedup probe in notifications.service.ts (queries by
-- relatedId + subject + sentAt to skip already-sent reminders).
CREATE INDEX IF NOT EXISTS "notification_logs_related_id_subject_sent_at_idx"
  ON "notification_logs" ("related_id", "subject", "sent_at");

-- Contract: */5min SLA cron scan filters by workflowStatus IN (...) AND updatedAt < threshold.
CREATE INDEX IF NOT EXISTS "contracts_workflowStatus_updatedAt_idx"
  ON "contracts" ("workflow_status", "updated_at");

-- ChatRoom: */5min first-response SLA cron in chat-engine/chat-cron.service.ts.
CREATE INDEX IF NOT EXISTS "chat_rooms_status_first_response_at_created_at_idx"
  ON "chat_rooms" ("status", "first_response_at", "created_at");
