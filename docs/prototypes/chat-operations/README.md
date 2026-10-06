# BESTCHOICE Chat Operations — UX/UI V2.4

Preview: **http://127.0.0.1:5286/?v=2.4** · Previous prototype: http://localhost:5286/v1/

Redesigned 6 October 2026 using the explicitly requested **ui-ux-pro-max** skill, after comparing the prototype with the current Inbox source. This is a standalone design artifact, not a replacement production route.

## What changed

- Restored the original three Inbox views: รอตอบ / ของฉัน / ทั้งหมด, with channel and owner filters. ของฉัน means room ownership; delegated work is separately visible in งานวันนี้.
- Restored visible attachment, product, template, emoji, offer, pin, AI, notification, assignment, customer linking, credit, contract/payment, warranty and GFIN entry points.
- Added a separate work page combining appointments, handoffs and service follow-ups. Closing a conversation does not remove its work. Completed follow-ups remain discoverable.
- Preserved the original four dossier areas: ลูกค้า (including credit), สัญญา/ชำระ, ประกัน (including after-sales), GFIN.
- GFIN shows all 13 source-defined document slots, including the 3 required slots. Mock document markers demonstrate navigation; no actual finance application is submitted.
- Adaptive desktop/tablet/mobile layout, light/dark themes, keyboard focus and scroll preservation. Existing Thai/Emerald branding and official local logo asset retained.

## Try it

1. In คุณมุก, type a draft, switch rooms and return. Try a template with Ctrl+K or select a product; use the preview and ใส่ข้อความ to prepare text for review, or ส่งทันที to simulate a direct canned response.
2. Attach a **sample** file, choose ทดสอบส่งล้ม, send and retry. The waiting count changes only after successful simulated send; the file appears once.
3. Open ไฟล์ and choose ตรวจเครดิต. Run the mock analysis; it does not approve credit or advance a sale.
4. Start GFIN. Enter fictitious customer details, choose a device, mark sample documents, review text and simulate sending. Navigate away and back to inspect the retained draft.
5. Set an appointment, close the conversation, then open งานวันนี้. Complete the appointment and find it in เสร็จแล้ว.
6. Send a task to แพรว, switch the actor selector, accept and complete the task. Room ownership remains unchanged.
7. Open คุณเก่ง → ประกัน to inspect warranty, link the seeded service intake to its matching case. Other customer/device pairs must not match this case.
8. Open คอมเมนต์ and prepare a public response. Inspect the team report and drill down to waiting conversations.

On mobile, the room menu contains pin/mute, notifications, actor/theme settings and failure simulation. The compact attachment counter opens the full filename/removal list. The person icon opens the dossier; กลับแชท returns to the conversation. SHOP/FINANCE is selected in the mobile navigation instead of an independent top-bar company selector.

## Simulation boundaries

- All data is synthetic and held in memory. Reload / เริ่มใหม่ resets it. Sample time stays fixed at **5 Oct 2026, 10:30 Bangkok**; it is not today's live queue.
- Selected files retain **names/sizes only**. No file bytes are uploaded or analyzed. GFIN uses explicit sample document markers.
- Credit analysis, messages, assignment and submission are local simulations. No APIs, database, Meta, real credit decision, call or financial transaction are invoked.
- PDF, MDM, telephony, customer merging, advanced GFIN link/result operations and complete contract creation are documented handoff points to existing workflows, not working production integrations.
- Reports mix stated fixed sample timing/revenue with interactive queue/task counts. No analytics claims about real staff.
- Actor switching is for flow review and is not authentication or authorization. Real grants and signed-contract commission guards must remain in the app.
- `app.js` retains the initial six-flow simulation. `workbench.js` supplies V2 presentation, restored controls and additional mock workflows. `chat-composer.js` + `chat-composer.css` restore the original media/template controls. `style.css` + `workbench.css` form the base prototype style layer; production integration must reuse React, shadcn/Radix, semantic tokens, TanStack Query and the existing domain components.
- Native dialog and one live status region are prototype stand-ins for the app's Radix/Sonner components.

## Evidence

- [Source-to-design parity audit](../../reports/2026-10-06-chat-ux-v2-parity.md)
- [UX plan](../../superpowers/specs/2026-10-05-chat-operations-ux-design.md)
- [Six-feature plan](../../superpowers/plans/2026-10-05-chat-operations-master.md)
- [V2 browser verification](verification-v2.json)
- [Desktop](screens/v2.1/desktop.png) · [Mobile](screens/v2.1/phone-small.png) · [Work queue](screens/v2.1/desktop-work.png) · [Dark](screens/v2.1/desktop-dark.png)

Serve only this folder:

```bash
python3 -m http.server 5286 --bind 127.0.0.1 --directory docs/prototypes/chat-operations
```

## V2.1 detailed layout correction

Fixed short-screen clipping, unbounded attachments, landscape dialog footers, long post titles, text wrapping and scroll/focus recovery. See the [audit with reproduction measurements](../../reports/2026-10-06-chat-ux-layout-audit.md). QA scripts and results are in `qa/`; screenshots are in `screens/v2.1/`.


## V2.2 original composer restoration

- Corrected clipped focus outline and restored equal icon controls in the source order: attachment, emoji/sticker, product, canned response. Tabs connect to the input border; empty send is disabled.
- Emoji popover has all five original categories and inserts at the selection/caret. LINE has the three original sticker packs (34 locally cached PNG previews). Facebook exposes Emoji/GIF tabs like the original; **GIPHY remains disconnected** in this standalone artifact.
- Canned response dialog restores searchable categories, single-click preview, double-click insert, Ctrl/Cmd+K, customer/product variable expansion, ใส่ข้อความ and ส่งทันที. The six template records are **synthetic examples, not the saved production template library**. Rich multi-bubble template/API rendering remains the responsibility of the existing production MessageTemplatePicker.
- Insertion preserves reply/note mode. Simulated direct sends and retries preserve other draft text and pending attachments.
- Native HTML popover is a prototype stand-in for the original Radix Popover, including Escape, outside click and trigger toggle.

[Composer audit](../../reports/2026-10-06-chat-composer-restoration.md) · [Focused verification](qa/composer-results.json) · [Desktop focus](screens/v2.2/desktop-focus.png) · [Canned responses](screens/v2.2/desktop-templates.png) · [LINE stickers](screens/v2.2/desktop-stickers.png)


## V2.3 composer alignment and product search

Removed overlapping tab/card edges in both reply and note modes. Flat mode controls sit separately above the continuous input border; note focus uses amber consistently. The textarea grows automatically and scrolls its contents when vertical space is limited, keeping Send/Save reachable while typing.

Product selection now searches the three local stock fixtures by model, color, storage or price, including compact queries such as `128GB` and `iphone15`. Results preserve the original product identity and insert at the caret without sending. Empty results, clear search and reopening are covered by browser tests.

[Reproduction and verification](../../reports/2026-10-06-chat-composer-v23.md) · [Product results](qa/product-results.json) · [Note layout](screens/v2.3/light-note.png) · [Product search](screens/v2.3/product-search.png)


## V2.4 internal cloud attachment picker

Click the paperclip → **คลาวด์ในระบบ**. The original **จากเครื่องนี้** option remains available.

- Folder browsing, filename/description search, type filtering, sort by name/date/size, grid/list views and metadata details.
- Select multiple files across folders/searches, clear selection, then **แนบไฟล์ที่เลือก** to stage them in the composer. Nothing sends until the normal Send action. Cancel discards only the unconfirmed selection.
- Already staged cloud files cannot be added twice. Selection resets on reopening and is scoped to the opening room and work/company. Switching room before confirmation is rejected.
- Simulated file-only sends and retries work with both local and cloud attachments. Editing the attachment set invalidates the previous failed attempt; Retry cannot silently send a changed set or a phantom file message.
- **The cloud catalog is metadata-only synthetic data.** There are no real file bytes, thumbnails, storage quota, upload-to-cloud, folder management or external-provider connections. Image-type cards use file-type icons; the detail panel explicitly says no real content is present.
- The repository has `StorageService` and the existing room upload API; a shared library list/folder picker API was not found. A production version needs a central file/folder catalog, existing authorization/company scope, preview URLs, and sending by validated file identity through the room flow. The prototype never invokes those APIs.

[Cloud picker verification](qa/cloud-results.json) · [Desktop](screens/v2.4/cloud-library.png) · [Selection](screens/v2.4/cloud-selected.png) · [Mobile details](screens/v2.4/cloud-mobile.png) · [Implementation record](../../reports/2026-10-06-chat-cloud-picker.md)
