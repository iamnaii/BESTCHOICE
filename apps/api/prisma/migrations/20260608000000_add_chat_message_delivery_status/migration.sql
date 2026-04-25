-- Z10: ChatMessage.deliveryStatus + ChatMessageDeliveryStatus enum
-- Populates from LINE webhook events[].deliveryContext for outbound messages.
-- Used by overdue queue post-filter to surface RESPONDED/IGNORED/BLOCKED
-- contracts (currently only NO_LINE works).

CREATE TYPE "ChatMessageDeliveryStatus" AS ENUM (
  'DELIVERED',
  'READ',
  'RESPONDED',
  'IGNORED',
  'BLOCKED'
);

ALTER TABLE "chat_messages"
  ADD COLUMN "delivery_status" "ChatMessageDeliveryStatus";
