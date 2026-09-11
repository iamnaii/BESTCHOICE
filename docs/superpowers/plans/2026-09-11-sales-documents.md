# Sales document follow-up

Owner authorized continuing local remediation. Reuse the existing document UI, QueryBoundary and branch policy; retain attachment and generated-document models because they represent different records, but give them unambiguous routes.

- [x] Separate generated-document listing from attachment listing and migrate both web consumers.
- [x] Enforce contract branch access for staff document/signature routes, including document ID ownership and deleted contracts.
- [x] Store actual generated PDF/HTML bytes before creating an EDocument; make partial generation and retry truthful.
- [x] Download through the authenticated API and retain company-change protection; show document list/preview errors with retry.
- [x] Align attachment actions with roles and recover clearly from failed uploads.
- [x] Read-only review, meaningful API/browser tests, fresh isolated local check and local commit. Leave preview running.

No staging exists. Database regressions use isolated fixture storage; the preview also verifies native PDF rendering and private local files. Notifications stay simulated; no external provider messages or deployment.

Final evidence: [document follow-up report](../../review/2026-09-11-sales/documents-followup.md).
