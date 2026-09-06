-- รูปโฆษณาจาก ads_context_data.photo_url / video_url ของ Messenger referral
ALTER TABLE "ads_campaigns" ADD COLUMN IF NOT EXISTS "ad_photo_url" TEXT;
