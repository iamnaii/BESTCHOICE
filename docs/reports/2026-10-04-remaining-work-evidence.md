# BESTCHOICE remaining work — evidence, 4 October 2026

Implementation checkout: `/Users/iamnaii/Desktop/App/BESTCHOICE-remaining-work`.
Branch: `fix/remaining-work-2026-10-04`.
Main baseline: `b57646376744f9b979ea678a4b52e497c39aaeb3`.
Plan: [remaining work](../superpowers/plans/2026-10-04-bestchoice-remaining-work.md).

This report distinguishes code, local verification, deployed configuration and external acceptance. The initial implementation was read-only in production. After the owner authorized the follow-up, one SMS delivery probe was sent to the designated test recipient and one obsolete configuration row was conditionally soft-deleted. No customer contract/accounting record, bypass setting, application deployment or release was changed.

## Status

| Task | Status | Evidence / remaining work |
|---|---|---|
| 0 baseline | prepared | New isolated worktree and independent dependency copies; original worktrees/PR branches/processes preserved |
| 1 payoff #1665/#1667 | verified-local | Exact commits merged with current main; only merge conflicts were web version, now 26.10.6; release still requires owner decision |
| 2 session #1604 | verified-local | Real HTTP guard test: 30 refreshes/3 sessions/one IP pass; 601st refresh is throttled; login 10 and password reset 5 unchanged; browser acceptance recorded below |
| 3 credit search #1605 | verified-local | Debounced search-empty copy precedes queue-empty copy; clear search restores queue copy |
| 4 page titles #1603 | verified-local | Current menus across all roles, including VIEWER/settings zone; longest prefix; detail/legacy labels retained |
| 5 PR4/PR7 | waiting for CPA | User confirmed on 4 Oct that latest answers are not yet available. No new VAT/receipt policy implemented |
| 6 QR payoff X4 | waiting for policy/design | Existing webhook distributes to installments; not claimed fixed by merging admin payoff changes |
| 7 bot #1645 | config already applied | Production hashes and KB match 27 Sep patch. Dry evaluation passes. Real-model E27 blocked by insufficient Anthropic credit |
| 8 staging/storage | waiting for environment | User is unsure; read-only GCP inventory found no separate staging in bestchoice-prod. Other projects remain unverified; proposed resources are in the acceptance packet |
| 9 physical print | waiting for physical acceptance | EPSON brand confirmed; exact model/operator unknown. 69 PDF samples packaged with Thai print checklist and SHA-256 hashes; no physical print claim |
| 10 orphan config #1606 | completed | Conditional one-row soft-delete committed and independently read back; private snapshot and guarded restore prepared |
| 11 test mode #1602 | already disabled; acceptance pending | Production `TEST_MODE_BYPASS=false`, updated 2026-10-02T00:15:53.621Z (07:15 Bangkok). Real SMS delivery confirmed by owner; live KYC completion/credit gate still need acceptance |
| 12 release/close | not released | No merge/deploy, no existing PR/issue state changed |

## Verified production configuration (read-only connector)

- Persona EXTRAS MD5: `b6c81bb95e05be880f86d45c11f8909b` — exact expected hash in #1645.
- `promo:imported-free-down` response MD5: `527c534ba64914062445d817bc406c75` — matches apply SQL.
- `faq:no-delivery-pickup-only` response MD5: `b55199e3e1e3e8938d04bbfed4fc54dd` — matches apply SQL.
- Rate card points to `bot-media/rate-cards/imported-free-down-2026-09-27.jpg`; read-only GCS metadata confirms the object exists in `bestchoice-documents`, size 270,658 bytes. Download/render and live bot delivery are not certified.
- All three bot changes above report 27 September timestamps. An open PR did not mean the configuration was unapplied. Do not rerun apply or bypass its drift checks.
- Connector noted two missing column grants versus its own manifest; these queries succeeded. No grants were changed.

## Tests and review observed

- Payoff baseline: 5 suites, 65 tests passed after integration. Quote, general advance, ledger, JP4 computation and repossession parity covered.
- Initial targeted web: 49 tests passed. New refresh regressions first failed (6 cases), HTTP throttler first failed (2 cases), bootstrap recovery first failed, and three menu/search regressions first failed.
- Real HTTP auth: 2 suites / 6 tests passed; credentials/rotation service is a fixture, Nest route and throttler are real.
- CORS: a real Nest HTTP test failed before `Retry-After`/`Retry-After-short` exposure, then passed.
- Independent reviewer found expired-token logout revocation and omitted settings-zone titles. Both fixed in `f9d62d675`; three added regression failures reproduced, then 29 focused tests passed.
- Bot dry evaluation: 67 scenarios / 141 scripted turns validated without provider calls or DB access. This is fixture/structural validation, not 67 successful live model conversations.
- One live synthetic E27 attempt used read-only prompt snapshots and fixture tools (no customer conversation or LINE transport). Provider returned HTTP 400: insufficient credit. No further paid attempts made; no live-model pass claimed.
- Initial `local:check` passed tooling, Prisma generation, types, API/Web lint, Web/Shared/Storefront tests and builds, but failed browser trade-in selection. Source changed during that run for reviewer fixes, so it cannot certify final source. Reproduction and final rerun results will be recorded below.

## Old tracker notes reconciled

- Petty-cash allow-list was implemented in commit `b9641b82d`; the docs fixture explicitly references the owner decision of 12 September. Do not reopen that policy question.
- Sticker integration now tests complete realistic model names and the 50×30 mm page bounds. Physical-printer acceptance remains separate.
- DOC-00–11 and DOC-14 were already closed under #1576. #1574/#1607 are parent trackers, not extra implementation scopes.

## Evidence locations

- `.superpowers/sdd/2026-10-04-bestchoice-remaining-work/`: baseline, RED/GREEN, full checks and ledger.
- `.tmp/local-preview/`: managed preview state, full check result and screenshots.
- `.tmp/remaining-work/`: synthetic browser evidence, bot evaluation and read-only prompt snapshots (not committed).
- [Acceptance and decision packet](../runbooks/2026-10-04-remaining-work-acceptance.md): outstanding inputs and exact acceptance steps.

## Additional verified checks

- Money invariants: exact CI Vitest selection, 79 files / 602 passed / 1 skipped on disposable SHOP and FINANCE PostgreSQL; no inherited DB URLs. Log `money-invariants.log`.
- Real browser, real application components/client, synthetic API: refresh 429 preserves an entered form; expired-token logout renews access and reaches cookie revocation; mobile bootstrap failure shows guarded retry and recovers; credit search/payoff overlay verified at 390/1440 pixels; six real TopBar routes including settings. No page errors. Evidence `.tmp/remaining-work/browser-check.json` and screenshots.
- Source-frozen local check at `989371f4c` passed all basic checks and the managed browser flows. A subsequent test-only improvement retains one owned HTTP listener for the 600-request burst; final checks are recorded below when complete.
- Initial full API regression: 841 suites passed; new HTTP burst test intermittently returned 404 while opening/closing an ephemeral listener per request. Reproduced on attempt 453 in a second run (stopped after the known failure). A fixed listener passed the three-suite reproducer (120 tests); full recheck remains required. This was a test transport issue, not evidence of a production auth 404.
- Initial document run hit Node's default 4 GB heap during compilation. Stopped only the owned failing run and restarted with the existing CI setting `NODE_OPTIONS=--max-old-space-size=6144`; no document assertion was suppressed.
- Read-only infrastructure inventory: `bestchoice-prod` has one Cloud Run API service, one PostgreSQL instance and two buckets; Firebase targets are production. No separate staging discovered in that project. This does not rule out an environment in another project/account.

- Independent financial review found no Critical/Important regressions versus main. The reviewer reproduced the approved 14,612.63 example and checked 48 combinations for balanced journal/cash/advance priority. Scope covered quote, transactional execution, JE, JP4, LIFF mapping and repossession; it did not approve unresolved policy. Existing limits include excess-credit rejection, classification beyond the deferred-interest basis, receipt VAT and QR settlement, and LIFF's omission of parked-advance presentation.
- The following full API run exposed a separate harness dependency: the GFIN DB suite expects a seeded branch. The disposable setup seeded only OWNER and previously relied on another suite leaving a branch. Added one synthetic branch to `tools/test-chat-credit.sh`; clean isolated GFIN reproduction passed 13/13. No application behavior changed. The earlier local-check run correctly rejected its source fingerprint after this harness edit; a frozen final run was started at `965bed267`.

- Final `local:check` at `965bed267` passed, finished 2026-10-04T04:27:03.808Z; preview remains at http://localhost:5211/inbox. Web 392 files / 2,896 tests; shared 145 tests; storefront 46 tests; types/lint/builds and managed browser flows all passed.
- Additional actual-app LIFF mobile quote check passed: 14,612.63 payable and 800 combined prior credit, using a synthetic cached identity and fixture API. No QR submitted and no LINE OAuth tested. The savings badge and combined-credit wording intentionally retain the explicit owner decision in PR5b plan lines 22-31; they must not be treated as an unapproved UI correction.

- Final isolated API run at `965bed267`: 842 suites / 10,540 tests passed, 2 suites / 14 tests skipped; then the same disposable harness passed all 12 end-to-end suites / 152 tests. Exit 0. Includes the previous credit-payment-flow regression and the fresh GFIN branch fixture. Log `api-regression-release.log`.

- Document browser acceptance exposed a mobile test-selector collision: menu-derived titles now duplicate the hidden desktop breadcrumb, so `getByText(...).first()` waited on the hidden element although the letters page was visible. Both letters/collections navigation checks now locate the page heading by accessible role and exact name. Full document-run failure is retained; complete targeted suites are rerun and reported separately. Application source did not change in this correction.

## Final document acceptance evidence

Full run `20261004T042023Z-18334` completed with 17 passing suites and 2 failing browser suites (letters/e-Tax: 4 assertions selecting a hidden duplicate title). Its FAIL status and log remain unchanged. All 74 PDF artifacts passed automated checks, with all 12 document groups represented.

After the heading-selector correction in `68cb3ecc1`, complete letters/collections browser suites passed 16/16 tests and complete e-Tax browser suite passed 7/7. Replacing only those complete suites gives 19 suites / 138 tests with no unresolved failures. Replacement requires identical assertion-name sets; this is a combined result after targeted reruns, not a claim that the original full run passed.

- Original output: `.tmp/remaining-work/documents-final/`.
- Corrected browser output: `.tmp/remaining-work/documents-browser-rerun/` and `documents-etax-rerun/`.
- Print pack: `.tmp/remaining-work/BESTCHOICE-EPSON-print-pack-2026-10-04.zip` (69 distinct PDFs, about 15 MB).
- Thai operator checklist: `.tmp/remaining-work/epson-print-pack/index.html`.
- `verification.json` records the original FAIL and replacement runs; `sha256.json` records every packaged PDF. ZIP integrity and index links checked.
- Visual samples checked: long expense voucher first/last pages, final-installment zero-balance receipt, withholding certificate and all three 50x30 sticker pages. This is sample visual review plus automated artifact checks; physical EPSON, native print dialog and GCS/staging acceptance remain unverified.

No schema or automatic migration changes. The follow-up adds two manual one-row cleanup/restore SQL scripts; they are outside Prisma deployment migrations. Local document tests do not resolve the pending CPA receipt policy.

## Handoff verification

Final frozen `npm run local:check` passed all 22 checks at **2026-10-04T04:40:08.415Z** (11:40 Bangkok). The recorded source fingerprint equals the current checkout after `68cb3ecc1` and the documentation commit; subsequent edits are documentation only. Log: `local-check-final-frozen.log`. Preview remains running at http://localhost:5211/inbox with synthetic data/AI.

Earlier local-check attempts interrupted by necessary test edits correctly failed their fingerprint guard and do not certify handoff. API/money tests were run before the final test-selector-only changes; the affected document browser suites were rerun completely. No remaining local test failure is concealed by the combined document report.


## Authorized follow-up

- **SMS delivery passed:** one real OTP test message went through the actual `NotificationTransportService` using current production SMS settings, read through a read-only connection. Provider accepted at 2026-10-04T04:58:09.534Z; the owner confirmed receipt. Ref `114C`; recipient masked as `***6556`. No OTP, full phone or credentials are committed. This validates delivery only, not the complete contract/KYC flow. Private evidence: `.tmp/remaining-work/otp-delivery.json`.
- **Obsolete key cleaned:** `credit_precheck_ai_enabled=false` was conditionally soft-deleted once, native database deletion/update timestamp `2026-10-04 05:04:19.150`. Independent MCP readback confirmed this and `TEST_MODE_BYPASS=false`. Full row snapshot, dry-run output, commit result and readback are under private `.tmp/remaining-work/config-cleanup-production-verified/`; the [runbook](../runbooks/2026-10-04-credit-precheck-config-cleanup.md) provides conditional restore. No customer, financial, or other configuration row was changed.
- **Timestamp guard caught a display mismatch before writing:** PostgreSQL stores the audited update as timezone-free `2026-08-29 04:09:21.429`; the MCP's JavaScript driver displays it as `2026-08-28T21:09:21.429Z`. The first preflight stopped with zero writes. Native `updated_at::text` and `pg_typeof` were read before correcting the SQL literal. All 12 disposable PostgreSQL checks then passed (dry run, apply, repeated apply refusal, restore, drift and snapshot-write failure).
- **CI credit-search expectation corrected:** run `37177697618`, shard 4 had two failures (1440/390px), both expecting the old generic empty message while the query `ตัวอย่าง` remained present. The test now checks the specific no-match message and retained input. Entire local synthetic browser file passed **30/30**. Original CI failure is preserved; the next head requires fresh CI.
- **QR identity boundary fixed:** source tracing found that create-intent verified a token but forwarded the body LINE ID. Two HTTP regressions first reproduced acceptance of a mismatched/missing verified identity, then passed after requiring `request.liffUserId` and rejecting a mismatched body. Matching users continue through the existing contract-ownership-checked service. This is independent of payoff accounting; [QR design preparation](../superpowers/plans/2026-10-04-liff-early-payoff-qr.md) records the remaining schema, approval and received-money decisions.
- **Infrastructure/printer discovery:** GCP also lists `bestchoice-hermes`, with one `hermes-vm` and no buckets; Cloud Run and Cloud SQL Admin APIs are not enabled there. No application staging was found in the inspected BESTCHOICE projects. No billable environment was provisioned. This computer has no configured printer or default destination; physical EPSON acceptance still requires the shop's model/driver/operator.
- **Review:** independent follow-up review found no Critical/Important issues in conditional cleanup/restore or the E2E expectation correction. SQL verification used disposable PG16; it did not stand in for the separately recorded production readback.

- QR identity fix: all **10 suites / 142 tests passed** under the existing disposable SHOP/FINANCE PostgreSQL harness, including PaySolutions intent, callback, receipt, reschedule and LIFF guard coverage. Independent source review found no Critical/Important issue in the identity-binding change. No live QR/payment was created.

## A4 output and KYC evidence follow-up

- Owner chose A4 PDFs instead of a model-specific EPSON layout. Delivered artifacts are `output/pdf/BESTCHOICE-A4-print-samples.pdf` (69 documents / 232 pages) and `output/pdf/BESTCHOICE-A4-print-pack.zip`. Exact A4 portrait/landscape, source text preserved, safe layout margin 10 mm; minimum content scale 90.38%. Three 50×30 mm labels remain actual size on one A4 sheet. The generated PDFs are local handoff artifacts, not committed transaction data.
- Visual review found actual clipping in the dividend register: the third reference number was missing from the PDF because landscape `.font-mono` forces nowrap. The new regression failed on that missing number. The reference cell wraps, print-only widths allocate space to names/references and the empty action column is hidden. Complete real-browser dividend suite passed **5/5**, with **3/3 PDF artifacts** checked; the final one-page register was inspected at 120 dpi and replaced in the A4 pack. General samples/contact sheets were reviewed; no physical printer result is claimed.
- KYC previously marked an ID photo VERIFIED while only inventing its storage path. It now decodes supported JPEG/PNG/WebP data URLs, enforces canonical base64, 5 MB and 25-million-pixel limits, verifies complete pixel decoding, uploads original bytes through StorageService, then conditionally changes OTP_VERIFIED to VERIFIED. Unconfigured/failed storage does not verify; a concurrent OTP resend cannot revive EXPIRED. Sharp 0.35.5 is pinned with Linux-musl optional packages for the existing Alpine runtime.
- KYC tests: initial persistence regression **7 failed**, then **34 passed**; reviewer supplied two truncated-image cases (**2 failed**) and these now fail closed. Final **39/39 unit tests** include valid JPEG/PNG/WebP and compressed oversized-image rejection. Independent review found no remaining Critical/Important issue after the decoder fix. A failed DB status update can leave an unreferenced private object; it never reports verification success.
- Full AppModule acceptance: **5/5 passed** in `.tmp/docs-integration/kyc-credit-accepted-20261004`, using real bcrypt login, guards, services, disposable dual PostgreSQL and private local storage. Wrong/expired OTP fail, correct synthetic SMS code proceeds, exact image bytes persist, storage failure stays unverified, a resend race stays expired, non-owner bypass changes are denied, and credit approval is required and consumed by real contract creation (12 installments). Provider SMS is recorded, not delivered; the separately confirmed live SMS probe remains the only live delivery evidence. Fixture failures (missing synthetic address marker/branch till setup) and first race-test throttle interference remain in earlier logs; no production guard was weakened.
- A local check started before the final source freeze correctly failed its source-fingerprint gate when the added tests/layout changed during checks; rerun required. The final local check result is recorded in `.tmp/local-preview/check.json` and the PR.
- Release gate: main requires one code-owner approval and PR #1672 currently has none. Owner has authorized normal release, but no admin bypass, protection change, merge or deployment has been performed. Staging/GCS acceptance and live bot evaluation with funded model credit remain external blockers; no billable cloud resources or API credit were purchased. CPA/QR policy decisions remain pending.
