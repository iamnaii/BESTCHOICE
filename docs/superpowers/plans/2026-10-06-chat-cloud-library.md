# Internal chat file library — implementation addendum

> Use superpowers:executing-plans inline after F1–F6. User explicitly authorized all six features, UX/UI and the cloud library on 2026-10-06. This implements the approved V2.4.1 prototype with actual scoped storage references.

## Contracts

- Reuse StorageService and existing room authorization. Do not add a second company selector. SHOP/FINANCE is derived from the current workspace; branch is server-scoped. Refresh actor grants for list/count/download/upload/send. A file from another company/unauthorized branch cannot be selected by guessing its ID.
- Cloud files are explicit library uploads. Existing customer credit documents and message media are not automatically published into the shared library. UI states the destination workspace for uploads.
- Folder/file rows hold company, branch, creator, immutable storage key, name, MIME, byte size, timestamps and deletedAt. Keys are server-generated. No arbitrary URL/key is accepted from the browser. Private previews/downloads authorize before streaming; provider delivery uses the existing signed media path.
- JPEG/PNG/WebP/GIF/PDF initially; use existing server-side byte/MIME validation and size limits. No SVG/HTML preview. Limit list pages and multi-select count, validate uploads, and remove orphaned uploads when DB persistence fails.
- Selecting files stages attachments. It never sends to the customer automatically. Room/mode/company changes cannot send a stale selection. Internal-note mode must not send provider messages.
- Each confirmed attachment has a stable client request token. Retry confirmed files does not resend them; unknown provider acknowledgement blocks blind retry. Selection changes get new tokens. Progress/errors identify which files succeeded.
- Credit import copies through the existing RoomCreditService upload/validation path with an authorized library reference and an idempotent request key; keep credit records independent of later library archival.
- Feature flag chat_cloud_library_enabled defaults off; enable only isolated preview fixtures during this work. No live cloud migration or provider activation.

### Task 1: Scoped folders/files and storage

Create additive Prisma models/migration, shared contracts, controller/service/DTOs and isolated PostgreSQL + storage fixture tests. Implement paginated searchable folder/file listing, create folder, upload and authorized preview/download. Assert cross-company/branch denial, revoked grants, deleted folders/files, duplicate upload request and failed DB/storage cleanup. Use real local bytes in managed preview; do not represent metadata fixtures as actual cloud integration.

### Task 2: Stage and send authorized library references

Add room-scoped cloud attachment endpoint resolving IDs server-side into the existing MessageRouter provider acknowledgement workflow. Validate each file against current actor + room scope. Add credit-import endpoint using existing credit service. Test partial success, retry/double click, ambiguous delivery, selection changes, stale room/company, and no provider send from notes. Extend synthetic preview using a local storage adapter and acknowledgement fixture only.

### Task 3: Picker and UX parity acceptance

Implement actual React picker with folders, search, MIME filter, thumbnails/details, keyboard multi-select, selection count, clear/add/cancel, loading/empty/error states, responsive layout. Add clear entry beside local file upload; keep emoji, stickers, canned responses and searchable product picker available. Fix credit upload buttons to equal heights and aligned baseline; composer is one continuous surface, note mode visibly distinct, controls never overflow at 320–1920px. Verify approved source parity inventory against original app, add meaningful browser scenarios to managed local:check, and leave the latest verified local preview running. Final report distinguishes isolated storage/provider fixtures from unverified live credentials/capabilities.
