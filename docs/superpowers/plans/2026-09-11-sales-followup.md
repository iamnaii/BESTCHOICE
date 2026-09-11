# Sales follow-up

Authorized by owner: “จัดไป”. Preserve all completed A–D behavior and the existing SHOP/FINANCE selector.

- [x] Show booking deposit, additional receipt and combined amount separately; link to the actual booking. Incomplete historical evidence must remain unknown.
- [x] Translate query failures into actionable Thai, retaining retry and focus behavior.
- [x] Capture main-product cost for new completed sales, including booking, online-through-writer and contract activation. Add optional one-to-one snapshot without guessed backfill. Owner-only margin uses known snapshots and reports missing coverage; this operational margin excludes bundles/fees and is not ledger profit.
- [x] Add bounded server snapshot exports for customers, contracts and sales using the same filters/role scope; one Repeatable Read transaction, one tier pass, as-of timestamp, maximum 10,000 rows with explicit error beyond the cap. Keep company-change download protection. Benchmark synthetic 10,000 rows.
- [x] Prepare read-only legacy audit and staging checklist; owner confirmed no staging exists; document provider verification limits. Never send real OTP/messages without explicit authorization.
- [x] Read-only reviewer, targeted unit/API/isolated PostgreSQL and desktop/mobile browser coverage, then fresh `LOCAL_PREVIEW_PORT=5207 npm run local:check`. Leave preview running and document verification limits.

UX: reuse current detail sheet, semantic tokens, Thai dates and tabular amounts. Receipt sections distinguish previously received money from newly collected money; no change to journal posting.
