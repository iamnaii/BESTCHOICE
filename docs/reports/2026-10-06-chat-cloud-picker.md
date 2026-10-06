# Internal cloud attachment picker — V2.4

The user requested selecting existing files from an internal cloud library, using a Chatcone picker screenshot as reference. Added the interaction to the current standalone chat prototype; no production API or application source was changed.

## Scope and behavior

Paperclip opens **จากเครื่องนี้ / คลาวด์ในระบบ**. Cloud selection provides folders, search, file-type filter, sort, grid/list view, metadata details and multi-selection that survives folder/filter changes. Confirm stages files in the room composer; normal Send performs only a local simulation. Cancel does not mutate pending attachments. Already attached file IDs are disabled on reopening. SHOP and FINANCE fixture catalogs are separate; stale-room confirmation is rejected.

The catalog contains 8 SHOP and 3 FINANCE records. These are names, sizes, types and dates, with file-type icons—not actual file bodies or recovered customer data. The interface explicitly labels the mock library. Folder creation, uploads to cloud, quota management and external provider integration are outside this selection-only addition.

## Integration reference

Existing source: `apps/api/src/modules/storage/storage.service.ts`; `staff-chat.controller.ts` room upload endpoint; `staff-chat/services/media-content.service.ts`. Existing room upload and stored-message media are not the same as a browsable central asset library. Production integration would need a scoped file/folder metadata catalog and authorized list/preview/send operations. Use validated immutable file identity/version and the existing send/idempotency conventions; do not expose permanent unrestricted storage URLs.

## Findings fixed during verification

- Generic dialog label rules overrode cloud label display/margins, duplicated the mobile folder dropdown on desktop and inflated toolbar height. Scoped cloud label rules now win consistently.
- At 320×360, multi-line filenames plus large thumbnail placeholders made some file buttons taller than the available scrolling viewport. Short-screen cards now use compact type icons and single-line labels; full filenames remain available through accessible labels and details.
- Existing retry used current attachments after failure. Removing a failed attachment could send only “ส่งไฟล์แนบ” and clear waiting. Editing pending attachments now invalidates that failed attempt. A signature check additionally prevents an old retry from using changed attachments if ordinary edit invalidation is bypassed. New draft edits require an explicit new Send; standalone canned/sticker retries remain unaffected.

## Verification

`qa/verify-cloud.mjs` covers local file chooser compatibility; search/folder/type/sort/views; metadata; cross-folder selection; cancel/clear; duplicate prevention; staging without sending; combined local/cloud file-only failure/retry; room/company isolation; and attachment edits after failure. It also checks 36 cloud layouts across 9 viewport sizes × 2 themes × 2 views, including 320×360 and 1024×390, with every rendered control hit-tested after scrolling user-scrollable ancestors.

Existing 9 interaction groups, 6 composer/media/template behavior groups plus 60 picker layouts, and 14 core workflow groups plus 98 responsive screens all passed on the final source. One parallel workflow run failed to find the initial attachment toolbar; an independent fresh-load diagnostic and a sequential full workflow rerun passed without runtime errors. The app-level `npm run local:check` passed on 6 October 2026 and leaves http://localhost:5207/inbox running; it does not validate this standalone prototype. Browser testing uses Chromium emulated viewports rather than physical-device keyboards.

Preview: http://127.0.0.1:5286/?v=2.4.
