# Staff Inbox UX Overhaul — Design

**Date:** 2026-06-25
**Status:** Approved (brainstormed + scrutinized)
**Scope:** `apps/web/src/pages/UnifiedInboxPage/**` (+ `MainLayout.tsx` in Batch 0)
**Source:** 6-dimension, 73-finding UX review of the staff Unified Inbox (composer, messages, list, customer panel, real-time/AI, mobile/a11y). All findings were verified against source during the review.

## Goal

Make the staff chat inbox materially more user-friendly for busy Thai mobile-phone-shop staff who juggle many live customer conversations across LINE Finance / LINE Shop / Facebook / TikTok — without adding dependencies, breaking the design-token system, or regressing the real-time flow.

## Approach

- **Batch-by-batch.** Each batch is a coherent chunk (mostly one file group), shipped as its own branch → main → deploy → user review, then the next batch. The user explicitly chose ordered delivery with review between batches.
- **Ordering is by user-harm, not file-cohesion** (scrutiny revision). The two highest-harm items — a safety bug (silently locking the *wrong* customer's device) and a hard mobile blocker (the composer hidden behind the bottom nav so staff cannot tap Send) — were pulled out of their "natural" file batches into **Batch 0**, done first.
- **The riskiest, lowest-necessity item (optimistic send) is descoped** out of the quick-wins batch into an optional, separately-tested batch at the end (scrutiny revision).
- **YAGNI on the long tail.** ~8 items carry most of the value. Low-ROI polish (token-izing channel colors, timestamp tooltips, micro-a11y) is done *only when cheap inside a batch it already touches* — not as first-class deliverables.

## Cross-cutting decisions

1. **Per-room drafts** — keep a `Map<roomId, string>` in a ref **inside `ChatPanel`** (no prop threading; `ChatPanel` is reused, not remounted, per room). In an effect keyed on `session?.id`: write the previous room's `inputText` into the Map, then load the new room's draft (or `''`) into `inputText`; reset `selectedSuggestion` alongside. **No `sessionStorage` mirror** (YAGNI — full-refresh draft loss is rare and not worth the complexity). This fixes both the real carry-over bug (`inputText` is unkeyed local state, `ChatPanel.tsx:117`) and draft loss on switch-back.
2. **Notification mute** — a `localStorage`-persisted global speaker toggle in the list header gating `audio.play()`, plus a per-room muted-id `Set`. Defer `Notification.requestPermission()` from mount to an explicit opt-in.
3. **Keyboard nav** — `j`/`k` + arrows walk the rooms (skip when an editable element is focused, reusing `isEditableTarget` from `useKeyboardShortcuts`); `/` at the start of the composer opens an inline filtered template list. The sorted room list must be lifted out of `ConversationList`'s `useMemo` to the page (or a shared hook) so the shortcut handler can reach it — a small but real architecture change.
4. **Undo** — `resolve` and `return-to-AI` are server-reversible, so add an "เลิกทำ" action to their sonner success toast instead of adding confirm dialogs.
5. **Optimistic send (if built)** — `setQueryData(['chat-messages', roomId])` to append a `SENDING` bubble, reconcile against the server echo on refetch, flip to a red "แตะเพื่อส่งซ้ำ" on failure. Must dedupe the optimistic bubble vs the server copy and unify the **two** failure paths (the HTTP `catch` in `sendRoomMessage` *and* the separate `onSendFailed` WS event). This is the single highest-risk change → its own batch, manual + e2e verification.

## Batches

Each item lists the primary location and (impact / effort).

### Batch 0 — Safety + mobile blockers (do first)
- **Multi-contract picker for MDM lock / contact-log / view-contract** — these silently target `activeContracts[0]` (the code comment admits it) so a customer with 2 contracts can get the **wrong device locked**. Reuse the existing `send-link` `DialogView` picker whenever `activeContracts.length > 1`. `Customer360Panel.tsx:312-324,339-346,366-373`. (high / M — safety)
- **Composer above the bottom nav (mobile)** — `/inbox` is a FULL_BLEED route, so the fixed 56px `MobileBottomNav` paints over the composer; staff tap the tab bar instead of Send. Add `/inbox` to a no-bottom-nav set in `MainLayout`, or make the composer `sticky bottom-0` with safe-area padding. `index.tsx:274` + `MainLayout.tsx`. (high / M)
- **Restore the 360 panel on 1024–1279px tablets** — between `lg` and `xl` both the inline panel (`hidden xl:block`) and its drawer trigger (`xl:hidden`) vanish, so contracts/overdue/MDM are unreachable on common shop tablets. Align the breakpoints (drop inline panel to `lg:block`). `index.tsx:321` + `ChatPanel.tsx:393`. (high / S)

### Batch 1 — Composer core
- **Per-room drafts** (decision 1). `ChatPanel.tsx:117` + `index.tsx`. (high / M)
- **Auto-grow textarea** — recalc height to `scrollHeight` capped at `max-h-32` on input; reset on send. `ChatPanel.tsx:727-728`. (high / S)
- **Focus the composer on room open** — guarded by `!isResolved`. `ChatPanel.tsx:223-238`. (medium / S)
- **Spinner on send + file upload in progress** — swap icon for `Loader2` while pending; disable paperclip during upload. `ChatPanel.tsx:730-741,182-188`. (medium / S)
- **Enter / Shift+Enter hint + send aria/title.** `ChatPanel.tsx:726,730-741`. (medium / S)
- *Optimistic send is NOT here — see Batch 7.*

### Batch 2 — Attachments & message rendering
- **Paste + drag-drop image upload** — `onPaste` (clipboard image → `onSendFile`) and `onDrop`/`onDragOver` with a "วางรูปที่นี่" overlay, reusing `handleFileSelect`. `ChatPanel.tsx:715-729`. (high / M)
- **Render media by type** — branch on `message.mediaType` (currently declared but unused): doc → file chip (`FileText` + name, opens new tab); image → `bg-muted animate-pulse` skeleton + `onError` "รูปภาพหมดอายุ/โหลดไม่ได้" card. `MessageBubble.tsx:14,273-282`. (high / M)
- **Linkify URLs in messages** — wrap URL matches in `<a target="_blank" rel="noopener noreferrer">`; apply to the plain text branch too. `MessageBubble.tsx:285`. (high / M)
- **Copy-message button on text bubbles** — hover/long-press, `useCopyToClipboard` + toast. `MessageBubble.tsx:261-286`. (high / S)
- **Cap sticker (~96px) / GIF (~160px) + lazy.** `MessageBubble.tsx:106,213`. (low-medium / S)

### Batch 3 — List & triage
- **Loud "ต้องตอบ" (handoff) badge** — filled destructive Badge, differentiate by shape/weight not just hue. `ConversationItem.tsx:43-69`. (high / S)
- **Compact list timestamps** — terse formatter (`5น`/`2ชม`/`HH:mm`/`เมื่อวาน`). `ConversationItem.tsx:189-191`. (medium / S)
- **Relative date separators** in the thread (`วันนี้`/`เมื่อวาน` via date-fns). `ChatPanel.tsx:452-454`. (medium / S)
- **Search clear (X) button.** `ConversationList.tsx:131-142`. (medium / S)
- **Stronger active-room highlight** — `border-l-[3px]` + `bg-primary/10` + `aria-current`. `ConversationItem.tsx:166-172`. (medium / S)
- **Unread count badge on the tab.** `ChannelFilter.tsx:36-56`. (high / M)
- **`j`/`k` room nav + jump-to-latest button + "ข้อความใหม่" divider** (decision 3). `useKeyboardShortcuts.ts` + `ChatPanel.tsx:217-238,443-465`. (high / M)
- **"อ่านทั้งหมด" + smarter empty state (no-data vs filter-hid) + richer search** (lastMessage.text + assignedTo.name). `ConversationList.tsx:104-211`. (medium / S)

### Batch 4 — Real-time trust & notifications
- **WebSocket connection-status pill** — track `socket.connected`, expose from the hook, render green `เรียลไทม์` / amber `กำลังเชื่อมต่อใหม่...` / red `ออฟไลน์ — กดรีเฟรช`. `useChatSocket.ts:144-146,179` + `index.tsx:73-103`. (high / M)
- **Persistent collision banner + staff typing** — wire the already-emitted `chat:viewers` into `onViewers` → "👁 <name> กำลังดูแชทนี้" banner; call debounced `startTyping`/`stopTyping` from the composer. `index.tsx:95-98` + `useChatSocket.ts:167-173` + `ChatPanel.tsx:718`. (high / M)
- **Mute toggle (global + per-room) + deferred permission** (decision 2). `index.tsx:36-63,91-93`. (high / M)

### Batch 5 — Customer panel & actions
- **Link an existing customer from chat** — add "ผูกกับลูกค้าที่มีอยู่" (customer picker → existing `linkCustomer`) to the unmatched empty state, which today only offers "create new" (drives duplicates). `Customer360Panel.tsx:414-427`. (high / M)
- **Promote call / send-pay-link to the sticky header** (currently buried in a bottom popover). `Customer360Panel.tsx:782-835 → 474-528`. (high / M)
- **Undo on resolve / return-to-AI** (decision 4). `SessionActions.tsx:122-128,172-180` + `index.tsx:158-175`. (high / S)
- **Per-section skeletons + collapsible sections** (default warranty/chat-history/call-history collapsed). `Customer360Panel.tsx:531-779`. (medium / S-M)
- **Clickable contract cards → `/contracts/:id`; offline-staff visible in transfer + filter.** `Customer360Panel.tsx:644-703` + `SessionActions.tsx:87-118`. (medium / S-M)
- **Inline AI pause/resume** (list-row hover + ChatPanel header). `ConversationItem.tsx:30-70` + `SessionActions.tsx:143-180`. (medium / M)

### Batch 6 — Mobile & accessibility (remaining)
- **44px touch targets** on Back/Send/composer/list icons. `ChatPanel.tsx:336,400-418,502-741` + `ConversationItem.tsx:252-265`. (high / M)
- **Picker (emoji/sticker/GIF) as a full-width sheet on `<lg`.** `ChatPanel.tsx:527`. (medium / S)
- **Touch-reachable pin** (not hover-only) via `useIsMobile`. `ConversationItem.tsx:250-267`. (medium / S)
- **A11y pass** — conversation rows as real `<button>` (`ConversationItem.tsx:165`), `aria-label` on icon-only buttons (`ChatPanel.tsx:413` etc.), `focus-visible:ring`, `leading-snug` on 9–10px Thai labels (tone-mark clipping), `motion-reduce:animate-none` on typing dots. (medium / S each)
- **AI affordances** — "ร่างจาก AI" chip + don't hard-dismiss the suggestion panel; AI confidence chip + "แตะเพื่อแก้ไขก่อนส่ง"; AI suggest error/retry + on-demand "ให้ AI ช่วยร่าง". `ChatPanel.tsx:294-298` + `AiSuggestPanel.tsx`. (medium / S)
- *Only-if-cheap polish:* token-ize channel brand colors, timestamp tooltips, persist AI/channel filters.

### Batch 7 — Optimistic send (optional, separately tested)
- Full optimistic send with `SENDING → success / failed-retry` bubble (decision 5). Highest risk; only built if the post-Batch-1 send feel is still judged insufficient. Verified with manual + an e2e assertion, not bundled with anything else.

## Testing & rollout

- Every batch: `./tools/check-types.sh web` clean + **unit tests for pure logic only** (linkify, the terse timestamp formatter, the draft Map, the URL/date helpers) via vitest.
- **e2e smoke net:** extend `apps/web/e2e/chat-inbox.spec.ts` with 2–3 assertions (open a room → composer focused + scrolled to latest; send → list re-sorts; mobile width → composer visible above nav) as a regression net between batches, since most of these changes are UI behavior that unit tests can't cover.
- Ship per batch via branch → main → deploy (GitHub Actions → Cloud Run/Firebase) → user manual check → next batch.

## Out of scope / explicitly deferred

- Backend changes beyond what already exists (`linkCustomer`, resolve/return-to-AI, contract APIs are reused as-is).
- New dependencies, virtualization of the room list (not needed at current volumes), in-conversation message search.
- The long-tail polish items are done only opportunistically inside a batch already touching that file.

## Open items

- Batch 7 (optimistic send) is a *go/no-go after Batch 1* decision based on the actual send feel, not a commitment.
