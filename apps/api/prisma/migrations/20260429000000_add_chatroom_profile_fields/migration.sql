-- Store platform profile (display name + avatar URL) on the ChatRoom so the
-- unified inbox can show who the user is before they verify / become a Customer.
ALTER TABLE "chat_rooms"
  ADD COLUMN "display_name" TEXT,
  ADD COLUMN "picture_url" TEXT;
