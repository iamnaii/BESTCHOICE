# Whole-program simplification audit and consolidated change

Completed a repository-wide scan before selecting and implementing one consolidated batch. The scan covered **2,872 production/source/tool files**: admin web 1,094, storefront 144, API 1,585, card reader 2, shared package 28 and tools 19. Tests, generated output and dependencies were excluded from duplication ranking. This is a structural scan plus manual review of the candidates and their callers, not a claim that every application behavior has been exhaustively tested.

Two complementary passes found 31 groups of repeated code blocks and 29 groups of identical function bodies; those sets overlap. Large functions were inventoried separately. Size alone was not used as a reason to split a cohesive workflow. Generated UI primitives shared between the two apps were excluded from duplicate-block ranking.

## Implemented together

| Area | Change and preserved behavior |
| --- | --- |
| Flex editor | Greeting and Broadcast share template/JSON controls, dynamic fields and previews. Greeting retains alt text, its extension fields and original hover color. Switching templates clears fields as before. |
| Permission settings | Both settings cards share the user/permission table. OWNER gates, endpoints, grants, mutations and cache invalidations stay in each caller. Branch-manager income restrictions apply only to accounting permissions. |
| Collections | Queue and Promise tabs share the loading card and current-page contacted/remaining projection. Server filters, pagination, grouping and actions remain separate. |
| Action descriptions | Early payoff, rescheduling and device-return forms share the identical effect list item; the existing device-return export is retained. |
| Expense inputs | Expense preview and credit-note submission share the same line field conversion. Petty-cash supplier/amount fields and normal-expense-specific fields remain unchanged. |
| Money display | Eight pages use three explicit existing formatting policies, preserving their different placeholders and Number/parseFloat behavior. Customer-facing product summaries reuse the already-exported deterministic shared Baht formatter. Global display preferences are unchanged. |
| Job durations | Backup and PDPA settings share their identical elapsed-time formatter. |
| Storefront FAQ | Three landing pages share FAQ markup; each page retains its own content, title and JSON-LD. |
| Document numbers | Device-return and other-income numbering reuse existing Bangkok date/month and advisory-lock hash utilities. Removed unused day-boundary construction; prefixes, lock inputs, sequence queries and transaction boundaries are unchanged. |
| Receipt metadata | Receipt fee and payment-history modules share finite Decimal parsing. Query scopes, history matching and treatment of missing/ambiguous history are unchanged. |
| Watch-list risk | Customer and dashboard services share the score/threshold/reason rule. Queries, limits, result shapes and caller-specific amount conversion remain local. |
| Bot evaluation | Production and the evaluation CLI share recommendation-budget parsing and confidence policy. Existing `isBarePromise` export remains available. No live bot evaluation or external message send was performed. |

**Scope:** 33 existing production files changed, 12 shared modules added, six behavioral test files added. Production code went from 14,346 to 14,027 lines across these files, including the new modules: **319 lines removed net**. Unrelated pre-existing checkout changes were preserved.

## Reviewed and intentionally retained

- Financial transaction and persistence differences: reverse-entry mappings, company resolvers/caches, expense versus credit-note tax flags, contract queries and checkout/payment confirmation paths. Combining these by appearance would obscure different contracts or change transaction behavior.
- Security boundaries: channel-specific webhook guards, PII access/fallback code and database-target checks in maintenance CLIs. Their validation remains visible at the relevant boundary.
- Destructive test-data cleanup routines remain self-contained; this refactor does not change deletion order or scope.
- Short form wrappers, option lists, date-filter markup, dashboard skeleton fragments, URL parameter setters and individual loading/error/profile blocks stay local where a new abstraction would add more indirection than useful sharing.
- DTO create/update differences and facade compatibility exports remain explicit. Repeated explanatory comments and import lists are not treated as duplicate implementations.
- PDF document-specific layout remains local; existing shared fonts, page CSS and formatting helpers already handle the common behavior.
- Card-reader/tooling/shared-package scan did not identify an additional change justified by this batch. Existing shared helpers were reused where applicable.

These are deliberate boundaries for the completed batch, not another proposed list of three follow-up edits.

## Validation

- Independent read-only review compared all 45 production files to their exact pre-change contents. No semantic blockers. Orphaned comments and trailing blank lines reported by review were corrected.
- Focused admin web: **534 passed** (516 existing related cases plus 18 new cases).
- API regression on disposable, isolated SHOP/FINANCE PostgreSQL databases: **1,090 passed**, with **three existing skipped tests**. Includes device returns, other income, receipts, customers, dashboard, sales bot and shared date/risk helpers.
- Additional real PostgreSQL dashboard integration: **3 passed**. The temporary database process was stopped by its owning harness; no inherited application database was used.
- Full admin/storefront/shared suite: **2,978 passed** (admin 2,818, shared 128, storefront 32). Combined with the API runs: **4,071 passed**; focused tests are not double-counted.
- **248 differential cases** matched the exact old implementations for all eight money-format callers, two duration callers, expense/credit-note line mappings, both risk-score callers and bot-budget parsing.
- Browser: actual permission cards exercised owner locks, branch-manager restrictions, cancel, distinct save payloads and non-owner visibility; writes were intercepted synthetic fixtures.
- Browser: actual Queue/Promise tabs retained filtering, current-page counts and distinct server query tabs with synthetic records.
- Browser: all three actual storefront landing pages at 390px showed FAQ text matching each page's JSON-LD, without horizontal overflow or page errors.
- Refreshed-preview browser regressions also passed for all Greeting templates/save payloads, Broadcast previews, payment/reschedule overlays and early-payoff/repossession journal displays. The existing receiving and OCR regression checks passed as part of those scripts.
- **`LOCAL_PREVIEW_PORT=5207 npm run local:check`: PASS**, completed at 22:34 Bangkok. Includes API/Web types, lint, builds, managed backend refresh and desktop/mobile smoke flows. `git diff --check` passes. `local:status` reports running/current.

The changed-flow browser checks use real components with synthetic authentication/API/storage fixtures. They do not validate live LINE delivery, live OCR/card readers, payment providers or production accounting/customer writes. The managed preview is a limited synthetic environment, not full end-to-end production coverage. Existing nonblocking build/lint warnings remain.

## Evidence and preview

- Preview: <http://localhost:5207/inbox>; verified storefront: <http://localhost:5208/ผ่อนไอโฟนลพบุรี>.
- Inventory/candidate evidence: `.tmp/whole-program-audit/inventory.json`, `functions.json`.
- Exact batch baseline: `.tmp/whole-program-audit/before.json` (`null` denotes a new file).
- Tests and browser logs/scripts: `.tmp/whole-program-audit/`.
- Complete managed result: `.tmp/local-preview/check.json`.
- Verified source fingerprint: `3892a6b768c0da31ea67daa846d0c77478d4d5882bbcc8f7eff713e3237e797f`.

No commit, merge, deployment or external message send was performed.
