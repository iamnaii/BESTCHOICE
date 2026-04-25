-- ============================================================
-- P1 Collections UI — Task 14: Broken-Promise Auto-Suggest
-- Adds PROMISE_DUE_REMINDER to DunningEventTrigger enum so the
-- daily 09:00 Bangkok cron can stamp DunningActions for promises
-- due TODAY (not yet broken). The PromiseTab banner reads these
-- to prompt collectors to bulk-send a LINE reminder.
-- ============================================================

ALTER TYPE "DunningEventTrigger" ADD VALUE IF NOT EXISTS 'PROMISE_DUE_REMINDER';
