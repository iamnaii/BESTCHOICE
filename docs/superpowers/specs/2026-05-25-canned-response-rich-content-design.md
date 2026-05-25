# Canned Response — Rich Content & Multi-bubble Design

**Date:** 2026-05-25
**Owner ask:** ต่อจาก admin redesign — ให้รองรับ multi-bubble, per-channel content, รูปภาพ, Quick Reply, Card, Flex ฯลฯ ตาม CHATCONE 1:1

## Problem

ตอนนี้ `CannedResponse` เป็น single-text bubble ต่อ template. CHATCONE รองรับ:
- 1 template = หลาย message bubbles (max 5)
- หลาย message type (TEXT, IMAGE, STICKER, FILE, CARD, LOCATION, IMAGE_MAP, RICH_MESSAGE, VIDEO, RICH_VIDEO, JSON)
- Per-channel content (Line / Facebook / Widget / Instagram / TikTok)
- Quick Reply buttons (max 13)
- Hide-from-chat + verified-only flags

## Scope split into 3 phases

### Phase 1 — Multi-bubble basic (~1 วัน)
- Schema: `CannedResponseBubble` table (1:N), types TEXT/IMAGE/STICKER
- Migration: existing 27 templates → first TEXT bubble each
- Backend: bubble CRUD + send-N-bubbles logic
- Frontend: bubble list in editor (DnD reorder), bubble type picker, image upload to S3, sticker picker
- Channel-agnostic (ส่งเหมือนกันทุก channel)

### Phase 2 — Channel + Quick Reply + Flags (~3-5 วัน)
- Schema: `Bubble.channels String[]` (empty = all-channels), `CannedResponseQuickReply` table, `CannedResponse.hideFromChat`, `CannedResponse.verifiedOnly`
- Backend: filter logic in picker (`hideFromChat` excludes, `verifiedOnly` checks `room.verifiedAt`), Quick Reply payload routing
- Frontend: channel tabs in editor, Quick Reply editor (max 13 buttons w/ POSTBACK/URL/MESSAGE actions), template flags toggles
- Sender: build LINE QuickReply / FB quick_replies per channel

### Phase 3 — Rich content types (~5-7 วัน)
- Schema: expand `Bubble.type` enum (CARD, LOCATION, IMAGE_MAP, VIDEO, RICH_VIDEO, FILE, JSON, RICH_MESSAGE) + `Bubble.json Json?` for complex types
- Frontend: type-specific sub-editors
  - CARD: LINE Flex Bubble simplified (hero image + title + subtitle + 1-3 buttons)
  - LOCATION: lat/lng/address input + map picker
  - IMAGE_MAP: image upload + interactive area editor (rect coordinates)
  - VIDEO: video URL/upload + cover image
  - RICH_VIDEO: similar to VIDEO + action overlays
  - FILE: file upload (PDF/DOCX)
  - JSON: raw text editor with syntax highlight
  - RICH_MESSAGE: LINE rich message format
- Sender adapters: each channel translates bubble type → channel-specific API call
  - LINE: TextMessage/ImageMessage/StickerMessage/FlexMessage/LocationMessage/ImagemapMessage/VideoMessage
  - FB: text/attachment(image)/template(generic) — drops unsupported types gracefully
  - IG: text + image only — drops unsupported
  - TikTok: text only — drops unsupported

## Architecture

### Schema (final state after all 3 phases)

```prisma
model CannedResponse {
  id              String   @id @default(uuid())
  shortcut        String   @unique
  title           String
  category        String?
  sortOrder       Int      @default(0)
  isActive        Boolean  @default(true)
  hideFromChat    Boolean  @default(false)   // Phase 2
  verifiedOnly    Boolean  @default(false)   // Phase 2
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  // Phase 1: legacy 'content' kept for backward compat during migration
  // Phase 1 migration: copy content → first bubble TEXT, then drop column in Phase 3
  content         String?  @db.Text         // soft-deprecated, removed Phase 3
  mediaUrl        String?                   // soft-deprecated, removed Phase 3
  responseType    String?  @default("text") // soft-deprecated, removed Phase 3

  bubbles         CannedResponseBubble[]
  quickReplies    CannedResponseQuickReply[]
}

model CannedResponseBubble {
  id                String   @id @default(uuid())
  cannedResponseId  String
  type              BubbleType
  sortOrder         Int      @default(0)
  channels          String[] @default([])   // Phase 2: empty = all channels

  // TEXT
  text              String?  @db.Text

  // IMAGE / VIDEO / RICH_VIDEO / FILE — media URL
  mediaUrl          String?
  mediaType         String?                  // MIME type for FILE
  thumbnailUrl      String?                  // for VIDEO/RICH_VIDEO/IMAGE_MAP

  // STICKER (LINE)
  stickerPackageId  String?
  stickerId         String?

  // LOCATION
  latitude          Float?
  longitude         Float?
  address           String?
  locationTitle     String?

  // CARD / FLEX / IMAGE_MAP / RICH_MESSAGE / RICH_VIDEO / JSON
  // Complex data stored as JSON to avoid schema explosion
  json              Json?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?

  cannedResponse    CannedResponse @relation(fields: [cannedResponseId], references: [id], onDelete: Cascade)

  @@index([cannedResponseId, sortOrder])
}

model CannedResponseQuickReply {
  id                String   @id @default(uuid())
  cannedResponseId  String
  label             String
  type              QuickReplyType
  payload           String?            // for POSTBACK
  url               String?            // for URL
  message           String?            // for MESSAGE
  sortOrder         Int      @default(0)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?

  cannedResponse    CannedResponse @relation(fields: [cannedResponseId], references: [id], onDelete: Cascade)

  @@index([cannedResponseId, sortOrder])
}

enum BubbleType {
  TEXT
  IMAGE
  STICKER
  FILE
  CARD
  LOCATION
  IMAGE_MAP
  RICH_MESSAGE
  VIDEO
  RICH_VIDEO
  JSON
}

enum QuickReplyType {
  POSTBACK
  URL
  MESSAGE
}
```

### Per-channel filtering rule

```
visibleBubbles(template, channel) =
  template.bubbles
    .filter(b => b.channels.length === 0 || b.channels.includes(channel))
    .sort(b => b.sortOrder)
    .slice(0, 5)   // LINE max 5 messages per push
```

### Sender adapter changes

```typescript
// New unified send method on each adapter
sendCannedResponseBubbles(roomId, bubbles, quickReplies, channelContext) {
  // 1. Filter bubbles for this channel
  const filtered = bubbles.filter(b => b.channels.length === 0 || b.channels.includes(channel))
  // 2. Translate each bubble to channel-specific message
  const messages = filtered.map(b => translateBubble(b, channel))
  // 3. Attach quick replies to LAST message (LINE/FB convention)
  if (quickReplies.length > 0) {
    messages[messages.length-1].quickReply = translateQuickReplies(quickReplies, channel)
  }
  // 4. Send batch (LINE supports up to 5 messages per pushMessage call)
  return channelAdapter.pushBatch(roomId, messages)
}
```

### Quick Reply routing (Phase 2)

When customer clicks Quick Reply button:
- POSTBACK: webhook receives `postback.data` = the `payload` string → routes to bot/intent matcher
- URL: opens URL in browser (no backend hit)
- MESSAGE: sends a fake customer message with `message` text → triggers normal bot flow

Routing logic: extend existing `chat-intent-router` to match `postback.data` to a registered intent/action.

## Migration strategy (Phase 1)

1. Add `CannedResponseBubble` table (empty)
2. Run data migration: for each existing `CannedResponse` (27 templates), create 1 `CannedResponseBubble` with type=TEXT, text=content, sortOrder=0
3. Keep `CannedResponse.content` column (don't drop yet — backward compat for picker)
4. Update preview endpoint to return bubbles array (fallback to `content` if no bubbles)
5. Update picker to render bubbles (Phase 1: text only, just shows first bubble's text — same as before)

Phase 3 drops legacy columns after picker fully uses bubbles.

## File structure

### Backend
- `apps/api/prisma/schema.prisma` — schema changes
- `apps/api/prisma/migrations/<timestamp>_add_canned_response_bubbles/` — Phase 1 migration
- `apps/api/prisma/migrations/<timestamp>_add_quick_reply_and_flags/` — Phase 2
- `apps/api/prisma/migrations/<timestamp>_expand_bubble_types/` — Phase 3
- `apps/api/src/modules/staff-chat/services/canned-response-bubble.service.ts` — new
- `apps/api/src/modules/staff-chat/services/canned-response-quickreply.service.ts` — Phase 2
- `apps/api/src/modules/staff-chat/staff-chat.controller.ts` — new bubble + quickreply endpoints
- `apps/api/src/modules/chat-engine/adapters/*.ts` — extend to handle bubble array
- `apps/api/src/cli/migrate-canned-response-content-to-bubbles.ts` — one-shot migration script (Phase 1)

### Frontend
- `apps/web/src/pages/canned-response-admin/BubbleList.tsx` — Phase 1
- `apps/web/src/pages/canned-response-admin/BubbleEditor.tsx` — Phase 1 (type-specific routing)
- `apps/web/src/pages/canned-response-admin/bubble-editors/TextBubbleEditor.tsx` — Phase 1
- `apps/web/src/pages/canned-response-admin/bubble-editors/ImageBubbleEditor.tsx` — Phase 1
- `apps/web/src/pages/canned-response-admin/bubble-editors/StickerBubbleEditor.tsx` — Phase 1
- `apps/web/src/pages/canned-response-admin/BubbleTypePicker.tsx` — side panel "เพิ่มประเภทข้อความ"
- `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` — Phase 2
- `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` — Phase 2
- `apps/web/src/pages/canned-response-admin/bubble-editors/CardBubbleEditor.tsx` — Phase 3
- `apps/web/src/pages/canned-response-admin/bubble-editors/LocationBubbleEditor.tsx` — Phase 3
- (etc. for other types — Phase 3)

## Non-goals

- LINE Flex Bubble JSON validator (use LINE official SDK validation if available, else skip)
- Image Map area editor with drag (use simple rect input fields — drag is nice-to-have)
- Video transcoding / thumbnail generation (rely on URL provided by user)
- Real-time preview in LINE simulator (use LINE's own simulator for QA)
- Quick Reply payload designer (POSTBACK payloads are free-text strings; user types JSON manually if complex)

## Open questions

- **Q1**: Stickers — LINE has thousands. Provide a curated picker or just `packageId` + `stickerId` text inputs?
  - **Default**: text inputs in Phase 1 (no curated picker). Add link to LINE sticker docs.
- **Q2**: Quick Reply POSTBACK routing — extend chat-intent-router or new dedicated handler?
  - **Default**: dedicated handler `quick-reply-router.service.ts` — keeps separation of concerns.
- **Q3**: Image upload — direct S3 from browser (signed URL) or via backend?
  - **Default**: via backend (existing pattern in the project). Add `POST /staff-chat/canned-responses/bubbles/:id/image-upload` accepting multipart.
- **Q4**: Phase 3 — should we implement ALL types or pick the top 3-5 most useful?
  - **Default**: implement TEXT/IMAGE/STICKER (Phase 1) + CARD + LOCATION + VIDEO + JSON. Skip IMAGE_MAP (complex editor, rarely used) and RICH_MESSAGE (legacy LINE format, replaced by Flex). FILE optional.
