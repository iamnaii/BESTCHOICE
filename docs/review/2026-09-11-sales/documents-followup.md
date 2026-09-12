# Sales document follow-up — 11 September 2026

This continues the six-menu Sales remediation. Attachment records and generated documents remain separate models: attachments are versioned customer/evidence files; generated documents are rendered outputs. Their formerly colliding list routes are now `/contracts/:id/documents` and `/contracts/:id/e-documents`. Both web consumers use the correct envelope and route.

## Implemented

- Staff file, preview and signature routes check the actual contract's branch. Branchless SALES/BRANCH_MANAGER fail closed; cross-branch roles retain access. Attachment IDs must belong to the contract. Deleted contracts/documents are excluded, including nested contract responses.
- Generated PDF or fallback HTML bytes reach storage before metadata is committed. Rendering failure produces a downloadable HTML document with truthful partial status. Storage failure creates no phantom document.
- Rendering, persistence, signed attachment and completion notification compare the same source revision. Signature writers share the contract lock; rendering/storage remain outside short transactions. Deleting a draft signature retires prior generated/signed evidence and cancels queued notices. The replacement signed attachment advances its version while preserving old rows/files.
- Concurrent generation retries create one current signed attachment and one completion notice. The notification worker claims document notices conditionally and preserves cancellation through completion/failure updates. Cancellation after outbound dispatch starts cannot recall the external request.
- Attachments validate decoded size, base64 and supported format headers; client MIME/size claims cannot override the actual upload. Versions serialize on the contract. View auditing precedes stream creation; stream errors return a retryable response.
- Downloads use the authenticated client and discard responses after company scope changes. Lists and previews show loading/failure/retry states, generated documents paginate, and the completion screen distinguishes PDF success from HTML/partial failure.
- The workflow upload step uses the same required-type checklist instead of counting files; duplicate photos cannot mark missing identity/guardian documents complete. Auto-generated signed PDFs are excluded from the upload step so signing remains reachable.
- Upload actions follow role/contract state; guardian requirements come from the server checklist. A failed multi-file batch preserves successful files and identifies the failed file. The preview dialog supports keyboard dismissal/focus return and 44px actions at mobile widths.

## Verification

- Read-only reviewer: PASS, no remaining blocker after signature/notification race fixes.
- API unit regressions: 8 suites, 118 tests passed, including existing notification policies and document templates.
- Isolated PostgreSQL: 11 suites, 145 tests passed. The 19 document tests include branch/ID scope, exact file bytes, stream failure, HTML fallback, concurrent versions/retries, storage failure, disguised content, deleted aggregates, paused rendering with delete/re-sign, and paused notification worker cancellation.
- Focused web tests: 3 files, 12 tests passed, including StrictMode generation retry and company-change download protection.
- `LOCAL_PREVIEW_PORT=5207 npm run local:check`: PASS on the final source; TypeScript, lint (zero errors, existing warnings), Web 1,976 tests, shared/storefront checks, builds and managed browser smoke. See [local check evidence](documents-preview/local-check.json).
- Real local document check: PASS at 1440px and 390px. Native contract PDF: 7 pages / 230,006 bytes; PDPA PDF: 2 pages / 150,108 bytes. Parsed PDF pages and matching SHA-256, binary browser download, image upload/open/close and exact protected attachment bytes. No page exceptions or horizontal overflow. See [native evidence](documents-preview/check.json), [desktop](documents-preview/documents-1440.png) and [mobile](documents-preview/documents-390.png).
- Final six-menu browser regression: 30/30 passed at 1440px and 390px using isolated API fixtures. It covers all six Sales menus plus document retry/download, role visibility, duplicate-file checklist readiness, partial uploads and keyboard preview focus.

## Boundaries

No staging or external provider account is available. PostgreSQL tests use a disposable database, a fixture PDF renderer and in-memory storage; transport tests never send messages. The local preview additionally exercises native Chromium PDF rendering and private local file storage with synthetic identities. This does not validate production object storage, LINE delivery, or production credentials. No deployment or external messages are part of this work.
