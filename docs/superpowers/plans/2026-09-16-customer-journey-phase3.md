# Customer Journey Phase 3 (Scope V2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the customer journey record itself first — customer files in chat, saving plans, online orders, a first-staff-reply row, a comeback row, ADS-only ad attribution and a credit-before-appointment stage order — and add a slim, optional manual layer on top: one-tap contact recording, lost / reopen on the stage strip, row-level undo, and a "รู้จักร้านจากไหน" ask that only walk-in customers ever see. Hide the unused `/crm` menu.

**Architecture:** No migration, no new table or column. The cached state (`apps/api/src/modules/customer-journey/sql/journey-state.sql`) learns the new automatic evidence and the new stage rank; `journey-summary.builder.ts` / `journey-summary.service.ts` compute every rule the web needs once (`not_needed`, `CHAT_FILE`, `askHeardFrom`, `creditFilePending`); one module (`chat-document-file.ts`) defines what counts as "the customer sent a document in chat" for every reader (Controller ruling R-P1); read-time sources (`chat.source.ts`, `sale.source.ts`) add timeline rows without writing anything; a new `JourneyManualEntryService` owns `POST` / `DELETE /customers/:id/journey/entries` and shares one event mapper (`sources/manual-entry-event.ts`) with the list endpoint. The web gets shared building blocks (`apps/web/src/hooks/customer-journey/*`, `apps/web/src/components/customer/journey/*`) that the stage strip, the journey tab, the ContractCreate customer step, `CustomerCreateDialog` and the POS quick-create all reuse. `packages/shared/src/customer-journey.ts` is the single source of every code list, label and response type.

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL (raw SQL files for journey state), jest (API, `--runInBand`); React 19 + Vite + Tailwind + shadcn/Radix + TanStack Query + sonner, vitest + Testing Library (web); `@installment/shared` (TypeScript, built with `tsc` before API jest).

**Spec:** `docs/superpowers/specs/2026-09-15-customer-journey-phase3-brief.md` (committed copy of the phase-3 design brief — its "§0 SCOPE V2" rulings 1–13 override everything else) + `docs/superpowers/specs/2026-09-15-customer-journey-design.md` + approved canvas https://claude.ai/code/artifact/8dd2fd87-8def-4f76-9e83-b981360f3abb (owner approved 2026-09-15, "เคาะตามที่เสนอทั้งหมด").

---

## Global Constraints

### Source-of-truth order
1. Brief §0 rulings 1–13 (owner, 2026-09-15). Where a canvas caption disagrees with a later ruling, the ruling wins — e.g. canvas Main (a) says the KPI "เครดิต" tile stays "ยังไม่เคยตรวจ" after a chat file, but ruling 13(3) (approved later) makes it "ส่งไฟล์แล้ว รอตรวจ"; Task 11 follows ruling 13(3), and the difference is written down in the spec line Task 4 adds for `creditFilePending` and in Task 11's PR notes so a reviewer comparing against the board sees it is intentional.
2. Approved canvas v2 boards (Main · MobileSheet · StageStrip · HeardFrom · TimelineRows) for copy, states and layout.
3. The design spec and the shipped code (HEAD of this branch).

### Decisions this plan takes where the sources left a gap (tasks cite them as D1–D15)

| # | Decision | Why |
|---|---|---|
| D1 | CREDIT "no check needed" is a new `JourneyStepState` value **`'not_needed'`**, set by the API builder only when `stage === 'PURCHASED' && creditAt === null && path ∈ {CASH, EXTERNAL_FINANCE}`. The web renders it with the skipped grey (the dot keeps its number) and caption `ไม่ต้องตรวจ (ซื้อสด)` / `ไฟแนนซ์นอกตรวจ`. The skipped caption collapses to plain `ข้าม` for every step. | Ruling 11 "NOT counted as skipped"; gated on purchased so a voided sale with a stale `path` never shows it; `DOT_CLASS: Record<state>` makes the web handle it at compile time. |
| D2 | New `JourneyStep.evidence` value **`'CHAT_FILE'`** (CREDIT only) = the cached `creditAt` equals the time of a CUSTOMER **document** `FILE` message of the family (condition `CUSTOMER_DOCUMENT_FILE_SQL` — R-P1; same exact-equality pattern as `interestedByManualEntry`). A passed/current CREDIT step keeps the caption; a rejected credit check shows only `เครดิตไม่ผ่าน`. Visible to every summary reader (type + time only, precedent FR-CREDIT-STAGE). | Ruling 13 notes; MobileSheet (c); StageStrip a4. |
| D3 | Chat-document credit evidence (R-P1: `.pdf` / `.doc(x)` / `.xls(x)` only) goes into `credit_at` only; **`path` uses `credit_doc_at = LEAST(credit_checks/contracts, room_credit_analyses)`** (no file). No new state column. | Ruling 13 "chat-file evidence must NOT set path=INSTALLMENT"; no migration ⇒ no MCP grants / DSAR change. |
| D4 | Summary gains **`askHeardFrom: boolean`** = `firstSource === 'WALK_IN' && heardFrom === null && purchaseCount < 2` and **`creditFilePending: boolean`** = `!purchased && hasCustomerChatFile && customer.creditCheckStatus === 'NONE'` (`hasCustomerChatFile` = any CUSTOMER document file of the family — R-P1). The web never re-derives either. | Rulings 3, 12, 13(3). |
| D5 | Lost is cleared by a later CUSTOMER chat message, a later TOUCHPOINT (both shipped), buying (shipped), REOPENED (shipped) and **six customer documents**: bookings, online_installment_applications, product_reservations, trade_ins, saving_plans, online_orders (non-deleted rows, any status). Todos/appointments, credit checks, room credit analyses, contracts and AI_LEAD_CAPTURED do **not** clear lost. | Rulings 5 + 12 list exactly these six. |
| D6 | "กลับมาติดต่ออีกครั้ง" row: the latest non-deleted MARKED_LOST/REOPENED of the family must be MARKED_LOST; the row sits at the first CUSTOMER message (visible rooms) strictly after it; **suppressed when any of the six clearing documents has a time in (mark, message]**. Touchpoints do not suppress. Latest episode only. | Ruling 6 + TimelineRows g4 + StageStrip c3. |
| D7 | First-staff-reply gap anchor: `state.contactedAt` when `firstChannel` starts with `CHAT_`; otherwise `MIN(chat_messages.created_at WHERE role='CUSTOMER')` over all family rooms. Omit the row when the anchor is missing or later than the reply. Formatter floors, minimum `1 นาที`, no-break space (U+00A0) between number and unit. Gate = `roleSeesGroup(role,'chat')` only (no href — the time is already in the summary). | Ruling 12; walk-in-first customers would otherwise show days. |
| D8 | Dedupe key `MANUAL:<kind>:<clientRequestId>`; the web makes **one UUID per tap** (never per chooser open — the lost prompt's second POST would dedupe onto the TOUCHPOINT). A dedupe hit on a soft-deleted row or on another customer family → 409 `คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง`. | Q6. |
| D9 | POST always returns **201**; REOPENED when the fresh summary is not lost returns `{ entryId: null, event: null, summary }` and the web shows `toast.info('เปิดอยู่แล้ว')` without an undo action. | Q4. |
| D10 | The DTO accepts only the 4 recordable channels (`PHONE/FB_APP/LINE_APP/WALK_IN`); `OTHER` stays in the label map for old rows. No `note`, `occurredAt`, `roomId` in the DTO (whitelist strips them); the service never writes `note`/`roomId`. `note` is **not** added to the audit `SENSITIVE_FIELDS` (R-P2 reverted 2026-09-16 — side effect on every module; accepted residual risk in Risk 8). | Ruling 4; RoomDossier deferred; R-P2 (reverted). |
| D11 | Heard-from "answer now" hosts (journey banner, ContractCreate card) share `HeardFromAsk`: tap = POST → collapse to `✓ ลูกค้าบอกว่ารู้จักร้านจาก{label} · เลิกทำ` while the toast lives; then the banner hides and the card keeps the line without the link. Banner "ข้าม" = ghost Button sm + sessionStorage per customer; card "ข้าม" = text button, hidden for this page visit. Dialog hosts (CustomerCreateDialog, POS) use deselectable chips + a chained POST after create + a warning toast after the success toast; their "ข้าม" clears the selection. | Brief §2.3 + HeardFrom (a)(b)(c1)(c2) + Main (e). |
| D12 | Toast "เลิกทำ" actions call the plain function `deleteJourneyEntry(queryClient, customerId, entryId)`, never a per-`mutate()` callback — Radix TabsContent unmounts panels and TanStack skips per-call callbacks after unmount. Every host builds its success toast with the one Task 10 helper `undoToastOptions(queryClient, customerId, entryId, onUndo?)` (duration `JOURNEY_UNDO_TOAST_MS` = 10 000 ms); no host keeps its own duration constant or options builder. | R5 lesson. |
| D13 | Hiding /crm removes **all four** menu entries in one commit **and** the CommandPalette page entry; route, page, data, title map and e2e stay. | MainLayout bounce rule. |
| D14 | `ChoiceChip` carries the Q17 mobile size (`max-lg:h-11 max-lg:px-4 max-lg:text-sm`) everywhere it is used. The busy chip is exempt from `disabled:opacity-40`. | Q17. |
| D15 | The plain `ข้าม` rule is unchanged: a step before the current one with no time = skipped (a prospect with ④ evidence and no ③ evidence shows ③ `ข้าม`). `stage_entered_at` mapping is unchanged, so strip dates may be non-monotonic. | Ruling 13(2), Main (c). |

### Project rules every task follows
- **PDPA:** journey code reads `chat_messages.role`, `type`, `created_at`, `deleted_at`, plus `media_url` **only inside WHERE / FILTER** through `CUSTOMER_DOCUMENT_FILE_SQL` / `CUSTOMER_DOCUMENT_FILE_FRAGMENT` (R-P1) — never selected, returned, logged or snapshotted; never `text`, `media_type`, file names or contents. Never select `customer_journey_entries.note`. Test data is synthetic. No PII in logs, runbooks or commit messages; production checks are count-only.
- **No migration, no new column, no MCP grant/policy change, no CI workflow edit.**
- **UI:** Thai user-facing text; semantic Tailwind tokens only (no hex / `gray-*` / `bg-white`); Thai text uses `leading-snug`; `@tanstack/react-query` for server state; `toast` from `sonner` (raw Toaster, top-right, richColors); `api` from `@/lib/api`; lucide-react icons; `@/` imports in the web app.
- **API:** controller → service → PrismaService; `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level and `@Roles(...)` on every handler; class-validator DTOs with Thai messages; soft delete only; `customer-journey.module.ts` imports no other module (import helpers by file path). Never `await audit.log(...)` inside a `$transaction`.
- **Edits are anchored by quoted text, never by line number** — every line number in the tasks is "at `10d6e6d3a`" (`origin/main`, the base — R-P4; `git diff --stat 85cefe0c7 10d6e6d3a` touches only `apps/api/e2e/bookings-lifecycle.e2e-spec.ts` and the phase-1 runbook, neither of which this plan edits), so a quoted number is right on a fresh checkout — but tasks 1–14 shift each other's lines, hence the text anchors.
- **Time:** CI runs in UTC, local machines in Asia/Bangkok. Use ISO `…Z` strings in tests; SQL never uses `now()`. Run web vitest with `TZ=UTC` **and** the machine TZ; run DB specs under both where the task says so.
- **Shared package:** `npm run build --workspace=@installment/shared` before any API jest run that needs new shared symbols (API reads `packages/shared/dist`). Shared vitest specs do not run in CI, so every shared constant/order change is also pinned in API jest or web vitest.
- **Commands:** API tests with `npx jest <files> --runInBand` from `apps/api`; DB specs with the local test database URL written in each task; type checks with `./tools/check-types.sh api|web|all`; lint only the touched files with `npx eslint <files>`. 🚨 Never run `npm run lint` in `apps/api` (it runs `--fix`). Never `npm version`.
- **Git:** one or more commits per task exactly as the task lists; stage explicit paths only (never `git add -A` — other sessions work in this checkout); every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`; no `git push` unless the owner asks.
- **Production:** every production command in the runbook is the owner's to run; implementers never touch prod.

### Execution order and gates
- Run strictly **T1 → T15**. Shared files cross many tasks: `journey-state.sql` (T2/T3/T9), `chat.source.ts` (T1/T5/T6), `chat-document-file.ts` (T3 creates; T4 and T5 consume the fragment; its spec pins `journey-state.sql`), `entries.source.ts` (T1/T7/T8), `customer-journey.pdpa.db.spec.ts` (T5/T8), `role-visibility.spec.ts` (T5/T6), `journey-shared-contract.spec.ts` (T1 creates; T5 and T6 extend its mocked `chatDb()`), `customer-journey.service.ts` + `.spec.ts` (T2/T3/T6/T7 — `JOURNEY_NOT_RECORDED`), `journey-manual-entry.service.ts` + specs (T7/T8), `journeyEntries.ts` (T10 creates; T11–T14 consume), `JourneyTab.tsx` (T10/T12/T13), `CustomerDetailPage.test.tsx` (T2/T11/T12/T13), the design spec (T2–T9, T12–T15) and the phase-3 runbook (T2/T3/T7/T9/T15).
- **Gate before T2 — satisfied (R-P4):** the staff_reply fix (`journey-state.sql` CTEs `rooms` / `auto_anchor` / `staff_reply` + `journey-state.service.db.spec.ts`) is merged and deployed (#1595) and is in the base `origin/main` `10d6e6d3a`. T2 Step 1 only confirms the checkout contains it and has no uncommitted edits to those two files; no rebase is expected.
- Dependencies: T4 needs T3 (document-file `credit_at` + `chat-document-file.ts`); T5 needs T3 (`CUSTOMER_DOCUMENT_FILE_FRAGMENT`); T6 needs T3 + T5; T7 needs T4 (response summary fields); T8 needs T7; T9 after T3 only to serialize SQL edits; T10 needs T1; T11–T14 need T10 and the T7/T8 contract; T15 last.
- **Every task ends green** on: shared build → API jest (touched suites, `--runInBand`) → `tsc --noEmit` api/web → web vitest (`TZ=UTC` and default TZ) → `npx eslint <touched files>`. When a task changes a module (for example `chat.source.ts`), rerun the **whole** `src/modules/customer-journey` folder, not only the task's own specs — mocked-Prisma specs written by earlier tasks must stay green.

### Risks to carry
1. **File signal breadth (narrowed by R-P1):** `facebook-webhook.controller.ts parseMessage` maps unknown attachment types (fallback/template/share) to `FILE`. The document-extension condition drops NULL `media_url` rows (≈ 48 rooms) and facebook.com share links (≈ 25 rooms) from every signal; a document link that happens to end in `.pdf` still counts. Changing the mapper is an out-of-scope follow-up for the owner.
2. **Stale caches after deploy:** cached `stage` changes meaning and new evidence is not in caches ⇒ run `backfill:customer-journey` the same day as the API deploy (runbook); rolling back the API image needs the same recompute.
3. **Files other sessions touched:** `journey-state.sql` and `journey-state.service.db.spec.ts` are no longer in flux (#1595 merged into the base); `apps/web/package.json` is `26.9.29` on `origin/main`, so T15 bumps to `26.9.30` and redoes the bump only if `origin/main` moves before merge.
4. **ACCOUNTANT sees** the `ส่งไฟล์ในแชท` caption and the KPI file-pending value (type + time only; FR-CREDIT-STAGE precedent) — call out in the PR.
5. **RECONTACTED for SALES** depends on visible rooms; a badge cleared by a hidden-room message may show the row later or not at all (same as other chat rows).
6. **Ruling 7 reverses `5f0dc62c4`:** product m.me links stop creating `ads_attributions` rows; product notes are unaffected.
7. **Walk-in trade-in rows show the customer as actor:** T6 gives every lost-clearing document a sale row (TimelineRows g4 "แถวเอกสารอธิบายแทน") selecting only `id` + time, so a trade-in keyed by staff at the counter is labelled "ลูกค้า"; web holds / online applications with `customer_id` null (most prod rows) produce no row — and also never clear a badge, so nothing goes unexplained.
8. **`note` can still reach `audit_logs` from a non-web client (accepted residual risk — R-P2 reverted 2026-09-16):** the journey entry DTO has no `note` field, the web never sends one and the service never writes one. `AuditInterceptor` copies the raw request body into `audit_logs` (rows cannot be deleted — DB trigger), and `note` stays out of `SENSITIVE_FIELDS`, so a client that posts `note` to `POST /customers/:id/journey/entries` anyway gets it stored there. Accepted by the controller; call it out in the PR.

## Controller rulings (2026-09-15, after plan review)

These rulings override anything above and in the tasks where they differ; the tasks below are already rewritten to follow them.

- **R-P1 — "customer sent a file in chat" means a document file only.**
  - Production evidence (aggregates only, 2026-09-15): CUSTOMER messages of type `FILE` split into `media_url` ending `.pdf` = 818 files / 416 rooms · `media_url` NULL = 107 / 48 rooms · facebook.com share links = 26 / 25 rooms · office document = 1. The Facebook webhook maps unknown attachment types (fallback / template shares) to `FILE` (`facebook-webhook.controller.ts` `parseMessage`: `attachmentTypeMap[attachment.type] ?? MessageType.FILE`).
  - Every reader of the file signal counts only `role = 'CUSTOMER' AND type = 'FILE' AND media_url` matching the case-insensitive regex `\.(pdf|docx?|xlsx?)(\?|$)`: T3 `journey-state.sql` `first_file_at` (→ `credit_at`), T4 `creditByChatFile` / `hasCustomerChatFile` (→ evidence `CHAT_FILE`, `creditFilePending`), T5 `chatDays` `files` / `lastFileAt` (→ `CHAT_CUSTOMER_FILE` rows), the spec text and the runbook pre-merge count (`### 1.6`, expected ≈ 416 rooms). Lost clearing and "กลับมาติดต่ออีกครั้ง" read **any** CUSTOMER message and do not change.
  - One definition per language. `apps/api/src/modules/customer-journey/chat-document-file.ts` (created by T3) exports `CHAT_DOCUMENT_FILE_PATTERN` (the regex source), `CUSTOMER_DOCUMENT_FILE_SQL` (the whole SQL condition, alias `m` = `chat_messages`) and `CUSTOMER_DOCUMENT_FILE_FRAGMENT` (`Prisma.raw` of that condition for `$queryRaw`). TypeScript readers use raw SQL with the fragment — there is no Prisma `where` copy, because a Prisma `where` cannot express the regex. `journey-state.sql` cannot import TypeScript, so it spells the condition byte for byte; `chat-document-file.spec.ts` pins that it does and that no other non-spec file of the module contains `'FILE'` or `pdf|docx`.
  - Tests seed a document URL on every FILE that must count and add non-document FILEs (NULL `media_url` and a facebook.com share link) that must **not** count: T3 real-DB state + a Postgres matrix of the fragment, T4 summary flags + a credit check at the exact time of a share link (evidence stays `SYSTEM`), T5 day rows.
  - PDPA: `media_url` is read **only inside WHERE / FILTER** through that condition — never selected into events, the summary, logs, audit rows or test snapshots (`FORBIDDEN_KEYS` keeps `mediaUrl`; test URLs are synthetic `files.example.test` / share-link placeholders).
  - Out-of-scope follow-up for the owner: stop mapping Facebook shares / unknown attachment types to `FILE` in `parseMessage`.
- **R-P2 (reverted 2026-09-16) — `note` is not added to the audit `SENSITIVE_FIELDS`.** The 2026-09-15 ruling (T7 adds `note` to `apps/api/src/modules/audit/audit-sanitize.util.ts`) is withdrawn: no task touches `apps/api/src/modules/audit/`, and D10 reads as originally written.
  - Why: verification at `10d6e6d3a` found that the exact key `note` would be redacted wherever `sanitizeAuditValue` runs — the `AuditInterceptor` body copy of every mutating request and every `AuditService.log` old/new value. That would permanently destroy the MDM unlock note (`mdm.controller.ts:156`, `MDM_UNLOCK` — the note exists only in audit) and redact the audit copies for repair tickets, the account-role map, employee profiles and others.
  - Accepted residual risk (Risk 8): the journey entry DTO has no `note` field and the web never sends one; a non-web client could still get a `note` into `audit_logs` through `AuditInterceptor`'s raw body copy.
- **R-P3 — accepted as written (record only, no plan change):** saving plans / online orders in **any** status count as ④ evidence and clear lost · cash / external-finance buyers who sent a document before buying show ③ `done` with `ส่งไฟล์ในแชท` (not `not_needed`) · a staff-keyed walk-in trade-in row shows the actor `ลูกค้า` · ACCOUNTANT sees the ③ caption and the KPI value (type + time only, FR-CREDIT-STAGE precedent) · T9 stops creating `ads_attributions` for product m.me links (called out in the PR notes).
- **R-P4 — base commit.** Every task's base is `origin/main` **`10d6e6d3a`** (merge of #1596). It contains the deployed staff_reply fix (#1595: `7f5eeb0cc`, merged as `9e7bface4`) and is byte-identical to the previously quoted `85cefe0c7` / `05f1f8f3d` / `1a238770e` for every file this plan edits, so every quoted line number reads "at `10d6e6d3a`". The old "rebase on the other agent's staff_reply fix before T2" gate is **satisfied**; T2 Step 1 only confirms the checkout. The web version bump in T15 is **`26.9.30`** (`origin/main` is `26.9.29`).

---

## File Structure

`CJ/` = `apps/api/src/modules/customer-journey/`. "Create" = new file; "Modify" = existing file.

### Shared (`packages/shared/src/`)
| File | Action | Tasks | Responsibility |
|---|---|---|---|
| `customer-journey.ts` | Modify | T1, T2 | Code lists + labels (touch channels/outcomes, lost reasons, heard-from codes, chat channel labels), `firstChatContactTitle`, `JourneyStepState 'not_needed'`, `JourneyStepEvidence 'CHAT_FILE'`, summary flags, undo fields on `JourneyEvent`, manual-entry request/response types; new stage order + `INTERESTED` label |
| `customer-journey.spec.ts` | Modify | T1, T2 | Local vitest pins of the above |

### API — customer journey (`CJ/`)
| File | Action | Tasks | Responsibility |
|---|---|---|---|
| `chat-document-file.ts` (+ `.spec.ts`) | Create | T3 (T4, T5 consume) | `CHAT_DOCUMENT_FILE_PATTERN`, `CUSTOMER_DOCUMENT_FILE_SQL`, `CUSTOMER_DOCUMENT_FILE_FRAGMENT` — the one document-file condition (R-P1); spec pins `journey-state.sql` and forbids copies |
| `sql/journey-state.sql` | Modify | T2, T3, T9 | Stage rank (credit before appointment) · document file → `credit_at` without path · saving plans / online orders as ④ evidence · six documents clear lost · ADS-only ad join |
| `sql/journey-activity-probe.sql`, `sql/journey-active-since.sql` | Modify | T3 | Probes see `saving_plans` / `online_orders` |
| `journey-summary.builder.ts` (+ `.spec.ts`) | Modify | T1, T2, T4 | `UNBUY_FALLBACK_STAGES`; `not_needed`, `CHAT_FILE`, `askHeardFrom`, `creditFilePending` |
| `journey-summary.service.ts` | Modify | T4 | Extras: document-file match + any document file (one raw query with the fragment), credit status, purchase count |
| `journey-summary.service.db.spec.ts` | Modify | T2, T4 | Expectations for the new order / `not_needed` |
| `journey-summary.phase3.db.spec.ts` | Create | T4 | Real-DB flags (incl. share-link / NULL files never set `CHAT_FILE` or `creditFilePending`) |
| `journey-state.service.db.spec.ts` | Modify | T2 | One todo + credit-check case (after the staff_reply fix) |
| `journey-state.stage-order.db.spec.ts` | Create | T2 | Real-DB stage order |
| `journey-state.signals.db.spec.ts` | Create | T3 | Real-DB automatic signals (document files count · NULL / share-link files do not) + Postgres matrix of `CUSTOMER_DOCUMENT_FILE_FRAGMENT` |
| `journey-state.ads.db.spec.ts` | Create | T9 | Real-DB ADS-only first source |
| `journey-shared-contract.spec.ts` | Create (T1), modify (T5, T6) | T1, T5, T6 | API jest pin of the shared contract + chat room title parity · T5/T6 add `customerJourneyState` / `customerJourneyEntry` to its mocked `chatDb()` |
| `customer-journey.service.ts` (+ `.spec.ts`) | Modify | T2, T3, T6, T7 | `JOURNEY_NOT_RECORDED` wording (T6 removes the web hold / online application / trade-in lines once they are rows) |
| `sources/chat.source.ts` | Modify | T1, T5, T6 | Shared chat labels · document-file day row (via `CUSTOMER_DOCUMENT_FILE_FRAGMENT`) · first staff reply row · comeback row |
| `sources/reply-gap.ts` (+ `.spec.ts`) | Create | T5 | `formatReplyGap` |
| `sources/chat.source.db.spec.ts` | Modify | T5 | Real-DB document-file + staff reply rows (non-document files make no file row) |
| `sources/chat.recontact.db.spec.ts` | Create | T6 | Real-DB comeback row |
| `sources/sale.source.ts` | Modify | T6 | Saving plan / online order / web hold / online application / trade-in rows (id + time only) |
| `sources/credit-sale.source.spec.ts` | Modify | T6 | Mocked sale rows |
| `sources/role-visibility.spec.ts` | Modify | T5, T6 | Role table for the new chat rows |
| `sources/entries.source.ts` (+ `.spec.ts`) | Modify | T1, T7, T8 | Shared labels → shared mapper → `createdAt` for undo fields |
| `sources/manual-entry-event.ts` (+ `.spec.ts`) | Create | T7, T8 | Single MANUAL row → `JourneyEvent` mapper + undo window helpers |
| `dto/create-journey-entry.dto.ts` (+ `.spec.ts`) | Create | T7 | POST body |
| `journey-manual-entry.service.ts` (+ `.spec.ts`, `.db.spec.ts`) | Create | T7, T8 | `create` / `remove` |
| `customer-journey.controller.ts` (+ `.spec.ts`, `.controller.summary.spec.ts`) | Modify | T7, T8 | POST / DELETE routes |
| `customer-journey.module.ts` (+ `.spec.ts`) | Modify | T7 | Register `JourneyManualEntryService` |
| `customer-journey.pdpa.db.spec.ts` | Modify | T5, T8 | Forbidden keys `mediaUrl`/`mediaType`; allowed undo keys |

### API — chat (ruling 7, T9)
| File | Action | Responsibility |
|---|---|---|
| `apps/api/src/modules/chat-engine/utils/ad-attribution.util.ts` (+ `.spec.ts`) | Create | `AD_REFERRAL_SOURCE`, `isAdAttribution` |
| `apps/api/src/modules/chat-engine/services/room-manager.service.ts` (+ `room-manager.attribution.spec.ts`) | Modify | `linkAttribution` ignores non-ADS |
| `apps/api/src/modules/chat-engine/services/message-router.service.ts` (+ `.spec.ts`) | Modify | `recordAdReferral` + inline ad note gate |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` (+ `.spec.ts`) | Modify | Comment / test titles only |

### Web — shared building blocks
| File | Action | Tasks | Responsibility |
|---|---|---|---|
| `apps/web/src/hooks/customer-journey/useCustomerJourney.ts` | Move (from `pages/CustomerDetailPage/hooks/`) | T10 | Journey queries + invalidation |
| `apps/web/src/hooks/customer-journey/journeyEntries.ts` (+ `.test.tsx`) | Create | T10 | `useRecordJourneyEntry`, `deleteJourneyEntry`, `JOURNEY_UNDO_TOAST_MS` + `undoToastOptions` (the one undo toast of T11–T13), `useDeleteJourneyEntry`, `postHeardFrom` |
| `apps/web/src/components/customer/journey/ChoiceChip.tsx` | Create | T10 | `ChoiceChip`, `ChoiceChipRow` (named exports) |
| `apps/web/src/components/customer/journey/ResponsiveChooser.tsx` | Create | T10 | Popover (desktop) / bottom Sheet (mobile) — named export |
| `apps/web/src/components/customer/journey/HeardFromChips.tsx` | Create | T10 | 9 heard-from chips — named export `HeardFromChips` |
| `apps/web/src/components/customer/journey/journeyStorage.ts` | Create | T10 | Last channel (localStorage) + heard-from skip (sessionStorage) |
| `apps/web/src/components/customer/journey/HeardFromAsk.tsx` | Create | T13 | Tap-to-save ask (banner / card) — default export |
| `apps/web/src/components/customer/journey/__tests__/*` | Create | T10, T13 | Component tests |
| `apps/web/src/lib/constants.ts` (+ `lib/__tests__/journey-record-roles.test.ts`) | Modify / Create | T10 | `JOURNEY_RECORD_ROLES`, `canRecordJourney` |

### Web — pages
| File | Action | Tasks | Responsibility |
|---|---|---|---|
| `pages/CustomerDetailPage/index.tsx` | Modify | T10, T11, T12 | Hook import path · `canRecord` · strip / tab / KPI props |
| `pages/CustomerDetailPage/components/JourneyStageStrip.tsx` | Modify | T1, T11 | Captions, `not_needed`, right cluster |
| `pages/CustomerDetailPage/components/JourneyLostControls.tsx` | Create | T11 | ติดป้ายหลุด / เปิดใหม่ |
| `pages/CustomerDetailPage/components/RecordContactChooser.tsx` | Create | T12 | บันทึกการติดต่อ chooser + lost prompt |
| `pages/CustomerDetailPage/tabs/JourneyTab.tsx` | Modify | T10, T12, T13 | Record button row · row undo · heard-from banner |
| `pages/CustomerDetailPage/utils/kpiTiles.ts` (+ `__tests__/kpiTiles.test.ts`) | Modify | T11 | "ส่งไฟล์แล้ว รอตรวจ" |
| `pages/CustomerDetailPage/{tabs/CreditTab,components/EditCustomerDialog,components/RecentActivityCard,components/DetailHeader}.tsx` | Modify | T10 | Hook import path only |
| `pages/CustomerDetailPage/__tests__/{CustomerDetailPage.test.tsx,JourneyStageStrip.test.tsx,journeyFixtures.ts}` | Modify | T1, T2, T4, T11, T12, T13 | Harness, fixtures, page tests |
| `pages/ContractCreatePage/index.tsx`, `components/CustomerSelectStep.tsx` | Modify | T13 | Heard-from card slot + first-contact line |
| `pages/ContractCreatePage/components/__tests__/CustomerSelectStep.firstContact.test.tsx` | Create | T13 | Step + page wiring tests |
| `components/customer/CustomerCreateDialog.tsx` (+ `.test.tsx`) | Modify | T14 | Chips (create mode, not linked to chat) + chained POST |
| `pages/UnifiedInboxPage/components/RoomDossier.tsx` (+ `.test.tsx`) | Modify | T14 | Pass `linkedToChat` only (no chip bar) |
| `pages/CustomersPage/index.tsx` (+ `__tests__/CustomersPage.test.tsx`) | Modify | T14 | Pass `linkedToChat` for `?fromRoomId` |
| `pages/POSPage/components/CustomerSearch.tsx` | Modify | T14 | Quick-create chips + chained POST |
| `pages/POSPage/components/CustomerSearch.test.tsx` | Create | T14 | First tests of this component |
| `config/menu.ts` (+ `menu.test.ts`), `components/CommandPalette.tsx` (+ `.test.tsx`) | Modify | T15 | Hide /crm |
| `apps/web/package.json`, `package-lock.json` | Modify | T15 | Web version bump |

### Docs
| File | Action | Tasks |
|---|---|---|
| `docs/superpowers/specs/2026-09-15-customer-journey-design.md` | Modify | T2–T9, T12–T15 |
| `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` | Create (T2), edit (T3 `### 1.6` + row 1 · T9 `### 1.5` + rows 1–2 + `### 2.1` + rollback note · T7 appends the metric · T15 row 6 + web section) | Deploy, pre-merge counts (1.5 ad source · 1.6 chat document files, R-P1 condition), backfill, rollback, ad-source cleanup, web checks, the single 2-week metric (`<LAUNCH_UTC>`) |

---

## Out of scope (do not build)

- (จ) RoomDossier chip bar / `roomId` on entries · (ก) same-person hint at POS / ContractCreate + dismiss endpoints.
- AI reading chat to infer outcomes (next phase, planned separately) · PBX / Yeastar call capture.
- Note field and change-time field on any entry (including MARKED_LOST) · the `OTHER` channel chip.
- Auto-mark lost after silence · Meta Business Suite labels.
- Funnel endpoint / `journeyStage` filter on /customers (phase 2) · `markConversion` / ads data (phase 4).
- Changing the Facebook webhook attachment mapper (`?? MessageType.FILE` fallback) — follow-up after R-P1, owner decision.
- Heard-from chips in `/contacts` CreateContactModal or ContractCreate's `CustomerCreateModal` (the step card covers the latter).
- Any Prisma migration, new table/column, MCP grants/policy change, DSAR select change, CI workflow edit.
- The staff_reply CTE fix and the `message_echoes` subscribe default (already done separately — ruling 10).
- Backfilling heard-from for past customers; any automatic write of `heard_from`.

---

## Tasks

### Task 1: Shared contract (additive) + label maps moved to shared

**Files:**
- Modify: `packages/shared/src/customer-journey.ts`
  - `:7-9` — add `import { chatSourceChannel } from './customer-sort';` after the header comment
  - `:72-92` — `JOURNEY_LOST_REASON_LABELS` / `JOURNEY_HEARD_FROM_LABELS` block: add ordered code arrays in front of each map, then append touch channels, recordable channels, outcomes, lost-prompt map, chat-channel labels and `firstChatContactTitle` after it
  - `:125-127` — `JourneyEvent`: add `entryId?` / `undoableUntil?` / `canDelete?`
  - `:129-141` — `JourneyStepState` gains `'not_needed'`; new `JourneyStepEvidence`; `JourneyStep.evidence: JourneyStepEvidence`
  - `:163-166` — `JourneySummary` gains `askHeardFrom` / `creditFilePending`
  - after `:186` (end of file) — append `JourneyManualEntryInput`, `JourneyEntryCreatedResponse`, `JourneyEntryDeletedResponse`
- Modify: `packages/shared/src/customer-journey.spec.ts` — `:3-17` import list; insert 4 tests after `:82`; `:91-101` index-export test gains the new runtime exports
- Modify: `apps/api/src/modules/customer-journey/sources/entries.source.ts` — `:1-9` import list; `:29-31` delete local `TOUCH_CHANNELS` / `OUTCOMES` (replace with a `labelOf` helper); `:89` TOUCHPOINT title reads the shared maps
- Modify: `apps/api/src/modules/customer-journey/sources/entries.source.spec.ts` — insert 1 title-parity test after `:85` (before the closing `});` of the `describe`)
- Modify: `apps/api/src/modules/customer-journey/sources/chat.source.ts` — `:2` import list; `:8-9` delete exported local `CHAT_CHANNEL_LABELS` (no other importer — grep verified); `:54` room title uses `firstChatContactTitle` / `JOURNEY_CHAT_CHANNEL_LABELS`
- Modify: `apps/api/src/modules/customer-journey/journey-summary.builder.ts` — `:142` add the two shim flags to the returned object
- Modify: `apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts` — insert 1 test after `:72` (end of `describe('buildJourneySummary')`)
- Create: `apps/api/src/modules/customer-journey/journey-shared-contract.spec.ts` (API jest pin of the shared constants — shared specs never run in CI — plus chat room title parity with a mocked Prisma)
- Modify: `apps/web/src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx` — `:8-13` `DOT_CLASS` gains `not_needed`
- Modify: `apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts` — `:20` `at` is null for `not_needed`; `:51` summary defaults gain both flags
- Test: `packages/shared/src/customer-journey.spec.ts` (vitest, local only) · `apps/api/src/modules/customer-journey/journey-shared-contract.spec.ts` · `apps/api/src/modules/customer-journey/sources/entries.source.spec.ts` · `apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts` (jest, CI) · `apps/web` `tsc --noEmit` + vitest `src/pages/CustomerDetailPage`

**Interfaces:**
- Consumes (shipped, base `origin/main` `10d6e6d3a` — line numbers below are at that commit):
  - `packages/shared/src/customer-journey.ts`: `JOURNEY_LOST_REASON_LABELS: Readonly<Record<string, string>>` (:73-79), `JOURNEY_HEARD_FROM_LABELS: Readonly<Record<string, string>>` (:82-92), `JOURNEY_ENTRY_KINDS.MANUAL = ['TOUCHPOINT','HEARD_FROM','MARKED_LOST','REOPENED']` (:41), `interface JourneyEvent` (:110-127), `interface JourneyStep` (:133-141), `interface JourneySummary` (:144-166)
  - `packages/shared/src/customer-sort.ts`: `chatSourceOf(channel: string): string` (:115-117), `chatSourceChannel(source: string | null | undefined): string | null` (:120-124) — both already exported through `index.ts`
  - Local maps being removed: `TOUCH_CHANNELS` / `OUTCOMES` in `entries.source.ts:29-30`, `export const CHAT_CHANNEL_LABELS` in `chat.source.ts:8`
  - `buildJourneySummary(state: JourneyStateRow, extras: JourneySummaryExtras, now: Date): JourneySummary` (`journey-summary.builder.ts:105`)
- Produces (in `@installment/shared`, exported via the existing `export * from './customer-journey'`):
  - `export const JOURNEY_TOUCH_CHANNELS = ['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN', 'OTHER'] as const;`
  - `export type JourneyTouchChannel = (typeof JOURNEY_TOUCH_CHANNELS)[number];`
  - `export const JOURNEY_TOUCH_CHANNEL_LABELS: Record<JourneyTouchChannel, string>` = `{ PHONE: 'โทร', FB_APP: 'แชทในแอป FB', LINE_APP: 'LINE', WALK_IN: 'หน้าร้าน', OTHER: 'อื่น ๆ' }`
  - `export const JOURNEY_RECORDABLE_TOUCH_CHANNELS = ['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN'] as const` (checked `satisfies readonly JourneyTouchChannel[]`)
  - `export type JourneyRecordableTouchChannel = (typeof JOURNEY_RECORDABLE_TOUCH_CHANNELS)[number];`
  - `export const JOURNEY_TOUCH_OUTCOMES = ['APPOINTED', 'VISITED', 'THINKING', 'BUDGET', 'NO_ANSWER', 'BOUGHT_ELSEWHERE', 'NOT_INTERESTED'] as const;`
  - `export type JourneyTouchOutcome = (typeof JOURNEY_TOUCH_OUTCOMES)[number];`
  - `export const JOURNEY_TOUCH_OUTCOME_LABELS: Record<JourneyTouchOutcome, string>` = `{ APPOINTED: 'นัดแล้ว', VISITED: 'มาร้านแล้ว', THINKING: 'ขอคิดก่อน', BUDGET: 'งบ/ดาวน์ไม่พอ', NO_ANSWER: 'ไม่รับสาย', BOUGHT_ELSEWHERE: 'ซื้อที่อื่น', NOT_INTERESTED: 'ไม่สนใจ' }`
  - `export const JOURNEY_LOST_REASONS = ['NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'CREDIT_FAILED', 'UNREACHABLE', 'OTHER'] as const;` + `export type JourneyLostReason = (typeof JOURNEY_LOST_REASONS)[number];`
  - `export const JOURNEY_LOST_PROMPT_OUTCOMES: Readonly<Partial<Record<JourneyTouchOutcome, JourneyLostReason>>> = { BOUGHT_ELSEWHERE: 'BOUGHT_ELSEWHERE', NOT_INTERESTED: 'NOT_INTERESTED' };`
  - `export const JOURNEY_HEARD_FROM_CODES = ['FB_AD', 'FB_PAGE', 'TIKTOK', 'LINE', 'GOOGLE', 'FRIEND', 'WALK_BY', 'OLD_CUSTOMER', 'OTHER'] as const;` + `export type JourneyHeardFrom = (typeof JOURNEY_HEARD_FROM_CODES)[number];`
  - `export const JOURNEY_CHAT_CHANNEL_LABELS: Readonly<Record<string, string>> = { FACEBOOK: 'Facebook', LINE_SHOP: 'LINE ร้าน', LINE_FINANCE: 'LINE การเงิน', TIKTOK: 'TikTok', WEB: 'เว็บ' };`
  - `export function firstChatContactTitle(firstChannel: string): string | null` — `'CHAT_FACEBOOK'` → `'ทักแชทครั้งแรกทาง Facebook'`; unknown suffix → raw suffix (`'CHAT_INSTAGRAM'` → `'ทักแชทครั้งแรกทาง INSTAGRAM'`); not `CHAT_` or empty suffix (`'WALK_IN'`, `'REFERRAL'`, `'UNKNOWN'`, `'CHAT_'`, `''`) → `null`
  - `export type JourneyStepState = 'done' | 'current' | 'skipped' | 'todo' | 'not_needed';`
  - `export type JourneyStepEvidence = 'SYSTEM' | 'MANUAL' | 'CHAT_FILE';` and `JourneyStep.evidence: JourneyStepEvidence`
  - `JourneySummary.askHeardFrom: boolean` · `JourneySummary.creditFilePending: boolean`
  - `JourneyEvent.entryId?: string` · `JourneyEvent.undoableUntil?: string | null` · `JourneyEvent.canDelete?: boolean`
  - `export type JourneyManualEntryInput = { kind: 'TOUCHPOINT'; channel: JourneyRecordableTouchChannel; outcome: JourneyTouchOutcome; clientRequestId?: string } | { kind: 'HEARD_FROM'; heardFrom: JourneyHeardFrom; clientRequestId?: string } | { kind: 'MARKED_LOST'; lostReason: JourneyLostReason; clientRequestId?: string } | { kind: 'REOPENED'; clientRequestId?: string };`
  - `export interface JourneyEntryCreatedResponse { entryId: string | null; event: JourneyEvent | null; summary: JourneySummary }`
  - `export interface JourneyEntryDeletedResponse { summary: JourneySummary }`
- Produces (shims, replaced later): `buildJourneySummary` returns `askHeardFrom: false, creditFilePending: false` (T4 computes them) · web `DOT_CLASS.not_needed = 'bg-muted text-muted-foreground'` (T11 adds captions) · `journeySummary()` fixture defaults both flags to `false`.
- Unchanged on purpose: `JOURNEY_STAGES` order, `STAGE_LABELS` (T2) · the types of `JOURNEY_LOST_REASON_LABELS` / `JOURNEY_HEARD_FROM_LABELS` stay `Readonly<Record<string, string>>` (readers look up raw VARCHAR values) · every timeline title stays byte-identical.

---

- [ ] **Step 1: Pin today's manual-entry titles (characterization test, green before the move)**

In `apps/api/src/modules/customer-journey/sources/entries.source.spec.ts`, insert this test after line 85 (the end of the `'entriesSourceFor: DB กรอง kind …'` test), before the final `});` that closes `describe('entriesSource')`:

```ts
  it('ถ้อยคำบันทึกมือเท่าเดิมทุกไบต์: ช่องทาง 5 × ผล 7 · รหัสไม่รู้จัก · รู้จักร้านจาก 9 · เหตุผลหลุด 5 · เปิดใหม่', async () => {
    // ค่าคาดหวังคัดลอกจากแผนที่เดิมใน entries.source.ts (ก่อนย้ายไป shared) — ห้ามอ่านจาก shared ไม่งั้นเทสนี้ไม่ตรึงอะไร
    const CHANNEL_TEXT: Record<string, string> = { PHONE: 'โทร', FB_APP: 'แชทในแอป FB', LINE_APP: 'LINE', WALK_IN: 'หน้าร้าน', OTHER: 'อื่น ๆ' };
    const OUTCOME_TEXT: Record<string, string> = { APPOINTED: 'นัดแล้ว', VISITED: 'มาร้านแล้ว', THINKING: 'ขอคิดก่อน', BUDGET: 'งบ/ดาวน์ไม่พอ', NO_ANSWER: 'ไม่รับสาย', BOUGHT_ELSEWHERE: 'ซื้อที่อื่น', NOT_INTERESTED: 'ไม่สนใจ' };
    const HEARD_TEXT: Record<string, string> = { FB_AD: 'โฆษณา FB', FB_PAGE: 'เพจ/โพสต์', TIKTOK: 'TikTok', LINE: 'LINE', GOOGLE: 'Google', FRIEND: 'เพื่อนแนะนำ', WALK_BY: 'ผ่านหน้าร้าน', OLD_CUSTOMER: 'ลูกค้าเก่า', OTHER: 'อื่น ๆ' };
    const LOST_TEXT: Record<string, string> = { NOT_INTERESTED: 'ไม่สนใจ', BOUGHT_ELSEWHERE: 'ซื้อที่อื่น', CREDIT_FAILED: 'เครดิตไม่ผ่าน', UNREACHABLE: 'ติดต่อไม่ได้', OTHER: 'อื่น ๆ' };
    const rows: Record<string, unknown>[] = [];
    const expected: Record<string, [string, string | null]> = {};
    let minute = 0;
    const push = (id: string, fields: Record<string, unknown>, title: string, stage: string | null) => {
      rows.push(entry({ id, origin: 'MANUAL', occurredAt: new Date(Date.UTC(2026, 8, 1, 3, minute++)), ...fields }));
      expected[`entry-${id}`] = [title, stage];
    };
    for (const channel of Object.keys(CHANNEL_TEXT)) {
      for (const outcome of Object.keys(OUTCOME_TEXT)) {
        const stage = outcome === 'APPOINTED' || outcome === 'VISITED' ? 'INTERESTED' : null;
        push(`touch-${channel}-${outcome}`, { kind: 'TOUCHPOINT', channel, outcome }, `ติดต่อทาง${CHANNEL_TEXT[channel]}: ${OUTCOME_TEXT[outcome]}`, stage);
      }
    }
    push('touch-unknown', { kind: 'TOUCHPOINT', channel: 'SMS', outcome: null }, 'ติดต่อทางอื่น ๆ: บันทึกแล้ว', null);
    for (const code of Object.keys(HEARD_TEXT)) push(`heard-${code}`, { kind: 'HEARD_FROM', heardFrom: code }, `ลูกค้าบอกว่ารู้จักร้านจาก${HEARD_TEXT[code]}`, null);
    push('heard-unknown', { kind: 'HEARD_FROM', heardFrom: 'RADIO' }, 'ลูกค้าบอกว่ารู้จักร้านจากอื่น ๆ', null);
    for (const code of Object.keys(LOST_TEXT)) push(`lost-${code}`, { kind: 'MARKED_LOST', lostReason: code }, `ติดป้ายหลุด: ${LOST_TEXT[code]}`, null);
    push('lost-unknown', { kind: 'MARKED_LOST', lostReason: null }, 'ติดป้ายหลุด: อื่น ๆ', null);
    push('reopen', { kind: 'REOPENED' }, 'เปิดใหม่', null);

    const prisma = db();
    prisma.customerJourneyEntry.findMany.mockResolvedValue(rows);
    const events = await entriesSourceFor(new Set<JourneyEventGroup>(['chat']))(prisma as unknown as PrismaService, ['c1'], { limit: 100 }, { id: 'o1', role: 'OWNER' });

    expect(events).toHaveLength(53); // 35 + 1 + 9 + 1 + 5 + 1 + 1
    expect(Object.fromEntries(events.map((e) => [e.id, [e.title, e.stage]]))).toEqual(expected);
    expect(events.every((e) => e.group === 'chat' && e.origin === 'MANUAL')).toBe(true);
  });
```

- [ ] **Step 2: Run the characterization test against the unchanged code**

Run (repo root): `npm run build --workspace=@installment/shared`
Run (from `apps/api`): `npx jest src/modules/customer-journey/sources/entries.source.spec.ts --runInBand`
Expected: PASS — `Tests: 4 passed, 4 total` (3 existing + the new one). If it fails, stop: the expected strings above were copied wrong, fix the test, not the source.

- [ ] **Step 3: Write the failing shared spec**

In `packages/shared/src/customer-journey.spec.ts`, replace the import block at lines 3-17:

```ts
import {
  JOURNEY_ACTOR_TYPES,
  JOURNEY_DEFAULT_GROUPS,
  JOURNEY_ENTRY_KINDS,
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_HIDDEN_GROUPS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_STAGES,
  STAGE_LABELS,
  journeyEntryOriginOf,
  type JourneyEntryKind,
  type JourneyListResponse,
  type JourneyRedirect,
} from './customer-journey';
```

with:

```ts
import {
  JOURNEY_ACTOR_TYPES,
  JOURNEY_CHAT_CHANNEL_LABELS,
  JOURNEY_DEFAULT_GROUPS,
  JOURNEY_ENTRY_KINDS,
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HEARD_FROM_CODES,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_HIDDEN_GROUPS,
  JOURNEY_LOST_PROMPT_OUTCOMES,
  JOURNEY_LOST_REASONS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_RECORDABLE_TOUCH_CHANNELS,
  JOURNEY_STAGES,
  JOURNEY_TOUCH_CHANNELS,
  JOURNEY_TOUCH_CHANNEL_LABELS,
  JOURNEY_TOUCH_OUTCOMES,
  JOURNEY_TOUCH_OUTCOME_LABELS,
  STAGE_LABELS,
  firstChatContactTitle,
  journeyEntryOriginOf,
  type JourneyEntryCreatedResponse,
  type JourneyEntryKind,
  type JourneyListResponse,
  type JourneyManualEntryInput,
  type JourneyRedirect,
  type JourneyStepEvidence,
  type JourneyStepState,
  type JourneySummary,
} from './customer-journey';
```

Insert these 4 tests right after the closing `});` of the test `'ป้ายเหตุผลหลุดและที่มาที่ลูกค้าบอก ครบตามรหัสในคอมเมนต์ schema · รหัสยาวไม่เกินคอลัมน์'` (original line 82 — anchor on the text, the import replacement above shifted it by +15):

```ts
  it('ช่องทาง/ผลของบันทึกการติดต่อ: ลำดับชิป · ป้ายครบทุกรหัส · ช่องทางที่บันทึกได้ไม่มี อื่น ๆ · รหัสยาวไม่เกินคอลัมน์', () => {
    expect(JOURNEY_TOUCH_CHANNELS).toEqual(['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN', 'OTHER']);
    expect(Object.keys(JOURNEY_TOUCH_CHANNEL_LABELS)).toEqual([...JOURNEY_TOUCH_CHANNELS]);
    expect(JOURNEY_TOUCH_CHANNEL_LABELS).toEqual({ PHONE: 'โทร', FB_APP: 'แชทในแอป FB', LINE_APP: 'LINE', WALK_IN: 'หน้าร้าน', OTHER: 'อื่น ๆ' });
    expect(JOURNEY_RECORDABLE_TOUCH_CHANNELS).toEqual(['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN']);
    expect(JOURNEY_TOUCH_OUTCOMES).toEqual(['APPOINTED', 'VISITED', 'THINKING', 'BUDGET', 'NO_ANSWER', 'BOUGHT_ELSEWHERE', 'NOT_INTERESTED']);
    expect(Object.keys(JOURNEY_TOUCH_OUTCOME_LABELS)).toEqual([...JOURNEY_TOUCH_OUTCOMES]);
    expect(JOURNEY_TOUCH_OUTCOME_LABELS).toEqual({
      APPOINTED: 'นัดแล้ว',
      VISITED: 'มาร้านแล้ว',
      THINKING: 'ขอคิดก่อน',
      BUDGET: 'งบ/ดาวน์ไม่พอ',
      NO_ANSWER: 'ไม่รับสาย',
      BOUGHT_ELSEWHERE: 'ซื้อที่อื่น',
      NOT_INTERESTED: 'ไม่สนใจ',
    });
    for (const code of JOURNEY_TOUCH_CHANNELS) expect(code.length).toBeLessThanOrEqual(16); // channel VARCHAR(16)
    for (const code of JOURNEY_TOUCH_OUTCOMES) expect(code.length).toBeLessThanOrEqual(20); // outcome VARCHAR(20)
  });

  it('รหัสเหตุผลหลุด/รู้จักร้านจาก เรียงเท่าคีย์ของป้ายเดิม · ผลที่ถาม "ติดป้ายหลุดไหม" จับคู่เหตุผล 1:1', () => {
    expect(JOURNEY_LOST_REASONS).toEqual(['NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'CREDIT_FAILED', 'UNREACHABLE', 'OTHER']);
    expect([...JOURNEY_LOST_REASONS]).toEqual(Object.keys(JOURNEY_LOST_REASON_LABELS));
    expect(JOURNEY_HEARD_FROM_CODES).toEqual(['FB_AD', 'FB_PAGE', 'TIKTOK', 'LINE', 'GOOGLE', 'FRIEND', 'WALK_BY', 'OLD_CUSTOMER', 'OTHER']);
    expect([...JOURNEY_HEARD_FROM_CODES]).toEqual(Object.keys(JOURNEY_HEARD_FROM_LABELS));
    expect(JOURNEY_LOST_PROMPT_OUTCOMES).toEqual({ BOUGHT_ELSEWHERE: 'BOUGHT_ELSEWHERE', NOT_INTERESTED: 'NOT_INTERESTED' });
  });

  it('ป้ายช่องทางห้องแชท + ถ้อยคำ "ทักแชทครั้งแรกทาง" ชุดเดียว (คำตัดสิน 12)', () => {
    expect(JOURNEY_CHAT_CHANNEL_LABELS).toEqual({ FACEBOOK: 'Facebook', LINE_SHOP: 'LINE ร้าน', LINE_FINANCE: 'LINE การเงิน', TIKTOK: 'TikTok', WEB: 'เว็บ' });
    expect(firstChatContactTitle('CHAT_FACEBOOK')).toBe('ทักแชทครั้งแรกทาง Facebook');
    expect(firstChatContactTitle('CHAT_LINE_SHOP')).toBe('ทักแชทครั้งแรกทาง LINE ร้าน');
    expect(firstChatContactTitle('CHAT_LINE_FINANCE')).toBe('ทักแชทครั้งแรกทาง LINE การเงิน');
    expect(firstChatContactTitle('CHAT_TIKTOK')).toBe('ทักแชทครั้งแรกทาง TikTok');
    expect(firstChatContactTitle('CHAT_WEB')).toBe('ทักแชทครั้งแรกทาง เว็บ');
    expect(firstChatContactTitle('CHAT_INSTAGRAM')).toBe('ทักแชทครั้งแรกทาง INSTAGRAM');
    for (const notChat of ['WALK_IN', 'REFERRAL', 'UNKNOWN', 'AI_CHAT', 'CHAT_', '']) expect(firstChatContactTitle(notChat)).toBeNull();
  });

  it('รูป body/คำตอบของบันทึกมือ: 4 ชนิดตาม JOURNEY_ENTRY_KINDS.MANUAL · สถานะขั้น not_needed · หลักฐาน CHAT_FILE', () => {
    const inputs: JourneyManualEntryInput[] = [
      { kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED', clientRequestId: '3f0c2b7e-9a41-4c55-8d2e-6b1f0a9c7d21' },
      { kind: 'HEARD_FROM', heardFrom: 'FRIEND' },
      { kind: 'MARKED_LOST', lostReason: 'UNREACHABLE' },
      { kind: 'REOPENED' },
    ];
    expect(inputs.map((input) => input.kind)).toEqual([...JOURNEY_ENTRY_KINDS.MANUAL]);
    const states: JourneyStepState[] = ['done', 'current', 'skipped', 'todo', 'not_needed'];
    const evidence: JourneyStepEvidence[] = ['SYSTEM', 'MANUAL', 'CHAT_FILE'];
    expect([states.length, evidence.length]).toEqual([5, 3]);
    const flags: Pick<JourneySummary, 'askHeardFrom' | 'creditFilePending'> = { askHeardFrom: false, creditFilePending: false };
    const noop: JourneyEntryCreatedResponse = { entryId: null, event: null, summary: flags as JourneySummary };
    expect(Object.keys(noop)).toEqual(['entryId', 'event', 'summary']);
  });
```

Replace the index-export test (original lines 91-101 — anchor on the text):

```ts
  it('ส่งออกผ่าน index ของแพ็กเกจ (@installment/shared)', () => {
    expect(shared.JOURNEY_STAGES).toBe(JOURNEY_STAGES);
    expect(shared.STAGE_LABELS).toBe(STAGE_LABELS);
    expect(shared.JOURNEY_ENTRY_KINDS).toBe(JOURNEY_ENTRY_KINDS);
    expect(shared.JOURNEY_EVENT_GROUPS).toBe(JOURNEY_EVENT_GROUPS);
    expect(shared.journeyEntryOriginOf).toBe(journeyEntryOriginOf);
    expect(shared.JOURNEY_DEFAULT_GROUPS).toBe(JOURNEY_DEFAULT_GROUPS);
    expect(shared.JOURNEY_HIDDEN_GROUPS).toBe(JOURNEY_HIDDEN_GROUPS);
    expect(shared.JOURNEY_LOST_REASON_LABELS).toBe(JOURNEY_LOST_REASON_LABELS);
    expect(shared.JOURNEY_HEARD_FROM_LABELS).toBe(JOURNEY_HEARD_FROM_LABELS);
  });
```

with:

```ts
  it('ส่งออกผ่าน index ของแพ็กเกจ (@installment/shared)', () => {
    expect(shared.JOURNEY_STAGES).toBe(JOURNEY_STAGES);
    expect(shared.STAGE_LABELS).toBe(STAGE_LABELS);
    expect(shared.JOURNEY_ENTRY_KINDS).toBe(JOURNEY_ENTRY_KINDS);
    expect(shared.JOURNEY_EVENT_GROUPS).toBe(JOURNEY_EVENT_GROUPS);
    expect(shared.journeyEntryOriginOf).toBe(journeyEntryOriginOf);
    expect(shared.JOURNEY_DEFAULT_GROUPS).toBe(JOURNEY_DEFAULT_GROUPS);
    expect(shared.JOURNEY_HIDDEN_GROUPS).toBe(JOURNEY_HIDDEN_GROUPS);
    expect(shared.JOURNEY_LOST_REASON_LABELS).toBe(JOURNEY_LOST_REASON_LABELS);
    expect(shared.JOURNEY_HEARD_FROM_LABELS).toBe(JOURNEY_HEARD_FROM_LABELS);
    // เฟส 3 — ค่าที่ undefined ทั้งสองข้างผ่าน toBe ได้ ⇒ ตรวจว่ามีค่าจริงด้วย
    const phase3 = {
      JOURNEY_TOUCH_CHANNELS, JOURNEY_TOUCH_CHANNEL_LABELS, JOURNEY_RECORDABLE_TOUCH_CHANNELS, JOURNEY_TOUCH_OUTCOMES,
      JOURNEY_TOUCH_OUTCOME_LABELS, JOURNEY_LOST_REASONS, JOURNEY_LOST_PROMPT_OUTCOMES, JOURNEY_HEARD_FROM_CODES,
      JOURNEY_CHAT_CHANNEL_LABELS, firstChatContactTitle,
    };
    for (const [name, value] of Object.entries(phase3)) {
      expect(value).toBeDefined();
      expect((shared as unknown as Record<string, unknown>)[name]).toBe(value);
    }
  });
```

- [ ] **Step 4: Run the shared spec — must fail**

Run (from `packages/shared`): `npx vitest run src/customer-journey.spec.ts`
Expected: FAIL — 4 failed / 8 passed. Failing: the touch channel/outcome test, the codes/lost-prompt test, the chat-label test and the index-export test (new names are `undefined`, e.g. `expected undefined to deeply equal [ 'PHONE', … ]`, `TypeError: firstChatContactTitle is not a function`, `expected undefined to be defined`). Passing: the manual-entry shape test (vitest does not type-check; the shapes are enforced at compile time by the API contract spec in Step 5) and the 7 other existing tests.

- [ ] **Step 5: Write the failing API jest pin of the shared contract**

Create `apps/api/src/modules/customer-journey/journey-shared-contract.spec.ts`:

```ts
import { ChatChannel } from '@prisma/client';
import {
  JOURNEY_CHAT_CHANNEL_LABELS,
  JOURNEY_ENTRY_KINDS,
  JOURNEY_HEARD_FROM_CODES,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_LOST_PROMPT_OUTCOMES,
  JOURNEY_LOST_REASONS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_RECORDABLE_TOUCH_CHANNELS,
  JOURNEY_TOUCH_CHANNELS,
  JOURNEY_TOUCH_CHANNEL_LABELS,
  JOURNEY_TOUCH_OUTCOMES,
  JOURNEY_TOUCH_OUTCOME_LABELS,
  firstChatContactTitle,
  type JourneyEntryCreatedResponse,
  type JourneyEntryDeletedResponse,
  type JourneyEvent,
  type JourneyManualEntryInput,
  type JourneyStepEvidence,
  type JourneyStepState,
  type JourneySummary,
} from '@installment/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { chatSource } from './sources/chat.source';

/**
 * สเปคของ packages/shared ไม่รันใน CI (deploy-gcp.yml รันแค่ jest ของ API / vitest ของเว็บ) ⇒ ตรึงสัญญาร่วมเฟส 3 ซ้ำที่นี่
 * ค่าที่คาดหวังเขียนตรง ๆ ไม่อ่านจาก shared — แก้ป้าย/ลำดับที่ shared แล้วไม่ได้ตั้งใจ = แดง
 * ส่วน "ชนิด" ถูกตรวจตอน ts-jest คอมไพล์ไฟล์นี้ (และ tsc --noEmit ของ apps/api ที่รวม src/**)
 */
const REQUEST_ID = '3f0c2b7e-9a41-4c55-8d2e-6b1f0a9c7d21';

describe('สัญญาร่วมเฟส 3 (@installment/shared) — ตรึงใน jest ของ API', () => {
  it('ช่องทาง/ผลการติดต่อ: ลำดับชิป · ป้ายไทย · ช่องทางที่บันทึกได้ไม่มี อื่น ๆ · ยาวไม่เกินคอลัมน์ entries', () => {
    expect(JOURNEY_TOUCH_CHANNELS).toEqual(['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN', 'OTHER']);
    expect(JOURNEY_TOUCH_CHANNEL_LABELS).toEqual({ PHONE: 'โทร', FB_APP: 'แชทในแอป FB', LINE_APP: 'LINE', WALK_IN: 'หน้าร้าน', OTHER: 'อื่น ๆ' });
    expect(Object.keys(JOURNEY_TOUCH_CHANNEL_LABELS)).toEqual([...JOURNEY_TOUCH_CHANNELS]);
    expect(JOURNEY_RECORDABLE_TOUCH_CHANNELS).toEqual(['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN']);
    expect(JOURNEY_TOUCH_OUTCOMES).toEqual(['APPOINTED', 'VISITED', 'THINKING', 'BUDGET', 'NO_ANSWER', 'BOUGHT_ELSEWHERE', 'NOT_INTERESTED']);
    expect(JOURNEY_TOUCH_OUTCOME_LABELS).toEqual({
      APPOINTED: 'นัดแล้ว', VISITED: 'มาร้านแล้ว', THINKING: 'ขอคิดก่อน', BUDGET: 'งบ/ดาวน์ไม่พอ',
      NO_ANSWER: 'ไม่รับสาย', BOUGHT_ELSEWHERE: 'ซื้อที่อื่น', NOT_INTERESTED: 'ไม่สนใจ',
    });
    expect(Object.keys(JOURNEY_TOUCH_OUTCOME_LABELS)).toEqual([...JOURNEY_TOUCH_OUTCOMES]);
    for (const code of JOURNEY_TOUCH_CHANNELS) expect(code.length).toBeLessThanOrEqual(16); // customer_journey_entries.channel VARCHAR(16)
    for (const code of JOURNEY_TOUCH_OUTCOMES) expect(code.length).toBeLessThanOrEqual(20); // outcome VARCHAR(20)
  });

  it('เหตุผลหลุด 5 · รู้จักร้านจาก 9 เรียงตรงกับคีย์ป้ายเดิม · ผลที่ถาม "ติดป้ายหลุดไหม" 2 ตัว', () => {
    expect(JOURNEY_LOST_REASONS).toEqual(['NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'CREDIT_FAILED', 'UNREACHABLE', 'OTHER']);
    expect(Object.keys(JOURNEY_LOST_REASON_LABELS)).toEqual([...JOURNEY_LOST_REASONS]);
    expect(JOURNEY_HEARD_FROM_CODES).toEqual(['FB_AD', 'FB_PAGE', 'TIKTOK', 'LINE', 'GOOGLE', 'FRIEND', 'WALK_BY', 'OLD_CUSTOMER', 'OTHER']);
    expect(Object.keys(JOURNEY_HEARD_FROM_LABELS)).toEqual([...JOURNEY_HEARD_FROM_CODES]);
    expect(JOURNEY_LOST_PROMPT_OUTCOMES).toEqual({ BOUGHT_ELSEWHERE: 'BOUGHT_ELSEWHERE', NOT_INTERESTED: 'NOT_INTERESTED' });
    for (const code of JOURNEY_LOST_REASONS) expect(code.length).toBeLessThanOrEqual(20); // lost_reason VARCHAR(20)
    for (const code of JOURNEY_HEARD_FROM_CODES) expect(code.length).toBeLessThanOrEqual(16); // heard_from VARCHAR(16)
  });

  it('ป้ายช่องทางแชทครบทุกค่าของ enum ChatChannel · firstChatContactTitle', () => {
    expect(JOURNEY_CHAT_CHANNEL_LABELS).toEqual({ FACEBOOK: 'Facebook', LINE_SHOP: 'LINE ร้าน', LINE_FINANCE: 'LINE การเงิน', TIKTOK: 'TikTok', WEB: 'เว็บ' });
    expect(Object.keys(JOURNEY_CHAT_CHANNEL_LABELS).sort()).toEqual(Object.values(ChatChannel).sort());
    expect(firstChatContactTitle('CHAT_FACEBOOK')).toBe('ทักแชทครั้งแรกทาง Facebook');
    expect(firstChatContactTitle('CHAT_LINE_FINANCE')).toBe('ทักแชทครั้งแรกทาง LINE การเงิน');
    expect(firstChatContactTitle('CHAT_INSTAGRAM')).toBe('ทักแชทครั้งแรกทาง INSTAGRAM');
    for (const notChat of ['WALK_IN', 'REFERRAL', 'UNKNOWN', 'AI_CHAT', 'CHAT_', '']) expect(firstChatContactTitle(notChat)).toBeNull();
  });

  it('ชนิด: body บันทึกมือ 4 แบบตาม JOURNEY_ENTRY_KINDS.MANUAL · OTHER บันทึกใหม่ไม่ได้ · สถานะ/หลักฐานขั้นใหม่ · ฟิลด์เลิกทำ · รูปคำตอบ POST/DELETE', () => {
    const inputs: JourneyManualEntryInput[] = [
      { kind: 'TOUCHPOINT', channel: 'LINE_APP', outcome: 'NO_ANSWER', clientRequestId: REQUEST_ID },
      { kind: 'HEARD_FROM', heardFrom: 'WALK_BY' },
      { kind: 'MARKED_LOST', lostReason: 'CREDIT_FAILED', clientRequestId: REQUEST_ID },
      { kind: 'REOPENED' },
    ];
    expect(inputs.map((input) => input.kind)).toEqual([...JOURNEY_ENTRY_KINDS.MANUAL]);
    // @ts-expect-error OTHER มีไว้อ่านแถวเก่า — body ใหม่รับเฉพาะ JourneyRecordableTouchChannel
    const legacyChannel: JourneyManualEntryInput = { kind: 'TOUCHPOINT', channel: 'OTHER', outcome: 'THINKING' };
    expect(legacyChannel.kind).toBe('TOUCHPOINT');

    const states: JourneyStepState[] = ['done', 'current', 'skipped', 'todo', 'not_needed'];
    const evidence: JourneyStepEvidence[] = ['SYSTEM', 'MANUAL', 'CHAT_FILE'];
    expect([states.length, evidence.length]).toEqual([5, 3]);

    const undo: Pick<JourneyEvent, 'entryId' | 'undoableUntil' | 'canDelete'> = { entryId: 'entry-row-1', undoableUntil: null, canDelete: false };
    expect(Object.keys(undo)).toEqual(['entryId', 'undoableUntil', 'canDelete']);

    const flags: Pick<JourneySummary, 'askHeardFrom' | 'creditFilePending'> = { askHeardFrom: false, creditFilePending: false };
    const created: JourneyEntryCreatedResponse = { entryId: null, event: null, summary: flags as JourneySummary };
    const deleted: JourneyEntryDeletedResponse = { summary: created.summary };
    expect(Object.keys(created)).toEqual(['entryId', 'event', 'summary']);
    expect(Object.keys(deleted)).toEqual(['summary']);
  });
});

describe('chatSource — ถ้อยคำแถวห้องแชทเท่าเดิมหลังย้ายป้ายช่องทางไป shared', () => {
  const OWNER = { id: 'o1', role: 'OWNER' };
  const at = (iso: string) => new Date(iso);
  /** ไม่มีข้อความ/นัด/ลีด/ลูกค้า — เหลือแถว "เปิดห้อง" อย่างเดียว เวลา = createdAt ของห้อง */
  function chatDb(rooms: Array<{ id: string; channel: string; createdAt: Date }>) {
    return {
      chatRoom: { findMany: jest.fn().mockResolvedValue(rooms) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      todo: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }

  it.each([
    ['FACEBOOK', 'ทักแชทครั้งแรกทาง Facebook'],
    ['LINE_SHOP', 'ทักแชทครั้งแรกทาง LINE ร้าน'],
    ['LINE_FINANCE', 'ทักแชทครั้งแรกทาง LINE การเงิน'],
    ['TIKTOK', 'ทักแชทครั้งแรกทาง TikTok'],
    ['WEB', 'ทักแชทครั้งแรกทาง เว็บ'],
  ])('ห้องแรกทาง %s → "%s"', async (channel, title) => {
    const prisma = chatDb([{ id: `room-${channel}`, channel, createdAt: at('2026-09-01T03:00:00.000Z') }]);
    const events = await chatSource(prisma as unknown as PrismaService, ['c1'], { limit: 30 }, OWNER);
    expect(events).toEqual([
      {
        id: `chatroom-room-${channel}`, type: 'CHAT_ROOM_OPENED', group: 'chat', stage: 'CONTACTED', timestamp: '2026-09-01T03:00:00.000Z',
        title, actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE', href: `/inbox/room-${channel}`, metadata: { channel },
      },
    ]);
  });

  it('ห้องถัดไปตามเวลาขึ้นต้น "ทักเพิ่มทาง" ด้วยป้ายชุดเดียวกัน · ขั้น CONTACTED เฉพาะห้องแรก', async () => {
    const prisma = chatDb([
      { id: 'r-web', channel: 'WEB', createdAt: at('2026-09-05T03:00:00.000Z') },
      { id: 'r-line-finance', channel: 'LINE_FINANCE', createdAt: at('2026-09-01T03:00:00.000Z') },
      { id: 'r-line-shop', channel: 'LINE_SHOP', createdAt: at('2026-09-02T03:00:00.000Z') },
      { id: 'r-facebook', channel: 'FACEBOOK', createdAt: at('2026-09-03T03:00:00.000Z') },
      { id: 'r-tiktok', channel: 'TIKTOK', createdAt: at('2026-09-04T03:00:00.000Z') },
    ]);
    const events = await chatSource(prisma as unknown as PrismaService, ['c1'], { limit: 30 }, OWNER);
    expect(Object.fromEntries(events.map((e) => [e.id, [e.title, e.stage]]))).toEqual({
      'chatroom-r-line-finance': ['ทักแชทครั้งแรกทาง LINE การเงิน', 'CONTACTED'],
      'chatroom-r-line-shop': ['ทักเพิ่มทาง LINE ร้าน', null],
      'chatroom-r-facebook': ['ทักเพิ่มทาง Facebook', null],
      'chatroom-r-tiktok': ['ทักเพิ่มทาง TikTok', null],
      'chatroom-r-web': ['ทักเพิ่มทาง เว็บ', null],
    });
  });
});
```

- [ ] **Step 6: Run the API contract spec — must fail**

Run (from `apps/api`): `npx jest src/modules/customer-journey/journey-shared-contract.spec.ts --runInBand`
Expected: FAIL — `Test suite failed to run` with ts-jest diagnostics `TS2305: Module '"@installment/shared"' has no exported member 'JOURNEY_CHAT_CHANNEL_LABELS'` (and the other new names), because `packages/shared/dist` was built from the unchanged source in Step 2.

- [ ] **Step 7: Implement the shared additions — imports and label maps**

In `packages/shared/src/customer-journey.ts`, replace lines 6-9:

```ts
 * 🔴 PDPA: JourneyEvent และแถว entries ห้ามพกข้อความแชท · callLog.notes · เบอร์ · เลขบัตร · ที่อยู่
 */

/**
```

with:

```ts
 * 🔴 PDPA: JourneyEvent และแถว entries ห้ามพกข้อความแชท · callLog.notes · เบอร์ · เลขบัตร · ที่อยู่
 */

import { chatSourceChannel } from './customer-sort';

/**
```

Then replace lines 72-92 (from `/** ป้ายเหตุผล "หลุด"` through the closing `};` of `JOURNEY_HEARD_FROM_LABELS`):

```ts
/** ป้ายเหตุผล "หลุด" — รหัสตาม lost_reason VARCHAR(20) ของ entries/states · รหัสที่ไม่มีในนี้ ผู้แสดงใช้คำกลางเอง (ห้ามแสดงค่าดิบ) */
export const JOURNEY_LOST_REASON_LABELS: Readonly<Record<string, string>> = {
  NOT_INTERESTED: 'ไม่สนใจ',
  BOUGHT_ELSEWHERE: 'ซื้อที่อื่น',
  CREDIT_FAILED: 'เครดิตไม่ผ่าน',
  UNREACHABLE: 'ติดต่อไม่ได้',
  OTHER: 'อื่น ๆ',
};

/** ป้าย "ลูกค้าบอกว่ารู้จักร้านจาก" — รหัสตาม heard_from VARCHAR(16) (บันทึกมือเฟส 3 + first_source `HEARD:<รหัส>`) */
export const JOURNEY_HEARD_FROM_LABELS: Readonly<Record<string, string>> = {
  FB_AD: 'โฆษณา FB',
  FB_PAGE: 'เพจ/โพสต์',
  TIKTOK: 'TikTok',
  LINE: 'LINE',
  GOOGLE: 'Google',
  FRIEND: 'เพื่อนแนะนำ',
  WALK_BY: 'ผ่านหน้าร้าน',
  OLD_CUSTOMER: 'ลูกค้าเก่า',
  OTHER: 'อื่น ๆ',
};
```

with:

```ts
/** รหัสเหตุผล "หลุด" เรียงตามชิป "ติดป้ายหลุด — เพราะอะไร" — DTO ใช้ @IsIn ชุดนี้ · ต้องเท่ากับคีย์ของ JOURNEY_LOST_REASON_LABELS ตามลำดับ */
export const JOURNEY_LOST_REASONS = ['NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'CREDIT_FAILED', 'UNREACHABLE', 'OTHER'] as const;
export type JourneyLostReason = (typeof JOURNEY_LOST_REASONS)[number];

/** ป้ายเหตุผล "หลุด" — รหัสตาม lost_reason VARCHAR(20) ของ entries/states · รหัสที่ไม่มีในนี้ ผู้แสดงใช้คำกลางเอง (ห้ามแสดงค่าดิบ) */
export const JOURNEY_LOST_REASON_LABELS: Readonly<Record<string, string>> = {
  NOT_INTERESTED: 'ไม่สนใจ',
  BOUGHT_ELSEWHERE: 'ซื้อที่อื่น',
  CREDIT_FAILED: 'เครดิตไม่ผ่าน',
  UNREACHABLE: 'ติดต่อไม่ได้',
  OTHER: 'อื่น ๆ',
};

/** รหัส "รู้จักร้านจากไหน" เรียงตามชิป 9 ตัว — DTO ใช้ @IsIn ชุดนี้ · ต้องเท่ากับคีย์ของ JOURNEY_HEARD_FROM_LABELS ตามลำดับ */
export const JOURNEY_HEARD_FROM_CODES = ['FB_AD', 'FB_PAGE', 'TIKTOK', 'LINE', 'GOOGLE', 'FRIEND', 'WALK_BY', 'OLD_CUSTOMER', 'OTHER'] as const;
export type JourneyHeardFrom = (typeof JOURNEY_HEARD_FROM_CODES)[number];

/** ป้าย "ลูกค้าบอกว่ารู้จักร้านจาก" — รหัสตาม heard_from VARCHAR(16) (บันทึกมือเฟส 3 + first_source `HEARD:<รหัส>`) */
export const JOURNEY_HEARD_FROM_LABELS: Readonly<Record<string, string>> = {
  FB_AD: 'โฆษณา FB',
  FB_PAGE: 'เพจ/โพสต์',
  TIKTOK: 'TikTok',
  LINE: 'LINE',
  GOOGLE: 'Google',
  FRIEND: 'เพื่อนแนะนำ',
  WALK_BY: 'ผ่านหน้าร้าน',
  OLD_CUSTOMER: 'ลูกค้าเก่า',
  OTHER: 'อื่น ๆ',
};

/**
 * ช่องทางของบันทึกการติดต่อ — ตรงกับ customer_journey_entries.channel VARCHAR(16)
 * ป้ายชุดเดียวของทั้งระบบ (แถวไทม์ไลน์ของ API · ชิปในเว็บ) ห้ามลอกไปประกาศซ้ำ · OTHER มีไว้อ่านแถวเก่าเท่านั้น
 */
export const JOURNEY_TOUCH_CHANNELS = ['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN', 'OTHER'] as const;
export type JourneyTouchChannel = (typeof JOURNEY_TOUCH_CHANNELS)[number];
export const JOURNEY_TOUCH_CHANNEL_LABELS: Record<JourneyTouchChannel, string> = {
  PHONE: 'โทร',
  FB_APP: 'แชทในแอป FB',
  LINE_APP: 'LINE',
  WALK_IN: 'หน้าร้าน',
  OTHER: 'อื่น ๆ',
};

/** ช่องทางที่พนักงานกดบันทึกได้ (ชิปแถว "ช่องทาง" + @IsIn ของ POST …/journey/entries) — scope v2 ไม่มีชิป "อื่น ๆ" */
export const JOURNEY_RECORDABLE_TOUCH_CHANNELS = ['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN'] as const satisfies readonly JourneyTouchChannel[];
export type JourneyRecordableTouchChannel = (typeof JOURNEY_RECORDABLE_TOUCH_CHANNELS)[number];

/** ผลของการติดต่อ — ตรงกับ customer_journey_entries.outcome VARCHAR(20) · ลำดับ = ลำดับชิปแถว "ผล" */
export const JOURNEY_TOUCH_OUTCOMES = ['APPOINTED', 'VISITED', 'THINKING', 'BUDGET', 'NO_ANSWER', 'BOUGHT_ELSEWHERE', 'NOT_INTERESTED'] as const;
export type JourneyTouchOutcome = (typeof JOURNEY_TOUCH_OUTCOMES)[number];
export const JOURNEY_TOUCH_OUTCOME_LABELS: Record<JourneyTouchOutcome, string> = {
  APPOINTED: 'นัดแล้ว',
  VISITED: 'มาร้านแล้ว',
  THINKING: 'ขอคิดก่อน',
  BUDGET: 'งบ/ดาวน์ไม่พอ',
  NO_ANSWER: 'ไม่รับสาย',
  BOUGHT_ELSEWHERE: 'ซื้อที่อื่น',
  NOT_INTERESTED: 'ไม่สนใจ',
};

/**
 * ผลการติดต่อที่ถามต่อว่า "ติดป้ายหลุดไหม" → เหตุผลที่บันทึกเมื่อกด "ใช่ ติดป้ายหลุด" (จับคู่ 1:1)
 * ไม่รับสายไม่ถาม (Q3) · ลูกค้าที่ซื้อแล้วไม่ถาม (เว็บตัดสินจาก summary.stage ของคำตอบ)
 */
export const JOURNEY_LOST_PROMPT_OUTCOMES: Readonly<Partial<Record<JourneyTouchOutcome, JourneyLostReason>>> = {
  BOUGHT_ELSEWHERE: 'BOUGHT_ELSEWHERE',
  NOT_INTERESTED: 'NOT_INTERESTED',
};

/** ป้ายช่องทางของห้องแชท (enum ChatChannel) — ชุดเดียวของแถวไทม์ไลน์ "ทักแชทครั้งแรกทาง / ทักเพิ่มทาง" และบรรทัดอ่านอย่างเดียวในหน้าสร้างสัญญา */
export const JOURNEY_CHAT_CHANNEL_LABELS: Readonly<Record<string, string>> = {
  FACEBOOK: 'Facebook',
  LINE_SHOP: 'LINE ร้าน',
  LINE_FINANCE: 'LINE การเงิน',
  TIKTOK: 'TikTok',
  WEB: 'เว็บ',
};

/**
 * ถ้อยคำเดียวของ "ลูกค้าเริ่มทักทางไหน" ทุกหน้า (คำตัดสิน 12) — รับ summary.firstChannel หรือ chatSourceOf(<ช่องทางห้อง>)
 * `CHAT_FACEBOOK` → `ทักแชทครั้งแรกทาง Facebook` · ช่องทางที่ไม่มีป้าย → รหัสดิบหลัง `CHAT_` (เหมือนแถวไทม์ไลน์เดิม)
 * ไม่ได้เริ่มจากแชท (WALK_IN · REFERRAL · UNKNOWN · `CHAT_` เปล่า) → null = ไม่แสดงอะไร
 */
export function firstChatContactTitle(firstChannel: string): string | null {
  const channel = chatSourceChannel(firstChannel);
  if (channel === null) return null;
  return `ทักแชทครั้งแรกทาง ${JOURNEY_CHAT_CHANNEL_LABELS[channel] ?? channel}`;
}
```

- [ ] **Step 8: Implement the shared additions — event, step, summary and entry types**

In `packages/shared/src/customer-journey.ts` (line numbers now shifted by the Step 7 insertions — anchor on the text), replace:

```ts
  /** เฉพาะคีย์ที่ผ่าน whitelist ของ source นั้น — ห้ามข้อความแชท/โน้ตโทร/เบอร์/เลขบัตร/ที่อยู่ */
  metadata?: Record<string, unknown>;
}
```

with:

```ts
  /** เฉพาะคีย์ที่ผ่าน whitelist ของ source นั้น — ห้ามข้อความแชท/โน้ตโทร/เบอร์/เลขบัตร/ที่อยู่ */
  metadata?: Record<string, unknown>;
  /** เฉพาะแถวบันทึกมือ (origin MANUAL): id ของแถว customer_journey_entries — ใช้กับ DELETE /customers/:id/journey/entries/:entryId */
  entryId?: string;
  /** เฉพาะแถวบันทึกมือ: ISO เวลาสุดท้ายที่ผู้บันทึกเลิกทำเองได้ (createdAt + 24 ชม.) · null = ผู้อ่านไม่ใช่ผู้บันทึก หรือเลยเวลาแล้ว */
  undoableUntil?: string | null;
  /** เฉพาะแถวบันทึกมือ: ผู้อ่านคนนี้ลบแถวนี้ได้ไหม (API ตัดสิน) — เว็บแสดงลิงก์ "เลิกทำ" ตามค่านี้ ห้ามคำนวณเอง */
  canDelete?: boolean;
}
```

Replace:

```ts
export type JourneyStepState = 'done' | 'current' | 'skipped' | 'todo';

export interface JourneyStep {
  stage: JourneyStage;
  label: string;
  /** ISO เวลาเข้าขั้น · null = ยังไม่ถึง/ข้าม */
  at: string | null;
  state: JourneyStepState;
  /** MANUAL = ขั้นนี้มาจากบันทึกมือ (เว็บติดป้าย "พนักงานบันทึก") */
  evidence: 'SYSTEM' | 'MANUAL';
}
```

with:

```ts
/** not_needed = ขั้นตรวจเครดิตของผู้ซื้อที่ไม่ต้องตรวจ (ซื้อสด / ไฟแนนซ์นอกตรวจ) — ไม่นับเป็น "ข้าม" · API เป็นผู้ตั้งค่าเท่านั้น */
export type JourneyStepState = 'done' | 'current' | 'skipped' | 'todo' | 'not_needed';
/**
 * SYSTEM = หลักฐานจากระบบ · MANUAL = บันทึกมือ (เว็บติดป้าย "พนักงานบันทึก")
 * CHAT_FILE = ขั้นตรวจเครดิตมาจากไฟล์เอกสาร (pdf / doc / xls) ที่ลูกค้าส่งในแชท (เว็บติดป้าย "ส่งไฟล์ในแชท" — API ส่งแค่ชนิดกับเวลา ไม่มีลิงก์ ชื่อ หรือเนื้อหาไฟล์)
 */
export type JourneyStepEvidence = 'SYSTEM' | 'MANUAL' | 'CHAT_FILE';

export interface JourneyStep {
  stage: JourneyStage;
  label: string;
  /** ISO เวลาเข้าขั้น · null = ยังไม่ถึง/ข้าม/ไม่ต้องตรวจ */
  at: string | null;
  state: JourneyStepState;
  evidence: JourneyStepEvidence;
}
```

Replace:

```ts
  lost: { at: string; reason: string } | null;
  postSaleBadges: string[];
  creditRejected: boolean;
}
```

with:

```ts
  lost: { at: string; reason: string } | null;
  postSaleBadges: string[];
  creditRejected: boolean;
  /** ถาม "ลูกค้ารู้จักร้านจากไหน" ไหม — API คำนวณครั้งเดียว แบนเนอร์แท็บการเดินทางกับการ์ดหน้าสร้างสัญญาอ่านธงเดียวกัน เว็บห้าม derive เอง */
  askHeardFrom: boolean;
  /** ลูกค้าส่งไฟล์เอกสาร (pdf / doc / xls) ในแชทแล้วแต่ยังไม่มีผลตรวจเครดิต (ยังไม่ซื้อ) — การ์ด KPI "เครดิต" แสดง "ส่งไฟล์แล้ว รอตรวจ" */
  creditFilePending: boolean;
}
```

Append at the end of the file (after the closing `}` of `JourneyRedirect`):

```ts

/**
 * body ของ POST /customers/:id/journey/entries — scope v2: ไม่มีโน้ต · ไม่มีเปลี่ยนเวลา (เวลา server เสมอ) · ไม่มี roomId
 * clientRequestId = UUID ใหม่ต่อการกดหนึ่งครั้ง (กันบันทึกซ้ำเมื่อคำขอถูกส่งซ้ำ)
 */
export type JourneyManualEntryInput =
  | { kind: 'TOUCHPOINT'; channel: JourneyRecordableTouchChannel; outcome: JourneyTouchOutcome; clientRequestId?: string }
  | { kind: 'HEARD_FROM'; heardFrom: JourneyHeardFrom; clientRequestId?: string }
  | { kind: 'MARKED_LOST'; lostReason: JourneyLostReason; clientRequestId?: string }
  | { kind: 'REOPENED'; clientRequestId?: string };

/** 201 ของ POST …/journey/entries · entryId/event = null เมื่อไม่ได้เขียนแถว (เปิดใหม่ทั้งที่ไม่ได้หลุด) · summary = ผลสรุปสดหลังคำนวณใหม่ */
export interface JourneyEntryCreatedResponse {
  entryId: string | null;
  event: JourneyEvent | null;
  summary: JourneySummary;
}

/** 200 ของ DELETE …/journey/entries/:entryId — ผลสรุปสดหลังเลิกทำ */
export interface JourneyEntryDeletedResponse {
  summary: JourneySummary;
}
```

- [ ] **Step 9: Run the shared spec, then rebuild shared**

Run (from `packages/shared`): `npx vitest run src/customer-journey.spec.ts`
Expected: PASS — `Tests  12 passed (12)`.
Run (repo root): `npm run build --workspace=@installment/shared`
Expected: exits 0 with no `error TS` lines (the `satisfies` check and the `Record<JourneyTouchChannel, string>` exhaustiveness both compile).

- [ ] **Step 10: Write the failing builder spec for the new summary flags**

In `apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts`, insert after line 72 (the closing `});` of the `'stage ชนะเวลาที่แช่แข็ง …'` test, still inside `describe('buildJourneySummary')`):

```ts

  it('ธงเฟส 3 มีในคำตอบเสมอ: askHeardFrom / creditFilePending เป็น false สำหรับลูกค้าที่เริ่มจากแชทและไม่มีไฟล์รอตรวจ', () => {
    const s = buildJourneySummary(row(), extras, NOW);
    expect(s).toHaveProperty('askHeardFrom', false);
    expect(s).toHaveProperty('creditFilePending', false);
  });
```

- [ ] **Step 11: Run the builder spec — must fail**

Run (from `apps/api`): `npx jest src/modules/customer-journey/journey-summary.builder.spec.ts --runInBand`
Expected: FAIL — `Test suite failed to run` with `journey-summary.builder.ts … error TS2739: Type '{ stage: …; }' is missing the following properties from type 'JourneySummary': askHeardFrom, creditFilePending` (shared `dist` now requires both fields).

- [ ] **Step 12: Add the builder shim**

In `apps/api/src/modules/customer-journey/journey-summary.builder.ts`, replace line 142-143:

```ts
    creditRejected: !purchased && extras.creditRejected,
  };
```

with:

```ts
    creditRejected: !purchased && extras.creditRejected,
    // รูปของสัญญาเฟส 3 วางไว้ก่อน — ค่าจริง (ลูกค้าหน้าร้านที่ยังไม่ตอบ · ไฟล์ในแชทรอตรวจ) คำนวณจาก extras ในงานสรุปผลเฟส 3
    askHeardFrom: false,
    creditFilePending: false,
  };
```

- [ ] **Step 13: Run the builder spec and the contract spec**

Run (from `apps/api`): `npx jest src/modules/customer-journey/journey-summary.builder.spec.ts src/modules/customer-journey/journey-shared-contract.spec.ts --runInBand`
Expected: PASS — builder `10 passed`; contract `10 passed` (4 constant/type tests + 5 `it.each` rows + 1 multi-room test). The chat title tests pass on the old local map too — they are the parity guard for Step 14.

- [ ] **Step 14: Point entries.source.ts at the shared maps (delete the local copies)**

In `apps/api/src/modules/customer-journey/sources/entries.source.ts`, replace lines 1-9:

```ts
import {
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_LOST_REASON_LABELS,
  type JourneyEntryKind,
  type JourneyEvent,
  type JourneyEventGroup,
  type JourneyStage,
} from '@installment/shared';
```

with:

```ts
import {
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_TOUCH_CHANNEL_LABELS,
  JOURNEY_TOUCH_OUTCOME_LABELS,
  type JourneyEntryKind,
  type JourneyEvent,
  type JourneyEventGroup,
  type JourneyStage,
} from '@installment/shared';
```

Replace lines 29-31:

```ts
const TOUCH_CHANNELS: Record<string, string> = { PHONE: 'โทร', FB_APP: 'แชทในแอป FB', LINE_APP: 'LINE', WALK_IN: 'หน้าร้าน', OTHER: 'อื่น ๆ' };
const OUTCOMES: Record<string, string> = { APPOINTED: 'นัดแล้ว', VISITED: 'มาร้านแล้ว', THINKING: 'ขอคิดก่อน', BUDGET: 'งบ/ดาวน์ไม่พอ', NO_ANSWER: 'ไม่รับสาย', BOUGHT_ELSEWHERE: 'ซื้อที่อื่น', NOT_INTERESTED: 'ไม่สนใจ' };
// ป้ายรู้จักร้านจาก / เหตุผลหลุด = JOURNEY_HEARD_FROM_LABELS / JOURNEY_LOST_REASON_LABELS ของ shared (ชุดเดียวกับ summary และเว็บ)
```

with:

```ts
// ป้ายช่องทาง / ผล / รู้จักร้านจาก / เหตุผลหลุด = label map ของ shared ชุดเดียวกับ summary และเว็บ (ห้ามประกาศซ้ำในไฟล์นี้)
/** อ่านป้ายด้วยรหัสจากคอลัมน์ VARCHAR — ไม่มีในชุด = undefined ให้ผู้เรียกใช้คำกลางเอง (ไม่แสดงรหัสดิบ) */
const labelOf = (labels: Readonly<Record<string, string>>, code: string | null): string | undefined => labels[code ?? ''];
```

Replace the TOUCHPOINT line (was line 89):

```ts
      const title = kind === 'TOUCHPOINT' ? `ติดต่อทาง${TOUCH_CHANNELS[row.channel ?? ''] ?? 'อื่น ๆ'}: ${OUTCOMES[row.outcome ?? ''] ?? 'บันทึกแล้ว'}`
```

with:

```ts
      const title = kind === 'TOUCHPOINT' ? `ติดต่อทาง${labelOf(JOURNEY_TOUCH_CHANNEL_LABELS, row.channel) ?? 'อื่น ๆ'}: ${labelOf(JOURNEY_TOUCH_OUTCOME_LABELS, row.outcome) ?? 'บันทึกแล้ว'}`
```

- [ ] **Step 15: Point chat.source.ts at the shared chat labels (delete the exported local copy)**

In `apps/api/src/modules/customer-journey/sources/chat.source.ts`, replace line 2:

```ts
import { CHAT_SOURCE_PREFIX, type JourneyEvent } from '@installment/shared';
```

with:

```ts
import { CHAT_SOURCE_PREFIX, JOURNEY_CHAT_CHANNEL_LABELS, chatSourceOf, firstChatContactTitle, type JourneyEvent } from '@installment/shared';
```

Replace lines 6-10:

```ts
import { asRecord, bahtText, dbTimeRange, finalizeSource, roleSeesGroup, scanTake, staffActor, type JourneyActor, type JourneySource, type JourneyWindow } from './journey-window';

export const CHAT_CHANNEL_LABELS: Record<string, string> = { FACEBOOK: 'Facebook', LINE_SHOP: 'LINE ร้าน', LINE_FINANCE: 'LINE การเงิน', TIKTOK: 'TikTok', WEB: 'เว็บ' };

interface ChatDayRow { roomId: string; day: string; customer: number; staff: number; bot: number; firstCustomerAt: Date | null; lastAt: Date }
```

with:

```ts
import { asRecord, bahtText, dbTimeRange, finalizeSource, roleSeesGroup, scanTake, staffActor, type JourneyActor, type JourneySource, type JourneyWindow } from './journey-window';

interface ChatDayRow { roomId: string; day: string; customer: number; staff: number; bot: number; firstCustomerAt: Date | null; lastAt: Date }
```

Replace the room title line (was line 54):

```ts
    title: `${index === 0 ? 'ทักแชทครั้งแรกทาง' : 'ทักเพิ่มทาง'} ${CHAT_CHANNEL_LABELS[room.channel] ?? room.channel}`,
```

with:

```ts
    // channel ของห้องเป็น enum ChatChannel (ไม่ว่าง) ⇒ firstChatContactTitle ไม่คืน null · ถ้อยคำเดียวกับหน้าสร้างสัญญา (คำตัดสิน 12)
    title: index === 0 ? firstChatContactTitle(chatSourceOf(room.channel))! : `ทักเพิ่มทาง ${JOURNEY_CHAT_CHANNEL_LABELS[room.channel] ?? room.channel}`,
```

- [ ] **Step 16: Run every customer-journey unit spec that reads these titles**

Run (from `apps/api`): `npx jest src/modules/customer-journey/sources/entries.source.spec.ts src/modules/customer-journey/journey-shared-contract.spec.ts src/modules/customer-journey/sources/role-visibility.spec.ts src/modules/customer-journey/journey-summary.builder.spec.ts src/modules/customer-journey/customer-journey.service.spec.ts --runInBand`
Expected: PASS — 5 suites passed, 0 failed (entries `4 passed` incl. the 53-title parity test; contract `10 passed`; builder `10 passed`).
Run (repo root): `grep -rnE "CHAT_CHANNEL_LABELS\b|const TOUCH_CHANNELS|const OUTCOMES" apps/api/src/modules/customer-journey`
Expected: only lines containing `JOURNEY_CHAT_CHANNEL_LABELS` (in `chat.source.ts` and `journey-shared-contract.spec.ts`); no `const TOUCH_CHANNELS` / `const OUTCOMES` / bare `CHAT_CHANNEL_LABELS` declaration.

- [ ] **Step 17: Run the web type check — must fail on the widened shared types**

Run (from `apps/web`): `npx tsc --noEmit`
Expected: FAIL with exactly two errors (baseline before this task is 0) —
`src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx` line 8: `error TS2741: Property 'not_needed' is missing in type '{ done: string; current: string; skipped: string; todo: string; }' but required in type 'Record<JourneyStepState, string>'` and
`src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts` line 28 (`return {` of `journeySummary`): `error TS2739: Type '{ … }' is missing the following properties from type 'JourneySummary': askHeardFrom, creditFilePending`.
Any other error means another web file builds a `JourneyStep`/`JourneySummary` by hand — add the same two shims there before continuing.

- [ ] **Step 18: Add the web shims**

In `apps/web/src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx`, replace lines 8-13:

```tsx
const DOT_CLASS: Record<JourneyStep['state'], string> = {
  done: 'bg-success text-success-foreground',
  current: 'bg-primary text-primary-foreground',
  skipped: 'bg-muted text-muted-foreground',
  todo: 'border border-dashed border-border bg-background text-muted-foreground',
};
```

with:

```tsx
const DOT_CLASS: Record<JourneyStep['state'], string> = {
  done: 'bg-success text-success-foreground',
  current: 'bg-primary text-primary-foreground',
  skipped: 'bg-muted text-muted-foreground',
  // ขั้นตรวจเครดิตที่ไม่ต้องตรวจ (ซื้อสด / ไฟแนนซ์นอกตรวจ) — สีเทาชุดเดียวกับขั้นที่ข้าม ไม่เพิ่มสีใหม่ · จุดยังแสดงเลขขั้น
  not_needed: 'bg-muted text-muted-foreground',
  todo: 'border border-dashed border-border bg-background text-muted-foreground',
};
```

In `apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts`, replace line 20:

```ts
      at: states[stage] === 'todo' || states[stage] === 'skipped' ? null : at[stage] ?? null,
```

with:

```ts
      at: states[stage] === 'todo' || states[stage] === 'skipped' || states[stage] === 'not_needed' ? null : at[stage] ?? null,
```

and replace lines 51-53:

```ts
    creditRejected: false,
    ...over,
  };
```

with:

```ts
    creditRejected: false,
    askHeardFrom: false,
    creditFilePending: false,
    ...over,
  };
```

- [ ] **Step 19: Run the web type check and the journey page tests (UTC and local TZ)**

Run (from `apps/web`): `npx tsc --noEmit`
Expected: exits 0, no output.
Run (from `apps/web`): `TZ=UTC npx vitest run src/pages/CustomerDetailPage`
Expected: PASS — all test files under `src/pages/CustomerDetailPage/__tests__/` pass (same counts as before this task; no test file changed).
Run (from `apps/web`): `npx vitest run src/pages/CustomerDetailPage`
Expected: PASS (machine default TZ Asia/Bangkok) — same counts.

- [ ] **Step 20: API type check + lint of every touched file**

Run (repo root): `./tools/check-types.sh api`
Expected: `API: OK` then `TypeScript check passed!` (the `@ts-expect-error` in the contract spec is used — an unused directive would be `TS2578`).
Run (from `apps/api`, never `npm run lint`): `npx eslint src/modules/customer-journey/sources/entries.source.ts src/modules/customer-journey/sources/entries.source.spec.ts src/modules/customer-journey/sources/chat.source.ts src/modules/customer-journey/journey-summary.builder.ts src/modules/customer-journey/journey-summary.builder.spec.ts src/modules/customer-journey/journey-shared-contract.spec.ts`
Expected: 0 errors (warnings allowed only if they already existed on these lines before the task).
Run (from `apps/web`): `npx eslint src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts`
Expected: 0 errors.
Run (from `packages/shared`): `npx eslint src/customer-journey.ts src/customer-journey.spec.ts`
Expected: 0 errors.

- [ ] **Step 21: Real-DB parity for the chat/summary/PDPA specs (local cluster; CI also runs them)**

Run (from `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/chat.source.db.spec.ts src/modules/customer-journey/journey-summary.service.db.spec.ts src/modules/customer-journey/customer-journey.pdpa.db.spec.ts --runInBand`
Expected: PASS — 3 suites; `chat.source.db.spec.ts` still sees `'ทักแชทครั้งแรกทาง Facebook'` and `'ทักเพิ่มทาง LINE ร้าน'`; the PDPA key snapshot is unaffected (no manual row carries the new optional event keys yet). If the local cluster is not running, record that and rely on the CI `test-api` job — do not skip Steps 1-20.

- [ ] **Step 22: Commit**

Run (repo root): `git status --short`
Expected: exactly the 10 paths below (9 modified, 1 new) — no `packages/shared/dist`, no `apps/web/package.json`, no `journey-state.sql`.

```bash
git add \
  packages/shared/src/customer-journey.ts \
  packages/shared/src/customer-journey.spec.ts \
  apps/api/src/modules/customer-journey/sources/entries.source.ts \
  apps/api/src/modules/customer-journey/sources/entries.source.spec.ts \
  apps/api/src/modules/customer-journey/sources/chat.source.ts \
  apps/api/src/modules/customer-journey/journey-summary.builder.ts \
  apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts \
  apps/api/src/modules/customer-journey/journey-shared-contract.spec.ts \
  apps/web/src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx \
  apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts
git commit -F - <<'EOF'
feat(customer-journey): สัญญาร่วมเฟส 3 ใน shared — ป้ายช่องทาง/ผล/แชทย้ายมาที่เดียว · ชนิดบันทึกมือ · ธงสรุปใหม่

- shared: JOURNEY_TOUCH_CHANNELS/OUTCOMES + ป้าย · JOURNEY_RECORDABLE_TOUCH_CHANNELS (ไม่มี OTHER) ·
  JOURNEY_LOST_REASONS · JOURNEY_HEARD_FROM_CODES · JOURNEY_LOST_PROMPT_OUTCOMES · JOURNEY_CHAT_CHANNEL_LABELS +
  firstChatContactTitle (ถ้อยคำ "ทักแชทครั้งแรกทาง …" ชุดเดียว) · JourneyStepState 'not_needed' ·
  JourneyStepEvidence 'CHAT_FILE' · JourneySummary.askHeardFrom/creditFilePending · JourneyEvent.entryId/undoableUntil/canDelete ·
  JourneyManualEntryInput + JourneyEntryCreatedResponse/JourneyEntryDeletedResponse
- API: entries.source / chat.source อ่านป้ายจาก shared (ลบสำเนาในไฟล์) · ถ้อยคำไทม์ไลน์เท่าเดิมทุกไบต์
  (ตรึง 53 ถ้อยคำบันทึกมือ + แถวห้องแชท 5 ช่องทาง) · builder คืนธงใหม่เป็น false ไว้ก่อน
- journey-shared-contract.spec.ts ตรึงค่าคงที่ใน jest ของ API เพราะสเปคของ shared ไม่รันใน CI
- เว็บ: DOT_CLASS รู้จัก not_needed (เทาเดียวกับข้าม) · fixture ใส่ธงใหม่ค่า false
- ไม่เปลี่ยนลำดับขั้น/ป้ายขั้น · ไม่มี migration

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

Run: `git log -1 --stat`
Expected: one commit, 10 files changed.

---

### Task 2: Stage order: ③ ตรวจเครดิต before ④ นัด / จอง

Owner ruling 11 (2026-09-15 "ต้องเช็คเครดิตก่อนนัด") + ruling 13 (un-buy fallback order). Enum names stay; only the order and the INTERESTED label change. No migration. Line numbers below are from the base `origin/main` `10d6e6d3a` (it already contains the merged and deployed staff_reply fix #1595 — Controller ruling R-P4). T1 edits some of the same files first, so **every edit in this task is anchored by exact text, never by line number**.

**Files:**
- Modify: `packages/shared/src/customer-journey.ts` (lines 9-23: doc comment, `JOURNEY_STAGES`, `STAGE_LABELS`)
- Modify (test): `packages/shared/src/customer-journey.spec.ts` (lines 20-23, first `it` block)
- Modify (test): `apps/web/src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx` (whole file, lines 1-88 — T1 does not touch it)
- Modify (test): `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` (lines 356 and 363 inside `describe('การเดินทางของลูกค้า')` first `it`)
- Modify: `apps/api/src/modules/customer-journey/journey-summary.builder.ts` (lines 91-103: new `UNBUY_FALLBACK_STAGES` above `withLiveBought`, line 96 fallback)
- Modify (test): `apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts` (lines 1-9 imports; 27-31; 52; 58; 68-71; 79-82; new `describe` before line 75)
- Create (test): `apps/api/src/modules/customer-journey/journey-state.stage-order.db.spec.ts`
- Modify: `apps/api/src/modules/customer-journey/sql/journey-state.sql` (`resolved` CTE, stage CASE — lines 288-292 at base; anchor by text)
- Modify (test): `apps/api/src/modules/customer-journey/journey-state.service.db.spec.ts` (only the `it('นัด (todo ในห้อง) → INTERESTED …')` case, lines 614-639 at base)
- Modify (test): `apps/api/src/modules/customer-journey/journey-summary.service.db.spec.ts` (lines 119-130)
- Modify: `apps/api/src/modules/customer-journey/customer-journey.service.ts` (lines 43-46, `JOURNEY_NOT_RECORDED`)
- Modify (test): `apps/api/src/modules/customer-journey/customer-journey.service.spec.ts` (line 4 import; append a `describe` after line 212)
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md` (line 111; lines 182-208 §3/§4; event table lines 263, 264, 269, 277, 278, 279)
- Create: `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md`

**Interfaces:**
- Consumes:
  - T1 shared contract (`packages/shared/src/customer-journey.ts` already carries T1's additive types; `journeyFixtures.journeySummary()` already fills T1's new summary fields). This task does not read any T1 symbol directly.
  - Prerequisite — **satisfied** (R-P4): the staff_reply fix (`journey-state.sql` CTEs `rooms` / `auto_anchor` / `staff_reply` + `journey-state.service.db.spec.ts`) is merged and deployed (#1595) and is part of the base `10d6e6d3a`. Step 1 only confirms the checkout.
- Produces:
  - `export const JOURNEY_STAGES = ['CONTACTED', 'IDENTIFIED', 'CREDIT', 'INTERESTED', 'PURCHASED'] as const;` (`@installment/shared`)
  - `export const STAGE_LABELS: Record<JourneyStage, string>` with keys in that order and values `CONTACTED: 'ทักเข้ามา'`, `IDENTIFIED: 'ได้เบอร์ / ยืนยันตัวตน'`, `CREDIT: 'ตรวจเครดิต'`, `INTERESTED: 'นัด / จอง'`, `PURCHASED: 'ซื้อแล้ว'`
  - `export const UNBUY_FALLBACK_STAGES: readonly Exclude<JourneyStage, 'PURCHASED' | 'CONTACTED'>[]` in `journey-summary.builder.ts` = `['INTERESTED', 'CREDIT', 'IDENTIFIED']`, computed from `[...JOURNEY_STAGES].reverse()`
  - `withLiveBought(state: JourneyStateRow, bought: boolean, now: Date): JourneyStateRow` — signature unchanged, un-buy fallback now uses `UNBUY_FALLBACK_STAGES`
  - `journey-state.sql` `resolved` CTE stage CASE order: `bought → interested_at → credit_at → identified_at → CONTACTED` (path CASE, lost CASE and the `INSERT … stage_entered_at` mapping untouched)
  - `JOURNEY_NOT_RECORDED` (API): exactly 3 lines contain `ขั้น "นัด / จอง"`, none contains `สนใจจริง` (T3 may append wording but must keep `ขั้น "นัด / จอง"`; T6 later deletes all three lines — and this task's `describe('JOURNEY_NOT_RECORDED — ชื่อขั้น 4 ใหม่ …')` — when it gives web holds, online applications and trade-ins their own timeline rows)
  - Runbook `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` with sections `## 0` … `## 5` and `## ถอย (rollback)`; later tasks edit it — T3: pre-merge file-signal count as `### 1.6` inside `## 1.` (before `## 2.`) + `(1.6)` at the end of order-table row 1; T9: `### 1.5` directly above T3's `### 1.6` + `(1.5)` in row 1 before `(1.6)` + row 2 + `### 2.1` + rollback note; T7: the only 2-week usage metric section, appended at the end; T15: order-table row 6 + web section appended at the end (none of them adds a `## ` heading inside §0–§5, so the `## ` count only grows at the end of the file)
  - Builder spec pin that reads `sql/journey-state.sql` and asserts the stage CASE equals `UNBUY_FALLBACK_STAGES` — later SQL tasks must keep the shape `CASE WHEN s.bought THEN 'PURCHASED' … ELSE 'CONTACTED' END AS stage`

---

- [ ] **Step 1: Confirm the base (the staff_reply gate is already satisfied)**

Run (from the worktree root):
```bash
grep -c 'channel_first_customer_at' apps/api/src/modules/customer-journey/sql/journey-state.sql
grep -c 'is_system_user' apps/api/src/modules/customer-journey/sql/journey-state.sql
git status --short -- apps/api/src/modules/customer-journey/sql/journey-state.sql apps/api/src/modules/customer-journey/journey-state.service.db.spec.ts
```
Expected: the two counts are greater than 0 (the staff_reply fix #1595 — `7f5eeb0cc`, merged as `9e7bface4` — is in the base `origin/main` `10d6e6d3a`), and `git status` prints nothing. No rebase is expected. If a count is 0, the checkout is not based on `10d6e6d3a` or later: stop and report it to the controller instead of rebasing on your own. If `git status` lists either file, another session has uncommitted edits in this checkout: stop and report; never edit over them.

- [ ] **Step 2: Write the failing shared spec (new order + label)**

In `packages/shared/src/customer-journey.spec.ts` replace this exact text:
```ts
  it('ขั้นเรียงตามลำดับจริง และทุกขั้นมีป้ายไทย (ขั้น 2 = ได้เบอร์ / ยืนยันตัวตน — OD-9)', () => {
    expect(JOURNEY_STAGES).toEqual(['CONTACTED', 'IDENTIFIED', 'INTERESTED', 'CREDIT', 'PURCHASED']);
    expect(Object.keys(STAGE_LABELS)).toEqual([...JOURNEY_STAGES]);
    expect(STAGE_LABELS.IDENTIFIED).toBe('ได้เบอร์ / ยืนยันตัวตน');
```
with:
```ts
  it('ขั้นเรียงตามลำดับจริง และทุกขั้นมีป้ายไทย (ขั้น 2 = ได้เบอร์ / ยืนยันตัวตน — OD-9 · ขั้น 3 ตรวจเครดิต ก่อนขั้น 4 นัด / จอง — เจ้าของสั่ง 2026-09-15)', () => {
    expect(JOURNEY_STAGES).toEqual(['CONTACTED', 'IDENTIFIED', 'CREDIT', 'INTERESTED', 'PURCHASED']);
    expect(Object.keys(STAGE_LABELS)).toEqual([...JOURNEY_STAGES]);
    expect(STAGE_LABELS.IDENTIFIED).toBe('ได้เบอร์ / ยืนยันตัวตน');
    expect(STAGE_LABELS.CREDIT).toBe('ตรวจเครดิต');
    expect(STAGE_LABELS.INTERESTED).toBe('นัด / จอง');
```

- [ ] **Step 3: Write the failing web strip test (order pin + fixtures in the new order)**

Replace the whole content of `apps/web/src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx` with:
```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STAGE_LABELS, type JourneyStage } from '@installment/shared';
import { formatDateShort } from '@/utils/formatters';
import JourneyStageStrip from '../components/JourneyStageStrip';
import { journeySummary, stageSteps } from './journeyFixtures';

// วันที่คำนวณด้วย formatter ตัวเดียวกับหน้าจอเสมอ — CI รันเป็น UTC
// ลำดับขั้น (เจ้าของสั่ง 2026-09-15 "ต้องเช็คเครดิตก่อนนัด"): ③ ตรวจเครดิต มาก่อน ④ นัด / จอง ⇒ วันที่ตัวอย่างเรียงตามนั้น
const AT = {
  CONTACTED: '2026-08-01T03:00:00.000Z',
  IDENTIFIED: '2026-08-02T03:00:00.000Z',
  CREDIT: '2026-08-20T03:00:00.000Z',
  INTERESTED: '2026-09-01T03:00:00.000Z',
  PURCHASED: '2026-09-05T03:00:00.000Z',
};

function stepItem(stage: JourneyStage) {
  const strip = screen.getByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
  return within(strip).getByText(STAGE_LABELS[stage]).closest('li');
}

describe('JourneyStageStrip', () => {
  it('ลำดับขั้น: ③ ตรวจเครดิต มาก่อน ④ นัด / จอง · เลขบนจุดตามตำแหน่ง (เจ้าของสั่ง 2026-09-15)', () => {
    render(<JourneyStageStrip summary={journeySummary()} />);
    const strip = screen.getByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
    const items = within(strip).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-stage'))).toEqual(['CONTACTED', 'IDENTIFIED', 'CREDIT', 'INTERESTED', 'PURCHASED']);
    expect(STAGE_LABELS.INTERESTED).toBe('นัด / จอง');
    expect(items[2]).toHaveTextContent('ตรวจเครดิต');
    expect(within(items[2]).getByText('3')).toBeInTheDocument();
    expect(items[3]).toHaveTextContent('นัด / จอง');
    expect(within(items[3]).getByText('4')).toBeInTheDocument();
  });

  it('ซื้อเงินสดโดยไม่ตรวจเครดิต: ขั้นตรวจเครดิตเป็น "ข้าม (เงินสด)" · ซื้อแล้วเป็นขั้นปัจจุบันไม่นับวันค้าง', () => {
    render(
      <JourneyStageStrip
        summary={journeySummary({
          stage: 'PURCHASED',
          path: 'CASH',
          daysInStage: 10,
          steps: stageSteps({ CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'skipped', INTERESTED: 'done', PURCHASED: 'current' }, AT),
        })}
      />,
    );
    expect(stepItem('CONTACTED')).toHaveAttribute('data-state', 'done');
    expect(stepItem('CONTACTED')).toHaveTextContent(formatDateShort(AT.CONTACTED));
    expect(stepItem('CREDIT')).toHaveAttribute('data-state', 'skipped');
    expect(stepItem('CREDIT')).toHaveTextContent('ข้าม (เงินสด)');
    expect(stepItem('INTERESTED')).toHaveTextContent(formatDateShort(AT.INTERESTED));
    expect(stepItem('PURCHASED')).toHaveAttribute('aria-current', 'step');
    expect(stepItem('PURCHASED')).not.toHaveTextContent('อยู่ขั้นนี้');
    expect(screen.queryByText(/^หลุด/)).toBeNull();
    expect(screen.queryByText(/^เงียบ/)).toBeNull();
  });

  it('พนักงานบันทึกนัดโดยยังไม่มีหลักฐานตรวจเครดิต: ขั้น 3 "ข้าม" · ขั้น 4 บอกวันค้าง + "พนักงานบันทึก" · ป้ายหลุดและเงียบ', () => {
    render(
      <JourneyStageStrip
        summary={journeySummary({
          stage: 'INTERESTED',
          daysInStage: 12,
          silentDays: 45,
          lost: { at: '2026-09-10T03:00:00.000Z', reason: 'BOUGHT_ELSEWHERE' },
          steps: stageSteps(
            { CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'skipped', INTERESTED: 'current', PURCHASED: 'todo' },
            AT,
            ['INTERESTED'],
          ),
        })}
      />,
    );
    expect(stepItem('INTERESTED')).toHaveAttribute('aria-current', 'step');
    expect(stepItem('INTERESTED')).toHaveTextContent(`${formatDateShort(AT.INTERESTED)} · อยู่ขั้นนี้ 12 วัน · พนักงานบันทึก`);
    expect(stepItem('CREDIT')).toHaveAttribute('data-state', 'skipped');
    expect(stepItem('CREDIT')).toHaveTextContent('ข้าม');
    expect(stepItem('CREDIT')).not.toHaveTextContent(formatDateShort(AT.CREDIT));
    expect(stepItem('PURCHASED')).toHaveTextContent('ยังไม่ถึง');
    expect(screen.getByText('หลุด · ซื้อที่อื่น')).toBeInTheDocument();
    expect(screen.getByText('เงียบ 45 วัน')).toBeInTheDocument();
  });

  it('เครดิตไม่ผ่าน → ขั้นตรวจเครดิตบอกไม่ผ่าน · ขั้นนัด / จอง ยังไม่ถึง · เงียบไม่เกิน 30 วันไม่ติดป้าย · รหัสหลุดที่ไม่รู้จักไม่แสดงค่าดิบ', () => {
    render(
      <JourneyStageStrip
        summary={journeySummary({
          stage: 'CREDIT',
          path: 'INSTALLMENT',
          daysInStage: 4,
          creditRejected: true,
          silentDays: 20,
          lost: { at: '2026-09-10T03:00:00.000Z', reason: 'SOMETHING_NEW' },
          steps: stageSteps({ CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'current', INTERESTED: 'todo', PURCHASED: 'todo' }, AT),
        })}
      />,
    );
    expect(stepItem('CREDIT')).toHaveTextContent(`${formatDateShort(AT.CREDIT)} · เครดิตไม่ผ่าน`);
    expect(stepItem('CREDIT')).not.toHaveTextContent('อยู่ขั้นนี้');
    expect(stepItem('INTERESTED')).toHaveAttribute('data-state', 'todo');
    expect(stepItem('INTERESTED')).toHaveTextContent('ยังไม่ถึง');
    expect(screen.queryByText(/^เงียบ/)).toBeNull();
    expect(screen.getByText('หลุด')).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_NEW/)).toBeNull();
  });
});
```

- [ ] **Step 4: Run shared + web tests — confirm they fail for the right reason**

Run:
```bash
cd packages/shared && npx vitest run src/customer-journey.spec.ts
cd ../../apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx
```
Expected:
- shared: 1 failed — `AssertionError: expected [ 'CONTACTED', 'IDENTIFIED', …(3) ] to deeply equal [ 'CONTACTED', 'IDENTIFIED', …(3) ]` in the first `it`.
- web: 1 failed (`ลำดับขั้น: ③ ตรวจเครดิต มาก่อน ④ นัด / จอง …` — `data-stage` array is `['CONTACTED','IDENTIFIED','INTERESTED','CREDIT','PURCHASED']`), 3 passed.

- [ ] **Step 5: Implement the shared order and label**

In `packages/shared/src/customer-journey.ts` replace this exact text:
```ts
/**
 * 5 ขั้นของเส้นทาง เรียงตามลำดับจริง — ขั้น 2 IDENTIFIED = ได้เบอร์/เลขบัตร · ผูก LINE · เป็นปลายทางของการรวม ไม่ใช่ "คุยแล้ว"
 * (prod: ข้อความพนักงานมี outbound_sent_at แค่ 1 ใน 74,514 ⇒ ขั้น "คุยแล้ว" ว่างเสมอ — คำตัดสิน OD-9 คงกติกา เปลี่ยนแค่ป้าย)
 */
export const JOURNEY_STAGES = ['CONTACTED', 'IDENTIFIED', 'INTERESTED', 'CREDIT', 'PURCHASED'] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** ป้ายไทยของแต่ละขั้น — แถบขั้นใต้หัวหน้ารายละเอียดลูกค้าใช้ชุดนี้ */
export const STAGE_LABELS: Record<JourneyStage, string> = {
  CONTACTED: 'ทักเข้ามา',
  IDENTIFIED: 'ได้เบอร์ / ยืนยันตัวตน',
  INTERESTED: 'สนใจจริง / นัด-จอง',
  CREDIT: 'ตรวจเครดิต',
  PURCHASED: 'ซื้อแล้ว',
};
```
with:
```ts
/**
 * 5 ขั้นของเส้นทาง เรียงตามลำดับจริง — ขั้น 2 IDENTIFIED = ได้เบอร์/เลขบัตร · ผูก LINE · เป็นปลายทางของการรวม ไม่ใช่ "คุยแล้ว"
 * (prod: ข้อความพนักงานมี outbound_sent_at แค่ 1 ใน 74,514 ⇒ ขั้น "คุยแล้ว" ว่างเสมอ — คำตัดสิน OD-9 คงกติกา เปลี่ยนแค่ป้าย)
 * ขั้น 3 CREDIT มาก่อนขั้น 4 INTERESTED "นัด / จอง" — เจ้าของสั่ง 2026-09-15 "ต้องเช็คเครดิตก่อนนัด" (ชื่อ enum เดิม ไม่มี migration)
 * ลำดับนี้คือแหล่งเดียว: CASE ของ stage ใน journey-state.sql และ UNBUY_FALLBACK_STAGES (journey-summary.builder.ts) ต้องตรงกัน — builder spec ปักไว้
 */
export const JOURNEY_STAGES = ['CONTACTED', 'IDENTIFIED', 'CREDIT', 'INTERESTED', 'PURCHASED'] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** ป้ายไทยของแต่ละขั้น — แถบขั้นใต้หัวหน้ารายละเอียดลูกค้าใช้ชุดนี้ · ลำดับคีย์ = JOURNEY_STAGES */
export const STAGE_LABELS: Record<JourneyStage, string> = {
  CONTACTED: 'ทักเข้ามา',
  IDENTIFIED: 'ได้เบอร์ / ยืนยันตัวตน',
  CREDIT: 'ตรวจเครดิต',
  INTERESTED: 'นัด / จอง',
  PURCHASED: 'ซื้อแล้ว',
};
```

- [ ] **Step 6: Run shared + web tests — pass; rebuild shared for the API**

Run:
```bash
cd packages/shared && npx vitest run src/customer-journey.spec.ts
cd ../../apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx && npx vitest run src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx
cd ../.. && npm run build --workspace=@installment/shared
```
Expected: shared spec all passed; web 4 passed under `TZ=UTC` and 4 passed under the machine default TZ; shared build exits 0 (the API reads `packages/shared/dist`, so later jest runs see the new order).

- [ ] **Step 7: Update the detail-page strip fixture to the new order**

In `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` replace this exact text (first `it` of `describe('การเดินทางของลูกค้า')`):
```tsx
        { CONTACTED: 'done', IDENTIFIED: 'done', INTERESTED: 'current', CREDIT: 'todo', PURCHASED: 'todo' },
```
with:
```tsx
        { CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'skipped', INTERESTED: 'current', PURCHASED: 'todo' },
```
and replace this exact text:
```tsx
    expect(current).toHaveTextContent(`${formatDateShort('2026-09-12T03:00:00.000Z')} · อยู่ขั้นนี้ 3 วัน`);
```
with:
```tsx
    expect(current).toHaveTextContent(`${formatDateShort('2026-09-12T03:00:00.000Z')} · อยู่ขั้นนี้ 3 วัน`);
    // ③ ตรวจเครดิต มาก่อน ④ นัด / จอง — ผู้สนใจที่มีนัดแต่ไม่มีหลักฐานตรวจเครดิต ขั้น 3 ถูกข้าม
    expect(within(strip).getByText(STAGE_LABELS.CREDIT).closest('li')).toHaveAttribute('data-state', 'skipped');
```

Run:
```bash
cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx && npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx
```
Expected: all tests in the file pass under both TZs.

- [ ] **Step 8: Write the failing builder spec (order, skipped rule, un-buy fallback, SQL pin)**

In `apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts`:

(a) Insert these two lines as the very first lines of the file (above `import { JOURNEY_STAGES, STAGE_LABELS } from '@installment/shared';`):
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
```

(b) Replace this exact text:
```ts
  withLiveBought,
  type JourneyStateRow,
```
with:
```ts
  UNBUY_FALLBACK_STAGES,
  withLiveBought,
  type JourneyStateRow,
```

(c) Replace this exact text:
```ts
  it('ขั้น CREDIT: ก่อนหน้ามีเวลา=done ไม่มีเวลา=skipped · ถัดไป=todo · ค้างขั้น/เงียบเป็นวันเต็ม', () => {
    const s = buildJourneySummary(row(), extras, NOW);
    expect(s.steps.map((x) => [x.stage, x.state])).toEqual([
      ['CONTACTED', 'done'], ['IDENTIFIED', 'done'], ['INTERESTED', 'skipped'], ['CREDIT', 'current'], ['PURCHASED', 'todo'],
    ]);
```
with:
```ts
  it('ขั้น CREDIT (③): ก่อนหน้ามีเวลา=done · ถัดไป (④ นัด / จอง, ⑤) = todo ไม่มีวันที่ · ค้างขั้น/เงียบเป็นวันเต็ม', () => {
    const s = buildJourneySummary(row(), extras, NOW);
    expect(s.steps.map((x) => [x.stage, x.state, x.at])).toEqual([
      ['CONTACTED', 'done', '2026-09-01T05:00:00.000Z'], ['IDENTIFIED', 'done', '2026-09-03T05:00:00.000Z'],
      ['CREDIT', 'current', '2026-09-10T05:00:00.000Z'], ['INTERESTED', 'todo', null], ['PURCHASED', 'todo', null],
    ]);
```

(d) Replace this exact text:
```ts
  it('หลักฐานขั้นสนใจมาจากบันทึกมือ → MANUAL เฉพาะขั้นนั้น · ป้ายหลุดมีเหตุผล', () => {
```
with:
```ts
  it('นัด / จอง จากบันทึกมือโดยไม่มีหลักฐานตรวจเครดิต → ③ skipped · ④ current + MANUAL เฉพาะขั้นนั้น · ป้ายหลุดมีเหตุผล', () => {
```
and replace this exact text:
```ts
    expect(s.steps.filter((x) => x.evidence === 'MANUAL').map((x) => x.stage)).toEqual(['INTERESTED']);
```
with:
```ts
    expect(s.steps.map((x) => [x.stage, x.state])).toEqual([
      ['CONTACTED', 'done'], ['IDENTIFIED', 'done'], ['CREDIT', 'skipped'], ['INTERESTED', 'current'], ['PURCHASED', 'todo'],
    ]);
    expect(s.steps.filter((x) => x.evidence === 'MANUAL').map((x) => x.stage)).toEqual(['INTERESTED']);
```

(e) Replace this exact text:
```ts
      ['CONTACTED', 'current', '2026-09-01T05:00:00.000Z'], ['IDENTIFIED', 'todo', null], ['INTERESTED', 'todo', null],
      ['CREDIT', 'todo', null], ['PURCHASED', 'todo', null],
```
with:
```ts
      ['CONTACTED', 'current', '2026-09-01T05:00:00.000Z'], ['IDENTIFIED', 'todo', null], ['CREDIT', 'todo', null],
      ['INTERESTED', 'todo', null], ['PURCHASED', 'todo', null],
```

(f) Insert this block immediately above the line `describe('withLiveBought', () => {`:
```ts
describe('ลำดับขั้น ③ ตรวจเครดิต → ④ นัด / จอง (เจ้าของสั่ง 2026-09-15)', () => {
  it('JOURNEY_STAGES + STAGE_LABELS เรียงใหม่ · ขั้น 4 ชื่อ "นัด / จอง" (spec ของ shared ไม่รันใน CI จึงปักซ้ำที่นี่)', () => {
    expect(JOURNEY_STAGES).toEqual(['CONTACTED', 'IDENTIFIED', 'CREDIT', 'INTERESTED', 'PURCHASED']);
    expect(Object.keys(STAGE_LABELS)).toEqual([...JOURNEY_STAGES]);
    expect(STAGE_LABELS.CREDIT).toBe('ตรวจเครดิต');
    expect(STAGE_LABELS.INTERESTED).toBe('นัด / จอง');
  });

  it('มีทั้งใบตรวจเครดิตและนัด → ขั้นปัจจุบัน นัด / จอง · ตรวจเครดิต done พร้อมวันที่ แม้ตรวจทีหลังนัด (วันที่บนแถบไม่เรียงได้)', () => {
    const s = buildJourneySummary(
      row({
        stage: 'INTERESTED',
        stageEnteredAt: d('2026-09-05T05:00:00.000Z'),
        interestedAt: d('2026-09-05T05:00:00.000Z'),
        creditAt: d('2026-09-10T05:00:00.000Z'),
      }),
      extras,
      NOW,
    );
    expect(s.steps.map((x) => [x.stage, x.state, x.at])).toEqual([
      ['CONTACTED', 'done', '2026-09-01T05:00:00.000Z'], ['IDENTIFIED', 'done', '2026-09-03T05:00:00.000Z'],
      ['CREDIT', 'done', '2026-09-10T05:00:00.000Z'], ['INTERESTED', 'current', '2026-09-05T05:00:00.000Z'], ['PURCHASED', 'todo', null],
    ]);
    expect(s).toMatchObject({ stage: 'INTERESTED', stageLabel: 'นัด / จอง', daysInStage: 10 });
  });

  it('ใบจอง/นัดอย่างเดียว ไม่มีหลักฐานตรวจเครดิต → ขั้นตรวจเครดิต skipped ไม่มีวันที่ · นัด / จอง current', () => {
    const s = buildJourneySummary(
      row({
        stage: 'INTERESTED',
        path: 'UNKNOWN',
        stageEnteredAt: d('2026-09-08T05:00:00.000Z'),
        interestedAt: d('2026-09-08T05:00:00.000Z'),
        creditAt: null,
      }),
      extras,
      NOW,
    );
    expect(s.steps.find((x) => x.stage === 'CREDIT')).toMatchObject({ state: 'skipped', at: null, evidence: 'SYSTEM' });
    expect(s.steps.find((x) => x.stage === 'INTERESTED')).toMatchObject({ state: 'current', at: '2026-09-08T05:00:00.000Z' });
  });

  it('journey-state.sql จัดอันดับ stage ตรงกับ JOURNEY_STAGES (สูง → ต่ำ) และ UNBUY_FALLBACK_STAGES — ห้ามเขียนลำดับแยกกัน', () => {
    const sql = readFileSync(join(__dirname, 'sql', 'journey-state.sql'), 'utf8');
    const stageCase = /CASE WHEN s\.bought THEN 'PURCHASED'([\s\S]*?)ELSE 'CONTACTED' END AS stage/.exec(sql);
    expect(stageCase).not.toBeNull();
    const ranked = [...(stageCase?.[1] ?? '').matchAll(/THEN '([A-Z]+)'/g)].map((match) => match[1]);
    expect(ranked).toEqual([...UNBUY_FALLBACK_STAGES]);
    expect(['PURCHASED', ...ranked, 'CONTACTED']).toEqual([...JOURNEY_STAGES].reverse());
  });
});

```

(g) Replace this exact text (inside `describe('withLiveBought')`):
```ts
  it('แคชซื้อแล้วแต่ยกเลิกใบขายจน BOUGHT เป็นเท็จ → ถอยไปขั้นสูงสุดที่มีเวลา ล้าง firstPurchaseAt', () => {
    const r = withLiveBought(row({ stage: 'PURCHASED', firstPurchaseAt: d('2026-09-14T05:00:00.000Z') }), false, NOW);
    expect(r).toMatchObject({ stage: 'CREDIT', stageEnteredAt: d('2026-09-10T05:00:00.000Z'), firstPurchaseAt: null });
  });
```
with:
```ts
  it('แคชซื้อแล้วแต่ยกเลิกใบขายจน BOUGHT เป็นเท็จ → ถอยไปขั้นสูงสุดที่มีเวลา ตามลำดับ นัด / จอง → ตรวจเครดิต → ได้เบอร์ → ทักเข้ามา · ล้าง firstPurchaseAt', () => {
    const bought: Partial<JourneyStateRow> = { stage: 'PURCHASED', firstPurchaseAt: d('2026-09-14T05:00:00.000Z') };
    const cases: Array<[Partial<JourneyStateRow>, string, string]> = [
      [{ interestedAt: d('2026-09-05T05:00:00.000Z'), creditAt: d('2026-09-10T05:00:00.000Z') }, 'INTERESTED', '2026-09-05T05:00:00.000Z'],
      [{ interestedAt: null, creditAt: d('2026-09-10T05:00:00.000Z') }, 'CREDIT', '2026-09-10T05:00:00.000Z'],
      [{ interestedAt: null, creditAt: null }, 'IDENTIFIED', '2026-09-03T05:00:00.000Z'],
      [{ interestedAt: null, creditAt: null, identifiedAt: null }, 'CONTACTED', '2026-09-01T05:00:00.000Z'],
    ];
    for (const [over, stage, enteredAt] of cases) {
      const r = withLiveBought(row({ ...bought, ...over }), false, NOW);
      expect({ stage: r.stage, stageEnteredAt: r.stageEnteredAt.toISOString(), firstPurchaseAt: r.firstPurchaseAt }).toEqual({
        stage,
        stageEnteredAt: enteredAt,
        firstPurchaseAt: null,
      });
    }
  });
  it('ลำดับถอยกลับมาจาก JOURNEY_STAGES กลับด้าน ไม่รวมซื้อแล้ว/ทักเข้ามา — เปลี่ยนลำดับขั้นที่ shared ที่เดียว', () => {
    expect(UNBUY_FALLBACK_STAGES).toEqual(['INTERESTED', 'CREDIT', 'IDENTIFIED']);
  });
```

- [ ] **Step 9: Run the builder spec — confirm it fails**

Run:
```bash
cd apps/api && npx jest src/modules/customer-journey/journey-summary.builder.spec.ts --runInBand
```
Expected: `Test suite failed to run` with TS2305 `Module '"./journey-summary.builder"' has no exported member 'UNBUY_FALLBACK_STAGES'`.

- [ ] **Step 10: Implement `UNBUY_FALLBACK_STAGES` and use it in `withLiveBought`**

In `apps/api/src/modules/customer-journey/journey-summary.builder.ts` replace this exact text:
```ts
/** แคชอาจตามไม่ทัน (recompute ล้ม) — ขั้นซื้อแล้วต้องตรงกับ BOUGHT_WHERE สดเสมอ */
export function withLiveBought(state: JourneyStateRow, bought: boolean, now: Date): JourneyStateRow {
  if (bought === (state.stage === 'PURCHASED')) return state;
  if (bought) return { ...state, stage: 'PURCHASED', stageEnteredAt: state.firstPurchaseAt ?? now };
  const times = stageTimes(state);
  const fallback = (['CREDIT', 'INTERESTED', 'IDENTIFIED'] as const).find((stage) => times[stage] !== null);
```
with:
```ts
type UnbuyFallbackStage = Exclude<JourneyStage, 'PURCHASED' | 'CONTACTED'>;

/**
 * ขั้นที่ถอยกลับได้เมื่อการซื้อถูกยกเลิก เรียงสูง → ต่ำ — คำนวณจาก JOURNEY_STAGES (ห้ามเขียนลำดับซ้ำ)
 * = ['INTERESTED', 'CREDIT', 'IDENTIFIED'] ตามเจ้าของสั่ง 2026-09-15 (③ ตรวจเครดิต มาก่อน ④ นัด / จอง)
 * ต้องตรงกับ CASE ของ stage ใน journey-state.sql (CTE resolved) — journey-summary.builder.spec.ts อ่านไฟล์ SQL ปักไว้
 */
export const UNBUY_FALLBACK_STAGES: readonly UnbuyFallbackStage[] = [...JOURNEY_STAGES]
  .reverse()
  .filter((stage): stage is UnbuyFallbackStage => stage !== 'PURCHASED' && stage !== 'CONTACTED');

/** แคชอาจตามไม่ทัน (recompute ล้ม) — ขั้นซื้อแล้วต้องตรงกับ BOUGHT_WHERE สดเสมอ */
export function withLiveBought(state: JourneyStateRow, bought: boolean, now: Date): JourneyStateRow {
  if (bought === (state.stage === 'PURCHASED')) return state;
  if (bought) return { ...state, stage: 'PURCHASED', stageEnteredAt: state.firstPurchaseAt ?? now };
  const times = stageTimes(state);
  const fallback = UNBUY_FALLBACK_STAGES.find((stage) => times[stage] !== null);
```
(The rest of `withLiveBought` — the `return { ...state, stage: fallback ?? 'CONTACTED', … }` block — stays as is.)

- [ ] **Step 11: Run the builder spec — only the SQL pin still fails**

Run:
```bash
cd apps/api && npx jest src/modules/customer-journey/journey-summary.builder.spec.ts --runInBand
```
Expected: 1 failed — `journey-state.sql จัดอันดับ stage ตรงกับ JOURNEY_STAGES …` with `Expected: ["INTERESTED", "CREDIT", "IDENTIFIED"]` / `Received: ["CREDIT", "INTERESTED", "IDENTIFIED"]`; every other test passes.

- [ ] **Step 12: Write the failing real-DB stage-order spec**

Create `apps/api/src/modules/customer-journey/journey-state.stage-order.db.spec.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { JourneyStateService } from './journey-state.service';
import { withLiveBought } from './journey-summary.builder';

/**
 * ลำดับขั้นกับ Postgres จริง — ③ ตรวจเครดิต มาก่อน ④ นัด / จอง (เจ้าของสั่ง 2026-09-15 "ต้องเช็คเครดิตก่อนนัด")
 * ขั้นปัจจุบัน = ขั้นสูงสุดที่มีหลักฐานตาม JOURNEY_STAGES ไม่ใช่หลักฐานล่าสุดตามเวลา · stage_entered_at = เวลาของขั้นนั้นเอง
 * CI รัน UTC · เครื่อง dev รัน Asia/Bangkok ⇒ ใช้เวลา ISO ที่ลงท้าย Z เท่านั้น ห้ามสตริงเวลาท้องถิ่น
 * audit_logs ลบไม่ได้ (trigger audit_logs_no_delete) ⇒ ผู้ใช้/สาขาของ spec ถูกปล่อยไว้ ตามแบบ journey-state.service.db.spec.ts
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('JourneyStateService — ลำดับขั้น ตรวจเครดิต → นัด / จอง (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const iso = (value: Date | null) => (value ? value.toISOString() : null);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const todoIds: string[] = [];
  const saleIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;

  const stateOf = (customerId: string) => prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId } });

  async function customer(label: string) {
    const row = await prisma.customer.create({ data: { name: `journey order ${label}`, phone: null, createdAt: at('2026-09-01T00:00:00.000Z') } });
    customerIds.push(row.id);
    return row;
  }
  /** นัดในห้องแชท (todo ที่มี due_date) = หลักฐานขั้น 4 นัด / จอง */
  async function appointment(customerId: string, label: string, createdAt: string) {
    const room = await prisma.chatRoom.create({
      data: { channel: 'FACEBOOK', externalUserId: `journey-order-${label}-${stamp}`, customerId, createdAt: at('2026-09-01T01:00:00.000Z') },
    });
    roomIds.push(room.id);
    const todo = await prisma.todo.create({
      data: { title: 'นัดดูเครื่อง', createdById: userId, roomId: room.id, dueDate: at('2026-09-20T03:00:00.000Z'), createdAt: at(createdAt) },
    });
    todoIds.push(todo.id);
  }
  /** ใบตรวจเครดิต = หลักฐานขั้น 3 ตรวจเครดิต (ตั้ง path INSTALLMENT) */
  async function creditCheck(customerId: string, createdAt: string) {
    await prisma.creditCheck.create({ data: { customerId, createdAt: at(createdAt) } });
  }
  async function cashSale(customerId: string, createdAt: string) {
    const row = await prisma.sale.create({
      data: {
        saleNumber: `JSO-${tail}-${saleIds.length}`, saleType: 'CASH', customerId, productId, branchId, salespersonId: userId,
        sellingPrice: 25000, netAmount: 25000, createdAt: at(createdAt),
      },
    });
    saleIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey order spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-order-${stamp}@spec.local`, password: 'x', name: 'journey order spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey order phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
  });

  afterAll(async () => {
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.todo.deleteMany({ where: { id: { in: todoIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('นัดก่อน ตรวจเครดิตทีหลัง → ขั้น นัด / จอง (INTERESTED) · stage_entered_at = เวลานัด · path INSTALLMENT', async () => {
    const c = await customer('appoint-first');
    await appointment(c.id, 'appoint-first', '2026-09-02T00:00:00.000Z');
    await creditCheck(c.id, '2026-09-03T00:00:00.000Z');
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect({ stage: s.stage, path: s.path, interestedAt: iso(s.interestedAt), creditAt: iso(s.creditAt), stageEnteredAt: iso(s.stageEnteredAt) }).toEqual({
      stage: 'INTERESTED',
      path: 'INSTALLMENT',
      interestedAt: '2026-09-02T00:00:00.000Z',
      creditAt: '2026-09-03T00:00:00.000Z',
      stageEnteredAt: '2026-09-02T00:00:00.000Z',
    });
  });

  it('ตรวจเครดิตก่อน นัดทีหลัง → ขั้น นัด / จอง · stage_entered_at = เวลานัด (ไม่ใช่เวลาตรวจเครดิตที่เก่ากว่า)', async () => {
    const c = await customer('credit-first');
    await creditCheck(c.id, '2026-09-02T00:00:00.000Z');
    await appointment(c.id, 'credit-first', '2026-09-05T00:00:00.000Z');
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect({ stage: s.stage, path: s.path, creditAt: iso(s.creditAt), stageEnteredAt: iso(s.stageEnteredAt) }).toEqual({
      stage: 'INTERESTED',
      path: 'INSTALLMENT',
      creditAt: '2026-09-02T00:00:00.000Z',
      stageEnteredAt: '2026-09-05T00:00:00.000Z',
    });
  });

  it('ตรวจเครดิตอย่างเดียว → ขั้น ตรวจเครดิต (CREDIT) · นัดที่ตามมาทีหลัง → ขยับขึ้น นัด / จอง ในการคำนวณครั้งถัดไป', async () => {
    const c = await customer('credit-only');
    await creditCheck(c.id, '2026-09-03T00:00:00.000Z');
    await service.recompute([c.id]);
    const credit = await stateOf(c.id);
    expect({ stage: credit.stage, path: credit.path, interestedAt: iso(credit.interestedAt), stageEnteredAt: iso(credit.stageEnteredAt) }).toEqual({
      stage: 'CREDIT',
      path: 'INSTALLMENT',
      interestedAt: null,
      stageEnteredAt: '2026-09-03T00:00:00.000Z',
    });

    await appointment(c.id, 'credit-only', '2026-09-06T00:00:00.000Z');
    await service.recompute([c.id]);
    const moved = await stateOf(c.id);
    expect({ stage: moved.stage, stageEnteredAt: iso(moved.stageEnteredAt) }).toEqual({ stage: 'INTERESTED', stageEnteredAt: '2026-09-06T00:00:00.000Z' });
  });

  it('นัดอย่างเดียว → ขั้น นัด / จอง · ไม่มีเวลาตรวจเครดิต (แถบวาดขั้น 3 เป็น "ข้าม") · path UNKNOWN', async () => {
    const c = await customer('appoint-only');
    await appointment(c.id, 'appoint-only', '2026-09-02T00:00:00.000Z');
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect({ stage: s.stage, path: s.path, creditAt: iso(s.creditAt), stageEnteredAt: iso(s.stageEnteredAt) }).toEqual({
      stage: 'INTERESTED',
      path: 'UNKNOWN',
      creditAt: null,
      stageEnteredAt: '2026-09-02T00:00:00.000Z',
    });
  });

  it('ยกเลิกใบขายใบเดียว → ถอยไป นัด / จอง ทั้งทาง withLiveBought (แคชยังเป็น PURCHASED) และทาง SQL', async () => {
    const c = await customer('unbuy');
    await appointment(c.id, 'unbuy', '2026-09-02T00:00:00.000Z');
    await creditCheck(c.id, '2026-09-03T00:00:00.000Z');
    const sale = await cashSale(c.id, '2026-09-04T00:00:00.000Z');
    await service.recompute([c.id]);
    const bought = await stateOf(c.id);
    expect({ stage: bought.stage, path: bought.path, firstPurchaseAt: iso(bought.firstPurchaseAt) }).toEqual({
      stage: 'PURCHASED',
      path: 'CASH',
      firstPurchaseAt: '2026-09-04T00:00:00.000Z',
    });

    await prisma.sale.update({ where: { id: sale.id }, data: { deletedAt: at('2026-09-05T00:00:00.000Z') } });
    const live = withLiveBought(bought, false, at('2026-09-06T00:00:00.000Z'));
    expect({ stage: live.stage, stageEnteredAt: iso(live.stageEnteredAt), firstPurchaseAt: live.firstPurchaseAt }).toEqual({
      stage: 'INTERESTED',
      stageEnteredAt: '2026-09-02T00:00:00.000Z',
      firstPurchaseAt: null,
    });

    await service.recompute([c.id]);
    const back = await stateOf(c.id);
    expect({
      stage: back.stage, path: back.path, stageEnteredAt: iso(back.stageEnteredAt), firstPurchaseAt: iso(back.firstPurchaseAt), firstPurchaseKind: back.firstPurchaseKind,
    }).toEqual({ stage: 'INTERESTED', path: 'INSTALLMENT', stageEnteredAt: '2026-09-02T00:00:00.000Z', firstPurchaseAt: null, firstPurchaseKind: null });
  });
});
```

- [ ] **Step 13: Run the new DB spec — confirm it fails on the SQL rank**

Run:
```bash
cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.stage-order.db.spec.ts --runInBand
```
Expected: 4 failed, 1 passed. The failures show `stage: "CREDIT"` where `"INTERESTED"` is expected (appoint-first, credit-first, credit-only second half, unbuy SQL half; the unbuy `withLiveBought` assertion already passes). The appointment-only case passes.

- [ ] **Step 14: Implement the SQL stage rank (`resolved` CTE)**

In `apps/api/src/modules/customer-journey/sql/journey-state.sql`, inside CTE `resolved`, replace this exact text:
```sql
         CASE WHEN s.bought THEN 'PURCHASED'
              WHEN s.credit_at IS NOT NULL THEN 'CREDIT'
              WHEN s.interested_at IS NOT NULL THEN 'INTERESTED'
              WHEN s.identified_at IS NOT NULL THEN 'IDENTIFIED'
              ELSE 'CONTACTED' END AS stage,
```
with:
```sql
         -- ขั้น = ขั้นสูงสุดที่มีหลักฐาน เรียงตาม JOURNEY_STAGES (@installment/shared) จากท้ายมาหน้า — ไม่ใช่หลักฐานล่าสุดตามเวลา
         -- ③ ตรวจเครดิต มาก่อน ④ นัด / จอง (เจ้าของสั่ง 2026-09-15) · UNBUY_FALLBACK_STAGES ใน journey-summary.builder.ts ใช้ลำดับเดียวกัน
         -- (builder spec อ่านไฟล์นี้ปักไว้) · stage_entered_at = เวลาของขั้นนั้นเอง ⇒ วันที่บนแถบอาจไม่เรียง (ใบจองก่อน ตรวจเครดิตทีหลัง)
         CASE WHEN s.bought THEN 'PURCHASED'
              WHEN s.interested_at IS NOT NULL THEN 'INTERESTED'
              WHEN s.credit_at IS NOT NULL THEN 'CREDIT'
              WHEN s.identified_at IS NOT NULL THEN 'IDENTIFIED'
              ELSE 'CONTACTED' END AS stage,
```
Do not touch the `path` CASE, the `lost_at` CASE, or the `INSERT … stage_entered_at` CASE.

- [ ] **Step 15: Run builder spec + new DB spec — pass (both TZ)**

Run:
```bash
cd apps/api && npx jest src/modules/customer-journey/journey-summary.builder.spec.ts --runInBand
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.stage-order.db.spec.ts --runInBand
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=UTC NODE_ENV=test npx jest src/modules/customer-journey/journey-state.stage-order.db.spec.ts --runInBand
```
Expected: builder spec all passed (including the SQL pin); DB spec 5 passed under both TZ values.

- [ ] **Step 16: Run the existing journey DB specs — see exactly the two old-order expectations go red**

Run:
```bash
cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.service.db.spec.ts src/modules/customer-journey/journey-summary.service.db.spec.ts --runInBand
```
Expected: 2 failed — `journey-state.service.db.spec.ts` case `นัด (todo ในห้อง) → INTERESTED · ใบตรวจเครดิต → CREDIT/INSTALLMENT …` (received `stage: "INTERESTED"`), and `journey-summary.service.db.spec.ts` case `ผู้จัดการตีตกเครดิตล่าสุด → creditRejected · นัดจากบันทึกมือ → evidence MANUAL` (received `stage: "INTERESTED"`). Everything else passes (including all `ร้านตอบครั้งแรก` cases).

- [ ] **Step 17: Update the state DB spec's todo + credit-check case**

In `apps/api/src/modules/customer-journey/journey-state.service.db.spec.ts` replace this exact text:
```ts
  it('นัด (todo ในห้อง) → INTERESTED · ใบตรวจเครดิต → CREDIT/INSTALLMENT · ใบขายสด → PURCHASED/CASH ตรงกับ BOUGHT_WHERE · ยกเลิกใบขาย → ถอยกลับ', async () => {
```
with:
```ts
  it('นัด (todo ในห้อง) + ใบตรวจเครดิต → INTERESTED/INSTALLMENT (③ ตรวจเครดิต มาก่อน ④ นัด / จอง) · ใบขายสด → PURCHASED/CASH ตรงกับ BOUGHT_WHERE · ยกเลิกใบขาย → ถอยกลับ INTERESTED', async () => {
```
replace this exact text:
```ts
    const credit = await stateOf(c.id);
    expect(credit).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT' });
    expect(credit.interestedAt?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(credit.stageEnteredAt.toISOString()).toBe('2026-09-03T00:00:00.000Z');
```
with:
```ts
    const interested = await stateOf(c.id);
    expect(interested).toMatchObject({ stage: 'INTERESTED', path: 'INSTALLMENT' });
    expect(interested.interestedAt?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(interested.creditAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    expect(interested.stageEnteredAt.toISOString()).toBe('2026-09-02T00:00:00.000Z');
```
and replace this exact text:
```ts
    expect(await stateOf(c.id)).toMatchObject({ stage: 'CREDIT', firstPurchaseAt: null, firstPurchaseKind: null, path: 'INSTALLMENT' });
```
with:
```ts
    expect(await stateOf(c.id)).toMatchObject({ stage: 'INTERESTED', firstPurchaseAt: null, firstPurchaseKind: null, path: 'INSTALLMENT' });
```

- [ ] **Step 18: Update the summary DB spec's credit + manual APPOINTED case**

In `apps/api/src/modules/customer-journey/journey-summary.service.db.spec.ts` replace this exact text:
```ts
  it('ผู้จัดการตีตกเครดิตล่าสุด → creditRejected · นัดจากบันทึกมือ → evidence MANUAL', async () => {
```
with:
```ts
  it('ผู้จัดการตีตกเครดิตล่าสุด + นัดจากบันทึกมือ → ขั้นปัจจุบัน นัด / จอง (evidence MANUAL) · ขั้นตรวจเครดิต done แต่ creditRejected ยังจริง (แถบวาดแดง)', async () => {
```
and replace this exact text:
```ts
    expect(res).toMatchObject({ stage: 'CREDIT', creditRejected: true });
    if (!('steps' in res)) throw new Error('คาดว่าเป็น JourneySummary');
    expect(res.steps.find((s) => s.stage === 'INTERESTED')).toMatchObject({ state: 'done', evidence: 'MANUAL' });
```
with:
```ts
    expect(res).toMatchObject({ stage: 'INTERESTED', stageLabel: STAGE_LABELS.INTERESTED, creditRejected: true });
    if (!('steps' in res)) throw new Error('คาดว่าเป็น JourneySummary');
    expect(res.steps.find((s) => s.stage === 'CREDIT')).toMatchObject({ state: 'done', evidence: 'SYSTEM' });
    expect(res.steps.find((s) => s.stage === 'INTERESTED')).toMatchObject({ state: 'current', evidence: 'MANUAL' });
```

- [ ] **Step 19: Run every DB spec that reads journey state or merge — pass**

Run:
```bash
cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey src/modules/chat-prospects/customer-merge.service src/cli/backfill-customer-journey src/modules/pdpa/pdpa-dsar-journey.db.spec.ts --runInBand
```
Expected: all suites pass (customer-journey unit + DB specs, `customer-merge.service.spec.ts`, `customer-merge.service.db.spec.ts`, backfill CLI specs, DSAR journey spec). If `customer-journey.service.spec.ts` is still unchanged it passes here too.

- [ ] **Step 20: Write the failing not-recorded wording test**

In `apps/api/src/modules/customer-journey/customer-journey.service.spec.ts` replace this exact text:
```ts
import { CustomerJourneyService, JOURNEY_COUNT_CAP, countJourneyGroups, resolveJourneyGroups } from './customer-journey.service';
```
with:
```ts
import { CustomerJourneyService, JOURNEY_COUNT_CAP, JOURNEY_NOT_RECORDED, countJourneyGroups, resolveJourneyGroups } from './customer-journey.service';
```
and append at the end of the file:
```ts

describe('JOURNEY_NOT_RECORDED — ชื่อขั้น 4 ใหม่ (เจ้าของสั่ง 2026-09-15)', () => {
  it('ไม่มีคำว่า "สนใจจริง" แล้ว · เอกสาร 3 ชนิดที่ใช้นับขั้นแต่ยังไม่แสดงเป็นเหตุการณ์อ้างชื่อขั้น "นัด / จอง"', () => {
    expect(JOURNEY_NOT_RECORDED.filter((line) => line.includes('สนใจจริง'))).toEqual([]);
    expect(JOURNEY_NOT_RECORDED.filter((line) => line.includes('ขั้น "นัด / จอง"'))).toHaveLength(3);
  });
});
```

Run:
```bash
cd apps/api && npx jest src/modules/customer-journey/customer-journey.service.spec.ts --runInBand
```
Expected: 1 failed — `expect(received).toEqual(expected)` listing the 3 lines that contain `สนใจจริง`.

- [ ] **Step 21: Relabel `JOURNEY_NOT_RECORDED`**

In `apps/api/src/modules/customer-journey/customer-journey.service.ts` replace this exact text:
```ts
  // ขั้น "สนใจจริง / นัด-จอง" บนแถบนับจากสามอย่างนี้ด้วย แต่ยังไม่ขึ้นเป็นเหตุการณ์ในแท็บ
  'การจองสินค้าผ่านเว็บ (ใช้นับขั้น "สนใจจริง" แต่ยังไม่แสดงเป็นเหตุการณ์)',
  'ใบสมัครผ่อนออนไลน์ (ใช้นับขั้น "สนใจจริง" แต่ยังไม่แสดงเป็นเหตุการณ์)',
  'รายการรับซื้อ/เทิร์นเครื่อง (ใช้นับขั้น "สนใจจริง" แต่ยังไม่แสดงเป็นเหตุการณ์)',
```
with:
```ts
  // ขั้น 4 "นัด / จอง" บนแถบนับจากสามอย่างนี้ด้วย แต่ยังไม่ขึ้นเป็นเหตุการณ์ในแท็บ
  'การจองสินค้าผ่านเว็บ (ใช้นับขั้น "นัด / จอง" แต่ยังไม่แสดงเป็นเหตุการณ์)',
  'ใบสมัครผ่อนออนไลน์ (ใช้นับขั้น "นัด / จอง" แต่ยังไม่แสดงเป็นเหตุการณ์)',
  'รายการรับซื้อ/เทิร์นเครื่อง (ใช้นับขั้น "นัด / จอง" แต่ยังไม่แสดงเป็นเหตุการณ์)',
```

Run:
```bash
cd apps/api && npx jest src/modules/customer-journey/customer-journey.service.spec.ts --runInBand
```
Expected: all passed.

- [ ] **Step 22: Update the spec document (stage sections, data-model comment, event table)**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md`:

(a) Replace this exact text:
```
  stage             String    @db.VarChar(12)   // CONTACTED|IDENTIFIED|INTERESTED|CREDIT|PURCHASED
```
with:
```
  stage             String    @db.VarChar(12)   // CONTACTED|IDENTIFIED|CREDIT|INTERESTED|PURCHASED (ลำดับขั้น — ตรวจเครดิตก่อนนัด / จอง เจ้าของสั่ง 2026-09-15)
```

(b) Replace the whole block from the line `### 3 สนใจจริง / นัด-จอง (INTERESTED)` down to and including the line `ตั้งด้วยมือไม่ได้` that sits directly above `### 5 ซื้อแล้ว (PURCHASED)` — i.e. this exact text:
```
### 3 สนใจจริง / นัด-จอง (INTERESTED)

เวลาเข้าขั้น = MIN ของ:
- bookings.created_at
- todos.created_at ที่ room_id อยู่ในห้องของลูกค้าและ due_date ไม่ null
- audit AI_LEAD_CAPTURED ที่ entity_id อยู่ใน ids
- online_installment_applications.created_at
- product_reservations.reserved_at (customer_id)
- trade_ins.created_at (customer_id)
- entry MANUAL TOUCHPOINT outcome APPOINTED/VISITED (แถบขั้นติดป้ายเล็ก 'พนักงานบันทึก')

เป็นขั้นเดียวที่บันทึกมือนับเป็นหลักฐานได้ เพราะทีมนัดลูกค้าในแอป FB ซึ่งระบบไม่เห็น

### 4 ตรวจเครดิต (CREDIT) — เฉพาะผ่อนกับร้าน

เวลาเข้าขั้น = MIN ของ:
- credit_checks.created_at (customer_id อยู่ใน ids; แถวที่นำเข้าจากแชทมี created_at ย้อนเป็นเวลา OCR = approximate)
- room_credit_analyses.created_at status COMPLETED บนห้องของลูกค้า
- contracts.created_at (deleted_at null)

ตั้ง path=INSTALLMENT

ถ้าผู้จัดการตัดสินล่าสุด (audit CREDIT_CHECK_OVERRIDE) เป็น REJECTED และยังไม่ซื้อ ⇒ ธง 'เครดิตไม่ผ่าน' ขั้นเป็นสีแดง

คนที่ซื้อเงินสดหรือไฟแนนซ์นอกโดยไม่มีใบตรวจ ⇒ แถบแสดง 'ข้าม (เงินสด/ไฟแนนซ์นอก)' ไม่นับว่าค้าง

ตั้งด้วยมือไม่ได้
```
with:
```
> **ลำดับขั้น 3–4 (เจ้าของสั่ง 2026-09-15 "ต้องเช็คเครดิตก่อนนัด" · scope v2 ข้อ 11):** ขั้น 3 = ตรวจเครดิต · ขั้น 4 = นัด / จอง
> - ชื่อ enum เดิม (`CREDIT` / `INTERESTED`) ไม่มี migration แต่ค่า `stage` ในแคชเปลี่ยนความหมาย ⇒ ขึ้น prod แล้วต้องคำนวณแคชใหม่ทั้งหมด (`docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md`)
> - ขั้นปัจจุบัน = ขั้นสูงสุดที่มีหลักฐานตามลำดับนี้ ไม่ใช่หลักฐานล่าสุดตามเวลา · เวลาเข้าขั้น = เวลาของขั้นนั้นเอง ⇒ วันที่บนแถบอาจไม่เรียง (ใบจองก่อน ตรวจเครดิตทีหลัง = ขั้นปัจจุบันยังเป็นขั้น 4 และขั้น 3 ได้วันที่ที่ใหม่กว่า)
> - มีหลักฐานขั้น 4 แต่ไม่มีหลักฐานขั้น 3 ⇒ ขั้น 3 แสดง "ข้าม" ตามกติกาเดิมของแถบ (ขั้นก่อนขั้นปัจจุบันที่ไม่มีเวลา)
> - ยกเลิกการซื้อจนไม่เข้าเงื่อนไขซื้อแล้ว ⇒ ถอยกลับตามลำดับ นัด / จอง → ตรวจเครดิต → ได้เบอร์ → ทักเข้ามา (CASE ของ stage ใน journey-state.sql และ `UNBUY_FALLBACK_STAGES` ใช้ลำดับจาก `JOURNEY_STAGES` ชุดเดียว)

### 3 ตรวจเครดิต (CREDIT) — เฉพาะผ่อนกับร้าน

เวลาเข้าขั้น = MIN ของ:
- credit_checks.created_at (customer_id อยู่ใน ids; แถวที่นำเข้าจากแชทมี created_at ย้อนเป็นเวลา OCR = approximate)
- room_credit_analyses.created_at status COMPLETED บนห้องของลูกค้า
- contracts.created_at (deleted_at null)

ตั้ง path=INSTALLMENT

ถ้าผู้จัดการตัดสินล่าสุด (audit CREDIT_CHECK_OVERRIDE) เป็น REJECTED และยังไม่ซื้อ ⇒ ธง 'เครดิตไม่ผ่าน' ขั้นเป็นสีแดง (ยังแดงแม้ขั้นปัจจุบันเลยไปขั้น 4 นัด / จอง แล้ว)

คนที่ซื้อเงินสดหรือไฟแนนซ์นอกโดยไม่มีใบตรวจ ⇒ แถบแสดง 'ข้าม (เงินสด/ไฟแนนซ์นอก)' ไม่นับว่าค้าง

ตั้งด้วยมือไม่ได้

### 4 นัด / จอง (INTERESTED)

เวลาเข้าขั้น = MIN ของ:
- bookings.created_at
- todos.created_at ที่ room_id อยู่ในห้องของลูกค้าและ due_date ไม่ null
- audit AI_LEAD_CAPTURED ที่ entity_id อยู่ใน ids
- online_installment_applications.created_at
- product_reservations.reserved_at (customer_id)
- trade_ins.created_at (customer_id)
- entry MANUAL TOUCHPOINT outcome APPOINTED/VISITED (แถบขั้นติดป้ายเล็ก 'พนักงานบันทึก')

เป็นขั้นเดียวที่บันทึกมือนับเป็นหลักฐานได้ เพราะทีมนัดลูกค้าในแอป FB ซึ่งระบบไม่เห็น
```

(c) In the event table (`## รายการเหตุการณ์`), replace every occurrence of `| สนใจจริง |` with `| นัด / จอง |` (5 rows: AI_LEAD_CAPTURED, APPOINTMENT, BOOKING, WEB_HOLD / ONLINE_APPLICATION, TRADE_IN), and replace `APPOINTED/VISITED → สนใจจริง` with `APPOINTED/VISITED → นัด / จอง` (TOUCHPOINT row).

Run (from the worktree root):
```bash
grep -c 'สนใจจริง' docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c '### 3 ตรวจเครดิต (CREDIT)' docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c '### 4 นัด / จอง (INTERESTED)' docs/superpowers/specs/2026-09-15-customer-journey-design.md
```
Expected: `0`, `1`, `1`.

- [ ] **Step 23: Create the phase-3 deploy runbook**

Create `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` with exactly:
````markdown
# Runbook: ขึ้น prod — การเดินทางของลูกค้า เฟส 3 (scope v2: ระบบบันทึกเอง + บันทึกมือแบบไม่บังคับ)

- spec: `docs/superpowers/specs/2026-09-15-customer-journey-design.md` · คำตัดสินเจ้าของ scope v2 ข้อ 1–13 (2026-09-15)
- runbook เฟส 1: `docs/superpowers/runbooks/2026-09-15-customer-journey-deploy.md` — หัวข้อ 0 (pipeline · เว็บขึ้นก่อน API ได้ · ทางสำรอง deploy จากเครื่อง) ใช้กับ PR นี้ทุกข้อ ไม่เขียนซ้ำที่นี่
- **ไม่มี migration** · ไม่มีคอลัมน์ใหม่ ⇒ ไม่ต้อง apply สิทธิ์ MCP
- ไฟล์นี้คือแหล่งจริงของ runbook — PR body ลิงก์มาที่นี่ ห้ามแก้ใน PR body แยก

> 🚨 ทุกคำสั่งในไฟล์นี้เป็นงานของเจ้าของ — dev/agent ไม่ได้รันอะไรกับ prod ในงานนี้

## 0. อ่านก่อน: ค่า `stage` ในแคชเปลี่ยนความหมายทันทีที่ API ใหม่ขึ้น

**ลำดับขั้นใหม่ (เจ้าของสั่ง 2026-09-15 "ต้องเช็คเครดิตก่อนนัด"):** 1 ทักเข้ามา → 2 ได้เบอร์ / ยืนยันตัวตน → **3 ตรวจเครดิต → 4 นัด / จอง** → 5 ซื้อแล้ว
- ชื่อ enum เดิม (`CREDIT` / `INTERESTED`) — ป้ายของ `INTERESTED` เปลี่ยนเป็น "นัด / จอง"
- กติกาเดิมให้ลูกค้าที่มีทั้งใบตรวจเครดิตและหลักฐานนัด/จองอยู่ขั้น `CREDIT` · กติกาใหม่ให้อยู่ขั้น `INTERESTED`
- แถวแคช `customer_journey_states` ที่คำนวณก่อน deploy **ไม่ถูกแก้เอง**
  - summary คำนวณใหม่เฉพาะตอนไม่มีแคช · ขั้นซื้อแล้วไม่ตรง · หรือแคชเก่ากว่า 15 นาทีและลูกค้าขยับ (`journey-summary.service.ts`)
  - cron `journey:recompute` 03:30 น. แตะเฉพาะคนที่ขยับใน 48 ชม. · sweep ทุกคนเฉพาะคืนเสาร์→อาทิตย์
- ระหว่างนั้น ลูกค้าที่แคชยังเป็น `CREDIT` แต่มีเวลานัด/จอง จะเห็นแถบ "3 ตรวจเครดิต" เป็นขั้นปัจจุบัน และ "4 นัด / จอง" เป็น "ยังไม่ถึง" ไม่มีวันที่ ทั้งที่มีนัดแล้ว
- ⇒ **รัน `backfill:customer-journey` ให้จบในวันเดียวกับที่ API ใหม่ขึ้น** (ขั้น 3–5)
- ไม่มีค่าที่ถูกแช่แข็งด้วย `LEAST` ในเรื่องนี้ (`stage` / `stage_entered_at` / `path` ใช้ค่าที่คำนวณล่าสุดเสมอ) ⇒ คำนวณใหม่ครั้งเดียวแก้ครบ ไม่ต้อง reset คอลัมน์

**เว็บขึ้นก่อน API ได้** (runbook เฟส 1 หัวข้อ 0):
- เว็บใหม่ + API เก่า: แถบยังเรียงตาม API เก่า (นัด / จอง ก่อน ตรวจเครดิต) แต่ใช้ป้ายใหม่ — ยอมรับได้เฉพาะช่วงสั้น ๆ ระหว่างสองสาย
- `deploy-web` เขียว แต่ `build-and-push-api` / `migrate-db` / `deploy-api` ตัวใดไม่เขียว (แดง · ถูกยกเลิก · หรือ skipped) = **ถอยเว็บทันที** (หัวข้อ "ถอย" → ข้อ 2)

## ลำดับห้ามสลับ

| ขั้น | งาน |
|---|---|
| 1 | ด่านก่อน merge — PR "ร้านตอบครั้งแรก" ขึ้นและจบแล้ว · จดของเดิมไว้ถอย · นับก่อน · ช่วงเวลา |
| 2 | merge PR นี้ + ด่านหลัง merge |
| 3 | `backfill:customer-journey` dry-run |
| 4 | รันจริง |
| 5 | ตรวจหลัง backfill |

## 1. 🚨 ด่านก่อน merge

### 1.1 PR "ร้านตอบครั้งแรก" (`first_staff_reply_at`) อยู่บน main และจบหัวข้อ 9 ของ runbook เฟส 1 แล้ว

สถานะตอนเขียนแผน (2026-09-15): ข้อ 1 ผ่านแล้ว — PR #1595 merge และ deploy แล้ว (อยู่ใน `origin/main` `10d6e6d3a` ที่แผนนี้ต่อยอด) · ข้อ 2–3 ยังต้องตรวจตอนจะ merge

เหตุผล: PR นั้นแก้ `journey-state.sql` ไฟล์เดียวกัน และหัวข้อ 9.1 ของมันต้องดูผลหนึ่งคืน **ก่อน** backfill · ถ้าขึ้นพร้อม PR นี้ backfill ขั้น 3–4 จะเขียนกติกา "ร้านตอบครั้งแรก" ให้ทุกคนก่อนผ่านด่านนั้น และค่านั้นถูกแช่แข็งด้วย `LEAST`

1. โค้ดของ PR นั้นอยู่บน main — จากเครื่อง dev:
   ```bash
   git fetch origin
   git show origin/main:apps/api/src/modules/customer-journey/sql/journey-state.sql | grep -c 'channel_first_customer_at'
   git show origin/main:apps/api/src/modules/customer-journey/sql/journey-state.sql | grep -c 'is_system_user'
   ```
   - ทั้งสองบรรทัดต้องได้ **มากกว่า 0** · ได้ 0 = PR นั้นยังไม่ merge → ห้าม merge PR นี้ ทำตาม runbook เฟส 1 หัวข้อ 9 ก่อน
2. branch ของ PR นี้ต่อจาก main นั้น: `git merge-base --is-ancestor origin/main <branch ของ PR นี้> && echo ok` ต้องพิมพ์ `ok` · ไม่พิมพ์ = rebase ก่อน
3. หัวข้อ 9.2 ของ runbook เฟส 1 จบแล้ว (รัน backfill แล้ว หรือเลือกรอ sweep และผ่านคืนเสาร์→อาทิตย์ไปแล้ว) และ job ไม่ถือ env เขียนจริงค้าง:
   ```bash
   gcloud run jobs describe bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
     --format='value(spec.template.spec.template.spec.containers[0].image,spec.template.spec.template.spec.containers[0].env)'
   ```
   - env ต้องมีแค่ `EXPECTED_DB_NAME` · เห็น `CONFIRM_BACKFILL` / `ALLOW_PROD_BACKFILL` = ถอดก่อนด้วยคำสั่งท้ายหัวข้อ 9.2 ของ runbook เฟส 1

### 1.2 จดของเดิมไว้ถอย

1. image ของ `bestchoice-api` ที่รับ traffic 100%:
   ```bash
   gcloud run services describe bestchoice-api --project=bestchoice-prod --region=asia-southeast1 --format='value(status.traffic)'
   gcloud run revisions describe <REVISION ที่ได้ 100%> --project=bestchoice-prod --region=asia-southeast1 --format='value(spec.containers[0].image)'
   ```
   - จด tag หลัง `api:` ที่เห็นจริงบน revision — เรียกค่านี้ว่า `<SHA40 ก่อนเฟส 3>`
2. release ปัจจุบันของ Firebase Hosting site admin (`bestchoicephone.app`) — Firebase console → Hosting → ประวัติ release

### 1.3 นับก่อน (MCP นับอย่างเดียว)

```sql
SELECT stage, count(*) FROM customer_journey_states GROUP BY 1 ORDER BY 1;
SELECT count(*) AS will_move FROM customer_journey_states WHERE stage = 'CREDIT' AND interested_at IS NOT NULL;
```
- จดทั้งสองผล — `will_move` = จำนวนแคชที่กติกาใหม่ย้ายจาก `CREDIT` ไป `INTERESTED`
- `mcp_ro` อ่าน `stage` / `interested_at` / `credit_at` ได้ (`.claude/mcp/sql/grants.sql`) — ไม่ต้องใช้ role เจ้าของ

### 1.4 ช่วงเวลาที่ merge ได้

- **จันทร์–พฤหัส ช่วงเช้า** — ขั้น 3–5 ต้องจบวันเดียวกัน
- **ห้าม 03:00–04:30 น.** (cron `journey:recompute` แข่งเขียนแคช) · **ห้ามวันเสาร์**
- ห้าม merge PR อื่นซ้อนจนกว่าขั้น 5 ผ่าน — run เข้าคิวและขึ้น HEAD ใหม่ทับ (runbook เฟส 1 หัวข้อ 0)

## 2. merge PR นี้ + ด่านหลัง merge

1. merge แล้วจด `<SHA40 ของเฟส 3>` = commit ของ run จากหน้า Actions (image ที่ pipeline push ใช้ tag นี้)
2. **ผ่านเมื่อครบทุกข้อ:**
   - run เขียวครบ: `lint-and-test` · `build-and-push-api` · `migrate-db` · `deploy-api` · `deploy-web` (skipped นับเป็นไม่เขียว)
   - `curl https://api.bestchoicephone.app/api/health` ok
   - บันเดิลของ `https://bestchoicephone.app/` เป็นเลข `version` ใน `apps/web/package.json` ของ merge commit
   - image ของ revision ที่รับ traffic 100% = `api:<SHA40 ของเฟส 3>` — คำสั่งเดียวกับข้อ 1.2
3. ไม่ผ่านข้อใด = ยังไม่นับว่าขึ้น ห้ามเริ่มขั้น 3 · เว็บขึ้นแต่สาย API ไม่เขียว = ถอยเว็บ (หัวข้อ "ถอย" → ข้อ 2) แล้วหาสาเหตุก่อน merge/รัน pipeline ซ้ำ

## 3. `backfill:customer-journey` dry-run

🚨 ห้ามรันช่วง 03:00–04:30 น. เวลาไทย

job `bestchoice-backfill-customer-journey` มีอยู่แล้วจากเฟส 1 — ห้าม `jobs create` ซ้ำ · เปลี่ยน image + ถอด env เขียนจริง แล้วตรวจก่อนรัน:
```bash
gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ของเฟส 3> \
  --remove-env-vars=CONFIRM_BACKFILL,ALLOW_PROD_BACKFILL,NODE_ENV
gcloud run jobs describe bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --format='value(spec.template.spec.template.spec.containers[0].image,spec.template.spec.template.spec.containers[0].env)'
gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="bestchoice-backfill-customer-journey"' --project=bestchoice-prod --freshness=2h --limit=200 --format='value(textPayload,jsonPayload.message)'
```
- `describe` ต้องเห็น image = `<SHA40 ของเฟส 3>` และ env มีแค่ `EXPECTED_DB_NAME` — ไม่ตรงห้าม execute
- **exit 0** → ขั้น 4
- **exit 1** = ห้องไม่มีเจ้าของเกิน 1% → หยุด ส่ง log ให้ dev
- **exit 2** = จำนวน PURCHASED ≠ BOUGHT_WHERE หรือบางชุดล้ม (`[run] FAILED batch …`) → หยุด ส่ง log ให้ dev
  - ลำดับขั้นใหม่ไม่แตะขั้น `PURCHASED` ⇒ parity ของ dry-run ต้องเหมือนก่อน merge
  - log มีแค่ id และตัวเลข

## 4. รันจริง

ช่วงเงียบ — ไม่ใช่ช่วง 03:00–04:30 น. · รันซ้ำได้ (`INSERT … ON CONFLICT`)
```bash
gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait
gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --remove-env-vars=CONFIRM_BACKFILL,ALLOW_PROD_BACKFILL,NODE_ENV
```
- คำสั่งสุดท้ายถอด env ทันทีหลังรัน — job ที่ค้าง env เขียนจริงคือกับดักของ dry-run ครั้งหน้า
- อ่านผลแบบขั้น 3 (exit 0 ไปขั้น 5 · exit 1/2 หยุด ส่ง log ให้ dev)

## 5. ตรวจหลัง backfill (MCP นับอย่างเดียว)

```sql
SELECT stage, count(*) FROM customer_journey_states GROUP BY 1 ORDER BY 1;
SELECT count(*) AS stale_credit FROM customer_journey_states WHERE stage = 'CREDIT' AND interested_at IS NOT NULL;
SELECT count(*) AS moved FROM customer_journey_states WHERE stage = 'INTERESTED' AND credit_at IS NOT NULL;
```
**ผ่านเมื่อ:**
- `stale_credit` = **0** — มากกว่า 0 = มีแถวที่ยังคำนวณด้วยกติกาเดิม (image ของ job ผิด หรือบางชุดล้ม) → ห้ามไปต่อ ส่งตัวเลขให้ dev
- `moved` ไม่น้อยกว่า `will_move` ของข้อ 1.3 ลบด้วยจำนวน `PURCHASED` ที่เพิ่มขึ้นระหว่างข้อ 1.3 กับข้อนี้ (คนที่ซื้อระหว่างรอออกจากกลุ่มนี้ได้) · น้อยกว่านั้น → ส่งทั้งสองตัวเลขให้ dev
- ผลรวมทุกขั้นใกล้ผลรวมของข้อ 1.3 (ต่างได้เท่าลูกค้าใหม่ระหว่างรอ)
- เปิดหน้า `/customers/<customer_id>` ของคนหนึ่งจาก:
  ```sql
  SELECT customer_id FROM customer_journey_states WHERE stage = 'INTERESTED' AND credit_at IS NOT NULL ORDER BY computed_at DESC LIMIT 1;
  ```
  แถบขั้นต้องเป็น "3 ตรวจเครดิต" มีวันที่ (หรือแดง "เครดิตไม่ผ่าน") และ "4 นัด / จอง" เป็นขั้นปัจจุบัน

## ถอย (rollback)

### ถอยเพราะลำดับขั้น

ถอย image **อย่างเดียวไม่พอ**: แคชที่ image เฟส 3 เขียน (`INTERESTED` ที่มีใบตรวจเครดิต) จะถูก builder เก่าวาดขั้น "ตรวจเครดิต" เป็น "ยังไม่ถึง" ไม่มีวันที่ — ทำครบตามลำดับ:

1. **ถอย `bestchoice-api`** ไป image ที่จดในข้อ 1.2:
   ```bash
   gcloud run services update bestchoice-api --project=bestchoice-prod --region=asia-southeast1 \
     --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ก่อนเฟส 3>
   ```
   - 🚨 ห้ามใช้ `gcloud run deploy` ชุดเต็มจากเครื่อง (env/secret ของ service จะเพี้ยน)
2. **ถอยเว็บ** — Firebase console → Hosting → site admin (`bestchoicephone.app`) → ประวัติ release → Rollback ไป release ที่จดในข้อ 1.2
   - ป้ายและลำดับเดิมต้องมาคู่กับ API เก่า · site shop ไม่ต้องถอย
3. **รอให้ instance ของ revision เฟส 3 หมดก่อนคำนวณใหม่** — ไม่งั้นหน้าลูกค้า/cron บน instance เก่าเขียนลำดับใหม่กลับเข้ามา
   ```bash
   gcloud run services describe bestchoice-api --project=bestchoice-prod --region=asia-southeast1 --format='value(status.traffic)'
   ```
   - revision ของ `<SHA40 ก่อนเฟส 3>` ได้ 100%
   - revision ของเฟส 3 ไม่มี instance เหลือ: Cloud Run console → `bestchoice-api` → Metrics → Container instance count แยกตาม revision = 0 · ดูไม่ได้ให้รอ ≥ 60 นาทีหลังสลับ traffic
   - นอกช่วง 03:00–04:30 น.
4. **คำนวณใหม่ทั้งหมดด้วย job ที่ image ตรงกับข้อ 1** — ขั้น 3 เปลี่ยน image ของ job เป็นเฟส 3 ไปแล้ว:
   ```bash
   gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
     --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ก่อนเฟส 3> \
     --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
   gcloud run jobs describe bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
     --format='value(spec.template.spec.template.spec.containers[0].image)'
   gcloud run revisions describe <REVISION ที่ได้ 100% จากข้อ 3> --project=bestchoice-prod --region=asia-southeast1 --format='value(spec.containers[0].image)'
   ```
   - สองบรรทัดหลังต้องได้ image **เดียวกัน** — ไม่ตรงห้าม execute
   - แล้ว `gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait`
   - จบแล้วถอด env: `gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --remove-env-vars=CONFIRM_BACKFILL,ALLOW_PROD_BACKFILL,NODE_ENV`
   - ตรวจ: `SELECT count(*) FROM customer_journey_states WHERE stage = 'INTERESTED' AND credit_at IS NOT NULL;` ต้องได้ **0** (กติกาเดิมให้คนกลุ่มนี้อยู่ `CREDIT`)
5. **ทำให้ถอยถาวรก่อน merge อะไรเข้า main อีก** — การถอย image เป็นของชั่วคราว (push ถัดไปขึ้น HEAD ทั้งชุด) ⇒ PR ที่ revert PR นี้ merge เป็นอันดับแรก
   - ขึ้นกลับภายหลัง (roll forward) = ทำขั้น 2–5 ของไฟล์นี้ซ้ำทั้งหมด

- ไม่ต้อง reset คอลัมน์ใด (ไม่มีค่าที่ `LEAST` แช่แข็งในเรื่องนี้)
- ถอย image ข้ามเส้นเฟส 3 **ด้วยเหตุผลอื่น** ก็ต้องทำข้อ 3–4 เหมือนกัน — ค่า `stage` ในแคชมีความหมายตาม image ที่เขียนล่าสุดเสมอ
````

Run (from the worktree root):
```bash
grep -c '^## ' docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
```
Expected: `8` (`0`, `ลำดับห้ามสลับ`, `1`, `2`, `3`, `4`, `5`, `ถอย`).

- [ ] **Step 24: Sweep for leftover old-order encodings, then typecheck and lint**

Run (from the worktree root):
```bash
grep -rnE "'IDENTIFIED', 'INTERESTED'|'CREDIT', 'INTERESTED', 'IDENTIFIED'|IDENTIFIED\|INTERESTED|สนใจจริง|นัด-จอง" apps/api/src apps/web/src packages/shared/src docs/superpowers/specs/2026-09-15-customer-journey-design.md | grep -v 'customer-journey/customer-journey.service.spec.ts'
./tools/check-types.sh all
cd apps/api && npx eslint src/modules/customer-journey/journey-summary.builder.ts src/modules/customer-journey/journey-summary.builder.spec.ts src/modules/customer-journey/journey-state.stage-order.db.spec.ts src/modules/customer-journey/journey-state.service.db.spec.ts src/modules/customer-journey/journey-summary.service.db.spec.ts src/modules/customer-journey/customer-journey.service.ts src/modules/customer-journey/customer-journey.service.spec.ts
cd ../web && npx eslint src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx
```
Expected: the grep pipeline prints nothing (the only file that still spells the old label is the Step 20 pin in `customer-journey.service.spec.ts`, filtered out on purpose); `check-types.sh` ends with `TypeScript check passed!`; both eslint runs report no errors. Never run `npm run lint` in `apps/api` (it applies `--fix`).

- [ ] **Step 25: Final targeted suite run**

Run:
```bash
cd packages/shared && npx vitest run src/customer-journey.spec.ts
cd ../../apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage && npx vitest run src/pages/CustomerDetailPage
cd ../api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=UTC NODE_ENV=test npx jest src/modules/customer-journey src/modules/chat-prospects/customer-merge.service src/cli/backfill-customer-journey src/modules/pdpa/pdpa-dsar-journey.db.spec.ts --runInBand
```
Expected: all passed (web under both TZ values; API DB specs under `TZ=UTC`, matching CI).

- [ ] **Step 26: Commit**

Run (from the worktree root):
```bash
git add packages/shared/src/customer-journey.ts packages/shared/src/customer-journey.spec.ts \
  apps/web/src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx \
  apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx \
  apps/api/src/modules/customer-journey/journey-summary.builder.ts \
  apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts \
  apps/api/src/modules/customer-journey/journey-state.stage-order.db.spec.ts \
  apps/api/src/modules/customer-journey/sql/journey-state.sql \
  apps/api/src/modules/customer-journey/journey-state.service.db.spec.ts \
  apps/api/src/modules/customer-journey/journey-summary.service.db.spec.ts \
  apps/api/src/modules/customer-journey/customer-journey.service.ts \
  apps/api/src/modules/customer-journey/customer-journey.service.spec.ts \
  docs/superpowers/specs/2026-09-15-customer-journey-design.md \
  docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
git commit -F - <<'EOF'
feat(customer-journey): ขั้น 3 ตรวจเครดิต มาก่อน ขั้น 4 นัด / จอง (เจ้าของสั่ง 2026-09-15)

- shared: JOURNEY_STAGES = CONTACTED → IDENTIFIED → CREDIT → INTERESTED → PURCHASED · ป้าย INTERESTED = "นัด / จอง" (ชื่อ enum เดิม ไม่มี migration)
- journey-state.sql (CTE resolved): อันดับ stage = ซื้อแล้ว → นัด / จอง → ตรวจเครดิต → ได้เบอร์ → ทักเข้ามา · path / lost / stage_entered_at ไม่เปลี่ยน
- withLiveBought: ลำดับถอยกลับคำนวณจาก JOURNEY_STAGES (UNBUY_FALLBACK_STAGES) · builder spec อ่านไฟล์ SQL ปักว่าตรงกัน
- ข้อความ "ระบบยังไม่เก็บ" อ้างชื่อขั้น "นัด / จอง" · เทส API/เว็บเรียงใหม่ · DB spec ใหม่ journey-state.stage-order.db.spec.ts
- สเปคหัวข้อขั้นการเดินทาง + runbook เฟส 3: ด่านก่อน merge (PR ร้านตอบครั้งแรกต้องจบก่อน) และคำนวณแคชใหม่ทั้งหมดหลัง deploy เพราะค่า stage ในแคชเปลี่ยนความหมาย · ถอย image ต้องคำนวณใหม่ด้วย

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
git log --oneline -1
```
Expected: one new commit; `git status --short` shows none of the 14 paths above.

---

### Task 3: State SQL automatic signals: chat file → ③, saving plans/online orders → ④, six documents clear lost

Brief §0 rulings 1, 2, 5, 11, 12, 13 · Controller rulings R-P1 (document files only) and R-P4 (base `10d6e6d3a`) · outline D3 + D5 · research-state §3-§5, §9 R1/R8 · research-infra §1.6.

The cached journey state learns three kinds of automatic evidence with **no migration, no new column and no UI**:
- a customer **document** file in chat counts toward ③ ตรวจเครดิต **without** setting `path`. "Document" = `role = 'CUSTOMER' AND type = 'FILE' AND media_url ~* '\.(pdf|docx?|xlsx?)(\?|$)'` (Controller ruling R-P1): the Facebook webhook stores unknown attachments (shares, templates) as `FILE`, so a NULL `media_url` or a facebook.com share link must not count. This task creates the one definition of that condition, `apps/api/src/modules/customer-journey/chat-document-file.ts`, which Tasks 4 and 5 reuse;
- saving plans and online orders count toward ④ นัด / จอง;
- bookings, online installment applications, product reservations, trade-ins, saving plans and online orders created **after** the latest MARKED_LOST clear the lost badge.

The two activity probes learn `saving_plans` and `online_orders`, so a new plan or order triggers the 15-minute (summary) / 48-hour (cron) recompute.

> Time rule: columns are `timestamp without time zone` holding UTC, the test DB session is `Asia/Bangkok`, CI runs in UTC ⇒ the SQL never uses `now()`; tests use ISO `Z` strings only.
> PDPA rule: the SQL reads `chat_messages.role`, `type`, `created_at`, `deleted_at`, and `media_url` **only inside the document-file FILTER** (`CUSTOMER_DOCUMENT_FILE_SQL`) — it never leaves the `rooms` CTE; never `text`, `media_type`. All test data is synthetic (names `journey signals …`, placeholder phone/national-id strings, `files.example.test` / share-link placeholder URLs).
> Anchor every SQL edit by CTE name and the exact code line shown — never by line number (quoted numbers are at the base `origin/main` `10d6e6d3a`).

**Files:**
- Create: `apps/api/src/modules/customer-journey/chat-document-file.ts` — `CHAT_DOCUMENT_FILE_PATTERN`, `CUSTOMER_DOCUMENT_FILE_SQL`, `CUSTOMER_DOCUMENT_FILE_FRAGMENT` (R-P1)
- Create: `apps/api/src/modules/customer-journey/chat-document-file.spec.ts` — pins the values, pins that `journey-state.sql` spells the same condition once, forbids copies in the module
- Modify: `apps/api/src/modules/customer-journey/sql/journey-state.sql`
  - file header comment (:4 — the `-- 🚨 PDPA:` line): say that `media_url` is read only inside the customer **document**-file condition (edited in place, line count unchanged)
  - `rooms` CTE (:17-34 — select list :19, LATERAL :29-33): add `first_file_at` (document files only — the literal `CUSTOMER_DOCUMENT_FILE_SQL`)
  - `room_agg` CTE (:44-46): add per-customer `first_file_at`
  - `interest_agg` CTE (:181-196): add `saving_plans`, `online_orders`, `doc_last_at`
  - `base` CTE (:245-250): add `credit_doc_at`, widen `credit_at`, carry `ia.doc_last_at`
  - `resolved` CTE (:296-302 after Task 2; :293-299 at base): `path` from `credit_doc_at`; `lost_at` checks `doc_last_at`
  - line numbers: everything above the `resolved` stage CASE (:288 at base) is as at the base `10d6e6d3a`. Task 2 adds three `--` comment lines directly above that CASE (and swaps two of its `WHEN` lines), so every line from the stage CASE down sits 3 lines lower than at base. Anchor every edit on its quoted text.
- Modify: `apps/api/src/modules/customer-journey/sql/journey-activity-probe.sql` (insert after :17, the `trade_ins` line)
- Modify: `apps/api/src/modules/customer-journey/sql/journey-active-since.sql` (insert after :17, the `trade_ins` line)
- Create: `apps/api/src/modules/customer-journey/journey-state.signals.db.spec.ts`
- Modify: `apps/api/src/modules/customer-journey/customer-journey.service.ts` (`JOURNEY_NOT_RECORDED`: the comment + 3 strings at :42-45)
- Modify: `apps/api/src/modules/customer-journey/customer-journey.service.spec.ts` (new `it` before the closing `});` of the main `describe` at :212 · the import already carries `JOURNEY_NOT_RECORDED` from Task 2 Step 20 — not edited here)
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md` (③ CREDIT evidence list + path sentence · ④ INTERESTED evidence list · lost clearing bullet — anchored by bullet text because Task 2 reorders the stage sections)
- Modify: `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` (created by Task 2 — order-table row 1 gains `(1.6)`; new `### 1.6` pre-merge count inside `## 1. 🚨 ด่านก่อน merge`, directly before `## 2.`; `### 1.5` stays reserved for Task 9)

**Interfaces:**
- Consumes:
  - Task 2: `resolved` stage CASE rank `bought → interested_at → credit_at → identified_at → CONTACTED` (a customer with both ④ and ③ evidence is `INTERESTED`) · `JOURNEY_NOT_RECORDED` strings already relabelled to `ใช้นับขั้น "นัด / จอง"` · runbook file `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` exists.
  - Shipped `journey-state.sql` CTEs `rooms`, `room_agg`, `interest_agg`, `credit_agg`, `room_credit_agg`, `lost_mark`, `base`, `shaped`, `resolved`; parameters `$1 text[]` ids · `$2 text[]` bought contract statuses · `$3 text[]` bought sale types · `$4 text` ISO UTC. The SQL file is read with `readFileSync` and run through `$queryRawUnsafe` (`journey-state.service.ts`), so it cannot import a TypeScript constant.
  - Shipped `JourneyStateService` (`apps/api/src/modules/customer-journey/journey-state.service.ts`): `recompute(customerIds: string[]): Promise<void>` · `hasActivitySince(familyIds: string[], since: Date): Promise<boolean>` · `activeCustomerIdsSince(since: Date): Promise<string[]>`.
  - Prisma models `SavingPlan` (`saving_plans`), `OnlineOrder` (`online_orders`, `reservationId` unique NOT NULL), `ProductReservation` (`product_reservations`, no `deleted_at`), `Booking`, `OnlineInstallmentApplication`, `TradeIn`, `CreditCheck`, `Contract`, `Todo`, and `ChatMessage` (`type: MessageType` — `FILE`, `IMAGE`, … · `mediaUrl String? @map("media_url")`) · `product_reservations` also has the SQL-only partial unique index `product_reservations_active_product_idx` ON `product_reservations(product_id) WHERE status = 'ACTIVE'` (migration `20260986000000_online_order_unfulfillable`; `schema.prisma` only warns never to drop it) — one product can hold at most one ACTIVE reservation, so specs that seed several reservations on one product seed them non-ACTIVE.
  - `Prisma.raw(text: string): Prisma.Sql` / `Prisma.sql` / `Prisma.join` from `@prisma/client` (a `Prisma.Sql` exposes `.text` and `.values`).
- Produces (no new state column, no change to any existing TypeScript signature):
  - `apps/api/src/modules/customer-journey/chat-document-file.ts`:
    ```ts
    export const CHAT_DOCUMENT_FILE_PATTERN: string;       // \.(pdf|docx?|xlsx?)(\?|$) — case-insensitive via ~*
    export const CUSTOMER_DOCUMENT_FILE_SQL: string;       // m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '<pattern>' (alias m = chat_messages)
    export const CUSTOMER_DOCUMENT_FILE_FRAGMENT: Prisma.Sql; // Prisma.raw(CUSTOMER_DOCUMENT_FILE_SQL) for $queryRaw
    ```
    `chat-document-file.spec.ts` pins: the two strings byte for byte · `CUSTOMER_DOCUMENT_FILE_FRAGMENT.text === CUSTOMER_DOCUMENT_FILE_SQL` with no values · `journey-state.sql` contains `CUSTOMER_DOCUMENT_FILE_SQL` exactly once and `'FILE'` exactly once · the only non-spec `.ts` / `.sql` files of `src/modules/customer-journey` that contain `'FILE'` or `pdf|docx` are `chat-document-file.ts` and `sql/journey-state.sql` (Tasks 4 and 5 must import the fragment, not copy the condition).
  - `rooms` LATERAL over CUSTOMER messages (soft-deleted rows included) adds `MIN(m.created_at) FILTER (WHERE m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '\.(pdf|docx?|xlsx?)(\?|$)') AS first_file_at`; `room_agg.first_file_at = MIN(rooms.first_file_at)` per customer. `media_url` does not leave the CTE.
  - `base.credit_doc_at = LEAST(credit_agg.at, room_credit_agg.at)` (statement-internal, not stored).
  - `base.credit_at = LEAST(credit_agg.at, room_credit_agg.at, room_agg.first_file_at)` ⇒ the cached `customer_journey_states.credit_at`, and `stage_entered_at` when the stage is `CREDIT`, include the earliest customer chat **document** file.
  - `resolved.path` = `WHEN s.bought THEN s.first_purchase_kind WHEN s.credit_doc_at IS NOT NULL THEN 'INSTALLMENT' ELSE 'UNKNOWN'` — a chat file alone never sets `INSTALLMENT`.
  - `interest_agg.at` MIN adds `saving_plans.created_at` and `online_orders.created_at` (`deleted_at IS NULL`, any status).
  - `interest_agg.doc_last_at = MAX(at) FILTER (WHERE clears_lost)` over exactly `bookings.created_at`, `online_installment_applications.created_at`, `product_reservations.reserved_at`, `trade_ins.created_at`, `saving_plans.created_at`, `online_orders.created_at`. `AI_LEAD_CAPTURED` rows have `clears_lost = false`.
  - `resolved.lost_at` adds `AND (s.doc_last_at IS NULL OR s.doc_last_at <= s.lost_mark_at)`:
    - a document strictly after the latest MARKED_LOST clears the badge; a document at exactly the mark time does not;
    - todos, credit checks, room credit analyses, contracts and `AI_LEAD_CAPTURED` never clear it.
  - `journey-activity-probe.sql` / `journey-active-since.sql` fire on `saving_plans.updated_at` and `online_orders.updated_at` (`>` / `>=`, same as their neighbours).
  - `JOURNEY_NOT_RECORDED` lines:
    - `'การจองสินค้าผ่านเว็บ (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)'`
    - `'ใบสมัครผ่อนออนไลน์ (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)'`
    - `'รายการรับซื้อ/เทิร์นเครื่อง (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)'`
    - These lines are true only until Task 6, which adds timeline rows for all three documents and deletes these lines, their comment and this task's wording test.
  - Contract for Task 4 (evidence `CHAT_FILE`, `creditFilePending`): the file time inside `credit_at` comes from rooms joined by `chat_rooms.customer_id` over the family, **without** a `chat_rooms.deleted_at` filter, **including** soft-deleted messages, and **only** messages matching `CUSTOMER_DOCUMENT_FILE_SQL`. The live check must use the same unfiltered scope and `CUSTOMER_DOCUMENT_FILE_FRAGMENT` in raw SQL (no Prisma `where` copy).
  - Contract for Task 5 (`CHAT_CUSTOMER_FILE` rows): `chatDays` counts `files` / `lastFileAt` with `CUSTOMER_DOCUMENT_FILE_FRAGMENT`, so a timeline file row exists exactly for the messages that can move ③.
  - Contract for Task 6 (RECONTACTED suppression + document rows): the six clearing timestamps and the strict `> lost_mark_at` rule above are the source of truth; Task 6 gives each of the six documents a sale row at exactly that timestamp.

- [ ] **Step 1: Check prerequisites (Task 2 landed, SQL files clean, shared built)**

Run (from the worktree root):
```bash
git status --short apps/api/src/modules/customer-journey/sql/
grep -n "WHEN s.interested_at IS NOT NULL THEN 'INTERESTED'" -A1 apps/api/src/modules/customer-journey/sql/journey-state.sql
grep -c "first_file_at\|doc_last_at\|credit_doc_at\|'FILE'" apps/api/src/modules/customer-journey/sql/journey-state.sql
grep -n 'ใช้นับขั้น' apps/api/src/modules/customer-journey/customer-journey.service.ts
ls docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
ls apps/api/src/modules/customer-journey/chat-document-file.ts
npm run build --workspace=@installment/shared
```
Expected:
- `git status` prints nothing. If it prints a path, another session has uncommitted edits in `sql/`: stop and report; never edit over them.
- The grep prints `WHEN s.interested_at IS NOT NULL THEN 'INTERESTED'` followed by `WHEN s.credit_at IS NOT NULL THEN 'CREDIT'`. Anything else means Task 2 has not landed: stop.
- `0`
- Three lines containing `ใช้นับขั้น "นัด / จอง"`. If they still say `สนใจจริง`, Task 2 has not landed: stop.
- The runbook path is listed.
- `ls` reports `No such file or directory` for `chat-document-file.ts` (this task creates it).
- The shared build finishes without errors.

- [ ] **Step 2: Write the failing spec for the single document-file condition**

Create `apps/api/src/modules/customer-journey/chat-document-file.spec.ts`:
```ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { CHAT_DOCUMENT_FILE_PATTERN, CUSTOMER_DOCUMENT_FILE_FRAGMENT, CUSTOMER_DOCUMENT_FILE_SQL } from './chat-document-file';

/** ไฟล์ .ts / .sql ของโมดูลนี้ที่ไม่ใช่ spec — ใช้ตรวจว่าไม่มีใครเขียนกติกาไฟล์เอกสารซ้ำ */
function moduleSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return moduleSourceFiles(path);
    return /\.(ts|sql)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * "ลูกค้าส่งไฟล์เอกสารในแชท" มีนิยามเดียว (คำตัดสินผู้ควบคุม R-P1 2026-09-15)
 * TS ใช้ค่าคงที่จาก chat-document-file.ts · journey-state.sql import ไม่ได้จึงเขียนข้อความเดียวกันตรงตัวอักษร — spec นี้ปักว่าตรงกัน
 * พฤติกรรมกับ Postgres จริงอยู่ที่ journey-state.signals.db.spec.ts
 */
describe('chat-document-file — เงื่อนไขไฟล์เอกสารที่ลูกค้าส่งในแชท (R-P1)', () => {
  it('pattern = นามสกุล pdf / doc / docx / xls / xlsx ตามด้วย ? หรือจบสตริง · เงื่อนไข SQL เต็มใช้ alias m', () => {
    expect(CHAT_DOCUMENT_FILE_PATTERN).toBe('\\.(pdf|docx?|xlsx?)(\\?|$)');
    expect(CUSTOMER_DOCUMENT_FILE_SQL).toBe("m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '\\.(pdf|docx?|xlsx?)(\\?|$)'");
  });

  it('fragment ของ $queryRaw = ข้อความเดียวกันทุกตัวอักษร ไม่มีพารามิเตอร์', () => {
    expect(CUSTOMER_DOCUMENT_FILE_FRAGMENT.text).toBe(CUSTOMER_DOCUMENT_FILE_SQL);
    expect(CUSTOMER_DOCUMENT_FILE_FRAGMENT.values).toEqual([]);
  });

  it("journey-state.sql เขียนเงื่อนไขเดียวกันตรงตัวอักษรครั้งเดียว และไม่มี 'FILE' นอกเงื่อนไขนี้", () => {
    const sql = readFileSync(join(__dirname, 'sql', 'journey-state.sql'), 'utf8');
    expect(sql.split(CUSTOMER_DOCUMENT_FILE_SQL)).toHaveLength(2);
    expect(sql.split("'FILE'")).toHaveLength(2);
  });

  it("ไฟล์อื่นของโมดูลไม่เขียน 'FILE' หรือ regex นามสกุลเอกสารซ้ำ — ต้อง import จาก chat-document-file.ts", () => {
    const owners = moduleSourceFiles(__dirname)
      .filter((path) => {
        const text = readFileSync(path, 'utf8');
        return text.includes("'FILE'") || text.includes('pdf|docx');
      })
      .map((path) => relative(__dirname, path))
      .sort();
    expect(owners).toEqual(['chat-document-file.ts', 'sql/journey-state.sql']);
  });
});
```

Run (from `apps/api`):
```bash
NODE_ENV=test npx jest src/modules/customer-journey/chat-document-file.spec.ts --runInBand
```
Expected: FAIL — `Cannot find module './chat-document-file' from 'modules/customer-journey/chat-document-file.spec.ts'` (Test Suites: 1 failed).

- [ ] **Step 3: Implement the single document-file condition**

Create `apps/api/src/modules/customer-journey/chat-document-file.ts`:
```ts
import { Prisma } from '@prisma/client';

/*
 * "ลูกค้าส่งไฟล์เอกสารในแชท" — แหล่งเดียวของกติกา (คำตัดสินผู้ควบคุม R-P1 2026-09-15)
 * นับเฉพาะ chat_messages ที่ role CUSTOMER + type FILE + media_url ลงท้ายด้วยนามสกุลเอกสาร (pdf · doc · docx · xls · xlsx ไม่สนตัวพิมพ์)
 * ตามด้วย query string (?) หรือจบสตริง
 * ทำไม: webhook Facebook แปลงไฟล์แนบชนิดที่ไม่รู้จัก (fallback / template เช่นแชร์ลิงก์) เป็น FILE (facebook-webhook.controller.ts parseMessage)
 *   prod 2026-09-15 (นับรวมอย่างเดียว): .pdf 818 ไฟล์ / 416 ห้อง · media_url ว่าง 107 / 48 ห้อง · ลิงก์ facebook.com 26 / 25 ห้อง · เอกสาร office 1
 * ผู้ใช้: sql/journey-state.sql (first_file_at → credit_at) · journey-summary.service.ts (CHAT_FILE · creditFilePending) · sources/chat.source.ts (แถว CHAT_CUSTOMER_FILE)
 * 🔴 PDPA: media_url อยู่ใน WHERE / FILTER เท่านั้น — ห้าม select ออกไปเป็นเหตุการณ์ · summary · log · audit · snapshot ของเทส
 * journey-state.sql import ค่าคงที่ไม่ได้ ⇒ เขียน CUSTOMER_DOCUMENT_FILE_SQL ตรงตัวอักษร · chat-document-file.spec.ts ปักว่าตรงกันและห้ามมีสำเนาอื่นในโมดูล
 */

/** regex ของนามสกุลเอกสารท้าย media_url — ใช้กับ ~* (ไม่สนตัวพิมพ์) */
export const CHAT_DOCUMENT_FILE_PATTERN = String.raw`\.(pdf|docx?|xlsx?)(\?|$)`;

/** เงื่อนไข SQL ทั้งก้อน · alias m = chat_messages · ต้องใช้กับ standard_conforming_strings = on (ค่าเริ่มต้นของ Postgres) */
export const CUSTOMER_DOCUMENT_FILE_SQL = `m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '${CHAT_DOCUMENT_FILE_PATTERN}'`;

/** เงื่อนไขเดียวกันสำหรับ prisma.$queryRaw — เป็นข้อความคงที่ของโค้ด ไม่มีค่าจากผู้ใช้ จึงฝังด้วย Prisma.raw ได้ */
export const CUSTOMER_DOCUMENT_FILE_FRAGMENT = Prisma.raw(CUSTOMER_DOCUMENT_FILE_SQL);
```

Run (from `apps/api`):
```bash
NODE_ENV=test npx jest src/modules/customer-journey/chat-document-file.spec.ts --runInBand
```
Expected: `Tests: 2 failed, 2 passed, 4 total`
- Passing: the pattern test and the fragment test.
- Failing (fixed in Step 7, when `journey-state.sql` gains the condition): `journey-state.sql เขียนเงื่อนไขเดียวกัน…` — `expect(received).toHaveLength(expected)`, expected length `2`, received length `1`; `ไฟล์อื่นของโมดูลไม่เขียน 'FILE'…` — `expect(received).toEqual(expected)`, received `["chat-document-file.ts"]`.

- [ ] **Step 4: Write the failing real-DB spec**

Create `apps/api/src/modules/customer-journey/journey-state.signals.db.spec.ts`:
```ts
import { Prisma, PrismaClient } from '@prisma/client';
import { CUSTOMER_DOCUMENT_FILE_FRAGMENT } from './chat-document-file';
import { JourneyStateService } from './journey-state.service';

/** เอกสาร 6 ชนิดที่ล้างป้ายหลุดเมื่อเกิดหลังติดป้าย (คำตัดสินเจ้าของ 2026-09-15 ข้อ 5 + 12) — ชุดเดียวกับ interest_agg.doc_last_at */
type ClearingDoc = 'booking' | 'onlineApplication' | 'productReservation' | 'tradeIn' | 'savingPlan' | 'onlineOrder';
const CLEARING_DOCS: ClearingDoc[] = ['booking', 'onlineApplication', 'productReservation', 'tradeIn', 'savingPlan', 'onlineOrder'];
/** URL สังเคราะห์: ไฟล์เอกสาร (ตรง CUSTOMER_DOCUMENT_FILE_SQL) · ลิงก์แชร์ที่ webhook Facebook เก็บเป็น FILE (ไม่ตรง — คำตัดสินผู้ควบคุม R-P1) */
const DOC_URL = 'https://files.example.test/journey-signals/statement.pdf';
const SHARE_LINK = 'https://www.facebook.com/share/p/journey-signals/';

/**
 * สัญญาณอัตโนมัติเฟส 3 ใน journey-state.sql กับ Postgres จริง (คำตัดสินเจ้าของ 2026-09-15 ข้อ 5 · 11 · 12 · 13)
 * - ไฟล์เอกสารที่ลูกค้าส่งในแชท (R-P1: pdf / doc / xls) → ขั้น 3 ตรวจเครดิต โดยไม่ตั้ง path · media_url ว่าง / ลิงก์แชร์ / รูป ไม่นับ
 * - แผนออมเครื่อง / คำสั่งซื้อออนไลน์ → หลักฐานขั้น 4 นัด / จอง
 * - เอกสาร 6 ชนิดหลังติดป้ายหลุด → ล้างป้าย · นัดหมาย / ใบตรวจเครดิต / สัญญา ไม่ล้าง
 * - ตัวตรวจความเคลื่อนไหวเห็นสองตารางใหม่
 * ข้อมูลสังเคราะห์ทั้งหมด · audit_logs ลบไม่ได้ (trigger) ⇒ ผู้ใช้ของ spec ถูกปล่อยไว้ ตามแบบ journey-state.service.db.spec.ts
 * ใบจองทุกใบในไฟล์นี้ status EXPIRED (ห้ามถอด): product_reservations มี partial unique index product_reservations_active_product_idx
 *   (product_id WHERE status = 'ACTIVE' — migration 20260986000000) และทุกใบใช้ productId เดียวกัน ⇒ ACTIVE ใบที่สองชน P2002 ·
 *   interest_agg / doc_last_at นับใบจองทุกสถานะ จึงไม่เปลี่ยนผลของเทส
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('JourneyStateService — สัญญาณอัตโนมัติเฟส 3 (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const todoIds: string[] = [];
  const contractIds: string[] = [];
  const bookingIds: string[] = [];
  const applicationIds: string[] = [];
  const reservationIds: string[] = [];
  const tradeInIds: string[] = [];
  const savingPlanIds: string[] = [];
  const orderIds: string[] = [];
  let seq = 0;
  let branchId: string;
  let productId: string;
  let userId: string;

  /** เลขเอกสารไม่ซ้ำข้ามรอบรัน (tail) และภายในรอบ (seq) */
  const docNo = (prefix: string) => `${prefix}-${tail}-${seq++}`;
  const recomputed = async (customerId: string) => {
    await service.recompute([customerId]);
    return prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId } });
  };

  /** ไม่มีเบอร์ · chat = ผู้สนใจจากแชท Facebook · ไม่ใช่ chat = ลูกค้าหน้าร้าน (WALK_IN) */
  async function customer(label: string, chat = false) {
    const row = await prisma.customer.create({
      data: {
        name: `journey signals ${label}`, phone: null, createdAt: at('2026-09-01T00:00:00.000Z'),
        ...(chat ? { acquisitionSource: 'CHAT_FACEBOOK' } : {}),
      },
    });
    customerIds.push(row.id);
    return row;
  }
  async function room(customerId: string, label: string) {
    const row = await prisma.chatRoom.create({
      data: { channel: 'FACEBOOK', externalUserId: `journey-signals-${label}-${stamp}`, customerId, createdAt: at('2026-09-01T00:00:00.000Z') },
    });
    roomIds.push(row.id);
    return row;
  }
  async function markLost(customerId: string, occurredAt: string) {
    await prisma.customerJourneyEntry.create({
      data: {
        customerId, originCustomerId: customerId, origin: 'MANUAL', kind: 'MARKED_LOST', lostReason: 'NOT_INTERESTED',
        occurredAt: at(occurredAt), actorType: 'STAFF',
      },
    });
  }
  /** status EXPIRED เสมอ — ACTIVE ได้ใบเดียวต่อเครื่อง (product_reservations_active_product_idx) · ดู docblock ของ describe */
  async function reservation(customerId: string | null, reservedAt: string) {
    const row = await prisma.productReservation.create({
      data: { productId, customerId, sessionId: docNo('journey-signals-session'), status: 'EXPIRED', reservedAt: at(reservedAt), expiresAt: at('2026-12-31T00:00:00.000Z') },
    });
    reservationIds.push(row.id);
    return row;
  }
  async function savingPlan(customerId: string, createdAt: string) {
    const row = await prisma.savingPlan.create({
      data: {
        planNumber: docNo('JSP'), customerId, targetAmount: 30000, monthlyAmount: 3000, durationMonths: 10,
        startedAt: at(createdAt), createdAt: at(createdAt),
      },
    });
    savingPlanIds.push(row.id);
    return row;
  }
  async function onlineOrder(customerId: string, createdAt: string) {
    // ใบจองของคำสั่งซื้อไม่ผูกลูกค้า (placeOrder รับใบจองนิรนามได้) ⇒ หลักฐานมาจากคำสั่งซื้ออย่างเดียว
    const hold = await reservation(null, createdAt);
    const row = await prisma.onlineOrder.create({
      data: {
        orderNumber: docNo('JOO'), customerId, productId, reservationId: hold.id, productPrice: 25000, totalAmount: 25000,
        shippingMethod: 'BRANCH_PICKUP', paymentChannel: 'PROMPTPAY_QR', status: 'PENDING_PAYMENT', createdAt: at(createdAt),
      },
    });
    orderIds.push(row.id);
    return row;
  }
  async function clearingDoc(kind: ClearingDoc, customerId: string, when: string) {
    switch (kind) {
      case 'booking': {
        const row = await prisma.booking.create({
          data: {
            bookingNumber: docNo('JBK'), customerId, branchId, depositAmount: 1000, totalAmount: 25000,
            expireDate: at('2026-12-31T00:00:00.000Z'), createdById: userId, createdAt: at(when),
          },
        });
        bookingIds.push(row.id);
        return;
      }
      case 'onlineApplication': {
        const row = await prisma.onlineInstallmentApplication.create({
          data: {
            applicationNumber: docNo('JAP'), customerId, productId, fullName: 'journey signals applicant', phone: '0860000000', nationalId: '0000000000000',
            proposedDownPayment: 5000, proposedTotalMonths: 10, proposedMonthlyPayment: 2400, createdAt: at(when),
          },
        });
        applicationIds.push(row.id);
        return;
      }
      case 'productReservation':
        await reservation(customerId, when);
        return;
      case 'tradeIn': {
        const row = await prisma.tradeIn.create({ data: { customerId, deviceBrand: 'Apple', deviceModel: 'iPhone 13', createdAt: at(when) } });
        tradeInIds.push(row.id);
        return;
      }
      case 'savingPlan':
        await savingPlan(customerId, when);
        return;
      case 'onlineOrder':
        await onlineOrder(customerId, when);
        return;
    }
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey signals spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-signals-${stamp}@spec.local`, password: 'x', name: 'journey signals spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey signals phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.todo.deleteMany({ where: { id: { in: todoIds } } });
    await prisma.onlineOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.productReservation.deleteMany({ where: { id: { in: reservationIds } } });
    await prisma.savingPlan.deleteMany({ where: { id: { in: savingPlanIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.onlineInstallmentApplication.deleteMany({ where: { id: { in: applicationIds } } });
    await prisma.tradeIn.deleteMany({ where: { id: { in: tradeInIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.branch.deleteMany({ where: { id: branchId } });
    await prisma.$disconnect();
  });

  describe('ไฟล์ที่ลูกค้าส่งในแชท → ขั้น 3 ตรวจเครดิต (ไม่ตั้ง path)', () => {
    it('ไฟล์เอกสารของ CUSTOMER อย่างเดียว → CREDIT · creditAt = ไฟล์เอกสารแรก (ลิงก์แชร์ที่มาก่อนไม่นับ) · path UNKNOWN · ไม่ขึ้นขั้นอื่น', async () => {
      const c = await customer('file only', true);
      const r = await room(c.id, 'file-only');
      await prisma.chatMessage.createMany({
        data: [
          { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-10T01:00:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: SHARE_LINK, createdAt: at('2026-09-10T01:02:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-10T01:05:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-11T02:00:00.000Z') },
        ],
      });
      const s = await recomputed(c.id);
      expect(s).toMatchObject({ stage: 'CREDIT', path: 'UNKNOWN', identifiedAt: null, interestedAt: null, firstPurchaseAt: null });
      expect(s.creditAt?.toISOString()).toBe('2026-09-10T01:05:00.000Z');
      expect(s.stageEnteredAt.toISOString()).toBe('2026-09-10T01:05:00.000Z');
    });

    it('ไฟล์ที่ไม่ใช่เอกสาร (media_url ว่าง · ลิงก์แชร์ facebook.com · รูป .jpg) ไม่นับ → คงขั้น CONTACTED · creditAt ว่าง', async () => {
      const c = await customer('non-document files', true);
      const r = await room(c.id, 'non-document');
      await prisma.chatMessage.createMany({
        data: [
          { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-10T01:00:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: null, createdAt: at('2026-09-10T01:05:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: SHARE_LINK, createdAt: at('2026-09-10T01:06:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/photo.jpg', createdAt: at('2026-09-10T01:07:00.000Z') },
        ],
      });
      expect(await recomputed(c.id)).toMatchObject({ stage: 'CONTACTED', path: 'UNKNOWN', creditAt: null });
    });

    it('ไฟล์ของ STAFF และรูปภาพของลูกค้า ไม่นับแม้ลิงก์ลงท้าย .pdf → คงขั้น CONTACTED · creditAt ว่าง', async () => {
      const c = await customer('staff file and customer image', true);
      const r = await room(c.id, 'staff-file');
      await prisma.chatMessage.createMany({
        data: [
          { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-10T01:00:00.000Z') },
          { roomId: r.id, role: 'STAFF', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-10T01:10:00.000Z'), outboundSentAt: at('2026-09-10T01:10:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'IMAGE', mediaUrl: DOC_URL, createdAt: at('2026-09-10T01:20:00.000Z') },
        ],
      });
      expect(await recomputed(c.id)).toMatchObject({ stage: 'CONTACTED', path: 'UNKNOWN', creditAt: null });
    });

    it('ไฟล์เอกสารของลูกค้าที่ถูก soft-delete (retention) ยังนับ', async () => {
      const c = await customer('deleted file', true);
      const r = await room(c.id, 'deleted-file');
      await prisma.chatMessage.create({
        data: { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-10T03:00:00.000Z'), deletedAt: at('2026-09-12T00:00:00.000Z') },
      });
      const s = await recomputed(c.id);
      expect(s).toMatchObject({ stage: 'CREDIT', path: 'UNKNOWN' });
      expect(s.creditAt?.toISOString()).toBe('2026-09-10T03:00:00.000Z');
    });

    it('ไฟล์เอกสาร + ใบตรวจเครดิต → path INSTALLMENT · creditAt = อันที่มาก่อน (ทั้งสองทิศ)', async () => {
      const fileFirst = await customer('file then credit check', true);
      const r1 = await room(fileFirst.id, 'file-then-check');
      await prisma.chatMessage.create({ data: { roomId: r1.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-02T03:00:00.000Z') } });
      await prisma.creditCheck.create({ data: { customerId: fileFirst.id, createdAt: at('2026-09-03T00:00:00.000Z') } });
      const a = await recomputed(fileFirst.id);
      expect(a).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT' });
      expect(a.creditAt?.toISOString()).toBe('2026-09-02T03:00:00.000Z');

      const checkFirst = await customer('credit check then file', true);
      const r2 = await room(checkFirst.id, 'check-then-file');
      await prisma.creditCheck.create({ data: { customerId: checkFirst.id, createdAt: at('2026-09-02T00:00:00.000Z') } });
      await prisma.chatMessage.create({ data: { roomId: r2.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-04T00:00:00.000Z') } });
      const b = await recomputed(checkFirst.id);
      expect(b).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT' });
      expect(b.creditAt?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    });
  });

  describe('แผนออมเครื่อง / คำสั่งซื้อออนไลน์ → ขั้น 4 นัด / จอง', () => {
    it('แผนออมเครื่อง → INTERESTED · interestedAt = เวลาสร้างแผน · แผนที่ถูกลบไม่นับ', async () => {
      const c = await customer('saving plan');
      const plan = await savingPlan(c.id, '2026-09-05T02:00:00.000Z');
      const s = await recomputed(c.id);
      expect(s.stage).toBe('INTERESTED');
      expect(s.interestedAt?.toISOString()).toBe('2026-09-05T02:00:00.000Z');
      expect(s.stageEnteredAt.toISOString()).toBe('2026-09-05T02:00:00.000Z');

      await prisma.savingPlan.update({ where: { id: plan.id }, data: { deletedAt: at('2026-09-06T00:00:00.000Z') } });
      expect(await recomputed(c.id)).toMatchObject({ stage: 'CONTACTED', interestedAt: null });
    });

    it('คำสั่งซื้อออนไลน์ (ใบจองของคำสั่งซื้อไม่ผูกลูกค้า) → INTERESTED · interestedAt = เวลาสั่งซื้อ', async () => {
      const c = await customer('online order');
      await onlineOrder(c.id, '2026-09-07T04:00:00.000Z');
      const s = await recomputed(c.id);
      expect(s.stage).toBe('INTERESTED');
      expect(s.interestedAt?.toISOString()).toBe('2026-09-07T04:00:00.000Z');
    });
  });

  describe('ป้ายหลุด: เอกสาร 6 ชนิดหลังติดป้ายล้างป้าย · อย่างอื่นไม่ล้าง', () => {
    it.each(CLEARING_DOCS)('%s หลังติดป้ายหลุด → lostAt / lostReason ว่าง', async (kind) => {
      const c = await customer(`lost then ${kind}`);
      await markLost(c.id, '2026-09-03T00:00:00.000Z');
      expect((await recomputed(c.id)).lostAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');

      await clearingDoc(kind, c.id, '2026-09-04T00:00:00.000Z');
      expect(await recomputed(c.id)).toMatchObject({ lostAt: null, lostReason: null, stage: 'INTERESTED' });
    });

    it.each(CLEARING_DOCS)('%s ก่อนติดป้ายหลุด → ยังหลุด', async (kind) => {
      const c = await customer(`${kind} then lost`);
      await clearingDoc(kind, c.id, '2026-09-02T00:00:00.000Z');
      await markLost(c.id, '2026-09-03T00:00:00.000Z');
      const s = await recomputed(c.id);
      expect(s).toMatchObject({ lostReason: 'NOT_INTERESTED', stage: 'INTERESTED' });
      expect(s.lostAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    });

    it('เอกสารเวลาเดียวกับป้ายพอดี → ยังหลุด (กติกาเดียวกับข้อความลูกค้า / TOUCHPOINT)', async () => {
      const c = await customer('document at mark');
      await markLost(c.id, '2026-09-03T00:00:00.000Z');
      await clearingDoc('savingPlan', c.id, '2026-09-03T00:00:00.000Z');
      expect((await recomputed(c.id)).lostAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    });

    it('นัดหมาย (todo มีวันนัด) / ใบตรวจเครดิต / สัญญาร่าง หลังติดป้าย → ยังหลุด แม้ขั้นจะขยับ', async () => {
      const c = await customer('lost then staff documents', true);
      const r = await room(c.id, 'lost-staff-docs');
      await markLost(c.id, '2026-09-03T00:00:00.000Z');
      const todo = await prisma.todo.create({
        data: { title: 'นัดดูเครื่อง', createdById: userId, roomId: r.id, dueDate: at('2026-09-08T03:00:00.000Z'), createdAt: at('2026-09-04T00:00:00.000Z') },
      });
      todoIds.push(todo.id);
      await prisma.creditCheck.create({ data: { customerId: c.id, createdAt: at('2026-09-05T00:00:00.000Z') } });
      const draft = await prisma.contract.create({
        data: {
          contractNumber: docNo('JSC'), customerId: c.id, productId, branchId, salespersonId: userId, planType: 'STORE_WITH_INTEREST',
          sellingPrice: 25000, downPayment: 5000, interestRate: 0.02, totalMonths: 10, interestTotal: 4000, financedAmount: 20000, monthlyPayment: 2400,
          status: 'DRAFT', createdAt: at('2026-09-06T00:00:00.000Z'),
        },
      });
      contractIds.push(draft.id);
      const s = await recomputed(c.id);
      expect(s).toMatchObject({ stage: 'INTERESTED', path: 'INSTALLMENT', lostReason: 'NOT_INTERESTED' });
      expect(s.lostAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    });
  });

  describe('ตัวตรวจความเคลื่อนไหวเห็นแผนออมเครื่อง / คำสั่งซื้อออนไลน์', () => {
    it.each(['savingPlan', 'onlineOrder'] as const)('%s ใหม่ → hasActivitySince จริง · activeCustomerIdsSince มีลูกค้า', async (kind) => {
      const c = await customer(`probe ${kind}`);
      // updated_at ของลูกค้าต้องมาก่อน since และของเอกสารต้องมาหลัง since (timestamp(3) — กันค่าชนกันในมิลลิวินาทีเดียวกัน)
      await pause(20);
      const since = new Date();
      await pause(20);
      expect(await service.hasActivitySince([c.id], since)).toBe(false);
      expect(await service.activeCustomerIdsSince(since)).not.toContain(c.id);

      await clearingDoc(kind, c.id, '2026-09-04T00:00:00.000Z');
      expect(await service.hasActivitySince([c.id], since)).toBe(true);
      expect(await service.activeCustomerIdsSince(since)).toContain(c.id);
    });
  });

  describe('เงื่อนไขไฟล์เอกสาร (CUSTOMER_DOCUMENT_FILE_FRAGMENT) กับ Postgres จริง', () => {
    it('นับ: pdf / doc / docx / xls / xlsx ไม่สนตัวพิมพ์ มี query string ได้ · ไม่นับ: media_url ว่าง · ลิงก์แชร์ · รูป · นามสกุลที่แค่ขึ้นต้นเหมือน · ไฟล์ของร้าน · ชนิดอื่น', async () => {
      const cases = [
        { label: 'pdf', role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, counts: true },
        { label: 'PDF ตัวใหญ่', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/STATEMENT.PDF', counts: true },
        { label: 'pdf + query', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://cdn.example.test/v/journey-signals/slip.pdf?_nc_cat=1&oh=abc', counts: true },
        { label: 'doc', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/old.doc', counts: true },
        { label: 'docx', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/bank.docx', counts: true },
        { label: 'xls + query', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/sheet.xls?dl=1', counts: true },
        { label: 'xlsx', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/sheet.xlsx', counts: true },
        { label: 'media_url ว่าง', role: 'CUSTOMER', type: 'FILE', mediaUrl: null, counts: false },
        { label: 'ลิงก์แชร์ facebook.com', role: 'CUSTOMER', type: 'FILE', mediaUrl: SHARE_LINK, counts: false },
        { label: 'jpg', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/photo.jpg', counts: false },
        { label: 'pdfx', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/statement.pdfx', counts: false },
        { label: 'pdf.zip', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/statement.pdf.zip', counts: false },
        { label: 'ไฟล์ของร้าน', role: 'STAFF', type: 'FILE', mediaUrl: DOC_URL, counts: false },
        { label: 'รูปของลูกค้า', role: 'CUSTOMER', type: 'IMAGE', mediaUrl: DOC_URL, counts: false },
      ];
      // เงื่อนไขเดียวกับที่ journey-state.sql เขียนตรงตัวอักษร (chat-document-file.spec.ts ปักไว้) และที่ Task 4 / 5 ใช้ใน $queryRaw
      const rows = await prisma.$queryRaw<Array<{ label: string; counts: boolean }>>`
        SELECT m.label, COALESCE(${CUSTOMER_DOCUMENT_FILE_FRAGMENT}, false) AS counts
        FROM (VALUES ${Prisma.join(cases.map((c) => Prisma.sql`(${c.label}::text, ${c.role}::text, ${c.type}::text, ${c.mediaUrl}::text)`))}) AS m(label, role, type, media_url)`;
      expect(Object.fromEntries(rows.map((row) => [row.label, row.counts]))).toEqual(Object.fromEntries(cases.map((c) => [c.label, c.counts])));
    });
  });
});
```

- [ ] **Step 5: Run the spec and watch it fail**

Run (from `apps/api`):
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.signals.db.spec.ts --runInBand
```
Expected: `Tests: 15 failed, 9 passed, 24 total`
- Failing (15):
  - `ไฟล์เอกสารของ CUSTOMER อย่างเดียว` — received stage `CONTACTED`
  - `soft-delete` — received stage `CONTACTED`
  - `ไฟล์เอกสาร + ใบตรวจเครดิต` — received creditAt `2026-09-03T00:00:00.000Z`
  - both ④ tests — received stage `CONTACTED`
  - all 6 `หลังติดป้ายหลุด` — lostAt is still a Date
  - `savingPlan ก่อนติดป้ายหลุด` and `onlineOrder ก่อนติดป้ายหลุด` — received stage `CONTACTED`
  - both probe tests — `hasActivitySince` returns false
- Already passing (9): `ไฟล์ที่ไม่ใช่เอกสาร…`, `ไฟล์ของ STAFF และรูปภาพ…`, the 4 `booking / onlineApplication / productReservation / tradeIn ก่อนติดป้ายหลุด`, `เอกสารเวลาเดียวกับป้ายพอดี`, `นัดหมาย / ใบตรวจเครดิต / สัญญาร่าง…`, and the Postgres matrix `เงื่อนไขไฟล์เอกสาร (CUSTOMER_DOCUMENT_FILE_FRAGMENT) …` (it runs the Step 3 fragment directly, not `journey-state.sql`; if it fails, the fragment or Prisma nesting is wrong — fix `chat-document-file.ts`, not the cases).
- An error in `beforeAll` or in a seed call (for example a missing required column) is a spec bug: fix the seed, not the SQL.
- A `P2002` / `Unique constraint failed` on `product_reservations_active_product_idx` means a reservation was seeded ACTIVE on the shared product: put `status: 'EXPIRED'` back in `reservation()`. Never drop the index.

- [ ] **Step 6: Write the failing unit test for the "ระบบยังไม่เก็บ" wording**

In `apps/api/src/modules/customer-journey/customer-journey.service.spec.ts`:

(a) Task 2 (Step 20) already added `JOURNEY_NOT_RECORDED` to the service import and appended its own `describe('JOURNEY_NOT_RECORDED — ชื่อขั้น 4 ใหม่ …')` at the end of this file — do **not** touch the import. Confirm it first (from `apps/api`):
```bash
grep -n "JOURNEY_NOT_RECORDED, countJourneyGroups" src/modules/customer-journey/customer-journey.service.spec.ts
```
Expected: exactly one line — `import { CustomerJourneyService, JOURNEY_COUNT_CAP, JOURNEY_NOT_RECORDED, countJourneyGroups, resolveJourneyGroups } from './customer-journey.service';`. If grep prints nothing, Task 2 has not landed: stop.

(b) Replace the `summary()` test and the closing line of the main `describe('CustomerJourneyService.list + summary (Task 9)', …)` block (this text is unique — Task 2's appended `describe` comes after it and does not contain it):
```ts
  it('summary() ส่งต่อให้ JourneySummaryService', async () => {
    const { summaries, service } = setup(LIVE);
    await expect(service.summary('c1', OWNER)).resolves.toBe(SUMMARY);
    expect(summaries.summary).toHaveBeenCalledWith('c1', OWNER);
  });
});
```
with:
```ts
  it('summary() ส่งต่อให้ JourneySummaryService', async () => {
    const { summaries, service } = setup(LIVE);
    await expect(service.summary('c1', OWNER)).resolves.toBe(SUMMARY);
    expect(summaries.summary).toHaveBeenCalledWith('c1', OWNER);
  });

  it('ระบบยังไม่เก็บ: จองเว็บ / สมัครผ่อนออนไลน์ / รับซื้อ-เทิร์น นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์', () => {
    expect(JOURNEY_NOT_RECORDED).toEqual(
      expect.arrayContaining([
        'การจองสินค้าผ่านเว็บ (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
        'ใบสมัครผ่อนออนไลน์ (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
        'รายการรับซื้อ/เทิร์นเครื่อง (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
      ]),
    );
    expect(JOURNEY_NOT_RECORDED.some((line) => line.includes('สนใจจริง'))).toBe(false);
  });
});
```

Run (from `apps/api`):
```bash
NODE_ENV=test npx jest src/modules/customer-journey/customer-journey.service.spec.ts --runInBand
```
Expected: `Tests: 1 failed` — the new test (`expect.arrayContaining` does not find the `และล้างป้ายหลุด` strings). Every other test in the file passes.

- [ ] **Step 7: SQL — customer document-file messages per room and per customer**

In `apps/api/src/modules/customer-journey/sql/journey-state.sql`, first update the file header comment (line 4) in place — this task starts reading `media_url`, only inside the customer document-file condition. Replace:
```sql
-- 🚨 PDPA: ไม่อ่าน content ของ chat_messages / note ของ entries · phone, national_id ใช้แค่ IS NOT NULL
```
with:
```sql
-- 🚨 PDPA: ไม่อ่าน content ของ chat_messages / note ของ entries · media_url ใช้เฉพาะในเงื่อนไขไฟล์เอกสารของลูกค้า (pdf / doc / xls — FILTER ใน CTE rooms) ไม่เลือกออกมา · phone, national_id ใช้แค่ IS NOT NULL
```
(One line stays one line, so no line number moves. The comment names the extensions without the regex and without the quoted type literal, so `chat-document-file.spec.ts` still finds the condition and the type literal exactly once.)

In the `rooms` CTE select list, replace:
```sql
         cm.first_customer_at, cm.last_customer_at,
```
with:
```sql
         cm.first_customer_at, cm.last_customer_at, cm.first_file_at,
```
In the same CTE's LATERAL, replace:
```sql
    SELECT MIN(m.created_at) AS first_customer_at, MAX(m.created_at) AS last_customer_at
    FROM chat_messages m
    WHERE m.room_id = r.id AND m.role = 'CUSTOMER'
```
with (the FILTER condition is `CUSTOMER_DOCUMENT_FILE_SQL` from Step 3 **byte for byte** — copy it exactly; `chat-document-file.spec.ts` compares the two):
```sql
    -- first_file_at = ไฟล์เอกสารแรกที่ลูกค้าส่ง = หลักฐานขั้น 3 ตรวจเครดิต แต่ไม่ตั้ง path (คำตัดสิน 2026-09-15 ข้อ 11 + 13)
    -- เงื่อนไขใน FILTER = CUSTOMER_DOCUMENT_FILE_SQL ของ chat-document-file.ts ตรงตัวอักษร (คำตัดสินผู้ควบคุม R-P1 · chat-document-file.spec.ts ปักไว้ แก้ต้องแก้คู่กัน)
    --   webhook Facebook เก็บไฟล์แนบชนิดที่ไม่รู้จัก (fallback/template เช่นแชร์ลิงก์) เป็นชนิดไฟล์ ⇒ นับเฉพาะ media_url ที่ลงท้ายด้วยนามสกุลเอกสาร
    -- 🔴 PDPA: media_url อยู่ใน FILTER เท่านั้น ไม่ออกจาก CTE นี้ · ห้าม text / media_type · นับแถว soft-delete เหมือนสองคอลัมน์ข้างบน (retention ไม่ถอยขั้น)
    SELECT MIN(m.created_at) AS first_customer_at, MAX(m.created_at) AS last_customer_at,
           MIN(m.created_at) FILTER (WHERE m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '\.(pdf|docx?|xlsx?)(\?|$)') AS first_file_at
    FROM chat_messages m
    WHERE m.room_id = r.id AND m.role = 'CUSTOMER'
```
In `room_agg`, replace:
```sql
  SELECT ro.customer_id, MAX(ro.last_customer_at) AS last_customer_at FROM rooms ro GROUP BY ro.customer_id
```
with:
```sql
  SELECT ro.customer_id, MAX(ro.last_customer_at) AS last_customer_at, MIN(ro.first_file_at) AS first_file_at
  FROM rooms ro GROUP BY ro.customer_id
```

Run (from `apps/api`):
```bash
NODE_ENV=test npx jest src/modules/customer-journey/chat-document-file.spec.ts --runInBand
```
Expected: `Tests: 4 passed, 4 total` (the two tests that failed in Step 3 now pass — the SQL file holds the condition once, and no other file copies it).

- [ ] **Step 8: SQL — the document file joins `credit_at`; `path` comes only from credit documents**

In `base`, replace:
```sql
         LEAST(ia.at, ta.at, ea.manual_interest_at) AS interested_at,
         LEAST(ca.at, rca.at) AS credit_at,
```
with:
```sql
         LEAST(ia.at, ta.at, ea.manual_interest_at) AS interested_at,
         -- credit_doc_at = หลักฐานเครดิตจากเอกสาร (ใบตรวจเครดิต / สัญญา / วิเคราะห์สเตทเม้น) — ตัวเดียวที่ตั้ง path INSTALLMENT · ใช้ในคำสั่งนี้เท่านั้น ไม่เก็บลงแคช
         -- credit_at = credit_doc_at + ไฟล์เอกสารแรกที่ลูกค้าส่งในแชท (ไฟล์นับขั้น 3 แต่ห้ามตั้ง path)
         LEAST(ca.at, rca.at) AS credit_doc_at,
         LEAST(ca.at, rca.at, ra.first_file_at) AS credit_at,
```
In `resolved`, replace:
```sql
         CASE WHEN s.bought THEN s.first_purchase_kind
              WHEN s.credit_at IS NOT NULL THEN 'INSTALLMENT'
              ELSE 'UNKNOWN' END AS path,
```
with:
```sql
         CASE WHEN s.bought THEN s.first_purchase_kind
              WHEN s.credit_doc_at IS NOT NULL THEN 'INSTALLMENT'
              ELSE 'UNKNOWN' END AS path,
```
Nothing new is stored: `shaped` selects `b.*` and `resolved` selects `s.*`, so `credit_doc_at` flows through, while the `INSERT` lists its columns explicitly.

Run (from `apps/api`):
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.signals.db.spec.ts --runInBand -t "ไฟล์ที่ลูกค้าส่งในแชท"
```
Expected: `Tests: 19 skipped, 5 passed, 24 total` (the Postgres matrix is outside this describe and is skipped)

- [ ] **Step 9: SQL — saving plans and online orders as ④ evidence, plus the six clearing documents**

In `journey-state.sql`, replace the whole `interest_agg` CTE:
```sql
interest_agg AS (
  SELECT f.customer_id, MIN(x.at) AS at
  FROM family f
  CROSS JOIN LATERAL (
    SELECT b.created_at AS at FROM bookings b WHERE b.customer_id = f.member_id AND b.deleted_at IS NULL
    UNION ALL
    SELECT a.created_at FROM online_installment_applications a WHERE a.customer_id = f.member_id AND a.deleted_at IS NULL
    UNION ALL
    SELECT pr.reserved_at FROM product_reservations pr WHERE pr.customer_id = f.member_id
    UNION ALL
    SELECT ti.created_at FROM trade_ins ti WHERE ti.customer_id = f.member_id AND ti.deleted_at IS NULL
    UNION ALL
    SELECT al.created_at FROM audit_logs al WHERE al.entity = 'customer' AND al.entity_id = f.member_id AND al.action = 'AI_LEAD_CAPTURED'
  ) x
  GROUP BY f.customer_id
),
```
with:
```sql
interest_agg AS (
  -- at = หลักฐานขั้น 4 นัด / จอง ที่มาก่อนสุด
  -- doc_last_at = เอกสารล่าสุดใน 6 ชนิดที่ล้างป้ายหลุด (คำตัดสินเจ้าของ 2026-09-15 ข้อ 5 + 12): ใบจอง · ใบสมัครผ่อนออนไลน์ · จองเครื่อง ·
  --   เทิร์นเครื่อง · แผนออมเครื่อง · คำสั่งซื้อออนไลน์ — ทุกสถานะ แถวที่ไม่ถูกลบ (product_reservations ไม่มี deleted_at)
  -- AI_LEAD_CAPTURED นับขั้นอย่างเดียว ไม่ล้างป้าย · นัดหมาย (todo_agg) / ใบตรวจเครดิต / สัญญา ไม่อยู่ใน CTE นี้ จึงไม่ล้างป้าย
  SELECT f.customer_id, MIN(x.at) AS at, MAX(x.at) FILTER (WHERE x.clears_lost) AS doc_last_at
  FROM family f
  CROSS JOIN LATERAL (
    SELECT b.created_at AS at, true AS clears_lost FROM bookings b WHERE b.customer_id = f.member_id AND b.deleted_at IS NULL
    UNION ALL
    SELECT a.created_at, true FROM online_installment_applications a WHERE a.customer_id = f.member_id AND a.deleted_at IS NULL
    UNION ALL
    SELECT pr.reserved_at, true FROM product_reservations pr WHERE pr.customer_id = f.member_id
    UNION ALL
    SELECT ti.created_at, true FROM trade_ins ti WHERE ti.customer_id = f.member_id AND ti.deleted_at IS NULL
    UNION ALL
    SELECT sp.created_at, true FROM saving_plans sp WHERE sp.customer_id = f.member_id AND sp.deleted_at IS NULL
    UNION ALL
    SELECT oo.created_at, true FROM online_orders oo WHERE oo.customer_id = f.member_id AND oo.deleted_at IS NULL
    UNION ALL
    SELECT al.created_at, false FROM audit_logs al WHERE al.entity = 'customer' AND al.entity_id = f.member_id AND al.action = 'AI_LEAD_CAPTURED'
  ) x
  GROUP BY f.customer_id
),
```
In `base`, replace:
```sql
         lm.kind AS lost_kind, lm.occurred_at AS lost_mark_at, lm.lost_reason AS lost_mark_reason
```
with:
```sql
         lm.kind AS lost_kind, lm.occurred_at AS lost_mark_at, lm.lost_reason AS lost_mark_reason, ia.doc_last_at
```
In `resolved`, replace:
```sql
                   AND (s.last_touch_at IS NULL OR s.last_touch_at <= s.lost_mark_at)
              THEN s.lost_mark_at END AS lost_at
```
with:
```sql
                   AND (s.last_touch_at IS NULL OR s.last_touch_at <= s.lost_mark_at)
                   -- เอกสาร 6 ชนิดหลังติดป้าย (interest_agg.doc_last_at) ล้างป้าย · เวลาเท่ากับป้ายพอดีไม่ล้าง (กติกาเดียวกับข้อความ/TOUCHPOINT)
                   AND (s.doc_last_at IS NULL OR s.doc_last_at <= s.lost_mark_at)
              THEN s.lost_mark_at END AS lost_at
```

Run (from `apps/api`):
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.signals.db.spec.ts --runInBand -t "ขั้น 4 นัด / จอง|ป้ายหลุด"
```
Expected: `Tests: 8 skipped, 16 passed, 24 total`

- [ ] **Step 10: Activity probes see saving plans and online orders**

In `apps/api/src/modules/customer-journey/sql/journey-activity-probe.sql`, replace:
```sql
  OR EXISTS (SELECT 1 FROM trade_ins ti WHERE ti.customer_id = ANY($1::text[]) AND ti.updated_at > $2::timestamp)
```
with:
```sql
  OR EXISTS (SELECT 1 FROM trade_ins ti WHERE ti.customer_id = ANY($1::text[]) AND ti.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM saving_plans sp WHERE sp.customer_id = ANY($1::text[]) AND sp.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM online_orders oo WHERE oo.customer_id = ANY($1::text[]) AND oo.updated_at > $2::timestamp)
```
In `apps/api/src/modules/customer-journey/sql/journey-active-since.sql`, replace:
```sql
  UNION SELECT ti.customer_id FROM trade_ins ti WHERE ti.updated_at >= $1::timestamp
```
with:
```sql
  UNION SELECT ti.customer_id FROM trade_ins ti WHERE ti.updated_at >= $1::timestamp
  UNION SELECT sp.customer_id FROM saving_plans sp WHERE sp.updated_at >= $1::timestamp
  UNION SELECT oo.customer_id FROM online_orders oo WHERE oo.updated_at >= $1::timestamp
```

Run (from `apps/api`) once in Bangkok time and once in UTC, like CI:
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.signals.db.spec.ts --runInBand
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=UTC NODE_ENV=test npx jest src/modules/customer-journey/journey-state.signals.db.spec.ts --runInBand
```
Expected: both runs print `Tests: 24 passed, 24 total`.

- [ ] **Step 11: "ระบบยังไม่เก็บ" wording — the three documents also clear lost**

In `apps/api/src/modules/customer-journey/customer-journey.service.ts`, inside `JOURNEY_NOT_RECORDED`, replace the three string lines left by Task 2 **and the `//` comment line directly above them**. After Task 2 that comment may still say `ขั้น "สนใจจริง / นัด-จอง"`; replace it either way.

The three lines as left by Task 2:
```ts
  'การจองสินค้าผ่านเว็บ (ใช้นับขั้น "นัด / จอง" แต่ยังไม่แสดงเป็นเหตุการณ์)',
  'ใบสมัครผ่อนออนไลน์ (ใช้นับขั้น "นัด / จอง" แต่ยังไม่แสดงเป็นเหตุการณ์)',
  'รายการรับซื้อ/เทิร์นเครื่อง (ใช้นับขั้น "นัด / จอง" แต่ยังไม่แสดงเป็นเหตุการณ์)',
```
New four lines (comment + strings):
```ts
  // ขั้น "นัด / จอง" บนแถบนับจากสามอย่างนี้ด้วย และรายการใหม่หลังติดป้ายหลุดล้างป้ายได้ (journey-state.sql interest_agg.doc_last_at) แต่ยังไม่ขึ้นเป็นเหตุการณ์ในแท็บ
  'การจองสินค้าผ่านเว็บ (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
  'ใบสมัครผ่อนออนไลน์ (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
  'รายการรับซื้อ/เทิร์นเครื่อง (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
```
Saving plans and online orders get no line here, because Task 6 shows them as timeline rows. Task 6 also adds rows for these three documents and then deletes these four lines (and rewrites the test from Step 6); the wording here keeps this task's own commit truthful in between.

Run (from `apps/api`):
```bash
NODE_ENV=test npx jest src/modules/customer-journey/customer-journey.service.spec.ts --runInBand
```
Expected: every test in the file passes (`0 failed`).

- [ ] **Step 12: Regression — every suite that runs journey-state.sql, types, lint**

Run (from `apps/api`):
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey src/cli/backfill-customer-journey src/modules/chat-prospects/customer-merge.service src/modules/pdpa/pdpa-dsar-journey --runInBand
npx tsc --noEmit -p tsconfig.json
npx eslint src/modules/customer-journey/chat-document-file.ts src/modules/customer-journey/chat-document-file.spec.ts src/modules/customer-journey/journey-state.signals.db.spec.ts src/modules/customer-journey/customer-journey.service.ts src/modules/customer-journey/customer-journey.service.spec.ts
```
Expected:
- jest: every suite passes (`0 failed`). The run includes:
  - `chat-document-file.spec.ts` (4 tests — the single-source pin)
  - `journey-state.service.db.spec.ts`, `journey-state.activity.db.spec.ts` and Task 2's `journey-state.stage-order.db.spec.ts`
  - `journey-summary.service.db.spec.ts` and `customer-journey.pdpa.db.spec.ts`
  - `backfill-customer-journey.db.spec.ts`, `customer-merge.service.db.spec.ts` and `pdpa-dsar-journey.db.spec.ts`
- `tsc`: no output, exit code 0.
- `eslint`: `0 errors`. Warnings for `prisma as any` match the existing DB specs.
- 🚨 Never run `npm run lint` in `apps/api` (it runs `--fix`).

- [ ] **Step 13: Spec — ③ evidence, ④ evidence, lost clearing rule**

Task 2 reorders the stage sections, so anchor each edit by the bullet text. Each anchor is unique in the file; `grep -n` it first.

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md`, section `ตรวจเครดิต (CREDIT)`, replace:
```markdown
- contracts.created_at (deleted_at null)
```
with:
```markdown
- contracts.created_at (deleted_at null)
- ข้อความ CUSTOMER ชนิด FILE ที่เป็นไฟล์เอกสารในห้องของลูกค้า: media_url ลงท้ายด้วย .pdf / .doc / .docx / .xls / .xlsx (ไม่สนตัวพิมพ์ · ตามด้วย ? ได้) — เงื่อนไขเดียวทั้งระบบคือ `CUSTOMER_DOCUMENT_FILE_SQL` ใน `apps/api/src/modules/customer-journey/chat-document-file.ts` (journey-state.sql เขียนตรงตัวอักษร เทสปักไว้ · คำตัดสินผู้ควบคุม R-P1) · นับแถว soft-delete · media_url ใช้ในเงื่อนไขเท่านั้น ไม่เลือกออกมา · ไม่อ่าน text / media_type / ชื่อไฟล์ · ไม่นับ: รูปภาพ · ไฟล์ของร้าน · media_url ว่าง · ลิงก์แชร์ (webhook Facebook เก็บไฟล์แนบชนิดที่ไม่รู้จัก เช่น fallback / template เป็น FILE) · **ไม่ตั้ง path** (คำตัดสินเจ้าของ 2026-09-15 ข้อ 11 + 13) · สัญญาณมาจาก Facebook อย่างเดียว · แก้ตัวแปลงของ webhook อยู่นอกเฟส 3
```
In the same section, replace:
```markdown
ตั้ง path=INSTALLMENT
```
with:
```markdown
ตั้ง path=INSTALLMENT เฉพาะจากใบตรวจเครดิต / วิเคราะห์สเตทเม้นจากแชท / สัญญา — ไฟล์เอกสารในแชทอย่างเดียวให้ขั้นนี้แต่ path คง UNKNOWN
```
In section `นัด / จอง (INTERESTED)`, replace:
```markdown
- trade_ins.created_at (customer_id)
```
with:
```markdown
- trade_ins.created_at (customer_id)
- saving_plans.created_at (แผนออมเครื่อง · deleted_at null · ทุกสถานะ)
- online_orders.created_at (คำสั่งซื้อออนไลน์ · deleted_at null · ทุกสถานะ)
```
In section `ป้ายหลุด (LOST) และเงียบ — ไม่ใช่ขั้น`, replace:
```markdown
- ล้างเองเมื่อมีข้อความ CUSTOMER ใหม่ หรือ TOUCHPOINT หลัง lostAt (ไทม์ไลน์แสดง 'กลับมาติดต่ออีกครั้ง') หรือกดปุ่ม 'เปิดใหม่'
```
with:
```markdown
- ล้างเองเมื่อมีสิ่งใดสิ่งหนึ่งต่อไปนี้ **หลัง** lostAt (เวลาเท่ากับ lostAt พอดีไม่ล้าง) หรือกดปุ่ม 'เปิดใหม่':
  - ข้อความ CUSTOMER ใหม่ในห้องใดก็ได้ของลูกค้า (รวมไฟล์ · รวมแถว soft-delete) — ไทม์ไลน์แสดง 'กลับมาติดต่ออีกครั้ง'
  - TOUCHPOINT ใหม่
  - เอกสาร 6 ชนิดใหม่ (ทุกสถานะ · ตารางที่มี deleted_at นับเฉพาะแถวที่ไม่ถูกลบ): bookings.created_at · online_installment_applications.created_at · product_reservations.reserved_at · trade_ins.created_at · saving_plans.created_at · online_orders.created_at — ไม่มีแถว 'กลับมาติดต่ออีกครั้ง' (แถวของเอกสารอธิบายเอง)
- ไม่ล้างป้าย: นัดหมาย (todos) · ใบตรวจเครดิต / วิเคราะห์สเตทเม้นจากแชท · สัญญา · บอทจดความสนใจ (AI_LEAD_CAPTURED) — คำตัดสินเจ้าของ 2026-09-15 ข้อ 5 + 12 ระบุเฉพาะเอกสาร 6 ชนิดข้างบน
```

Run (from the worktree root):
```bash
grep -n "ข้อความ CUSTOMER ชนิด FILE\|saving_plans.created_at\|online_orders.created_at\|ไม่ล้างป้าย:" docs/superpowers/specs/2026-09-15-customer-journey-design.md
```
Expected: 5 lines
- the document-file (`ข้อความ CUSTOMER ชนิด FILE ที่เป็นไฟล์เอกสาร…`) bullet
- the `saving_plans.created_at` and `online_orders.created_at` bullets under ④
- the six-document bullet (it contains both table names, but grep prints the line once)
- the `ไม่ล้างป้าย:` bullet

- [ ] **Step 14: Runbook — count-only pre-merge check of the document-file signal (`### 1.6` inside §1)**

This gate must run **before** merge, so it lives inside `## 1. 🚨 ด่านก่อน merge` (not at the end of the file, where an owner following the order table would never reach it in time). Task 2 created `### 1.1`–`### 1.4`; `### 1.5` is reserved for Task 9 (ad-source count), which inserts it directly above this task's `### 1.6` later — so a gap between 1.4 and 1.6 is expected until Task 9 lands. No `## ` heading is added (Task 2's `grep -c '^## '` count of `8` stays).

In `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md`:

(a) In the table under `## ลำดับห้ามสลับ`, replace row 1 (exact text as Task 2 wrote it):
```markdown
| 1 | ด่านก่อน merge — PR "ร้านตอบครั้งแรก" ขึ้นและจบแล้ว · จดของเดิมไว้ถอย · นับก่อน · ช่วงเวลา |
```
with:
```markdown
| 1 | ด่านก่อน merge — PR "ร้านตอบครั้งแรก" ขึ้นและจบแล้ว · จดของเดิมไว้ถอย · นับก่อน · ช่วงเวลา · นับห้องที่ลูกค้าส่งไฟล์ในแชท (1.6) |
```
Task 9 Step 22 (a) anchors on this exact new text (it adds `(1.5)` before `(1.6)`), so copy it byte for byte.

(b) Insert this block immediately **before** the line `## 2. merge PR นี้ + ด่านหลัง merge` (i.e. directly after the last bullet of `### 1.4 ช่วงเวลาที่ merge ได้`), followed by one blank line:
~~~~markdown
### 1.6 นับห้องที่ลูกค้าส่งไฟล์ในแชท (MCP นับอย่างเดียว · Task 3)

หลัง deploy และ `backfill:customer-journey` ผู้สนใจทุกคนที่เคยส่งไฟล์เอกสารในแชทจะขึ้นขั้น 3 ตรวจเครดิต ⇒ นับก่อนกด merge

- "ไฟล์เอกสาร" = `chat_messages` role `CUSTOMER` + type `FILE` + `media_url` ลงท้ายด้วย .pdf / .doc / .docx / .xls / .xlsx (ไม่สนตัวพิมพ์ · ตามด้วย `?` ได้) — เงื่อนไขเดียวกับโค้ด (`CUSTOMER_DOCUMENT_FILE_SQL` ใน `apps/api/src/modules/customer-journey/chat-document-file.ts` · คำตัดสินผู้ควบคุม R-P1)
- ใช้ MCP `bestchoice-db` (อ่านอย่างเดียว — `mcp_ro` มีสิทธิ์คอลัมน์ `media_url` อยู่แล้ว) หรือ psql ผ่าน cloud-sql-proxy
- **นับอย่างเดียว** — `media_url` อยู่ใน WHERE เท่านั้น · ห้ามเลือกคอลัมน์เนื้อหา (`text` / `media_url` / `media_type`) ออกมา และห้ามดึง `room_id` ออกมาเป็นรายการ

```sql
SELECT count(DISTINCT m.room_id) AS rooms_with_customer_document,
       count(*) AS customer_documents
FROM chat_messages m
WHERE m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '\.(pdf|docx?|xlsx?)(\?|$)';
```

- ตัวเทียบ (นับรวมอย่างเดียว 2026-09-15): ประมาณ 416 ห้อง (818 ไฟล์ .pdf + เอกสาร office 1 ไฟล์) · จดตัวเลขที่ได้ลง PR
- ตัวเลขสูงกว่าตัวเทียบมาก = แจ้งเจ้าของก่อน merge (ห้องเหล่านั้นทั้งหมดจะขึ้นขั้น 3 ทันทีหลัง backfill)
- ⚠️ สิ่งที่เจ้าของต้องรู้: webhook Facebook (`facebook-webhook.controller.ts` `parseMessage`) เก็บไฟล์แนบชนิดที่ไม่รู้จัก (`fallback` / `template` เช่นลูกค้าแชร์ลิงก์หรือโพสต์) เป็น `FILE` (`attachmentTypeMap[attachment.type] ?? MessageType.FILE`)
  - เงื่อนไขนามสกุลเอกสารกันไว้แล้ว: `media_url` ว่าง (ประมาณ 48 ห้อง) และลิงก์ facebook.com (ประมาณ 25 ห้อง) ไม่นับ ไม่ขึ้นขั้น 3
  - เลิกแปลงลิงก์แชร์เป็น `FILE` ที่ตัวแปลงของ webhook = งานต่อยอดนอกเฟส 3 (เจ้าของตัดสิน)
  - สัญญาณมาจาก Facebook อย่างเดียว (LINE ขาเข้าไม่เคยเขียน FILE)
- สัญญาณนี้ไม่มีคอลัมน์ใหม่และไม่ตั้ง path ⇒ ถอย API image = คำนวณแคชใหม่ด้วย backfill ตัวเดียวกัน (ไม่มีข้อมูลต้องล้าง)
~~~~

Run (from the worktree root):
```bash
grep -n '^| 1 | ด่านก่อน merge\|^### 1.4 \|^### 1.6 \|^## 2. merge PR นี้' docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -c '^## ' docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -c 'ด่านก่อน merge — ปริมาณสัญญาณ' docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
```
Expected:
- The first command prints 4 lines in this order: the table row `| 1 | … นับห้องที่ลูกค้าส่งไฟล์ในแชท (1.6) |`, `### 1.4 ช่วงเวลาที่ merge ได้`, `### 1.6 นับห้องที่ลูกค้าส่งไฟล์ในแชท (MCP นับอย่างเดียว · Task 3)`, `## 2. merge PR นี้ + ด่านหลัง merge` — `### 1.6` sits between `### 1.4` and `## 2.`.
- The second prints `8` (unchanged from Task 2).
- The third prints `0` (no end-of-file copy of this gate).

- [ ] **Step 15: Commit**

Run (from the worktree root):
```bash
git add apps/api/src/modules/customer-journey/chat-document-file.ts \
  apps/api/src/modules/customer-journey/chat-document-file.spec.ts \
  apps/api/src/modules/customer-journey/sql/journey-state.sql \
  apps/api/src/modules/customer-journey/sql/journey-activity-probe.sql \
  apps/api/src/modules/customer-journey/sql/journey-active-since.sql \
  apps/api/src/modules/customer-journey/journey-state.signals.db.spec.ts \
  apps/api/src/modules/customer-journey/customer-journey.service.ts \
  apps/api/src/modules/customer-journey/customer-journey.service.spec.ts \
  docs/superpowers/specs/2026-09-15-customer-journey-design.md \
  docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
git commit -m "$(cat <<'EOF'
feat(customer-journey): สัญญาณอัตโนมัติเฟส 3 ในแคชขั้น — ไฟล์เอกสารในแชทนับขั้น 3 · ออมเครื่อง/สั่งซื้อออนไลน์นับขั้น 4 · เอกสาร 6 ชนิดล้างป้ายหลุด

- chat-document-file.ts: เงื่อนไขเดียวของ "ลูกค้าส่งไฟล์เอกสาร" (CUSTOMER + FILE + media_url ลงท้าย pdf/doc/xls) · spec ปักว่า journey-state.sql เขียนตรงตัวอักษรและไม่มีสำเนาอื่น · ลิงก์แชร์ / media_url ว่าง ไม่นับ
- journey-state.sql: ไฟล์เอกสารที่ลูกค้าส่งในแชท (รวม soft-delete · media_url อยู่ใน FILTER เท่านั้น) เข้า credit_at แต่ path มาจากเอกสารเครดิตเท่านั้น (credit_doc_at)
- interest_agg: เพิ่ม saving_plans + online_orders · doc_last_at = เอกสาร 6 ชนิดล่าสุด · lost_at ล้างเมื่อเอกสารมาหลังป้าย (todo/ใบตรวจเครดิต/สัญญาไม่ล้าง)
- ตัวตรวจความเคลื่อนไหวทั้งสองไฟล์เห็น saving_plans / online_orders
- ข้อความ "ระบบยังไม่เก็บ" + spec + runbook ด่านนับห้องที่ส่งไฟล์เอกสารก่อน merge (นับอย่างเดียว · เงื่อนไขเดียวกับโค้ด)
- ไม่มี migration ไม่มีคอลัมน์ใหม่

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git status --short
```
Expected: one new commit, and `git status --short` lists none of the ten paths above.

---

### Task 4: Summary: CREDIT not_needed, CHAT_FILE evidence, askHeardFrom, creditFilePending

**Goal:** `GET /customers/:id/journey/summary` carries the flags and step states the approved boards need, computed once in the API. No web surface re-derives these rules. Sources: brief §0 rulings 3, 11, 12 and 13 (1)(2)(3); Controller ruling R-P1 ("file" = customer **document** file, one condition from Task 3's `chat-document-file.ts`); outline D1, D2 and D4; research-state §2, §6, §9 R6/R9/R12.

**Files:**
Line numbers are from the base `origin/main` `10d6e6d3a`. Tasks 1-3 shift them, so anchor every edit on the quoted text, not on the number.

- Modify `apps/api/src/modules/customer-journey/journey-summary.builder.ts`
  - `export interface JourneySummaryExtras { … }` (L26-32): add 4 fields.
  - `export function buildJourneySummary(…)` (L105-144 plus Task 1's shim lines): replace the whole function. Add helpers `CREDIT_NOT_NEEDED_PATHS`, `stepState` and `stepEvidence` directly above it.
- Modify `apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts`
  - the `const extras: JourneySummaryExtras = …` line (L24)
  - the `it('ซื้อเงินสดโดยไม่ตรวจเครดิต → CREDIT=skipped …')` block (L41-50)
  - a new `describe` block inserted right before `describe('withLiveBought', () => {` (L75)
- Modify `apps/api/src/modules/customer-journey/journey-summary.service.ts`
  - the docblock and `select` of `summary()` (L38-46)
  - the `this.extras(…)` call (L73)
  - the whole `private async extras(…)` method (L83-146), followed by a new private `customerDocumentFiles(…)`
  - the import block (L8: add `CUSTOMER_DOCUMENT_FILE_FRAGMENT`) and the module constants after `const BOUGHT_SALE_TYPES` (L19: `DocumentFileFacts`, `NO_DOCUMENT_FILES`)
- Modify `apps/api/src/modules/customer-journey/journey-summary.service.db.spec.ts`
  - inside `it('แคชยังไม่ซื้อ แต่ BOUGHT_WHERE สดเป็นจริง …')`, change the CREDIT assertion (L79) from `skipped` to `not_needed`. The cash buyer is no longer "skipped".
- Create `apps/api/src/modules/customer-journey/journey-summary.phase3.db.spec.ts`
- Modify `apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts`
  - `export function stageSteps(…)` (L11-25): `at` is null for `not_needed`; add an optional 4th parameter `chatFile`.
- Modify `docs/superpowers/specs/2026-09-15-customer-journey-design.md`
  - the CREDIT-section line containing `ไม่นับว่าค้าง` (L206)
  - the `- 200 JourneySummary = {` line under `2) GET /customers/:id/journey/summary` (L321)
  - new bullets after `- ใช้กับแถบขั้นใน header และ KPI tiles` (L323)
- Test: `apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts`, `apps/api/src/modules/customer-journey/journey-summary.phase3.db.spec.ts`, `apps/api/src/modules/customer-journey/journey-summary.service.db.spec.ts`, and the web suites under `apps/web/src/pages/CustomerDetailPage/__tests__/` (compile + regression).

**Interfaces:**

Consumes:
- **Task 1** (`@installment/shared`):
  - `JourneyStepState = 'done' | 'current' | 'skipped' | 'todo' | 'not_needed'`
  - `JourneyStep.evidence: 'SYSTEM' | 'MANUAL' | 'CHAT_FILE'` (type `JourneyStepEvidence`)
  - `JourneySummary.askHeardFrom: boolean` and `JourneySummary.creditFilePending: boolean`
  - The builder shim returning `askHeardFrom: false, creditFilePending: false`, which this task replaces.
  - The web fixture `journeySummary()` defaults for both flags (`false`).
- **Task 2:**
  - `JOURNEY_STAGES = ['CONTACTED','IDENTIFIED','CREDIT','INTERESTED','PURCHASED']`
  - `withLiveBought` fallback order `INTERESTED, CREDIT, IDENTIFIED`
- **Task 3** (`sql/journey-state.sql`):
  - `credit_at = LEAST(credit checks/contracts, room_credit_analyses, first CUSTOMER document file)`. The file time is taken over family rooms not filtered by `deleted_at`, including soft-deleted messages, and only over messages matching `CUSTOMER_DOCUMENT_FILE_SQL` (R-P1).
  - `apps/api/src/modules/customer-journey/chat-document-file.ts`: `export const CUSTOMER_DOCUMENT_FILE_FRAGMENT: Prisma.Sql` (`Prisma.raw` of `m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '\.(pdf|docx?|xlsx?)(\?|$)'`, alias `m` = `chat_messages`) · `chat-document-file.spec.ts` fails if any other non-spec file of the module contains `'FILE'` or `pdf|docx`.
  - `path = 'INSTALLMENT'` comes only from `credit_doc_at`, so a file alone leaves `path = 'UNKNOWN'`.

Produces:
```ts
// apps/api/src/modules/customer-journey/journey-summary.builder.ts
export interface JourneySummaryExtras {
  firstAd: { id: string; name: string } | null;
  interestedByManualEntry: boolean;
  /** state.creditAt === createdAt of a CUSTOMER document file (CUSTOMER_DOCUMENT_FILE_SQL) in family rooms (rooms and messages not filtered by deletedAt) */
  creditByChatFile: boolean;
  /** any CUSTOMER document file (same condition) in family rooms — false when purchased */
  hasCustomerChatFile: boolean;
  /** customers.credit_check_status of the requested customer (CustomerCreditCheckStatus as string) */
  creditCheckStatus: string;
  /** contracts (CUSTOMER_BOUGHT_CONTRACT_STATUSES) + sales (CUSTOMER_BOUGHT_SALE_TYPES) of the family — 0 when not purchased */
  purchaseCount: number;
  creditRejected: boolean;
  postSaleBadges: string[];
}
export function buildJourneySummary(state: JourneyStateRow, extras: JourneySummaryExtras, now: Date): JourneySummary;
```

Builder rules:
- **CREDIT step:** `state: 'not_needed'` and `at: null` when all of these hold:
  - `stage === 'PURCHASED'`
  - `times.CREDIT === null`
  - `path` is `'CASH'` or `'EXTERNAL_FINANCE'`

  In every other case the rule is unchanged: `current`, then `todo`, then `done` if a time exists, else `skipped`. Non-CREDIT steps are never `not_needed`.
- **evidence:**
  - `'MANUAL'` when `key === 'INTERESTED' && interestedByManualEntry`
  - otherwise `'CHAT_FILE'` when `key === 'CREDIT' && creditByChatFile`
  - otherwise `'SYSTEM'`
- **askHeardFrom** = `firstSource === 'WALK_IN' && heardFrom === null && purchaseCount < 2`
- **creditFilePending** = `stage !== 'PURCHASED' && hasCustomerChatFile && creditCheckStatus === 'NONE'`
- Both flags and `CHAT_FILE` go to every role that can read the summary. Only a type and a time are exposed (Ruling FR-CREDIT-STAGE).

```ts
// apps/api/src/modules/customer-journey/journey-summary.service.ts (private)
private async extras(
  state: JourneyStateRow,
  familyIds: string[],
  customer: { status: string; creditCheckStatus: string },
  actor: { id: string; role: string },
): Promise<JourneySummaryExtras>;
// one raw query with CUSTOMER_DOCUMENT_FILE_FRAGMENT; skipped (NO_DOCUMENT_FILES) when purchased and creditAt is null
private async customerDocumentFiles(familyIds: string[], creditAt: Date | null): Promise<DocumentFileFacts>;
// module-private: type DocumentFileFacts = { atCreditAt: boolean; any: boolean }; const NO_DOCUMENT_FILES: DocumentFileFacts
// summary() customer select adds creditCheckStatus: true
```

```ts
// apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts (backward compatible — existing calls unchanged)
export function stageSteps(
  states: Record<JourneyStage, JourneyStep['state']>,
  at?: Partial<Record<JourneyStage, string>>,
  manual?: readonly JourneyStage[],
  chatFile?: readonly JourneyStage[], // evidence 'CHAT_FILE' (MANUAL wins when a stage is in both)
): JourneyStep[]; // at = null for 'todo' | 'skipped' | 'not_needed' (mirrors the builder)
```

---

- [ ] **Step 1: Write the failing builder tests**

In `apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts`:

(a) Replace the `extras` constant line.

Old:
```ts
const extras: JourneySummaryExtras = { firstAd: null, interestedByManualEntry: false, creditRejected: false, postSaleBadges: [] };
```
New:
```ts
const extras: JourneySummaryExtras = {
  firstAd: null,
  interestedByManualEntry: false,
  creditByChatFile: false,
  hasCustomerChatFile: false,
  creditCheckStatus: 'NONE',
  purchaseCount: 0,
  creditRejected: false,
  postSaleBadges: [],
};
```

(b) Replace the whole cash-buyer test. It starts at `it('ซื้อเงินสดโดยไม่ตรวจเครดิต → CREDIT=skipped` and ends at its closing `});`. If its title differs, find it with `grep -n "ซื้อเงินสดโดยไม่ตรวจเครดิต" apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts`. New block:
```ts
  it('ซื้อเงินสดโดยไม่ตรวจเครดิต → CREDIT=not_needed ไม่มีวันที่ · silentDays=null · ป้ายหลังการขายแสดง · creditRejected ถูกปิด', () => {
    const s = buildJourneySummary(
      row({ stage: 'PURCHASED', path: 'CASH', creditAt: null, firstPurchaseAt: d('2026-09-14T05:00:00.000Z'), stageEnteredAt: d('2026-09-14T05:00:00.000Z') }),
      { ...extras, creditRejected: true, postSaleBadges: ['ซื้อซ้ำ'], purchaseCount: 2 },
      NOW,
    );
    expect(s.steps.find((x) => x.stage === 'CREDIT')).toMatchObject({ state: 'not_needed', at: null });
    expect(s.steps.find((x) => x.stage === 'PURCHASED')).toMatchObject({ state: 'current', at: '2026-09-14T05:00:00.000Z' });
    expect(s).toMatchObject({ silentDays: null, postSaleBadges: ['ซื้อซ้ำ'], creditRejected: false, daysInStage: 1 });
  });
```

(c) Insert this block immediately before the line `describe('withLiveBought', () => {`:
```ts
describe('buildJourneySummary — เฟส 3: not_needed · CHAT_FILE · askHeardFrom · creditFilePending', () => {
  type Summary = ReturnType<typeof buildJourneySummary>;
  const PURCHASED_AT = d('2026-09-14T05:00:00.000Z');
  const purchasedRow = (path: string, over: Partial<JourneyStateRow> = {}) =>
    row({ stage: 'PURCHASED', path, interestedAt: null, creditAt: null, firstPurchaseAt: PURCHASED_AT, stageEnteredAt: PURCHASED_AT, ...over });
  const statesOf = (s: Summary) => Object.fromEntries(s.steps.map((x) => [x.stage, x.state]));
  const evidenceOf = (s: Summary) => Object.fromEntries(s.steps.map((x) => [x.stage, x.evidence]));
  const creditOf = (s: Summary) => s.steps.find((x) => x.stage === 'CREDIT');

  it.each(['CASH', 'EXTERNAL_FINANCE'])(
    'ซื้อแล้ว path %s ไม่มีเวลาเข้าขั้นเครดิต → CREDIT not_needed ไม่มีวันที่ · ขั้นอื่นที่ไม่มีเวลายังเป็น skipped',
    (path) => {
      const s = buildJourneySummary(purchasedRow(path), { ...extras, purchaseCount: 1 }, NOW);
      expect(creditOf(s)).toMatchObject({ state: 'not_needed', at: null, evidence: 'SYSTEM' });
      expect(statesOf(s)).toEqual({ CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'not_needed', INTERESTED: 'skipped', PURCHASED: 'current' });
    },
  );

  it.each(['CASH', 'EXTERNAL_FINANCE'])('ซื้อแล้ว path %s แต่มีเวลาเข้าขั้นเครดิต (ส่งไฟล์ในแชทก่อนซื้อ) → CREDIT done พร้อมวันที่ หลักฐาน CHAT_FILE', (path) => {
    const s = buildJourneySummary(
      purchasedRow(path, { creditAt: d('2026-09-12T05:00:00.000Z') }),
      { ...extras, creditByChatFile: true, purchaseCount: 1 },
      NOW,
    );
    expect(creditOf(s)).toMatchObject({ state: 'done', at: '2026-09-12T05:00:00.000Z', evidence: 'CHAT_FILE' });
  });

  it.each(['INSTALLMENT', 'UNKNOWN'])('ซื้อแล้ว path %s ไม่มีเวลาเข้าขั้นเครดิต → skipped ไม่ใช่ not_needed', (path) => {
    const s = buildJourneySummary(purchasedRow(path), { ...extras, purchaseCount: 1 }, NOW);
    expect(creditOf(s)?.state).toBe('skipped');
    expect(s.steps.some((x) => x.state === 'not_needed')).toBe(false);
  });

  it('ยกเลิกใบขายเงินสดจนไม่ซื้อแล้ว (withLiveBought) แต่แคชยังค้าง path CASH → CREDIT เป็น skipped ไม่ใช่ not_needed', () => {
    const live = withLiveBought(purchasedRow('CASH', { interestedAt: d('2026-09-08T05:00:00.000Z') }), false, NOW);
    expect(live).toMatchObject({ stage: 'INTERESTED', path: 'CASH' });
    const s = buildJourneySummary(live, extras, NOW);
    expect(statesOf(s)).toMatchObject({ CREDIT: 'skipped', INTERESTED: 'current', PURCHASED: 'todo' });
    expect(s.steps.some((x) => x.state === 'not_needed')).toBe(false);
  });

  it('หลักฐาน CHAT_FILE ติดเฉพาะขั้นตรวจเครดิต · MANUAL เฉพาะขั้นนัด / จอง · ธงปิด = SYSTEM ทุกขั้น', () => {
    const r = row({ stage: 'INTERESTED', interestedAt: d('2026-09-11T05:00:00.000Z'), creditAt: d('2026-09-10T05:00:00.000Z'), stageEnteredAt: d('2026-09-11T05:00:00.000Z') });
    expect(evidenceOf(buildJourneySummary(r, { ...extras, creditByChatFile: true, interestedByManualEntry: true }, NOW))).toEqual({
      CONTACTED: 'SYSTEM', IDENTIFIED: 'SYSTEM', CREDIT: 'CHAT_FILE', INTERESTED: 'MANUAL', PURCHASED: 'SYSTEM',
    });
    expect(evidenceOf(buildJourneySummary(r, extras, NOW))).toEqual({
      CONTACTED: 'SYSTEM', IDENTIFIED: 'SYSTEM', CREDIT: 'SYSTEM', INTERESTED: 'SYSTEM', PURCHASED: 'SYSTEM',
    });
  });

  it.each([
    ['WALK_IN', null, 0, true],
    ['WALK_IN', null, 1, true],
    ['WALK_IN', null, 2, false],
    ['WALK_IN', 'FRIEND', 0, false],
    ['HEARD:FRIEND', 'FRIEND', 0, false],
    ['CHAT_FACEBOOK', null, 0, false],
    ['CHAT_LINE_SHOP', null, 1, false],
    ['REFERRAL', null, 0, false],
    ['AD:1203', null, 0, false],
  ] as const)('askHeardFrom: firstSource %s · heardFrom %s · ซื้อ %i ครั้ง → %s', (firstSource, heardFrom, purchaseCount, expected) => {
    const r =
      purchaseCount > 0
        ? purchasedRow('CASH', { firstSource, heardFrom })
        : row({ stage: 'IDENTIFIED', path: 'UNKNOWN', creditAt: null, firstSource, heardFrom });
    expect(buildJourneySummary(r, { ...extras, purchaseCount }, NOW).askHeardFrom).toBe(expected);
  });

  it.each([
    [false, true, 'NONE', true],
    [false, false, 'NONE', false],
    [false, true, 'UNDER_REVIEW', false],
    [false, true, 'PRE_CHECK_PASSED', false],
    [false, true, 'FULL_CHECK_PASSED', false],
    [false, true, 'REJECTED', false],
    [true, true, 'NONE', false],
  ] as const)('creditFilePending: ซื้อแล้ว %s · มีไฟล์ในแชท %s · สถานะเครดิตลูกค้า %s → %s', (purchased, hasCustomerChatFile, creditCheckStatus, expected) => {
    const r = purchased ? purchasedRow('CASH') : row({ stage: 'CREDIT', path: 'UNKNOWN' });
    expect(buildJourneySummary(r, { ...extras, hasCustomerChatFile, creditCheckStatus }, NOW).creditFilePending).toBe(expected);
  });
});

```

- [ ] **Step 2: Run the builder spec and confirm it fails**

From the worktree root:
```bash
npm run build --workspace=@installment/shared
(cd apps/api && npx jest src/modules/customer-journey/journey-summary.builder.spec.ts --runInBand)
```
Expected: `FAIL … Test suite failed to run` with ts-jest diagnostic `TS2353: Object literal may only specify known properties, and 'creditByChatFile' does not exist in type 'JourneySummaryExtras'`.

- [ ] **Step 3: Implement the builder**

In `apps/api/src/modules/customer-journey/journey-summary.builder.ts`:

(a) Replace the whole `export interface JourneySummaryExtras { … }` declaration, including its closing `}`. Keep the Thai doc comment line above it.
```ts
export interface JourneySummaryExtras {
  firstAd: { id: string; name: string } | null;
  interestedByManualEntry: boolean;
  /** เวลาเข้าขั้นเครดิตในแคช = เวลาไฟล์เอกสารที่ลูกค้าในครอบครัวส่งพอดี (CUSTOMER_DOCUMENT_FILE_SQL) ⇒ หลักฐานแรกของขั้นนี้คือไฟล์ในแชท */
  creditByChatFile: boolean;
  /** มีไฟล์เอกสารของลูกค้าในห้องของครอบครัว (เงื่อนไขเดียวกัน · ซื้อแล้ว = false) */
  hasCustomerChatFile: boolean;
  /** customers.credit_check_status ของลูกค้าที่ขอ */
  creditCheckStatus: string;
  /** สัญญา + ใบขายที่นับว่าซื้อของครอบครัว — ยังไม่ซื้อ = 0 */
  purchaseCount: number;
  creditRejected: boolean;
  postSaleBadges: string[];
}
```

(b) Replace the whole `export function buildJourneySummary(…) { … }` function, from `export function buildJourneySummary(` to that function's closing `}`. At this point it equals the base `10d6e6d3a` L105-144 plus Task 1's `askHeardFrom: false` / `creditFilePending: false` shim; the replacement below already includes both flags.

The helpers come first in the replacement text:
```ts
/**
 * ขั้นตรวจเครดิต "ไม่ต้องตรวจ" (คำตัดสินเจ้าของ 2026-09-15 ข้อ 11 + 13(1)): ซื้อแล้ว · ไม่มีเวลาเข้าขั้นเครดิต · ซื้อเงินสด/ไฟแนนซ์นอก
 * ไม่นับเป็น "ข้าม" · กันด้วย purchased เพราะ withLiveBought ถอยขั้นตอนยกเลิกใบขายแต่ไม่ล้าง path
 */
const CREDIT_NOT_NEEDED_PATHS: readonly string[] = ['CASH', 'EXTERNAL_FINANCE'];

function stepState(index: number, current: number, at: Date | null, notNeeded: boolean): Step['state'] {
  if (index === current) return 'current';
  if (index > current) return 'todo';
  if (at) return 'done';
  return notNeeded ? 'not_needed' : 'skipped';
}

/** MANUAL = หลักฐานแรกของขั้นนัด / จอง คือบันทึกมือ · CHAT_FILE = หลักฐานแรกของขั้นตรวจเครดิตคือไฟล์เอกสารที่ลูกค้าส่งในแชท (ชนิด + เวลาเท่านั้น ทุก role — Ruling FR-CREDIT-STAGE) */
function stepEvidence(key: JourneyStage, extras: JourneySummaryExtras): Step['evidence'] {
  if (key === 'INTERESTED' && extras.interestedByManualEntry) return 'MANUAL';
  if (key === 'CREDIT' && extras.creditByChatFile) return 'CHAT_FILE';
  return 'SYSTEM';
}

export function buildJourneySummary(state: JourneyStateRow, extras: JourneySummaryExtras, now: Date): JourneySummary {
  const stage = state.stage as JourneyStage;
  const current = JOURNEY_STAGES.indexOf(stage);
  const times = stageTimes(state);
  const purchased = stage === 'PURCHASED';
  const creditNotNeeded = purchased && times.CREDIT === null && CREDIT_NOT_NEEDED_PATHS.includes(state.path);
  // stage ตัดสินขั้นเสมอ — identified_at แช่แข็งด้วย LEAST (Task 3) ⇒ ลบเบอร์แล้ว stage ถอยได้แต่เวลายังอยู่ ขั้นที่ยังไม่ถึง (todo) จึงไม่แสดงวันที่
  const steps = JOURNEY_STAGES.map((key, index): Step => ({
    stage: key,
    label: STAGE_LABELS[key],
    at: index > current ? null : iso(times[key]),
    state: stepState(index, current, times[key], key === 'CREDIT' && creditNotNeeded),
    evidence: stepEvidence(key, extras),
  }));
  const lastSeen = [state.lastCustomerAt, state.lastTouchAt, state.contactedAt]
    .filter((value): value is Date => value !== null)
    .reduce((a, b) => (a > b ? a : b));

  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    stageEnteredAt: state.stageEnteredAt.toISOString(),
    daysInStage: Math.max(0, calculateDaysElapsed(state.stageEnteredAt, now)),
    path: state.path as JourneySummary['path'],
    steps,
    firstChannel: state.firstChannel as JourneySummary['firstChannel'],
    firstSource: state.firstSource as JourneySummary['firstSource'],
    firstSourceLabel: firstSourceLabel(state.firstSource, extras.firstAd),
    firstAd: extras.firstAd,
    heardFrom: state.heardFrom as JourneySummary['heardFrom'],
    contactedAt: state.contactedAt.toISOString(),
    firstStaffReplyAt: iso(state.firstStaffReplyAt),
    firstPurchaseAt: iso(state.firstPurchaseAt),
    lastCustomerAt: iso(state.lastCustomerAt),
    lastTouchAt: iso(state.lastTouchAt),
    silentDays: purchased ? null : Math.max(0, calculateDaysElapsed(lastSeen, now)),
    lost: state.lostAt ? { at: state.lostAt.toISOString(), reason: state.lostReason ?? 'OTHER' } : null,
    postSaleBadges: purchased ? extras.postSaleBadges : [],
    creditRejected: !purchased && extras.creditRejected,
    // ถามรู้จักร้านจากไหนเฉพาะลูกค้าหน้าร้านที่ยังไม่ตอบ และซื้อไม่ถึง 2 ครั้ง (ข้อ 3, 12) — แบนเนอร์แท็บการเดินทางกับการ์ดหน้าสร้างสัญญาอ่านธงเดียวกัน
    askHeardFrom: state.firstSource === 'WALK_IN' && state.heardFrom === null && extras.purchaseCount < 2,
    // KPI "เครดิต" = "ส่งไฟล์แล้ว รอตรวจ" (ข้อ 13(3)) — ส่งไฟล์ในแชทแล้วแต่ลูกค้ายังไม่มีผลตรวจเครดิต
    creditFilePending: !purchased && extras.hasCustomerChatFile && extras.creditCheckStatus === 'NONE',
  };
}
```

- [ ] **Step 4: Run the builder spec and confirm it passes**

```bash
(cd apps/api && npx jest src/modules/customer-journey/journey-summary.builder.spec.ts --runInBand)
```
Expected: `PASS`, `0 failed`. The new describe block adds 24 passing cases (2+2+2+1+1+9+7). The replaced cash-buyer test passes.

`journey-summary.service.ts` does not compile yet (`extras()` return is missing fields). The service is fixed in Step 7.

- [ ] **Step 5: Write the failing DB tests**

(a) In `apps/api/src/modules/customer-journey/journey-summary.service.db.spec.ts`, find `it('แคชยังไม่ซื้อ แต่ BOUGHT_WHERE สดเป็นจริง` and replace this line inside it:

Old:
```ts
    expect(res.steps.find((s) => s.stage === 'CREDIT')?.state).toBe('skipped');
```
New:
```ts
    expect(res.steps.find((s) => s.stage === 'CREDIT')).toMatchObject({ state: 'not_needed', at: null });
```

(b) Create `apps/api/src/modules/customer-journey/journey-summary.phase3.db.spec.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import type { JourneyRedirect, JourneySummary } from '@installment/shared';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';

/** URL สังเคราะห์: ไฟล์เอกสาร (ตรง CUSTOMER_DOCUMENT_FILE_SQL) · ลิงก์แชร์ที่ webhook Facebook เก็บเป็น FILE (ไม่ตรง — คำตัดสินผู้ควบคุม R-P1) */
const DOC_URL = 'https://files.example.test/journey-phase3/statement.pdf';
const SHARE_LINK = 'https://www.facebook.com/share/p/journey-phase3/';

/**
 * เฟส 3 Task 4 กับ Postgres จริง: ธง askHeardFrom · ขั้นเครดิต not_needed · หลักฐาน CHAT_FILE · creditFilePending · นับเฉพาะไฟล์เอกสาร (R-P1)
 * ใช้เวลาแบบ ISO UTC เท่านั้น (CI เป็น UTC · เครื่องเป็น Asia/Bangkok) · ผู้ใช้/สาขาของ spec ถูกปล่อยไว้เพราะ audit_logs ลบไม่ได้
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('JourneySummaryService phase 3 flags (real DB)', () => {
  const prisma = new PrismaClient();
  const state = new JourneyStateService(prisma as any);
  const service = new JourneySummaryService(prisma as any, state);
  const actor = { id: 'phase3-sales', role: 'SALES' };
  const accountant = { id: 'phase3-accountant', role: 'ACCOUNTANT' };
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const saleIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;

  function asSummary(res: JourneySummary | JourneyRedirect): JourneySummary {
    if (!('steps' in res)) throw new Error('คาดว่าเป็น JourneySummary');
    return res;
  }
  const creditStep = (s: JourneySummary) => s.steps.find((x) => x.stage === 'CREDIT');

  async function walkIn(label: string, phone: string) {
    const row = await prisma.customer.create({ data: { name: `phase3 ${label}`, phone } });
    customerIds.push(row.id);
    return row;
  }
  async function chatProspect(label: string, createdAt: string) {
    const customer = await prisma.customer.create({
      data: { name: `phase3 ${label}`, phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at(createdAt) },
    });
    customerIds.push(customer.id);
    const room = await prisma.chatRoom.create({
      data: { channel: 'FACEBOOK', externalUserId: `phase3-${label}-${stamp}`, customerId: customer.id, createdAt: at(createdAt) },
    });
    roomIds.push(room.id);
    return { customer, room };
  }
  async function cashSale(customerId: string) {
    const row = await prisma.sale.create({
      data: { saleNumber: `JP3-${tail}-${saleIds.length}`, saleType: 'CASH', customerId, productId, branchId, salespersonId: userId, sellingPrice: 9900, netAmount: 9900 },
    });
    saleIds.push(row.id);
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `phase3 summary spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-phase3-${stamp}@spec.local`, password: 'x', name: 'phase3 summary spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'phase3 phone', brand: 'Apple', model: 'iPhone 13', category: 'PHONE_USED', costPrice: 8000, branchId } })).id;
  });
  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('ลูกค้าหน้าร้านยังไม่ตอบ → askHeardFrom · บันทึก HEARD_FROM แล้วคำนวณใหม่ → ธงดับ', async () => {
    const c = await walkIn('heard', `061${tail}`);
    expect(asSummary(await service.summary(c.id, actor))).toMatchObject({ firstSource: 'WALK_IN', heardFrom: null, askHeardFrom: true });

    await prisma.customerJourneyEntry.create({
      data: { customerId: c.id, originCustomerId: c.id, origin: 'MANUAL', kind: 'HEARD_FROM', heardFrom: 'FRIEND', occurredAt: new Date(), actorType: 'STAFF', actorUserId: userId },
    });
    await state.recompute([c.id]);
    expect(asSummary(await service.summary(c.id, actor))).toMatchObject({ firstSource: 'HEARD:FRIEND', heardFrom: 'FRIEND', askHeardFrom: false });
  });

  it('ซื้อเงินสดโดยไม่มีหลักฐานเครดิต → ขั้นเครดิต not_needed · ซื้อครั้งแรกยังถามรู้จักร้าน · ครั้งที่ 2 ไม่ถาม', async () => {
    const c = await walkIn('cash', `062${tail}`);
    await cashSale(c.id);
    const first = asSummary(await service.summary(c.id, actor));
    expect(first).toMatchObject({ stage: 'PURCHASED', path: 'CASH', askHeardFrom: true, creditFilePending: false });
    expect(creditStep(first)).toMatchObject({ state: 'not_needed', at: null, evidence: 'SYSTEM' });
    expect(first.steps.filter((x) => x.state === 'not_needed').map((x) => x.stage)).toEqual(['CREDIT']);

    await cashSale(c.id);
    expect(asSummary(await service.summary(c.id, actor))).toMatchObject({ stage: 'PURCHASED', askHeardFrom: false });
  });

  it('ผู้สนใจที่ส่งไฟล์ในแชทอย่างเดียว → ขั้นเครดิต current หลักฐาน CHAT_FILE · creditFilePending · ทุก role ได้ค่าเดียวกัน', async () => {
    const { customer, room } = await chatProspect('file-only', '2026-09-12T02:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: room.id, role: 'CUSTOMER', createdAt: at('2026-09-12T02:30:00.000Z') },
        { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: SHARE_LINK, createdAt: at('2026-09-12T02:31:00.000Z') }, // ลิงก์แชร์มาก่อน ไม่นับ
        { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-12T02:32:00.000Z') },
        { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-12T02:35:00.000Z') },
      ],
    });

    for (const who of [actor, accountant]) {
      const s = asSummary(await service.summary(customer.id, who));
      expect(s).toMatchObject({ stage: 'CREDIT', path: 'UNKNOWN', askHeardFrom: false, creditFilePending: true });
      expect(creditStep(s)).toMatchObject({ state: 'current', at: '2026-09-12T02:32:00.000Z', evidence: 'CHAT_FILE' });
    }
  });

  it('ใบตรวจเครดิตมาก่อนไฟล์ในแชท → หลักฐาน SYSTEM · path INSTALLMENT · ลูกค้ามีสถานะเครดิตแล้ว creditFilePending ดับ', async () => {
    const { customer, room } = await chatProspect('check-first', '2026-09-04T02:00:00.000Z');
    await prisma.chatMessage.create({ data: { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-10T03:00:00.000Z') } });
    await prisma.creditCheck.create({ data: { customerId: customer.id, createdAt: at('2026-09-05T03:00:00.000Z') } });
    await prisma.customer.update({ where: { id: customer.id }, data: { creditCheckStatus: 'UNDER_REVIEW' } });

    const s = asSummary(await service.summary(customer.id, actor));
    expect(s).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT', creditFilePending: false });
    expect(creditStep(s)).toMatchObject({ state: 'current', at: '2026-09-05T03:00:00.000Z', evidence: 'SYSTEM' });
  });

  it('ไฟล์ที่ไม่ใช่เอกสาร (media_url ว่าง · ลิงก์แชร์ facebook.com) → ไม่ขึ้นขั้นเครดิต · creditFilePending ดับ · ใบตรวจเครดิตเวลาเดียวกับลิงก์แชร์พอดี หลักฐานยังเป็น SYSTEM', async () => {
    const { customer, room } = await chatProspect('share-only', '2026-09-13T02:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: room.id, role: 'CUSTOMER', createdAt: at('2026-09-13T02:30:00.000Z') },
        { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: null, createdAt: at('2026-09-13T02:32:00.000Z') },
        { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: SHARE_LINK, createdAt: at('2026-09-13T02:35:00.000Z') },
      ],
    });
    const before = asSummary(await service.summary(customer.id, actor));
    expect(before).toMatchObject({ stage: 'CONTACTED', creditFilePending: false });
    expect(creditStep(before)).toMatchObject({ state: 'todo', at: null, evidence: 'SYSTEM' });

    // เวลาเท่ากับลิงก์แชร์พอดี ⇒ ถ้าคิวรีเทียบเวลาไม่ผ่านเงื่อนไขไฟล์เอกสาร หลักฐานจะกลายเป็น CHAT_FILE ผิด ๆ
    await prisma.creditCheck.create({ data: { customerId: customer.id, createdAt: at('2026-09-13T02:35:00.000Z') } });
    await state.recompute([customer.id]);
    const after = asSummary(await service.summary(customer.id, actor));
    expect(after).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT', creditFilePending: false });
    expect(creditStep(after)).toMatchObject({ state: 'current', at: '2026-09-13T02:35:00.000Z', evidence: 'SYSTEM' });
  });
});
```

- [ ] **Step 6: Run the DB specs and confirm they fail**

From the worktree root:
```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-summary.phase3.db.spec.ts src/modules/customer-journey/journey-summary.service.db.spec.ts --runInBand)
```
Expected: both suites `FAIL … Test suite failed to run`. The ts-jest diagnostic in `journey-summary.service.ts` reads `TS2739: Type '{ firstAd: …; interestedByManualEntry: boolean; creditRejected: boolean; postSaleBadges: string[]; }' is missing the following properties from type 'JourneySummaryExtras': creditByChatFile, hasCustomerChatFile, creditCheckStatus, purchaseCount`.

- [ ] **Step 7: Implement the service**

In `apps/api/src/modules/customer-journey/journey-summary.service.ts`:

(a) Replace the docblock and the customer select at the top of `summary()`.

Old:
```ts
  /**
   * ไม่มียอดชำระ/ติดตามหนี้ · ธง creditRejected ใช้ใบตรวจเครดิตที่ actor เห็นเท่านั้น (creditHistoryAccess — กติกาเดียวกับ list)
   * ขั้น CREDIT บนแถบยังนับจากการวิเคราะห์สเตทเม้นในแชทได้ทุก role (Ruling FR-CREDIT-STAGE)
   */
  async summary(customerId: string, actor: { id: string; role: string }): Promise<JourneySummary | JourneyRedirect> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, deletedAt: true, mergedIntoId: true, status: true },
    });
```
New:
```ts
  /**
   * ไม่มียอดชำระ/ติดตามหนี้ · ธง creditRejected ใช้ใบตรวจเครดิตที่ actor เห็นเท่านั้น (creditHistoryAccess — กติกาเดียวกับ list)
   * ขั้น CREDIT บนแถบยังนับจากการวิเคราะห์สเตทเม้นในแชทได้ทุก role (Ruling FR-CREDIT-STAGE)
   * หลักฐาน CHAT_FILE และธง creditFilePending ส่งให้ทุก role เช่นกัน (ชนิดข้อความ + เวลาเท่านั้น ไม่มีเนื้อหา/ลิงก์ไฟล์)
   */
  async summary(customerId: string, actor: { id: string; role: string }): Promise<JourneySummary | JourneyRedirect> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, deletedAt: true, mergedIntoId: true, status: true, creditCheckStatus: true },
    });
```

(b) Replace the `extras` call.

Old:
```ts
    return buildJourneySummary(live, await this.extras(live, familyIds, customer.status, actor), now);
```
New:
```ts
    return buildJourneySummary(live, await this.extras(live, familyIds, customer, actor), now);
```

(c) Replace the whole `private async extras(…)` method, from `  private async extras(` to its closing `  }` just before the class's final `}`, with the new `extras` plus a new private `customerDocumentFiles` right after it. Tasks 1–3 do not touch this method, so it still reads exactly as at the base `10d6e6d3a` (L83-146).

The document-file check is one raw query with Task 3's `CUSTOMER_DOCUMENT_FILE_FRAGMENT` — never a Prisma `where` on `type: 'FILE'` (Controller ruling R-P1; a Prisma `where` cannot express the extension regex, and `chat-document-file.spec.ts` fails if this file ever contains `'FILE'`):
```ts
  private async extras(
    state: JourneyStateRow,
    familyIds: string[],
    customer: { status: string; creditCheckStatus: string },
    actor: { id: string; role: string },
  ): Promise<JourneySummaryExtras> {
    const purchased = state.stage === 'PURCHASED';
    const [ad, manualInterest, documentFiles, creditChecks, latestContract, contractCount, saleCount, repairCount] = await Promise.all([
      state.firstAdCampaignId
        ? this.prisma.adsCampaign.findUnique({ where: { id: state.firstAdCampaignId }, select: { id: true, campaignName: true } })
        : Promise.resolve(null),
      state.interestedAt
        ? this.prisma.customerJourneyEntry.count({
            where: { customerId: { in: familyIds }, kind: 'TOUCHPOINT', outcome: { in: ['APPOINTED', 'VISITED'] }, deletedAt: null, occurredAt: state.interestedAt },
          })
        : Promise.resolve(0),
      // ไฟล์เอกสารของลูกค้าใช้กับหลักฐาน CHAT_FILE (ต้องมี creditAt) และธง creditFilePending (ต้องยังไม่ซื้อ) — ไม่ต้องใช้ทั้งคู่ = ไม่ยิงคิวรี
      state.creditAt || !purchased ? this.customerDocumentFiles(familyIds, state.creditAt) : Promise.resolve(NO_DOCUMENT_FILES),
      purchased
        ? Promise.resolve([])
        : this.prisma.creditCheck.findMany({
            where: { customerId: { in: familyIds }, deletedAt: null, ...creditHistoryAccess(actor) },
            select: { id: true },
          }),
      purchased
        ? this.prisma.contract.findFirst({
            where: { customerId: { in: familyIds }, deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { status: true },
          })
        : Promise.resolve(null),
      purchased
        ? this.prisma.contract.count({ where: { customerId: { in: familyIds }, deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES } } })
        : Promise.resolve(0),
      purchased
        ? this.prisma.sale.count({ where: { customerId: { in: familyIds }, deletedAt: null, saleType: { in: BOUGHT_SALE_TYPES } } })
        : Promise.resolve(0),
      purchased
        ? this.prisma.repairTicket.count({ where: { customerId: { in: familyIds }, deletedAt: null } })
        : Promise.resolve(0),
    ]);

    let creditRejected = false;
    if (creditChecks.length > 0) {
      const override = await this.prisma.auditLog.findFirst({
        where: { action: 'CREDIT_CHECK_OVERRIDE', entity: 'credit_check', entityId: { in: creditChecks.map((row) => row.id) } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { newValue: true },
      });
      creditRejected = isRejectedOverride(override?.newValue);
    }

    const purchaseCount = purchased ? contractCount + saleCount : 0;
    return {
      firstAd: ad ? { id: ad.id, name: ad.campaignName } : null,
      interestedByManualEntry: manualInterest > 0,
      creditByChatFile: documentFiles.atCreditAt,
      hasCustomerChatFile: !purchased && documentFiles.any,
      creditCheckStatus: customer.creditCheckStatus,
      purchaseCount,
      creditRejected,
      postSaleBadges: purchased
        ? postSaleBadges({
            latestContractStatus: latestContract?.status ?? null,
            purchaseCount,
            hasRepairTicket: repairCount > 0,
            skipTracingLost: customer.status === 'LOST',
          })
        : [],
    };
  }

  /**
   * ไฟล์เอกสารที่ลูกค้าส่งในห้องของครอบครัว — เงื่อนไขเดียวกับ first_file_at ใน journey-state.sql (CUSTOMER_DOCUMENT_FILE_FRAGMENT · คำตัดสินผู้ควบคุม R-P1)
   * ห้องไม่กรอง deleted_at · นับข้อความที่ถูก soft-delete (ขอบเขตเดียวกับแคช) · atCreditAt = มีไฟล์เอกสารเวลาเท่ากับ creditAt พอดี (TIMESTAMP(3) ทั้งคู่ — แบบเดียวกับ manualInterest)
   * เวลาส่งเป็นสตริง ISO แล้ว ::timestamp (คอลัมน์ timestamp without time zone เก็บ UTC · session อาจเป็น Asia/Bangkok — แบบเดียวกับ journey-state.service)
   * 🔴 PDPA: media_url อยู่ใน WHERE เท่านั้น — คืนแค่ boolean สองตัว ห้าม select / log ลิงก์
   */
  private async customerDocumentFiles(familyIds: string[], creditAt: Date | null): Promise<DocumentFileFacts> {
    const [row] = await this.prisma.$queryRaw<DocumentFileFacts[]>`
      SELECT COALESCE(bool_or(m.created_at = ${creditAt ? creditAt.toISOString() : null}::timestamp), false) AS "atCreditAt",
             COUNT(*) > 0 AS "any"
        FROM chat_messages m
        JOIN chat_rooms r ON r.id = m.room_id
       WHERE r.customer_id IN (${Prisma.join(familyIds)}) AND ${CUSTOMER_DOCUMENT_FILE_FRAGMENT}`;
    return row ?? NO_DOCUMENT_FILES;
  }
```

(d) Add the import and the module-level constant. Replace:
```ts
import { JourneyStateService } from './journey-state.service';
```
with:
```ts
import { CUSTOMER_DOCUMENT_FILE_FRAGMENT } from './chat-document-file';
import { JourneyStateService } from './journey-state.service';
```
Then replace:
```ts
const BOUGHT_SALE_TYPES = [...CUSTOMER_BOUGHT_SALE_TYPES];
```
with:
```ts
const BOUGHT_SALE_TYPES = [...CUSTOMER_BOUGHT_SALE_TYPES];

/** ข้อเท็จจริงของไฟล์เอกสารในแชทที่ summary ใช้ — boolean ล้วน ไม่มีลิงก์หรือเวลา */
type DocumentFileFacts = { atCreditAt: boolean; any: boolean };
const NO_DOCUMENT_FILES: DocumentFileFacts = { atCreditAt: false, any: false };
```

Confirm the single-source pin still holds (from the worktree root):
```bash
(cd apps/api && NODE_ENV=test npx jest src/modules/customer-journey/chat-document-file.spec.ts --runInBand)
grep -c "'FILE'\|mediaUrl" apps/api/src/modules/customer-journey/journey-summary.service.ts
```
Expected: `Tests: 4 passed, 4 total`, then `0`.

- [ ] **Step 8: Run the API tests and confirm they pass, in both time zones**

From the worktree root:
```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey --runInBand)
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=UTC NODE_ENV=test npx jest src/modules/customer-journey/journey-summary.phase3.db.spec.ts src/modules/customer-journey/journey-summary.service.db.spec.ts src/modules/customer-journey/journey-summary.builder.spec.ts --runInBand)
(cd apps/api && npx tsc --noEmit -p tsconfig.json)
```
Expected:
- First command: every suite under `customer-journey` passes, `0 failed`. `journey-summary.phase3.db.spec.ts` shows 5 passed; `chat-document-file.spec.ts` (Task 3) still shows 4 passed.
- Second command (UTC): the same three suites pass.
- `tsc`: exits 0 with no output.

- [ ] **Step 9: Update the web fixture**

In `apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts`, replace the whole `export function stageSteps(…) { … }` function, from `export function stageSteps(` to its closing `}`:
```ts
export function stageSteps(
  states: Record<JourneyStage, JourneyStep['state']>,
  at: Partial<Record<JourneyStage, string>> = {},
  manual: readonly JourneyStage[] = [],
  chatFile: readonly JourneyStage[] = [],
): JourneyStep[] {
  return JOURNEY_STAGES.map(
    (stage): JourneyStep => ({
      stage,
      label: STAGE_LABELS[stage],
      // ตรงกับ journey-summary.builder: ขั้นที่ยังไม่ถึง / ข้าม / ไม่ต้องตรวจ ไม่มีวันที่
      at: states[stage] === 'todo' || states[stage] === 'skipped' || states[stage] === 'not_needed' ? null : at[stage] ?? null,
      state: states[stage],
      evidence: manual.includes(stage) ? 'MANUAL' : chatFile.includes(stage) ? 'CHAT_FILE' : 'SYSTEM',
    }),
  );
}
```

Run:
```bash
(cd apps/web && npx tsc --noEmit)
(cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage)
(cd apps/web && npx vitest run src/pages/CustomerDetailPage)
```
Expected: `tsc` exits 0. Both vitest runs report `Test Files … passed`, `0 failed`. Existing `stageSteps(…)` calls are unchanged because the new parameter is optional.

- [ ] **Step 10: Update the spec**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md`:

(a) In the CREDIT stage section, replace the whole line that contains `ไม่นับว่าค้าง` (today it reads `คนที่ซื้อเงินสดหรือไฟแนนซ์นอกโดยไม่มีใบตรวจ ⇒ แถบแสดง 'ข้าม (เงินสด/ไฟแนนซ์นอก)' ไม่นับว่าค้าง`) with:
```md
คนที่ซื้อแล้วโดยไม่มีหลักฐานขั้นนี้ และซื้อเงินสดหรือไฟแนนซ์นอก ⇒ summary ตั้งขั้นนี้เป็น state 'not_needed' (ไม่นับเป็นข้าม · ไม่มีวันที่) · แถบแสดงสีเทาชุดเดียวกับขั้นที่ข้าม คำบรรยาย 'ไม่ต้องตรวจ (ซื้อสด)' / 'ไฟแนนซ์นอกตรวจ' · ยกเลิกใบขายจนถอยขั้น = กลับเป็นกติกาปกติ (path ในแคชยังค้างได้ จึงดูจาก stage ซื้อแล้วก่อนเสมอ) · ยังไม่ซื้อแต่เลยขั้นนี้ไปโดยไม่มีหลักฐาน = 'ข้าม' ธรรมดา ไม่มีวงเล็บต่อท้าย · ซื้อสดแต่ส่งไฟล์ในแชท/ตรวจเครดิตมาก่อน = ขั้นนี้มีวันที่ตามปกติ
```

(b) In the `- 200 JourneySummary = {` line, make two replacements.

Old: `state: 'done'|'current'|'skipped'|'todo', evidence: 'SYSTEM'|'MANUAL' }]`
New: `state: 'done'|'current'|'skipped'|'todo'|'not_needed', evidence: 'SYSTEM'|'MANUAL'|'CHAT_FILE' }]`

Old: `postSaleBadges: string[], creditRejected: boolean }`
New: `postSaleBadges: string[], creditRejected: boolean, askHeardFrom: boolean, creditFilePending: boolean }`

(c) Right after the line `- ใช้กับแถบขั้นใน header และ KPI tiles`, insert:
```md
- steps[].state 'not_needed' มีเฉพาะขั้นตรวจเครดิต: stage ซื้อแล้ว · ไม่มีเวลาเข้าขั้นเครดิต · path CASH หรือ EXTERNAL_FINANCE — ขั้นอื่นที่เลยมาโดยไม่มีเวลา = 'skipped' เหมือนเดิม
- evidence 'CHAT_FILE' มีเฉพาะขั้นตรวจเครดิต: เวลาเข้าขั้นเครดิตในแคช = เวลาไฟล์เอกสารที่ลูกค้าในครอบครัวส่งพอดี (เงื่อนไข CUSTOMER_DOCUMENT_FILE_SQL — .pdf / .doc(x) / .xls(x) · media_url ว่างและลิงก์แชร์ไม่นับ · คำตัดสินผู้ควบคุม R-P1 · เทียบเท่ากันพอดีแบบเดียวกับ 'MANUAL' ของขั้นนัด / จอง) · ใบตรวจเครดิตมาก่อนไฟล์ = 'SYSTEM' · ส่งให้ทุก role ที่อ่าน summary ได้ (ชนิด + เวลาเท่านั้น ตาม Ruling FR-CREDIT-STAGE)
- askHeardFrom = firstSource 'WALK_IN' · heardFrom ว่าง · ซื้อ (สัญญา + ใบขายที่นับว่าซื้อ) ไม่ถึง 2 ครั้ง — แบนเนอร์แท็บการเดินทางกับการ์ดหน้าสร้างสัญญาอ่านธงนี้ เว็บไม่คิดเงื่อนไขซ้ำ · ระบบไม่เขียน heardFrom ให้เอง
- creditFilePending = ยังไม่ซื้อ · มีไฟล์เอกสารของลูกค้า (เงื่อนไขเดียวกัน) ในห้องของครอบครัว · customers.credit_check_status = NONE — ช่อง KPI "เครดิต" แสดง 'ส่งไฟล์แล้ว รอตรวจ' (คำตัดสินเจ้าของข้อ 13(3) · บอร์ด Main (a) ในแคนวาสที่เคาะยังวาดช่องนี้เป็น 'ยังไม่เคยตรวจ' หลังส่งไฟล์ — คำตัดสินข้อ 13(3) มาทีหลังจึงชนะ ห้ามแก้กลับตามบอร์ด)
```

- [ ] **Step 11: Lint the touched files**

```bash
(cd apps/api && npx eslint src/modules/customer-journey/journey-summary.builder.ts src/modules/customer-journey/journey-summary.builder.spec.ts src/modules/customer-journey/journey-summary.service.ts src/modules/customer-journey/journey-summary.service.db.spec.ts src/modules/customer-journey/journey-summary.phase3.db.spec.ts)
(cd apps/web && npx eslint src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts)
```
Expected: no errors. Never run `npm run lint` in apps/api, because it applies `--fix`.

- [ ] **Step 12: Commit**

From the worktree root:
```bash
git add apps/api/src/modules/customer-journey/journey-summary.builder.ts \
  apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts \
  apps/api/src/modules/customer-journey/journey-summary.service.ts \
  apps/api/src/modules/customer-journey/journey-summary.service.db.spec.ts \
  apps/api/src/modules/customer-journey/journey-summary.phase3.db.spec.ts \
  apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts \
  docs/superpowers/specs/2026-09-15-customer-journey-design.md
git commit -m "$(cat <<'EOF'
feat(customer-journey): summary ขั้นเครดิต "ไม่ต้องตรวจ" · หลักฐานไฟล์ในแชท · ธงถามรู้จักร้าน · ธงไฟล์รอตรวจ

- ขั้นตรวจเครดิต not_needed เมื่อซื้อเงินสด/ไฟแนนซ์นอกโดยไม่มีหลักฐานเครดิต (ไม่นับเป็นข้าม · ยกเลิกใบขายแล้วไม่ค้าง)
- evidence CHAT_FILE เมื่อเวลาเข้าขั้นเครดิตตรงกับไฟล์เอกสารที่ลูกค้าส่งในแชท (คิวรีเดียวด้วย CUSTOMER_DOCUMENT_FILE_FRAGMENT · ชนิด + เวลาเท่านั้น ทุก role · ลิงก์แชร์ไม่นับ)
- askHeardFrom (ลูกค้าหน้าร้าน · ยังไม่ตอบ · ซื้อไม่ถึง 2 ครั้ง) และ creditFilePending (ส่งไฟล์แล้ว สถานะเครดิต NONE) คิดครั้งเดียวที่ API
- fixture เว็บ stageSteps รองรับ not_needed / CHAT_FILE · สเปครูป summary

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: one commit with exactly these 7 files. Check with `git show --stat HEAD`.

---

### Task 5: Read-time chat rows: customer file day row + first staff reply row

Goal: the journey timeline explains the automatic ③ "ตรวจเครดิต" signal (customer **document** files in chat — Controller ruling R-P1, the same condition Task 3 put in `chat-document-file.ts`) and shows how long the store took to answer the first time — both computed when the timeline is read, no writes, no migration.

Line numbers below are from the base `origin/main` `10d6e6d3a`. T1 edits `chat.source.ts` first (chat channel labels move to shared), so line numbers may shift by a few lines — **every edit below is anchored by its exact old text, never by line number**.

Every command runs from the worktree root (`/Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/feat+customer-detail-journey`). API commands run inside a `(cd apps/api && …)` subshell, so pasting a block never changes the shell's directory.

**Files:**
- Create: `apps/api/src/modules/customer-journey/sources/reply-gap.ts`
- Create: `apps/api/src/modules/customer-journey/sources/reply-gap.spec.ts`
- Modify: `apps/api/src/modules/customer-journey/sources/chat.source.ts`
  - import block (L6 — add two lines after the `./journey-window` import: Task 3's `CUSTOMER_DOCUMENT_FILE_FRAGMENT` and `formatReplyGap`)
  - `ChatDayRow` interface (HEAD L10)
  - `chatDays` docblock + SQL select list (HEAD L12-20)
  - CHAT_DAY loop inside `roomEvents` (HEAD L63-65)
  - `chatSource` docblock + export (HEAD L103-108) — new `firstStaffReplyEvents` function inserted before it
- Test (modify): `apps/api/src/modules/customer-journey/sources/chat.source.db.spec.ts` — L1 import, L12 `ids`, end of `beforeAll` (L37-38), `afterAll` (L40-47), append 4 tests after the cursor test (L76-78)
- Test (modify): `apps/api/src/modules/customer-journey/sources/role-visibility.spec.ts` — append 1 test after L53-55
- Test (modify): `apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts` — L1 import, L10 `FORBIDDEN_KEYS`, L51 seed messages, L108 type list
- Test (modify): `apps/api/src/modules/customer-journey/journey-shared-contract.spec.ts` (created by T1) — the `chatDb()` mock inside `describe('chatSource — ถ้อยคำแถวห้องแชทเท่าเดิมหลังย้ายป้ายช่องทางไป shared', …)` gains `customerJourneyState.findUnique` (resolves `null`): `chatSource` now always reads the cached state for the first-staff-reply row, so without it the 6 chat tests of that describe throw `TypeError: Cannot read properties of undefined (reading 'findUnique')`
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md` — event table: new `CHAT_CUSTOMER_FILE` row directly before the `FIRST_STAFF_REPLY` row (HEAD L260); the `FIRST_STAFF_REPLY` label cell and its last cell (L260). The middle "source" cell of L260 describes the staff_reply CTE (merged in #1595, part of the base) — out of this task's scope, do not touch it.

**Interfaces:**

Consumes:
- T1 has landed (file state only — this task imports no T1 symbol).
- Task 3: `apps/api/src/modules/customer-journey/chat-document-file.ts` — `export const CUSTOMER_DOCUMENT_FILE_FRAGMENT: Prisma.Sql` (`Prisma.raw` of `m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '\.(pdf|docx?|xlsx?)(\?|$)'`, alias `m` = `chat_messages`, no bind values) · `chat-document-file.spec.ts` fails if `chat.source.ts` contains `'FILE'` or `pdf|docx` itself.
- Cached `customer_journey_states` row via `prisma.customerJourneyState`: `customerId: string`, `firstStaffReplyAt: Date | null`, `contactedAt: Date`, `firstChannel: string` (produced by `journey-state.sql`; the staff_reply CTE fix #1595 is merged into the base — this task only reads the column).
- `chat.source.ts` internals: `chatDays(prisma, roomIds): Promise<ChatDayRow[]>`, `roomEvents(prisma, customerIds, actor)`, `leadEvents(prisma, customerIds, window)`, `createdEvents(prisma, customerIds)`; `CHAT_SOURCE_PREFIX` (`'CHAT_'`) already imported from `@installment/shared` on line 2.
- `journey-window.ts`: `roleSeesGroup(role: string, group: JourneyEventGroup): boolean`, `finalizeSource(events: JourneyEvent[], window: JourneyWindow): JourneyEvent[]`, `type JourneySource`.
- `room-credit-access.ts`: `roomAssignmentScope(actor): Prisma.ChatRoomWhereInput` (already applied to rooms inside `roomEvents`).
- Source contract: `customerIds[0]` is always the live customer (`CustomerJourneyService.list` builds `ids = [customerId, ...mergedCustomerIds]`; `JourneySummaryService` reads the cache with `findUnique({ where: { customerId } })` the same way).

Produces:
- `apps/api/src/modules/customer-journey/sources/reply-gap.ts`:
  ```ts
  export function formatReplyGap(ms: number): string;
  // floor · minimum 1 minute · < 60 min → `${n} นาที` · < 24 h → `${floor h} ชม.` · otherwise `${floor d} วัน`
  ```
- `ChatDayRow` (module-private): `{ roomId: string; day: string; customer: number; staff: number; bot: number; files: number; lastFileAt: Date | null; firstCustomerAt: Date | null; lastAt: Date }`
- `chatDays` SQL adds (condition = Task 3's fragment, never a copy)
  `(COUNT(*) FILTER (WHERE ${CUSTOMER_DOCUMENT_FILE_FRAGMENT}))::int AS "files"` and
  `MAX(m.created_at) FILTER (WHERE ${CUSTOMER_DOCUMENT_FILE_FRAGMENT}) AS "lastFileAt"` — `media_url` stays inside FILTER, never selected
- Timeline row `CHAT_CUSTOMER_FILE` (one per room per Bangkok day, same room scope as `CHAT_DAY`; `CHAT_DAY` counts unchanged):
  `{ id: 'chatfile-<roomId>-<YYYY-MM-DD>', type: 'CHAT_CUSTOMER_FILE', group: 'chat', stage: 'CREDIT', timestamp: lastFileAt.toISOString(), title: 'ลูกค้าส่งไฟล์ในแชท' + (files > 1 ? ' ' + files + ' ไฟล์' : ''), actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE', href: '/inbox/<roomId>' }`
- Timeline row `FIRST_STAFF_REPLY` (built at the `chatSource` top level, gated only by `roleSeesGroup(role, 'chat')`, no room scope, no href):
  `{ id: 'staffreply-<customerId>', type: 'FIRST_STAFF_REPLY', group: 'chat', stage: null, timestamp: firstStaffReplyAt.toISOString(), title: 'ร้านตอบครั้งแรก (หลังทัก ' + formatReplyGap(reply − anchor) + ')', actor: { type: 'STAFF' }, reliability: 'approximate', origin: 'SOURCE' }`
  - anchor = `state.contactedAt` when `state.firstChannel.startsWith('CHAT_')`; otherwise `MIN(chat_messages.created_at) WHERE role = 'CUSTOMER'` over every room whose `customer_id ∈ customerIds` (soft-deleted rooms/messages included, no room scope — it is a time only)
  - omitted when the state row is missing, `firstStaffReplyAt` is null, the anchor is null, or `firstStaffReplyAt < anchor`
- PDPA snapshot `FORBIDDEN_KEYS` gains `'mediaUrl'`, `'mediaType'`.
- Spec event table: `CHAT_CUSTOMER_FILE` row; `FIRST_STAFF_REPLY` label `ร้านตอบครั้งแรก (หลังทัก {N นาที|N ชม.|N วัน})` plus read-time notes.

API DB test database used below (per-file TDD DB of plans 1-2, all migrations applied, session timezone Asia/Bangkok):
`postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public`

---

- [ ] **Step 1: Confirm the anchors this task edits still exist (T1 may have moved lines)**

Run from the worktree root:

```bash
grep -n "export const CUSTOMER_DOCUMENT_FILE_FRAGMENT" apps/api/src/modules/customer-journey/chat-document-file.ts
grep -n "type JourneyWindow } from './journey-window';" apps/api/src/modules/customer-journey/sources/chat.source.ts
grep -n "interface ChatDayRow" apps/api/src/modules/customer-journey/sources/chat.source.ts
grep -n "metadata: { customerMessages: row.customer" apps/api/src/modules/customer-journey/sources/chat.source.ts
grep -n "export const chatSource: JourneySource" apps/api/src/modules/customer-journey/sources/chat.source.ts
grep -n "CHAT_SOURCE_PREFIX" apps/api/src/modules/customer-journey/sources/chat.source.ts
grep -c "| FIRST_STAFF_REPLY | ร้านตอบครั้งแรก (หลังทัก {x} นาที) |" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "| — (จุดสัมผัส ไม่เลื่อนขั้น) | ร้าน | approximate |" docs/superpowers/specs/2026-09-15-customer-journey-design.md
```

Expected: the first five commands print one line each (the first is Task 3's fragment — missing = Task 3 has not landed: stop); the sixth prints the `@installment/shared` import line and the `createdEvents` use; the last two print `1`. If an anchor is missing, re-read the file (T1 changed it) and adapt only the anchor text, not the code being added.

- [ ] **Step 2: Write the failing formatter test**

Create `apps/api/src/modules/customer-journey/sources/reply-gap.spec.ts`:

```ts
import { formatReplyGap } from './reply-gap';

const NBSP = ' ';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatReplyGap — ระยะห่าง "หลังทัก" ของแถวร้านตอบครั้งแรก (คำตัดสินข้อ 12)', () => {
  it.each<[number, string]>([
    [0, `1${NBSP}นาที`],
    [59_999, `1${NBSP}นาที`],
    [59 * MIN, `59${NBSP}นาที`],
    [60 * MIN - 1, `59${NBSP}นาที`],
    [60 * MIN, `1${NBSP}ชม.`],
    [23 * HOUR + 59 * MIN, `23${NBSP}ชม.`],
    [DAY - 1, `23${NBSP}ชม.`],
    [DAY, `1${NBSP}วัน`],
    [2 * DAY + 23 * HOUR, `2${NBSP}วัน`],
  ])('%d ms → %s', (ms, expected) => {
    expect(formatReplyGap(ms)).toBe(expected);
  });

  it('เลขติดหน่วยด้วยเว้นวรรคไม่ตัดบรรทัด (U+00A0) ไม่มีเว้นวรรคธรรมดา', () => {
    for (const ms of [0, 90 * MIN, 3 * DAY]) {
      expect(formatReplyGap(ms)).toContain(NBSP);
      expect(formatReplyGap(ms)).not.toContain(' ');
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
(cd apps/api && TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/reply-gap.spec.ts --runInBand)
```

Expected: FAIL — `Cannot find module './reply-gap' from 'modules/customer-journey/sources/reply-gap.spec.ts'` (Test Suites: 1 failed).

- [ ] **Step 4: Implement the formatter**

Create `apps/api/src/modules/customer-journey/sources/reply-gap.ts`:

```ts
/** เว้นวรรคแบบไม่ตัดบรรทัด (U+00A0) — เลขกับหน่วยอยู่บรรทัดเดียวกันเสมอ (คำตัดสินเจ้าของ 2026-09-15 ข้อ 12) */
const NBSP = ' ';
const MINUTE_MS = 60_000;

/**
 * ระยะห่างของแถว "ร้านตอบครั้งแรก (หลังทัก …)" — ปัดลงทุกหน่วย · ต่ำสุด 1 นาที (ไม่แสดง "0 นาที")
 * ต่ำกว่า 60 นาที → "N นาที" · ต่ำกว่า 24 ชม. → "N ชม." · ตั้งแต่ 24 ชม. → "N วัน"
 * ผู้เรียกไม่ส่งค่าติดลบ (chat.source ไม่ออกแถวเมื่อคำตอบมาก่อนจุดเริ่ม)
 */
export function formatReplyGap(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / MINUTE_MS));
  if (minutes < 60) return `${minutes}${NBSP}นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${NBSP}ชม.`;
  return `${Math.floor(hours / 24)}${NBSP}วัน`;
}
```

- [ ] **Step 5: Run the formatter test and watch it pass**

```bash
(cd apps/api && TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/reply-gap.spec.ts --runInBand)
```

Expected: PASS — Tests: 10 passed.

- [ ] **Step 6: Extend the real-DB chat source spec — import, ids, seed, cleanup**

In `apps/api/src/modules/customer-journey/sources/chat.source.db.spec.ts`:

(a) Replace

```ts
import { ChatChannel, MessageRole, PrismaClient } from '@prisma/client';
```

with

```ts
import { ChatChannel, MessageRole, MessageType, PrismaClient } from '@prisma/client';
```

(b) Replace

```ts
  const ids = { staff: '', staffName: '', other: '', customer: '', walkIn: '', open: '', assigned: '' };
```

with

```ts
  const ids = {
    staff: '', staffName: '', other: '', customer: '', walkIn: '', open: '', assigned: '',
    filer: '', fileOpen: '', fileAssigned: '', walkInChat: '', walkInPlaceholder: '', walkInRoom: '', walkInPlaceholderRoom: '', noReply: '', noAnchor: '', replyEarly: '',
  };
  const NBSP = ' ';
```

(c) At the end of `beforeAll`, replace

```ts
      newValue: { customerName: 'สมชาย ใจดี', phone: '0899999999', address: 'บ้านเลขที่ 99/1', productId: 'p-1', packageChoice: 'B', downAmount: 3000, visitPlan: 'เสาร์นี้' } } });
  });
```

with

```ts
      newValue: { customerName: 'สมชาย ใจดี', phone: '0899999999', address: 'บ้านเลขที่ 99/1', productId: 'p-1', packageChoice: 'B', downAmount: 3000, visitPlan: 'เสาร์นี้' } } });

    // เฟส 3 — ไฟล์ที่ลูกค้าส่งในแชท + ร้านตอบครั้งแรก · แคช state ใส่ตรง ๆ (แหล่งอ่านแคช ไม่พึ่งกติกา staff_reply ใน journey-state.sql)
    ids.filer = (await prisma.customer.create({ data: { name: 'journey file spec', acquisitionSource: 'CHAT_FACEBOOK' } })).id;
    ids.walkInChat = (await prisma.customer.create({ data: { name: 'journey walk-in chat spec', createdAt: new Date('2026-09-01T03:00:00.000Z') } })).id;
    ids.walkInPlaceholder = (await prisma.customer.create({ data: { name: 'Facebook #journey-spec', acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date('2026-09-06T00:00:00.000Z'), mergedIntoId: ids.walkInChat } })).id;
    ids.noReply = (await prisma.customer.create({ data: { name: 'journey no reply spec', acquisitionSource: 'CHAT_FACEBOOK' } })).id;
    ids.noAnchor = (await prisma.customer.create({ data: { name: 'journey no anchor spec', createdAt: new Date('2026-09-01T03:00:00.000Z') } })).id;
    ids.replyEarly = (await prisma.customer.create({ data: { name: 'journey reply early spec', acquisitionSource: 'CHAT_FACEBOOK' } })).id;
    const room = async (customerId: string, channel: ChatChannel, iso: string, key: string, assignedToId?: string) =>
      (await prisma.chatRoom.create({ data: { channel, externalUserId: `journey-${key}-${stamp}`, customerId, assignedToId, createdAt: new Date(iso) } })).id;
    ids.fileOpen = await room(ids.filer, ChatChannel.FACEBOOK, '2026-09-10T01:50:00.000Z', 'file-open');
    ids.fileAssigned = await room(ids.filer, ChatChannel.LINE_SHOP, '2026-09-10T03:00:00.000Z', 'file-assigned', ids.other);
    ids.walkInRoom = await room(ids.walkInChat, ChatChannel.FACEBOOK, '2026-09-05T01:00:00.000Z', 'walkin-room', ids.other);
    ids.walkInPlaceholderRoom = await room(ids.walkInPlaceholder, ChatChannel.FACEBOOK, '2026-09-04T22:00:00.000Z', 'walkin-placeholder-room', ids.other);
    // ชื่อไฟล์ ลิงก์ และชนิดไฟล์เป็นค่าเฝ้าระวัง — ต้องไม่หลุดถึงคำตอบ · ค่าเริ่มต้นลงท้าย .pdf = ไฟล์เอกสาร (CUSTOMER_DOCUMENT_FILE_SQL)
    const typed = (roomId: string, role: MessageRole, type: MessageType, iso: string, mediaUrl: string | null = 'https://files.example.test/sentinel-media.pdf') => ({
      roomId, role, type, text: 'statement-sentinel.pdf', mediaUrl, mediaType: 'application/x-sentinel', createdAt: new Date(iso),
    });
    await prisma.chatMessage.createMany({ data: [
      msg(ids.fileOpen, MessageRole.CUSTOMER, 'ขอส่งเอกสารครับ', '2026-09-10T02:00:00.000Z'), // 09:00 ไทยวันที่ 10
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T02:05:00.000Z'),
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T02:06:00.000Z'),
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T02:07:00.000Z'),
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T02:08:00.000Z', null), // ไม่มีลิงก์ไฟล์ ไม่นับ (R-P1)
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T02:09:00.000Z', 'https://www.facebook.com/share/p/sentinel-share/'), // ลิงก์แชร์ที่ webhook เก็บเป็น FILE ไม่นับ
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-12T03:00:00.000Z', 'https://files.example.test/sentinel-photo.jpg'), // วันที่มีแต่ไฟล์ที่ไม่ใช่เอกสาร → ไม่มีแถวไฟล์
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.IMAGE, '2026-09-10T02:10:00.000Z'), // รูปภาพไม่นับ (ใหม่กว่าไฟล์ล่าสุด)
      typed(ids.fileOpen, MessageRole.STAFF, MessageType.FILE, '2026-09-10T02:15:00.000Z'), // ไฟล์ของร้านไม่นับ
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T18:00:00.000Z'), // 01:00 ไทยวันที่ 11 — UTC ยังเป็นวันที่ 10
      typed(ids.fileAssigned, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T03:30:00.000Z'),
      msg(ids.walkInPlaceholderRoom, MessageRole.CUSTOMER, 'สวัสดีครับ', '2026-09-04T22:00:00.000Z'), // ข้อความลูกค้าแรกของครอบครัว อยู่ในห้องของ placeholder
      msg(ids.walkInRoom, MessageRole.CUSTOMER, 'ยังมีเครื่องไหม', '2026-09-05T01:00:00.000Z'),
      msg(ids.walkInRoom, MessageRole.STAFF, 'มีค่ะ', '2026-09-05T04:00:00.000Z'),
    ] });
    const state = (customerId: string, firstChannel: string, contactedAt: string, firstStaffReplyAt: string | null) => ({
      customerId, stage: 'CONTACTED', stageEnteredAt: new Date(contactedAt), path: 'UNKNOWN', contactedAt: new Date(contactedAt), firstChannel, firstSource: firstChannel,
      firstStaffReplyAt: firstStaffReplyAt ? new Date(firstStaffReplyAt) : null, computedAt: new Date('2026-09-14T00:00:00.000Z'),
    });
    await prisma.customerJourneyState.createMany({ data: [
      // ทักแชทก่อน: นับจาก contactedAt (ห้องเกิด 01:50 ก่อนข้อความลูกค้า 02:00) → 25 นาที · ถ้านับจากข้อความลูกค้าแรกจะได้ 15 นาที
      state(ids.filer, 'CHAT_FACEBOOK', '2026-09-10T01:50:00.000Z', '2026-09-10T02:15:00.000Z'),
      // มาหน้าร้านก่อน: นับจากข้อความลูกค้าแรกของทุกห้องในครอบครัว (ห้อง placeholder 4 ก.ย. 22:00 UTC) → 6 ชม. · contactedAt จะได้ 4 วัน · ห้องของลูกค้าเองอย่างเดียวจะได้ 3 ชม.
      state(ids.walkInChat, 'WALK_IN', '2026-09-01T03:00:00.000Z', '2026-09-05T04:00:00.000Z'),
      state(ids.noReply, 'CHAT_FACEBOOK', '2026-09-10T02:00:00.000Z', null),
      state(ids.noAnchor, 'WALK_IN', '2026-09-01T03:00:00.000Z', '2026-09-02T03:00:00.000Z'), // ไม่มีห้อง/ข้อความลูกค้า ⇒ หาจุดเริ่มไม่ได้
      state(ids.replyEarly, 'CHAT_FACEBOOK', '2026-09-10T05:00:00.000Z', '2026-09-10T04:00:00.000Z'), // คำตอบก่อนจุดเริ่ม
    ] });
  });
```

(d) Replace the whole `afterAll`

```ts
  afterAll(async () => {
    const roomIds = [ids.open, ids.assigned];
    await prisma.todo.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.customer, ids.walkIn] } } });
    await prisma.$disconnect();
  });
```

with

```ts
  afterAll(async () => {
    const roomIds = [ids.open, ids.assigned, ids.fileOpen, ids.fileAssigned, ids.walkInRoom, ids.walkInPlaceholderRoom];
    const phase3 = [ids.filer, ids.walkInChat, ids.noReply, ids.noAnchor, ids.replyEarly];
    await prisma.todo.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: phase3 } } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.walkInPlaceholder] } } }); // placeholder ก่อนเป้าหมาย (merged_into_id)
    await prisma.customer.deleteMany({ where: { id: { in: [ids.customer, ids.walkIn, ...phase3] } } });
    await prisma.$disconnect();
  });
```

- [ ] **Step 7: Append the four phase-3 DB tests**

In the same file, replace the end of the cursor test and the closing of the describe

```ts
    expect(page.map((e) => e.id)).toEqual(all.slice(2, 4).map((e) => e.id));
  });
});
```

with

```ts
    expect(page.map((e) => e.id)).toEqual(all.slice(2, 4).map((e) => e.id));
  });

  it('เฟส 3: ไฟล์เอกสารที่ลูกค้าส่ง = แถวละห้องต่อวันไทย · เวลา = ไฟล์เอกสารล่าสุดของวัน · ไม่นับรูปภาพ/ไฟล์ของร้าน/ไม่มีลิงก์/ลิงก์แชร์ · แถวคุยแชทนับเท่าเดิม · ไม่หลุดชื่อไฟล์/ลิงก์', async () => {
    const events = await chatSource(db, [ids.filer], { limit: 50 }, OWNER);
    const fileRow = { type: 'CHAT_CUSTOMER_FILE', group: 'chat', stage: 'CREDIT', actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE' };
    expect(byId(events, `chatfile-${ids.fileOpen}-2026-09-10`)).toEqual({
      ...fileRow, id: `chatfile-${ids.fileOpen}-2026-09-10`, timestamp: '2026-09-10T02:07:00.000Z', title: 'ลูกค้าส่งไฟล์ในแชท 3 ไฟล์', href: `/inbox/${ids.fileOpen}`,
    });
    expect(byId(events, `chatfile-${ids.fileOpen}-2026-09-11`)).toEqual({
      ...fileRow, id: `chatfile-${ids.fileOpen}-2026-09-11`, timestamp: '2026-09-10T18:00:00.000Z', title: 'ลูกค้าส่งไฟล์ในแชท', href: `/inbox/${ids.fileOpen}`,
    });
    expect(byId(events, `chatfile-${ids.fileAssigned}-2026-09-10`)).toMatchObject({ timestamp: '2026-09-10T03:30:00.000Z', title: 'ลูกค้าส่งไฟล์ในแชท', href: `/inbox/${ids.fileAssigned}` });
    expect(events.filter((e) => e.type === 'CHAT_CUSTOMER_FILE')).toHaveLength(3);
    expect(byId(events, `chatfile-${ids.fileOpen}-2026-09-12`)).toBeUndefined();
    expect(byId(events, `chatday-${ids.fileOpen}-2026-09-12`)).toBeDefined();
    // CHAT_DAY นับข้อความลูกค้าทุกชนิด (รวมไฟล์ที่ไม่ใช่เอกสาร 2 ข้อความ) — เงื่อนไขไฟล์เอกสารใช้กับแถวไฟล์เท่านั้น
    expect(byId(events, `chatday-${ids.fileOpen}-2026-09-10`)).toMatchObject({ timestamp: '2026-09-10T02:15:00.000Z', title: 'คุยแชท: ลูกค้า 7 ข้อความ · ร้านตอบ 1' });
    const json = JSON.stringify(events);
    for (const secret of ['sentinel', 'ขอส่งเอกสาร', 'facebook.com']) expect(json).not.toContain(secret);
  });

  it('เฟส 3: SALES ไม่เห็นแถวไฟล์ของห้องที่คนอื่นดูแล · ACCOUNTANT ไม่ได้ทั้งแถวไฟล์และร้านตอบครั้งแรก', async () => {
    const sales = await chatSource(db, [ids.filer], { limit: 50 }, { id: ids.staff, role: 'SALES' });
    expect(sales.some((e) => e.id === `chatfile-${ids.fileAssigned}-2026-09-10`)).toBe(false);
    expect(sales.some((e) => e.id === `chatfile-${ids.fileOpen}-2026-09-10`)).toBe(true);
    const accountant = { id: 'a1', role: 'ACCOUNTANT' };
    expect(await chatSource(db, [ids.filer], { limit: 50 }, accountant)).toEqual([]);
    expect(await chatSource(db, [ids.walkInChat, ids.walkInPlaceholder], { limit: 50 }, accountant)).toEqual([]);
  });

  it('เฟส 3: ร้านตอบครั้งแรก — ทักแชทก่อนนับจาก contactedAt · มาหน้าร้านก่อนนับจากข้อความลูกค้าแรกของทุกห้องในครอบครัว · ไม่ผูกสิทธิ์ห้อง · ไม่มีลิงก์', async () => {
    const replyRow = { type: 'FIRST_STAFF_REPLY', group: 'chat', stage: null, actor: { type: 'STAFF' }, reliability: 'approximate', origin: 'SOURCE' };
    expect(byId(await chatSource(db, [ids.filer], { limit: 50 }, OWNER), `staffreply-${ids.filer}`)).toEqual({
      ...replyRow, id: `staffreply-${ids.filer}`, timestamp: '2026-09-10T02:15:00.000Z', title: `ร้านตอบครั้งแรก (หลังทัก 25${NBSP}นาที)`,
    });
    const walkIn = { ...replyRow, id: `staffreply-${ids.walkInChat}`, timestamp: '2026-09-05T04:00:00.000Z', title: `ร้านตอบครั้งแรก (หลังทัก 6${NBSP}ชม.)` };
    expect(byId(await chatSource(db, [ids.walkInChat, ids.walkInPlaceholder], { limit: 50 }, OWNER), walkIn.id)).toEqual(walkIn);
    // ทั้งสองห้องมีคนอื่นดูแล ⇒ SALES ไม่เห็นห้องเลย แต่ยังได้แถวร้านตอบครั้งแรก (เวลาเดียวกันอยู่ใน summary ที่ทุกบทบาทอ่านได้)
    const sales = await chatSource(db, [ids.walkInChat, ids.walkInPlaceholder], { limit: 50 }, { id: ids.staff, role: 'SALES' });
    expect(sales.map((e) => e.type).sort()).toEqual(['CUSTOMER_CREATED_BY_STAFF', 'FIRST_STAFF_REPLY']);
    expect(byId(sales, walkIn.id)).toEqual(walkIn);
  });

  it('เฟส 3: ไม่ออกแถวร้านตอบครั้งแรกเมื่อยังไม่มีคำตอบ · หาจุดเริ่มไม่ได้ · คำตอบมาก่อนจุดเริ่ม', async () => {
    expect(await chatSource(db, [ids.noReply], { limit: 50 }, OWNER)).toEqual([]);
    expect((await chatSource(db, [ids.noAnchor], { limit: 50 }, OWNER)).map((e) => e.type)).toEqual(['CUSTOMER_CREATED_BY_STAFF']);
    expect(await chatSource(db, [ids.replyEarly], { limit: 50 }, OWNER)).toEqual([]);
  });
});
```

- [ ] **Step 8: Add the table-driven role test**

In `apps/api/src/modules/customer-journey/sources/role-visibility.spec.ts` (its `JOURNEY_HIDDEN_GROUPS` is mocked to `{ SALES: ['chat'] }`, so here SALES is the hidden role and ACCOUNTANT is a visible one), replace the end of the last test and the closing of the describe

```ts
    await expect(entriesSourceFor(groups)(entries as unknown as PrismaService, ['c1'], { limit: 30 }, ACCOUNTANT)).resolves.toMatchObject([{ id: 'entry-handoff', href: '/inbox/r2' }]);
  });
});
```

with

```ts
    await expect(entriesSourceFor(groups)(entries as unknown as PrismaService, ['c1'], { limit: 30 }, ACCOUNTANT)).resolves.toMatchObject([{ id: 'entry-handoff', href: '/inbox/r2' }]);
  });

  it('แถวไฟล์ในแชท · ร้านตอบครั้งแรก ตามกลุ่ม chat ของตาราง — บทบาทที่ถูกซ่อนไม่ได้ทั้งสองแถวและไม่ยิง DB · บทบาทที่เห็นได้ทั้งสองแถว', async () => {
    // ตารางสมมติของไฟล์นี้ซ่อน chat จาก SALES ⇒ ไม่แตะ prisma เลย (รวมแคช state ของแถวร้านตอบครั้งแรก)
    await expect(chatSource(untouchable, ['c1', 'p1'], { limit: 30 }, SALES)).resolves.toEqual([]);

    const chat = {
      chatRoom: { findMany: jest.fn().mockResolvedValue([{ id: 'r1', channel: 'FACEBOOK', createdAt: at('2026-09-10T02:00:00.000Z') }]) },
      $queryRaw: jest.fn().mockResolvedValue([{
        roomId: 'r1', day: '2026-09-10', customer: 3, staff: 1, bot: 0, files: 2, lastFileAt: at('2026-09-10T02:07:00.000Z'),
        firstCustomerAt: at('2026-09-10T02:00:00.000Z'), lastAt: at('2026-09-10T02:15:00.000Z'),
      }]),
      todo: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      customerJourneyState: {
        findUnique: jest.fn().mockResolvedValue({ customerId: 'c1', firstStaffReplyAt: at('2026-09-10T02:15:00.000Z'), contactedAt: at('2026-09-10T02:00:00.000Z'), firstChannel: 'CHAT_FACEBOOK' }),
      },
    };
    const events = await chatSource(chat as unknown as PrismaService, ['c1', 'p1'], { limit: 30 }, ACCOUNTANT);
    expect(events.find((e) => e.type === 'CHAT_CUSTOMER_FILE')).toMatchObject({ id: 'chatfile-r1-2026-09-10', title: 'ลูกค้าส่งไฟล์ในแชท 2 ไฟล์', href: '/inbox/r1' });
    expect(events.find((e) => e.type === 'FIRST_STAFF_REPLY')).toMatchObject({ id: 'staffreply-c1', title: 'ร้านตอบครั้งแรก (หลังทัก 15 นาที)' });
    // ids[0] = ลูกค้าที่ยังมีชีวิต — ไม่ค้นแคชของ placeholder
    expect(chat.customerJourneyState.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: 'c1' } }));
  });
});
```

- [ ] **Step 9: Extend the PDPA snapshot spec**

In `apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts`:

(a) Replace

```ts
import { ChatChannel, DunningActionStatus, DunningChannel, MessageRole, Prisma, PrismaClient } from '@prisma/client';
```

with

```ts
import { ChatChannel, DunningActionStatus, DunningChannel, MessageRole, MessageType, Prisma, PrismaClient } from '@prisma/client';
```

(b) Replace

```ts
const FORBIDDEN_KEYS = ['phone', 'phoneSecondary', 'nationalId', 'address', 'addressCurrent', 'addressIdCard', 'addressWork', 'text', 'content', 'messageContent', 'notes', 'note', 'voiceMemoUrl', 'overrideReason', 'customerName', 'reviewNotes', 'voidReason', 'defectDescription', 'reason'];
```

with

```ts
const FORBIDDEN_KEYS = ['phone', 'phoneSecondary', 'nationalId', 'address', 'addressCurrent', 'addressIdCard', 'addressWork', 'text', 'mediaUrl', 'mediaType', 'content', 'messageContent', 'notes', 'note', 'voiceMemoUrl', 'overrideReason', 'customerName', 'reviewNotes', 'voidReason', 'defectDescription', 'reason'];
```

(c) Replace

```ts
      { roomId: ids.open, role: MessageRole.STAFF, text: `ส่งที่ ${address}` },
```

with

```ts
      { roomId: ids.open, role: MessageRole.STAFF, text: `ส่งที่ ${address}` },
      // เฟส 3: ไฟล์เอกสารของลูกค้า (ลิงก์ลงท้าย .pdf — R-P1) ขึ้นแถวไทม์ไลน์ได้ แต่ชื่อไฟล์/ลิงก์/ชนิดไฟล์ต้องไม่หลุด · media_url อยู่ใน FILTER เท่านั้น
      { roomId: ids.open, role: MessageRole.CUSTOMER, type: MessageType.FILE, text: `สำเนาบัตร-${nationalId}.pdf`, mediaUrl: `https://files.example.test/${phone}.pdf`, mediaType: 'application/pdf' },
```

(d) Replace

```ts
    for (const type of ['CHAT_ROOM_OPENED', 'CHAT_DAY', 'APPOINTMENT', 'AI_LEAD_CAPTURED', 'CUSTOMER_CREATED_BY_STAFF', 'CREDIT_CHECK_OPENED', 'TAG_ADDED', 'PLACEHOLDER_MERGED', 'TOUCHPOINT']) expect(types).toContain(type);
```

with

```ts
    for (const type of ['CHAT_ROOM_OPENED', 'CHAT_DAY', 'CHAT_CUSTOMER_FILE', 'APPOINTMENT', 'AI_LEAD_CAPTURED', 'CUSTOMER_CREATED_BY_STAFF', 'CREDIT_CHECK_OPENED', 'TAG_ADDED', 'PLACEHOLDER_MERGED', 'TOUCHPOINT']) expect(types).toContain(type);
```

- [ ] **Step 10: Run the three specs and watch the new tests fail**

```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/chat.source.db.spec.ts src/modules/customer-journey/sources/role-visibility.spec.ts src/modules/customer-journey/customer-journey.pdpa.db.spec.ts --runInBand)
```

Expected: 3 suites FAIL.
- `chat.source.db.spec.ts`: Tests 3 failed, 4 passed — the file-row test (`expect(received).toEqual(expected)`, received `undefined`), the SALES/ACCOUNTANT test (`expect(received).toBe(expected)`, expected `true` for the open-room file row) and the staff-reply test (received `undefined`) fail; the three existing tests and the "no row" guard test pass.
- `role-visibility.spec.ts`: Tests 1 failed, 2 passed — `expect(received).toMatchObject(expected)`: "received value must be a non-null object" for `CHAT_CUSTOMER_FILE`.
- `customer-journey.pdpa.db.spec.ts`: Tests 1 failed, 5 passed — `expect(received).toContain(expected)` for `CHAT_CUSTOMER_FILE`.

- [ ] **Step 11: Implement the file day row in `chat.source.ts`**

In `apps/api/src/modules/customer-journey/sources/chat.source.ts`:

(a) Directly after the import line that ends with `type JourneyWindow } from './journey-window';`, add:

```ts
import { CUSTOMER_DOCUMENT_FILE_FRAGMENT } from '../chat-document-file';
import { formatReplyGap } from './reply-gap';
```

(b) Replace

```ts
interface ChatDayRow { roomId: string; day: string; customer: number; staff: number; bot: number; firstCustomerAt: Date | null; lastAt: Date }

/** นับแถวอย่างเดียว ไม่อ่าน text/media · รวมแถวที่ retention soft-delete · created_at = timestamp(3) เก็บ UTC · ไม่มี LIMIT (หลักร้อยวันต่อคน) ตัดใน finalizeSource */
function chatDays(prisma: PrismaService, roomIds: string[]): Promise<ChatDayRow[]> {
  return prisma.$queryRaw<ChatDayRow[]>`
    SELECT m.room_id AS "roomId",
           to_char(((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS "day",
           (COUNT(*) FILTER (WHERE m.role = 'CUSTOMER'))::int AS "customer",
           (COUNT(*) FILTER (WHERE m.role = 'STAFF'))::int AS "staff",
           (COUNT(*) FILTER (WHERE m.role = 'BOT'))::int AS "bot",
```

with

```ts
interface ChatDayRow { roomId: string; day: string; customer: number; staff: number; bot: number; files: number; lastFileAt: Date | null; firstCustomerAt: Date | null; lastAt: Date }

/**
 * นับแถวอย่างเดียว ไม่อ่าน text/media_type และไม่ select media_url · รวมแถวที่ retention soft-delete · created_at = timestamp(3) เก็บ UTC · ไม่มี LIMIT (หลักร้อยวันต่อคน) ตัดใน finalizeSource
 * files/lastFileAt = ไฟล์เอกสารที่ลูกค้าส่ง — เงื่อนไข CUSTOMER_DOCUMENT_FILE_FRAGMENT จาก chat-document-file.ts (ชุดเดียวกับ first_file_at ใน journey-state.sql · คำตัดสินผู้ควบคุม R-P1)
 *   media_url อยู่ใน FILTER เท่านั้น · รูปภาพ / ไฟล์ของร้าน / ไม่มีลิงก์ / ลิงก์แชร์ ไม่นับ · CHAT_DAY ยังนับข้อความลูกค้าทุกชนิด
 */
function chatDays(prisma: PrismaService, roomIds: string[]): Promise<ChatDayRow[]> {
  return prisma.$queryRaw<ChatDayRow[]>`
    SELECT m.room_id AS "roomId",
           to_char(((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS "day",
           (COUNT(*) FILTER (WHERE m.role = 'CUSTOMER'))::int AS "customer",
           (COUNT(*) FILTER (WHERE m.role = 'STAFF'))::int AS "staff",
           (COUNT(*) FILTER (WHERE m.role = 'BOT'))::int AS "bot",
           (COUNT(*) FILTER (WHERE ${CUSTOMER_DOCUMENT_FILE_FRAGMENT}))::int AS "files",
           MAX(m.created_at) FILTER (WHERE ${CUSTOMER_DOCUMENT_FILE_FRAGMENT}) AS "lastFileAt",
```

The rest of the SQL (`firstCustomerAt`, `lastAt`, `FROM`, `WHERE`, `GROUP BY`) stays exactly as it is. `${CUSTOMER_DOCUMENT_FILE_FRAGMENT}` is a `Prisma.raw` fragment, so it is spliced into the SQL text (no bind value) and its alias `m` matches `FROM chat_messages m`.

(c) Replace

```ts
      metadata: { customerMessages: row.customer, staffMessages: row.staff, botMessages: row.bot },
    });
  }
```

with

```ts
      metadata: { customerMessages: row.customer, staffMessages: row.staff, botMessages: row.bot },
    });
    if (row.files > 0 && row.lastFileAt) {
      // คำตัดสินข้อ 12: วันละแถวต่อห้อง ไม่ใช่แถวละไฟล์ · เวลา = ไฟล์เอกสารล่าสุดของวัน · CHAT_DAY ยังนับไฟล์รวมในจำนวนข้อความลูกค้า · หลักฐานขั้น 3 ตรวจเครดิต (ชุดเดียวกับแคช)
      events.push({
        id: `chatfile-${row.roomId}-${row.day}`, type: 'CHAT_CUSTOMER_FILE', group: 'chat', stage: 'CREDIT', timestamp: row.lastFileAt.toISOString(),
        title: `ลูกค้าส่งไฟล์ในแชท${row.files > 1 ? ` ${row.files} ไฟล์` : ''}`, actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE', href: `/inbox/${row.roomId}`,
      });
    }
  }
```

- [ ] **Step 12: Implement the first-staff-reply row in `chat.source.ts`**

Replace

```ts
/** กลุ่ม chat · PDPA: ไม่อ่าน chat_messages.text · todo.title/description · เบอร์/ที่อยู่ใน audit */
export const chatSource: JourneySource = async (prisma, customerIds, window, actor) => {
  if (!roleSeesGroup(actor.role, 'chat')) return [];
  const [rooms, leads, created] = await Promise.all([roomEvents(prisma, customerIds, actor), leadEvents(prisma, customerIds, window), createdEvents(prisma, customerIds)]);
  return finalizeSource([...rooms, ...leads, ...created], window);
};
```

with

```ts
/**
 * "ร้านตอบครั้งแรก (หลังทัก …)" — อ่านแคช state.firstStaffReplyAt ตอนเปิดดู ไม่เขียนอะไร (หน้ารายการไม่คำนวณแคชใหม่ ⇒ อาจช้าตามรอบคำนวณแคช)
 * อยู่นอก roomEvents: SALES ที่มองไม่เห็นห้องยังได้แถวนี้ — เวลาเดียวกันอยู่ใน summary ที่ทุกบทบาทอ่านได้ และแถวไม่มีลิงก์จึงไม่เปิดเผยห้อง
 * customerIds[0] = ลูกค้าที่ยังมีชีวิต (แบบ JourneySummaryService) — placeholder อาจมีแคชค้างจาก race ของ recompute จน sweep วันอาทิตย์ จึงไม่ค้นด้วย in
 * จุดเริ่มนับ: ทักแชทก่อน (firstChannel ขึ้นต้น CHAT_) = contactedAt (เวลาแถว "ทักแชทครั้งแรก") · มาหน้าร้าน/แนะนำก่อน = ข้อความลูกค้าแรกของทุกห้องในครอบครัว
 * (ไม่จำกัดห้องตามสิทธิ์ · รวมห้อง/ข้อความที่ soft-delete แบบ journey-state.sql) — contactedAt ของคนที่มาร้านก่อนจะนับวันที่ยังไม่ได้ทักรวมไปด้วย
 * ไม่ออกแถวเมื่อยังไม่มีคำตอบ · หาจุดเริ่มไม่ได้ · คำตอบมาก่อนจุดเริ่ม
 */
async function firstStaffReplyEvents(prisma: PrismaService, customerIds: string[]): Promise<JourneyEvent[]> {
  const state = await prisma.customerJourneyState.findUnique({
    where: { customerId: customerIds[0] },
    select: { customerId: true, firstStaffReplyAt: true, contactedAt: true, firstChannel: true },
  });
  const repliedAt = state?.firstStaffReplyAt;
  if (!state || !repliedAt) return [];
  const anchor = state.firstChannel.startsWith(CHAT_SOURCE_PREFIX)
    ? state.contactedAt
    : (await prisma.chatMessage.aggregate({ where: { role: 'CUSTOMER', room: { is: { customerId: { in: customerIds } } } }, _min: { createdAt: true } }))._min.createdAt;
  if (!anchor || repliedAt < anchor) return [];
  return [{
    id: `staffreply-${state.customerId}`, type: 'FIRST_STAFF_REPLY', group: 'chat', stage: null, timestamp: repliedAt.toISOString(),
    title: `ร้านตอบครั้งแรก (หลังทัก ${formatReplyGap(repliedAt.getTime() - anchor.getTime())})`,
    // ระบบข้ามข้อความในนาทีแรกหลังข้อความทักทายอัตโนมัติ ⇒ ตอบเร็วมากอาจแสดงช้ากว่าจริง · ไม่เลื่อนขั้น
    actor: { type: 'STAFF' }, reliability: 'approximate', origin: 'SOURCE',
  }];
}

/** กลุ่ม chat · PDPA: ไม่อ่าน chat_messages.text/media_type · media_url อยู่ในเงื่อนไขไฟล์เอกสารเท่านั้น (ไม่ select) · todo.title/description · เบอร์/ที่อยู่ใน audit */
export const chatSource: JourneySource = async (prisma, customerIds, window, actor) => {
  if (!roleSeesGroup(actor.role, 'chat')) return [];
  const [rooms, leads, created, staffReply] = await Promise.all([
    roomEvents(prisma, customerIds, actor),
    leadEvents(prisma, customerIds, window),
    createdEvents(prisma, customerIds),
    firstStaffReplyEvents(prisma, customerIds),
  ]);
  return finalizeSource([...rooms, ...leads, ...created, ...staffReply], window);
};
```

- [ ] **Step 13: Run the four specs and watch them pass**

```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/chat.source.db.spec.ts src/modules/customer-journey/sources/role-visibility.spec.ts src/modules/customer-journey/customer-journey.pdpa.db.spec.ts src/modules/customer-journey/sources/reply-gap.spec.ts src/modules/customer-journey/chat-document-file.spec.ts --runInBand)
```

Expected: PASS — Test Suites: 5 passed; Tests: 30 passed (`chat.source.db.spec.ts` 7, `role-visibility.spec.ts` 3, `customer-journey.pdpa.db.spec.ts` 6, `reply-gap.spec.ts` 10, `chat-document-file.spec.ts` 4 — the last one proves `chat.source.ts` imports the condition instead of copying `'FILE'`).

Then mirror CI, which runs without a local TZ:

```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=UTC NODE_ENV=test npx jest src/modules/customer-journey/sources/chat.source.db.spec.ts src/modules/customer-journey/customer-journey.pdpa.db.spec.ts --runInBand)
```

Expected: PASS — 2 suites, 13 tests.

- [ ] **Step 14: Keep Task 1's mocked chat parity spec green (`customerJourneyState` in `chatDb`)**

`firstStaffReplyEvents` runs for every role that sees the chat group, so every mocked Prisma handed to `chatSource` now needs `customerJourneyState.findUnique`. The only other mocked caller is T1's `journey-shared-contract.spec.ts` (`customer-journey.service.spec.ts` mocks `chatSource` itself; `chat.source.db.spec.ts` / `customer-journey.pdpa.db.spec.ts` / `customer-journey.payments-cursor.db.spec.ts` use the real database; `role-visibility.spec.ts` already got the model in Step 8).

First confirm the red state:

```bash
(cd apps/api && npx jest src/modules/customer-journey/journey-shared-contract.spec.ts --runInBand)
```

Expected: FAIL — `Tests: 6 failed, 4 passed, 10 total`; each failure is `TypeError: Cannot read properties of undefined (reading 'findUnique')` from `firstStaffReplyEvents` in `sources/chat.source.ts` (the 5 `it.each` rows + the multi-room test; the 4 constant/type tests pass).

In `apps/api/src/modules/customer-journey/journey-shared-contract.spec.ts`, replace (the only occurrence — inside `function chatDb`)

```ts
      customer: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }
```

with

```ts
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      // เฟส 3: chatSource อ่านแคช state เพื่อทำแถว "ร้านตอบครั้งแรก" ทุกครั้ง — ไม่มีแคช ⇒ ไม่มีแถวนั้น ถ้อยคำแถวเปิดห้องต้องเท่าเดิม
      customerJourneyState: { findUnique: jest.fn().mockResolvedValue(null) },
    };
  }
```

Run it again:

```bash
(cd apps/api && npx jest src/modules/customer-journey/journey-shared-contract.spec.ts --runInBand)
```

Expected: PASS — `Tests: 10 passed, 10 total` (the `toEqual` on the single `CHAT_ROOM_OPENED` row still holds: a `null` state yields no `FIRST_STAFF_REPLY` row).

- [ ] **Step 15: Update the spec event table**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md`:

(a) Replace

```
| FIRST_STAFF_REPLY | ร้านตอบครั้งแรก (หลังทัก {x} นาที) |
```

with

```
| CHAT_CUSTOMER_FILE | ลูกค้าส่งไฟล์ในแชท · วันนั้นส่งมากกว่า 1 ไฟล์ต่อท้าย " {n} ไฟล์" | แชท/ติดต่อ | chat_messages ไฟล์เอกสารของลูกค้า (role=CUSTOMER type=FILE media_url ลงท้าย .pdf / .doc(x) / .xls(x) — เงื่อนไข CUSTOMER_DOCUMENT_FILE_SQL ชุดเดียวกับแคชขั้น · คำตัดสินผู้ควบคุม R-P1) ในก้อนเดียวกับ CHAT_DAY (GROUP BY room_id, วันเวลาไทย · นับรวมแถวที่ retention soft-delete) · media_url อยู่ในเงื่อนไขเท่านั้น ไม่เลือกออกมา · ไม่อ่าน text/media_type · หนึ่งแถวต่อห้องต่อวัน เวลา = ไฟล์เอกสารล่าสุดของวัน · ลิงก์ /inbox/:roomId สิทธิ์ห้องเดียวกับแถวแชทอื่น (SALES เห็นเฉพาะห้องที่ยังไม่มีผู้ดูแลหรือตัวเองดูแล) · CHAT_DAY ยังนับข้อความลูกค้าทุกชนิดรวมไฟล์ | ตรวจเครดิต (คำบรรยายขั้น "ส่งไฟล์ในแชท") | ลูกค้า | exact · รูปภาพ · ไฟล์ของร้าน · ไม่มีลิงก์ · ลิงก์แชร์ (webhook Facebook เก็บไฟล์แนบชนิดที่ไม่รู้จักเป็น FILE) ไม่นับ |
| FIRST_STAFF_REPLY | ร้านตอบครั้งแรก (หลังทัก {N นาที\|N ชม.\|N วัน}) |
```

(b) Replace

```
| — (จุดสัมผัส ไม่เลื่อนขั้น) | ร้าน | approximate |
```

with

```
| — (จุดสัมผัส ไม่เลื่อนขั้น) | ร้าน | approximate · แถวไทม์ไลน์คำนวณตอนอ่านจากแคช (chat.source ไม่เขียนอะไร · หน้ารายการไม่คำนวณแคชใหม่ ⇒ อาจช้าตามรอบคำนวณแคช) · ไม่มีลิงก์ · ซ่อนตามกลุ่ม chat เท่านั้น ไม่จำกัดห้องตามสิทธิ์ (เวลาเดียวกันอยู่ใน summary อยู่แล้ว) · หลังทัก = เวลาตอบ − จุดเริ่ม: firstChannel ขึ้นต้น CHAT_ ⇒ contactedAt · อื่น ๆ (หน้าร้าน/แนะนำก่อน) ⇒ ข้อความ CUSTOMER แรกของทุกห้องในครอบครัว · ปัดลง ต่ำสุด 1 นาที · ต่ำกว่า 60 นาที "N นาที" · ต่ำกว่า 24 ชม. "N ชม." · ตั้งแต่ 24 ชม. "N วัน" · เลขกับหน่วยคั่นด้วยเว้นวรรคไม่ตัดบรรทัด (U+00A0) · ไม่ออกแถวเมื่อยังไม่มีคำตอบ หาจุดเริ่มไม่ได้ หรือเวลาตอบก่อนจุดเริ่ม |
```

Verify both edits landed exactly once (from the worktree root):

```bash
grep -c "| CHAT_CUSTOMER_FILE |" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "หลังทัก {N นาที" docs/superpowers/specs/2026-09-15-customer-journey-design.md
```

Expected: `1` and `1`.

- [ ] **Step 16: Typecheck, lint the touched files, run the module's neighbours**

Run from the worktree root:

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

```bash
(cd apps/api && npx eslint src/modules/customer-journey/sources/chat.source.ts src/modules/customer-journey/sources/reply-gap.ts src/modules/customer-journey/sources/reply-gap.spec.ts src/modules/customer-journey/sources/chat.source.db.spec.ts src/modules/customer-journey/sources/role-visibility.spec.ts src/modules/customer-journey/customer-journey.pdpa.db.spec.ts src/modules/customer-journey/journey-shared-contract.spec.ts)
```

Expected: no errors (🚨 never `npm run lint` in apps/api — the script runs `--fix`).

```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey --runInBand)
```

Expected: every suite under `customer-journey/` PASS (`customer-journey.service.spec.ts` mocks `chatSource`; `customer-journey.payments-cursor.db.spec.ts` runs the real source and must stay green).

- [ ] **Step 17: Commit**

Run both blocks from the worktree root:

```bash
git add apps/api/src/modules/customer-journey/sources/reply-gap.ts apps/api/src/modules/customer-journey/sources/reply-gap.spec.ts apps/api/src/modules/customer-journey/sources/chat.source.ts apps/api/src/modules/customer-journey/sources/chat.source.db.spec.ts apps/api/src/modules/customer-journey/sources/role-visibility.spec.ts apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts apps/api/src/modules/customer-journey/journey-shared-contract.spec.ts docs/superpowers/specs/2026-09-15-customer-journey-design.md
```

```bash
git commit -m "feat(customer-journey): แถวไทม์ไลน์ \"ลูกค้าส่งไฟล์ในแชท\" (วันละแถวต่อห้อง) + \"ร้านตอบครั้งแรก (หลังทัก …)\" คำนวณตอนอ่าน

- chatDays นับไฟล์เอกสารของลูกค้าด้วย CUSTOMER_DOCUMENT_FILE_FRAGMENT (เงื่อนไขเดียวกับแคชขั้น) ในก้อนเดียวกับ CHAT_DAY · media_url อยู่ใน FILTER เท่านั้น ไม่อ่าน text/media_type · รูปภาพ/ไฟล์ของร้าน/ลิงก์แชร์ไม่นับ · สิทธิ์ห้องเดียวกับแถวแชทอื่น
- FIRST_STAFF_REPLY จากแคช state.firstStaffReplyAt · จุดเริ่ม = contactedAt (ทักแชทก่อน) หรือข้อความลูกค้าแรกของทุกห้องในครอบครัว (มาหน้าร้านก่อน) · ซ่อนตามกลุ่ม chat เท่านั้น ไม่มีลิงก์ · ไม่ออกแถวเมื่อไม่มีคำตอบ/จุดเริ่ม หรือคำตอบก่อนจุดเริ่ม
- formatReplyGap: ปัดลง ต่ำสุด 1 นาที · นาที/ชม./วัน · เลขติดหน่วยด้วย U+00A0
- PDPA snapshot ห้ามคีย์ mediaUrl/mediaType · สเปครายการเหตุการณ์เพิ่ม CHAT_CUSTOMER_FILE + รูปแบบระยะห่างของ FIRST_STAFF_REPLY

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected: `git show --stat HEAD` lists exactly the 8 paths above. No `git push`.

---

### Task 6: Read-time rows that explain lost clearing: กลับมาติดต่ออีกครั้ง + one row per clearing document

When the lost badge clears by itself, the timeline must say why (canvas TimelineRows g4: "ป้ายที่ล้างเพราะมีเอกสารใหม่ (ใบจอง · สมัครผ่อนออนไลน์ · จองสินค้า · เทิร์นเครื่อง · ออมเครื่อง · สั่งซื้อออนไลน์) ไม่ออกแถวนี้ — แถวเอกสารอธิบายแทน"). So every clearing cause needs its own row:

- **Customer wrote again in chat** → new read-time row `กลับมาติดต่ออีกครั้ง`.
- **Customer opened a booking** → shipped row `เปิดใบจอง …` (unchanged).
- **Customer opened a saving plan** → new sale row `สมัครออมเครื่อง`.
- **Customer placed an online order** → new sale row `สั่งซื้อออนไลน์`.
- **Customer held a phone on the web** → new sale row `กดจองเครื่องบนเว็บ`.
- **Customer submitted an online installment application** → new sale row `ยื่นใบสมัครผ่อนออนไลน์`.
- **Customer brought a phone to trade in / sell** → new sale row `ส่งเครื่องเทิร์น/ขายคืน`.

The last three titles are the ones the design spec's event table already lists for `WEB_HOLD / ONLINE_APPLICATION` and `TRADE_IN`; until this task no source emitted them (they sat in "ระบบยังไม่เก็บ"), so this task also removes their three "ระบบยังไม่เก็บ" lines.

Nothing is written to the database. There is no migration and no web change: the web renders rows by `group` (`JourneyEvent.type` is a plain `string`), so sale rows get the bag icon and chat rows the chat icon.

**Rules this task pins** (brief §0 rulings 5, 6, 12 · outline D5, D6 · canvas TimelineRows g2/g3/g4 · StageStrip c2/c3)

1. **Which lost mark counts.** Take the newest non-deleted `customer_journey_entries` row of kind `MARKED_LOST | REOPENED` across the family, ordered `occurredAt desc, id desc`. This is the same rule as the CTE `lost_mark` in `sql/journey-state.sql`. The row exists only when that newest mark is `MARKED_LOST`. The lookup is not windowed, because the mark can sit on an older page than the message.
2. **Where the row sits.** At the first `role = 'CUSTOMER'` chat message with `createdAt > mark` (strictly after) in a room the viewer can see.
   - SALES get the room assignment rule.
   - Messages that retention soft-deleted still count, the same as `last_customer_at` in the SQL.
   - Select only `roomId` and `createdAt`.
3. **Documents suppress the row.** No row when any of the six lost-clearing documents has a time in `(mark, message]`:
   - `bookings.created_at`
   - `online_installment_applications.created_at`
   - `product_reservations.reserved_at`
   - `trade_ins.created_at`
   - `saving_plans.created_at`
   - `online_orders.created_at`

   Any status counts. Rows must not be deleted, where the table has `deleted_at` (`product_reservations` has none). This is the same set and predicate as Task 3 `doc_last_at`.
4. **Things that do not suppress the row.** Touchpoints do not suppress it: the touchpoint row explains itself, but a later customer message is still a comeback. Only the latest lost episode gets a row.
5. **Document rows (five new, bookings already shipped).** Every one of the six clearing documents has a sale row at exactly the time `doc_last_at` uses, so a badge cleared by a document is always explained on the timeline.
   - Group `sale`, stage `INTERESTED` (label `นัด / จอง` since Task 2), no link, no `metadata`, `reliability: 'exact'`.
   - Select only `id` and the time column (`createdAt`, or `reservedAt` for product reservations). Never select PII or free text: saving plan `targetProductModel`; online order `shippingAddress`, `bankSlipUrl`, `paymentRef`, `promoCode`; online application `fullName`, `phone`, `nationalId`; trade-in `seller*`, `imei`, `serialNumber`, `idCard*`, `customerNotes`, `photoUrls`, prices; product reservation `sessionId`.
   - Same predicate as Task 3: `customerId ∈ family`, any status, `deletedAt: null` where the table has it (`product_reservations` has none).
   - Actor: `CUSTOMER` for saving plan, web hold, online application and trade-in (the customer is the one who brought or submitted it — no staff column is read, so a walk-in trade-in keyed by staff still shows "ลูกค้า"); `SYSTEM` named `ออนไลน์` for the online order (same as online sales).

**Files:**
- Modify: `apps/api/src/modules/customer-journey/sources/chat.source.ts`. Line numbers are as of the base `origin/main` `10d6e6d3a`, before Tasks 1 and 5. Anchor every edit by its text.
  - Insert `LOST_MARK_KINDS`, `clearingDocumentBetween` and `recontactEvent` directly above `async function roomEvents(` (:27).
  - `const [days, todos] = await Promise.all([` (:32-33) gains `recontactEvent(...)`.
  - `return events;` of `roomEvents` (:72) pushes the row first.
- Modify: `apps/api/src/modules/customer-journey/sources/sale.source.ts`.
  - Docblock + `Promise.all` (:7-14).
  - Insert five loops above `for (const s of sales) {` (:34).
- Modify: `apps/api/src/modules/customer-journey/customer-journey.service.ts` — delete the three document lines of `JOURNEY_NOT_RECORDED` and the `//` comment directly above them (as Task 3 left them).
- Test (modify): `apps/api/src/modules/customer-journey/customer-journey.service.spec.ts` — replace Task 3's `it('ระบบยังไม่เก็บ: จองเว็บ / สมัครผ่อนออนไลน์ / รับซื้อ-เทิร์น …')` and Task 2's trailing `describe('JOURNEY_NOT_RECORDED — ชื่อขั้น 4 ใหม่ …')` (both assert the three lines exist).
- Create: `apps/api/src/modules/customer-journey/sources/chat.recontact.db.spec.ts`.
- Test (modify): `apps/api/src/modules/customer-journey/sources/credit-sale.source.spec.ts`.
  - `saleDb()` (:56-78) gains `savingPlan`, `onlineOrder`, `productReservation`, `onlineInstallmentApplication` and `tradeIn` mocks.
  - Insert a new test above `it('ไม่มีสัญญา →` (:104).
- Test (modify): `apps/api/src/modules/customer-journey/sources/role-visibility.spec.ts`.
  - Insert a new test directly above the final `});` of the `describe` block — after Task 5's test `'แถวไฟล์ในแชท · ร้านตอบครั้งแรก ตามกลุ่ม chat ของตาราง …'`, which is the last `it` in the file once Task 5 has landed.
  - Task 5's `chat` mock in that test gains `customerJourneyEntry.findFirst` (resolves `null`).
- Test (modify): `apps/api/src/modules/customer-journey/journey-shared-contract.spec.ts` (created by T1, extended by T5) — its `chatDb()` mock gains `customerJourneyEntry.findFirst` (resolves `null`). `recontactEvent` runs whenever a visible room exists, and both mocks have a room, so without it those tests throw `TypeError: Cannot read properties of undefined (reading 'findFirst')`.
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md`.
  - "หลุด:" bullets (:241-244) + one inserted bullet before `เงียบ:` (:246).
  - Event table row `| MARKED_LOST / REOPENED |` (:271).
  - Rows `| WEB_HOLD / ONLINE_APPLICATION |` (:278) and `| TRADE_IN |` (:279) rewritten to what is emitted; two rows after `| TRADE_IN |`.

**Interfaces:**
- Consumes:
  - **Task 3:**
    - `sql/journey-state.sql` clears `lost_at` when `doc_last_at > lost_mark_at`, where `doc_last_at` = MAX over the six documents above (same predicates).
    - `sql/journey-activity-probe.sql` and `sql/journey-active-since.sql` see `saving_plans` / `online_orders`.
    - `JourneyStateService.recompute(customerIds: string[]): Promise<void>` (unchanged signature).
    - `JOURNEY_NOT_RECORDED` contains the comment `// ขั้น "นัด / จอง" บนแถบนับจากสามอย่างนี้ด้วย และรายการใหม่หลังติดป้ายหลุดล้างป้ายได้ …` and the three `… (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)` lines; `customer-journey.service.spec.ts` asserts them in Task 3's `it` and Task 2's `describe`.
  - **Task 5:** `chat.source.ts` structure.
    - `roomEvents(prisma, customerIds, actor)` still loads the visible rooms with `roomAssignmentScope(actor)`, returns `[]` when there are none, and runs `Promise.all([chatDays(prisma, roomIds), prisma.todo.findMany(...)])`.
    - The top-level `chatSource` still gates on `roleSeesGroup(actor.role, 'chat')` before any query.
    - Task 5 rows (`CHAT_CUSTOMER_FILE`, `FIRST_STAFF_REPLY`) are untouched here.
    - Mocked callers of `chatSource` after Task 5: `role-visibility.spec.ts` (Task 5's `chat` object, last `it`) and `journey-shared-contract.spec.ts` (`chatDb()`), both already carrying `customerJourneyState.findUnique`.
  - **Shipped:**
    - `JourneyEvent` / `JourneySource` (`@installment/shared`, `sources/journey-window.ts`)
    - Prisma models `customerJourneyEntry` (`kind`, `occurredAt`, `deletedAt`), `chatMessage` (`roomId`, `role`, `createdAt`), `booking`, `onlineInstallmentApplication`, `productReservation` (`reservedAt`, no `deletedAt`), `tradeIn`, `savingPlan`, `onlineOrder` · `product_reservations` also has the SQL-only partial unique index `product_reservations_active_product_idx` ON `product_reservations(product_id) WHERE status = 'ACTIVE'` (migration `20260986000000_online_order_unfulfillable`; `schema.prisma` only warns never to drop it) — one product can hold at most one ACTIVE reservation, so specs that seed several reservations on one product seed them non-ACTIVE
    - `JOURNEY_HIDDEN_GROUPS = { ACCOUNTANT: ['chat'] }`
- Produces (all module-private, no new exports):
  - `const LOST_MARK_KINDS: string[] = ['MARKED_LOST', 'REOPENED']`
  - `async function clearingDocumentBetween(prisma: PrismaService, customerIds: string[], after: Date, upTo: Date): Promise<boolean>` — true when any of the six documents has a time `> after` and `<= upTo`.
  - `async function recontactEvent(prisma: PrismaService, customerIds: string[], roomIds: string[]): Promise<JourneyEvent | null>`, which returns:
    `{ id: 'recontact-<markEntryId>', type: 'RECONTACTED', group: 'chat', stage: null, timestamp: <first message ISO>, title: 'กลับมาติดต่ออีกครั้ง', actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE', href: '/inbox/<roomId>' }`
  - `saleSource` rows (no `href`, no `metadata`; all `{ group: 'sale', origin: 'SOURCE', stage: 'INTERESTED', reliability: 'exact' }`):
    - `{ id: 'savingplan-<id>', type: 'SAVING_PLAN_OPENED', timestamp: <createdAt ISO>, title: 'สมัครออมเครื่อง', actor: { type: 'CUSTOMER' } }`
    - `{ id: 'onlineorder-<id>', type: 'ONLINE_ORDER_PLACED', timestamp: <createdAt ISO>, title: 'สั่งซื้อออนไลน์', actor: { type: 'SYSTEM', name: 'ออนไลน์' } }`
    - `{ id: 'webhold-<id>', type: 'WEB_HOLD', timestamp: <reservedAt ISO>, title: 'กดจองเครื่องบนเว็บ', actor: { type: 'CUSTOMER' } }`
    - `{ id: 'onlineapp-<id>', type: 'ONLINE_APPLICATION', timestamp: <createdAt ISO>, title: 'ยื่นใบสมัครผ่อนออนไลน์', actor: { type: 'CUSTOMER' } }`
    - `{ id: 'tradein-<id>', type: 'TRADE_IN', timestamp: <createdAt ISO>, title: 'ส่งเครื่องเทิร์น/ขายคืน', actor: { type: 'CUSTOMER' } }`
  - `JOURNEY_NOT_RECORDED` no longer mentions web holds, online installment applications or trade-ins (their comment line goes too).
  - Spec event table: row `MARKED_LOST / REOPENED / RECONTACTED` (comeback rule + document suppression), rows `WEB_HOLD / ONLINE_APPLICATION` and `TRADE_IN` rewritten to the emitted rows, new rows `SAVING_PLAN_OPENED` and `ONLINE_ORDER_PLACED`.

Commands below run from `apps/api` unless stated otherwise. `$TEST_DB` means:
`DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public"`

- [ ] **Step 1: Check that Tasks 3 and 5 have landed**

Run:
```bash
grep -n "doc_last_at" src/modules/customer-journey/sql/journey-state.sql
grep -c "saving_plans\|online_orders" src/modules/customer-journey/sql/journey-state.sql src/modules/customer-journey/sql/journey-activity-probe.sql src/modules/customer-journey/sql/journey-active-since.sql
grep -n "lastFileAt\|FIRST_STAFF_REPLY" src/modules/customer-journey/sources/chat.source.ts
grep -n "const \[days, todos\] = await Promise.all(\[" src/modules/customer-journey/sources/chat.source.ts
grep -c "และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์" src/modules/customer-journey/customer-journey.service.ts src/modules/customer-journey/customer-journey.service.spec.ts
grep -n "customerJourneyState: {\|customerJourneyState: { findUnique" src/modules/customer-journey/sources/role-visibility.spec.ts src/modules/customer-journey/journey-shared-contract.spec.ts
(cd ../.. && npm run build --workspace=@installment/shared)
```
Expected:
- `doc_last_at` appears at least twice (CTE + `lost_at` clause).
- Every one of the three SQL files reports a count ≥ 2.
- `chat.source.ts` shows both `lastFileAt` and `FIRST_STAFF_REPLY`.
- The `Promise.all` anchor line is found once.
- `customer-journey.service.ts:3` and `customer-journey.service.spec.ts:4` (Task 3's wording: the three array strings; in the spec the same three strings plus the `it` title, which ends with the same phrase).
- One `customerJourneyState` line in each of `role-visibility.spec.ts` and `journey-shared-contract.spec.ts` (Task 5's mocks).
- The shared build exits 0.

If any grep finds nothing, stop: Task 3 or Task 5 has not landed.

- [ ] **Step 2: Red — mocked sale source: one row per clearing document**

In `apps/api/src/modules/customer-journey/sources/credit-sale.source.spec.ts`, replace the last model of `saleDb()` with the same line plus five new mocks.

Replace:
```ts
    payment: { findMany: jest.fn().mockResolvedValue([{ contractId: 'k2', paidDate: at('2026-08-31T04:00:00.000Z') }]) },
  };
}
```
with:
```ts
    payment: { findMany: jest.fn().mockResolvedValue([{ contractId: 'k2', paidDate: at('2026-08-31T04:00:00.000Z') }]) },
    savingPlan: { findMany: jest.fn().mockResolvedValue([{ id: 'sp1', createdAt: at('2026-09-06T03:00:00.000Z') }]) },
    onlineOrder: { findMany: jest.fn().mockResolvedValue([{ id: 'oo1', createdAt: at('2026-09-07T03:00:00.000Z') }]) },
    productReservation: { findMany: jest.fn().mockResolvedValue([{ id: 'pr1', reservedAt: at('2026-09-08T03:00:00.000Z') }]) },
    onlineInstallmentApplication: { findMany: jest.fn().mockResolvedValue([{ id: 'oa1', createdAt: at('2026-09-09T03:00:00.000Z') }]) },
    tradeIn: { findMany: jest.fn().mockResolvedValue([{ id: 'ti1', createdAt: at('2026-09-10T03:00:00.000Z') }]) },
  };
}
```

Then insert this test directly above `  it('ไม่มีสัญญา → ไม่ยิงลายเซ็น/entry/งวด · คืนไม่เกิน limit+1', async () => {`:
```ts
  it('เอกสารที่ล้างป้ายหลุดมีแถวของตัวเองครบ (ออมเครื่อง · สั่งซื้อออนไลน์ · จองเครื่องบนเว็บ · สมัครผ่อนออนไลน์ · เทิร์นเครื่อง) = หลักฐานขั้นนัด / จอง · ไม่มีลิงก์ · คัดแค่ id + เวลา', async () => {
    const db = saleDb();
    const events = await saleSource(db as unknown as PrismaService, ['c1', 'p1'], { limit: 50 }, OWNER);
    const row = (id: string, type: string, timestamp: string, title: string, actor: Record<string, string> = { type: 'CUSTOMER' }) =>
      ({ id, type, group: 'sale', stage: 'INTERESTED', timestamp, title, actor, reliability: 'exact', origin: 'SOURCE' });
    expect(byId(events, 'savingplan-sp1')).toEqual(row('savingplan-sp1', 'SAVING_PLAN_OPENED', '2026-09-06T03:00:00.000Z', 'สมัครออมเครื่อง'));
    expect(byId(events, 'onlineorder-oo1')).toEqual(row('onlineorder-oo1', 'ONLINE_ORDER_PLACED', '2026-09-07T03:00:00.000Z', 'สั่งซื้อออนไลน์', { type: 'SYSTEM', name: 'ออนไลน์' }));
    expect(byId(events, 'webhold-pr1')).toEqual(row('webhold-pr1', 'WEB_HOLD', '2026-09-08T03:00:00.000Z', 'กดจองเครื่องบนเว็บ'));
    expect(byId(events, 'onlineapp-oa1')).toEqual(row('onlineapp-oa1', 'ONLINE_APPLICATION', '2026-09-09T03:00:00.000Z', 'ยื่นใบสมัครผ่อนออนไลน์'));
    expect(byId(events, 'tradein-ti1')).toEqual(row('tradein-ti1', 'TRADE_IN', '2026-09-10T03:00:00.000Z', 'ส่งเครื่องเทิร์น/ขายคืน'));
    const family = { customerId: { in: ['c1', 'p1'] } };
    expect(db.savingPlan.findMany).toHaveBeenCalledWith({ where: { ...family, deletedAt: null }, select: { id: true, createdAt: true } });
    expect(db.onlineOrder.findMany).toHaveBeenCalledWith({ where: { ...family, deletedAt: null }, select: { id: true, createdAt: true } });
    // product_reservations ไม่มี deleted_at — เงื่อนไขเดียวกับ doc_last_at ใน journey-state.sql
    expect(db.productReservation.findMany).toHaveBeenCalledWith({ where: family, select: { id: true, reservedAt: true } });
    expect(db.onlineInstallmentApplication.findMany).toHaveBeenCalledWith({ where: { ...family, deletedAt: null }, select: { id: true, createdAt: true } });
    expect(db.tradeIn.findMany).toHaveBeenCalledWith({ where: { ...family, deletedAt: null }, select: { id: true, createdAt: true } });
    // PDPA: ไม่คัดที่อยู่ สลิป เลขอ้างอิงชำระ โค้ดส่วนลด รุ่นเป้าหมาย ชื่อ/เบอร์/เลขบัตรในใบสมัคร ข้อมูลผู้ขาย/IMEI/รูปของเทิร์น session ของการจอง
    const calls = [db.savingPlan, db.onlineOrder, db.productReservation, db.onlineInstallmentApplication, db.tradeIn].map((model) => model.findMany.mock.calls);
    expect(JSON.stringify(calls)).not.toMatch(/shippingAddress|bankSlipUrl|paymentRef|promoCode|targetProductModel|fullName|phone|nationalId|seller|imei|serialNumber|idCard|customerNotes|photoUrls|sessionId|Price|status/);
  });

```

- [ ] **Step 3: Run it and watch it fail**

Run:
```bash
NODE_ENV=test npx jest src/modules/customer-journey/sources/credit-sale.source.spec.ts --runInBand
```
Expected: FAIL.
- Only the new test fails. `expect(byId(events, 'savingplan-sp1')).toEqual(...)` reports `Received: undefined`, because `saleSource` does not query any of the five documents yet.
- The other tests stay green: `Tests: 1 failed, 4 passed, 5 total`. This count assumes no earlier task added tests to this file.

- [ ] **Step 4: Green — sale source reads the five clearing documents it did not show yet**

In `apps/api/src/modules/customer-journey/sources/sale.source.ts`, replace lines 7-14 (the docblock through the first `Promise.all`):
```ts
/** กลุ่ม sale · เอกสารต่อคนหลักหน่วย ดึงหมดแล้วตัดใน finalizeSource · ไม่คัด notes/voidReason/reviewNotes · ไม่ select ลายเซ็น */
export const saleSource: JourneySource = async (prisma, customerIds, window) => {
  const who = { select: { id: true, name: true } };
  const [bookings, sales, contracts] = await Promise.all([
    prisma.booking.findMany({ where: { customerId: { in: customerIds }, deletedAt: null }, select: { id: true, bookingNumber: true, status: true, depositAmount: true, depositPaidAt: true, canceledAt: true, convertedAt: true, expireDate: true, createdAt: true, createdBy: who, canceledBy: who } }),
    prisma.sale.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, saleNumber: true, saleType: true, netAmount: true, financeCompany: true, contractId: true, saleSource: true, createdAt: true, deletedAt: true, salesperson: who, voidedBy: who, product: { select: { brand: true, model: true, storage: true } } } }),
    prisma.contract.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, contractNumber: true, status: true, totalMonths: true, monthlyPayment: true, createdAt: true, deletedAt: true, reviewedAt: true, workflowStatus: true, salesperson: who, reviewedBy: who } }),
  ]);
```
with:
```ts
/**
 * กลุ่ม sale · เอกสารต่อคนหลักหน่วย ดึงหมดแล้วตัดใน finalizeSource · ไม่คัด notes/voidReason/reviewNotes · ไม่ select ลายเซ็น
 * เอกสาร 6 ชนิดที่ล้างป้ายหลุด (ใบจอง + 5 ชนิดด้านล่าง) ต้องมีแถวของตัวเองครบ — ไม่มีแถว "กลับมาติดต่ออีกครั้ง" เมื่อเอกสารล้างป้าย แถวเอกสารจึงเป็นคำอธิบาย (canvas TimelineRows g4)
 * แผนออม · คำสั่งซื้อออนไลน์ · จองเครื่องบนเว็บ · ใบสมัครผ่อนออนไลน์ · เทิร์นเครื่อง: คัดแค่ id + เวลา — ไม่คัด targetProductModel · shippingAddress · bankSlipUrl · paymentRef · promoCode ·
 *   fullName · phone · nationalId ของใบสมัคร · ข้อมูลผู้ขาย (sellerName ฯลฯ) · imei · serialNumber · รูปบัตร · customerNotes · photoUrls · ราคาของเทิร์น · sessionId ของการจอง
 * ทุกสถานะที่ไม่ถูกลบ (product_reservations ไม่มี deleted_at) = ชุดเดียวกับหลักฐานขั้น "นัด / จอง" และ doc_last_at (ล้างป้ายหลุด) ใน sql/journey-state.sql · ไม่มีลิงก์
 */
export const saleSource: JourneySource = async (prisma, customerIds, window) => {
  const who = { select: { id: true, name: true } };
  const family = { customerId: { in: customerIds } };
  const [bookings, sales, contracts, savingPlans, onlineOrders, webHolds, onlineApplications, tradeIns] = await Promise.all([
    prisma.booking.findMany({ where: { customerId: { in: customerIds }, deletedAt: null }, select: { id: true, bookingNumber: true, status: true, depositAmount: true, depositPaidAt: true, canceledAt: true, convertedAt: true, expireDate: true, createdAt: true, createdBy: who, canceledBy: who } }),
    prisma.sale.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, saleNumber: true, saleType: true, netAmount: true, financeCompany: true, contractId: true, saleSource: true, createdAt: true, deletedAt: true, salesperson: who, voidedBy: who, product: { select: { brand: true, model: true, storage: true } } } }),
    prisma.contract.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, contractNumber: true, status: true, totalMonths: true, monthlyPayment: true, createdAt: true, deletedAt: true, reviewedAt: true, workflowStatus: true, salesperson: who, reviewedBy: who } }),
    prisma.savingPlan.findMany({ where: { ...family, deletedAt: null }, select: { id: true, createdAt: true } }),
    prisma.onlineOrder.findMany({ where: { ...family, deletedAt: null }, select: { id: true, createdAt: true } }),
    prisma.productReservation.findMany({ where: family, select: { id: true, reservedAt: true } }),
    prisma.onlineInstallmentApplication.findMany({ where: { ...family, deletedAt: null }, select: { id: true, createdAt: true } }),
    prisma.tradeIn.findMany({ where: { ...family, deletedAt: null }, select: { id: true, createdAt: true } }),
  ]);
```

Then insert these five lines directly above `  for (const s of sales) {`:
```ts
  for (const p of savingPlans) events.push({ ...base, id: `savingplan-${p.id}`, type: 'SAVING_PLAN_OPENED', stage: 'INTERESTED', timestamp: p.createdAt.toISOString(), title: 'สมัครออมเครื่อง', actor: { type: 'CUSTOMER' }, reliability: 'exact' });
  for (const o of onlineOrders) events.push({ ...base, id: `onlineorder-${o.id}`, type: 'ONLINE_ORDER_PLACED', stage: 'INTERESTED', timestamp: o.createdAt.toISOString(), title: 'สั่งซื้อออนไลน์', actor: { type: 'SYSTEM', name: 'ออนไลน์' }, reliability: 'exact' });
  for (const h of webHolds) events.push({ ...base, id: `webhold-${h.id}`, type: 'WEB_HOLD', stage: 'INTERESTED', timestamp: h.reservedAt.toISOString(), title: 'กดจองเครื่องบนเว็บ', actor: { type: 'CUSTOMER' }, reliability: 'exact' });
  for (const a of onlineApplications) events.push({ ...base, id: `onlineapp-${a.id}`, type: 'ONLINE_APPLICATION', stage: 'INTERESTED', timestamp: a.createdAt.toISOString(), title: 'ยื่นใบสมัครผ่อนออนไลน์', actor: { type: 'CUSTOMER' }, reliability: 'exact' });
  // เทิร์นหน้าร้านพนักงานเป็นคนคีย์ แต่ไม่คัดคอลัมน์พนักงาน ⇒ แสดงผู้ทำเป็นลูกค้า (คนที่นำเครื่องมา)
  for (const t of tradeIns) events.push({ ...base, id: `tradein-${t.id}`, type: 'TRADE_IN', stage: 'INTERESTED', timestamp: t.createdAt.toISOString(), title: 'ส่งเครื่องเทิร์น/ขายคืน', actor: { type: 'CUSTOMER' }, reliability: 'exact' });
```

- [ ] **Step 5: Run it and watch it pass**

Run:
```bash
NODE_ENV=test npx jest src/modules/customer-journey/sources/credit-sale.source.spec.ts --runInBand
```
Expected: PASS, `Tests: 5 passed, 5 total`. The existing `toHaveLength(3)` test still passes, because `finalizeSource` slices to `limit + 1`.

- [ ] **Step 6: "ระบบยังไม่เก็บ" — web holds, online applications and trade-ins are timeline rows now**

These three documents now have rows (Step 4), so the three "ยังไม่แสดงเป็นเหตุการณ์" lines that Tasks 2 and 3 kept in `JOURNEY_NOT_RECORDED` have become false. Remove them together with the tests that pin them.

(a) Red. In `apps/api/src/modules/customer-journey/customer-journey.service.spec.ts`, replace Task 3's test (inside `describe('CustomerJourneyService.list + summary (Task 9)', …)`):
```ts
  it('ระบบยังไม่เก็บ: จองเว็บ / สมัครผ่อนออนไลน์ / รับซื้อ-เทิร์น นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์', () => {
    expect(JOURNEY_NOT_RECORDED).toEqual(
      expect.arrayContaining([
        'การจองสินค้าผ่านเว็บ (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
        'ใบสมัครผ่อนออนไลน์ (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
        'รายการรับซื้อ/เทิร์นเครื่อง (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
      ]),
    );
    expect(JOURNEY_NOT_RECORDED.some((line) => line.includes('สนใจจริง'))).toBe(false);
  });
```
with:
```ts
  it('ระบบยังไม่เก็บ: จองเว็บ / สมัครผ่อนออนไลน์ / รับซื้อ-เทิร์น ขึ้นเป็นแถวในแท็บแล้ว ⇒ ไม่อยู่ในรายการ · ไม่มีชื่อขั้นเก่า "สนใจจริง"', () => {
    expect(JOURNEY_NOT_RECORDED.filter((line) => /การจองสินค้าผ่านเว็บ|ใบสมัครผ่อนออนไลน์|รับซื้อ\/เทิร์นเครื่อง|ยังไม่แสดงเป็นเหตุการณ์/.test(line))).toEqual([]);
    expect(JOURNEY_NOT_RECORDED.some((line) => line.includes('สนใจจริง'))).toBe(false);
  });
```
Then delete Task 2's trailing describe at the end of the same file — this exact text, including the blank line above it (its `toHaveLength(3)` pins the lines being removed; its "สนใจจริง" check lives on in the test above):
```ts

describe('JOURNEY_NOT_RECORDED — ชื่อขั้น 4 ใหม่ (เจ้าของสั่ง 2026-09-15)', () => {
  it('ไม่มีคำว่า "สนใจจริง" แล้ว · เอกสาร 3 ชนิดที่ใช้นับขั้นแต่ยังไม่แสดงเป็นเหตุการณ์อ้างชื่อขั้น "นัด / จอง"', () => {
    expect(JOURNEY_NOT_RECORDED.filter((line) => line.includes('สนใจจริง'))).toEqual([]);
    expect(JOURNEY_NOT_RECORDED.filter((line) => line.includes('ขั้น "นัด / จอง"'))).toHaveLength(3);
  });
});
```
The `JOURNEY_NOT_RECORDED` import stays (the rewritten test still uses it).

Run:
```bash
NODE_ENV=test npx jest src/modules/customer-journey/customer-journey.service.spec.ts --runInBand
```
Expected: FAIL — `Tests: 1 failed` (the rewritten test: `expect(received).toEqual(expected)` with the three `… แต่ยังไม่แสดงเป็นเหตุการณ์)` strings as received); every other test in the file passes.

(b) Green. In `apps/api/src/modules/customer-journey/customer-journey.service.ts`, inside `JOURNEY_NOT_RECORDED`, delete these four lines (the comment and the three strings exactly as Task 3 left them) and leave every other line untouched:
```ts
  // ขั้น "นัด / จอง" บนแถบนับจากสามอย่างนี้ด้วย และรายการใหม่หลังติดป้ายหลุดล้างป้ายได้ (journey-state.sql interest_agg.doc_last_at) แต่ยังไม่ขึ้นเป็นเหตุการณ์ในแท็บ
  'การจองสินค้าผ่านเว็บ (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
  'ใบสมัครผ่อนออนไลน์ (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
  'รายการรับซื้อ/เทิร์นเครื่อง (ใช้นับขั้น "นัด / จอง" และล้างป้ายหลุด แต่ยังไม่แสดงเป็นเหตุการณ์)',
```
Run:
```bash
NODE_ENV=test npx jest src/modules/customer-journey/customer-journey.service.spec.ts --runInBand
grep -c "ยังไม่แสดงเป็นเหตุการณ์" src/modules/customer-journey/customer-journey.service.ts
```
Expected: the spec PASSES with `0 failed` (`page.notRecorded.length > 0` still holds — the list keeps its other lines); grep prints `0`.

- [ ] **Step 7: Red — real-DB spec for the comeback row**

Create `apps/api/src/modules/customer-journey/sources/chat.recontact.db.spec.ts`:
```ts
import { ChatChannel, MessageRole, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { JourneyStateService } from '../journey-state.service';
import { chatSource } from './chat.source';
import { saleSource } from './sale.source';

/**
 * แถว "กลับมาติดต่ออีกครั้ง" (RECONTACTED) กับ Postgres จริง — คำตัดสินเจ้าของ 2026-09-15 ข้อ 6 + 12
 * ต้องสอดคล้องกับการล้างป้ายหลุดของ journey-state.sql: ข้อความลูกค้าหลัง mark = ออกแถว + ป้ายล้าง ·
 * เอกสาร 6 ชนิดเวลาอยู่ใน (mark, ข้อความ] = ป้ายล้างแต่ไม่ออกแถว (แถวเอกสารอธิบายแทน) · ข้อมูลทั้งหมดเป็นของสังเคราะห์
 * ผู้ใช้/สาขาของ spec ถูกปล่อยไว้ (audit_logs ลบไม่ได้) ตามแบบ journey-state.service.db.spec.ts
 * ใบจองทุกใบในไฟล์นี้ status EXPIRED (ห้ามถอด): product_reservations มี partial unique index product_reservations_active_product_idx
 *   (product_id WHERE status = 'ACTIVE' — migration 20260986000000) และ DOCUMENTS.productReservation กับใบจองของ DOCUMENTS.onlineOrder
 *   ใช้ productId เดียวกันใน it.each เดียว ⇒ ACTIVE ใบที่สองชน P2002 · sale source / doc_last_at นับใบจองทุกสถานะ จึงไม่เปลี่ยนผลของเทส
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('chatSource RECONTACTED (real DB)', () => {
  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  const state = new JourneyStateService(db);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (iso: string) => new Date(iso);
  const OWNER = { id: 'owner-spec', role: 'OWNER' };
  const SECRET = 'ข้อความลับสเปคกลับมาติดต่อ';
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  let seq = 0;
  let branchId = '';
  let productId = '';
  let staffId = '';
  let otherId = '';

  const recontacts = async (customerId: string, actor: { id: string; role: string } = OWNER) =>
    (await chatSource(db, [customerId], { limit: 50 }, actor)).filter((e) => e.type === 'RECONTACTED');
  const lostAtOf = async (customerId: string) => {
    await state.recompute([customerId]);
    return (await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId } })).lostAt?.toISOString() ?? null;
  };

  async function customer(label: string) {
    const row = await prisma.customer.create({ data: { name: `journey recontact ${label}`, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at('2026-09-01T00:00:00.000Z') } });
    customerIds.push(row.id);
    return row.id;
  }
  async function room(customerId: string, assignedToId: string | null = null) {
    const row = await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-recontact-${stamp}-${++seq}`, customerId, assignedToId, createdAt: at('2026-09-01T00:00:00.000Z') } });
    roomIds.push(row.id);
    return row.id;
  }
  const say = (roomId: string, iso: string, role: MessageRole = MessageRole.CUSTOMER) =>
    prisma.chatMessage.create({ data: { roomId, role, text: SECRET, createdAt: at(iso) } });
  const mark = (customerId: string, kind: 'MARKED_LOST' | 'REOPENED', iso: string, deletedAt: Date | null = null) =>
    prisma.customerJourneyEntry.create({
      data: { customerId, originCustomerId: customerId, origin: 'MANUAL', kind, occurredAt: at(iso), actorType: 'STAFF', lostReason: kind === 'MARKED_LOST' ? 'NOT_INTERESTED' : null, deletedAt },
    });

  /** ชุดเดียวกับ doc_last_at ของ journey-state.sql (Task 3) — คำสั่งซื้อผูกการจองที่ไม่มีลูกค้า เพื่อพิสูจน์ว่าคำสั่งซื้อกันแถวได้ด้วยตัวเอง */
  const DOCUMENTS = {
    booking: (customerId: string, iso: string) =>
      prisma.booking.create({ data: { bookingNumber: `JRB-${tail}-${++seq}`, customerId, branchId, depositAmount: 1000, totalAmount: 25000, expireDate: at('2026-09-30T00:00:00.000Z'), createdById: staffId, createdAt: at(iso) } }),
    onlineInstallmentApplication: (customerId: string, iso: string) =>
      prisma.onlineInstallmentApplication.create({ data: { applicationNumber: `JRA-${tail}-${++seq}`, customerId, productId, fullName: 'journey recontact spec', phone: '0000000000', nationalId: '0000000000000', proposedDownPayment: 5000, proposedTotalMonths: 10, proposedMonthlyPayment: 2400, createdAt: at(iso) } }),
    productReservation: (customerId: string, iso: string) =>
      prisma.productReservation.create({ data: { productId, customerId, sessionId: `journey-recontact-${stamp}-${++seq}`, status: 'EXPIRED', reservedAt: at(iso), expiresAt: at('2026-09-30T00:00:00.000Z') } }),
    tradeIn: (customerId: string, iso: string) =>
      prisma.tradeIn.create({ data: { customerId, deviceBrand: 'Apple', deviceModel: 'iPhone 12', createdAt: at(iso) } }),
    savingPlan: (customerId: string, iso: string) =>
      prisma.savingPlan.create({ data: { planNumber: `JRS-${tail}-${++seq}`, customerId, targetAmount: 20000, monthlyAmount: 2000, durationMonths: 10, startedAt: at(iso), createdAt: at(iso) } }),
    onlineOrder: async (customerId: string, iso: string) => {
      const hold = await prisma.productReservation.create({ data: { productId, customerId: null, sessionId: `journey-recontact-${stamp}-${++seq}`, status: 'EXPIRED', reservedAt: at('2026-08-01T00:00:00.000Z'), expiresAt: at('2026-09-30T00:00:00.000Z') } });
      return prisma.onlineOrder.create({ data: { orderNumber: `JRO-${tail}-${++seq}`, customerId, productId, reservationId: hold.id, productPrice: 25000, totalAmount: 25000, shippingMethod: 'BRANCH_PICKUP', paymentChannel: 'PROMPTPAY_QR', createdAt: at(iso) } });
    },
  };
  const DOCUMENT_KINDS = Object.keys(DOCUMENTS) as Array<keyof typeof DOCUMENTS>;
  /** แถวกลุ่มขายที่อธิบายการล้างป้ายแทนแถว "กลับมาติดต่ออีกครั้ง" (canvas TimelineRows g4) — หนึ่งชนิดต่อเอกสาร */
  const DOCUMENT_ROW_TYPE: Record<keyof typeof DOCUMENTS, string> = {
    booking: 'BOOKING_OPENED',
    onlineInstallmentApplication: 'ONLINE_APPLICATION',
    productReservation: 'WEB_HOLD',
    tradeIn: 'TRADE_IN',
    savingPlan: 'SAVING_PLAN_OPENED',
    onlineOrder: 'ONLINE_ORDER_PLACED',
  };

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey recontact ${stamp}` } })).id;
    staffId = (await prisma.user.create({ data: { email: `journey-recontact-staff-${stamp}@spec.local`, password: 'x', name: 'journey recontact staff' } })).id;
    otherId = (await prisma.user.create({ data: { email: `journey-recontact-other-${stamp}@spec.local`, password: 'x', name: 'journey recontact other' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey recontact phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
  });

  afterAll(async () => {
    await prisma.onlineOrder.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.productReservation.deleteMany({ where: { productId } });
    await prisma.onlineInstallmentApplication.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.savingPlan.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.tradeIn.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.booking.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('ติดป้ายหลุดแล้วลูกค้าทักกลับ → หนึ่งแถวที่ข้อความลูกค้าแรกหลัง mark (ข้ามห้อง · ไม่นับข้อความร้าน) · ป้ายหลุดล้าง · ไม่มีข้อความแชทในผล', async () => {
    const c = await customer('comeback');
    const first = await room(c);
    const second = await room(c);
    await say(first, '2026-09-02T00:00:00.000Z');
    const lost = await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await say(first, '2026-09-04T00:00:00.000Z', MessageRole.STAFF);
    await say(first, '2026-09-06T00:00:00.000Z');
    await say(second, '2026-09-05T01:00:00.000Z');
    expect(await recontacts(c)).toEqual([
      { id: `recontact-${lost.id}`, type: 'RECONTACTED', group: 'chat', stage: null, timestamp: '2026-09-05T01:00:00.000Z', title: 'กลับมาติดต่ออีกครั้ง', actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE', href: `/inbox/${second}` },
    ]);
    expect(JSON.stringify(await chatSource(db, [c], { limit: 50 }, OWNER))).not.toContain(SECRET);
    expect(await lostAtOf(c)).toBeNull();
  });

  it('ข้อความเวลาเท่ากับ mark → ไม่มีแถว และยังหลุดอยู่ (ต้องหลัง mark จริง)', async () => {
    const c = await customer('same-time');
    const r = await room(c);
    await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await say(r, '2026-09-03T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([]);
    expect(await lostAtOf(c)).toBe('2026-09-03T00:00:00.000Z');
  });

  it('เปิดใหม่หลัง mark → ไม่มีแถว', async () => {
    const c = await customer('reopened');
    const r = await room(c);
    await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await mark(c, 'REOPENED', '2026-09-04T00:00:00.000Z');
    await say(r, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([]);
    expect(await lostAtOf(c)).toBeNull();
  });

  it('mark ล่าสุดถูกเลิกทำ (deletedAt) → mark ก่อนหน้าเป็นตัวตัดสิน', async () => {
    const c = await customer('undone');
    const r = await room(c);
    const kept = await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await mark(c, 'MARKED_LOST', '2026-09-05T00:00:00.000Z', at('2026-09-05T00:10:00.000Z'));
    await say(r, '2026-09-04T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([expect.objectContaining({ id: `recontact-${kept.id}`, timestamp: '2026-09-04T00:00:00.000Z', href: `/inbox/${r}` })]);
    expect(await lostAtOf(c)).toBeNull();
  });

  it.each(DOCUMENT_KINDS)('เอกสาร %s หลัง mark ล้างป้ายเอง · ลูกค้าทักทีหลังก็ไม่ออกแถว · แถวเอกสารกลุ่มขายอธิบายแทน ณ เวลาเอกสาร', async (kind) => {
    const c = await customer(`doc-${kind}`);
    const r = await room(c);
    await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await DOCUMENTS[kind](c, '2026-09-04T00:00:00.000Z');
    expect(await lostAtOf(c)).toBeNull();
    await say(r, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([]);
    // ป้ายหายโดยไม่มีแถว "กลับมาติดต่ออีกครั้ง" ⇒ ต้องมีแถวของเอกสารนั้นที่เวลาเดียวกับ doc_last_at เสมอ (ไม่มีเอกสารชนิดไหนล้างป้ายแบบเงียบ)
    const explaining = (await saleSource(db, [c], { limit: 50 }, OWNER)).filter((e) => e.timestamp === '2026-09-04T00:00:00.000Z');
    expect(explaining.map((e) => [e.type, e.group, e.stage])).toEqual([[DOCUMENT_ROW_TYPE[kind], 'sale', 'INTERESTED']]);
  });

  it('ขอบช่วง (mark, ข้อความ]: เอกสารเวลาเท่ากับ mark ไม่กันแถว · เอกสารเวลาเท่ากับข้อความกันแถว', async () => {
    const atMark = await customer('doc-at-mark');
    const r1 = await room(atMark);
    await mark(atMark, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await DOCUMENTS.booking(atMark, '2026-09-03T00:00:00.000Z');
    await say(r1, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(atMark)).toHaveLength(1);

    const atMessage = await customer('doc-at-message');
    const r2 = await room(atMessage);
    await mark(atMessage, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await DOCUMENTS.booking(atMessage, '2026-09-05T00:00:00.000Z');
    await say(r2, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(atMessage)).toEqual([]);
  });

  it('ลูกค้าทักก่อนแล้วค่อยมีเอกสาร → ออกแถวที่ข้อความ (ข้อความล้างป้ายก่อน)', async () => {
    const c = await customer('message-first');
    const r = await room(c);
    const lost = await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await say(r, '2026-09-04T00:00:00.000Z');
    await DOCUMENTS.savingPlan(c, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([expect.objectContaining({ id: `recontact-${lost.id}`, timestamp: '2026-09-04T00:00:00.000Z' })]);
    expect(await lostAtOf(c)).toBeNull();
  });

  it('TOUCHPOINT ระหว่าง mark กับข้อความไม่กันแถว', async () => {
    const c = await customer('touchpoint');
    const r = await room(c);
    const lost = await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await prisma.customerJourneyEntry.create({ data: { customerId: c, originCustomerId: c, origin: 'MANUAL', kind: 'TOUCHPOINT', occurredAt: at('2026-09-04T00:00:00.000Z'), actorType: 'STAFF', channel: 'PHONE', outcome: 'THINKING' } });
    await say(r, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([expect.objectContaining({ id: `recontact-${lost.id}`, timestamp: '2026-09-05T00:00:00.000Z' })]);
  });

  it('มีแค่รอบหลุดล่าสุด: ติดป้ายซ้ำหลังลูกค้าทักกลับ → แถวรอบก่อนหาย จนลูกค้าทักหลัง mark ใหม่', async () => {
    const c = await customer('episodes');
    const r = await room(c);
    await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await say(r, '2026-09-04T00:00:00.000Z');
    const second = await mark(c, 'MARKED_LOST', '2026-09-05T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([]);
    expect(await lostAtOf(c)).toBe('2026-09-05T00:00:00.000Z');
    await say(r, '2026-09-06T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([expect.objectContaining({ id: `recontact-${second.id}`, timestamp: '2026-09-06T00:00:00.000Z' })]);
  });

  it('SALES: ข้อความหลัง mark อยู่แค่ในห้องที่คนอื่นดูแล → ไม่มีแถว (ผู้ดูแลห้องและ OWNER เห็น) · ACCOUNTANT ไม่มีแถว · ป้ายยังล้าง', async () => {
    const c = await customer('scoped');
    const mine = await room(c);
    const others = await room(c, otherId);
    await say(mine, '2026-09-02T00:00:00.000Z');
    await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await say(others, '2026-09-04T00:00:00.000Z');
    expect(await recontacts(c, { id: staffId, role: 'SALES' })).toEqual([]);
    expect(await recontacts(c, { id: otherId, role: 'SALES' })).toEqual([expect.objectContaining({ href: `/inbox/${others}` })]);
    expect(await recontacts(c)).toEqual([expect.objectContaining({ href: `/inbox/${others}` })]);
    expect(await recontacts(c, { id: 'accountant-spec', role: 'ACCOUNTANT' })).toEqual([]);
    expect(await lostAtOf(c)).toBeNull();
  });
});
```

- [ ] **Step 8: Red — role table decides who gets the row (mocked)**

In `apps/api/src/modules/customer-journey/sources/role-visibility.spec.ts`, insert this test directly above the final `});` of the `describe` block. After Task 5 the last `it` in that block is Task 5's `'แถวไฟล์ในแชท · ร้านตอบครั้งแรก ตามกลุ่ม chat ของตาราง — บทบาทที่ถูกซ่อนไม่ได้ทั้งสองแถวและไม่ยิง DB · บทบาทที่เห็นได้ทั้งสองแถว'`, so the new test lands after it (the file then has 4 tests):
```ts

  it('แถว "กลับมาติดต่ออีกครั้ง" ตามกลุ่ม chat ของตาราง (บทบาทที่ตารางให้เห็นแชทได้แถว) · คัดข้อความแค่ห้อง + เวลา · เช็กเอกสาร 6 ตารางถึงเวลาข้อความ', async () => {
    const mark = { findFirst: jest.fn().mockResolvedValue({ id: 'm1', kind: 'MARKED_LOST', occurredAt: at('2026-09-03T00:00:00.000Z') }) };
    const message = { findFirst: jest.fn().mockResolvedValue({ roomId: 'r1', createdAt: at('2026-09-04T00:00:00.000Z') }) };
    const tables: Record<string, unknown> = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      chatRoom: { findMany: jest.fn().mockResolvedValue([{ id: 'r1', channel: 'FACEBOOK', createdAt: at('2026-09-01T00:00:00.000Z') }]) },
      customerJourneyEntry: mark,
      chatMessage: message,
    };
    // ตารางอื่นทั้งหมด (todo · auditLog · customer · เอกสาร 6 ชนิด · ตัวอ่านของ Task 5) = ไม่มีแถว
    const none = { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) };
    const chatDb = new Proxy(tables, { get: (target, key) => (typeof key === 'string' && key in target ? target[key] : none) }) as unknown as PrismaService;

    const events = await chatSource(chatDb, ['c1', 'p1'], { limit: 30 }, ACCOUNTANT);

    expect(events).toContainEqual(expect.objectContaining({ id: 'recontact-m1', type: 'RECONTACTED', timestamp: '2026-09-04T00:00:00.000Z', href: '/inbox/r1' }));
    expect(mark.findFirst).toHaveBeenCalledWith({ where: { customerId: { in: ['c1', 'p1'] }, kind: { in: ['MARKED_LOST', 'REOPENED'] }, deletedAt: null }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], select: { id: true, kind: true, occurredAt: true } });
    expect(message.findFirst).toHaveBeenCalledWith({ where: { roomId: { in: ['r1'] }, role: 'CUSTOMER', createdAt: { gt: at('2026-09-03T00:00:00.000Z') } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { roomId: true, createdAt: true } });
    const documentChecks = none.findFirst.mock.calls.filter(([args]) => JSON.stringify(args?.where ?? {}).includes('"lte":"2026-09-04T00:00:00.000Z"'));
    expect(documentChecks).toHaveLength(6);
  });
```

- [ ] **Step 9: Give the two existing mocked chat Prisma objects a `customerJourneyEntry` model**

`recontactEvent` (Step 11) runs inside `roomEvents` whenever the viewer sees at least one room, and calls `prisma.customerJourneyEntry.findFirst` before anything else. Two mocks written by earlier tasks hand `chatSource` a room but no `customerJourneyEntry` model, so after Step 11 they would throw `TypeError: Cannot read properties of undefined (reading 'findFirst')`. Add the model now (unused until Step 11, so both files stay green in Step 10). Each mock resolves `null` = no lost mark ⇒ no `RECONTACTED` row, so their existing expectations do not change.

(a) `apps/api/src/modules/customer-journey/sources/role-visibility.spec.ts` — Task 5's `chat` object in the test `'แถวไฟล์ในแชท · ร้านตอบครั้งแรก ตามกลุ่ม chat ของตาราง …'`. Replace:
```ts
      customerJourneyState: {
        findUnique: jest.fn().mockResolvedValue({ customerId: 'c1', firstStaffReplyAt: at('2026-09-10T02:15:00.000Z'), contactedAt: at('2026-09-10T02:00:00.000Z'), firstChannel: 'CHAT_FACEBOOK' }),
      },
    };
```
with:
```ts
      customerJourneyState: {
        findUnique: jest.fn().mockResolvedValue({ customerId: 'c1', firstStaffReplyAt: at('2026-09-10T02:15:00.000Z'), contactedAt: at('2026-09-10T02:00:00.000Z'), firstChannel: 'CHAT_FACEBOOK' }),
      },
      // Task 6: roomEvents อ่านป้ายหลุดล่าสุดเพื่อทำแถว "กลับมาติดต่ออีกครั้ง" — ไม่มีป้าย ⇒ ไม่มีแถวนั้น
      customerJourneyEntry: { findFirst: jest.fn().mockResolvedValue(null) },
    };
```

(b) `apps/api/src/modules/customer-journey/journey-shared-contract.spec.ts` — `function chatDb` (as Task 5 left it). Replace:
```ts
      customerJourneyState: { findUnique: jest.fn().mockResolvedValue(null) },
    };
  }
```
with:
```ts
      customerJourneyState: { findUnique: jest.fn().mockResolvedValue(null) },
      // Task 6: roomEvents อ่านป้ายหลุดล่าสุดเพื่อทำแถว "กลับมาติดต่ออีกครั้ง" — ไม่มีป้าย ⇒ ถ้อยคำแถวเปิดห้องเท่าเดิม
      customerJourneyEntry: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  }
```

Each quoted block occurs exactly once in its file (in `role-visibility.spec.ts` the only other `customerJourneyState` hit is the `expect(chat.customerJourneyState.findUnique)` line, which the anchor does not include).

- [ ] **Step 10: Run them and watch the new tests fail**

Run:
```bash
$TEST_DB TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/chat.recontact.db.spec.ts --runInBand
NODE_ENV=test npx jest src/modules/customer-journey/sources/role-visibility.spec.ts src/modules/customer-journey/journey-shared-contract.spec.ts --runInBand
```
Expected:
- `chat.recontact.db.spec.ts`: FAIL, `Tests: 7 failed, 8 passed, 15 total`.
  - These fail with `Received: []` or a length of 0, because `chatSource` has no `RECONTACTED` row yet: comeback · undone · boundary · message-first · touchpoint · episodes · SALES.
  - These already pass: same-time · reopened · the six `it.each` document cases. They pass because Task 3's `lostAt` clearing is in place, no row is expected, and Step 4 already gives every document its sale row.
- `role-visibility.spec.ts`: FAIL, `Tests: 1 failed, 3 passed, 4 total` (Task 1's two tests + Task 5's test pass; only this task's new test fails — its `toContainEqual(expect.objectContaining({ id: 'recontact-m1', ... }))`).
- `journey-shared-contract.spec.ts`: PASS, `Tests: 10 passed, 10 total`.
- If any "already pass" case fails instead, stop: in the six document cases a failing `lostAtOf` means Task 3 has not landed its document clearing; a failing `explaining` assertion means Step 4 is incomplete.
- A `P2002` / `Unique constraint failed` on `product_reservations_active_product_idx` in the `onlineOrder` case means one of the two `productReservation.create` calls in `DOCUMENTS` lost its `status: 'EXPIRED'` — restore it; never drop the index.

- [ ] **Step 11: Green — comeback row in the chat source**

In `apps/api/src/modules/customer-journey/sources/chat.source.ts`, insert this block directly above `async function roomEvents(prisma: PrismaService, customerIds: string[], actor: JourneyActor): Promise<JourneyEvent[]> {`:
```ts
const LOST_MARK_KINDS = ['MARKED_LOST', 'REOPENED'];

/**
 * เอกสารที่ลูกค้าสร้างซึ่งล้างป้ายหลุด — ชุดและเงื่อนไขเดียวกับ doc_last_at ใน sql/journey-state.sql (แก้ที่หนึ่งต้องแก้อีกที่ · chat.recontact.db.spec.ts ตรวจคู่กัน)
 * ช่วง (after, upTo] · ทุกสถานะ · product_reservations ไม่มี deleted_at · คัดแค่ id
 */
async function clearingDocumentBetween(prisma: PrismaService, customerIds: string[], after: Date, upTo: Date): Promise<boolean> {
  const customerId = { in: customerIds };
  const between = { gt: after, lte: upTo };
  const select = { id: true } as const;
  const found = await Promise.all([
    prisma.booking.findFirst({ where: { customerId, deletedAt: null, createdAt: between }, select }),
    prisma.onlineInstallmentApplication.findFirst({ where: { customerId, deletedAt: null, createdAt: between }, select }),
    prisma.productReservation.findFirst({ where: { customerId, reservedAt: between }, select }),
    prisma.tradeIn.findFirst({ where: { customerId, deletedAt: null, createdAt: between }, select }),
    prisma.savingPlan.findFirst({ where: { customerId, deletedAt: null, createdAt: between }, select }),
    prisma.onlineOrder.findFirst({ where: { customerId, deletedAt: null, createdAt: between }, select }),
  ]);
  return found.some(Boolean);
}

/**
 * "กลับมาติดต่ออีกครั้ง" (คำตัดสินเจ้าของ 2026-09-15 ข้อ 6) — คำนวณตอนอ่าน ไม่เก็บ
 * mark ล่าสุดที่ไม่ถูกลบของครอบครัวต้องเป็น MARKED_LOST (กติกาเดียวกับ CTE lost_mark) · ไม่ตัดหน้าต่าง: mark อยู่คนละหน้ากับข้อความได้
 * แถว = ข้อความ CUSTOMER แรกที่เวลา > mark ในห้องที่ผู้ดูเห็น · ไม่กรอง deletedAt ให้ตรงกับ last_customer_at · PDPA: select แค่ roomId + createdAt
 * ไม่ออกแถวเมื่อเอกสารที่ล้างป้ายเกิดใน (mark, ข้อความ] — แถวเอกสารอธิบายแทน · TOUCHPOINT ไม่กันแถว · มีเฉพาะรอบหลุดล่าสุด
 * SALES: ป้ายอาจล้างเพราะข้อความในห้องที่มองไม่เห็น แถวจึงอาจมาช้ากว่าหรือไม่มาเลย (เหมือนแถวแชทอื่น)
 */
async function recontactEvent(prisma: PrismaService, customerIds: string[], roomIds: string[]): Promise<JourneyEvent | null> {
  const mark = await prisma.customerJourneyEntry.findFirst({
    where: { customerId: { in: customerIds }, kind: { in: LOST_MARK_KINDS }, deletedAt: null },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: { id: true, kind: true, occurredAt: true },
  });
  if (!mark || mark.kind !== 'MARKED_LOST') return null;
  const back = await prisma.chatMessage.findFirst({
    where: { roomId: { in: roomIds }, role: 'CUSTOMER', createdAt: { gt: mark.occurredAt } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { roomId: true, createdAt: true },
  });
  if (!back || (await clearingDocumentBetween(prisma, customerIds, mark.occurredAt, back.createdAt))) return null;
  return {
    id: `recontact-${mark.id}`, type: 'RECONTACTED', group: 'chat', stage: null, timestamp: back.createdAt.toISOString(),
    title: 'กลับมาติดต่ออีกครั้ง', actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE', href: `/inbox/${back.roomId}`,
  };
}

```

Inside `roomEvents`, replace:
```ts
  const [days, todos] = await Promise.all([
    chatDays(prisma, roomIds),
```
with:
```ts
  const [days, recontact, todos] = await Promise.all([
    chatDays(prisma, roomIds),
    recontactEvent(prisma, customerIds, roomIds),
```

At the end of `roomEvents`, replace:
```ts
  return events;
}

async function leadEvents(
```
with:
```ts
  if (recontact) events.push(recontact);
  return events;
}

async function leadEvents(
```

- [ ] **Step 12: Run the new specs and their neighbours, watch them pass**

Run:
```bash
$TEST_DB TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/chat.recontact.db.spec.ts --runInBand
$TEST_DB TZ=UTC NODE_ENV=test npx jest src/modules/customer-journey/sources/chat.recontact.db.spec.ts --runInBand
NODE_ENV=test npx jest src/modules/customer-journey/sources/role-visibility.spec.ts src/modules/customer-journey/sources/credit-sale.source.spec.ts --runInBand
NODE_ENV=test npx jest src/modules/customer-journey/journey-shared-contract.spec.ts src/modules/customer-journey/customer-journey.service.spec.ts --runInBand
$TEST_DB TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey --runInBand
```
Expected:
- `chat.recontact.db.spec.ts`: PASS, `Tests: 15 passed, 15 total`, under both TZ values. Every seeded time is an ISO UTC string; the source never uses `now()`.
- `role-visibility.spec.ts` + `credit-sale.source.spec.ts`: PASS, `Tests: 9 passed, 9 total` (role-visibility 4 · credit-sale 5).
- `journey-shared-contract.spec.ts` + `customer-journey.service.spec.ts`: PASS, 0 failed (contract `10 passed` — its rooms now reach `recontactEvent`, which gets `null` from the Step 9 mock).
- A `TypeError: Cannot read properties of undefined (reading 'findFirst')` in Task 5's role-visibility test or in the contract spec's chat tests means Step 9 was not applied to that file.
- Whole `customer-journey` folder: every suite passes. In particular:
  - `chat.source.db.spec.ts`: none of its customers has a lost mark, so there is no extra row and the walk-in `toEqual([...])` stays exact.
  - `customer-journey.pdpa.db.spec.ts`: the new rows use only existing `EVENT_KEYS`; it seeds no web hold, online application or trade-in, so its snapshot is unchanged.
  - `customer-journey.service.spec.ts`: sources are mocked.
- The staff_reply work is merged into the base (#1595 — Controller ruling R-P4), so a failure in `journey-state.service.db.spec.ts` (staff_reply / `firstStaffReplyAt` cases included) is a regression like any other: it blocks the commit. Do not edit that spec or `journey-state.sql` in this task — report the failing test name to the controller.

- [ ] **Step 13: Spec doc — event table and lost section**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md`:

(a) In the "หลุด:" list, delete the stale parenthetical ` (ไทม์ไลน์แสดง 'กลับมาติดต่ออีกครั้ง')` from the bullet that starts with `- ล้างเองเมื่อ`. Keep the rest of that bullet exactly as Task 3 left it. If Task 3 already removed the parenthetical, skip (a).

(b) Add one bullet at the end of the "หลุด:" list. It becomes a new line directly below the list's current last bullet, above the blank line that precedes `เงียบ:`. The line to add:
```text
- แถว 'กลับมาติดต่ออีกครั้ง' (RECONTACTED) ออกเมื่อมีข้อความลูกค้าหลังป้ายหลุดล่าสุด และไม่มีเอกสารที่ล้างป้ายเกิดหลัง mark จนถึงเวลาข้อความนั้น — ป้ายที่ล้างด้วยเอกสาร (ใบจอง · ใบสมัครผ่อนออนไลน์ · จองสินค้า · เทิร์นเครื่อง · แผนออม · คำสั่งซื้อออนไลน์) ไม่ออกแถวนี้ แถวของเอกสารอธิบายแทน · TOUCHPOINT ไม่กันแถว · กติกาเต็มอยู่ในแถว MARKED_LOST / REOPENED / RECONTACTED ของรายการเหตุการณ์
```
Nothing else in the section changes. The blank line and `เงียบ:` stay where they are.

(c) Replace the whole table line that starts with `| MARKED_LOST / REOPENED |` with:
```text
| MARKED_LOST / REOPENED / RECONTACTED | ติดป้ายหลุด: {เหตุผล} / เปิดใหม่ / กลับมาติดต่ออีกครั้ง | แชท/ติดต่อ | entries MANUAL kind=MARKED_LOST\|REOPENED · 'กลับมาติดต่ออีกครั้ง' (type RECONTACTED) คำนวณตอนอ่านใน chat.source ไม่เก็บ: entry ล่าสุดที่ไม่ถูกลบของครอบครัว kind MARKED_LOST\|REOPENED (occurred_at desc, id desc — กติกาเดียวกับ CTE lost_mark) ต้องเป็น MARKED_LOST → แถว = ข้อความ role=CUSTOMER แรกที่ created_at > เวลา mark ในห้องที่ผู้ดูเห็น (กติกาห้องของ SALES · รวมข้อความที่ retention soft-delete · คัดแค่ room_id + created_at) · ไม่ออกแถวเมื่อมีเอกสารที่ล้างป้ายเวลาอยู่ใน (mark, ข้อความ] — bookings.created_at · online_installment_applications.created_at · product_reservations.reserved_at · trade_ins.created_at · saving_plans.created_at · online_orders.created_at (ทุกสถานะ ไม่ถูกลบ ชุดเดียวกับ doc_last_at ใน journey-state.sql) แถวเอกสารอธิบายแทน · TOUCHPOINT ไม่กันแถว · มีเฉพาะรอบหลุดล่าสุด (ติดป้ายซ้ำ = แถวรอบก่อนหาย) · เลิกทำ mark หรือเปิดใหม่ = แถวหาย | ป้ายหลุด (RECONTACTED ไม่เลื่อนขั้น) | พนักงาน / ลูกค้า (RECONTACTED) | exact · RECONTACTED ลิงก์ /inbox/:roomId ของข้อความนั้น · SALES อาจไม่เห็นแถวทั้งที่ป้ายล้างแล้ว เมื่อข้อความอยู่ในห้องที่คนอื่นดูแล |
```

(d) The spec table already listed web holds, online applications and trade-ins, but no source emitted them until Step 4. Rewrite both rows to what is emitted now. Replace the whole table line that starts with `| WEB_HOLD / ONLINE_APPLICATION |` (whatever its current text is — Task 2 changed its stage cell to `นัด / จอง`) with:
```text
| WEB_HOLD / ONLINE_APPLICATION | กดจองเครื่องบนเว็บ / ยื่นใบสมัครผ่อนออนไลน์ | ขาย/สัญญา | product_reservations.reserved_at (customer_id ∈ ids · ตารางไม่มี deleted_at · ทุกสถานะ) · online_installment_applications.created_at (customer_id ∈ ids · deleted_at null · ทุกสถานะ) · คัดแค่ id + เวลา (ไม่คัด session_id · full_name · phone · national_id) · หนึ่งแถวต่อเอกสาร (id webhold-/onlineapp-) · ไม่มีลิงก์ | นัด / จอง · ล้างป้ายหลุดโดยไม่ออกแถว 'กลับมาติดต่ออีกครั้ง' | ลูกค้า | เวลาสร้าง exact · สถานะภายหลังถูกเขียนทับจึงไม่แสดงสถานะ · ส่วนใหญ่ customer_id ว่าง ⇒ แถวเหล่านั้นไม่ขึ้น |
```
Then replace the whole table line that starts with `| TRADE_IN |` with:
```text
| TRADE_IN | ส่งเครื่องเทิร์น/ขายคืน | ขาย/สัญญา | trade_ins.created_at (customer_id ∈ ids · deleted_at null · ทุกสถานะ) · คัดแค่ id + created_at (ไม่คัดข้อมูลผู้ขาย · IMEI · serial · รูปบัตร · รูปเครื่อง · ราคา · customer_notes) · id tradein- · ไม่มีลิงก์ | นัด / จอง · ล้างป้ายหลุดโดยไม่ออกแถว 'กลับมาติดต่ออีกครั้ง' | ลูกค้า (ไม่อ่านผู้คีย์ — เทิร์นหน้าร้านก็แสดงลูกค้า) | exact เฉพาะแถวที่ผูก customer_id · ไม่แสดงราคา/ผลรับซื้อ · เวลาปฏิเสธ/ปิดไม่ได้บันทึก |
```

(e) Insert these two lines directly below the table line that starts with `| TRADE_IN |` (the line you just wrote in (d)):
```text
| SAVING_PLAN_OPENED | สมัครออมเครื่อง | ขาย/สัญญา | saving_plans.created_at (customer_id ∈ ids · deleted_at null · ทุกสถานะ) · ลูกค้าสมัครเองบนเว็บร้าน · คัดแค่ id + created_at (ไม่คัด target_product_model) · ไม่มีลิงก์ (/saving-plans เป็นหน้ารายการของผู้จัดการ ไม่มีหน้ารายละเอียด) | นัด / จอง · ล้างป้ายหลุดโดยไม่ออกแถว 'กลับมาติดต่ออีกครั้ง' | ลูกค้า | exact |
| ONLINE_ORDER_PLACED | สั่งซื้อออนไลน์ | ขาย/สัญญา | online_orders.created_at (customer_id ∈ ids · deleted_at null · ทุกสถานะ รวมใบที่ถูกยกเลิกเพราะสร้างรายการชำระไม่สำเร็จ) · ลูกค้าสั่งเองบนเว็บร้าน · คัดแค่ id + created_at (ไม่คัด shipping_address · bank_slip_url · payment_ref · promo_code) · ไม่มีลิงก์ (/online-orders เป็นหน้ารายการของผู้จัดการ) | นัด / จอง · ล้างป้ายหลุดโดยไม่ออกแถว 'กลับมาติดต่ออีกครั้ง' | ออนไลน์ | exact |
```

Check:
```bash
grep -n "RECONTACTED\|SAVING_PLAN_OPENED\|ONLINE_ORDER_PLACED" ../../docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "ไทม์ไลน์แสดง 'กลับมาติดต่ออีกครั้ง'" ../../docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -n "^| WEB_HOLD / ONLINE_APPLICATION |\|^| TRADE_IN |" ../../docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "รับซื้อแล้ว {ราคา}\|customer_id not null) · online_installment" ../../docs/superpowers/specs/2026-09-15-customer-journey-design.md
```
Expected:
- The first grep shows the new lost bullet, the `| MARKED_LOST / REOPENED / RECONTACTED |` row, and one line each for `| SAVING_PLAN_OPENED |` and `| ONLINE_ORDER_PLACED |` (the latter two directly after `| TRADE_IN |`).
- The second grep prints `0`.
- The third grep prints exactly two lines, each containing `คัดแค่ id`.
- The fourth grep prints `0` (the old row texts are gone).

- [ ] **Step 14: Typecheck and lint the touched files**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src/modules/customer-journey/sources/chat.source.ts src/modules/customer-journey/sources/sale.source.ts src/modules/customer-journey/sources/chat.recontact.db.spec.ts src/modules/customer-journey/sources/credit-sale.source.spec.ts src/modules/customer-journey/sources/role-visibility.spec.ts src/modules/customer-journey/journey-shared-contract.spec.ts src/modules/customer-journey/customer-journey.service.ts src/modules/customer-journey/customer-journey.service.spec.ts
```
Expected: both exit 0 with no errors. 🚨 Never `npm run lint` in `apps/api` (the script has `--fix`).

- [ ] **Step 15: Commit**

Run from the worktree root:
```bash
git add apps/api/src/modules/customer-journey/sources/chat.source.ts apps/api/src/modules/customer-journey/sources/sale.source.ts apps/api/src/modules/customer-journey/sources/chat.recontact.db.spec.ts apps/api/src/modules/customer-journey/sources/credit-sale.source.spec.ts apps/api/src/modules/customer-journey/sources/role-visibility.spec.ts apps/api/src/modules/customer-journey/journey-shared-contract.spec.ts apps/api/src/modules/customer-journey/customer-journey.service.ts apps/api/src/modules/customer-journey/customer-journey.service.spec.ts docs/superpowers/specs/2026-09-15-customer-journey-design.md
git commit -F - <<'EOF'
feat(customer-journey): แถว "กลับมาติดต่ออีกครั้ง" + แถวของเอกสารทุกชนิดที่ล้างป้ายหลุด อธิบายว่าป้ายหลุดล้างเพราะอะไร

- chat.source: แถว RECONTACTED คำนวณตอนอ่าน = ข้อความลูกค้าแรกหลังป้ายหลุดล่าสุด (กติกาเดียวกับ CTE lost_mark) ในห้องที่ผู้ดูเห็น · คัดแค่ห้อง + เวลา
- ไม่ออกแถวเมื่อเอกสาร 6 ชนิดที่ล้างป้าย (ใบจอง · สมัครผ่อนออนไลน์ · จองสินค้า · เทิร์นเครื่อง · แผนออม · สั่งซื้อออนไลน์) เกิดใน (mark, ข้อความ] — ชุดเดียวกับ doc_last_at
- sale.source: แถวแผนออม · สั่งซื้อออนไลน์ · จองเครื่องบนเว็บ · สมัครผ่อนออนไลน์ · เทิร์นเครื่อง กลุ่มขาย ขั้นนัด / จอง ไม่มีลิงก์ · select แค่ id + เวลา (ไม่คัดที่อยู่ สลิป เลขอ้างอิงชำระ โค้ดส่วนลด ชื่อ/เบอร์/เลขบัตร ข้อมูลผู้ขาย IMEI รูป ราคา) ⇒ ป้ายที่ล้างด้วยเอกสารมีแถวอธิบายครบทั้ง 6 ชนิด
- "ระบบยังไม่เก็บ" ตัดจองเว็บ / สมัครผ่อนออนไลน์ / รับซื้อ-เทิร์น (แสดงเป็นแถวแล้ว)
- mock chatSource ของ role-visibility + journey-shared-contract มี customerJourneyEntry
- เทสฐานจริง chat.recontact.db.spec.ts 15 เคส (เอกสาร 6 ชนิดตรวจแถวอธิบายด้วย) + role-visibility + credit-sale · สเปครายการเหตุการณ์

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --stat
```
Expected: one commit with exactly the 9 files above. `git status --short` shows no other file staged by this task.

---

### Task 7: POST /customers/:id/journey/entries (slim manual entries)

**Goal:** A staff member can record one of four things in a single request: a contact (touchpoint), where the customer heard about the shop, a lost mark, or a reopen.
- The server sets the time and dedupes replays.
- A merged placeholder id is followed to the real customer.
- The response carries the stored row and a freshly recomputed summary.

Sources:
- brief §0 rulings 4 (no note, no change-time field) and 12 (lost reasons are chips only), plus Q4, Q6 and Q8
- brief §3 (POST), with the parts that §0 made moot left out
- spec "API" item 3; research-events §3.1-3.3, §3.6, C1 and C7; outline D8, D9 and D10
- Controller ruling R-P2 was reverted on 2026-09-16: `note` is **not** added to the audit `SENSITIVE_FIELDS`, and this task does not touch `apps/api/src/modules/audit/` (D10; accepted residual risk = plan head Risk 8)

Line numbers are from the base `origin/main` `10d6e6d3a`. Tasks 1-6 shift some of them, so anchor every edit on the quoted text, not on the number.

Every command runs from the worktree root (`/Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/feat+customer-detail-journey`). API commands run inside a `( cd apps/api && … )` subshell, so pasting a block never changes the shell's directory.

**Files:**
- Create: `apps/api/src/modules/customer-journey/sources/manual-entry-event.ts`
- Create: `apps/api/src/modules/customer-journey/sources/manual-entry-event.spec.ts`
- Modify: `apps/api/src/modules/customer-journey/sources/entries.source.ts`
  - the `@installment/shared` import (`:1-9`; `:1-11` after Task 1)
  - the label comment and `labelOf` helper that Task 1 left at `:29-31`
  - the block from `const seesChat = roleSeesGroup(actor.role, 'chat');` through the end of the `for (const row of rows) { … }` loop (`:81-104`)
- Create: `apps/api/src/modules/customer-journey/dto/create-journey-entry.dto.ts`
- Create: `apps/api/src/modules/customer-journey/dto/create-journey-entry.dto.spec.ts`
- Create: `apps/api/src/modules/customer-journey/journey-manual-entry.service.ts`
- Create: `apps/api/src/modules/customer-journey/journey-manual-entry.service.spec.ts`
- Create: `apps/api/src/modules/customer-journey/journey-manual-entry.db.spec.ts`
- Modify: `apps/api/src/modules/customer-journey/customer-journey.service.ts:41` — delete the `JOURNEY_NOT_RECORDED` line `'ลูกค้าหน้าร้านรู้จักร้านจากไหน',`
- Modify: `apps/api/src/modules/customer-journey/customer-journey.controller.ts:1-32` (whole file)
- Modify: `apps/api/src/modules/customer-journey/customer-journey.controller.spec.ts:1-33` (whole file)
- Modify: `apps/api/src/modules/customer-journey/customer-journey.controller.summary.spec.ts`
  - `:1-7` (imports) and `:15-18` (providers)
  - This file is not in the outline's list, but it compiles the same controller. Without the new provider its test module cannot be built.
- Modify: `apps/api/src/modules/customer-journey/customer-journey.module.ts:5-7,15` (import + provider)
- Modify: `apps/api/src/modules/customer-journey/customer-journey.module.spec.ts:1-11` (whole file — pins the provider; imports stay `[]`)
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md`
  - the last two cells of the `| TOUCHPOINT |` row of the event table (`:269`)
  - the `3) POST /customers/:id/journey/entries` block (`:325-335`)
  - the metric line under "บันทึกด้วยมือ (เฟส 3)" (`:449`)
- Modify: `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` (created by Task 2) — append one section at the end of the file

**Interfaces:**

Consumes:
- Task 1 (`@installment/shared`):
  - kinds: `JOURNEY_ENTRY_KINDS.MANUAL` and `JourneyManualEntryKind` (both existing)
  - code lists with their types: `JOURNEY_RECORDABLE_TOUCH_CHANNELS` + `JourneyRecordableTouchChannel` · `JOURNEY_TOUCH_OUTCOMES` + `JourneyTouchOutcome` · `JOURNEY_LOST_REASONS` + `JourneyLostReason` · `JOURNEY_HEARD_FROM_CODES` + `JourneyHeardFrom`
  - label maps: `JOURNEY_TOUCH_CHANNEL_LABELS: Record<JourneyTouchChannel, string>` · `JOURNEY_TOUCH_OUTCOME_LABELS: Record<JourneyTouchOutcome, string>` · `JOURNEY_HEARD_FROM_LABELS` and `JOURNEY_LOST_REASON_LABELS` (existing)
  - `interface JourneyEntryCreatedResponse { entryId: string | null; event: JourneyEvent | null; summary: JourneySummary }`
  - after Task 1, `entries.source.ts` builds TOUCHPOINT titles through a local `labelOf(labels, code)` helper
- Task 2:
  - `JOURNEY_STAGES = ['CONTACTED','IDENTIFIED','CREDIT','INTERESTED','PURCHASED']`
  - the runbook file `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md`
- Task 4:
  - `JourneySummary.askHeardFrom = firstSource === 'WALK_IN' && heardFrom === null && purchaseCount < 2`
  - `JourneyStep.evidence` is `'MANUAL'` on INTERESTED when a TOUCHPOINT APPOINTED/VISITED is the evidence
- Shipped code:
  - `JourneyStateService.recompute(customerIds: string[]): Promise<void>` — throws on failure
  - `JourneySummaryService.summary(customerId, actor): Promise<JourneySummary | JourneyRedirect>` — recomputes only when the cache is missing, mismatches PURCHASED, or is older than 15 min with activity
  - `BOUGHT_WHERE` from `../customers/services/customer-query.service` (imported by file path)
  - `asActorType`, `roleSeesGroup` and `JourneyActor` from `sources/journey-window.ts`

Produces (all under `apps/api/src/modules/customer-journey/`):

**`sources/manual-entry-event.ts`**
- `export const MANUAL_ENTRY_EVENT_SELECT`
  - `satisfies Prisma.CustomerJourneyEntrySelect`
  - selects `id, kind, origin, occurredAt, createdAt, actorType, roomId, channel, outcome, lostReason, heardFrom, actorUser { id, name }` — never `note`
- `export interface ManualEntryEventRow { id: string; kind: string; origin: string; occurredAt: Date; actorType: string; roomId: string | null; channel: string | null; outcome: string | null; lostReason: string | null; heardFrom: string | null; actorUser: { id: string; name: string } | null }`
- `export const isManualEntryKind: (kind: string) => kind is JourneyManualEntryKind`
- `export function manualEntryTitle(row: Pick<ManualEntryEventRow, 'kind' | 'channel' | 'outcome' | 'lostReason' | 'heardFrom'>): string`
- `export function manualEntryToEvent(row: ManualEntryEventRow, actor: JourneyActor, now: Date): JourneyEvent`

  | Field | Value |
  |---|---|
  | `id` | `entry-<rowId>` |
  | `type` | `kind` |
  | `group` | `'chat'` |
  | `stage` | `'INTERESTED'` only for TOUCHPOINT APPOINTED/VISITED, else `null` |
  | `title` | `manualEntryTitle(row)` |
  | `actor` | `{ type, id, name }` from `actorUser`, or `{ type }` |
  | `reliability` | `'exact'` |
  | `origin` | `'MANUAL'` for MANUAL rows, else `'SYSTEM_ENTRY'` |
  | `href` | `/inbox/<roomId>` only when `roomId` is set and the role sees the chat group |
  | `metadata` | never set |

  - `now` is unused in this task. Task 8 spreads undo fields computed from it.
  - `entries.source.ts` builds every MANUAL-kind event through this mapper.

**`dto/create-journey-entry.dto.ts`** — `export class CreateJourneyEntryDto`

| Field | Decorators | Message |
|---|---|---|
| `kind!: JourneyManualEntryKind` | `@IsIn([...JOURNEY_ENTRY_KINDS.MANUAL])` | `'ชนิดรายการไม่ถูกต้อง'` |
| `channel?: JourneyRecordableTouchChannel` | `@ValidateIf(kind === 'TOUCHPOINT')` `@IsIn([...JOURNEY_RECORDABLE_TOUCH_CHANNELS])` | `'กรุณาเลือกช่องทาง'` |
| `outcome?: JourneyTouchOutcome` | `@ValidateIf(TOUCHPOINT)` `@IsIn([...JOURNEY_TOUCH_OUTCOMES])` | `'กรุณาเลือกผลการติดต่อ'` |
| `lostReason?: JourneyLostReason` | `@ValidateIf(MARKED_LOST)` `@IsIn([...JOURNEY_LOST_REASONS])` | `'กรุณาเลือกเหตุผล'` |
| `heardFrom?: JourneyHeardFrom` | `@ValidateIf(HEARD_FROM)` `@IsIn([...JOURNEY_HEARD_FROM_CODES])` | `'กรุณาเลือกช่องทางที่รู้จักร้าน'` |
| `clientRequestId?: string` | `@IsOptional()` `@IsUUID('4')` | `'รหัสคำขอไม่ถูกต้อง'` |

There is no `note`, `occurredAt` or `roomId` field.

**`journey-manual-entry.service.ts`**
- `export const manualEntryDedupeKey = (kind: JourneyManualEntryKind, clientRequestId: string): string` → `MANUAL:<kind>:<clientRequestId>`
- `@Injectable() export class JourneyManualEntryService`
  - constructor: `(private readonly prisma: PrismaService, private readonly journeyState: JourneyStateService, private readonly summaries: JourneySummaryService)`
  - `private readonly logger = new Logger(JourneyManualEntryService.name)`
  - `create(customerId: string, dto: CreateJourneyEntryDto, actor: { id: string; role: string }): Promise<JourneyEntryCreatedResponse>`
- What `create` does, in order:
  1. **Resolve the target.**
     - A customer with `deletedAt` + `mergedIntoId` → target = `mergedIntoId`.
     - A target that is missing or deleted → 404 `'ไม่พบลูกค้า'`.
     - Family = `[target, ...customers where mergedIntoId = target]`.
  2. **Check the dedupe key first.**
     - `dedupeKey = clientRequestId ? MANUAL:<kind>:<id> : null`.
     - When set, look it up **before** the kind rules.
     - Hit on a soft-deleted row, or `customerId ∉ family` → 409 `'คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง'`.
     - Any other hit → return that row with a fresh summary. No insert, no recompute.
  3. **MARKED_LOST.**
     - `count({ AND: [{ id: target }, BOUGHT_WHERE] }) > 0` → 409 `'ลูกค้ารายนี้ซื้อแล้ว ติดป้ายหลุดไม่ได้'`.
     - A customer who is already lost can be marked again.
  4. **REOPENED.** Recompute quietly, then read the summary. `lost === null` → return `{ entryId: null, event: null, summary }`.
  5. **Insert** with `occurredAt` = server now:
     `{ customerId: target, originCustomerId: target, origin: 'MANUAL', kind, occurredAt, actorType: 'STAFF', actorUserId: actor.id, roomId: null, refType: null, refId: null, note: null, channel/outcome/lostReason/heardFrom, dedupeKey }`
     - `channel`/`outcome`/`lostReason`/`heardFrom` are set only for their own kind; the rest are null.
     - P2002 with a dedupe key → load the winning row and apply the step 2 rules. Anything else is rethrown.
  6. **Recompute** `[target]` in try/catch. On failure: `logger.warn` + `Sentry.captureException(err, { tags: { kind: 'customer-journey', op: 'manual-entry-recompute' } })`.
  7. **Respond** with `{ entryId, event: manualEntryToEvent(row, actor, now), summary }`.
     - A summary redirect is followed one hop.
     - A second redirect → 404 `'ไม่พบลูกค้า'`.

**`customer-journey.controller.ts`**
- constructor: `(private readonly journey: CustomerJourneyService, private readonly manualEntries: JourneyManualEntryService)`
- route: `@Post(':id/journey/entries') @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES') createEntry(@Param('id') id: string, @Body() dto: CreateJourneyEntryDto, @CurrentUser() user: { id: string; role: string }): Promise<JourneyEntryCreatedResponse>`
- no `@HttpCode`, so the status is always 201
- passes `{ id: user.id, role: user.role }` to the service

**Other changes**
- `customer-journey.module.ts`: `JourneyManualEntryService` is added to `providers` (not exported). `imports` stays absent (`[]`).
- `JOURNEY_NOT_RECORDED` no longer contains `'ลูกค้าหน้าร้านรู้จักร้านจากไหน'`.

---

- [ ] **Step 1: Build shared so the API sees the Task 1 types**

```bash
npm run build --workspace=@installment/shared
```
Expected: exits 0, and `packages/shared/dist/customer-journey.d.ts` contains `JOURNEY_RECORDABLE_TOUCH_CHANNELS` and `JourneyEntryCreatedResponse`.

- [ ] **Step 2: Write the failing mapper spec**

Create `apps/api/src/modules/customer-journey/sources/manual-entry-event.spec.ts`:

```ts
import type { JourneyEventGroup, JourneyStage } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { entriesSourceFor } from './entries.source';
import { isManualEntryKind, manualEntryTitle, manualEntryToEvent, type ManualEntryEventRow } from './manual-entry-event';

const OWNER = { id: 'o1', role: 'OWNER' };
const NOW = new Date('2026-09-15T05:00:00.000Z');
type Row = ManualEntryEventRow & { createdAt: Date };
const row = (o: Partial<Row> & Pick<Row, 'id' | 'kind'>): Row => ({
  origin: 'MANUAL',
  occurredAt: new Date('2026-09-14T03:00:00.000Z'),
  createdAt: new Date('2026-09-14T03:00:00.000Z'),
  actorType: 'STAFF',
  roomId: null,
  channel: null,
  outcome: null,
  lostReason: null,
  heardFrom: null,
  actorUser: { id: 'u1', name: 'แนน' },
  ...o,
});

// ถ้อยคำตามกระดาน TimelineRows — ต่อคำตรง ๆ ไม่มีช่องว่างหลัง "ทาง" / "จาก"
const TITLES: Array<[Partial<Row> & Pick<Row, 'kind'>, string, JourneyStage | null]> = [
  [{ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED' }, 'ติดต่อทางโทร: นัดแล้ว', 'INTERESTED'],
  [{ kind: 'TOUCHPOINT', channel: 'LINE_APP', outcome: 'VISITED' }, 'ติดต่อทางLINE: มาร้านแล้ว', 'INTERESTED'],
  [{ kind: 'TOUCHPOINT', channel: 'FB_APP', outcome: 'BUDGET' }, 'ติดต่อทางแชทในแอป FB: งบ/ดาวน์ไม่พอ', null],
  [{ kind: 'TOUCHPOINT', channel: 'WALK_IN', outcome: 'NO_ANSWER' }, 'ติดต่อทางหน้าร้าน: ไม่รับสาย', null],
  [{ kind: 'TOUCHPOINT', channel: 'OTHER', outcome: 'THINKING' }, 'ติดต่อทางอื่น ๆ: ขอคิดก่อน', null],
  [{ kind: 'TOUCHPOINT', channel: null, outcome: 'toString' }, 'ติดต่อทางอื่น ๆ: บันทึกแล้ว', null],
  [{ kind: 'HEARD_FROM', heardFrom: 'WALK_BY' }, 'ลูกค้าบอกว่ารู้จักร้านจากผ่านหน้าร้าน', null],
  [{ kind: 'HEARD_FROM', heardFrom: 'RADIO' }, 'ลูกค้าบอกว่ารู้จักร้านจากอื่น ๆ', null],
  [{ kind: 'MARKED_LOST', lostReason: 'CREDIT_FAILED' }, 'ติดป้ายหลุด: เครดิตไม่ผ่าน', null],
  [{ kind: 'MARKED_LOST', lostReason: null }, 'ติดป้ายหลุด: อื่น ๆ', null],
  [{ kind: 'REOPENED' }, 'เปิดใหม่', null],
];

describe('manualEntryToEvent — ตัวแปลงเดียวของรายการและคำตอบ POST journey/entries', () => {
  it.each(TITLES)('%j → "%s" ขั้น %s', (fields, title, stage) => {
    const event = manualEntryToEvent(row({ id: 'm1', ...fields }), OWNER, NOW);
    expect(event).toMatchObject({
      id: 'entry-m1',
      type: fields.kind,
      group: 'chat',
      stage,
      timestamp: '2026-09-14T03:00:00.000Z',
      title,
      actor: { type: 'STAFF', id: 'u1', name: 'แนน' },
      reliability: 'exact',
      origin: 'MANUAL',
    });
    expect(event).not.toHaveProperty('href');
    expect(event).not.toHaveProperty('metadata');
    expect(manualEntryTitle(row({ id: 'm1', ...fields }))).toBe(title);
  });

  it('ผู้กระทำจาก actorUser · actorType ไม่รู้จัก = SYSTEM · origin อื่น = SYSTEM_ENTRY · ลิงก์ห้องเฉพาะบทบาทที่เห็นแชท · ไม่มี note', () => {
    expect(manualEntryToEvent(row({ id: 'a', kind: 'REOPENED', actorUser: null }), OWNER, NOW).actor).toEqual({ type: 'STAFF' });
    expect(manualEntryToEvent(row({ id: 'b', kind: 'REOPENED', actorType: 'ROBOT', actorUser: null }), OWNER, NOW).actor).toEqual({ type: 'SYSTEM' });
    expect(manualEntryToEvent(row({ id: 'c', kind: 'REOPENED', origin: 'SYSTEM' }), OWNER, NOW).origin).toBe('SYSTEM_ENTRY');
    const inRoom = row({ id: 'd', kind: 'TOUCHPOINT', channel: 'FB_APP', outcome: 'THINKING', roomId: 'r1' });
    expect(manualEntryToEvent(inRoom, OWNER, NOW).href).toBe('/inbox/r1');
    const accountant = manualEntryToEvent(inRoom, { id: 'a1', role: 'ACCOUNTANT' }, NOW);
    expect(accountant).not.toHaveProperty('href');
    expect(accountant).not.toHaveProperty('note');
  });

  it('isManualEntryKind: เฉพาะ 4 kind ของบันทึกมือ', () => {
    expect(['TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'].every(isManualEntryKind)).toBe(true);
    expect(['CONTRACT_ACTIVATED', 'PLACEHOLDER_MERGED', 'NOTE'].some(isManualEntryKind)).toBe(false);
  });

  it('ทางรายการ (entries.source) ได้แถวเดียวกับตัวแปลงทุกช่อง — list กับคำตอบ POST หลุดจากกันไม่ได้', async () => {
    const rows = [
      row({ id: 't', kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'VISITED', occurredAt: new Date('2026-09-14T06:00:00.000Z') }),
      row({ id: 'h', kind: 'HEARD_FROM', heardFrom: 'TIKTOK', occurredAt: new Date('2026-09-14T05:00:00.000Z') }),
      row({ id: 'l', kind: 'MARKED_LOST', lostReason: 'UNREACHABLE', occurredAt: new Date('2026-09-14T04:00:00.000Z') }),
      row({ id: 'r', kind: 'REOPENED', occurredAt: new Date('2026-09-14T03:00:00.000Z') }),
    ];
    const prisma = {
      customerJourneyEntry: { findMany: jest.fn().mockResolvedValue(rows.map((r) => ({ ...r, refType: null, refId: null, data: null }))) },
      customerTag: { findMany: jest.fn().mockResolvedValue([]) },
      chatRoom: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const events = await entriesSourceFor(new Set<JourneyEventGroup>(['chat']))(prisma as unknown as PrismaService, ['c1'], { limit: 30 }, OWNER);
    expect(events).toEqual(rows.map((r) => manualEntryToEvent(r, OWNER, NOW)));
  });
});
```

- [ ] **Step 3: Run the mapper spec — expect it to fail**

```bash
(cd apps/api && npx jest src/modules/customer-journey/sources/manual-entry-event.spec.ts --runInBand)
```
Expected: FAIL — `Cannot find module './manual-entry-event' from 'modules/customer-journey/sources/manual-entry-event.spec.ts'` (or ts-jest `TS2307: Cannot find module './manual-entry-event'`).

- [ ] **Step 4: Implement the mapper**

Create `apps/api/src/modules/customer-journey/sources/manual-entry-event.ts`:

```ts
import {
  JOURNEY_ENTRY_KINDS,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_TOUCH_CHANNEL_LABELS,
  JOURNEY_TOUCH_OUTCOME_LABELS,
  type JourneyEvent,
  type JourneyManualEntryKind,
} from '@installment/shared';
import type { Prisma } from '@prisma/client';
import { asActorType, roleSeesGroup, type JourneyActor } from './journey-window';

/**
 * แถวบันทึกมือ (TOUCHPOINT · HEARD_FROM · MARKED_LOST · REOPENED) → JourneyEvent
 * ตัวแปลงเดียวของสองทาง: รายการ GET /customers/:id/journey (entries.source.ts) และคำตอบ POST /customers/:id/journey/entries
 * ⇒ ชื่อแถว ขั้น ผู้กระทำ ของสองทางหลุดจากกันไม่ได้ · ไม่มี note ทั้งใน select และในผลลัพธ์ (PDPA)
 */

/** select ของคำตอบ POST (create + ค้นแถวซ้ำด้วย dedupe_key) — createdAt = เวลาเขียนแถวของเซิร์ฟเวอร์ (ไม่ใช่ PII) · ห้ามเพิ่ม note */
export const MANUAL_ENTRY_EVENT_SELECT = {
  id: true,
  kind: true,
  origin: true,
  occurredAt: true,
  createdAt: true,
  actorType: true,
  roomId: true,
  channel: true,
  outcome: true,
  lostReason: true,
  heardFrom: true,
  actorUser: { select: { id: true, name: true } },
} satisfies Prisma.CustomerJourneyEntrySelect;

/** ช่องขั้นต่ำที่ตัวแปลงอ่าน — แถวจาก entries.source.ts (select กว้างกว่า) และจาก MANUAL_ENTRY_EVENT_SELECT เข้ารูปนี้ได้ทั้งคู่ */
export interface ManualEntryEventRow {
  id: string;
  kind: string;
  origin: string;
  occurredAt: Date;
  actorType: string;
  roomId: string | null;
  channel: string | null;
  outcome: string | null;
  lostReason: string | null;
  heardFrom: string | null;
  actorUser: { id: string; name: string } | null;
}

const MANUAL_KINDS: ReadonlySet<string> = new Set<string>(JOURNEY_ENTRY_KINDS.MANUAL);
export const isManualEntryKind = (kind: string): kind is JourneyManualEntryKind => MANUAL_KINDS.has(kind);

/** รหัสจากคอลัมน์ VARCHAR ที่ไม่มีในชุดป้าย (รวมคีย์ของ prototype เช่น toString) → คำกลาง · ห้ามแสดงรหัสดิบ */
function labelOf(labels: Readonly<Record<string, string>>, code: string | null, fallback: string): string {
  return code !== null && Object.prototype.hasOwnProperty.call(labels, code) ? labels[code] : fallback;
}

/** ชื่อแถว — ต่อคำตรง ๆ ตามที่ส่งแล้ว (ไม่มีช่องว่างหลัง "ทาง" / "จาก") ตรงกับกระดาน TimelineRows */
export function manualEntryTitle(row: Pick<ManualEntryEventRow, 'kind' | 'channel' | 'outcome' | 'lostReason' | 'heardFrom'>): string {
  if (row.kind === 'TOUCHPOINT') {
    return `ติดต่อทาง${labelOf(JOURNEY_TOUCH_CHANNEL_LABELS, row.channel, 'อื่น ๆ')}: ${labelOf(JOURNEY_TOUCH_OUTCOME_LABELS, row.outcome, 'บันทึกแล้ว')}`;
  }
  if (row.kind === 'HEARD_FROM') return `ลูกค้าบอกว่ารู้จักร้านจาก${labelOf(JOURNEY_HEARD_FROM_LABELS, row.heardFrom, 'อื่น ๆ')}`;
  if (row.kind === 'MARKED_LOST') return `ติดป้ายหลุด: ${labelOf(JOURNEY_LOST_REASON_LABELS, row.lostReason, 'อื่น ๆ')}`;
  return 'เปิดใหม่'; // REOPENED — kind มือที่เหลือ (ผู้เรียกกรองด้วย isManualEntryKind แล้ว)
}

/**
 * actor = ผู้ขอ (บทบาทตัดสินลิงก์ห้องแชท — ACCOUNTANT ไม่ได้ลิงก์) · now = เวลาของคำขอ (Task 8 ใช้คำนวณหน้าต่างเลิกทำ)
 * กลุ่ม chat ทุก kind · ขั้น INTERESTED เฉพาะ TOUCHPOINT นัดแล้ว/มาร้านแล้ว · ไม่มี metadata (JOURNEY_DATA_SCHEMAS ของ kind มือเป็น noData)
 */
export function manualEntryToEvent(row: ManualEntryEventRow, actor: JourneyActor, now: Date): JourneyEvent {
  const type = asActorType(row.actorType);
  const href = row.roomId && roleSeesGroup(actor.role, 'chat') ? `/inbox/${row.roomId}` : undefined;
  return {
    id: `entry-${row.id}`,
    type: row.kind,
    group: 'chat',
    stage: row.kind === 'TOUCHPOINT' && (row.outcome === 'APPOINTED' || row.outcome === 'VISITED') ? 'INTERESTED' : null,
    timestamp: row.occurredAt.toISOString(),
    title: manualEntryTitle(row),
    actor: row.actorUser ? { type, id: row.actorUser.id, name: row.actorUser.name } : { type },
    reliability: 'exact',
    origin: row.origin === 'MANUAL' ? 'MANUAL' : 'SYSTEM_ENTRY',
    ...(href ? { href } : {}),
  };
}
```

- [ ] **Step 5: Run the mapper spec — expect it to pass**

```bash
(cd apps/api && npx jest src/modules/customer-journey/sources/manual-entry-event.spec.ts --runInBand)
```
Expected: PASS — `Tests: 14 passed, 14 total`. The parity test already passes against the old inline code because the titles are byte-identical. It keeps guarding the list path after entries.source switches to the mapper in Step 6.

- [ ] **Step 6: Make entries.source.ts build manual rows through the mapper**

In `apps/api/src/modules/customer-journey/sources/entries.source.ts`:

(a) Replace the `@installment/shared` import. After Task 1 it reads:

```ts
import {
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_TOUCH_CHANNEL_LABELS,
  JOURNEY_TOUCH_OUTCOME_LABELS,
  type JourneyEntryKind,
  type JourneyEvent,
  type JourneyEventGroup,
  type JourneyStage,
} from '@installment/shared';
```

Replace it with:

```ts
import {
  JOURNEY_EVENT_GROUPS,
  type JourneyEntryKind,
  type JourneyEvent,
  type JourneyEventGroup,
  type JourneyStage,
} from '@installment/shared';
```

(b) Directly under the existing `import { asActorType, asRecord, dbTimeRange, … } from './journey-window';` line, add:

```ts
import { isManualEntryKind, manualEntryToEvent } from './manual-entry-event';
```

(c) After the `VIEWS` constant, Task 1 left three lines:

```ts
// ป้ายช่องทาง / ผล / รู้จักร้านจาก / เหตุผลหลุด = label map ของ shared ชุดเดียวกับ summary และเว็บ (ห้ามประกาศซ้ำในไฟล์นี้)
/** อ่านป้ายด้วยรหัสจากคอลัมน์ VARCHAR — ไม่มีในชุด = undefined ให้ผู้เรียกใช้คำกลางเอง (ไม่แสดงรหัสดิบ) */
const labelOf = (labels: Readonly<Record<string, string>>, code: string | null): string | undefined => labels[code ?? ''];
```

Replace them with:

```ts
// ชื่อแถวบันทึกมือ (ติดต่อ / รู้จักร้านจาก / ติดป้ายหลุด / เปิดใหม่) อยู่ที่ manual-entry-event.ts ที่เดียว — คำตอบ POST journey/entries ใช้ตัวแปลงเดียวกัน
```

(d) Replace the block that starts at `    const seesChat = roleSeesGroup(actor.role, 'chat');` and ends at the closing `    }` of `for (const row of rows) { … }` (the line just before `    for (const tag of tags) {`). After Task 1 that block reads:

```ts
    const seesChat = roleSeesGroup(actor.role, 'chat');
    const events: JourneyEvent[] = [];

    for (const row of rows) {
      const kind = row.kind;
      // DB กรอง kind แล้ว — ตรวจกลุ่มซ้ำฝั่งโค้ด · kind ที่ยังไม่มีใน VIEWS ถูกทิ้ง
      if (!isShownKind(kind) || !groups.has(VIEWS[kind].group) || (row.roomId && visibleRooms && !visibleRooms.has(row.roomId))) continue;
      const data = whitelisted(kind, row.data);
      const title = kind === 'TOUCHPOINT' ? `ติดต่อทาง${labelOf(JOURNEY_TOUCH_CHANNEL_LABELS, row.channel) ?? 'อื่น ๆ'}: ${labelOf(JOURNEY_TOUCH_OUTCOME_LABELS, row.outcome) ?? 'บันทึกแล้ว'}`
        : kind === 'HEARD_FROM' ? `ลูกค้าบอกว่ารู้จักร้านจาก${JOURNEY_HEARD_FROM_LABELS[row.heardFrom ?? ''] ?? 'อื่น ๆ'}`
        : kind === 'MARKED_LOST' ? `ติดป้ายหลุด: ${JOURNEY_LOST_REASON_LABELS[row.lostReason ?? ''] ?? 'อื่น ๆ'}`
        : kind === 'PLACEHOLDER_MERGED' && typeof data?.roomCount === 'number' ? `รวมประวัติแชท ${data.roomCount} ห้องเข้ากับลูกค้าคนนี้`
        : VIEWS[kind].title;
      const href = row.refType === 'contract' && row.refId ? `/contracts/${row.refId}` : row.roomId && seesChat ? `/inbox/${row.roomId}` : undefined;
      const type = asActorType(row.actorType);
      events.push({
        id: `entry-${row.id}`, type: kind, group: VIEWS[kind].group,
        stage: kind === 'TOUCHPOINT' && (row.outcome === 'APPOINTED' || row.outcome === 'VISITED') ? 'INTERESTED' : VIEWS[kind].stage,
        timestamp: row.occurredAt.toISOString(), title,
        actor: row.actorUser ? { type, id: row.actorUser.id, name: row.actorUser.name } : { type },
        reliability: 'exact', origin: row.origin === 'MANUAL' ? 'MANUAL' : 'SYSTEM_ENTRY',
        ...(href ? { href } : {}), ...(data ? { metadata: data } : {}),
      });
    }
```

Replace it with:

```ts
    const seesChat = roleSeesGroup(actor.role, 'chat');
    const events: JourneyEvent[] = [];
    const now = new Date();

    for (const row of rows) {
      const kind = row.kind;
      // DB กรอง kind แล้ว — ตรวจกลุ่มซ้ำฝั่งโค้ด · kind ที่ยังไม่มีใน VIEWS ถูกทิ้ง
      if (!isShownKind(kind) || !groups.has(VIEWS[kind].group) || (row.roomId && visibleRooms && !visibleRooms.has(row.roomId))) continue;
      // บันทึกมือ — ตัวแปลงเดียวกับคำตอบ POST /customers/:id/journey/entries (ห้ามสร้างชื่อแถวซ้ำที่นี่)
      if (isManualEntryKind(kind)) {
        events.push(manualEntryToEvent(row, actor, now));
        continue;
      }
      const data = whitelisted(kind, row.data);
      const title = kind === 'PLACEHOLDER_MERGED' && typeof data?.roomCount === 'number' ? `รวมประวัติแชท ${data.roomCount} ห้องเข้ากับลูกค้าคนนี้` : VIEWS[kind].title;
      const href = row.refType === 'contract' && row.refId ? `/contracts/${row.refId}` : row.roomId && seesChat ? `/inbox/${row.roomId}` : undefined;
      const type = asActorType(row.actorType);
      events.push({
        id: `entry-${row.id}`, type: kind, group: VIEWS[kind].group, stage: VIEWS[kind].stage,
        timestamp: row.occurredAt.toISOString(), title,
        actor: row.actorUser ? { type, id: row.actorUser.id, name: row.actorUser.name } : { type },
        reliability: 'exact', origin: row.origin === 'MANUAL' ? 'MANUAL' : 'SYSTEM_ENTRY',
        ...(href ? { href } : {}), ...(data ? { metadata: data } : {}),
      });
    }
```

- [ ] **Step 7: Run the entries and mapper specs, then confirm no label map is left in entries.source.ts**

```bash
(cd apps/api && npx jest src/modules/customer-journey/sources/entries.source.spec.ts src/modules/customer-journey/sources/manual-entry-event.spec.ts --runInBand)
grep -n "labelOf\|TOUCH_CHANNEL\|OUTCOME_LABELS\|HEARD_FROM_LABELS\|LOST_REASON_LABELS" apps/api/src/modules/customer-journey/sources/entries.source.ts
```
Expected:
- Both specs PASS.
  - `entries.source.spec.ts`: 4 passed, including Task 1's 53-row title characterization test.
  - `manual-entry-event.spec.ts`: 14 passed.
- `grep` prints nothing (exit 1).

- [ ] **Step 8: Write the failing DTO spec**

Create `apps/api/src/modules/customer-journey/dto/create-journey-entry.dto.spec.ts`:

```ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateJourneyEntryDto } from './create-journey-entry.dto';

const REQUEST_ID = '3f8e2b1c-6d4a-4f7e-9b2a-1c5d8e7f9a0b';

/** เหมือน ValidationPipe ของ app.setup.ts: whitelist เปิด · forbidNonWhitelisted ปิด */
async function check(plain: Record<string, unknown>) {
  const dto = plainToInstance(CreateJourneyEntryDto, plain, { enableImplicitConversion: true });
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors: Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})])) };
}

describe('CreateJourneyEntryDto — บันทึกมือแตะเดียว (ขอบเขต v2: ไม่มี note / occurredAt / roomId)', () => {
  it.each([
    { kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED', clientRequestId: REQUEST_ID },
    { kind: 'TOUCHPOINT', channel: 'WALK_IN', outcome: 'NOT_INTERESTED' },
    { kind: 'HEARD_FROM', heardFrom: 'OLD_CUSTOMER' },
    { kind: 'MARKED_LOST', lostReason: 'UNREACHABLE', clientRequestId: REQUEST_ID },
    { kind: 'REOPENED' },
  ])('%j ผ่าน', async (plain) => {
    expect((await check(plain)).errors).toEqual({});
  });

  it.each([
    ['kind ไม่รู้จัก', { kind: 'NOTE' }, { kind: ['ชนิดรายการไม่ถูกต้อง'] }],
    ['kind ของระบบ', { kind: 'CONTRACT_ACTIVATED' }, { kind: ['ชนิดรายการไม่ถูกต้อง'] }],
    ['ช่องทาง OTHER (กดไม่ได้ · มีแค่ป้ายของแถวเก่า)', { kind: 'TOUCHPOINT', channel: 'OTHER', outcome: 'APPOINTED' }, { channel: ['กรุณาเลือกช่องทาง'] }],
    ['ไม่มีช่องทาง', { kind: 'TOUCHPOINT', outcome: 'APPOINTED' }, { channel: ['กรุณาเลือกช่องทาง'] }],
    ['ไม่มีผล', { kind: 'TOUCHPOINT', channel: 'PHONE' }, { outcome: ['กรุณาเลือกผลการติดต่อ'] }],
    ['ผลไม่รู้จัก', { kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'CALL_BACK' }, { outcome: ['กรุณาเลือกผลการติดต่อ'] }],
    ['ติดป้ายหลุดไม่มีเหตุผล', { kind: 'MARKED_LOST' }, { lostReason: ['กรุณาเลือกเหตุผล'] }],
    ['เหตุผลไม่รู้จัก', { kind: 'MARKED_LOST', lostReason: 'TOO_EXPENSIVE' }, { lostReason: ['กรุณาเลือกเหตุผล'] }],
    ['รู้จักร้านจากช่องทางไม่รู้จัก', { kind: 'HEARD_FROM', heardFrom: 'RADIO' }, { heardFrom: ['กรุณาเลือกช่องทางที่รู้จักร้าน'] }],
    ['clientRequestId ไม่ใช่ UUID', { kind: 'REOPENED', clientRequestId: 'tap-1' }, { clientRequestId: ['รหัสคำขอไม่ถูกต้อง'] }],
    ['clientRequestId เป็น UUID v1', { kind: 'REOPENED', clientRequestId: 'a8098c1a-f86e-11da-bd1a-00112444be1e' }, { clientRequestId: ['รหัสคำขอไม่ถูกต้อง'] }],
  ])('%s → 400 ข้อความไทยที่ช่องนั้นช่องเดียว', async (_label, plain, expected) => {
    expect((await check(plain)).errors).toEqual(expected);
  });

  it('note · occurredAt · roomId ถูก whitelist ตัดทิ้งโดยไม่ error · ช่องของ kind อื่นไม่ถูกตรวจ (service เป็นคนไม่เขียน)', async () => {
    const { dto, errors } = await check({
      kind: 'TOUCHPOINT',
      channel: 'FB_APP',
      outcome: 'THINKING',
      note: 'โทร 0899999999',
      occurredAt: '2026-09-01T03:00:00.000Z',
      roomId: REQUEST_ID,
      lostReason: 'ไม่ใช่รหัส',
    });
    expect(errors).toEqual({});
    expect(dto).not.toHaveProperty('note');
    expect(dto).not.toHaveProperty('occurredAt');
    expect(dto).not.toHaveProperty('roomId');
    expect(dto).toMatchObject({ kind: 'TOUCHPOINT', channel: 'FB_APP', outcome: 'THINKING', lostReason: 'ไม่ใช่รหัส' });
  });
});
```

- [ ] **Step 9: Run the DTO spec — expect it to fail**

```bash
(cd apps/api && npx jest src/modules/customer-journey/dto/create-journey-entry.dto.spec.ts --runInBand)
```
Expected: FAIL — `Cannot find module './create-journey-entry.dto'`.

- [ ] **Step 10: Implement the DTO**

Create `apps/api/src/modules/customer-journey/dto/create-journey-entry.dto.ts`:

```ts
import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import {
  JOURNEY_ENTRY_KINDS,
  JOURNEY_HEARD_FROM_CODES,
  JOURNEY_LOST_REASONS,
  JOURNEY_RECORDABLE_TOUCH_CHANNELS,
  JOURNEY_TOUCH_OUTCOMES,
  type JourneyHeardFrom,
  type JourneyLostReason,
  type JourneyManualEntryKind,
  type JourneyRecordableTouchChannel,
  type JourneyTouchOutcome,
} from '@installment/shared';

/**
 * POST /customers/:id/journey/entries — บันทึกมือแตะเดียว (ขอบเขต v2 คำตัดสินเจ้าของ 2026-09-15 ข้อ 4 และ 12)
 * ไม่มี note / occurredAt / roomId: ValidationPipe (whitelist) ตัดคีย์ที่ไม่มี decorator ทิ้ง · เวลาเป็นเวลาเซิร์ฟเวอร์เสมอ
 * ช่องของ kind อื่นที่ส่งมา (ValidateIf เป็นเท็จ) ไม่ถูกตรวจแต่ก็ไม่ถูกตัด ⇒ JourneyManualEntryService เขียนเฉพาะคอลัมน์ของ kind นั้น
 */
export class CreateJourneyEntryDto {
  @IsIn([...JOURNEY_ENTRY_KINDS.MANUAL], { message: 'ชนิดรายการไม่ถูกต้อง' })
  kind!: JourneyManualEntryKind;

  /** 4 ช่องทางที่พนักงานกดได้ — OTHER คงไว้เฉพาะป้ายของแถวเก่า */
  @ValidateIf((o: CreateJourneyEntryDto) => o.kind === 'TOUCHPOINT')
  @IsIn([...JOURNEY_RECORDABLE_TOUCH_CHANNELS], { message: 'กรุณาเลือกช่องทาง' })
  channel?: JourneyRecordableTouchChannel;

  @ValidateIf((o: CreateJourneyEntryDto) => o.kind === 'TOUCHPOINT')
  @IsIn([...JOURNEY_TOUCH_OUTCOMES], { message: 'กรุณาเลือกผลการติดต่อ' })
  outcome?: JourneyTouchOutcome;

  /** ชิปเหตุผลอย่างเดียว ไม่มีโน้ต */
  @ValidateIf((o: CreateJourneyEntryDto) => o.kind === 'MARKED_LOST')
  @IsIn([...JOURNEY_LOST_REASONS], { message: 'กรุณาเลือกเหตุผล' })
  lostReason?: JourneyLostReason;

  @ValidateIf((o: CreateJourneyEntryDto) => o.kind === 'HEARD_FROM')
  @IsIn([...JOURNEY_HEARD_FROM_CODES], { message: 'กรุณาเลือกช่องทางที่รู้จักร้าน' })
  heardFrom?: JourneyHeardFrom;

  /** UUID v4 ใหม่ทุกครั้งที่แตะ (เว็บใช้ uid()) ส่งซ้ำเฉพาะตอน retry ⇒ dedupe_key MANUAL:<kind>:<clientRequestId> */
  @IsOptional()
  @IsUUID('4', { message: 'รหัสคำขอไม่ถูกต้อง' })
  clientRequestId?: string;
}
```

- [ ] **Step 11: Run the DTO spec — expect it to pass**

```bash
(cd apps/api && npx jest src/modules/customer-journey/dto/create-journey-entry.dto.spec.ts --runInBand)
```
Expected: PASS — `Tests: 17 passed, 17 total`.

- [ ] **Step 12: Write the failing service unit spec**

Create `apps/api/src/modules/customer-journey/journey-manual-entry.service.spec.ts`:

```ts
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import type { JourneySummary } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';
import { JOURNEY_NOT_RECORDED } from './customer-journey.service';
import type { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyManualEntryService } from './journey-manual-entry.service';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';
import { MANUAL_ENTRY_EVENT_SELECT } from './sources/manual-entry-event';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const ACTOR = { id: 'u1', role: 'SALES' };
const STAFF = { id: 'u1', name: 'พนักงานสเปค' };
const REQUEST_ID = '3f8e2b1c-6d4a-4f7e-9b2a-1c5d8e7f9a0b';
const EARLIER = new Date('2026-09-15T04:59:00.000Z');

interface CustomerRow { id: string; deletedAt: Date | null; mergedIntoId: string | null }
const live = (id: string): CustomerRow => ({ id, deletedAt: null, mergedIntoId: null });
const merged = (id: string, into: string): CustomerRow => ({ id, deletedAt: EARLIER, mergedIntoId: into });
const summaryOf = (over: Record<string, unknown> = {}) => ({ stage: 'IDENTIFIED', lost: null, heardFrom: null, askHeardFrom: true, ...over }) as unknown as JourneySummary;
/** แถวที่ findUnique(dedupe_key) คืน — มี customerId/deletedAt · createdAt เผื่อหน้าต่างเลิกทำ */
const entryRow = (over: Record<string, unknown> = {}) => ({
  id: 'e0', customerId: 'c1', deletedAt: null, kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: EARLIER, createdAt: EARLIER,
  actorType: 'STAFF', roomId: null, channel: 'PHONE', outcome: 'THINKING', lostReason: null, heardFrom: null, actorUser: STAFF, ...over,
});
const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`dedupe_key`)', { code: 'P2002', clientVersion: 'test', meta: { target: ['dedupe_key'] } });

function setup(customers: CustomerRow[] = [live('c1')]) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const prisma = {
    customer: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: { where: { mergedIntoId: string } }) => customers.filter((c) => c.mergedIntoId === where.mergedIntoId).map((c) => ({ id: c.id }))),
      count: jest.fn().mockResolvedValue(0),
    },
    customerJourneyEntry: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown>; select?: unknown }) => ({
        id: 'e1', kind: data.kind, origin: data.origin, occurredAt: data.occurredAt, createdAt: data.occurredAt, actorType: data.actorType,
        roomId: data.roomId, channel: data.channel, outcome: data.outcome, lostReason: data.lostReason, heardFrom: data.heardFrom, actorUser: STAFF,
      })),
    },
  };
  const state = { recompute: jest.fn().mockResolvedValue(undefined) };
  const summaries = { summary: jest.fn().mockResolvedValue(summaryOf()) };
  const service = new JourneyManualEntryService(prisma as unknown as PrismaService, state as unknown as JourneyStateService, summaries as unknown as JourneySummaryService);
  return { prisma, state, summaries, service };
}
const dto = (plain: Record<string, unknown>) => plain as unknown as CreateJourneyEntryDto;

describe('JourneyManualEntryService.create — POST /customers/:id/journey/entries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('TOUCHPOINT: แถว MANUAL เวลาเซิร์ฟเวอร์ · note/roomId/คอลัมน์ของ kind อื่นเป็น null · ไม่ตรวจการซื้อ · เขียน → recompute → summary', async () => {
    const { prisma, state, summaries, service } = setup();
    const summary = summaryOf({ stage: 'INTERESTED' });
    summaries.summary.mockResolvedValue(summary);
    // เรียกตรง (ไม่ผ่าน ValidationPipe) พร้อมคีย์ที่ DTO ไม่มี + คอลัมน์ของ kind อื่น — service ต้องไม่เขียน
    const body = dto({
      kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED', lostReason: 'NOT_INTERESTED', heardFrom: 'FRIEND', clientRequestId: REQUEST_ID,
      note: 'โทร 0899999999', roomId: 'r1', occurredAt: '2020-01-01T00:00:00.000Z',
    });
    const before = Date.now();
    const res = await service.create('c1', body, ACTOR);

    const call = prisma.customerJourneyEntry.create.mock.calls[0][0];
    expect(call.select).toBe(MANUAL_ENTRY_EVENT_SELECT);
    expect(call.data).toEqual({
      customerId: 'c1', originCustomerId: 'c1', origin: 'MANUAL', kind: 'TOUCHPOINT', occurredAt: expect.any(Date),
      actorType: 'STAFF', actorUserId: 'u1', roomId: null, refType: null, refId: null, note: null,
      channel: 'PHONE', outcome: 'APPOINTED', lostReason: null, heardFrom: null, dedupeKey: `MANUAL:TOUCHPOINT:${REQUEST_ID}`,
    });
    const occurredAt = call.data.occurredAt as Date;
    expect(occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(prisma.customer.count).not.toHaveBeenCalled();
    expect(state.recompute).toHaveBeenCalledWith(['c1']);
    expect(summaries.summary).toHaveBeenCalledWith('c1', ACTOR);
    expect(prisma.customerJourneyEntry.create.mock.invocationCallOrder[0]).toBeLessThan(state.recompute.mock.invocationCallOrder[0]);
    expect(state.recompute.mock.invocationCallOrder[0]).toBeLessThan(summaries.summary.mock.invocationCallOrder[0]);
    expect(res).toMatchObject({
      entryId: 'e1',
      event: {
        id: 'entry-e1', type: 'TOUCHPOINT', group: 'chat', stage: 'INTERESTED', timestamp: occurredAt.toISOString(),
        title: 'ติดต่อทางโทร: นัดแล้ว', actor: { type: 'STAFF', id: 'u1', name: 'พนักงานสเปค' }, reliability: 'exact', origin: 'MANUAL',
      },
      summary,
    });
    expect(res.event).not.toHaveProperty('href');
    expect(JSON.stringify(res)).not.toContain('0899999999');
  });

  it('HEARD_FROM ไม่มี clientRequestId → dedupeKey null · ไม่ค้นแถวซ้ำ · เขียนเฉพาะ heardFrom', async () => {
    const { prisma, service } = setup();
    const res = await service.create('c1', dto({ kind: 'HEARD_FROM', heardFrom: 'FRIEND' }), ACTOR);
    expect(prisma.customerJourneyEntry.findUnique).not.toHaveBeenCalled();
    expect(prisma.customerJourneyEntry.create.mock.calls[0][0].data).toMatchObject({ kind: 'HEARD_FROM', heardFrom: 'FRIEND', channel: null, outcome: null, lostReason: null, dedupeKey: null });
    expect(res.event).toMatchObject({ type: 'HEARD_FROM', stage: null, title: 'ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ' });
  });

  it('id ของ placeholder ที่รวมแล้ว → เขียน คำนวณ และอ่านแถบขั้นที่ลูกค้าจริง', async () => {
    const { prisma, state, summaries, service } = setup([live('c1'), merged('p1', 'c1')]);
    await service.create('p1', dto({ kind: 'TOUCHPOINT', channel: 'LINE_APP', outcome: 'THINKING' }), ACTOR);
    expect(prisma.customerJourneyEntry.create.mock.calls[0][0].data).toMatchObject({ customerId: 'c1', originCustomerId: 'c1' });
    expect(prisma.customer.findMany).toHaveBeenCalledWith({ where: { mergedIntoId: 'c1' }, select: { id: true } });
    expect(state.recompute).toHaveBeenCalledWith(['c1']);
    expect(summaries.summary).toHaveBeenCalledWith('c1', ACTOR);
  });

  it.each([
    ['ไม่มีลูกค้านี้', [live('c1')], 'missing'],
    ['ลบด้วยเหตุอื่น (ไม่มี mergedIntoId)', [{ id: 'd1', deletedAt: EARLIER, mergedIntoId: null }], 'd1'],
    ['ลูกค้าปลายทางถูกลบแล้ว', [{ id: 'c1', deletedAt: EARLIER, mergedIntoId: null }, merged('p1', 'c1')], 'p1'],
  ] as Array<[string, CustomerRow[], string]>)('%s → 404 ไม่พบลูกค้า · ไม่เขียน', async (_label, customers, id) => {
    const { prisma, service } = setup(customers);
    const attempt = service.create(id, dto({ kind: 'REOPENED' }), ACTOR);
    await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    await expect(attempt).rejects.toThrow('ไม่พบลูกค้า');
    expect(prisma.customerJourneyEntry.create).not.toHaveBeenCalled();
  });

  it('MARKED_LOST กับลูกค้าที่ซื้อแล้ว (BOUGHT_WHERE สด) → 409 · ไม่เขียน', async () => {
    const { prisma, service } = setup();
    prisma.customer.count.mockResolvedValue(1);
    const attempt = service.create('c1', dto({ kind: 'MARKED_LOST', lostReason: 'BOUGHT_ELSEWHERE' }), ACTOR);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow('ลูกค้ารายนี้ซื้อแล้ว ติดป้ายหลุดไม่ได้');
    expect(prisma.customer.count).toHaveBeenCalledWith({ where: { AND: [{ id: 'c1' }, BOUGHT_WHERE] } });
    expect(prisma.customerJourneyEntry.create).not.toHaveBeenCalled();
  });

  it('MARKED_LOST ตอนหลุดอยู่แล้ว → เขียนได้ (เปลี่ยนเหตุผล · Q4) · ไม่อ่าน summary ก่อนเขียน', async () => {
    const { prisma, summaries, service } = setup();
    summaries.summary.mockResolvedValue(summaryOf({ lost: { at: EARLIER.toISOString(), reason: 'NOT_INTERESTED' } }));
    const res = await service.create('c1', dto({ kind: 'MARKED_LOST', lostReason: 'UNREACHABLE' }), ACTOR);
    expect(prisma.customerJourneyEntry.create.mock.calls[0][0].data).toMatchObject({ kind: 'MARKED_LOST', lostReason: 'UNREACHABLE', channel: null, outcome: null, heardFrom: null });
    expect(summaries.summary).toHaveBeenCalledTimes(1);
    expect(res.event).toMatchObject({ title: 'ติดป้ายหลุด: ติดต่อไม่ได้', stage: null });
  });

  it('REOPENED ตอนไม่หลุด → ไม่เขียน · { entryId: null, event: null, summary } · คำนวณแคชก่อนอ่าน lost', async () => {
    const { prisma, state, summaries, service } = setup();
    const summary = summaryOf({ lost: null });
    summaries.summary.mockResolvedValue(summary);
    await expect(service.create('c1', dto({ kind: 'REOPENED' }), ACTOR)).resolves.toEqual({ entryId: null, event: null, summary });
    expect(prisma.customerJourneyEntry.create).not.toHaveBeenCalled();
    expect(state.recompute).toHaveBeenCalledTimes(1);
    expect(state.recompute.mock.invocationCallOrder[0]).toBeLessThan(summaries.summary.mock.invocationCallOrder[0]);
  });

  it('REOPENED ตอนหลุด → เขียนแถว "เปิดใหม่" แล้วคืน summary หลังคำนวณใหม่', async () => {
    const { prisma, state, summaries, service } = setup();
    const after = summaryOf({ lost: null });
    summaries.summary.mockResolvedValueOnce(summaryOf({ lost: { at: EARLIER.toISOString(), reason: 'OTHER' } })).mockResolvedValueOnce(after);
    const res = await service.create('c1', dto({ kind: 'REOPENED' }), ACTOR);
    expect(prisma.customerJourneyEntry.create.mock.calls[0][0].data).toMatchObject({ kind: 'REOPENED', channel: null, outcome: null, lostReason: null, heardFrom: null });
    expect(res).toMatchObject({ entryId: 'e1', event: { type: 'REOPENED', title: 'เปิดใหม่', stage: null }, summary: after });
    expect(state.recompute).toHaveBeenCalledTimes(2);
  });

  it('clientRequestId ที่เคยบันทึกแล้ว → คืนแถวเดิม ไม่เขียนแถวที่สอง ไม่ recompute · ตรวจก่อนกติกา kind (retry หลังลูกค้าซื้อได้ผลเดิม)', async () => {
    const { prisma, state, summaries, service } = setup();
    prisma.customerJourneyEntry.findUnique.mockResolvedValue(entryRow({ kind: 'MARKED_LOST', channel: null, outcome: null, lostReason: 'BOUGHT_ELSEWHERE' }));
    prisma.customer.count.mockResolvedValue(1);
    const summary = summaryOf();
    summaries.summary.mockResolvedValue(summary);
    const res = await service.create('c1', dto({ kind: 'MARKED_LOST', lostReason: 'BOUGHT_ELSEWHERE', clientRequestId: REQUEST_ID }), ACTOR);
    expect(prisma.customerJourneyEntry.findUnique).toHaveBeenCalledWith({
      where: { dedupeKey: `MANUAL:MARKED_LOST:${REQUEST_ID}` },
      select: { ...MANUAL_ENTRY_EVENT_SELECT, customerId: true, deletedAt: true },
    });
    expect(prisma.customerJourneyEntry.create).not.toHaveBeenCalled();
    expect(prisma.customer.count).not.toHaveBeenCalled();
    expect(state.recompute).not.toHaveBeenCalled();
    expect(res).toMatchObject({ entryId: 'e0', event: { id: 'entry-e0', timestamp: EARLIER.toISOString(), title: 'ติดป้ายหลุด: ซื้อที่อื่น' }, summary });
  });

  it.each([
    ['ถูกเลิกทำแล้ว', { deletedAt: EARLIER }],
    ['เป็นของลูกค้าคนอื่น', { customerId: 'someone-else' }],
  ])('clientRequestId ชนแถวที่%s → 409 ให้กดใหม่ · ไม่เขียน', async (_label, over) => {
    const { prisma, service } = setup();
    prisma.customerJourneyEntry.findUnique.mockResolvedValue(entryRow(over));
    const attempt = service.create('c1', dto({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'THINKING', clientRequestId: REQUEST_ID }), ACTOR);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง');
    expect(prisma.customerJourneyEntry.create).not.toHaveBeenCalled();
  });

  it('ยิงพร้อมกันจนชน unique ของ dedupe_key (P2002) → โหลดแถวที่ชนะมาคืน · ไม่ recompute ซ้ำ', async () => {
    const { prisma, state, service } = setup();
    prisma.customerJourneyEntry.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(entryRow({ id: 'e-winner' }));
    prisma.customerJourneyEntry.create.mockRejectedValueOnce(uniqueViolation());
    const res = await service.create('c1', dto({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'THINKING', clientRequestId: REQUEST_ID }), ACTOR);
    expect(res.entryId).toBe('e-winner');
    expect(prisma.customerJourneyEntry.create).toHaveBeenCalledTimes(1);
    expect(state.recompute).not.toHaveBeenCalled();
  });

  it('P2002 แต่หาแถวของ dedupe_key ไม่เจอ / ไม่มี clientRequestId → โยน error เดิม', async () => {
    const error = uniqueViolation();
    const withKey = setup();
    withKey.prisma.customerJourneyEntry.create.mockRejectedValueOnce(error);
    await expect(withKey.service.create('c1', dto({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'THINKING', clientRequestId: REQUEST_ID }), ACTOR)).rejects.toBe(error);
    const withoutKey = setup();
    withoutKey.prisma.customerJourneyEntry.create.mockRejectedValueOnce(error);
    await expect(withoutKey.service.create('c1', dto({ kind: 'HEARD_FROM', heardFrom: 'GOOGLE' }), ACTOR)).rejects.toBe(error);
    expect(withoutKey.prisma.customerJourneyEntry.findUnique).not.toHaveBeenCalled();
  });

  it('recompute ล้ม → คำขอยังสำเร็จ (แถวถูกเขียนแล้ว) · warn + Sentry op manual-entry-recompute', async () => {
    const { state, service } = setup();
    const err = new Error('db down');
    state.recompute.mockRejectedValue(err);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(service.create('c1', dto({ kind: 'TOUCHPOINT', channel: 'WALK_IN', outcome: 'VISITED' }), ACTOR)).resolves.toMatchObject({ entryId: 'e1' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(Sentry.captureException).toHaveBeenCalledWith(err, { tags: { kind: 'customer-journey', op: 'manual-entry-recompute' } });
  });

  it('summary ตอบ redirect (ถูกรวมระหว่างคำขอ) → ตามไปลูกค้าปลายทางหนึ่งชั้น', async () => {
    const { summaries, service } = setup();
    const moved = summaryOf({ stage: 'CONTACTED' });
    summaries.summary.mockResolvedValueOnce({ redirectToCustomerId: 'c9' }).mockResolvedValueOnce(moved);
    const res = await service.create('c1', dto({ kind: 'HEARD_FROM', heardFrom: 'TIKTOK' }), ACTOR);
    expect(summaries.summary).toHaveBeenLastCalledWith('c9', ACTOR);
    expect(res.summary).toBe(moved);
  });

  it('บันทึก "รู้จักร้านจากไหน" ได้แล้ว → ไม่อยู่ในรายการ "ระบบยังไม่เก็บ"', () => {
    expect(JOURNEY_NOT_RECORDED).not.toContain('ลูกค้าหน้าร้านรู้จักร้านจากไหน');
  });
});
```

- [ ] **Step 13: Write the real-DB spec**

Create `apps/api/src/modules/customer-journey/journey-manual-entry.db.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyManualEntryService } from './journey-manual-entry.service';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';

function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, keys));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.add(k); allKeys(v, keys); }
  return keys;
}

/**
 * POST /customers/:id/journey/entries กับ Postgres จริง — แถวที่เขียนต้องขยับแถบขั้น / ป้ายหลุด / รู้จักร้านจากไหน ในคำตอบเดียวกัน
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest src/modules/customer-journey/journey-manual-entry.db.spec.ts --runInBand (และ TZ=UTC แบบ CI)
 * ผู้ใช้ของ spec เป็น upsert อีเมลคงที่ (ใช้ซ้ำทุกรอบ) · service นี้ไม่เขียน audit_logs
 */
describe('JourneyManualEntryService.create (real DB)', () => {
  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  const state = new JourneyStateService(db);
  const summaries = new JourneySummaryService(db, state);
  const service = new JourneyManualEntryService(db, state, summaries);
  const STAFF_NAME = 'พนักงานสเปคบันทึกมือ';
  const stamp = Date.now();
  const customerIds: string[] = [];
  let actor: { id: string; role: string };

  const walkIn = async (label: string) => {
    const row = await prisma.customer.create({ data: { name: `manual entry spec ${label} ${stamp}` } });
    customerIds.push(row.id);
    return row.id;
  };
  const body = (plain: Record<string, unknown>) => plain as unknown as CreateJourneyEntryDto;

  beforeAll(async () => {
    const email = 'journey-manual-entry-spec@example.test';
    const user = await prisma.user.upsert({ where: { email }, update: { name: STAFF_NAME }, create: { email, password: 'journey-spec', name: STAFF_NAME, role: 'SALES' } });
    actor = { id: user.id, role: 'SALES' };
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
  });

  it('TOUCHPOINT นัดแล้ว → แถว MANUAL เวลาเซิร์ฟเวอร์ · แถบขั้นอยู่ นัด / จอง หลักฐาน MANUAL ในคำตอบเดียวกัน · ไม่มีคีย์ note', async () => {
    const id = await walkIn('touch');
    const before = Date.now();
    const res = await service.create(id, body({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED' }), actor);
    const after = Date.now();

    expect(res.summary.stage).toBe('INTERESTED');
    expect(res.summary.steps.find((s) => s.stage === 'INTERESTED')).toMatchObject({ state: 'current', evidence: 'MANUAL' });
    expect(res.event).toMatchObject({
      id: `entry-${res.entryId}`, type: 'TOUCHPOINT', group: 'chat', stage: 'INTERESTED', title: 'ติดต่อทางโทร: นัดแล้ว',
      origin: 'MANUAL', actor: { type: 'STAFF', id: actor.id, name: STAFF_NAME },
    });
    const row = await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: res.entryId! } });
    expect(row).toMatchObject({
      customerId: id, originCustomerId: id, origin: 'MANUAL', actorType: 'STAFF', actorUserId: actor.id,
      roomId: null, refType: null, refId: null, note: null, lostReason: null, heardFrom: null, dedupeKey: null,
    });
    expect(row.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.occurredAt.getTime()).toBeLessThanOrEqual(after);
    expect(allKeys(res).has('note')).toBe(false);
  });

  it('HEARD_FROM → heardFrom ในคำตอบ · askHeardFrom พลิกจาก true เป็น false', async () => {
    const id = await walkIn('heard');
    expect(await summaries.summary(id, actor)).toMatchObject({ firstSource: 'WALK_IN', heardFrom: null, askHeardFrom: true });
    const res = await service.create(id, body({ kind: 'HEARD_FROM', heardFrom: 'FRIEND' }), actor);
    expect(res.summary).toMatchObject({ heardFrom: 'FRIEND', askHeardFrom: false });
    expect(res.event).toMatchObject({ type: 'HEARD_FROM', stage: null, title: 'ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ' });
  });

  it('MARKED_LOST → ป้ายหลุดพร้อมเหตุผล · REOPENED → หลุดหาย · REOPENED ซ้ำตอนไม่หลุด = ไม่เขียนแถว', async () => {
    const id = await walkIn('lost');
    const lost = await service.create(id, body({ kind: 'MARKED_LOST', lostReason: 'BOUGHT_ELSEWHERE' }), actor);
    expect(lost.summary.lost).toEqual({ at: lost.event!.timestamp, reason: 'BOUGHT_ELSEWHERE' });
    expect(lost.event).toMatchObject({ title: 'ติดป้ายหลุด: ซื้อที่อื่น' });

    const reopened = await service.create(id, body({ kind: 'REOPENED' }), actor);
    expect(reopened.entryId).not.toBeNull();
    expect(reopened.summary.lost).toBeNull();
    expect(reopened.event).toMatchObject({ title: 'เปิดใหม่' });

    const again = await service.create(id, body({ kind: 'REOPENED' }), actor);
    expect(again).toMatchObject({ entryId: null, event: null, summary: { lost: null } });
    expect(await prisma.customerJourneyEntry.count({ where: { customerId: id, kind: 'REOPENED' } })).toBe(1);
  });

  it('id ของ placeholder ที่รวมแล้ว → แถวไปอยู่ที่ลูกค้าจริง และคำตอบเป็นแถบขั้นของลูกค้าจริง', async () => {
    const target = await walkIn('target');
    const placeholder = await prisma.customer.create({
      data: { name: `manual entry spec placeholder ${stamp}`, acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date(), mergedIntoId: target },
    });
    customerIds.push(placeholder.id);
    const res = await service.create(placeholder.id, body({ kind: 'TOUCHPOINT', channel: 'LINE_APP', outcome: 'THINKING' }), actor);
    expect(await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: res.entryId! } })).toMatchObject({ customerId: target, originCustomerId: target });
    expect(await prisma.customerJourneyState.findUnique({ where: { customerId: placeholder.id } })).toBeNull();
    expect(res.summary.lastTouchAt).toBe(res.event!.timestamp);
  });

  it('clientRequestId เดิม (ยิงพร้อมกัน + ยิงซ้ำ) → แถวเดียว entryId เดียว · ใช้กับลูกค้าอื่น / หลังเลิกทำ → 409', async () => {
    const id = await walkIn('dedupe');
    const clientRequestId = randomUUID();
    const tap = body({ kind: 'TOUCHPOINT', channel: 'FB_APP', outcome: 'NO_ANSWER', clientRequestId });
    const [first, second] = await Promise.all([service.create(id, tap, actor), service.create(id, tap, actor)]);
    const third = await service.create(id, tap, actor);
    expect(first.entryId).not.toBeNull();
    expect([second.entryId, third.entryId]).toEqual([first.entryId, first.entryId]);
    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: `MANUAL:TOUCHPOINT:${clientRequestId}` } })).toBe(1);

    const other = await walkIn('dedupe-other');
    const foreign = service.create(other, tap, actor);
    await expect(foreign).rejects.toBeInstanceOf(ConflictException);
    await expect(foreign).rejects.toThrow('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง');

    await prisma.customerJourneyEntry.update({ where: { id: first.entryId! }, data: { deletedAt: new Date(), deletedById: actor.id } });
    await expect(service.create(id, tap, actor)).rejects.toThrow('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง');
  });
});
```

- [ ] **Step 14: Run both service specs — expect them to fail**

```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-manual-entry.service.spec.ts src/modules/customer-journey/journey-manual-entry.db.spec.ts --runInBand)
```
Expected: FAIL (both suites) — `Cannot find module './journey-manual-entry.service'` (or ts-jest `TS2307`).

- [ ] **Step 15: Implement the service**

Create `apps/api/src/modules/customer-journey/journey-manual-entry.service.ts`:

```ts
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import type { JourneyEntryCreatedResponse, JourneyManualEntryKind, JourneyRedirect, JourneySummary } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';
import type { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';
import type { JourneyActor } from './sources/journey-window';
import { MANUAL_ENTRY_EVENT_SELECT, manualEntryToEvent, type ManualEntryEventRow } from './sources/manual-entry-event';

/** dedupe_key ของบันทึกมือ — มี kind ในคีย์: แตะ "ซื้อที่อื่น" แล้วกด "ใช่ ติดป้ายหลุด" เป็นคนละคำขอ ต้องไม่ชนกัน */
export const manualEntryDedupeKey = (kind: JourneyManualEntryKind, clientRequestId: string): string => `MANUAL:${kind}:${clientRequestId}`;

/** แถวที่เจอด้วย dedupe_key — ต้องรู้เจ้าของและสถานะเลิกทำก่อนคืน */
const DEDUPE_HIT_SELECT = { ...MANUAL_ENTRY_EVENT_SELECT, customerId: true, deletedAt: true } satisfies Prisma.CustomerJourneyEntrySelect;
type DedupeHit = ManualEntryEventRow & { customerId: string; deletedAt: Date | null };

const isRedirect = (value: JourneySummary | JourneyRedirect): value is JourneyRedirect => 'redirectToCustomerId' in value;
const isUniqueViolation = (err: unknown): boolean => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** คอลัมน์เฉพาะของ kind นั้น — ช่องของ kind อื่นที่หลุดมากับ body ไม่ถูกเขียน (ValidateIf ไม่ตัดทิ้ง) */
function kindColumns(dto: CreateJourneyEntryDto) {
  return {
    channel: dto.kind === 'TOUCHPOINT' ? (dto.channel ?? null) : null,
    outcome: dto.kind === 'TOUCHPOINT' ? (dto.outcome ?? null) : null,
    lostReason: dto.kind === 'MARKED_LOST' ? (dto.lostReason ?? null) : null,
    heardFrom: dto.kind === 'HEARD_FROM' ? (dto.heardFrom ?? null) : null,
  };
}

/**
 * บันทึกมือแบบแตะเดียว (POST /customers/:id/journey/entries) — ขอบเขต v2: ไม่มีโน้ต ไม่มีเปลี่ยนเวลา ไม่มี roomId
 * ไม่ใช้ JourneyEntryWriter (รับเฉพาะ SYSTEM + กลืน error) · ไม่มี $transaction: แถวเดียว และ recompute ต้องรันหลัง commit อยู่แล้ว
 */
@Injectable()
export class JourneyManualEntryService {
  private readonly logger = new Logger(JourneyManualEntryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journeyState: JourneyStateService,
    private readonly summaries: JourneySummaryService,
  ) {}

  async create(customerId: string, dto: CreateJourneyEntryDto, actor: JourneyActor): Promise<JourneyEntryCreatedResponse> {
    const { targetId, familyIds } = await this.resolveFamily(customerId);
    const dedupeKey = dto.clientRequestId ? manualEntryDedupeKey(dto.kind, dto.clientRequestId) : null;

    // retry ของคำขอที่สำเร็จไปแล้ว: คืนผลเดิมก่อนตรวจกติกา kind (สถานะลูกค้าอาจเปลี่ยนระหว่างรอบแรกกับรอบ retry)
    const previous = dedupeKey ? await this.findByDedupeKey(dedupeKey) : null;
    if (previous) return this.replay(previous, targetId, familyIds, actor);

    if (dto.kind === 'MARKED_LOST') {
      const bought = await this.prisma.customer.count({ where: { AND: [{ id: targetId }, BOUGHT_WHERE] } });
      if (bought > 0) throw new ConflictException('ลูกค้ารายนี้ซื้อแล้ว ติดป้ายหลุดไม่ได้');
    }
    if (dto.kind === 'REOPENED') {
      // "หลุด" คือค่าที่คำนวณแล้ว (ข้อความลูกค้า / การติดต่อ / เอกสารใหม่ล้างป้ายได้เอง) — คำนวณแคชก่อนอ่าน กันแคชค้างจาก recompute ที่เคยล้ม
      await this.recomputeQuietly(targetId);
      const current = await this.freshSummary(targetId, actor);
      if (current.lost === null) return { entryId: null, event: null, summary: current };
    }

    const now = new Date();
    let row: ManualEntryEventRow;
    try {
      row = await this.prisma.customerJourneyEntry.create({
        data: {
          customerId: targetId,
          originCustomerId: targetId,
          origin: 'MANUAL',
          kind: dto.kind,
          occurredAt: now,
          actorType: 'STAFF',
          actorUserId: actor.id,
          roomId: null,
          refType: null,
          refId: null,
          note: null,
          ...kindColumns(dto),
          dedupeKey,
        },
        select: MANUAL_ENTRY_EVENT_SELECT,
      });
    } catch (err) {
      // สองคำขอ clientRequestId เดียวกันผ่านด่านค้นพร้อมกัน — ตัวที่แพ้ unique คืนแถวของตัวที่ชนะ
      const winner = dedupeKey && isUniqueViolation(err) ? await this.findByDedupeKey(dedupeKey) : null;
      if (!winner) throw err;
      return this.replay(winner, targetId, familyIds, actor);
    }

    await this.recomputeQuietly(targetId);
    const event = manualEntryToEvent(row, actor, now);
    return { entryId: row.id, event, summary: await this.freshSummary(targetId, actor) };
  }

  /** placeholder ที่รวมแล้วเขียนไปที่ลูกค้าจริง — chain ถูกยุบเหลือชั้นเดียวตอนรวม · ครอบครัว = ลูกค้าจริง + placeholder ที่ชี้มา */
  private async resolveFamily(customerId: string): Promise<{ targetId: string; familyIds: string[] }> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, deletedAt: true, mergedIntoId: true } });
    const targetId = customer && !customer.deletedAt ? customer.id : (customer?.mergedIntoId ?? null);
    if (!targetId) throw new NotFoundException('ไม่พบลูกค้า');
    if (targetId !== customerId) {
      const target = await this.prisma.customer.findUnique({ where: { id: targetId }, select: { id: true, deletedAt: true, mergedIntoId: true } });
      if (!target || target.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
    }
    const absorbed = await this.prisma.customer.findMany({ where: { mergedIntoId: targetId }, select: { id: true } });
    return { targetId, familyIds: [targetId, ...absorbed.map((row) => row.id)] };
  }

  private findByDedupeKey(dedupeKey: string): Promise<DedupeHit | null> {
    return this.prisma.customerJourneyEntry.findUnique({ where: { dedupeKey }, select: DEDUPE_HIT_SELECT });
  }

  /** แถวของ clientRequestId เดิม — ถูกเลิกทำแล้ว / เป็นของครอบครัวอื่น = คำขอนี้ใช้ไปแล้วจริง (แตะใหม่ได้ UUID ใหม่ จึงกดใหม่ได้จริง) */
  private async replay(hit: DedupeHit, targetId: string, familyIds: string[], actor: JourneyActor): Promise<JourneyEntryCreatedResponse> {
    if (hit.deletedAt || !familyIds.includes(hit.customerId)) throw new ConflictException('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง');
    return { entryId: hit.id, event: manualEntryToEvent(hit, actor, new Date()), summary: await this.freshSummary(targetId, actor) };
  }

  /** ลูกค้าถูกรวมเข้าคนอื่นระหว่างคำขอ (การรวมย้ายแถว entries ตามไปแล้ว) — ตามได้ชั้นเดียวเพราะ chain ถูกยุบ */
  private async freshSummary(targetId: string, actor: JourneyActor): Promise<JourneySummary> {
    const summary = await this.summaries.summary(targetId, actor);
    if (!isRedirect(summary)) return summary;
    const moved = await this.summaries.summary(summary.redirectToCustomerId, actor);
    if (isRedirect(moved)) throw new NotFoundException('ไม่พบลูกค้า');
    return moved;
  }

  /** แคชต้องสดในคำตอบนี้ (summary ข้ามแคชที่อายุไม่เกิน 15 นาที) · ล้มแล้วคำขอไม่ล้ม — cron journey:recompute ซ่อมเอง */
  private async recomputeQuietly(targetId: string): Promise<void> {
    try {
      await this.journeyState.recompute([targetId]);
    } catch (err) {
      this.logger.warn(`journey manual entry recompute ล้ม customer=${targetId}: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'customer-journey', op: 'manual-entry-recompute' } });
    }
  }
}
```

- [ ] **Step 16: Drop the "not recorded" line that this endpoint now covers**

In `apps/api/src/modules/customer-journey/customer-journey.service.ts`, delete this line from the `JOURNEY_NOT_RECORDED` array (`:41`), and leave every other line as Tasks 2, 3 and 6 left it (Task 6 already removed the web hold / online application / trade-in lines):

```ts
  'ลูกค้าหน้าร้านรู้จักร้านจากไหน',
```

- [ ] **Step 17: Run both service specs — expect them to pass (Bangkok, then UTC)**

```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-manual-entry.service.spec.ts src/modules/customer-journey/journey-manual-entry.db.spec.ts --runInBand)
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=UTC NODE_ENV=test npx jest src/modules/customer-journey/journey-manual-entry.db.spec.ts --runInBand)
```
Expected:
- Run 1: PASS — `journey-manual-entry.service.spec.ts` 18 passed; `journey-manual-entry.db.spec.ts` 5 passed.
- Run 2: PASS — 5 passed.

If the HEARD_FROM DB test fails on `askHeardFrom: true` before the POST, Task 4 is not in the base yet. Stop and rebase; do not change the assertion.

- [ ] **Step 18: Write the failing controller and module specs**

Replace the whole of `apps/api/src/modules/customer-journey/customer-journey.controller.spec.ts` with:

```ts
import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { BranchGuard } from '../auth/guards/branch.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CustomerJourneyController } from './customer-journey.controller';
import { CustomerJourneyService } from './customer-journey.service';
import { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyListQueryDto } from './dto/journey-list-query.dto';
import { JourneyManualEntryService } from './journey-manual-entry.service';

describe('CustomerJourneyController', () => {
  const service = { list: jest.fn() };
  const manualEntries = { create: jest.fn() };
  let controller: CustomerJourneyController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const allow = { canActivate: () => true };
    const module = await Test.createTestingModule({
      controllers: [CustomerJourneyController],
      providers: [
        { provide: CustomerJourneyService, useValue: service },
        { provide: JourneyManualEntryService, useValue: manualEntries },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(allow).overrideGuard(RolesGuard).useValue(allow).overrideGuard(BranchGuard).useValue(allow).compile();
    controller = module.get(CustomerJourneyController);
  });

  it('GET customers/:id/journey เปิด 5 บทบาทเดียวกับหน้ารายละเอียดลูกค้า · ส่งต่อเฉพาะ id/role', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, CustomerJourneyController)).toBe('customers');
    expect(Reflect.getMetadata(PATH_METADATA, CustomerJourneyController.prototype.list)).toBe(':id/journey');
    expect(Reflect.getMetadata(ROLES_KEY, CustomerJourneyController.prototype.list)).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']);
    const query = Object.assign(new JourneyListQueryDto(), { limit: 6 });
    const user = { id: 'u1', role: 'SALES', branchId: 'b1' };
    service.list.mockResolvedValue({ redirectToCustomerId: 'c2' });
    await expect(controller.list('c1', query, user)).resolves.toEqual({ redirectToCustomerId: 'c2' });
    expect(service.list).toHaveBeenCalledWith('c1', query, { id: 'u1', role: 'SALES' });
  });

  it('POST customers/:id/journey/entries เปิด 4 บทบาทที่บันทึกได้ (ไม่มี ACCOUNTANT · Q8 FM บันทึกได้) · 201 ค่าตั้งต้น · ส่ง DTO ทั้งก้อน + id/role', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, CustomerJourneyController.prototype.createEntry)).toBe(':id/journey/entries');
    expect(Reflect.getMetadata(METHOD_METADATA, CustomerJourneyController.prototype.createEntry)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ROLES_KEY, CustomerJourneyController.prototype.createEntry)).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']);
    // ไม่มี @HttpCode ⇒ Nest ตอบ 201 ทุกกรณี รวม "เปิดอยู่แล้ว" (entryId null)
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, CustomerJourneyController.prototype.createEntry)).toBeUndefined();
    const dto = Object.assign(new CreateJourneyEntryDto(), { kind: 'REOPENED' as const });
    const user = { id: 'u1', role: 'FINANCE_MANAGER', branchId: 'b1' };
    const response = { entryId: null, event: null, summary: { stage: 'IDENTIFIED' } };
    manualEntries.create.mockResolvedValue(response);
    await expect(controller.createEntry('c1', dto, user)).resolves.toBe(response);
    expect(manualEntries.create).toHaveBeenCalledWith('c1', dto, { id: 'u1', role: 'FINANCE_MANAGER' });
  });
});
```

In `apps/api/src/modules/customer-journey/customer-journey.controller.summary.spec.ts`:

(a) Directly under `import { CustomerJourneyService } from './customer-journey.service';`, add:

```ts
import { JourneyManualEntryService } from './journey-manual-entry.service';
```

(b) Replace:

```ts
      providers: [{ provide: CustomerJourneyService, useValue: service }],
```

with:

```ts
      providers: [
        { provide: CustomerJourneyService, useValue: service },
        { provide: JourneyManualEntryService, useValue: { create: jest.fn() } },
      ],
```

Replace the whole of `apps/api/src/modules/customer-journey/customer-journey.module.spec.ts` with:

```ts
import { CustomerJourneyModule } from './customer-journey.module';
import { JourneyEntryWriter } from './journey-entry-writer.service';
import { JourneyManualEntryService } from './journey-manual-entry.service';
import { JourneyStateService } from './journey-state.service';

describe('CustomerJourneyModule — สัญญา DI ที่โมดูลอื่นพึ่ง (Task 4-6 import โมดูลนี้)', () => {
  it('provide + export JourneyEntryWriter และ JourneyStateService · ไม่ import โมดูลใดเลย (กันวงจรกับ ChatProspects/Customers/LineOa/ChatEngine)', () => {
    expect(Reflect.getMetadata('providers', CustomerJourneyModule)).toEqual(expect.arrayContaining([JourneyEntryWriter, JourneyStateService]));
    expect(Reflect.getMetadata('exports', CustomerJourneyModule)).toEqual(expect.arrayContaining([JourneyEntryWriter, JourneyStateService]));
    expect(Reflect.getMetadata('imports', CustomerJourneyModule) ?? []).toEqual([]);
  });

  it('บันทึกมือ (POST journey/entries): provide JourneyManualEntryService ในโมดูลเดียวกัน · ไม่ export · ยังไม่ import โมดูลใด', () => {
    expect(Reflect.getMetadata('providers', CustomerJourneyModule)).toEqual(expect.arrayContaining([JourneyManualEntryService]));
    expect(Reflect.getMetadata('exports', CustomerJourneyModule)).not.toContain(JourneyManualEntryService);
    expect(Reflect.getMetadata('imports', CustomerJourneyModule) ?? []).toEqual([]);
  });
});
```

- [ ] **Step 19: Run the controller and module specs — expect them to fail**

```bash
(cd apps/api && npx jest src/modules/customer-journey/customer-journey.controller.spec.ts src/modules/customer-journey/customer-journey.controller.summary.spec.ts src/modules/customer-journey/customer-journey.module.spec.ts --runInBand)
```
Expected:
- `customer-journey.controller.spec.ts` FAILS — ts-jest `TS2339: Property 'createEntry' does not exist on type 'CustomerJourneyController'`.
- `customer-journey.module.spec.ts` FAILS the new test — `expect(received).toEqual(expected)` with `ArrayContaining [[class JourneyManualEntryService]]`.
- `customer-journey.controller.summary.spec.ts` still PASSES, because the extra provider is not used yet.

- [ ] **Step 20: Implement the route and register the provider**

Replace the whole of `apps/api/src/modules/customer-journey/customer-journey.controller.ts` with:

```ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BranchGuard } from '../auth/guards/branch.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JourneyEntryCreatedResponse, JourneyListResponse, JourneyRedirect, JourneySummary } from '@installment/shared';
import { CustomerJourneyService } from './customer-journey.service';
import { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyListQueryDto } from './dto/journey-list-query.dto';
import { JourneyManualEntryService } from './journey-manual-entry.service';

@ApiTags('Customer Journey')
@ApiBearerAuth('JWT')
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class CustomerJourneyController {
  constructor(
    private readonly journey: CustomerJourneyService,
    private readonly manualEntries: JourneyManualEntryService,
  ) {}

  @Get(':id/journey')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'การเดินทางของลูกค้า — แชท เครดิต การขาย ชำระเงิน ติดตามหนี้ บริการ แต้ม (keyset cursor)' })
  list(@Param('id') id: string, @Query() query: JourneyListQueryDto, @CurrentUser() user: { id: string; role: string }): Promise<JourneyListResponse | JourneyRedirect> {
    return this.journey.list(id, query, { id: user.id, role: user.role });
  }

  @Get(':id/journey/summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'แถบขั้นการเดินทางของลูกค้า — ขั้นซื้อแล้วตรวจสดกับ BOUGHT_WHERE ทุกคำขอ · ผู้สนใจที่ถูกรวมแล้วได้ redirect' })
  summary(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }): Promise<JourneySummary | JourneyRedirect> {
    return this.journey.summary(id, { id: user.id, role: user.role });
  }

  /** ACCOUNTANT ไม่มีสิทธิ์เขียน (และไม่เห็นกลุ่มแชทที่แถวบันทึกมืออยู่) · Customer ไม่มี branchId จึงไม่มีขอบเขตสาขา */
  @Post(':id/journey/entries')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @ApiOperation({ summary: 'บันทึกมือแตะเดียว — ติดต่อ · รู้จักร้านจากไหน · ติดป้ายหลุด · เปิดใหม่ · เวลาเซิร์ฟเวอร์ · clientRequestId กันกดซ้ำ · 201 เสมอ (เปิดใหม่ตอนไม่หลุด = entryId null)' })
  createEntry(@Param('id') id: string, @Body() dto: CreateJourneyEntryDto, @CurrentUser() user: { id: string; role: string }): Promise<JourneyEntryCreatedResponse> {
    return this.manualEntries.create(id, dto, { id: user.id, role: user.role });
  }
}
```

In `apps/api/src/modules/customer-journey/customer-journey.module.ts`:

(a) Directly under `import { JourneyEntryWriter } from './journey-entry-writer.service';`, add:

```ts
import { JourneyManualEntryService } from './journey-manual-entry.service';
```

(b) Replace:

```ts
  providers: [JourneyEntryWriter, JourneyStateService, JourneySummaryService, CustomerJourneyService, CustomerJourneyCron],
```

with:

```ts
  providers: [JourneyEntryWriter, JourneyStateService, JourneySummaryService, JourneyManualEntryService, CustomerJourneyService, CustomerJourneyCron],
```

- [ ] **Step 21: Run the controller and module specs — expect them to pass**

```bash
(cd apps/api && npx jest src/modules/customer-journey/customer-journey.controller.spec.ts src/modules/customer-journey/customer-journey.controller.summary.spec.ts src/modules/customer-journey/customer-journey.module.spec.ts --runInBand)
```
Expected: PASS — controller 2 passed, controller summary 2 passed, module 2 passed.

- [ ] **Step 22: Rewrite spec API item 3, the TOUCHPOINT row cells and the metric line**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md`:

(a) In the event-table row that starts with `| TOUCHPOINT |`, replace only its last two cells:

```md
| พนักงาน (created) | exact ตามที่พนักงานกด · มีเฉพาะที่กด |
```

with:

```md
| พนักงาน (ผู้กด) | exact — เวลาเซิร์ฟเวอร์ตอนกด ไม่มีช่องเปลี่ยนเวลา ไม่มีโน้ต (ขอบเขต v2) · มีเฉพาะที่กด |
```

(b) Replace the whole API item 3 block, which currently reads:

```md
3) POST /customers/:id/journey/entries
- roles: OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES
- body แบบ discriminated:
  - { kind: 'TOUCHPOINT', channel, outcome, note?, occurredAt? (≥ now-7d, ≤ now), roomId? }
  - { kind: 'HEARD_FROM', heardFrom }
  - { kind: 'MARKED_LOST', lostReason, note? }
  - { kind: 'REOPENED' }
- 409 เมื่อ MARKED_LOST กับคนที่ซื้อแล้ว
- ถ้า :id เป็น placeholder ที่รวมแล้ว → เขียนไปที่ merged_into_id
- note ตรง /\d[\d\s-]{8,}\d/ → 400 'ห้ามใส่เบอร์โทรหรือเลขบัตรในบันทึก'
- 201 { event: JourneyEvent, summary: JourneySummary } (recompute รายคนแบบ sync ข้อมูลหลักสิบแถว)
```

with:

```md
3) POST /customers/:id/journey/entries (เฟส 3 ขอบเขต v2 — คำตัดสินเจ้าของ 2026-09-15 ข้อ 4 และ 12)

สิทธิ์
- roles: OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES
- FM บันทึกได้ (Q8) · ACCOUNTANT ไม่มีสิทธิ์เขียน

body แบบ discriminated (CreateJourneyEntryDto) — **ไม่มี note / occurredAt / roomId** (ValidationPipe whitelist ตัดคีย์อื่นทิ้ง)
- { kind: 'TOUCHPOINT', channel, outcome, clientRequestId? }
  - channel: PHONE | FB_APP | LINE_APP | WALK_IN — OTHER ไม่รับ (คงไว้เป็นป้ายของแถวเก่าเท่านั้น)
  - outcome: APPOINTED | VISITED | THINKING | BUDGET | NO_ANSWER | BOUGHT_ELSEWHERE | NOT_INTERESTED
- { kind: 'HEARD_FROM', heardFrom, clientRequestId? }
  - heardFrom: FB_AD | FB_PAGE | TIKTOK | LINE | GOOGLE | FRIEND | WALK_BY | OLD_CUSTOMER | OTHER
- { kind: 'MARKED_LOST', lostReason, clientRequestId? }
  - lostReason: NOT_INTERESTED | BOUGHT_ELSEWHERE | CREDIT_FAILED | UNREACHABLE | OTHER — ชิปอย่างเดียว
- { kind: 'REOPENED', clientRequestId? }

ข้อความ 400
- 'ชนิดรายการไม่ถูกต้อง'
- 'กรุณาเลือกช่องทาง'
- 'กรุณาเลือกผลการติดต่อ'
- 'กรุณาเลือกเหตุผล'
- 'กรุณาเลือกช่องทางที่รู้จักร้าน'
- 'รหัสคำขอไม่ถูกต้อง' (clientRequestId ต้องเป็น UUID v4)

แถวที่เขียน
- origin MANUAL · actorType STAFF · actorUserId = ผู้กด
- occurredAt = เวลาเซิร์ฟเวอร์ ทุก kind
- roomId / refType / refId / note = null
- คอลัมน์ของ kind อื่น = null

กติกา
- :id เป็น placeholder ที่รวมแล้ว → เขียนที่ merged_into_id (customerId = originCustomerId = ลูกค้าจริง)
- ไม่พบ หรือถูกลบด้วยเหตุอื่น → 404 'ไม่พบลูกค้า'
- MARKED_LOST กับคนที่ซื้อแล้ว (BOUGHT_WHERE สด) → 409 'ลูกค้ารายนี้ซื้อแล้ว ติดป้ายหลุดไม่ได้'
- หลุดอยู่แล้วติดซ้ำได้ = เปลี่ยนเหตุผล (Q4)
- REOPENED ตอนไม่หลุด → ไม่เขียนแถว · ตอบ 201 { entryId: null, event: null, summary } · เว็บแสดง 'เปิดอยู่แล้ว' (Q4)
  - คำนวณแคชใหม่ก่อนอ่านค่า lost

กันกดซ้ำ (Q6)
- dedupe_key = 'MANUAL:<kind>:<clientRequestId>'
- เว็บสร้าง UUID ใหม่ทุกครั้งที่แตะ ส่ง UUID เดิมซ้ำเฉพาะตอน retry
- ค้นแถวด้วย dedupe_key ก่อนตรวจกติกาข้างบน:
  - เจอแถวของครอบครัวนี้ที่ยังไม่ถูกเลิกทำ → คืนแถวนั้น ไม่เขียนแถวที่สอง (retry ของคำขอที่สำเร็จแล้วได้ผลเดิมเสมอ)
  - แถวนั้นถูกเลิกทำแล้ว หรือเป็นของลูกค้าคนอื่น → 409 'คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง'
- สองคำขอพร้อมกันชน unique (P2002) → ตัวที่แพ้โหลดแถวของตัวที่ชนะมาคืน

หลังเขียน
- recompute([ลูกค้าจริง]) แบบ sync
- ถ้าล้ม: warn + Sentry (tags kind customer-journey · op manual-entry-recompute) · คำขอยังสำเร็จ

คำตอบ
- 201 JourneyEntryCreatedResponse { entryId, event: JourneyEvent, summary: JourneySummary }
- event มาจากตัวแปลงเดียวกับรายการ (sources/manual-entry-event.ts) ⇒ ชื่อแถวสองทางตรงกันเสมอ
- ไม่เขียน audit_logs เพิ่ม — แถว entries มีผู้กด เวลา และ deletedById อยู่แล้ว
```

(c) Replace the metric line:

```md
ตัวชี้วัดการใช้งานหลังเปิด 2 สัปดาห์: นับ entries MANUAL ต่อพนักงาน ถ้า ≈0 ให้คงไว้แต่ไม่ขยาย
```

with:

```md
ตัวชี้วัดการใช้งานหลังเปิด 2 สัปดาห์: นับ entries MANUAL ต่อพนักงาน ถ้า ≈0 ให้คงไว้แต่ไม่ขยาย — คิวรีนับอย่างเดียวอยู่ใน docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md หัวข้อ "ตัวชี้วัดการใช้งานบันทึกมือ"
```

- [ ] **Step 23: Append the 2-week usage metric to the phase-3 runbook**

Append this section at the end of `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md`, after the last line Task 2 or a later task wrote. Keep one blank line before the heading.

````md
## ตัวชี้วัดการใช้งานบันทึกมือ — 2 สัปดาห์หลังเปิด (POST journey/entries)

ที่มา: spec หัวข้อ "บันทึกด้วยมือ (เฟส 3)" — *"นับ entries MANUAL ต่อพนักงาน ถ้า ≈0 ให้คงไว้แต่ไม่ขยาย"*

**ก่อนรัน:**
- คิวรีนับอย่างเดียว ใช้ MCP (`mcp_ro`) ได้ — คอลัมน์ที่ใช้อยู่ใน grants แล้ว:
  - `customer_journey_entries`: `origin`, `kind`, `actor_user_id`, `created_at`, `deleted_at`
  - `users`: `id`, `role`
  - ไม่แตะ `note` และไม่ดึงชื่อพนักงาน
- `<LAUNCH_UTC>` = เวลาที่ revision ของ `bestchoice-api` ที่มี PR นี้เริ่มรับ traffic — **จุดเริ่มนับเดียวของตัวชี้วัดนี้** (หัวข้ออื่นในไฟล์นี้อ้างมาที่นี่ ไม่มีวันเริ่มนับชุดที่สอง)
  - ดูที่ Cloud Run console → `bestchoice-api` → Revisions
  - เขียนเป็น UTC เช่น `2026-09-20 03:00:00` (`created_at` เก็บเป็น UTC) · ห้ามใช้เวลาไทยหรือ `+07`
- **วันวัด** = `<LAUNCH_UTC>` + 14 วัน · จด `<LAUNCH_UTC>` และวันวัดลง PR ตั้งแต่วันที่ขึ้น

**ต่อชนิด:**
```sql
SELECT kind, count(*) FROM customer_journey_entries
WHERE origin = 'MANUAL' AND deleted_at IS NULL AND created_at >= '<LAUNCH_UTC>'
GROUP BY kind ORDER BY kind;
```

**ต่อพนักงาน (id + บทบาทเท่านั้น):**
```sql
SELECT e.actor_user_id, u.role, count(*) FROM customer_journey_entries e
LEFT JOIN users u ON u.id = e.actor_user_id
WHERE e.origin = 'MANUAL' AND e.deleted_at IS NULL AND e.created_at >= '<LAUNCH_UTC>'
GROUP BY e.actor_user_id, u.role ORDER BY count(*) DESC;
```

**เก็บไว้ / เลิกทำ ต่อพนักงานต่อชนิด (id เท่านั้น):**
```sql
SELECT actor_user_id, kind,
       count(*) FILTER (WHERE deleted_at IS NULL)     AS kept,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS undone
FROM customer_journey_entries
WHERE origin = 'MANUAL' AND created_at >= '<LAUNCH_UTC>'
GROUP BY 1, 2
ORDER BY 1, 2;
```

**อ่านผล:**
- สองคิวรีแรกไม่นับรายการที่ถูกเลิกทำ (`deleted_at IS NULL`) · คิวรีที่สามแยก `kept` / `undone` ให้เห็นว่ากดผิดแล้วเลิกทำบ่อยแค่ไหน
- ยอดรวมทุกแถว (= ผลรวม `kept`) ≈ 0 → คงปุ่มไว้แต่ไม่ขยาย (ไม่เพิ่มปุ่มในเมนูอื่น — Q9) แล้วส่งตัวเลขให้เจ้าของก่อนวางแผนเฟสถัดไป (AI อ่านแชท)
- `undone` สูงเทียบกับ `kept` = ปุ่มกดพลาดง่าย → ส่งตัวเลขให้เจ้าของพร้อมกัน
- `HEARD_FROM` ถามเฉพาะลูกค้าที่เริ่มจากหน้าร้าน ซึ่งมีน้อยมากเทียบกับลูกค้าที่ทักแชทก่อน — ตัวเลขต่ำไม่ได้แปลว่าปุ่มพัง
````

- [ ] **Step 24: Verify the whole module, types and lint**

```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey --runInBand)
(cd apps/api && npx tsc --noEmit -p tsconfig.json)
(cd apps/api && npx eslint src/modules/customer-journey/sources/manual-entry-event.ts src/modules/customer-journey/sources/manual-entry-event.spec.ts src/modules/customer-journey/sources/entries.source.ts src/modules/customer-journey/dto/create-journey-entry.dto.ts src/modules/customer-journey/dto/create-journey-entry.dto.spec.ts src/modules/customer-journey/journey-manual-entry.service.ts src/modules/customer-journey/journey-manual-entry.service.spec.ts src/modules/customer-journey/journey-manual-entry.db.spec.ts src/modules/customer-journey/customer-journey.service.ts src/modules/customer-journey/customer-journey.controller.ts src/modules/customer-journey/customer-journey.controller.spec.ts src/modules/customer-journey/customer-journey.controller.summary.spec.ts src/modules/customer-journey/customer-journey.module.ts src/modules/customer-journey/customer-journey.module.spec.ts)
```
Expected:
- **jest:** every suite under `src/modules/customer-journey` PASSES.
  - This includes the Task 1-6 suites and `customer-journey.pdpa.db.spec.ts`, which is unchanged: manual rows still expose only `EVENT_KEYS`.
- **tsc:** exits 0.
- **eslint:** `0 errors`.
  - One warning is expected and accepted: `'now' is defined but never used` at `manualEntryToEvent` in `manual-entry-event.ts`. Task 8 starts using `now`.
  - Do not rename the parameter to `_now`, because Task 8's spread references `now`.
  - Never run `npm run lint` in `apps/api` (it runs `--fix`).

- [ ] **Step 25: Commit**

Stage exactly these 16 paths (never `git add -A`; another session edits this worktree):

```bash
git add apps/api/src/modules/customer-journey/sources/manual-entry-event.ts apps/api/src/modules/customer-journey/sources/manual-entry-event.spec.ts apps/api/src/modules/customer-journey/sources/entries.source.ts apps/api/src/modules/customer-journey/dto/create-journey-entry.dto.ts apps/api/src/modules/customer-journey/dto/create-journey-entry.dto.spec.ts apps/api/src/modules/customer-journey/journey-manual-entry.service.ts apps/api/src/modules/customer-journey/journey-manual-entry.service.spec.ts apps/api/src/modules/customer-journey/journey-manual-entry.db.spec.ts apps/api/src/modules/customer-journey/customer-journey.service.ts apps/api/src/modules/customer-journey/customer-journey.controller.ts apps/api/src/modules/customer-journey/customer-journey.controller.spec.ts apps/api/src/modules/customer-journey/customer-journey.controller.summary.spec.ts apps/api/src/modules/customer-journey/customer-journey.module.ts apps/api/src/modules/customer-journey/customer-journey.module.spec.ts docs/superpowers/specs/2026-09-15-customer-journey-design.md docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
```

Commit with this message (for example `git commit -F <file>` with the text saved to a scratch file):

```text
feat(customer-journey): POST /customers/:id/journey/entries — บันทึกมือแตะเดียว (ติดต่อ · รู้จักร้านจากไหน · ติดป้ายหลุด · เปิดใหม่)

- เวลาเซิร์ฟเวอร์ทุก kind · ไม่มี note / occurredAt / roomId (ขอบเขต v2 ข้อ 4 และ 12) · ช่องทางกดได้ 4 ค่า (OTHER ไม่รับ)
- placeholder ที่รวมแล้วเขียนไปที่ลูกค้าจริง · ผู้ซื้อติดป้ายหลุดไม่ได้ (409) · เปิดใหม่ตอนไม่หลุด = ไม่เขียน (201 entryId null)
- clientRequestId → dedupe_key MANUAL:<kind>:<uuid> ค้นก่อนกติกา kind · แถวที่เลิกทำแล้ว / ของลูกค้าอื่น → 409 · ชน P2002 คืนแถวที่ชนะ
- recompute หลังเขียน (ล้ม = warn + Sentry op manual-entry-recompute) แล้วคืน summary + event จากตัวแปลงเดียวกับรายการ (sources/manual-entry-event.ts)
- ตัด "ลูกค้าหน้าร้านรู้จักร้านจากไหน" ออกจาก "ระบบยังไม่เก็บ" · spec API ข้อ 3 · runbook ตัวชี้วัดการใช้งาน 2 สัปดาห์

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Then check:

```bash
git status --short -- apps/api/src/modules/customer-journey docs/superpowers
```
Expected:
- The commit succeeds.
- `git status` lists none of the 16 staged paths.
- Paths with another session's uncommitted edits may still appear. Leave them alone.

---

### Task 8: DELETE /customers/:id/journey/entries/:entryId + undo fields on manual rows

**Files:**
- Modify (created by Task 7): `apps/api/src/modules/customer-journey/sources/manual-entry-event.ts` — add the undo constants/helpers after the import block; add `createdAt: Date` to the first parameter type of `manualEntryToEvent`; spread the undo fields as the last property of the event it returns.
- Test (created by Task 7): `apps/api/src/modules/customer-journey/sources/manual-entry-event.spec.ts` — append one `describe` block at the end of the file.
- Modify: `apps/api/src/modules/customer-journey/sources/entries.source.ts:68` — the `customerJourneyEntry.findMany` `select` gains `createdAt: true` (still no `note`).
- Test: `apps/api/src/modules/customer-journey/sources/entries.source.spec.ts:13` (the `entry()` helper gains `createdAt`) and append one `describe` block inside the top-level `describe('entriesSource', …)` before its closing `});` (currently line 86).
- Modify (created by Task 7): `apps/api/src/modules/customer-journey/journey-manual-entry.service.ts` — add `remove()` after `create()` (it reuses Task 7's private `resolveFamily()`; no second family helper); extend the `@nestjs/common`, `@installment/shared` and `./sources/manual-entry-event` imports.
- Test (created by Task 7): `apps/api/src/modules/customer-journey/journey-manual-entry.service.spec.ts` — append one self-contained `describe` block at the end of the file.
- Test (created by Task 7): `apps/api/src/modules/customer-journey/journey-manual-entry.db.spec.ts` — append one self-contained `describe` block at the end of the file.
- Modify: `apps/api/src/modules/customer-journey/customer-journey.controller.ts:1` (import `Delete`), `:8` (import `JourneyEntryDeletedResponse`), and add the `removeEntry` handler after the Task 7 POST handler (after line 31 on the pre-Task-7 file).
- Test: `apps/api/src/modules/customer-journey/customer-journey.controller.spec.ts:1-9` (imports) and append one `describe` block after line 33.
- Test: `apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts:11` (`EVENT_KEYS`) and add one `it` after the "PDPA snapshot" test (after line 121).
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md:337-339` — replace the "4) DELETE" block.

**Interfaces:**

Consumes:
- Task 1 (`@installment/shared`): `JourneyEvent.entryId?: string; undoableUntil?: string | null; canDelete?: boolean` · `interface JourneyEntryDeletedResponse { summary: JourneySummary }` · `JourneyEntryCreatedResponse { entryId: string | null; event: JourneyEvent | null; summary: JourneySummary }`.
- Task 7:
  - `class JourneyManualEntryService` (`@Injectable`, registered in `CustomerJourneyModule.providers`) with constructor-injected `private readonly prisma: PrismaService`, `private readonly journeyState: JourneyStateService`, `private readonly summaries: JourneySummaryService`, and `private readonly logger = new Logger(JourneyManualEntryService.name)`; no other constructor dependency.
  - `JourneyManualEntryService.create(customerId: string, dto: CreateJourneyEntryDto, actor: { id: string; role: string }): Promise<JourneyEntryCreatedResponse>`; a dedupe hit on a soft-deleted row throws `ConflictException('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง')` (outline D8).
  - `private async resolveFamily(customerId: string): Promise<{ targetId: string; familyIds: string[] }>` on the same class — `prisma.customer.findUnique({ where: { id }, select: { id: true, deletedAt: true, mergedIntoId: true } })`; a deleted placeholder follows `mergedIntoId` (second `findUnique` with the same select, target must exist and not be deleted); missing / deleted without target → `NotFoundException('ไม่พบลูกค้า')`; then `prisma.customer.findMany({ where: { mergedIntoId: targetId }, select: { id: true } })`; `familyIds = [targetId, ...absorbed]`. `remove()` calls it as-is — the family rule lives in one place.
  - `class CreateJourneyEntryDto` in `apps/api/src/modules/customer-journey/dto/create-journey-entry.dto.ts` with `kind`, `channel?`, `outcome?`, `lostReason?`, `heardFrom?`, `clientRequestId?`.
  - `manualEntryToEvent(row, actor: JourneyActor, now: Date): JourneyEvent` in `sources/manual-entry-event.ts`; its row parameter already carries `id`, `origin` and `actorUser: { id: string; name: string } | null`; `entries.source.ts` builds MANUAL events through it (list and POST share the mapper); events keep the id `entry-<rowId>`.
  - `CustomerJourneyController` constructor: `constructor(private readonly journey: CustomerJourneyService, private readonly manualEntries: JourneyManualEntryService) {}`.

Produces (all in `apps/api/src/modules/customer-journey/`):
- `sources/manual-entry-event.ts`:
  - `export const JOURNEY_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;`
  - `export const JOURNEY_UNDO_ANY_ROLES: readonly string[] = ['OWNER', 'BRANCH_MANAGER'];`
  - `export interface ManualEntryUndoRow { id: string; origin: string; createdAt: Date; actorUserId: string | null }`
  - `export function isOwnEntryWithinUndoWindow(row: Pick<ManualEntryUndoRow, 'createdAt' | 'actorUserId'>, actor: JourneyActor, now: Date): boolean`
  - `export function canDeleteManualEntry(row: Pick<ManualEntryUndoRow, 'createdAt' | 'actorUserId'>, actor: JourneyActor, now: Date): boolean`
  - `export function manualEntryUndoFields(row: ManualEntryUndoRow, actor: JourneyActor, now: Date): Pick<JourneyEvent, 'entryId' | 'undoableUntil' | 'canDelete'>` — `{}` for non-MANUAL rows; for MANUAL rows `{ entryId: row.id, undoableUntil: own && within ? createdAt + 24h ISO : null, canDelete: role ∈ {OWNER, BRANCH_MANAGER} || (own && within) }`
  - `manualEntryToEvent` now requires `createdAt: Date` on its row and returns the three fields on MANUAL rows.
- `journey-manual-entry.service.ts`: `JourneyManualEntryService.remove(customerId: string, entryId: string, actor: { id: string; role: string }): Promise<JourneyEntryDeletedResponse>`:
  1. `const { targetId, familyIds } = await this.resolveFamily(customerId)` (Task 7 helper: placeholder with `deletedAt` + `mergedIntoId` → its target; target missing or deleted → 404 `ไม่พบลูกค้า`; `familyIds = [targetId, ...customers where mergedIntoId = targetId]`)
  2. pre-read `select { id, customerId, origin, actorUserId, createdAt, deletedAt }`; missing or `customerId ∉ family` → 404 `ไม่พบรายการนี้`
  3. `origin !== 'MANUAL'` → 400 `ลบได้เฉพาะรายการที่พนักงานบันทึกเอง`
  4. `!canDeleteManualEntry(entry, actor, now)` → 403 `ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง`
  5. already deleted → skip writes, return `{ summary }`
  6. CAS `updateMany({ where: { id, origin: 'MANUAL', deletedAt: null, customerId: { in: family } }, data: { deletedAt: now, deletedById: actor.id } })`; count 0 = concurrent undo → no recompute
  7. count 1 → `journeyState.recompute([targetId])` in try/catch, `logger.warn` + `Sentry.captureException(err, { tags: { kind: 'customer-journey', op: 'manual-entry-undo-recompute' } })`
  8. return `{ summary: await summaries.summary(targetId, actor) }` (a redirect there → 404 `ไม่พบลูกค้า`)
- `customer-journey.controller.ts`: `@Delete(':id/journey/entries/:entryId') @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES') removeEntry(@Param('id') id: string, @Param('entryId') entryId: string, @CurrentUser() user: { id: string; role: string }): Promise<JourneyEntryDeletedResponse>` — no `@HttpCode` (Nest default 200 for DELETE).
- `sources/entries.source.ts`: select adds `createdAt: true`.
- PDPA `EVENT_KEYS` gains `entryId`, `undoableUntil`, `canDelete`.

---

- [ ] **Step 1: Build shared once so the API sees the Task 1 types**

Commands below run from the worktree root (`/Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/feat+customer-detail-journey`); API commands use a `( cd apps/api && … )` subshell so a pasted block never changes the shell's directory. DB specs use the local test DB of Plans 1-2 (`bc_journey_test`, written out in full in every command). Never run `npm run lint` in `apps/api` (it runs `--fix`).

```bash
npm run build --workspace=@installment/shared
```
Expected: exits 0 (`packages/shared/dist` rebuilt; `JourneyEntryDeletedResponse` and the optional `entryId`/`undoableUntil`/`canDelete` on `JourneyEvent` exist in `dist/customer-journey.d.ts`).

- [ ] **Step 2: Write the failing mapper tests (undo window, TimelineRows e1-e5)**

In `apps/api/src/modules/customer-journey/sources/manual-entry-event.spec.ts`, make sure the import from `'./manual-entry-event'` includes these names (merge them into the existing import line from that module; do not add a second import of the same module):

```ts
import {
  JOURNEY_UNDO_WINDOW_MS,
  canDeleteManualEntry,
  manualEntryToEvent,
  manualEntryUndoFields,
  type ManualEntryUndoRow,
} from './manual-entry-event';
```

Append at the end of the file:

```ts
describe('หน้าต่างเลิกทำ — canDeleteManualEntry / manualEntryUndoFields (TimelineRows e1-e5 · Q5 · Q18)', () => {
  const NOW = new Date('2026-09-15T10:00:00.000Z');
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  const until = (createdAt: Date) => new Date(createdAt.getTime() + JOURNEY_UNDO_WINDOW_MS).toISOString();
  const SOMSRI = { id: 'staff-somsri', role: 'SALES' };
  const MANA_ID = 'staff-mana';
  const row = (o: Partial<ManualEntryUndoRow> = {}): ManualEntryUndoRow => ({
    id: 'e1',
    origin: 'MANUAL',
    createdAt: ago(5 * MINUTE),
    actorUserId: SOMSRI.id,
    ...o,
  });

  it('หน้าต่าง = 24 ชั่วโมง', () => {
    expect(JOURNEY_UNDO_WINDOW_MS).toBe(86_400_000);
  });

  it('e1 ผู้ดูเป็นผู้บันทึก 5 นาทีที่แล้ว → เลิกทำได้ · undoableUntil = createdAt + 24 ชม.', () => {
    const createdAt = ago(5 * MINUTE);
    expect(manualEntryUndoFields(row({ createdAt }), SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: until(createdAt), canDelete: true });
  });

  it('e2 ผู้บันทึก 22 ชม. → ยังเลิกทำได้ · ครบ 24 ชม. พอดียังได้ · เกิน 1 มิลลิวินาทีไม่ได้', () => {
    const created22h = ago(22 * HOUR);
    expect(manualEntryUndoFields(row({ createdAt: created22h }), SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: until(created22h), canDelete: true });
    const created24h = ago(24 * HOUR);
    expect(manualEntryUndoFields(row({ createdAt: created24h }), SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: until(created24h), canDelete: true });
    expect(manualEntryUndoFields(row({ createdAt: ago(24 * HOUR + 1) }), SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: false });
  });

  it('e3 ผู้บันทึก 29 ชม. → ลิงก์หาย (canDelete false · undoableUntil null)', () => {
    expect(manualEntryUndoFields(row({ createdAt: ago(29 * HOUR) }), SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: false });
  });

  it('e4 แถวของพนักงานคนอื่น → SALES และผู้จัดการการเงินเลิกทำไม่ได้ · ผู้บันทึกถูกลบบัญชี (actorUserId null) ไม่นับเป็นของใคร', () => {
    const others = row({ actorUserId: MANA_ID, createdAt: ago(3 * HOUR) });
    expect(manualEntryUndoFields(others, SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: false });
    expect(manualEntryUndoFields(others, { id: 'fm-1', role: 'FINANCE_MANAGER' }, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: false });
    expect(canDeleteManualEntry({ actorUserId: null, createdAt: ago(MINUTE) }, SOMSRI, NOW)).toBe(false);
  });

  it('e5 OWNER / ผู้จัดการสาขา ดูแถวของคนอื่น → เลิกทำได้ทุกเวลา แต่ undoableUntil เป็นของผู้บันทึกเท่านั้น (null)', () => {
    for (const role of ['OWNER', 'BRANCH_MANAGER']) {
      const viewer = { id: `viewer-${role}`, role };
      expect(manualEntryUndoFields(row({ actorUserId: MANA_ID, createdAt: ago(2 * HOUR) }), viewer, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: true });
      expect(manualEntryUndoFields(row({ actorUserId: MANA_ID, createdAt: ago(400 * 24 * HOUR) }), viewer, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: true });
    }
  });

  it('OWNER ที่บันทึกเองในหน้าต่าง ได้ undoableUntil ด้วย · ผู้จัดการการเงินเลิกทำแถวของตัวเองได้ภายใน 24 ชม.', () => {
    const createdAt = ago(MINUTE);
    expect(manualEntryUndoFields(row({ actorUserId: 'owner-1', createdAt }), { id: 'owner-1', role: 'OWNER' }, NOW)).toEqual({ entryId: 'e1', undoableUntil: until(createdAt), canDelete: true });
    expect(canDeleteManualEntry({ actorUserId: 'fm-1', createdAt: ago(22 * HOUR) }, { id: 'fm-1', role: 'FINANCE_MANAGER' }, NOW)).toBe(true);
  });

  it('แถวที่ระบบบันทึก (origin SYSTEM) ไม่มีสามคีย์นี้เลย', () => {
    expect(manualEntryUndoFields(row({ origin: 'SYSTEM', actorUserId: SOMSRI.id }), { id: 'owner-1', role: 'OWNER' }, NOW)).toEqual({});
  });

  it('manualEntryToEvent (ทางเดียวกับคำตอบ POST): แถวที่เพิ่งเขียน createdAt = now → entryId + undoableUntil = now + 24 ชม. + canDelete', () => {
    const fresh = {
      id: 'e-new', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: NOW, createdAt: NOW, actorType: 'STAFF',
      roomId: null, refType: null, refId: null, data: null, channel: 'PHONE', outcome: 'APPOINTED', lostReason: null, heardFrom: null,
      actorUser: { id: SOMSRI.id, name: 'สมศรี ตัวอย่าง' },
    } as unknown as Parameters<typeof manualEntryToEvent>[0];
    expect(manualEntryToEvent(fresh, SOMSRI, NOW)).toMatchObject({
      origin: 'MANUAL',
      entryId: 'e-new',
      undoableUntil: '2026-09-16T10:00:00.000Z',
      canDelete: true,
    });
  });
});
```

- [ ] **Step 3: Run the mapper spec — expect it to fail**

```bash
(cd apps/api && npx jest src/modules/customer-journey/sources/manual-entry-event.spec.ts --runInBand)
```
Expected: FAIL — ts-jest reports `Module '"./manual-entry-event"' has no exported member 'JOURNEY_UNDO_WINDOW_MS'` (and the same for `canDeleteManualEntry`, `manualEntryUndoFields`, `ManualEntryUndoRow`).

- [ ] **Step 4: Implement the undo helpers and spread them into `manualEntryToEvent`**

In `apps/api/src/modules/customer-journey/sources/manual-entry-event.ts`:

(a) Make sure the file imports `JourneyEvent` from `@installment/shared` and `JourneyActor` from `./journey-window` (merge into the existing import lines if Task 7 already imports from those modules):

```ts
import type { JourneyEvent } from '@installment/shared';
import type { JourneyActor } from './journey-window';
```

(b) Insert directly after the import block:

```ts
/** หน้าต่าง "เลิกทำ" ของผู้บันทึก — นับจาก createdAt (เวลาเซิร์ฟเวอร์ตอนเขียนแถว) ไม่ใช่ occurredAt (Q5) */
export const JOURNEY_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

/** บทบาทที่เลิกทำแถวที่พนักงานกดได้ทุกแถว ไม่จำกัดเวลา (Q5) */
export const JOURNEY_UNDO_ANY_ROLES: readonly string[] = ['OWNER', 'BRANCH_MANAGER'];

/** ข้อมูลขั้นต่ำของแถว entries ที่ใช้ตัดสินการเลิกทำ — ไม่มี note */
export interface ManualEntryUndoRow {
  id: string;
  origin: string;
  createdAt: Date;
  /** null = ผู้บันทึกถูกลบบัญชี (FK ON DELETE SET NULL) ⇒ ไม่นับเป็นแถวของใคร */
  actorUserId: string | null;
}

/** ผู้ดูคือผู้บันทึก และยังไม่เกิน 24 ชม. นับจาก createdAt (ครบ 24 ชม. พอดียังนับ) */
export function isOwnEntryWithinUndoWindow(
  row: Pick<ManualEntryUndoRow, 'createdAt' | 'actorUserId'>,
  actor: JourneyActor,
  now: Date,
): boolean {
  return row.actorUserId !== null && row.actorUserId === actor.id && now.getTime() - row.createdAt.getTime() <= JOURNEY_UNDO_WINDOW_MS;
}

/**
 * กติกาเดียวของ "เลิกทำ": ด่าน 403 ของ DELETE และ canDelete บนแถวไทม์ไลน์ใช้ฟังก์ชันนี้ตัวเดียว (Q18 — เว็บแสดงลิงก์ตามค่านี้)
 * OWNER / BRANCH_MANAGER ได้ทุกแถวทุกเวลา · บทบาทอื่นเฉพาะแถวของตัวเองภายใน 24 ชม.
 */
export function canDeleteManualEntry(
  row: Pick<ManualEntryUndoRow, 'createdAt' | 'actorUserId'>,
  actor: JourneyActor,
  now: Date,
): boolean {
  return JOURNEY_UNDO_ANY_ROLES.includes(actor.role) || isOwnEntryWithinUndoWindow(row, actor, now);
}

/** คีย์เลิกทำของแถว MANUAL เท่านั้น — แถว SYSTEM ได้ {} · undoableUntil เป็นของผู้บันทึกที่ยังอยู่ในหน้าต่างเท่านั้น */
export function manualEntryUndoFields(
  row: ManualEntryUndoRow,
  actor: JourneyActor,
  now: Date,
): Pick<JourneyEvent, 'entryId' | 'undoableUntil' | 'canDelete'> {
  if (row.origin !== 'MANUAL') return {};
  const ownWithin = isOwnEntryWithinUndoWindow(row, actor, now);
  return {
    entryId: row.id,
    undoableUntil: ownWithin ? new Date(row.createdAt.getTime() + JOURNEY_UNDO_WINDOW_MS).toISOString() : null,
    canDelete: canDeleteManualEntry(row, actor, now),
  };
}
```

(c) In the type of the first parameter of `manualEntryToEvent`, add the property:

```ts
  createdAt: Date;
```

(d) In the `JourneyEvent` object literal that `manualEntryToEvent` returns, add as the **last** property (after the conditional `href`/`metadata` spreads):

```ts
    ...manualEntryUndoFields({ id: row.id, origin: row.origin, createdAt: row.createdAt, actorUserId: row.actorUser?.id ?? null }, actor, now),
```

- [ ] **Step 5: Run the mapper spec — expect it to pass**

```bash
(cd apps/api && npx jest src/modules/customer-journey/sources/manual-entry-event.spec.ts --runInBand)
```
Expected: PASS (Task 7 tests + the 9 new tests).

- [ ] **Step 6: Write the failing entries-source tests (select + e1-e5 through the list source)**

In `apps/api/src/modules/customer-journey/sources/entries.source.spec.ts`, replace the `entry()` helper (line 13):

```ts
const entry = (o: Record<string, unknown>) => ({ origin: 'SYSTEM', actorType: 'STAFF', roomId: null, refType: null, refId: null, data: null, channel: null, outcome: null, lostReason: null, heardFrom: null, actorUser: null, ...o });
```

with:

```ts
const entry = (o: Record<string, unknown>) => ({ origin: 'SYSTEM', actorType: 'STAFF', roomId: null, refType: null, refId: null, data: null, channel: null, outcome: null, lostReason: null, heardFrom: null, actorUser: null, createdAt: at('2026-09-01T00:00:00.000Z'), ...o });
```

Then insert this block inside `describe('entriesSource', () => {`, immediately before the file's final `});`:

```ts
  describe('แถว MANUAL: entryId / undoableUntil / canDelete ตามผู้ดู (TimelineRows e1-e5)', () => {
    const NOW = new Date('2026-09-15T10:00:00.000Z');
    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;
    const ago = (ms: number) => new Date(NOW.getTime() - ms);
    const until = (createdAt: Date) => new Date(createdAt.getTime() + 24 * HOUR).toISOString();
    const SOMSRI = { id: 'staff-somsri', name: 'สมศรี ตัวอย่าง' };
    const MANA = { id: 'staff-mana', name: 'มานะ ทดสอบ' };
    const rows = [
      entry({ id: 'e1', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: ago(5 * MINUTE), createdAt: ago(5 * MINUTE), channel: 'PHONE', outcome: 'APPOINTED', actorUser: SOMSRI }),
      entry({ id: 'e5', kind: 'MARKED_LOST', origin: 'MANUAL', occurredAt: ago(2 * HOUR), createdAt: ago(2 * HOUR), lostReason: 'NOT_INTERESTED', actorUser: MANA }),
      entry({ id: 'e4', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: ago(3 * HOUR), createdAt: ago(3 * HOUR), channel: 'LINE_APP', outcome: 'APPOINTED', actorUser: MANA }),
      entry({ id: 'e2', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: ago(22 * HOUR), createdAt: ago(22 * HOUR), channel: 'WALK_IN', outcome: 'THINKING', actorUser: SOMSRI }),
      entry({ id: 'e3', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: ago(29 * HOUR), createdAt: ago(29 * HOUR), channel: 'PHONE', outcome: 'NO_ANSWER', actorUser: SOMSRI }),
      entry({ id: 'sys', kind: 'CONTACT_ADDED', occurredAt: ago(30 * HOUR), createdAt: ago(30 * HOUR), actorUser: SOMSRI }),
    ];
    async function view(actor: { id: string; role: string }) {
      const prisma = db();
      prisma.customerJourneyEntry.findMany.mockResolvedValue(rows);
      const events = await entriesSourceFor(new Set<JourneyEventGroup>(['chat']))(prisma as unknown as PrismaService, ['c1'], { limit: 30 }, actor);
      return { prisma, events };
    }
    const undo = (events: JourneyEvent[], id: string) => {
      const event = byId(events, `entry-${id}`);
      if (!event) throw new Error(`ไม่พบแถว entry-${id}`);
      return { entryId: event.entryId, undoableUntil: event.undoableUntil, canDelete: event.canDelete };
    };

    beforeEach(() => {
      jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('SALES (สมศรี): e1/e2 ของตัวเองในหน้าต่างเลิกทำได้ · e3 เกิน 24 ชม. · e4/e5 ของคนอื่นไม่ได้ · แถว SYSTEM ไม่มีคีย์ · select มี createdAt ไม่มี note', async () => {
      const { prisma, events } = await view({ id: SOMSRI.id, role: 'SALES' });
      expect(undo(events, 'e1')).toEqual({ entryId: 'e1', undoableUntil: until(ago(5 * MINUTE)), canDelete: true });
      expect(undo(events, 'e2')).toEqual({ entryId: 'e2', undoableUntil: until(ago(22 * HOUR)), canDelete: true });
      expect(undo(events, 'e3')).toEqual({ entryId: 'e3', undoableUntil: null, canDelete: false });
      expect(undo(events, 'e4')).toEqual({ entryId: 'e4', undoableUntil: null, canDelete: false });
      expect(undo(events, 'e5')).toEqual({ entryId: 'e5', undoableUntil: null, canDelete: false });
      const system = byId(events, 'entry-sys');
      expect(system).toBeDefined();
      for (const key of ['entryId', 'undoableUntil', 'canDelete']) expect(system).not.toHaveProperty(key);
      const args = prisma.customerJourneyEntry.findMany.mock.calls[0][0];
      expect(args.select).toHaveProperty('createdAt', true);
      expect(args.select).not.toHaveProperty('note');
    });

    it('FINANCE_MANAGER: แถวของพนักงานอื่นเลิกทำไม่ได้', async () => {
      const { events } = await view({ id: 'fm-1', role: 'FINANCE_MANAGER' });
      expect(undo(events, 'e4')).toEqual({ entryId: 'e4', undoableUntil: null, canDelete: false });
      expect(undo(events, 'e1')).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: false });
    });

    it.each(['OWNER', 'BRANCH_MANAGER'])('%s: ทุกแถวที่พนักงานกดเลิกทำได้ ไม่จำกัด 24 ชม. (e5) · undoableUntil เป็น null เพราะไม่ใช่ผู้บันทึก', async (role) => {
      const { events } = await view({ id: `viewer-${role}`, role });
      for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) expect(undo(events, id)).toEqual({ entryId: id, undoableUntil: null, canDelete: true });
    });
  });
```

- [ ] **Step 7: Run the entries-source spec — expect it to fail**

```bash
(cd apps/api && npx jest src/modules/customer-journey/sources/entries.source.spec.ts --runInBand)
```
Expected: FAIL — ts-jest reports in `entries.source.ts` that `Property 'createdAt' is missing` in the row passed to `manualEntryToEvent` (the select does not return it yet). If Task 7 casts the row, the failure is instead the assertion `expect(args.select).toHaveProperty('createdAt', true)` ("Expected path: \"createdAt\" … Received path: []").

- [ ] **Step 8: Select `createdAt` in the entries source**

In `apps/api/src/modules/customer-journey/sources/entries.source.ts`, replace the select line (line 68):

```ts
          select: { id: true, kind: true, origin: true, occurredAt: true, actorType: true, roomId: true, refType: true, refId: true, data: true, channel: true, outcome: true, lostReason: true, heardFrom: true, actorUser: { select: { id: true, name: true } } },
```

with:

```ts
          // createdAt = หน้าต่างเลิกทำ 24 ชม. (ไม่ใช่ PII) · ยังไม่ select note (ข้อความอิสระ) ทุกกรณี
          select: { id: true, kind: true, origin: true, occurredAt: true, createdAt: true, actorType: true, roomId: true, refType: true, refId: true, data: true, channel: true, outcome: true, lostReason: true, heardFrom: true, actorUser: { select: { id: true, name: true } } },
```

- [ ] **Step 9: Run the source specs and the API typecheck — expect pass**

```bash
(cd apps/api && npx jest src/modules/customer-journey/sources/entries.source.spec.ts src/modules/customer-journey/sources/manual-entry-event.spec.ts --runInBand && npx tsc --noEmit -p tsconfig.json)
```
Expected: both specs PASS; `tsc` exits 0. If `tsc` reports `Property 'createdAt' is missing` inside `journey-manual-entry.service.ts`, a Task 7 Prisma call that feeds `manualEntryToEvent` passes a `select` — add `createdAt: true` to that `select` (the create call and the dedupe lookup) and re-run until 0 errors.

- [ ] **Step 10: Write the failing service unit tests for `remove`**

In `apps/api/src/modules/customer-journey/journey-manual-entry.service.spec.ts`, make sure these imports exist (merge names into existing import lines from the same module; keep a single `jest.mock('@sentry/nestjs', …)` in the file — add this exact line only if the file has none). Task 7 already wrote `PrismaService`, `JourneyManualEntryService`, `JourneyStateService` and `JourneySummaryService` as **value** imports in this file (`import { PrismaService } from '../../prisma/prisma.service';` etc.), so only the `@nestjs/common` names and `@nestjs/testing` are new here; its `import type { CreateJourneyEntryDto }` stays type-only because this describe never constructs the DTO:

```ts
import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import type { JourneySummary } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { JourneyManualEntryService } from './journey-manual-entry.service';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
```

Append at the end of the file:

```ts
describe('JourneyManualEntryService.remove — เลิกทำ (DELETE /customers/:id/journey/entries/:entryId)', () => {
  const NOW = new Date('2026-09-15T10:00:00.000Z');
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  const SUMMARY = { stage: 'CONTACTED', lost: null } as unknown as JourneySummary;
  const CUSTOMERS: Record<string, { id: string; deletedAt: Date | null; mergedIntoId: string | null }> = {
    c1: { id: 'c1', deletedAt: null, mergedIntoId: null },
    p1: { id: 'p1', deletedAt: ago(10 * 24 * HOUR), mergedIntoId: 'c1' },
    gone: { id: 'gone', deletedAt: ago(10 * 24 * HOUR), mergedIntoId: null },
  };
  const ENTRY_SELECT = { id: true, customerId: true, origin: true, actorUserId: true, createdAt: true, deletedAt: true };
  const manualRow = (o: Record<string, unknown> = {}) => ({
    id: 'e1', customerId: 'c1', origin: 'MANUAL', actorUserId: 's1', createdAt: ago(5 * MINUTE), deletedAt: null, ...o,
  });
  let warn: jest.SpyInstance;

  async function setup(entry: Record<string, unknown> | null) {
    const prisma = {
      customer: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(CUSTOMERS[where.id] ?? null)),
        findMany: jest.fn(({ where }: { where: { mergedIntoId: string } }) => Promise.resolve(where.mergedIntoId === 'c1' ? [{ id: 'p1' }] : [])),
      },
      customerJourneyEntry: {
        findUnique: jest.fn().mockResolvedValue(entry),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const journeyState = { recompute: jest.fn().mockResolvedValue(undefined) };
    const summaries = { summary: jest.fn().mockResolvedValue(SUMMARY) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        JourneyManualEntryService,
        { provide: PrismaService, useValue: prisma },
        { provide: JourneyStateService, useValue: journeyState },
        { provide: JourneySummaryService, useValue: summaries },
      ],
    }).compile();
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    return { service: moduleRef.get(JourneyManualEntryService), prisma, journeyState, summaries };
  }

  async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
      await promise;
    } catch (err) {
      return err as Error;
    }
    throw new Error('คาดว่า remove จะ throw');
  }

  beforeEach(() => {
    jest.mocked(Sentry.captureException).mockClear();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
  });

  it.each([
    { label: 'SALES ผู้บันทึก 5 นาที (e1)', actor: { id: 's1', role: 'SALES' }, author: 's1' as string | null, age: 5 * MINUTE },
    { label: 'SALES ผู้บันทึก 22 ชม. (e2)', actor: { id: 's1', role: 'SALES' }, author: 's1' as string | null, age: 22 * HOUR },
    { label: 'SALES ผู้บันทึก ครบ 24 ชม. พอดี', actor: { id: 's1', role: 'SALES' }, author: 's1' as string | null, age: 24 * HOUR },
    { label: 'FINANCE_MANAGER ผู้บันทึก 22 ชม.', actor: { id: 'f1', role: 'FINANCE_MANAGER' }, author: 'f1' as string | null, age: 22 * HOUR },
    { label: 'BRANCH_MANAGER แถวของคนอื่น 29 ชม. (e5)', actor: { id: 'b1', role: 'BRANCH_MANAGER' }, author: 's1' as string | null, age: 29 * HOUR },
    { label: 'OWNER แถวของคนอื่น 400 วัน (e5)', actor: { id: 'o1', role: 'OWNER' }, author: 's1' as string | null, age: 400 * 24 * HOUR },
    { label: 'OWNER แถวที่ผู้บันทึกถูกลบบัญชี', actor: { id: 'o1', role: 'OWNER' }, author: null as string | null, age: 3 * HOUR },
  ])('$label → ลบได้: compare-and-set ในครอบครัว แล้วคำนวณใหม่ แล้วคืน summary', async ({ actor, author, age }) => {
    const { service, prisma, journeyState, summaries } = await setup(manualRow({ actorUserId: author, createdAt: ago(age) }));
    await expect(service.remove('c1', 'e1', actor)).resolves.toEqual({ summary: SUMMARY });
    expect(prisma.customerJourneyEntry.findUnique).toHaveBeenCalledWith({ where: { id: 'e1' }, select: ENTRY_SELECT });
    expect(prisma.customerJourneyEntry.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', origin: 'MANUAL', deletedAt: null, customerId: { in: ['c1', 'p1'] } },
      data: { deletedAt: NOW, deletedById: actor.id },
    });
    expect(journeyState.recompute).toHaveBeenCalledWith(['c1']);
    expect(prisma.customerJourneyEntry.updateMany.mock.invocationCallOrder[0]).toBeLessThan(journeyState.recompute.mock.invocationCallOrder[0]);
    expect(summaries.summary).toHaveBeenCalledWith('c1', actor);
  });

  it.each([
    { label: 'SALES ผู้บันทึก 29 ชม. (e3)', actor: { id: 's1', role: 'SALES' }, author: 's1' as string | null, age: 29 * HOUR },
    { label: 'SALES ผู้บันทึก 24 ชม. + 1 วินาที', actor: { id: 's1', role: 'SALES' }, author: 's1' as string | null, age: 24 * HOUR + 1000 },
    { label: 'SALES แถวของพนักงานอื่น 5 นาที (e4)', actor: { id: 's2', role: 'SALES' }, author: 's1' as string | null, age: 5 * MINUTE },
    { label: 'FINANCE_MANAGER แถวของพนักงานอื่น 5 นาที (e4)', actor: { id: 'f1', role: 'FINANCE_MANAGER' }, author: 's1' as string | null, age: 5 * MINUTE },
    { label: 'SALES แถวที่ผู้บันทึกถูกลบบัญชี', actor: { id: 's1', role: 'SALES' }, author: null as string | null, age: 5 * MINUTE },
  ])('$label → 403 ไม่เขียน ไม่คำนวณใหม่', async ({ actor, author, age }) => {
    const { service, prisma, journeyState } = await setup(manualRow({ actorUserId: author, createdAt: ago(age) }));
    const err = await rejection(service.remove('c1', 'e1', actor));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe('ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง');
    expect(prisma.customerJourneyEntry.updateMany).not.toHaveBeenCalled();
    expect(journeyState.recompute).not.toHaveBeenCalled();
  });

  it('แถวที่ระบบบันทึก (origin SYSTEM) → 400 แม้ผู้ลบเป็น OWNER · ด่าน origin มาก่อนด่านสิทธิ์', async () => {
    const { service, prisma } = await setup(manualRow({ origin: 'SYSTEM', actorUserId: null }));
    const err = await rejection(service.remove('c1', 'e1', { id: 'o1', role: 'OWNER' }));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('ลบได้เฉพาะรายการที่พนักงานบันทึกเอง');
    expect(prisma.customerJourneyEntry.updateMany).not.toHaveBeenCalled();
  });

  it('ไม่พบรายการ หรือรายการเป็นของลูกค้าคนอื่น → 404 ไม่พบรายการนี้', async () => {
    const missing = await setup(null);
    const errMissing = await rejection(missing.service.remove('c1', 'nope', { id: 'o1', role: 'OWNER' }));
    expect(errMissing).toBeInstanceOf(NotFoundException);
    expect(errMissing.message).toBe('ไม่พบรายการนี้');
    jest.useRealTimers();

    const foreign = await setup(manualRow({ customerId: 'c9' }));
    const errForeign = await rejection(foreign.service.remove('c1', 'e1', { id: 'o1', role: 'OWNER' }));
    expect(errForeign).toBeInstanceOf(NotFoundException);
    expect(errForeign.message).toBe('ไม่พบรายการนี้');
    expect(foreign.prisma.customerJourneyEntry.updateMany).not.toHaveBeenCalled();
  });

  it('ลูกค้าไม่มีอยู่ หรือถูกลบด้วยเหตุอื่น → 404 ไม่พบลูกค้า โดยไม่อ่านรายการ', async () => {
    const { service, prisma } = await setup(manualRow());
    for (const id of ['no-such-customer', 'gone']) {
      const err = await rejection(service.remove(id, 'e1', { id: 'o1', role: 'OWNER' }));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('ไม่พบลูกค้า');
    }
    expect(prisma.customerJourneyEntry.findUnique).not.toHaveBeenCalled();
  });

  it('id ของ placeholder ที่รวมแล้ว → ตามไปลูกค้าจริง: ครอบครัว [c1, p1] · คำนวณใหม่และ summary ของ c1', async () => {
    const { service, prisma, journeyState, summaries } = await setup(manualRow());
    const actor = { id: 's1', role: 'SALES' };
    await expect(service.remove('p1', 'e1', actor)).resolves.toEqual({ summary: SUMMARY });
    expect(prisma.customer.findUnique).toHaveBeenNthCalledWith(1, { where: { id: 'p1' }, select: { id: true, deletedAt: true, mergedIntoId: true } });
    expect(prisma.customer.findUnique).toHaveBeenNthCalledWith(2, { where: { id: 'c1' }, select: { id: true, deletedAt: true, mergedIntoId: true } });
    expect(prisma.customerJourneyEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: { in: ['c1', 'p1'] } }) }));
    expect(journeyState.recompute).toHaveBeenCalledWith(['c1']);
    expect(summaries.summary).toHaveBeenCalledWith('c1', actor);
  });

  it('ลบไปแล้ว (กดเลิกทำซ้ำ) → 200 คืน summary ไม่เขียนซ้ำ ไม่คำนวณใหม่', async () => {
    const { service, prisma, journeyState, summaries } = await setup(manualRow({ deletedAt: ago(MINUTE) }));
    await expect(service.remove('c1', 'e1', { id: 's1', role: 'SALES' })).resolves.toEqual({ summary: SUMMARY });
    expect(prisma.customerJourneyEntry.updateMany).not.toHaveBeenCalled();
    expect(journeyState.recompute).not.toHaveBeenCalled();
    expect(summaries.summary).toHaveBeenCalledWith('c1', { id: 's1', role: 'SALES' });
  });

  it('อีกคำขอลบไปก่อนระหว่างอ่านกับเขียน (count 0) → 200 คืน summary ไม่คำนวณใหม่', async () => {
    const { service, prisma, journeyState } = await setup(manualRow());
    prisma.customerJourneyEntry.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('c1', 'e1', { id: 's1', role: 'SALES' })).resolves.toEqual({ summary: SUMMARY });
    expect(journeyState.recompute).not.toHaveBeenCalled();
  });

  it('คำนวณใหม่ล้ม → ยังคืน summary (แถวถูกลบแล้ว ห้าม 500) + Sentry แยก op', async () => {
    const { service, journeyState } = await setup(manualRow());
    const failure = new Error('db down');
    journeyState.recompute.mockRejectedValue(failure);
    await expect(service.remove('c1', 'e1', { id: 's1', role: 'SALES' })).resolves.toEqual({ summary: SUMMARY });
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, { tags: { kind: 'customer-journey', op: 'manual-entry-undo-recompute' } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});
```

- [ ] **Step 11: Write the failing real-DB tests for `remove`**

In `apps/api/src/modules/customer-journey/journey-manual-entry.db.spec.ts`, make sure these imports exist (merge into existing import lines from the same modules; no duplicate identifiers).

Two of Task 7's imports in this file are **type-only**, but the new describe uses both names as **values** (`{ provide: PrismaService, useValue: undoPrisma }` in `Test.createTestingModule`, and `new CreateJourneyEntryDto()` in `dto()`). Convert them in place — do not add a second import next to them (a value import beside an `import type` of the same name is a duplicate-identifier error, and keeping `import type` makes the value use fail):
- replace `import type { PrismaService } from '../../prisma/prisma.service';` with `import { PrismaService } from '../../prisma/prisma.service';`
- replace `import type { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';` with `import { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';`

Task 7's existing type positions (`prisma as unknown as PrismaService`, `plain as unknown as CreateJourneyEntryDto`) keep compiling with the value imports. The complete import block after this step:

```ts
import { randomUUID } from 'crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { JourneyEvent } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyService } from './customer-journey.service';
import { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyManualEntryService } from './journey-manual-entry.service';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';
import { JOURNEY_UNDO_WINDOW_MS } from './sources/manual-entry-event';
```

Append at the end of the file:

```ts
/**
 * เลิกทำกับ Postgres จริง: ป้ายหลุดหาย · ขั้นถอยเมื่อเลิกทำนัด · แถวหายจาก GET · หน้าต่าง 24 ชม. นับจาก created_at
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand · ผู้ใช้ของ spec ถูกปล่อยไว้ (แบบ journey-summary.service.db.spec.ts)
 */
describe('JourneyManualEntryService.remove (real DB) — เลิกทำ', () => {
  const undoPrisma = new PrismaClient();
  const undoStamp = Date.now();
  const undoCustomerIds: string[] = [];
  const undoUsers = { sales: '', otherSales: '', manager: '' };
  const HOUR = 60 * 60 * 1000;
  const OWNER_VIEW = { id: 'owner-undo-spec', role: 'OWNER' };
  let manualEntries: JourneyManualEntryService;
  let journey: CustomerJourneyService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: undoPrisma },
        JourneyStateService,
        JourneySummaryService,
        CustomerJourneyService,
        JourneyManualEntryService,
      ],
    }).compile();
    manualEntries = moduleRef.get(JourneyManualEntryService);
    journey = moduleRef.get(CustomerJourneyService);
    const user = (key: string, role: 'SALES' | 'BRANCH_MANAGER') =>
      undoPrisma.user.create({ data: { email: `journey-undo-${key}-${undoStamp}@spec.local`, password: 'x', name: `undo spec ${key}`, role } });
    undoUsers.sales = (await user('sales', 'SALES')).id;
    undoUsers.otherSales = (await user('other', 'SALES')).id;
    undoUsers.manager = (await user('manager', 'BRANCH_MANAGER')).id;
  });

  afterAll(async () => {
    await undoPrisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: undoCustomerIds } } });
    await undoPrisma.customerJourneyState.deleteMany({ where: { customerId: { in: undoCustomerIds } } });
    await undoPrisma.customer.deleteMany({ where: { id: { in: undoCustomerIds } } });
    await undoPrisma.$disconnect();
  });

  /** ลูกค้าหน้าร้านไม่มีเบอร์/ห้อง ⇒ ขั้นตั้งต้น CONTACTED */
  async function walkInWithoutContact(label: string) {
    const row = await undoPrisma.customer.create({ data: { name: `journey undo spec ${label} ${undoStamp}`, phone: null } });
    undoCustomerIds.push(row.id);
    return row;
  }
  const dto = (fields: Partial<CreateJourneyEntryDto>) => Object.assign(new CreateJourneyEntryDto(), { clientRequestId: randomUUID(), ...fields });
  async function chatEvents(customerId: string, actor: { id: string; role: string }): Promise<JourneyEvent[]> {
    const result = await journey.list(customerId, { groups: ['chat'], limit: 100 }, actor);
    if (!('events' in result)) throw new Error('ได้ redirect');
    return result.events;
  }

  it('เลิกทำป้ายหลุด → summary.lost เป็น null · แถวหายจาก GET · ลบซ้ำ = 200 ไม่เขียนทับ · ส่ง clientRequestId เดิมซ้ำ = 409', async () => {
    const customer = await walkInWithoutContact('lost');
    const author = { id: undoUsers.sales, role: 'SALES' };
    const markDto = dto({ kind: 'MARKED_LOST', lostReason: 'NOT_INTERESTED' });
    const created = await manualEntries.create(customer.id, markDto, author);
    expect(created.summary.lost).toMatchObject({ reason: 'NOT_INTERESTED' });
    if (!created.entryId || !created.event) throw new Error('คาดว่าได้แถวใหม่');
    const entryId = created.entryId;
    const row = await undoPrisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(created.event).toMatchObject({
      entryId,
      canDelete: true,
      undoableUntil: new Date(row.createdAt.getTime() + JOURNEY_UNDO_WINDOW_MS).toISOString(),
    });
    expect((await chatEvents(customer.id, OWNER_VIEW)).map((e) => e.entryId)).toContain(entryId);

    const undone = await manualEntries.remove(customer.id, entryId, author);
    expect(undone.summary.lost).toBeNull();
    const deleted = await undoPrisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deletedById).toBe(author.id);
    expect((await chatEvents(customer.id, OWNER_VIEW)).some((e) => e.id === `entry-${entryId}` || e.entryId === entryId)).toBe(false);

    const again = await manualEntries.remove(customer.id, entryId, author);
    expect(again.summary.lost).toBeNull();
    expect((await undoPrisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: entryId } })).deletedAt).toEqual(deleted.deletedAt);

    await expect(manualEntries.create(customer.id, markDto, author)).rejects.toThrow(ConflictException);
    await expect(manualEntries.create(customer.id, markDto, author)).rejects.toThrow('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง');
  });

  it('เลิกทำ "ติดต่อทางโทร: นัดแล้ว" → ขั้นถอยจาก นัด / จอง กลับเป็น ทักเข้ามา · lastTouchAt ว่าง', async () => {
    const customer = await walkInWithoutContact('appointed');
    const author = { id: undoUsers.sales, role: 'SALES' };
    const created = await manualEntries.create(customer.id, dto({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED' }), author);
    expect(created.summary.stage).toBe('INTERESTED');
    if (!created.entryId) throw new Error('คาดว่าได้แถวใหม่');

    const undone = await manualEntries.remove(customer.id, created.entryId, author);
    expect(undone.summary).toMatchObject({ stage: 'CONTACTED', lastTouchAt: null });
    expect(undone.summary.steps.find((s) => s.stage === 'INTERESTED')).toMatchObject({ at: null, state: 'todo' });
  });

  it('หน้าต่าง 24 ชม. นับจาก created_at ไม่ใช่ occurred_at: ผู้บันทึกหลัง 25 ชม. = 403 และลิงก์หาย · SALES คนอื่น 403 · ผู้จัดการสาขาลบได้', async () => {
    const customer = await walkInWithoutContact('window');
    const author = { id: undoUsers.sales, role: 'SALES' };
    const manager = { id: undoUsers.manager, role: 'BRANCH_MANAGER' };
    const created = await manualEntries.create(customer.id, dto({ kind: 'TOUCHPOINT', channel: 'WALK_IN', outcome: 'THINKING' }), author);
    if (!created.entryId) throw new Error('คาดว่าได้แถวใหม่');
    const entryId = created.entryId;
    // occurred_at ยังเป็นเวลาที่เพิ่งกด — ย้อนเฉพาะ created_at
    await undoPrisma.customerJourneyEntry.update({ where: { id: entryId }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });

    const authorView = (await chatEvents(customer.id, author)).find((e) => e.entryId === entryId);
    expect(authorView).toMatchObject({ canDelete: false, undoableUntil: null });
    const managerView = (await chatEvents(customer.id, manager)).find((e) => e.entryId === entryId);
    expect(managerView).toMatchObject({ canDelete: true, undoableUntil: null });

    await expect(manualEntries.remove(customer.id, entryId, author)).rejects.toThrow(ForbiddenException);
    await expect(manualEntries.remove(customer.id, entryId, { id: undoUsers.otherSales, role: 'SALES' })).rejects.toThrow('ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง');
    expect((await undoPrisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: entryId } })).deletedAt).toBeNull();

    const byManager = await manualEntries.remove(customer.id, entryId, manager);
    expect(byManager.summary.lastTouchAt).toBeNull();
    expect((await undoPrisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: entryId } })).deletedById).toBe(manager.id);
  });
});
```

- [ ] **Step 12: Run the service unit spec and the DB spec — expect both to fail**

```bash
(cd apps/api && npx jest src/modules/customer-journey/journey-manual-entry.service.spec.ts --runInBand)
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-manual-entry.db.spec.ts --runInBand)
```
Expected: both FAIL — ts-jest reports `Property 'remove' does not exist on type 'JourneyManualEntryService'`.

- [ ] **Step 13: Implement `remove` in the service**

In `apps/api/src/modules/customer-journey/journey-manual-entry.service.ts`, make sure these imports exist (merge the names into the existing import lines from the same modules):

```ts
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { JourneyEntryDeletedResponse } from '@installment/shared';
import { canDeleteManualEntry } from './sources/manual-entry-event';
```

Insert inside the class, directly after the closing brace of `create()`:

```ts
  /**
   * DELETE /customers/:id/journey/entries/:entryId — "เลิกทำ" แถวที่พนักงานกดเอง (soft delete)
   * ด่านตามลำดับ: ลูกค้าไม่พบ 404 → รายการไม่พบ/ไม่ใช่ของครอบครัว 404 → ไม่ใช่ MANUAL 400 → สิทธิ์ 403 → ลบไปแล้ว 200 ไม่เขียนซ้ำ
   * สิทธิ์ = canDeleteManualEntry ตัวเดียวกับ canDelete บนแถวไทม์ไลน์ (หน้าต่าง 24 ชม. นับจาก createdAt ไม่ใช่ occurredAt)
   */
  async remove(customerId: string, entryId: string, actor: { id: string; role: string }): Promise<JourneyEntryDeletedResponse> {
    // กติกาครอบครัวเดียวกับ create() — placeholder ที่รวมแล้วตามไปลูกค้าจริง · ไม่พบ/ถูกลบ = 404 'ไม่พบลูกค้า'
    const { targetId, familyIds } = await this.resolveFamily(customerId);
    const entry = await this.prisma.customerJourneyEntry.findUnique({
      where: { id: entryId },
      select: { id: true, customerId: true, origin: true, actorUserId: true, createdAt: true, deletedAt: true },
    });
    if (!entry || !familyIds.includes(entry.customerId)) throw new NotFoundException('ไม่พบรายการนี้');
    if (entry.origin !== 'MANUAL') throw new BadRequestException('ลบได้เฉพาะรายการที่พนักงานบันทึกเอง');
    const now = new Date();
    if (!canDeleteManualEntry(entry, actor, now)) throw new ForbiddenException('ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง');

    if (!entry.deletedAt) {
      // compare-and-set: กดเลิกทำพร้อมกันสองที่ = แถวถูกลบครั้งเดียว อีกคำขอได้ count 0 แล้วคืน summary เฉย ๆ
      const { count } = await this.prisma.customerJourneyEntry.updateMany({
        where: { id: entry.id, origin: 'MANUAL', deletedAt: null, customerId: { in: familyIds } },
        data: { deletedAt: now, deletedById: actor.id },
      });
      if (count > 0) {
        try {
          await this.journeyState.recompute([targetId]);
        } catch (err) {
          // แถวถูกลบแล้ว — คำตอบต้องไม่เป็น 500 · แคชค้างได้จนหมดอายุ 15 นาที/cron คืนนี้
          this.logger.warn(`journey undo recompute ล้ม customer=${targetId}: ${err instanceof Error ? err.message : err}`);
          Sentry.captureException(err, { tags: { kind: 'customer-journey', op: 'manual-entry-undo-recompute' } });
        }
      }
    }

    const summary = await this.summaries.summary(targetId, actor);
    // ครอบครัวเริ่มจากลูกค้าที่ยังไม่ถูกลบเสมอ — redirect ตรงนี้ไม่ควรเกิด
    if ('redirectToCustomerId' in summary) throw new NotFoundException('ไม่พบลูกค้า');
    return { summary };
  }
```

Do not add a second family helper: `resolveFamily()` (Task 7, private, same class) already makes exactly the Prisma calls the unit spec in Step 10 pins — `customer.findUnique({ where: { id }, select: { id: true, deletedAt: true, mergedIntoId: true } })`, a second `findUnique` with the same select for a merged placeholder's target, then `customer.findMany({ where: { mergedIntoId: targetId }, select: { id: true } })` — and it throws `NotFoundException('ไม่พบลูกค้า')` before any `customerJourneyEntry` read.

- [ ] **Step 14: Run the service unit spec and the DB spec — expect pass (both time zones for the DB spec)**

```bash
(cd apps/api && npx jest src/modules/customer-journey/journey-manual-entry.service.spec.ts --runInBand)
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-manual-entry.db.spec.ts --runInBand)
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=UTC NODE_ENV=test npx jest src/modules/customer-journey/journey-manual-entry.db.spec.ts --runInBand)
```
Expected: all PASS (Task 7 tests + 7 allowed rows + 5 forbidden rows + 7 more unit tests; Task 7 DB tests + 3 new DB tests, in both TZ runs).

- [ ] **Step 15: Write the failing controller test**

In `apps/api/src/modules/customer-journey/customer-journey.controller.spec.ts`, the constants import on line 2 (`import { PATH_METADATA } from '@nestjs/common/constants';` before Task 7) must carry all three names, and `RequestMethod` must be imported from `@nestjs/common` — merge any name Task 7 already added so no identifier is imported twice:

```ts
import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
```

and make sure the file imports the service (merge if Task 7 already added it):

```ts
import { JourneyManualEntryService } from './journey-manual-entry.service';
```

Append at the end of the file:

```ts
describe('CustomerJourneyController DELETE :id/journey/entries/:entryId', () => {
  const manualEntries = { remove: jest.fn() };
  let controller: CustomerJourneyController;

  beforeEach(async () => {
    manualEntries.remove.mockReset();
    const allow = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerJourneyController],
      providers: [
        { provide: CustomerJourneyService, useValue: {} },
        { provide: JourneyManualEntryService, useValue: manualEntries },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(allow)
      .overrideGuard(RolesGuard).useValue(allow)
      .overrideGuard(BranchGuard).useValue(allow)
      .compile();
    controller = moduleRef.get(CustomerJourneyController);
  });

  it('DELETE · 4 บทบาทเดียวกับ POST (ไม่มี ACCOUNTANT) · ไม่ตั้ง HttpCode (= 200) · ส่งต่อ id/entryId/id+role ให้ service', async () => {
    const handler = CustomerJourneyController.prototype.removeEntry;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/journey/entries/:entryId');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBeUndefined();
    const summary = { stage: 'CONTACTED' };
    manualEntries.remove.mockResolvedValue({ summary });
    const user = { id: 'u1', role: 'SALES', branchId: 'b1' };
    await expect(controller.removeEntry('c1', 'e1', user)).resolves.toEqual({ summary });
    expect(manualEntries.remove).toHaveBeenCalledWith('c1', 'e1', { id: 'u1', role: 'SALES' });
  });
});
```

- [ ] **Step 16: Run the controller spec — expect it to fail**

```bash
(cd apps/api && npx jest src/modules/customer-journey/customer-journey.controller.spec.ts --runInBand)
```
Expected: FAIL — ts-jest reports `Property 'removeEntry' does not exist on type 'CustomerJourneyController'`.

- [ ] **Step 17: Add the DELETE route**

In `apps/api/src/modules/customer-journey/customer-journey.controller.ts`:

(a) Add `Delete` to the `@nestjs/common` import (line 1), e.g. after Task 7:

```ts
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
```

(b) Add `JourneyEntryDeletedResponse` to the `@installment/shared` type import (line 8), keeping every name Task 7 added:

```ts
import type { JourneyEntryCreatedResponse, JourneyEntryDeletedResponse, JourneyListResponse, JourneyRedirect, JourneySummary } from '@installment/shared';
```

(c) Insert after the Task 7 POST handler (before the class's closing `}`):

```ts
  @Delete(':id/journey/entries/:entryId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @ApiOperation({ summary: 'เลิกทำรายการที่พนักงานบันทึกเอง — OWNER/ผู้จัดการสาขาได้ทุกแถว · คนอื่นเฉพาะของตัวเองภายใน 24 ชม. · ลบซ้ำ = 200 ไม่ทำอะไร' })
  removeEntry(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @CurrentUser() user: { id: string; role: string },
  ): Promise<JourneyEntryDeletedResponse> {
    return this.manualEntries.remove(id, entryId, { id: user.id, role: user.role });
  }
```

- [ ] **Step 18: Run the controller specs — expect pass**

```bash
(cd apps/api && npx jest src/modules/customer-journey/customer-journey.controller.spec.ts src/modules/customer-journey/customer-journey.controller.summary.spec.ts src/modules/customer-journey/customer-journey.module.spec.ts --runInBand)
```
Expected: PASS (module spec still asserts `imports` = `[]`).

- [ ] **Step 19: Run the PDPA snapshot spec — expect it to fail on the new keys**

```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/customer-journey.pdpa.db.spec.ts --runInBand)
```
Expected: FAIL in "PDPA snapshot: …" — `expect(received).toEqual(expected)` with Received `["entryId", "undoableUntil", "canDelete"]` for the TOUCHPOINT event.

- [ ] **Step 20: Allow the three keys and pin who gets them**

In `apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts`, replace line 11:

```ts
const EVENT_KEYS = ['id', 'type', 'group', 'stage', 'timestamp', 'title', 'subtitle', 'actor', 'reliability', 'origin', 'href', 'metadata'];
```

with:

```ts
// entryId / undoableUntil / canDelete = แถว MANUAL เท่านั้น (เลิกทำ — เฟส 3)
const EVENT_KEYS = ['id', 'type', 'group', 'stage', 'timestamp', 'title', 'subtitle', 'actor', 'reliability', 'origin', 'href', 'metadata', 'entryId', 'undoableUntil', 'canDelete'];
const UNDO_KEYS = ['entryId', 'undoableUntil', 'canDelete'];
```

Insert after the closing `});` of the `it('PDPA snapshot: …')` test:

```ts
  it('เลิกทำ: เฉพาะแถว MANUAL มี entryId/undoableUntil/canDelete · OWNER ลบแถวคนอื่นได้ (undoableUntil null) · ผู้จัดการการเงินไม่ได้', async () => {
    const owner = await page(ids.target, OWNER);
    const manual = owner.events.filter((e) => e.origin === 'MANUAL');
    expect(manual.length).toBeGreaterThan(0);
    for (const event of manual) {
      expect(event.id).toBe(`entry-${event.entryId}`);
      expect(event).toMatchObject({ canDelete: true, undoableUntil: null });
    }
    for (const event of owner.events.filter((e) => e.origin !== 'MANUAL')) {
      for (const key of UNDO_KEYS) expect(event).not.toHaveProperty(key);
    }
    const finance = await page(ids.target, { id: 'fm-spec', role: 'FINANCE_MANAGER' });
    const financeManual = finance.events.filter((e) => e.origin === 'MANUAL');
    expect(financeManual.length).toBeGreaterThan(0);
    for (const event of financeManual) expect(event).toMatchObject({ canDelete: false, undoableUntil: null });
  });
```

- [ ] **Step 21: Run the PDPA spec — expect pass**

```bash
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/customer-journey.pdpa.db.spec.ts --runInBand)
```
Expected: PASS (all previous tests + the new one).

- [ ] **Step 22: Update the spec API §4**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md`, replace lines 337-339:

```
4) DELETE /customers/:id/journey/entries/:entryId
- soft delete (deletedById) เฉพาะ origin=MANUAL
- ผู้บันทึกภายใน 24 ชม. หรือ OWNER/BRANCH_MANAGER
```

with:

```
4) DELETE /customers/:id/journey/entries/:entryId ("เลิกทำ" — เฟส 3)
- roles: OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES (ชุดเดียวกับ POST) · service ตัดสินสิทธิ์รายแถว
- :id ที่เป็น placeholder ที่รวมแล้วตามไป merged_into_id · ครอบครัว = ลูกค้า + placeholder ที่รวมเข้ามา · ลูกค้าไม่พบ → 404 'ไม่พบลูกค้า'
- ด่านตามลำดับ:
  - ไม่พบรายการ หรือรายการไม่ใช่ของครอบครัวนี้ → 404 'ไม่พบรายการนี้'
  - origin ไม่ใช่ MANUAL → 400 'ลบได้เฉพาะรายการที่พนักงานบันทึกเอง'
  - OWNER/BRANCH_MANAGER ลบได้ทุกแถวทุกเวลา · FINANCE_MANAGER/SALES เฉพาะแถวที่ตัวเองบันทึก ภายใน 24 ชม. นับจาก created_at (ไม่ใช่ occurred_at · ครบ 24 ชม. พอดียังลบได้) · อื่น ๆ → 403 'ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง'
  - ลบไปแล้ว (กดเลิกทำซ้ำ) → 200 { summary } ไม่เขียนซ้ำ
- เขียนแบบ compare-and-set: updateMany where id + origin MANUAL + deleted_at null + customer_id ในครอบครัว → set deleted_at, deleted_by_id · count 0 (มีคำขออื่นเลิกทำไปก่อน) = 200 ไม่คำนวณใหม่
- หลังเขียน recompute([ลูกค้า]) ใน try/catch + Sentry (kind customer-journey · op manual-entry-undo-recompute) แล้วคืน 200 { summary }
- ฝั่งอ่าน: ทุกแถว MANUAL ใน GET /customers/:id/journey และ event ในคำตอบ POST มี entryId, undoableUntil (ผู้บันทึกที่ยังอยู่ในหน้าต่าง = created_at + 24 ชม. · อื่น ๆ null), canDelete (กติกาเดียวกับด่าน 403 — canDeleteManualEntry · เว็บแสดงลิงก์ "เลิกทำ" ตามค่านี้) · แถว SOURCE/SYSTEM_ENTRY ไม่มีสามคีย์นี้ · ยังไม่ select note
```

- [ ] **Step 23: Full verification — typecheck, lint touched files, whole journey module**

```bash
(cd apps/api && npx tsc --noEmit -p tsconfig.json)
(cd apps/api && npx eslint src/modules/customer-journey/journey-manual-entry.service.ts src/modules/customer-journey/journey-manual-entry.service.spec.ts src/modules/customer-journey/journey-manual-entry.db.spec.ts src/modules/customer-journey/sources/manual-entry-event.ts src/modules/customer-journey/sources/manual-entry-event.spec.ts src/modules/customer-journey/sources/entries.source.ts src/modules/customer-journey/sources/entries.source.spec.ts src/modules/customer-journey/customer-journey.controller.ts src/modules/customer-journey/customer-journey.controller.spec.ts src/modules/customer-journey/customer-journey.pdpa.db.spec.ts)
(cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey --runInBand)
```
Expected: `tsc` 0 errors; eslint no errors (warnings that already exist on untouched lines are acceptable); every suite under `src/modules/customer-journey` PASS.

- [ ] **Step 24: Commit**

```bash
git add apps/api/src/modules/customer-journey/journey-manual-entry.service.ts \
  apps/api/src/modules/customer-journey/journey-manual-entry.service.spec.ts \
  apps/api/src/modules/customer-journey/journey-manual-entry.db.spec.ts \
  apps/api/src/modules/customer-journey/sources/manual-entry-event.ts \
  apps/api/src/modules/customer-journey/sources/manual-entry-event.spec.ts \
  apps/api/src/modules/customer-journey/sources/entries.source.ts \
  apps/api/src/modules/customer-journey/sources/entries.source.spec.ts \
  apps/api/src/modules/customer-journey/customer-journey.controller.ts \
  apps/api/src/modules/customer-journey/customer-journey.controller.spec.ts \
  apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts \
  docs/superpowers/specs/2026-09-15-customer-journey-design.md
git commit -F - <<'EOF'
feat(customer-journey): เลิกทำรายการที่พนักงานกด — DELETE /customers/:id/journey/entries/:entryId + entryId/undoableUntil/canDelete บนแถว MANUAL

- OWNER/ผู้จัดการสาขาเลิกทำได้ทุกแถวทุกเวลา · ผู้จัดการการเงิน/พนักงานขาย เฉพาะแถวของตัวเองภายใน 24 ชม. นับจาก created_at (Q5)
- ลบซ้ำ/ลบพร้อมกัน = 200 ไม่เขียนซ้ำ (compare-and-set ในครอบครัว) · คำนวณแคชใหม่ใน try/catch + Sentry แล้วคืน summary
- canDeleteManualEntry ตัวเดียวใช้ทั้งด่าน 403 และ canDelete บนไทม์ไลน์ (Q18) · GET และ POST ส่งคีย์เลิกทำเฉพาะแถว MANUAL · ยังไม่ select note
- สเปก API ข้อ 4 + PDPA snapshot รับคีย์ใหม่

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```
Expected: one commit containing exactly the 11 paths above (`git show --stat HEAD`).

---

### Task 9: Facebook ad attribution correctness (ADS referrals only)

Goal: before ad data starts flowing, only Meta referrals whose `referral.source` is `'ADS'` create `ads_campaigns` / `ads_attributions` rows, re-point a chat room, post the "ลูกค้าทักจากโฆษณา" system note, or become `first_source = 'AD:<campaign>'` in the journey cache. Product m.me links (`SHORTLINK`) and source-less referrals keep only their product note ("ลูกค้ากดมาจากสินค้า …"). Brief §0 ruling 7 · research-infra §2.2–2.7. Backend only, no migration.

Line numbers below are from the base `origin/main` `10d6e6d3a`. T1–T8 do not touch `chat-engine/` or `chat-adapters/`, so those line numbers should still hold. `journey-state.sql`, the spec doc and the runbook are edited by earlier tasks (T2/T3/T5/T6/T7), so **every edit below is anchored by its exact old text, never by line number**. Prod today (MCP counts, 2026-09-15): `ads_campaigns` 0 · `ads_attributions` 0 · `first_source LIKE 'AD:%'` 0 ⇒ the fix is preventive; no data correction is expected.

This task reverses part of commit `5f0dc62c4` (#1590): ref-only product links will no longer write an `ads_attributions` row. The controller keeps calling `recordAdReferral` for every referral (the gate lives in one place — the router / room manager).

**Files:**
- Create: `apps/api/src/modules/chat-engine/utils/ad-attribution.util.ts`
- Create: `apps/api/src/modules/chat-engine/utils/ad-attribution.util.spec.ts`
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts`
  - import block (HEAD L1 — one line added after the `InboundAttribution` type import)
  - comment above the existing-room `linkAttribution` call inside `getOrCreateRoom` (HEAD L209)
  - `linkAttribution` jsdoc + first statement inside `try` (HEAD L307-319)
- Test (modify): `apps/api/src/modules/chat-engine/services/room-manager.attribution.spec.ts` — append 4 tests after the `'DB ล้ม → คืน null ไม่โยน …'` test (HEAD L99-102), before the closing `});` (HEAD L103)
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts`
  - import block (HEAD L23 — one line added after the `MAX_BOT_ATTACHMENTS` import)
  - inline ad-note gate in `routeInboundInner` (HEAD L184-187)
  - `recordAdReferral` jsdoc + first statement (HEAD L1011-1020)
- Test (modify): `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts` — describe `'MessageRouterService — ที่มาจากโฆษณา (PR-A referral)'` (HEAD L851-906): append 3 tests after `'โฆษณาไม่มีชื่อ → โน้ตใช้เลขโฆษณาแทน ไม่ว่าง'` (HEAD L899-905)
- Modify: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` — standalone-referral comment (HEAD L328-333), comment only
- Test (modify): `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` — test title + comment (HEAD L622-624) and test title (HEAD L644); assertions unchanged
- Modify: `apps/api/src/modules/customer-journey/sql/journey-state.sql` — CTE `earliest_room`, the `LEFT JOIN ads_attributions` line (HEAD L40)
- Create: `apps/api/src/modules/customer-journey/journey-state.ads.db.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md` — event table row that starts with `| AD_REFERRAL |` (HEAD L257)
- Modify: `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` (created by T2) — `## ลำดับห้ามสลับ` rows 1-2 (row 1 as T3 left it, ending `(1.6) |`); new `### 1.5` directly before T3's `### 1.6` (so §1 reads 1.1 … 1.4, 1.5, 1.6, then `## 2.`); new `### 2.1` before `## 3.`; new `### ถอยกับที่มาโฆษณา` right under `## ถอย (rollback)` (T2 reserved `### 1.5` for this task)

**Interfaces:**

Consumes:
- T3 has landed (only to serialise edits to `journey-state.sql`; this task uses no T3 symbol).
- T2 has created `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` with `## ลำดับห้ามสลับ`, `## 1. 🚨 ด่านก่อน merge` (`### 1.1`–`### 1.4`), `## 2. merge PR นี้ + ด่านหลัง merge`, ``## 3. `backfill:customer-journey` dry-run``, `## 4. รันจริง`, `## 5.` and `## ถอย (rollback)` → `### ถอยเพราะลำดับขั้น`.
- T3 has added `### 1.6 นับห้องที่ลูกค้าส่งไฟล์ในแชท (MCP นับอย่างเดียว · Task 3)` right after `### 1.4` (before `## 2.`) and changed order-table row 1 to end with `· นับห้องที่ลูกค้าส่งไฟล์ในแชท (1.6) |`.
- `InboundAttribution` (`apps/api/src/modules/chat-engine/interfaces/channel-adapter.interface.ts`):
  `{ utmSource?: string; utmCampaign?: string; utmContent?: string; referrerUrl?: string; adId?: string; adTitle?: string; adPhotoUrl?: string; postId?: string }`
- `buildFbAttribution(referral: any): InboundAttribution | undefined` (`facebook-webhook.controller.ts`) — always sets `utmSource: 'facebook'` and copies Meta `referral.source` into `referrerUrl` (`'ADS' | 'SHORTLINK' | undefined`).
- `RoomManagerService.linkAttribution(roomId: string, attribution: InboundAttribution, currentAttributionId: string | null): Promise<{ campaignName: string; adTitle: string | null; changed: boolean } | null>` — every caller ignores the return value.
- `RoomManagerService.findByExternalUser(externalUserId: string, channel: ChatChannel): Promise<{ id: string; attributionId: string | null } | null>`
- `MessageRouterService.recordAdReferral(externalUserId: string, channel: ChatChannel, attribution: InboundAttribution): Promise<void>`
- `JourneyStateService.recompute(customerIds: string[]): Promise<void>` (constructed in DB specs as `new JourneyStateService(prisma as any)`).
- Prisma models `AdsCampaign` (`platform`, `campaignId`, `campaignName`; `@@unique([platform, campaignId])`), `AdsAttribution` (`campaignId`, `utmSource`, `referrerUrl`, `firstTouch`; no `deletedAt`), `ChatRoom.attributionId` (FK to `ads_attributions`), `CustomerJourneyState` (`firstChannel`, `firstSource`, `firstAdCampaignId`, `contactedAt`).

Produces:
- `apps/api/src/modules/chat-engine/utils/ad-attribution.util.ts`:
  ```ts
  export const AD_REFERRAL_SOURCE = 'ADS';
  export function isAdAttribution(a: Pick<InboundAttribution, 'referrerUrl'> | null | undefined): boolean;
  // strict `a?.referrerUrl === 'ADS'` — no case folding, no adId fallback
  ```
- `RoomManagerService.linkAttribution`: first statement inside `try` is `if (!isAdAttribution(attribution)) return null;` (no campaign/attribution read or write, no room re-point); jsdoc updated. ADS → newer ADS re-point and "same ad → lastTouch" behave as before.
- `MessageRouterService.recordAdReferral`: returns before `findByExternalUser` when not ADS.
- Inline note gate in `routeInboundInner`: `if (message.attribution && isAdAttribution(message.attribution))` (was `message.attribution?.adId`; the `message.attribution &&` is only there so TypeScript narrows the `postAdReferralNote` argument — `isAdAttribution` returns a plain `boolean`).
- `journey-state.sql` CTE `earliest_room`: `LEFT JOIN ads_attributions aa ON aa.id = ro.attribution_id AND aa.referrer_url = 'ADS'` with a comment pointing at `AD_REFERRAL_SOURCE`; earliest-room selection unchanged; no `ads_campaigns.deleted_at` filter. A unit test pins the SQL literal to the constant.
- Spec event table `AD_REFERRAL` row: ADS only. Runbook `### 1.5` pre-merge count `SELECT count(*) FROM ads_attributions WHERE referrer_url IS DISTINCT FROM 'ADS'` (must be 0 to skip cleanup) · `### 2.1` owner-approved cache cleanup + recompute via steps 3–4 when it is not 0 · rollback note.

API DB test database used below (per-file TDD DB of plans 1-2, all migrations applied, session timezone Asia/Bangkok):
`postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public`

---

- [ ] **Step 1: Confirm the anchors this task edits still exist**

```bash
grep -n "LEFT JOIN ads_attributions aa ON aa.id = ro.attribution_id" apps/api/src/modules/customer-journey/sql/journey-state.sql
grep -n "if (message.attribution?.adId) {" apps/api/src/modules/chat-engine/services/message-router.service.ts
grep -n "ลูกค้าเก่ากดโฆษณา/ลิงก์ซ้ำ" apps/api/src/modules/chat-engine/services/room-manager.service.ts
grep -n "^| AD_REFERRAL |" docs/superpowers/specs/2026-09-15-customer-journey-design.md
ls docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -n '^### 1.4 \|^### 1.6 \|^## 2. merge PR นี้\|^## 3. `backfill\|^## ถอย (rollback)\|^### ถอยเพราะลำดับขั้น\|^| 1 | ด่านก่อน merge\|^| 2 | merge PR นี้' docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
ls apps/api/src/modules/chat-engine/utils/
```

Expected: each of the first four `grep`s prints exactly one line; the join line has **no** `referrer_url` yet; the runbook file exists (T2) and the runbook `grep` prints 8 lines (table rows `| 1 |` — ending `(1.6) |` — and `| 2 |`, `### 1.4`, `### 1.6` (T3), `## 2.`, `## 3.`, `## ถอย (rollback)`, `### ถอยเพราะลำดับขั้น`); no `### 1.5` exists yet; `utils/` lists only `sticker-token.util.ts`. If the join line is missing or already filtered, stop and re-read the CTE — do not guess.

- [ ] **Step 2: Write the failing util test**

Create `apps/api/src/modules/chat-engine/utils/ad-attribution.util.spec.ts`:

```ts
import type { InboundAttribution } from '../interfaces/channel-adapter.interface';
import { AD_REFERRAL_SOURCE, isAdAttribution } from './ad-attribution.util';

/**
 * นับเป็นโฆษณาเฉพาะ referral.source = 'ADS' (เจ้าของเคาะ 2026-09-15 ข้อ 7)
 * ด่านเดียวของ linkAttribution / recordAdReferral / โน้ต "ลูกค้าทักจากโฆษณา"
 */
describe('isAdAttribution', () => {
  it('AD_REFERRAL_SOURCE = ADS (ค่า Meta referral.source ของโฆษณาจริง)', () => {
    expect(AD_REFERRAL_SOURCE).toBe('ADS');
  });

  it.each<[string, boolean]>([
    ['ADS', true],
    ['SHORTLINK', false],
    ['ads', false],
    ['', false],
  ])('referrerUrl %p → %p (เทียบตรงตัว ไม่แปลงตัวพิมพ์)', (referrerUrl, expected) => {
    expect(isAdAttribution({ referrerUrl })).toBe(expected);
  });

  it('ไม่มี referrerUrl / ไม่มี attribution → ไม่ใช่โฆษณา', () => {
    expect(isAdAttribution({ referrerUrl: undefined })).toBe(false);
    expect(isAdAttribution({})).toBe(false);
    expect(isAdAttribution(null)).toBe(false);
    expect(isAdAttribution(undefined)).toBe(false);
  });

  it('มี adId แต่ source ไม่ใช่ ADS → ไม่ใช่โฆษณา (ไม่ถอยไปดู adId)', () => {
    const shortlinkWithAdId: InboundAttribution = {
      utmSource: 'facebook',
      referrerUrl: 'SHORTLINK',
      adId: '120246504706250534',
    };
    const adIdOnly: InboundAttribution = { utmSource: 'facebook', adId: '120246504706250534' };
    expect(isAdAttribution(shortlinkWithAdId)).toBe(false);
    expect(isAdAttribution(adIdOnly)).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd apps/api && npx jest src/modules/chat-engine/utils/ad-attribution.util.spec.ts --runInBand
```

Expected: `FAIL` — `Test suite failed to run` with `TS2307: Cannot find module './ad-attribution.util' or its corresponding type declarations.`

- [ ] **Step 4: Create the util**

Create `apps/api/src/modules/chat-engine/utils/ad-attribution.util.ts`:

```ts
import type { InboundAttribution } from '../interfaces/channel-adapter.interface';

/**
 * ค่า Meta `referral.source` ของโฆษณาจริง (click-to-Messenger) — buildFbAttribution
 * (chat-adapters/facebook-webhook.controller.ts) คัดลอก referral.source มาไว้ที่ `referrerUrl`
 * ค่าอื่นที่เจอจริง: 'SHORTLINK' = ลิงก์ m.me ของหน้าสินค้าบนเว็บร้าน (ไม่ใช่โฆษณา)
 * 🚨 customer-journey/sql/journey-state.sql (CTE earliest_room) ใช้ literal เดียวกัน — แก้ต้องแก้คู่
 */
export const AD_REFERRAL_SOURCE = 'ADS';

/**
 * referral นี้นับเป็น "ทักจากโฆษณา" หรือไม่ (เจ้าของเคาะ 2026-09-15 ข้อ 7)
 * เทียบตรงตัวเท่านั้น — ไม่แปลงตัวพิมพ์ ไม่ถอยไปดู adId — ให้ TypeScript กับ SQL ตัดสินตรงกันเสมอ
 */
export function isAdAttribution(
  a: Pick<InboundAttribution, 'referrerUrl'> | null | undefined,
): boolean {
  return a?.referrerUrl === AD_REFERRAL_SOURCE;
}
```

- [ ] **Step 5: Run the util test and watch it pass**

```bash
cd apps/api && npx jest src/modules/chat-engine/utils/ad-attribution.util.spec.ts --runInBand
```

Expected: `PASS` — `Tests: 7 passed, 7 total`.

- [ ] **Step 6: Add the room-manager tests (non-ADS never writes, ADS may replace a legacy non-ADS pointer)**

In `apps/api/src/modules/chat-engine/services/room-manager.attribution.spec.ts` replace:

```ts
    await expect(service.linkAttribution('room-1', AD, null)).resolves.toBeNull();
  });
});
```

with:

```ts
    await expect(service.linkAttribution('room-1', AD, null)).resolves.toBeNull();
  });

  // ── เจ้าของเคาะ 2026-09-15 ข้อ 7: นับเป็นโฆษณาเฉพาะ referral.source = 'ADS' ─────────────
  /** ลิงก์ m.me ของหน้าสินค้าบนเว็บร้าน — buildFbAttribution จาก { ref: 'p:abc', source: 'SHORTLINK' } */
  const PRODUCT_LINK = {
    utmSource: 'facebook',
    utmCampaign: 'p:abc',
    utmContent: 'p:abc',
    referrerUrl: 'SHORTLINK',
  };
  /** จำลองว่าถ้าเขียนได้จะเขียนสำเร็จ — เทสต้องล้มเพราะ "ถูกเรียก" ไม่ใช่เพราะ mock คืน undefined */
  function mockWritesSucceed() {
    prisma.adsCampaign.findFirst.mockResolvedValue(null);
    prisma.adsCampaign.create.mockResolvedValue({ id: 'c-link', campaignName: 'p:abc', adName: null, adPhotoUrl: null });
    prisma.adsAttribution.create.mockResolvedValue({ id: 'a-link' });
  }
  function expectNoAttributionWrites() {
    expect(prisma.adsCampaign.findFirst).not.toHaveBeenCalled();
    expect(prisma.adsCampaign.create).not.toHaveBeenCalled();
    expect(prisma.adsCampaign.update).not.toHaveBeenCalled();
    expect(prisma.adsAttribution.findUnique).not.toHaveBeenCalled();
    expect(prisma.adsAttribution.create).not.toHaveBeenCalled();
    expect(prisma.adsAttribution.update).not.toHaveBeenCalled();
    expect(prisma.chatRoom.update).not.toHaveBeenCalled();
  }

  it('ลิงก์สินค้า (SHORTLINK) บนห้องที่ยังไม่มีที่มา → คืน null ไม่สร้างแคมเปญ/attribution ไม่แตะห้อง', async () => {
    mockWritesSucceed();

    const res = await service.linkAttribution('room-1', PRODUCT_LINK, null);

    expect(res).toBeNull();
    expectNoAttributionWrites();
  });

  it('referral ที่ไม่มี source (Meta ส่ง {} → มีแต่ utmSource) → คืน null ไม่เขียนอะไร', async () => {
    mockWritesSucceed();

    const res = await service.linkAttribution('room-1', { utmSource: 'facebook' }, null);

    expect(res).toBeNull();
    expectNoAttributionWrites();
  });

  it('ห้องที่ชี้โฆษณา ADS อยู่ + ลิงก์สินค้า → ไม่อ่าน/ไม่สร้าง/ไม่ชี้ห้องใหม่ ห้องยังอยู่กับที่มาโฆษณาเดิม', async () => {
    mockWritesSucceed();
    prisma.adsAttribution.findUnique.mockResolvedValue({ id: 'a-ads', campaignId: 'c-ads' });

    const res = await service.linkAttribution('room-1', PRODUCT_LINK, 'a-ads');

    expect(res).toBeNull();
    expectNoAttributionWrites();
  });

  it('ห้องที่ชี้ที่มาเก่าที่ไม่ใช่โฆษณา + โฆษณา ADS → attribution ใหม่ และห้องชี้ไปที่โฆษณา (อนุญาต)', async () => {
    prisma.adsCampaign.findFirst.mockResolvedValue(null);
    prisma.adsCampaign.create.mockResolvedValue({ id: 'c1', campaignName: AD.adTitle, adName: AD.adTitle, adPhotoUrl: AD.adPhotoUrl });
    prisma.adsAttribution.findUnique.mockResolvedValue({ id: 'a-legacy-link', campaignId: 'c-legacy-link' });
    prisma.adsAttribution.create.mockResolvedValue({ id: 'a-ads-new' });

    const res = await service.linkAttribution('room-1', AD, 'a-legacy-link');

    expect(prisma.adsAttribution.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ campaignId: 'c1', referrerUrl: 'ADS' }) }),
    );
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { attributionId: 'a-ads-new' } });
    expect(res?.changed).toBe(true);
  });
});
```

- [ ] **Step 7: Run it and watch the three non-ADS tests fail**

```bash
cd apps/api && npx jest src/modules/chat-engine/services/room-manager.attribution.spec.ts --runInBand
```

Expected: `Tests: 3 failed, 6 passed, 9 total`. The failing three are the SHORTLINK, source-less and "ห้องที่ชี้โฆษณา ADS อยู่" tests, each at `expect(res).toBeNull()` with `Received: {"adTitle": null, "campaignName": "p:abc", "changed": true}`. The legacy-pointer test and the original 5 pass.

- [ ] **Step 8: Gate `linkAttribution` in `room-manager.service.ts`**

(a) Replace the first line of the file:

```ts
import type { InboundAttribution } from '../interfaces/channel-adapter.interface';
```

with:

```ts
import type { InboundAttribution } from '../interfaces/channel-adapter.interface';
import { isAdAttribution } from '../utils/ad-attribution.util';
```

(b) Inside `getOrCreateRoom` (existing-room branch) replace:

```ts
      // ลูกค้าเก่ากดโฆษณา/ลิงก์ซ้ำ — บันทึกที่มาครั้งล่าสุดให้ห้องเดิมด้วย (เดิมบันทึกเฉพาะห้องใหม่)
```

with:

```ts
      // ลูกค้าเก่ากดโฆษณาซ้ำ — บันทึกที่มาครั้งล่าสุดให้ห้องเดิมด้วย (เดิมบันทึกเฉพาะห้องใหม่)
      // ลิงก์สินค้า/ref อื่นที่ไม่ใช่ ADS ถูก linkAttribution ทิ้งเอง ⇒ ห้องที่ชี้โฆษณาอยู่ไม่ถูกชี้ไปที่มาอื่น
```

(The `if (params.attribution?.utmSource)` gates at both call sites stay unchanged — `linkAttribution` is the single choke point.)

(c) Replace:

```ts
  /**
   * ผูก "ที่มา" (โฆษณา/UTM) ให้ห้อง — ท่าเดียวกับ OBI `Util\Facebook::ads` + `chat_room.facebook_ad_id`:
   * แคมเปญคีย์ด้วย ad_id · ชื่อ/รูปโฆษณาเติมจาก ads_context_data เมื่อมี (ครั้งแรกอาจว่าง ครั้งหลังเติมได้) ·
   * ห้องที่มีที่มาอยู่แล้วและมาจากโฆษณา "ตัวเดิม" → อัปเดต lastTouch · โฆษณา "ตัวใหม่" → attribution ใหม่
   * แล้วชี้ห้องไปที่ล่าสุด (พนักงานต้องรู้ว่าลูกค้าเพิ่งเห็นชิ้นไหน ไม่ใช่ชิ้นแรกเมื่อ 3 เดือนก่อน)
   * best-effort ทั้งก้อน — ห้ามทำให้ webhook/การสร้างห้องล้ม
   */
  async linkAttribution(
    roomId: string,
    attribution: InboundAttribution,
    currentAttributionId: string | null,
  ): Promise<{ campaignName: string; adTitle: string | null; changed: boolean } | null> {
    try {
      const platformMap: Record<string, AdsPlatform> = {
```

with:

```ts
  /**
   * ผูก "ที่มาโฆษณา" ให้ห้อง — ท่าเดียวกับ OBI `Util\Facebook::ads` + `chat_room.facebook_ad_id`:
   * นับเป็นโฆษณาเฉพาะ referral.source = 'ADS' (`isAdAttribution` — journey-state.sql ใช้ literal เดียวกัน)
   * ⇒ ลิงก์สินค้า m.me (SHORTLINK) / referral ที่ไม่มี source คืน null ทันที: ไม่สร้างแคมเปญ ไม่สร้าง attribution
   *   ไม่ชี้ห้องใหม่ — ห้องที่ชี้โฆษณาอยู่จึงไม่มีทางถูกชี้ไปที่มาที่ไม่ใช่โฆษณา (เจ้าของเคาะ 2026-09-15 ข้อ 7 ·
   *   กลับทิศของ 5f0dc62c4 ที่เคยบันทึกลิงก์สินค้าเป็นที่มา — โน้ตสินค้ายังมาจาก handleProductReferral)
   * แคมเปญคีย์ด้วย ad_id · ชื่อ/รูปโฆษณาเติมจาก ads_context_data เมื่อมี (ครั้งแรกอาจว่าง ครั้งหลังเติมได้) ·
   * ห้องที่มีที่มาอยู่แล้วและมาจากโฆษณา "ตัวเดิม" → อัปเดต lastTouch · โฆษณา "ตัวใหม่" → attribution ใหม่
   * แล้วชี้ห้องไปที่ล่าสุด (พนักงานต้องรู้ว่าลูกค้าเพิ่งเห็นชิ้นไหน ไม่ใช่ชิ้นแรกเมื่อ 3 เดือนก่อน)
   * best-effort ทั้งก้อน — ห้ามทำให้ webhook/การสร้างห้องล้ม
   */
  async linkAttribution(
    roomId: string,
    attribution: InboundAttribution,
    currentAttributionId: string | null,
  ): Promise<{ campaignName: string; adTitle: string | null; changed: boolean } | null> {
    try {
      // ไม่ใช่โฆษณา: ไม่สร้างแคมเปญ ไม่สร้าง attribution ไม่ชี้ห้องใหม่ (ห้องที่ชี้โฆษณาอยู่คงเดิม)
      if (!isAdAttribution(attribution)) return null;
      const platformMap: Record<string, AdsPlatform> = {
```

- [ ] **Step 9: Run the room-manager specs and watch them pass**

```bash
cd apps/api && npx jest src/modules/chat-engine/services/room-manager.attribution.spec.ts src/modules/chat-engine/services/room-manager.service.spec.ts --runInBand
```

Expected: `Test Suites: 2 passed, 2 total` (attribution spec `9 passed`; `room-manager.service.spec.ts` unchanged and green).

- [ ] **Step 10: Add the message-router tests (no router work for non-ADS, inline note gate = ADS)**

In `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts`, inside describe `'MessageRouterService — ที่มาจากโฆษณา (PR-A referral)'`, replace:

```ts
      expect.objectContaining({ role: MessageRole.SYSTEM, text: 'ลูกค้าทักจากโฆษณา · โฆษณา 120246504706250534' }),
    );
  });
});
```

with:

```ts
      expect.objectContaining({ role: MessageRole.SYSTEM, text: 'ลูกค้าทักจากโฆษณา · โฆษณา 120246504706250534' }),
    );
  });

  // เจ้าของเคาะ 2026-09-15 ข้อ 7: นับเป็นโฆษณาเฉพาะ referral.source = 'ADS' (isAdAttribution)
  it.each([
    ['ลิงก์สินค้า m.me (SHORTLINK)', { utmSource: 'facebook', utmCampaign: 'p:abc', utmContent: 'p:abc', referrerUrl: 'SHORTLINK' }],
    ['referral ที่ไม่มี source', { utmSource: 'facebook' }],
  ])('recordAdReferral: %s → ไม่หาห้อง ไม่ผูกที่มา ไม่มีโน้ตโฆษณา', async (_label, attribution) => {
    const { router, roomManager } = makeRouter({});
    (roomManager as any).findByExternalUser = jest.fn().mockResolvedValue({ id: 'r-old', attributionId: 'a-ads' });
    (roomManager as any).linkAttribution = jest.fn().mockResolvedValue(null);

    await router.recordAdReferral('PSID-1', ChatChannel.FACEBOOK, attribution);

    expect((roomManager as any).findByExternalUser).not.toHaveBeenCalled();
    expect((roomManager as any).linkAttribution).not.toHaveBeenCalled();
    expect(roomManager.saveMessage).not.toHaveBeenCalled();
  });

  it('ข้อความที่มี adId แต่ไม่มี source ADS → ไม่มีโน้ต "ลูกค้าทักจากโฆษณา" (ด่านเดียวกับ recordAdReferral ไม่ใช่ adId)', async () => {
    const { router, roomManager } = makeRouter({});
    await router.routeInbound({
      ...baseMsg,
      channel: ChatChannel.FACEBOOK,
      attribution: { utmSource: 'facebook', utmCampaign: '1', adId: '1', referrerUrl: undefined },
    } as any);
    const adNotes = roomManager.saveMessage.mock.calls.filter(
      (c) => c[0].role === MessageRole.SYSTEM && String(c[0].text).startsWith('ลูกค้าทักจากโฆษณา'),
    );
    expect(adNotes).toHaveLength(0);
  }, 10000);
});
```

(`routeInbound` tests in this describe take ≈3 s each because of the inbound debounce — hence the explicit `10000` timeout.)

- [ ] **Step 11: Run it and watch the three new tests fail**

```bash
cd apps/api && npx jest src/modules/chat-engine/services/message-router.service.spec.ts --runInBand
```

Expected: `Tests: 3 failed, 47 passed, 50 total`. Both `recordAdReferral: …` cases fail at `expect((roomManager as any).findByExternalUser).not.toHaveBeenCalled()` (`Received number of calls: 1`); the adId test fails at `expect(adNotes).toHaveLength(0)` with `Received length: 1` (`"ลูกค้าทักจากโฆษณา · โฆษณา 1"`).

- [ ] **Step 12: Gate `recordAdReferral` and the inline note in `message-router.service.ts`**

(a) Replace:

```ts
import { MAX_BOT_ATTACHMENTS } from '../../../utils/bot-attachments.util';
```

with:

```ts
import { MAX_BOT_ATTACHMENTS } from '../../../utils/bot-attachments.util';
import { isAdAttribution } from '../utils/ad-attribution.util';
```

(b) In `routeInboundInner` replace:

```ts
    // ทักจากโฆษณา → โน้ตระบบในห้อง ตรงเวลาที่เกิด (ท่า OBI logNotify) — ไม่ต้องเปิดแผงขวาก็เห็น
    if (message.attribution?.adId) {
```

with:

```ts
    // ทักจากโฆษณา → โน้ตระบบในห้อง ตรงเวลาที่เกิด (ท่า OBI logNotify) — ไม่ต้องเปิดแผงขวาก็เห็น
    // ด่านเดียวกับ linkAttribution / recordAdReferral: referral.source = 'ADS' เท่านั้น (ไม่ใช่แค่มี adId)
    if (message.attribution && isAdAttribution(message.attribution)) {
```

(Without `message.attribution &&` the next line fails `tsc` with TS2345 — `isAdAttribution` returns `boolean`, not a type guard.)

(c) Replace:

```ts
  /**
   * ลูกค้าเก่ากลับมาจากโฆษณา (event messaging_referrals ไม่มี message) — ผูกที่มาให้ห้องเดิม + โน้ตระบบ
   * ไม่มีห้อง = ไม่ทำอะไร (ห้องจะถูกสร้างพร้อม attribution เมื่อข้อความแรกมาถึง)
   */
  async recordAdReferral(
    externalUserId: string,
    channel: ChatChannel,
    attribution: InboundAttribution,
  ): Promise<void> {
    const room = await this.roomManager.findByExternalUser(externalUserId, channel);
```

with:

```ts
  /**
   * ลูกค้าเก่ากลับมาจากโฆษณา (event messaging_referrals ไม่มี message) — ผูกที่มาให้ห้องเดิม + โน้ตระบบ
   * ไม่มีห้อง = ไม่ทำอะไร (ห้องจะถูกสร้างพร้อม attribution เมื่อข้อความแรกมาถึง)
   * ไม่ใช่โฆษณา (referral.source ≠ 'ADS' เช่นลิงก์สินค้า m.me) = ไม่ทำอะไรเลย ก่อนแตะ DB
   * — โน้ต "ลูกค้ากดมาจากสินค้า …" มาจาก handleProductReferral ใน controller อยู่แล้ว (เจ้าของเคาะ 2026-09-15 ข้อ 7)
   */
  async recordAdReferral(
    externalUserId: string,
    channel: ChatChannel,
    attribution: InboundAttribution,
  ): Promise<void> {
    if (!isAdAttribution(attribution)) return;
    const room = await this.roomManager.findByExternalUser(externalUserId, channel);
```

- [ ] **Step 13: Run the router, webhook and neighbour specs and watch them pass**

```bash
cd apps/api && npx jest src/modules/chat-engine/services/message-router.service.spec.ts src/modules/chat-adapters/facebook-webhook.controller.spec.ts src/modules/chat-adapters/fb-attribution.spec.ts src/modules/customer-journey/chat-identity-entries.spec.ts --runInBand
```

Expected: `Test Suites: 4 passed, 4 total` (router `50 passed`). `chat-identity-entries.spec.ts` reads `message-router.service.ts` source for handoff texts — it must stay green.

- [ ] **Step 14: Correct the webhook comment and the two spec titles that describe the old behaviour (no logic change)**

(a) In `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` (standalone-referral branch) replace:

```ts
      // 🔴 เดิม gate ด้วย `adAttribution?.adId` ⇒ ลิงก์สินค้าจากเว็บร้าน
      // (m.me/<page>?ref=p:<id> — `copy.ts` / `ProductDetailPage.tsx`) มีแต่ `ref` ไม่มี `ad_id`
      // จึง **ไม่เคยถูกบันทึกเลยสักครั้ง** ทั้งที่เส้นลูกค้าใหม่ (message.referral ด้านล่าง)
      // ไม่มี gate นี้ ⇒ ลูกค้าเก่ากับลูกค้าใหม่กดลิงก์เดียวกันแล้วได้ผลต่างกัน = บั๊ก ไม่ใช่ดีไซน์
      // `linkAttribution` รองรับอยู่แล้ว: campaignKey = adId ?? utmCampaign ?? 'organic'
      // และแยกโฆษณากับลิงก์สินค้าได้จาก `referrerUrl` (ADS vs SHORTLINK)
      if (adAttribution) {
```

with:

```ts
      // ส่งทุก referral ต่อให้ router — ด่าน "โฆษณาจริงเท่านั้น" (referral.source = 'ADS') อยู่ที่ `isAdAttribution`
      // (chat-engine/utils/ad-attribution.util.ts) ซึ่ง recordAdReferral และ linkAttribution ใช้ตัวเดียวกัน
      // ⇒ ลิงก์สินค้าจากเว็บร้าน (m.me/<page>?ref=p:<id> — source SHORTLINK) ไม่สร้างแคมเปญ/ที่มา ไม่ชี้ห้องใหม่
      //   ไม่มีโน้ตโฆษณา (เจ้าของเคาะ 2026-09-15 ข้อ 7 — กลับทิศของ 5f0dc62c4 ที่เคยบันทึกลิงก์สินค้าเป็นที่มา)
      //   โน้ต "ลูกค้ากดมาจากสินค้า …" ยังมาจาก handleProductReferral ข้างล่างตามเดิม
      // ลูกค้าเก่ากับลูกค้าใหม่ได้ผลเดียวกัน: เส้น message.referral ผ่านด่านเดียวกันใน getOrCreateRoom → linkAttribution
      if (adAttribution) {
```

(b) In `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` replace:

```ts
  it('ลิงก์สินค้า m.me ของลูกค้าเก่า (มี ref ไม่มี ad_id) → บันทึกที่มาด้วย ไม่ใช่แค่โน้ต', async () => {
    // เดิม gate `if (adAttribution?.adId)` ⇒ SHORTLINK ไม่เคยถูกบันทึกเลยสักครั้ง
    // ทั้งที่เส้นลูกค้าใหม่ (message.referral) ไม่มี gate นี้ = ผลต่างกันบนลิงก์เดียวกัน
```

with:

```ts
  it('ลิงก์สินค้า m.me ของลูกค้าเก่า (มี ref ไม่มี ad_id) → ส่ง referral ต่อให้ router + โพสต์โน้ตสินค้า (router ไม่นับเป็นโฆษณา)', async () => {
    // controller ส่งทุก referral ให้ recordAdReferral — ด่าน ADS อยู่ใน router/room manager (isAdAttribution)
    // SHORTLINK จึงไม่สร้างแถวที่มา (เจ้าของเคาะ 2026-09-15 ข้อ 7) แต่โน้ต "ลูกค้ากดมาจากสินค้า …" ยังขึ้นจาก controller
```

(c) In the same spec replace:

```ts
  it('postback ที่ quick-reply router รับไปแล้ว ยังต้องบันทึกที่มาที่พ่วงมาด้วย', async () => {
```

with:

```ts
  it('postback ที่ quick-reply router รับไปแล้ว ยังต้องส่งที่มาที่พ่วงมาต่อให้ router ด้วย', async () => {
```

- [ ] **Step 15: Run the webhook spec and watch it stay green**

```bash
cd apps/api && npx jest src/modules/chat-adapters/facebook-webhook.controller.spec.ts --runInBand
```

Expected: `PASS`, same test count as before this task (titles changed, assertions untouched).

- [ ] **Step 16: Write the failing real-DB spec for the journey first source**

Create `apps/api/src/modules/customer-journey/journey-state.ads.db.spec.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { JourneyStateService } from './journey-state.service';

/**
 * ที่มา "โฆษณา" ของ journey-state.sql (CTE earliest_room) นับเฉพาะ ads_attributions.referrer_url = 'ADS'
 * (เจ้าของเคาะ 2026-09-15 ข้อ 7 · AD_REFERRAL_SOURCE ใน chat-engine/utils/ad-attribution.util.ts) — Postgres จริง
 * ห้องแรกของครอบครัวเป็นตัวตัดสิน: ห้องแรกไม่ใช่โฆษณา = CHAT_<ช่องทาง> แม้ห้องหลังจะมาจากโฆษณา
 * ไฟล์แยกจาก journey-state.service.db.spec.ts โดยตั้งใจ — หนึ่งไฟล์ต่อหนึ่งหัวข้อ แบบ journey-state.stage-order.db.spec.ts (Task 2) และ journey-state.signals.db.spec.ts (Task 3)
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('journey-state.sql — ที่มาโฆษณานับเฉพาะ referrer_url ADS (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const at = (value: string) => new Date(value);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const attributionIds: string[] = [];
  const campaignIds: string[] = [];

  const stateOf = (customerId: string) => prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId } });

  /** ผู้สนใจจากแชท Facebook — acquisition_source CHAT_ ⇒ ไม่มีเวลาหน้าร้าน ห้องแรกเป็นจุดเริ่ม */
  async function chatCustomer(label: string) {
    const row = await prisma.customer.create({
      data: { name: `journey ads ${label}`, phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at('2026-09-01T00:00:00.000Z') },
    });
    customerIds.push(row.id);
    return row;
  }
  /** แคมเปญ + attribution หนึ่งคู่ · referrerUrl null = referral ที่ Meta ไม่ส่ง source · รหัสแคมเปญสั้นแบบ ad_id จริง (AD: ตัดที่ 30 ตัว) */
  async function adAttribution(referrerUrl: string | null) {
    const campaign = await prisma.adsCampaign.create({
      data: { platform: 'FACEBOOK_ADS', campaignId: `${stamp}${campaignIds.length}`, campaignName: 'journey ads spec' },
    });
    campaignIds.push(campaign.id);
    const attribution = await prisma.adsAttribution.create({
      data: { campaignId: campaign.id, utmSource: 'facebook', referrerUrl, firstTouch: at('2026-09-01T00:00:00.000Z') },
    });
    attributionIds.push(attribution.id);
    return { campaign, attribution };
  }
  /** ห้อง Facebook + ข้อความลูกค้าหนึ่งใบ ณ เวลาสร้างห้อง */
  async function room(customerId: string, label: string, createdAt: string, attributionId: string) {
    const row = await prisma.chatRoom.create({
      data: { channel: 'FACEBOOK', externalUserId: `journey-ads-${label}-${stamp}`, customerId, attributionId, createdAt: at(createdAt) },
    });
    roomIds.push(row.id);
    await prisma.chatMessage.create({ data: { roomId: row.id, role: 'CUSTOMER', createdAt: at(createdAt) } });
    return row;
  }

  afterAll(async () => {
    // chat_rooms.attribution_id มี FK ⇒ ลบห้องก่อน attribution · ads_attributions ไม่มี deleted_at (แถวของ spec เอง)
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.adsAttribution.deleteMany({ where: { id: { in: attributionIds } } });
    await prisma.adsCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
  });

  it('ห้องแรกชี้ attribution ADS → firstSource AD:<campaign_id> + firstAdCampaignId', async () => {
    const c = await chatCustomer('ads');
    const { campaign, attribution } = await adAttribution('ADS');
    await room(c.id, 'ads', '2026-09-02T03:00:00.000Z', attribution.id);

    await service.recompute([c.id]);

    expect(await stateOf(c.id)).toMatchObject({
      firstChannel: 'CHAT_FACEBOOK',
      firstSource: `AD:${campaign.campaignId}`,
      firstAdCampaignId: campaign.id,
    });
  });

  it.each<[string, string | null]>([
    ['SHORTLINK (ลิงก์สินค้า m.me)', 'SHORTLINK'],
    ['NULL (referral ไม่มี source)', null],
  ])('ห้องแรกชี้ attribution referrer_url %s → CHAT_FACEBOOK ไม่มีแคมเปญ', async (label, referrerUrl) => {
    const c = await chatCustomer(`not-ads-${label}`);
    const { attribution } = await adAttribution(referrerUrl);
    await room(c.id, `not-ads-${referrerUrl ?? 'null'}`, '2026-09-02T03:00:00.000Z', attribution.id);

    await service.recompute([c.id]);

    expect(await stateOf(c.id)).toMatchObject({ firstChannel: 'CHAT_FACEBOOK', firstSource: 'CHAT_FACEBOOK', firstAdCampaignId: null });
  });

  it('ห้องแรกไม่ใช่โฆษณา + ห้องหลังมาจากโฆษณา ADS → ยัง CHAT_FACEBOOK (ห้องแรกตัดสิน ไม่ถอยไปห้องหลัง)', async () => {
    const c = await chatCustomer('late-ads');
    const link = await adAttribution('SHORTLINK');
    const ad = await adAttribution('ADS');
    await room(c.id, 'late-ads-first', '2026-09-02T03:00:00.000Z', link.attribution.id);
    await room(c.id, 'late-ads-second', '2026-09-05T03:00:00.000Z', ad.attribution.id);

    await service.recompute([c.id]);

    const s = await stateOf(c.id);
    expect(s).toMatchObject({ firstChannel: 'CHAT_FACEBOOK', firstSource: 'CHAT_FACEBOOK', firstAdCampaignId: null });
    expect(s.contactedAt.toISOString()).toBe('2026-09-02T03:00:00.000Z');
  });
});
```

- [ ] **Step 17: Run it and watch the three non-ADS cases fail**

```bash
cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.ads.db.spec.ts --runInBand
```

Expected: `Tests: 3 failed, 1 passed, 4 total`. The ADS case passes (it pins today's correct behaviour); the SHORTLINK, NULL and "ห้องแรกไม่ใช่โฆษณา" cases fail in `toMatchObject` (`- Expected - 2 / + Received + 2`: received `firstSource: "AD:<digits>"` and a non-null `firstAdCampaignId`).

- [ ] **Step 18: Pin the SQL literal to the constant (failing first)**

In `apps/api/src/modules/chat-engine/utils/ad-attribution.util.spec.ts` (a) replace:

```ts
import type { InboundAttribution } from '../interfaces/channel-adapter.interface';
import { AD_REFERRAL_SOURCE, isAdAttribution } from './ad-attribution.util';
```

with:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import type { InboundAttribution } from '../interfaces/channel-adapter.interface';
import { AD_REFERRAL_SOURCE, isAdAttribution } from './ad-attribution.util';
```

(b) replace:

```ts
    expect(isAdAttribution(adIdOnly)).toBe(false);
  });
});
```

with:

```ts
    expect(isAdAttribution(adIdOnly)).toBe(false);
  });

  it('journey-state.sql (CTE earliest_room) join ที่มาด้วย literal เดียวกับ AD_REFERRAL_SOURCE — แก้ต้องแก้คู่', () => {
    const sql = readFileSync(join(__dirname, '../../customer-journey/sql/journey-state.sql'), 'utf8');
    expect(sql).toContain(
      `LEFT JOIN ads_attributions aa ON aa.id = ro.attribution_id AND aa.referrer_url = '${AD_REFERRAL_SOURCE}'`,
    );
  });
});
```

Run:

```bash
cd apps/api && npx jest src/modules/chat-engine/utils/ad-attribution.util.spec.ts --runInBand
```

Expected: `Tests: 1 failed, 7 passed, 8 total` — `Expected substring: "LEFT JOIN ads_attributions aa ON aa.id = ro.attribution_id AND aa.referrer_url = 'ADS'"`.

- [ ] **Step 19: Filter the ad join in `journey-state.sql` CTE `earliest_room`**

In `apps/api/src/modules/customer-journey/sql/journey-state.sql` replace (inside `earliest_room AS (`):

```sql
  FROM rooms ro
  LEFT JOIN ads_attributions aa ON aa.id = ro.attribution_id
  LEFT JOIN ads_campaigns ac ON ac.id = aa.campaign_id
```

with:

```sql
  FROM rooms ro
  -- โฆษณาจริงเท่านั้น (เจ้าของเคาะ 2026-09-15 ข้อ 7): referrer_url = referral.source ของ Meta
  -- literal ต้องตรง AD_REFERRAL_SOURCE ใน chat-engine/utils/ad-attribution.util.ts (มีเทสปักคู่) — แก้ต้องแก้คู่
  -- ห้องแรกที่ชี้ที่มาอื่น (ลิงก์สินค้า SHORTLINK / ไม่มี source) ได้ ad_campaign_id ว่าง ⇒ first_source = CHAT_<ช่องทาง>
  -- การเลือกห้องแรกไม่เปลี่ยน · ไม่ถอยไปหาห้องหลังที่มาจากโฆษณา · ไม่กรอง deleted_at ของแคมเปญ (พฤติกรรมเดิม)
  LEFT JOIN ads_attributions aa ON aa.id = ro.attribution_id AND aa.referrer_url = 'ADS'
  LEFT JOIN ads_campaigns ac ON ac.id = aa.campaign_id
```

(The comments deliberately contain no single quote. Nothing else in the file changes — `shaped`/`resolved`/upsert keep reading `ad_campaign_id`/`ad_platform_campaign_id` as before.)

- [ ] **Step 20: Run the util + ads DB spec in both time zones, then the whole journey module**

```bash
cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/chat-engine/utils/ad-attribution.util.spec.ts src/modules/customer-journey/journey-state.ads.db.spec.ts --runInBand
```

Expected: `Test Suites: 2 passed, 2 total` · `Tests: 12 passed, 12 total`.

```bash
cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=UTC NODE_ENV=test npx jest src/modules/customer-journey/journey-state.ads.db.spec.ts --runInBand
```

Expected: `Tests: 4 passed, 4 total` (CI runs without `TZ`).

```bash
cd apps/api && DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey --runInBand
```

Expected: every suite under `customer-journey/` PASS, including the T2/T3 real-DB specs (`journey-state.stage-order.db.spec.ts`, `journey-state.signals.db.spec.ts`) and `journey-state.service.db.spec.ts` — none of them seeds an `ads_attributions` row, so their first-source expectations do not move.

- [ ] **Step 21: Update the spec event table row `AD_REFERRAL`**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md` replace the whole line:

```markdown
| AD_REFERRAL | ทักจากโฆษณา: {adName\|campaignName} | แชท/ติดต่อ | chat_rooms.attribution_id → ads_attributions.first_touch, ads_campaigns | ทักเข้ามา (ตั้ง firstAdCampaignId) | ลูกค้า | exact ถ้ามีข้อมูล · prod = 0 แถว ไม่มีข้อมูลต้นทาง (messaging_referrals ถูกถอด) · กดโฆษณาตัวใหม่ทำให้แถวเก่าหลุด |
```

with:

```markdown
| AD_REFERRAL | ทักจากโฆษณา: {adName\|campaignName} | แชท/ติดต่อ | chat_rooms.attribution_id → ads_attributions.first_touch, ads_campaigns · **นับเฉพาะ ads_attributions.referrer_url = 'ADS'** (= Meta referral.source ของโฆษณาจริง · ด่านตอนเขียน `isAdAttribution` / `AD_REFERRAL_SOURCE` ใน chat-engine/utils/ad-attribution.util.ts ใช้ literal เดียวกับ journey-state.sql) · ลิงก์สินค้า m.me (SHORTLINK) / referral ไม่มี source ไม่สร้างแคมเปญหรือแถวที่มา ไม่ชี้ห้องใหม่ ไม่มีโน้ต "ลูกค้าทักจากโฆษณา" (เจ้าของเคาะ 2026-09-15) | ทักเข้ามา (ตั้ง firstAdCampaignId เฉพาะเมื่อห้องแรกชี้ที่มา ADS — ห้องแรกไม่ใช่โฆษณา = CHAT_<ช่องทาง> แม้ห้องหลังมาจากโฆษณา) | ลูกค้า | exact ถ้ามีข้อมูล · prod = 0 แถว ไม่มีข้อมูลต้นทาง (messaging_referrals ถูกถอด) · กดโฆษณาตัวใหม่ทำให้แถวเก่าหลุด · first_source ที่แช่แข็งไปแล้วไม่ถูกกติกาใหม่ล้าง — ถ้ามีแถวที่มาที่ไม่ใช่ ADS ก่อน deploy ต้องล้างตาม runbook เฟส 3 |
```

- [ ] **Step 22: Runbook — pre-merge count (`### 1.5`), conditional cache cleanup (`### 2.1`), rollback note**

T2 created the runbook with sections `## 0` … `## 5` + `## ถอย (rollback)` and reserved `### 1.5` for this task; T3 added `### 1.6` (file-signal count) inside §1 and appended `(1.6)` to order-table row 1. The four edits below are anchored on T2's headings/rows and on T3's row 1 / `### 1.6` heading. All text is Thai, counts only, no PII.

(a) In the table under `## ลำดับห้ามสลับ` replace the two rows (row 1 exactly as T3 left it):

```markdown
| 1 | ด่านก่อน merge — PR "ร้านตอบครั้งแรก" ขึ้นและจบแล้ว · จดของเดิมไว้ถอย · นับก่อน · ช่วงเวลา · นับห้องที่ลูกค้าส่งไฟล์ในแชท (1.6) |
| 2 | merge PR นี้ + ด่านหลัง merge |
```

with:

```markdown
| 1 | ด่านก่อน merge — PR "ร้านตอบครั้งแรก" ขึ้นและจบแล้ว · จดของเดิมไว้ถอย · นับก่อน · ช่วงเวลา · นับที่มาโฆษณาที่ไม่ใช่ ADS (1.5) · นับห้องที่ลูกค้าส่งไฟล์ในแชท (1.6) |
| 2 | merge PR นี้ + ด่านหลัง merge · ล้างที่มาโฆษณาในแคช **เฉพาะเมื่อ 1.5 ไม่เป็น 0** (2.1) |
```

(b) Insert this block immediately **before** the line that starts with `### 1.6 นับห้องที่ลูกค้าส่งไฟล์ในแชท` (T3's heading — i.e. after the last bullet of `### 1.4 ช่วงเวลาที่ merge ได้`), followed by one blank line, so `### 1.6` keeps following directly after it:

````markdown
### 1.5 นับที่มาโฆษณาที่ไม่ใช่ ADS (MCP นับอย่างเดียว · Task 9)

PR นี้ให้ระบบนับว่า "มาจากโฆษณา" เฉพาะ referral ที่ Meta ส่ง `source = ADS` (เจ้าของเคาะ 2026-09-15 ข้อ 7) — API อย่างเดียว ไม่มี migration ไม่แตะเว็บ:
- `RoomManagerService.linkAttribution` และ `MessageRouterService.recordAdReferral` ทิ้ง referral ที่ไม่ใช่ `ADS` ทันที (`isAdAttribution` ใน `apps/api/src/modules/chat-engine/utils/ad-attribution.util.ts`)
  - ลิงก์สินค้า m.me (`SHORTLINK`) และ referral ที่ไม่มี source: ไม่สร้าง `ads_campaigns` / `ads_attributions` · ไม่ชี้ห้องไปที่มาใหม่ · ไม่มีโน้ต "ลูกค้าทักจากโฆษณา"
  - โน้ต "ลูกค้ากดมาจากสินค้า …" ในห้องยังขึ้นตามเดิม
  - กลับทิศของ `5f0dc62c4` (#1590) ที่เคยบันทึกลิงก์สินค้าเป็นแถวที่มา — ถ้าวันหน้าอยากนับคลิกลิงก์สินค้า ต้องใช้ตาราง/ชนิดรายการของตัวเอง ไม่ใช่ `ads_attributions`
- `journey-state.sql` CTE `earliest_room`: join `ads_attributions` เฉพาะ `referrer_url = 'ADS'` ⇒ ห้องแรกที่ชี้ที่มาอื่นได้ `first_source = CHAT_<ช่องทาง>` ไม่ใช่ `AD:`
- ตรวจ 2026-09-15: `ads_campaigns` 0 · `ads_attributions` 0 · `first_source LIKE 'AD:%'` 0 ⇒ เป็นการกันล่วงหน้า ต้องขึ้น prod **ก่อน** เจ้าของกด subscribe `messaging_referrals` หรือเปิดโฆษณาแบบทักแชท

🚨 **`first_source` / `first_ad_campaign_id` ในแคชถูกแช่แข็ง** — recompute (หน้า `/customers/:id` · cron · `backfill:customer-journey` ขั้น 3–4) เปลี่ยนสองคอลัมน์นี้เฉพาะเมื่อ `contacted_at` ใหม่เก่ากว่าเดิม ⇒ กติกาใหม่ **ไม่ล้าง** ค่า `AD:` ที่เขียนไปแล้ว

```sql
SELECT count(*) FROM ads_attributions WHERE referrer_url IS DISTINCT FROM 'ADS';
```
- **ได้ 0** → merge ได้ · ข้าม 2.1
- **มากกว่า 0** → merge ได้ แต่ต้องทำ 2.1 **หลังเจ้าของอนุมัติเท่านั้น** · นับแคชที่โดนไว้ด้วย:
  ```sql
  SELECT count(*) FROM customer_journey_states s
  WHERE s.first_ad_campaign_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ads_attributions aa WHERE aa.campaign_id = s.first_ad_campaign_id AND aa.referrer_url = 'ADS');
  ```
  จดตัวเลขนี้ลง PR
- `mcp_ro` อ่าน `ads_attributions.referrer_url` และ `customer_journey_states.first_ad_campaign_id` ได้ (`.claude/mcp/sql/grants.sql`) — ไม่ต้องใช้ role เจ้าของ
````

(c) Insert this block immediately **before** the line ``## 3. `backfill:customer-journey` dry-run``, followed by one blank line:

````markdown
### 2.1 ล้างที่มาโฆษณาที่ไม่ใช่ ADS ในแคช — เฉพาะเมื่อ 1.5 ได้มากกว่า 0 และเจ้าของอนุมัติแล้ว

1.5 ได้ 0 = ข้ามหัวข้อนี้

ลำดับ: ด่านหลัง merge ของหัวข้อ 2 ผ่านแล้ว (image ใหม่รับ traffic 100% ⇒ แถวที่ไม่ใช่โฆษณาไม่งอกเพิ่มระหว่างทำ) → ทำหัวข้อนี้ → ขั้น 3 · ห้ามช่วง 03:00–04:30 น. · ใช้ role เจ้าของ (MCP เขียนไม่ได้)

1. ล้างแคช — ทรานแซกชันเดียว:
   ```sql
   BEGIN;
   SELECT count(*) FROM customer_journey_states s
   WHERE s.first_ad_campaign_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM ads_attributions aa WHERE aa.campaign_id = s.first_ad_campaign_id AND aa.referrer_url = 'ADS');
   UPDATE customer_journey_states s
   SET first_ad_campaign_id = NULL, first_source = s.first_channel
   WHERE s.first_ad_campaign_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM ads_attributions aa WHERE aa.campaign_id = s.first_ad_campaign_id AND aa.referrer_url = 'ADS');
   -- ข้อความ UPDATE <n> ต้องเท่ากับ count ด้านบน · ไม่เท่า → ROLLBACK; แล้วส่งตัวเลขให้ dev
   COMMIT;
   ```
   - `first_ad_campaign_id` มีค่าเฉพาะลูกค้าที่ทักแชทก่อน ⇒ `first_channel` ของแถวเหล่านี้เป็น `CHAT_<ช่องทาง>` เสมอ = ค่าที่กติกาใหม่คำนวณได้
   - count ในทรานแซกชันต่างจากตัวเลขที่จดใน 1.5 ได้ (มีคนเปิดหน้าลูกค้าระหว่างนั้น) — เทียบกับ count ในทรานแซกชันเท่านั้น
2. (ไม่บังคับ — เจ้าของอนุมัติแยก) ปลดห้องแชทออกจากที่มาที่ไม่ใช่โฆษณา ให้แผงขวาในอินบ็อกซ์เลิกโชว์ "มาจากโฆษณา" ของห้องเหล่านั้น — แถว `ads_attributions` ยังอยู่เป็นประวัติ (ห้ามลบ):
   ```sql
   BEGIN;
   SELECT count(*) FROM chat_rooms
   WHERE attribution_id IN (SELECT id FROM ads_attributions WHERE referrer_url IS DISTINCT FROM 'ADS');
   UPDATE chat_rooms SET attribution_id = NULL
   WHERE attribution_id IN (SELECT id FROM ads_attributions WHERE referrer_url IS DISTINCT FROM 'ADS');
   -- UPDATE <n> ต้องเท่ากับ count ด้านบน · ไม่เท่า → ROLLBACK;
   COMMIT;
   ```
   - `mcp_ro` อ่าน `chat_rooms.attribution_id` ไม่ได้ ⇒ count นี้ใช้ role เจ้าของเหมือนกัน
3. คำนวณใหม่ = ขั้น 3–4 ของไฟล์นี้ตามปกติ · ถ้าขั้น 4 รันไปแล้วก่อนข้อ 1 ให้รันขั้น 4 ซ้ำหลัง COMMIT (รันซ้ำได้)
4. หลังขั้น 4 ตรวจ (MCP นับอย่างเดียว):
   ```sql
   SELECT count(*) FROM customer_journey_states s
   WHERE s.first_ad_campaign_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM ads_attributions aa WHERE aa.campaign_id = s.first_ad_campaign_id AND aa.referrer_url = 'ADS');
   SELECT count(*) FROM customer_journey_states WHERE first_source LIKE 'AD:%' AND first_ad_campaign_id IS NULL;
   ```
   - **ทั้งคู่ต้องได้ 0** · ไม่เป็น 0 = ส่งตัวเลขให้ dev ห้ามแก้มือต่อ
````

(d) Replace:

```markdown
## ถอย (rollback)

### ถอยเพราะลำดับขั้น
```

with:

```markdown
## ถอย (rollback)

### ถอยกับที่มาโฆษณา (1.5 / 2.1)

- ถอย image API ข้ามเส้น PR นี้ = ลิงก์สินค้ากลับมาสร้างแถว `ads_attributions` และลูกค้าใหม่ที่ห้องแรกมาจากลิงก์สินค้าได้ `first_source = AD:…` ระหว่างที่ถอยอยู่
- ค่าที่ 2.1 ล้างไปแล้วไม่ถูกเขียนกลับ (คอลัมน์แช่แข็ง)
- ขึ้นกลับ (roll forward) → ทำ 1.5 ซ้ำ · ไม่เป็น 0 ทำ 2.1 ก่อนขั้น 3

### ถอยเพราะลำดับขั้น
```

Run (from the worktree root):

```bash
grep -n '^### 1.5 \|^### 2.1 \|^### ถอยกับที่มาโฆษณา\|(1.5) · \|(2.1) |' docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -n '^### 1.4 \|^### 1.5 \|^### 1.6 \|^## 2. merge PR นี้' docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -c '^## ' docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
```

Expected: the first command prints 5 lines in file order — table row 1 (contains `(1.5) · นับห้องที่ลูกค้าส่งไฟล์ในแชท (1.6) |`), table row 2, `### 1.5 …`, `### 2.1 …`, `### ถอยกับที่มาโฆษณา (1.5 / 2.1)`; the second prints 4 lines in exactly this order: `### 1.4`, `### 1.5`, `### 1.6`, `## 2.` (so 1.5 sits between 1.4 and T3's 1.6); `### 2.1` comes before `## 3.`. The `## ` count is unchanged by this step (same number as before the step).

- [ ] **Step 23: Typecheck and lint the touched files**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

```bash
cd apps/api && npx eslint src/modules/chat-engine/utils/ad-attribution.util.ts src/modules/chat-engine/utils/ad-attribution.util.spec.ts src/modules/chat-engine/services/room-manager.service.ts src/modules/chat-engine/services/room-manager.attribution.spec.ts src/modules/chat-engine/services/message-router.service.ts src/modules/chat-engine/services/message-router.service.spec.ts src/modules/chat-adapters/facebook-webhook.controller.ts src/modules/chat-adapters/facebook-webhook.controller.spec.ts src/modules/customer-journey/journey-state.ads.db.spec.ts
```

Expected: `0 errors` (warnings only — the files already carry `no-explicit-any` warnings). 🚨 Never `npm run lint` in apps/api (the script runs `--fix`).

- [ ] **Step 24: Commit**

```bash
git add apps/api/src/modules/chat-engine/utils/ad-attribution.util.ts apps/api/src/modules/chat-engine/utils/ad-attribution.util.spec.ts apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/chat-engine/services/room-manager.attribution.spec.ts apps/api/src/modules/chat-engine/services/message-router.service.ts apps/api/src/modules/chat-engine/services/message-router.service.spec.ts apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts apps/api/src/modules/customer-journey/sql/journey-state.sql apps/api/src/modules/customer-journey/journey-state.ads.db.spec.ts docs/superpowers/specs/2026-09-15-customer-journey-design.md docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
```

```bash
git commit -m "fix(chat-engine): นับที่มาโฆษณาเฉพาะ referral.source = ADS — ลิงก์สินค้า m.me ไม่สร้างแคมเปญ/ไม่ชี้ห้องใหม่/ไม่เป็น AD: ใน journey

- isAdAttribution + AD_REFERRAL_SOURCE (chat-engine/utils/ad-attribution.util.ts) ด่านเดียว เทียบตรงตัว ไม่ดู adId
- linkAttribution คืน null ก่อนแตะ DB เมื่อไม่ใช่ ADS ⇒ ห้องที่ชี้โฆษณาอยู่ไม่ถูกชี้ไปที่มาอื่น · ADS ตัวใหม่ยังชี้ทับที่มาเก่าได้
- recordAdReferral return ก่อนหาห้อง · โน้ต \"ลูกค้าทักจากโฆษณา\" ในข้อความแรกใช้ด่านเดียวกัน (เดิมดูแค่ adId)
- journey-state.sql earliest_room: join ads_attributions เฉพาะ referrer_url = 'ADS' · เทสปัก literal คู่กับค่าคงที่ · DB spec ใหม่ ADS/SHORTLINK/NULL/ห้องแรกไม่ใช่โฆษณา
- กลับทิศของ 5f0dc62c4: ลิงก์สินค้าไม่เป็นแถว ads_attributions อีก · โน้ตสินค้ายังขึ้นตามเดิม
- prod 2026-09-15 ads_attributions 0 แถว ⇒ กันล่วงหน้า · runbook 1.5 ด่านนับก่อน merge + 2.1 SQL ล้างแคชที่แช่แข็ง (เมื่อไม่เป็น 0 และเจ้าของอนุมัติ) + หมายเหตุถอย
- เจ้าของเคาะ 2026-09-15 ข้อ 7

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected: `git show --stat HEAD` lists exactly the 12 paths above. No `git push`.

---

### Task 10: Web foundation: shared journey hooks, chips, responsive chooser, heard-from chips, roles, storage

Goal: reusable, tested building blocks so the stage strip (T11), the journey tab (T12), the heard-from hosts (T13) and the create dialogs (T14) share one implementation of fetching, writing, undo, chip styling, chooser shell, role gate and remembered values. No visible UI change ships in this task (nothing mounts the new components yet).

All commands run from the worktree root `/Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/feat+customer-detail-journey`. Web resolves `@installment/shared` from source (`apps/web/tsconfig.json` `paths`, `apps/web/vitest.config.ts` alias), so no shared build is needed for web tests or `tsc`.

**Files:**

- Move (content unchanged except one doc-comment sentence, lines 1-89): `apps/web/src/pages/CustomerDetailPage/hooks/useCustomerJourney.ts` → `apps/web/src/hooks/customer-journey/useCustomerJourney.ts`
- Modify (one import line each, anchored by the import text):
  - `apps/web/src/pages/CustomerDetailPage/index.tsx:17`
  - `apps/web/src/pages/CustomerDetailPage/tabs/CreditTab.tsx:11`
  - `apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx:10`
  - `apps/web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx:8`
  - `apps/web/src/pages/CustomerDetailPage/components/RecentActivityCard.tsx:7`
  - `apps/web/src/pages/CustomerDetailPage/components/DetailHeader.tsx:22`
- Modify: `apps/web/src/lib/constants.ts` — append after the last line (:100, `export const canFillProspectContact = …`)
- Create:
  - `apps/web/src/hooks/customer-journey/journeyEntries.ts`
  - `apps/web/src/components/customer/journey/ChoiceChip.tsx`
  - `apps/web/src/components/customer/journey/ResponsiveChooser.tsx`
  - `apps/web/src/components/customer/journey/HeardFromChips.tsx`
  - `apps/web/src/components/customer/journey/journeyStorage.ts`
- Test (all new):
  - `apps/web/src/hooks/customer-journey/journeyEntries.test.tsx`
  - `apps/web/src/components/customer/journey/__tests__/ChoiceChip.test.tsx`
  - `apps/web/src/components/customer/journey/__tests__/ResponsiveChooser.test.tsx`
  - `apps/web/src/components/customer/journey/__tests__/HeardFromChips.test.tsx`
  - `apps/web/src/components/customer/journey/__tests__/journeyStorage.test.ts`
  - `apps/web/src/lib/__tests__/journey-record-roles.test.ts`
  - Existing, must stay green without edits: everything under `apps/web/src/pages/CustomerDetailPage/` (no test mocks the hook module path — verified with grep — so the move is test-safe).

**Interfaces:**

Consumes (from T1, `packages/shared/src/customer-journey.ts` via `@installment/shared`):
- `JOURNEY_HEARD_FROM_CODES = ['FB_AD','FB_PAGE','TIKTOK','LINE','GOOGLE','FRIEND','WALK_BY','OLD_CUSTOMER','OTHER'] as const`, `type JourneyHeardFrom`
- `JOURNEY_HEARD_FROM_LABELS` (shipped; indexable by `JourneyHeardFrom`)
- `JOURNEY_RECORDABLE_TOUCH_CHANNELS = ['PHONE','FB_APP','LINE_APP','WALK_IN'] as const`, `type JourneyRecordableTouchChannel`
- `type JourneyManualEntryInput` (TOUCHPOINT `{ channel: JourneyRecordableTouchChannel; outcome: JourneyTouchOutcome }` | HEARD_FROM `{ heardFrom: JourneyHeardFrom }` | MARKED_LOST `{ lostReason: JourneyLostReason }` | REOPENED; each with `clientRequestId?: string`)
- `interface JourneyEntryCreatedResponse { entryId: string | null; event: JourneyEvent | null; summary: JourneySummary }`
- `interface JourneyEntryDeletedResponse { summary: JourneySummary }`
- `type JourneySummary` (T1 adds `askHeardFrom`, `creditFilePending`; T1 already defaults them in `apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts` `journeySummary()`, which the hook test reuses)

Consumes (API contract of T7/T8, mocked in this task): `POST /customers/:id/journey/entries` → 201 `JourneyEntryCreatedResponse`; `DELETE /customers/:id/journey/entries/:entryId` → 200 `JourneyEntryDeletedResponse`.

Consumes (web, shipped): `api` default + `getErrorMessage(error: unknown): string` (`apps/web/src/lib/api.ts:221`); `uid(): string` (`apps/web/src/utils/uid.ts:1`); `useIsMobile(): boolean` (`apps/web/src/hooks/useIsMobile.ts:5`, breakpoint 1024 = Tailwind `lg`); `Popover` / `PopoverTrigger` / `PopoverContent` (`apps/web/src/components/ui/popover.tsx`); `Sheet` / `SheetTrigger` / `SheetContent` / `SheetHeader` / `SheetTitle` / `SheetDescription` (`apps/web/src/components/ui/sheet.tsx`); `Button` (`apps/web/src/components/ui/button.tsx`, renders `data-slot="button"`); `cn` (`apps/web/src/lib/utils.ts`); `toast` from `sonner`. React is 19.2 (ref is a plain prop), so `<Button>` works as a Radix `asChild` trigger.

Produces:

```ts
// apps/web/src/hooks/customer-journey/useCustomerJourney.ts — moved, exports unchanged
export type CustomerJourneyResult = JourneyListResponse | JourneyRedirect;
export type JourneySummaryResult = JourneySummary | JourneyRedirect;
export const JOURNEY_PAGE_SIZE = 30;
export function invalidateCustomerJourney(queryClient: QueryClient, customerId: string): void;
export function isJourneyRedirect(value: CustomerJourneyResult | JourneySummaryResult | null | undefined): value is JourneyRedirect;
export function useCustomerJourney(customerId: string, groups: readonly JourneyEventGroup[] | null, options?: { limit?: number; enabled?: boolean; include?: string }); // useInfiniteQuery, key ['customer-journey', customerId, groups]
export function useJourneySummary(customerId: string, enabled?: boolean);  // useQuery<JourneySummaryResult>, key ['customer-journey-summary', customerId]
export function useJourneySummaryRedirect(customerId: string, enabled: boolean): JourneySummary | null;

// apps/web/src/hooks/customer-journey/journeyEntries.ts
export function useRecordJourneyEntry(customerId: string): UseMutationResult<JourneyEntryCreatedResponse, Error, JourneyManualEntryInput>;
//   mutationKey ['customer-journey-entry', 'record', customerId]; POST `/customers/${customerId}/journey/entries`, body = the input as given
//   (the caller puts clientRequestId: uid() in it — one UUID per tap, D8);
//   options-level onSuccess: setQueryData(['customer-journey-summary', customerId], res.summary)
//   + invalidateQueries({ queryKey: ['customer-journey', customerId] }) — summary is NOT invalidated again. No toasts (hosts toast).
export function deleteJourneyEntry(queryClient: QueryClient, customerId: string, entryId: string): Promise<void>;
//   DELETE `/customers/${customerId}/journey/entries/${entryId}` → setQueryData(summary) → invalidate list → toast.success('เลิกทำแล้ว');
//   any failure → toast.error(getErrorMessage(err)); never rejects; safe after the calling component unmounted (D12).
export const JOURNEY_UNDO_TOAST_MS = 10_000;
export interface JourneyUndoToastOptions { duration: number; action?: { label: string; onClick: () => void } }
export function undoToastOptions(queryClient: QueryClient, customerId: string, entryId: string | null, onUndo?: () => void): JourneyUndoToastOptions;
//   the ONE success-toast shape of every manual-entry host (T11 lost/reopen · T12 record contact · T13 heard-from ask):
//   entryId null → { duration: JOURNEY_UNDO_TOAST_MS } (nothing to undo — D9); otherwise also action { label: 'เลิกทำ', onClick }
//   where onClick = onUndo ?? (() => void deleteJourneyEntry(queryClient, customerId, entryId)). Assignable to sonner's ExternalToast;
//   hosts spread extra keys (e.g. onAutoClose / onDismiss) on top.
export function useDeleteJourneyEntry(customerId: string): UseMutationResult<void, Error, string>;
//   mutationKey ['customer-journey-entry', 'delete', customerId]; variables = entryId; mutationFn = deleteJourneyEntry.
export function postHeardFrom(customerId: string, code: JourneyHeardFrom): Promise<boolean>;
//   body { kind: 'HEARD_FROM', heardFrom: code, clientRequestId: uid() }; resolves true = failed, false = saved; never throws, never toasts.

// apps/web/src/components/customer/journey/ChoiceChip.tsx
export interface ChoiceChipProps { active: boolean; busy?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }
export function ChoiceChip(props: ChoiceChipProps): JSX.Element;
//   <button type="button" aria-pressed={active || busy} aria-busy={busy || undefined} disabled={disabled}>
//   base classes: inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs leading-snug transition-colors max-lg:h-11 max-lg:px-4 max-lg:text-sm
//   only when NOT busy: disabled:cursor-not-allowed disabled:opacity-40
//   pressed (active || busy): border-primary bg-primary text-primary-foreground · otherwise: border-input bg-card text-foreground hover:bg-accent
//   busy renders <Loader2 className="size-3 animate-spin" aria-hidden="true" /> before children
export interface ChoiceChipRowProps { label?: string; hint?: string; children: ReactNode }
export function ChoiceChipRow(props: ChoiceChipRowProps): JSX.Element;
//   label present → outer div role="group" aria-label={label}; label div "mb-1.5 text-xs font-medium leading-snug text-muted-foreground"
//   hint (only with label) → <span className="ml-1 text-2xs font-normal text-muted-foreground/80"> inside the label div
//   chip row div: "flex flex-wrap gap-1.5 max-lg:gap-2"

// apps/web/src/components/customer/journey/ResponsiveChooser.tsx
export interface ResponsiveChooserProps { open: boolean; onOpenChange: (open: boolean) => void; title: string; trigger: ReactElement; children: ReactNode }
export function ResponsiveChooser(props: ResponsiveChooserProps): JSX.Element;
//   desktop: Popover(open, onOpenChange) > PopoverTrigger asChild {trigger} + PopoverContent align="end" className="w-80" aria-label={title}
//            > <div className="mb-3 text-sm font-semibold leading-snug">{title}</div>{children}
//   mobile (useIsMobile() === true): Sheet(open, onOpenChange) > SheetTrigger asChild {trigger}
//            + SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto"
//            > SheetHeader > SheetTitle {title} + SheetDescription className="sr-only" 'เลือกจากตัวเลือกด้านล่าง'; then {children}
//   the trigger carries data-state="open" + aria-expanded="true" while open (outline Button shows bg-accent — Main b).

// apps/web/src/components/customer/journey/HeardFromChips.tsx
export interface HeardFromChipsProps {
  value: JourneyHeardFrom | null;
  onSelect: (code: JourneyHeardFrom) => void;
  pendingCode?: JourneyHeardFrom | null;
  disabled?: boolean;
  onSkip?: () => void;
  skipStyle: 'ghost-button' | 'text';
}
export function HeardFromChips(props: HeardFromChipsProps): JSX.Element;
//   <div role="group" aria-label="ลูกค้ารู้จักร้านจากไหน" className="flex flex-col gap-1.5">
//   header row "flex items-center justify-between gap-2": heading 'ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)' (text-xs font-medium leading-snug text-muted-foreground)
//     + 'ข้าม' only when onSkip: 'ghost-button' → <Button type="button" variant="ghost" size="sm">;
//       'text' → <button type="button" className="text-xs leading-snug text-muted-foreground hover:text-foreground">; disabled while pendingCode is set
//   ChoiceChipRow (no label) with 9 ChoiceChips in JOURNEY_HEARD_FROM_CODES order: active = value === code, busy = pendingCode === code,
//   disabled = disabled || pendingCode is set. onSelect always receives the tapped code (dialog hosts toggle off themselves).

// apps/web/src/lib/constants.ts
export const JOURNEY_RECORD_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'];
export const canRecordJourney: (role: string | null | undefined) => boolean;

// apps/web/src/components/customer/journey/journeyStorage.ts
export function readLastChannel(): JourneyRecordableTouchChannel | null;        // localStorage 'customerJourney.lastChannel.v1', raw string; anything but the 4 recordable channels (incl. OTHER) → null
export function writeLastChannel(channel: JourneyRecordableTouchChannel): void; // ignores values outside the 4 channels
export function isHeardFromSkipped(customerId: string): boolean;               // sessionStorage 'customerJourney.heardFromSkipped.v1:<customerId>' === '1'
export function markHeardFromSkipped(customerId: string): void;
//   every read/write in try/catch (blocked / quota / private mode → read null|false, write no-op)
```

---

- [ ] **Step 1: Move the journey query hooks to a shared location (refactor, no behaviour change)**

Run (two separate commands):

```bash
mkdir -p apps/web/src/hooks/customer-journey
```

```bash
git mv apps/web/src/pages/CustomerDetailPage/hooks/useCustomerJourney.ts apps/web/src/hooks/customer-journey/useCustomerJourney.ts
```

Replace exactly one import line in each of the six importers (no re-export shim is left behind):

`apps/web/src/pages/CustomerDetailPage/index.tsx` (line 17)

```tsx
// before
import { invalidateCustomerJourney, useJourneySummaryRedirect } from './hooks/useCustomerJourney';
// after
import { invalidateCustomerJourney, useJourneySummaryRedirect } from '@/hooks/customer-journey/useCustomerJourney';
```

`apps/web/src/pages/CustomerDetailPage/tabs/CreditTab.tsx` (line 11)

```tsx
// before
import { invalidateCustomerJourney } from '../hooks/useCustomerJourney';
// after
import { invalidateCustomerJourney } from '@/hooks/customer-journey/useCustomerJourney';
```

`apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx` (line 10)

```tsx
// before
import { isJourneyRedirect, useCustomerJourney } from '../hooks/useCustomerJourney';
// after
import { isJourneyRedirect, useCustomerJourney } from '@/hooks/customer-journey/useCustomerJourney';
```

`apps/web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx` (line 8)

```tsx
// before
import { invalidateCustomerJourney } from '../hooks/useCustomerJourney';
// after
import { invalidateCustomerJourney } from '@/hooks/customer-journey/useCustomerJourney';
```

`apps/web/src/pages/CustomerDetailPage/components/RecentActivityCard.tsx` (line 7)

```tsx
// before
import { isJourneyRedirect, useCustomerJourney } from '../hooks/useCustomerJourney';
// after
import { isJourneyRedirect, useCustomerJourney } from '@/hooks/customer-journey/useCustomerJourney';
```

`apps/web/src/pages/CustomerDetailPage/components/DetailHeader.tsx` (line 22)

```tsx
// before
import { invalidateCustomerJourney } from '../hooks/useCustomerJourney';
// after
import { invalidateCustomerJourney } from '@/hooks/customer-journey/useCustomerJourney';
```

In the moved file `apps/web/src/hooks/customer-journey/useCustomerJourney.ts`, replace the doc comment above `invalidateCustomerJourney` (lines 14-17) so readers know why it lives outside the page:

```ts
/**
 * หลังคำสั่งบนหน้าลูกค้าที่เขียนประวัติการเดินทาง (ตรวจเครดิต · วิเคราะห์/ตีตกเครดิต · แก้ข้อมูล · เติมเบอร์)
 * prefix ครอบทุกชุดกลุ่มของแท็บและการ์ดกิจกรรมล่าสุด + แถบขั้น — main.tsx ปิด refetchOnWindowFocus จึงไม่รีเฟรชเอง
 * อยู่ใน hooks/customer-journey (ไม่ใช่ใต้หน้า) เพราะ POS · สร้างสัญญา · dialog สร้างลูกค้า ใช้ชุดเดียวกัน (เฟส 3)
 */
```

- [ ] **Step 2: Verify the move — no old path left, page tests and types green**

Run:

```bash
grep -rn "'\./hooks/useCustomerJourney'\|'\.\./hooks/useCustomerJourney'\|pages/CustomerDetailPage/hooks/useCustomerJourney" apps/web/src
```

Expected: no output (exit 1).

```bash
cd apps/web && npx vitest run src/pages/CustomerDetailPage
```

Expected: every test file under `src/pages/CustomerDetailPage` passes, 0 failed.

```bash
cd apps/web && npx tsc --noEmit
```

Expected: exit 0, no output.

- [ ] **Step 3: Commit the move**

```bash
git add apps/web/src/hooks/customer-journey/useCustomerJourney.ts apps/web/src/pages/CustomerDetailPage/hooks/useCustomerJourney.ts apps/web/src/pages/CustomerDetailPage/index.tsx apps/web/src/pages/CustomerDetailPage/tabs/CreditTab.tsx apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx apps/web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx apps/web/src/pages/CustomerDetailPage/components/RecentActivityCard.tsx apps/web/src/pages/CustomerDetailPage/components/DetailHeader.tsx
```

```bash
git commit -m "refactor(web): ย้าย hook การเดินทางลูกค้าไป hooks/customer-journey — POS/สร้างสัญญา/dialog สร้างลูกค้าใช้ร่วมได้ ไม่ต้อง import ข้ามหน้า" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Write the failing test for the record-role gate**

Create `apps/web/src/lib/__tests__/journey-record-roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { JOURNEY_RECORD_ROLES, canRecordJourney } from '@/lib/constants';

describe('canRecordJourney — ซ่อนปุ่มบันทึกการเดินทางตาม @Roles ของ POST/DELETE /customers/:id/journey/entries', () => {
  it('ชุดบทบาทตรงกับ API (มี FINANCE_MANAGER ต่างจาก CUSTOMER_CREATE_ROLES)', () => {
    expect(JOURNEY_RECORD_ROLES).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']);
  });

  it.each(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'])('%s บันทึกได้', (role) => {
    expect(canRecordJourney(role)).toBe(true);
  });

  it.each([{ role: 'ACCOUNTANT' }, { role: '' }, { role: null }, { role: undefined }])(
    'บทบาท $role บันทึกไม่ได้ (ACCOUNTANT ไม่เห็นกลุ่มแชทที่แถวบันทึกมืออยู่ · ไม่มีบทบาท = ปิด)',
    ({ role }) => {
      expect(canRecordJourney(role)).toBe(false);
    },
  );
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `cd apps/web && npx vitest run src/lib/__tests__/journey-record-roles.test.ts`

Expected: FAIL — `expected undefined to deeply equal [ 'OWNER', 'BRANCH_MANAGER', … ]` and `TypeError: canRecordJourney is not a function`.

- [ ] **Step 6: Add the role gate**

Append to the end of `apps/web/src/lib/constants.ts` (after line 100 `export const canFillProspectContact = …`):

```ts

/**
 * บทบาทที่บันทึกการเดินทางลูกค้าด้วยมือได้ (บันทึกการติดต่อ · ติดป้ายหลุด/เปิดใหม่ · รู้จักร้านจากไหน · เลิกทำ)
 * ต้องตรงกับ `@Roles` ของ `POST /customers/:id/journey/entries` และ `DELETE …/entries/:entryId` (customer-journey.controller.ts)
 * ค่าเท่ากับ PROSPECT_CONTACT_ROLES วันนี้แต่ผูกกับคนละ endpoint จึงแยกค่าคงที่ — ACCOUNTANT ไม่ได้ (403 + มองไม่เห็นกลุ่มแชทที่แถวบันทึกมืออยู่)
 */
export const JOURNEY_RECORD_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'];
export const canRecordJourney = (role: string | null | undefined): boolean => JOURNEY_RECORD_ROLES.includes(role ?? '');
```

- [ ] **Step 7: Run it and watch it pass**

Run: `cd apps/web && npx vitest run src/lib/__tests__/journey-record-roles.test.ts`

Expected: PASS — 1 file, 9 tests passed.

- [ ] **Step 8: Commit the role gate**

```bash
git add apps/web/src/lib/constants.ts apps/web/src/lib/__tests__/journey-record-roles.test.ts
```

```bash
git commit -m "feat(web): JOURNEY_RECORD_ROLES + canRecordJourney — ซ่อนปุ่มบันทึกการเดินทางให้ตรง @Roles ของ API (ACCOUNTANT ไม่เห็น)" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 9: Write the failing test for remembered values**

Create `apps/web/src/components/customer/journey/__tests__/journeyStorage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyRecordableTouchChannel } from '@installment/shared';
import { isHeardFromSkipped, markHeardFromSkipped, readLastChannel, writeLastChannel } from '../journeyStorage';

/** 🔴 hook ของ vitest ห้าม return ค่า — คร่อมปีกกาเสมอ */
const LAST_CHANNEL_KEY = 'customerJourney.lastChannel.v1';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readLastChannel / writeLastChannel', () => {
  it('ยังไม่เคยจำ → null (ตัวเลือกไม่เลือกช่องทางใดไว้ก่อน)', () => {
    expect(readLastChannel()).toBeNull();
  });

  it('จำช่องทางใต้คีย์ v1 เป็นข้อความดิบ แล้วอ่านกลับได้', () => {
    writeLastChannel('LINE_APP');
    expect(localStorage.getItem(LAST_CHANNEL_KEY)).toBe('LINE_APP');
    expect(readLastChannel()).toBe('LINE_APP');
  });

  it.each(['OTHER', 'SMS', '', '"PHONE"', 'phone'])('ค่าในที่เก็บที่ไม่ใช่ 4 ช่องทาง (%s) → null', (raw) => {
    localStorage.setItem(LAST_CHANNEL_KEY, raw);
    expect(readLastChannel()).toBeNull();
  });

  it('ไม่เขียนค่าที่ไม่ใช่ 4 ช่องทาง (OTHER ไม่มีชิปให้เลือก)', () => {
    writeLastChannel('OTHER' as JourneyRecordableTouchChannel);
    expect(localStorage.getItem(LAST_CHANNEL_KEY)).toBeNull();
  });

  it('ที่เก็บโยน error ตอนอ่าน/เขียน (โหมดส่วนตัว · เต็ม) → อ่านได้ null และไม่โยนต่อ', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(readLastChannel()).toBeNull();
    expect(() => writeLastChannel('PHONE')).not.toThrow();
  });
});

describe('isHeardFromSkipped / markHeardFromSkipped', () => {
  it('ข้ามแยกต่อลูกค้า เก็บใน sessionStorage (มาหน้าใหม่รอบหน้าขึ้นอีก)', () => {
    expect(isHeardFromSkipped('c1')).toBe(false);
    markHeardFromSkipped('c1');
    expect(isHeardFromSkipped('c1')).toBe(true);
    expect(isHeardFromSkipped('c2')).toBe(false);
    expect(sessionStorage.getItem('customerJourney.heardFromSkipped.v1:c1')).toBe('1');
    expect(localStorage.length).toBe(0);
  });

  it('sessionStorage โยน error → ถือว่ายังไม่ข้าม และไม่โยนต่อ', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => markHeardFromSkipped('c1')).not.toThrow();
    expect(isHeardFromSkipped('c1')).toBe(false);
  });
});
```

- [ ] **Step 10: Run it and watch it fail**

Run: `cd apps/web && npx vitest run src/components/customer/journey/__tests__/journeyStorage.test.ts`

Expected: FAIL — `Failed to resolve import "../journeyStorage"` (module does not exist yet).

- [ ] **Step 11: Implement the storage helpers**

Create `apps/web/src/components/customer/journey/journeyStorage.ts`:

```ts
import { JOURNEY_RECORDABLE_TOUCH_CHANNELS, type JourneyRecordableTouchChannel } from '@installment/shared';

/**
 * ค่าที่จำไว้ในเบราว์เซอร์ของผู้ใช้คนนี้ — ความสะดวกเฉพาะคน ไม่ใช่ข้อมูลธุรกิจ
 * ทุกการอ่าน/เขียนครอบ try/catch: โหมดส่วนตัว · ที่เก็บเต็ม · ถูกบล็อก ต้องไม่ทำให้หน้าพัง
 * (pattern Customer360Panel `inbox360.collapsed.v1`)
 */
const LAST_CHANNEL_KEY = 'customerJourney.lastChannel.v1';
const HEARD_FROM_SKIPPED_KEY_PREFIX = 'customerJourney.heardFromSkipped.v1:';

function isRecordableChannel(value: string | null): value is JourneyRecordableTouchChannel {
  return value !== null && (JOURNEY_RECORDABLE_TOUCH_CHANNELS as readonly string[]).includes(value);
}

/** ช่องทางที่บันทึกสำเร็จล่าสุด — ค่าที่ไม่ใช่ 4 ช่องทางที่บันทึกได้ (รวม OTHER) ถือว่าไม่เคยจำ */
export function readLastChannel(): JourneyRecordableTouchChannel | null {
  try {
    const raw = localStorage.getItem(LAST_CHANNEL_KEY);
    return isRecordableChannel(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** เรียกหลังบันทึกสำเร็จ (201) เท่านั้น */
export function writeLastChannel(channel: JourneyRecordableTouchChannel): void {
  if (!isRecordableChannel(channel)) return;
  try {
    localStorage.setItem(LAST_CHANNEL_KEY, channel);
  } catch {
    // ที่เก็บใช้ไม่ได้ — ครั้งหน้าแค่ไม่มีช่องทางเลือกไว้ก่อน
  }
}

/** กด "ข้าม" ที่ป้ายรู้จักร้านจากไหนของลูกค้าคนนี้ในเซสชันนี้แล้วหรือยัง */
export function isHeardFromSkipped(customerId: string): boolean {
  try {
    return sessionStorage.getItem(HEARD_FROM_SKIPPED_KEY_PREFIX + customerId) === '1';
  } catch {
    return false;
  }
}

/** ซ่อนเฉพาะเซสชันนี้ — ปิดแท็บเบราว์เซอร์แล้วเปิดหน้าใหม่ ป้ายขึ้นอีก ("จนกว่าจะตอบ") */
export function markHeardFromSkipped(customerId: string): void {
  try {
    sessionStorage.setItem(HEARD_FROM_SKIPPED_KEY_PREFIX + customerId, '1');
  } catch {
    // ที่เก็บใช้ไม่ได้ — ผู้เรียกยังซ่อนด้วย state ของหน้าได้เอง
  }
}
```

- [ ] **Step 12: Run it and watch it pass**

Run: `cd apps/web && npx vitest run src/components/customer/journey/__tests__/journeyStorage.test.ts`

Expected: PASS — 1 file, 11 tests passed.

- [ ] **Step 13: Commit the storage helpers**

```bash
git add apps/web/src/components/customer/journey/journeyStorage.ts apps/web/src/components/customer/journey/__tests__/journeyStorage.test.ts
```

```bash
git commit -m "feat(web): จำช่องทางติดต่อล่าสุด + ข้ามป้ายรู้จักร้านจากไหนต่อเซสชัน — ตรวจค่ากับ 4 ช่องทาง ทนที่เก็บโยน error" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 14: Write the failing test for ChoiceChip / ChoiceChipRow**

Create `apps/web/src/components/customer/journey/__tests__/ChoiceChip.test.tsx`:

```tsx
import type { FormEvent } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChoiceChip, ChoiceChipRow } from '../ChoiceChip';

describe('ChoiceChip', () => {
  it('aria-pressed ตาม active · type=button แตะในฟอร์มไม่ส่งฟอร์ม', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: FormEvent) => {
      e.preventDefault();
    });
    const onClick = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <ChoiceChip active onClick={onClick}>
          โทร
        </ChoiceChip>
        <ChoiceChip active={false} onClick={() => {}}>
          LINE
        </ChoiceChip>
      </form>,
    );

    const on = screen.getByRole('button', { name: 'โทร' });
    expect(on).toHaveAttribute('type', 'button');
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on).toHaveClass('border-primary', 'bg-primary', 'text-primary-foreground');
    const off = screen.getByRole('button', { name: 'LINE' });
    expect(off).toHaveAttribute('aria-pressed', 'false');
    expect(off).toHaveClass('border-input', 'bg-card', 'text-foreground');

    await user.click(on);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('จอต่ำกว่า lg สูง 44px (Q17) — กฎอยู่ที่ชิปตัวเดียว', () => {
    render(
      <ChoiceChip active={false} onClick={() => {}}>
        หน้าร้าน
      </ChoiceChip>,
    );
    expect(screen.getByRole('button', { name: 'หน้าร้าน' })).toHaveClass(
      'rounded-full',
      'text-xs',
      'leading-snug',
      'max-lg:h-11',
      'max-lg:px-4',
      'max-lg:text-sm',
    );
  });

  it('disabled กดไม่ได้', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ChoiceChip active={false} disabled onClick={onClick}>
        นัดแล้ว
      </ChoiceChip>,
    );
    const chip = screen.getByRole('button', { name: 'นัดแล้ว' });
    expect(chip).toBeDisabled();
    await user.click(chip);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ชิปที่กำลังบันทึก: สปินเนอร์ + ดูเป็นชิปที่เลือก + ไม่จางแม้ disabled · ชิปอื่นจาง', () => {
    render(
      <ChoiceChipRow label="ผล">
        <ChoiceChip active={false} busy disabled onClick={() => {}}>
          นัดแล้ว
        </ChoiceChip>
        <ChoiceChip active={false} disabled onClick={() => {}}>
          ไม่รับสาย
        </ChoiceChip>
      </ChoiceChipRow>,
    );

    const busy = screen.getByRole('button', { name: 'นัดแล้ว' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-pressed', 'true');
    expect(busy).toHaveClass('bg-primary');
    expect(busy.querySelector('svg.animate-spin')).not.toBeNull();
    expect(busy.className).not.toContain('disabled:opacity-40');

    const idle = screen.getByRole('button', { name: 'ไม่รับสาย' });
    expect(idle).not.toHaveAttribute('aria-busy');
    expect(idle.querySelector('svg')).toBeNull();
    expect(idle).toHaveClass('disabled:opacity-40', 'disabled:cursor-not-allowed', 'bg-card');
  });
});

describe('ChoiceChipRow', () => {
  it('มีป้าย → group ชื่อตามป้าย + คำใบ้ตัวเล็กข้างป้าย', () => {
    render(
      <ChoiceChipRow label="ผล" hint="เลือกช่องทางก่อน">
        <ChoiceChip active={false} disabled onClick={() => {}}>
          นัดแล้ว
        </ChoiceChip>
      </ChoiceChipRow>,
    );
    const group = screen.getByRole('group', { name: 'ผล' });
    expect(within(group).getByText('เลือกช่องทางก่อน')).toHaveClass('text-2xs', 'text-muted-foreground/80');
    const row = within(group).getByRole('button', { name: 'นัดแล้ว' }).parentElement;
    expect(row).toHaveClass('flex', 'flex-wrap', 'gap-1.5', 'max-lg:gap-2');
  });

  it('ไม่มีป้าย → ไม่เป็น group (ผู้ห่อตั้งชื่อกลุ่มเอง เช่น HeardFromChips)', () => {
    render(
      <ChoiceChipRow>
        <ChoiceChip active={false} onClick={() => {}}>
          Google
        </ChoiceChip>
      </ChoiceChipRow>,
    );
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('button', { name: 'Google' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 15: Run it and watch it fail**

Run: `cd apps/web && npx vitest run src/components/customer/journey/__tests__/ChoiceChip.test.tsx`

Expected: FAIL — `Failed to resolve import "../ChoiceChip"`.

- [ ] **Step 16: Implement ChoiceChip / ChoiceChipRow**

Create `apps/web/src/components/customer/journey/ChoiceChip.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ชิปเลือกหนึ่งตัวของการเดินทางลูกค้า — สไตล์ลอก CallResultChips (pages/CollectionsPage/components/CallResultChips.tsx)
 * ตัวเดียวทุกจุด: ตัวเลือกบันทึกการติดต่อ · เหตุผลติดป้ายหลุด · ป้าย/การ์ดรู้จักร้านจากไหน · dialog สร้างลูกค้า
 *
 * - `busy` = ชิปที่เพิ่งแตะและกำลังบันทึก: หมุน Loader2 + ดูเป็นชิปที่เลือก (บอร์ด MobileSheet b)
 *   และไม่จางแม้ disabled — ถ้าปล่อย disabled:opacity-40 สปินเนอร์จะจางจนมองไม่เห็น (ชิปอื่นจางตามปกติ)
 * - จอต่ำกว่า lg (1024px เท่ากับ useIsMobile) สูง 44px ตาม Q17 — inline-flex items-center ให้ข้อความอยู่กลางความสูงนั้น
 * - type="button" เสมอ: อยู่ใน <form> ของ dialog สร้างลูกค้าได้ แตะแล้วต้องไม่ส่งฟอร์ม
 */
export interface ChoiceChipProps {
  active: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function ChoiceChip({ active, busy = false, disabled = false, onClick, children }: ChoiceChipProps) {
  const pressed = active || busy;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs leading-snug transition-colors max-lg:h-11 max-lg:px-4 max-lg:text-sm',
        !busy && 'disabled:cursor-not-allowed disabled:opacity-40',
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-card text-foreground hover:bg-accent',
      )}
    >
      {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export interface ChoiceChipRowProps {
  /** ป้ายแถว เช่น "ช่องทาง" / "ผล" — มีป้าย = แถวเป็น role="group" ชื่อตามป้าย */
  label?: string;
  /** คำใบ้ตัวเล็กต่อท้ายป้าย เช่น "เลือกช่องทางก่อน" (แสดงเมื่อมีป้ายเท่านั้น) */
  hint?: string;
  children: ReactNode;
}

export function ChoiceChipRow({ label, hint, children }: ChoiceChipRowProps) {
  return (
    <div role={label ? 'group' : undefined} aria-label={label}>
      {label && (
        <div className="mb-1.5 text-xs font-medium leading-snug text-muted-foreground">
          {label}
          {hint && <span className="ml-1 text-2xs font-normal text-muted-foreground/80">{hint}</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 max-lg:gap-2">{children}</div>
    </div>
  );
}
```

- [ ] **Step 17: Run it and watch it pass**

Run: `cd apps/web && npx vitest run src/components/customer/journey/__tests__/ChoiceChip.test.tsx`

Expected: PASS — 1 file, 6 tests passed.

- [ ] **Step 18: Commit the chip**

```bash
git add apps/web/src/components/customer/journey/ChoiceChip.tsx apps/web/src/components/customer/journey/__tests__/ChoiceChip.test.tsx
```

```bash
git commit -m "feat(web): ChoiceChip + ChoiceChipRow ชิปเลือกของการเดินทางลูกค้า — สไตล์ CallResultChips · 44px บนมือถือ · ชิปกำลังบันทึกไม่จาง" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 19: Write the failing test for ResponsiveChooser**

Create `apps/web/src/components/customer/journey/__tests__/ResponsiveChooser.test.tsx`:

```tsx
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { ResponsiveChooser } from '../ResponsiveChooser';

/**
 * 🔴 Radix Popover/Dialog ต้องใช้ userEvent (jsdom ไม่มี PointerEvent) · hook ของ vitest ห้าม return ค่า
 * useIsMobile จริงคืน false ในเรนเดอร์แรก — mock ให้คงที่ต่อเทส (pattern StockPage/ProductsPage.test.tsx)
 */
const mocks = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.mobile }));

function Host({ onOpenChange = () => {} }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <ResponsiveChooser
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange(next);
      }}
      title="บันทึกการติดต่อ"
      trigger={
        <Button variant="outline" size="sm">
          เปิดตัวเลือก
        </Button>
      }
    >
      <button type="button" onClick={() => setOpen(false)}>
        เลือกแล้วปิด
      </button>
    </ResponsiveChooser>
  );
}

beforeEach(() => {
  mocks.mobile = false;
});

describe('ResponsiveChooser', () => {
  it('จอกว้าง: Popover ชิดขวา กว้าง w-80 · dialog ชื่อตามหัวข้อ · ปุ่มเปิดอยู่สถานะ open', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Host onOpenChange={onOpenChange} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    const trigger = screen.getByRole('button', { name: 'เปิดตัวเลือก' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'บันทึกการติดต่อ' });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('data-state', 'open');
    expect(dialog).toHaveClass('w-80');
    expect(dialog).toHaveAttribute('data-align', 'end');
    expect(dialog).not.toHaveClass('rounded-t-2xl');
    expect(within(dialog).getByText('บันทึกการติดต่อ')).toHaveClass('mb-3', 'text-sm', 'font-semibold', 'leading-snug');

    await user.click(within(dialog).getByRole('button', { name: 'เลือกแล้วปิด' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('จอกว้าง: กด Esc ปิด และแจ้ง onOpenChange(false)', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Host onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole('button', { name: 'เปิดตัวเลือก' }));
    await screen.findByRole('dialog', { name: 'บันทึกการติดต่อ' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('จอเล็ก (<1024): Sheet ด้านล่าง มุมบนโค้ง · หัวข้อเป็น heading · มีคำอธิบายสำหรับโปรแกรมอ่านจอ', async () => {
    mocks.mobile = true;
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole('button', { name: 'เปิดตัวเลือก' }));

    const dialog = await screen.findByRole('dialog', { name: 'บันทึกการติดต่อ' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(dialog).toHaveClass('rounded-t-2xl', 'max-h-[80vh]', 'overflow-y-auto');
    expect(dialog).not.toHaveClass('w-80');
    expect(within(dialog).getByRole('heading', { name: 'บันทึกการติดต่อ' })).toBeInTheDocument();
    expect(within(dialog).getByText('เลือกจากตัวเลือกด้านล่าง')).toHaveClass('sr-only');

    await user.click(within(dialog).getByRole('button', { name: 'เลือกแล้วปิด' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
```

- [ ] **Step 20: Run it and watch it fail**

Run: `cd apps/web && npx vitest run src/components/customer/journey/__tests__/ResponsiveChooser.test.tsx`

Expected: FAIL — `Failed to resolve import "../ResponsiveChooser"`.

- [ ] **Step 21: Implement ResponsiveChooser**

Create `apps/web/src/components/customer/journey/ResponsiveChooser.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/useIsMobile';

/**
 * เปลือกตัวเลือกของการเดินทางลูกค้า — จอกว้าง = Popover ชิดขวาของปุ่ม · ต่ำกว่า 1024px = Sheet ด้านล่าง
 * (บอร์ด Main b / MobileSheet · precedent Sheet ล่าง: UnifiedInboxPage/components/customer360/CustomerContractDialogs.tsx)
 *
 * - `open` ควบคุมโดยผู้เรียก: ผู้เรียกปิดเองหลังบันทึกสำเร็จ และล้าง state ภายใน (ขั้นถามติดป้ายหลุด ฯลฯ) ตอนปิด
 * - `trigger` ต้องเป็น element เดียวที่รับ props ได้ (เช่น <Button>) — ใส่ผ่าน Trigger asChild ทั้งสองแบบ
 *   จึงได้ data-state="open" ตอนเปิด (Button outline เป็นพื้น accent เอง)
 * - Popover ของ Radix มี role="dialog" แต่ไม่มีชื่อ ⇒ aria-label = หัวข้อ · ค่าเริ่มต้น w-72 ทำชิปผล 7 ตัวล้นเกิน 3 แถว จึงใช้ w-80
 * - useIsMobile คืน false ในเรนเดอร์แรกแล้วค่อยปรับ — ไม่มีผลเพราะตัวเลือกเปิดจากการแตะเท่านั้น
 */
export interface ResponsiveChooserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  trigger: ReactElement;
  children: ReactNode;
}

export function ResponsiveChooser({ open, onOpenChange, title, trigger, children }: ResponsiveChooserProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">เลือกจากตัวเลือกด้านล่าง</SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80" aria-label={title}>
        <div className="mb-3 text-sm font-semibold leading-snug">{title}</div>
        {children}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 22: Run it and watch it pass**

Run: `cd apps/web && npx vitest run src/components/customer/journey/__tests__/ResponsiveChooser.test.tsx`

Expected: PASS — 1 file, 3 tests passed.

- [ ] **Step 23: Commit the chooser shell**

```bash
git add apps/web/src/components/customer/journey/ResponsiveChooser.tsx apps/web/src/components/customer/journey/__tests__/ResponsiveChooser.test.tsx
```

```bash
git commit -m "feat(web): ResponsiveChooser — Popover ชิดขวา w-80 บนจอกว้าง · Sheet ด้านล่างต่ำกว่า 1024px · dialog มีชื่อตามหัวข้อ" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 24: Write the failing test for HeardFromChips**

Create `apps/web/src/components/customer/journey/__tests__/HeardFromChips.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HeardFromChips } from '../HeardFromChips';

/** ลำดับบนบอร์ด HeardFrom (a)(b)(c1) และ Main (e) = JOURNEY_HEARD_FROM_CODES — ปักตัวอักษรจริงไว้ ไม่อ่านจาก shared */
const LABELS_IN_ORDER = ['โฆษณา FB', 'เพจ/โพสต์', 'TikTok', 'LINE', 'Google', 'เพื่อนแนะนำ', 'ผ่านหน้าร้าน', 'ลูกค้าเก่า', 'อื่น ๆ'];

function chips(): HTMLButtonElement[] {
  const group = screen.getByRole('group', { name: 'ลูกค้ารู้จักร้านจากไหน' });
  return within(group)
    .getAllByRole('button')
    .filter((button): button is HTMLButtonElement => button.hasAttribute('aria-pressed'));
}

describe('HeardFromChips', () => {
  it('หัวข้อ "(ไม่บังคับ)" + ชิป 9 ตัวตามลำดับ · ยังไม่มีคำตอบไม่มีชิปไหนถูกเลือก · ไม่มี onSkip ไม่มีปุ่มข้าม', () => {
    render(<HeardFromChips value={null} onSelect={() => {}} skipStyle="text" />);

    expect(screen.getByText('ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)')).toHaveClass('text-xs', 'font-medium', 'text-muted-foreground');
    expect(chips().map((chip) => chip.textContent)).toEqual(LABELS_IN_ORDER);
    expect(chips().every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.queryByRole('button', { name: 'ข้าม' })).toBeNull();
  });

  it('value เลือกชิปเดียว และแตะส่งรหัสของชิปที่แตะ (รวมชิปที่เลือกอยู่แล้ว)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<HeardFromChips value="LINE" onSelect={onSelect} skipStyle="text" />);

    const pressed = chips().filter((chip) => chip.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((chip) => chip.textContent)).toEqual(['LINE']);

    await user.click(screen.getByRole('button', { name: 'เพื่อนแนะนำ' }));
    expect(onSelect).toHaveBeenCalledWith('FRIEND');
    await user.click(screen.getByRole('button', { name: 'LINE' }));
    expect(onSelect).toHaveBeenLastCalledWith('LINE');
  });

  it('pendingCode: ชิปนั้นหมุน + ทุกชิปล็อกกันแตะซ้ำ + ปุ่มข้ามล็อก', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <HeardFromChips value={null} onSelect={onSelect} pendingCode="WALK_BY" onSkip={() => {}} skipStyle="ghost-button" />,
    );

    const busy = screen.getByRole('button', { name: 'ผ่านหน้าร้าน' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.querySelector('svg.animate-spin')).not.toBeNull();
    expect(chips().every((chip) => chip.disabled)).toBe(true);
    expect(screen.getByRole('button', { name: 'ข้าม' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Google' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disabled ล็อกทุกชิป', () => {
    render(<HeardFromChips value={null} onSelect={() => {}} disabled skipStyle="text" />);
    expect(chips()).toHaveLength(9);
    expect(chips().every((chip) => chip.disabled)).toBe(true);
  });

  it('skipStyle="ghost-button": "ข้าม" เป็น Button ghost sm (ป้ายบนแท็บการเดินทาง)', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<HeardFromChips value={null} onSelect={() => {}} onSkip={onSkip} skipStyle="ghost-button" />);

    const skip = screen.getByRole('button', { name: 'ข้าม' });
    expect(skip).toHaveAttribute('data-slot', 'button');
    expect(skip).toHaveAttribute('type', 'button');
    await user.click(skip);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('skipStyle="text": "ข้าม" เป็นปุ่มข้อความเล็ก (การ์ดสร้างสัญญา · dialog สร้างลูกค้า)', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<HeardFromChips value="FRIEND" onSelect={() => {}} onSkip={onSkip} skipStyle="text" />);

    const skip = screen.getByRole('button', { name: 'ข้าม' });
    expect(skip).not.toHaveAttribute('data-slot');
    expect(skip).toHaveAttribute('type', 'button');
    expect(skip).toHaveClass('text-xs', 'leading-snug', 'text-muted-foreground', 'hover:text-foreground');
    await user.click(skip);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 25: Run it and watch it fail**

Run: `cd apps/web && npx vitest run src/components/customer/journey/__tests__/HeardFromChips.test.tsx`

Expected: FAIL — `Failed to resolve import "../HeardFromChips"`.

- [ ] **Step 26: Implement HeardFromChips**

Create `apps/web/src/components/customer/journey/HeardFromChips.tsx`:

```tsx
import { JOURNEY_HEARD_FROM_CODES, JOURNEY_HEARD_FROM_LABELS, type JourneyHeardFrom } from '@installment/shared';
import { Button } from '@/components/ui/button';
import { ChoiceChip, ChoiceChipRow } from './ChoiceChip';

/**
 * ชิป "ลูกค้ารู้จักร้านจากไหน" 9 ตัว — ถามเฉพาะลูกค้าหน้าร้าน (คำตัดสินข้อ 3) ผู้ห่อตัดสินว่าจะแสดงเมื่อไรและบันทึกตอนไหน:
 * - ป้ายบนแท็บการเดินทาง / การ์ดสร้างสัญญา: แตะ = บันทึกทันที ส่ง `pendingCode` ระหว่างรอ
 * - dialog สร้างลูกค้า / POS: แตะ = เลือกไว้ (แตะซ้ำ = ยกเลิก — ผู้ห่อสลับเอง) แล้วบันทึกหลังสร้างลูกค้าสำเร็จ
 * `onSelect` ส่งรหัสที่แตะเสมอ · ระหว่าง `pendingCode` ทุกชิปและปุ่ม "ข้าม" ถูกล็อกกันแตะซ้ำ
 * `skipStyle`: 'ghost-button' = Button ghost sm (ป้ายบนแท็บ · บอร์ด Main e) · 'text' = ปุ่มข้อความเล็ก (บอร์ด HeardFrom a/b/c1)
 */
export interface HeardFromChipsProps {
  value: JourneyHeardFrom | null;
  onSelect: (code: JourneyHeardFrom) => void;
  pendingCode?: JourneyHeardFrom | null;
  disabled?: boolean;
  onSkip?: () => void;
  skipStyle: 'ghost-button' | 'text';
}

export function HeardFromChips({
  value,
  onSelect,
  pendingCode = null,
  disabled = false,
  onSkip,
  skipStyle,
}: HeardFromChipsProps) {
  const saving = pendingCode !== null;
  const locked = disabled || saving;

  return (
    <div role="group" aria-label="ลูกค้ารู้จักร้านจากไหน" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium leading-snug text-muted-foreground">ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)</div>
        {onSkip &&
          (skipStyle === 'ghost-button' ? (
            <Button type="button" variant="ghost" size="sm" onClick={onSkip} disabled={saving}>
              ข้าม
            </Button>
          ) : (
            <button
              type="button"
              onClick={onSkip}
              disabled={saving}
              className="text-xs leading-snug text-muted-foreground hover:text-foreground"
            >
              ข้าม
            </button>
          ))}
      </div>
      <ChoiceChipRow>
        {JOURNEY_HEARD_FROM_CODES.map((code) => (
          <ChoiceChip
            key={code}
            active={value === code}
            busy={pendingCode === code}
            disabled={locked}
            onClick={() => onSelect(code)}
          >
            {JOURNEY_HEARD_FROM_LABELS[code]}
          </ChoiceChip>
        ))}
      </ChoiceChipRow>
    </div>
  );
}
```

- [ ] **Step 27: Run it and watch it pass**

Run: `cd apps/web && npx vitest run src/components/customer/journey/__tests__/HeardFromChips.test.tsx`

Expected: PASS — 1 file, 6 tests passed.

- [ ] **Step 28: Commit the heard-from chips**

```bash
git add apps/web/src/components/customer/journey/HeardFromChips.tsx apps/web/src/components/customer/journey/__tests__/HeardFromChips.test.tsx
```

```bash
git commit -m "feat(web): HeardFromChips ชิปรู้จักร้านจากไหน 9 ตัวตามลำดับ shared — ข้ามได้ 2 แบบ · ล็อกทุกชิประหว่างบันทึก" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 29: Write the failing test for the entry write helpers**

Create `apps/web/src/hooks/customer-journey/journeyEntries.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { JourneyEntryCreatedResponse, JourneyEntryDeletedResponse } from '@installment/shared';
import { journeySummary } from '@/pages/CustomerDetailPage/__tests__/journeyFixtures';
import {
  JOURNEY_UNDO_TOAST_MS,
  deleteJourneyEntry,
  postHeardFrom,
  undoToastOptions,
  useDeleteJourneyEntry,
  useRecordJourneyEntry,
} from './journeyEntries';

/**
 * 🔴 hook ของ vitest ห้าม return ค่า — คร่อมปีกกาเสมอ
 * 🔴 promise ที่ต้อง reject ใช้ mockImplementation(() => Promise.reject(...)) ไม่ใช้ mockRejectedValue
 */
const mocks = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn(), uidSeq: 0 }));

vi.mock('@/lib/api', () => ({
  default: { post: mocks.post, delete: mocks.del },
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'ผิดพลาด'),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/utils/uid', () => ({ uid: () => `uuid-${++mocks.uidSeq}` }));

const SUMMARY_KEY = ['customer-journey-summary', 'c1'];
/** key ของแท็บ (groups = null) — อยู่ใต้ prefix ['customer-journey', 'c1'] เดียวกับการ์ดกิจกรรมล่าสุด */
const LIST_KEY = ['customer-journey', 'c1', null];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(SUMMARY_KEY, journeySummary({ stage: 'IDENTIFIED' }));
  qc.setQueryData(LIST_KEY, { pages: [], pageParams: [] });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.post.mockReset();
  mocks.del.mockReset();
  mocks.uidSeq = 0;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('useRecordJourneyEntry', () => {
  it('POST → ตั้ง summary จากคำตอบ + ทำให้รายการไทม์ไลน์ค้าง (ไม่สั่ง summary โหลดซ้ำ) · hook ไม่ toast เอง', async () => {
    const { qc, wrapper } = setup();
    const fresh = journeySummary({ stage: 'INTERESTED' });
    const response: JourneyEntryCreatedResponse = { entryId: 'e1', event: null, summary: fresh };
    mocks.post.mockImplementation(async () => ({ data: response }));
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRecordJourneyEntry('c1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED', clientRequestId: 'req-1' });
    });

    expect(mocks.post).toHaveBeenCalledWith('/customers/c1/journey/entries', {
      kind: 'TOUCHPOINT',
      channel: 'PHONE',
      outcome: 'APPOINTED',
      clientRequestId: 'req-1',
    });
    expect(qc.getQueryData(SUMMARY_KEY)).toEqual(fresh);
    expect(qc.getQueryState(LIST_KEY)?.isInvalidated).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customer-journey', 'c1'] });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('คอมโพเนนต์ถูกถอด (Radix TabsContent สลับแท็บ) ระหว่างรอคำตอบ ก็ยังอัปเดตแคช', async () => {
    const { qc, wrapper } = setup();
    const fresh = journeySummary({ stage: 'CONTACTED', lost: null });
    const pending = deferred<{ data: JourneyEntryCreatedResponse }>();
    mocks.post.mockImplementation(() => pending.promise);
    const { result, unmount } = renderHook(() => useRecordJourneyEntry('c1'), { wrapper });

    act(() => {
      result.current.mutate({ kind: 'REOPENED', clientRequestId: 'req-2' });
    });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    unmount();
    pending.resolve({ data: { entryId: 'e2', event: null, summary: fresh } });

    await waitFor(() => expect(qc.getQueryData(SUMMARY_KEY)).toEqual(fresh));
    expect(qc.getQueryState(LIST_KEY)?.isInvalidated).toBe(true);
  });

  it('POST ล้ม → mutateAsync โยนต่อ (ผู้เรียกเปิดตัวเลือกค้าง + toast.error เอง) · แคชไม่ขยับ', async () => {
    const { qc, wrapper } = setup();
    const before = qc.getQueryData(SUMMARY_KEY);
    mocks.post.mockImplementation(() => Promise.reject(new Error('กรุณาเลือกผลการติดต่อ')));
    const { result } = renderHook(() => useRecordJourneyEntry('c1'), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ kind: 'HEARD_FROM', heardFrom: 'FRIEND', clientRequestId: 'req-3' }),
      ).rejects.toThrow('กรุณาเลือกผลการติดต่อ');
    });

    expect(qc.getQueryData(SUMMARY_KEY)).toBe(before);
    expect(qc.getQueryState(LIST_KEY)?.isInvalidated).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('deleteJourneyEntry', () => {
  it('ปุ่ม "เลิกทำ" ใน toast ทำงานได้หลังคอมโพเนนต์ที่สร้างมันถูกถอดแล้ว: DELETE → summary + รายการ + toast', async () => {
    const { qc, wrapper } = setup();
    const { result, unmount } = renderHook(() => useQueryClient(), { wrapper });
    const client = result.current;
    const undo = () => deleteJourneyEntry(client, 'c1', 'e1');
    unmount();

    const fresh = journeySummary({ stage: 'CONTACTED' });
    const response: JourneyEntryDeletedResponse = { summary: fresh };
    mocks.del.mockImplementation(async () => ({ data: response }));

    await undo();

    expect(mocks.del).toHaveBeenCalledWith('/customers/c1/journey/entries/e1');
    expect(qc.getQueryData(SUMMARY_KEY)).toEqual(fresh);
    expect(qc.getQueryState(LIST_KEY)?.isInvalidated).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('เลิกทำแล้ว');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('DELETE ล้ม → toast.error ด้วยข้อความจาก API · ไม่โยนต่อ · แคชไม่ขยับ', async () => {
    const { qc } = setup();
    const before = qc.getQueryData(SUMMARY_KEY);
    mocks.del.mockImplementation(() => Promise.reject(new Error('ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง')));

    await expect(deleteJourneyEntry(qc, 'c1', 'e1')).resolves.toBeUndefined();

    expect(toast.error).toHaveBeenCalledWith('ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง');
    expect(toast.success).not.toHaveBeenCalled();
    expect(qc.getQueryData(SUMMARY_KEY)).toBe(before);
    expect(qc.getQueryState(LIST_KEY)?.isInvalidated).toBe(false);
  });
});

describe('useDeleteJourneyEntry', () => {
  it('isPending + variables = entryId ระหว่างรอ แล้วจบด้วย toast เดียวกับ deleteJourneyEntry', async () => {
    const { wrapper } = setup();
    const pending = deferred<{ data: JourneyEntryDeletedResponse }>();
    mocks.del.mockImplementation(() => pending.promise);
    const { result } = renderHook(() => useDeleteJourneyEntry('c1'), { wrapper });

    act(() => {
      result.current.mutate('e9');
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.variables).toBe('e9');
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('/customers/c1/journey/entries/e9'));

    pending.resolve({ data: { summary: journeySummary() } });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(toast.success).toHaveBeenCalledWith('เลิกทำแล้ว');
  });
});

describe('undoToastOptions — toast สำเร็จชุดเดียวของทุกปุ่มบันทึก (แถบขั้น · บันทึกการติดต่อ · รู้จักร้านจากไหน)', () => {
  it('ไม่มี entryId (เปิดอยู่แล้ว — D9) → อายุ 10 วินาที ไม่มีปุ่มเลิกทำ', () => {
    const { qc } = setup();
    expect(JOURNEY_UNDO_TOAST_MS).toBe(10_000);
    expect(undoToastOptions(qc, 'c1', null)).toEqual({ duration: 10_000 });
  });

  it('มี entryId → ปุ่ม "เลิกทำ" ลบแถวนั้นผ่าน deleteJourneyEntry (ใช้ได้แม้ผู้สร้าง toast ถูกถอดแล้ว — D12)', async () => {
    const { qc } = setup();
    const response: JourneyEntryDeletedResponse = { summary: journeySummary({ stage: 'CONTACTED' }) };
    mocks.del.mockImplementation(async () => ({ data: response }));

    const options = undoToastOptions(qc, 'c1', 'e1');
    expect(options).toMatchObject({ duration: 10_000, action: { label: 'เลิกทำ' } });
    options.action?.onClick();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('เลิกทำแล้ว'));
    expect(mocks.del).toHaveBeenCalledWith('/customers/c1/journey/entries/e1');
    expect(qc.getQueryData(SUMMARY_KEY)).toEqual(response.summary);
  });

  it('ส่ง onUndo → ปุ่มเรียก onUndo แทน (ผู้เรียกลบเองพร้อมอัปเดตสถานะของตัวเอง เช่นแถบรู้จักร้านจากไหน)', () => {
    const { qc } = setup();
    const onUndo = vi.fn();

    undoToastOptions(qc, 'c1', 'e1', onUndo).action?.onClick();

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(mocks.del).not.toHaveBeenCalled();
  });
});

describe('postHeardFrom', () => {
  it('สำเร็จ → false · body เป็น HEARD_FROM พร้อม clientRequestId ใหม่ทุกครั้ง', async () => {
    mocks.post.mockImplementation(async () => ({ data: {} }));

    await expect(postHeardFrom('c-new', 'FRIEND')).resolves.toBe(false);
    await expect(postHeardFrom('c-new', 'WALK_BY')).resolves.toBe(false);

    expect(mocks.post).toHaveBeenNthCalledWith(1, '/customers/c-new/journey/entries', {
      kind: 'HEARD_FROM',
      heardFrom: 'FRIEND',
      clientRequestId: 'uuid-1',
    });
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/customers/c-new/journey/entries', {
      kind: 'HEARD_FROM',
      heardFrom: 'WALK_BY',
      clientRequestId: 'uuid-2',
    });
  });

  it('ล้ม → true · ไม่โยน · ไม่ toast (dialog เตือนหลัง toast สร้างลูกค้าสำเร็จเอง)', async () => {
    mocks.post.mockImplementation(() => Promise.reject(new Error('boom')));

    await expect(postHeardFrom('c-new', 'OTHER')).resolves.toBe(true);

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 30: Run it and watch it fail**

Run: `cd apps/web && npx vitest run src/hooks/customer-journey/journeyEntries.test.tsx`

Expected: FAIL — `Failed to resolve import "./journeyEntries"`.

- [ ] **Step 31: Implement the entry write helpers**

Create `apps/web/src/hooks/customer-journey/journeyEntries.ts`:

```ts
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  JourneyEntryCreatedResponse,
  JourneyEntryDeletedResponse,
  JourneyHeardFrom,
  JourneyManualEntryInput,
  JourneySummary,
} from '@installment/shared';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { uid } from '@/utils/uid';

/**
 * เขียน/ลบบันทึกมือของการเดินทางลูกค้า (เฟส 3) — แถบขั้น · แท็บการเดินทาง · การ์ดสร้างสัญญา · dialog สร้างลูกค้า ใช้ชุดนี้ชุดเดียว
 *
 * key ต้องตรงกับ useCustomerJourney.ts: summary = ['customer-journey-summary', id] (อยู่นอก prefix รายการ)
 * รายการ = ['customer-journey', id, groups] (prefix ครอบแท็บ + การ์ดกิจกรรมล่าสุด)
 * คำตอบของ POST/DELETE มี summary สดแล้ว ⇒ setQueryData แทนการโหลด summary ซ้ำ แล้วค่อยให้รายการโหลดใหม่
 *
 * 🔴 ห้ามย้าย onSuccess ไปใส่ใน mutate(vars, { onSuccess }) — Radix TabsContent ถอดแผงที่ไม่ active
 *    และ TanStack ข้าม callback ต่อครั้งเมื่อ observer ถูกถอด ⇒ คำตอบที่มาถึงหลังสลับแท็บจะไม่อัปเดตอะไร (บทเรียน R5)
 */
const summaryKey = (customerId: string) => ['customer-journey-summary', customerId] as const;
const listKey = (customerId: string) => ['customer-journey', customerId] as const;
const entriesUrl = (customerId: string) => `/customers/${customerId}/journey/entries`;

function applyJourneyWrite(queryClient: QueryClient, customerId: string, summary: JourneySummary): void {
  queryClient.setQueryData(summaryKey(customerId), summary);
  void queryClient.invalidateQueries({ queryKey: listKey(customerId) });
}

/**
 * บันทึกมือหนึ่งรายการ — ผู้เรียกใส่ clientRequestId: uid() ใหม่ต่อการแตะหนึ่งครั้ง (ไม่ใช่ต่อการเปิดตัวเลือก — D8)
 * ไม่ toast เอง: ผู้เรียกรู้ข้อความ ("บันทึกแล้ว" / "ติดป้ายหลุดแล้ว" / "เปิดอยู่แล้ว") และปุ่ม "เลิกทำ" ของตัวเอง
 */
export function useRecordJourneyEntry(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation<JourneyEntryCreatedResponse, Error, JourneyManualEntryInput>({
    mutationKey: ['customer-journey-entry', 'record', customerId],
    mutationFn: async (input) => {
      const { data } = await api.post<JourneyEntryCreatedResponse>(entriesUrl(customerId), input);
      return data;
    },
    onSuccess: (res) => {
      applyJourneyWrite(queryClient, customerId, res.summary);
    },
  });
}

/**
 * "เลิกทำ" — ฟังก์ชันธรรมดาที่รับ queryClient ที่จับไว้ จึงเรียกจากปุ่มใน toast ได้แม้คอมโพเนนต์ที่สร้าง toast ถูกถอดแล้ว (D12)
 * ไม่โยนต่อ: สำเร็จ toast "เลิกทำแล้ว" · ล้ม toast ข้อความจาก API (เช่น 403 เกิน 24 ชั่วโมง) · กดซ้ำ API ตอบ 200 no-op
 */
export async function deleteJourneyEntry(queryClient: QueryClient, customerId: string, entryId: string): Promise<void> {
  try {
    const { data } = await api.delete<JourneyEntryDeletedResponse>(`${entriesUrl(customerId)}/${entryId}`);
    applyJourneyWrite(queryClient, customerId, data.summary);
    toast.success('เลิกทำแล้ว');
  } catch (err) {
    toast.error(getErrorMessage(err));
  }
}

/** อายุ toast "เลิกทำ" ของทุกปุ่มบันทึกการเดินทาง — แหล่งเดียว ห้ามตั้งเลขเองในหน้าจอ */
export const JOURNEY_UNDO_TOAST_MS = 10_000;

/** รูปตัวเลือก toast ที่ส่งเข้า toast.success ได้ตรง ๆ (เข้ากับ ExternalToast ของ sonner) — ผู้เรียกกระจายคีย์อื่นทับได้ เช่น onAutoClose */
export interface JourneyUndoToastOptions {
  duration: number;
  action?: { label: string; onClick: () => void };
}

/**
 * ตัวเลือก toast สำเร็จของรายการที่พนักงานกด — ชุดเดียวของแถบขั้น (ติดป้ายหลุด/เปิดใหม่) · บันทึกการติดต่อ · รู้จักร้านจากไหน
 * entryId null = เซิร์ฟเวอร์ไม่ได้เขียนแถว (เช่นเปิดอยู่แล้ว — D9) ⇒ ไม่มีปุ่ม "เลิกทำ"
 * ปุ่มเรียก deleteJourneyEntry ด้วย queryClient ที่จับไว้ ไม่ผูกกับอายุคอมโพเนนต์ (D12) · ส่ง onUndo เมื่อผู้เรียกต้องจัดการสถานะของตัวเองด้วย
 */
export function undoToastOptions(
  queryClient: QueryClient,
  customerId: string,
  entryId: string | null,
  onUndo?: () => void,
): JourneyUndoToastOptions {
  if (!entryId) return { duration: JOURNEY_UNDO_TOAST_MS };
  return {
    duration: JOURNEY_UNDO_TOAST_MS,
    action: {
      label: 'เลิกทำ',
      onClick: onUndo ?? (() => void deleteJourneyEntry(queryClient, customerId, entryId)),
    },
  };
}

/** ลิงก์ "เลิกทำ" ท้ายแถวไทม์ไลน์ — ใช้ isPending / variables ปิดลิงก์ของแถวที่กำลังลบ */
export function useDeleteJourneyEntry(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationKey: ['customer-journey-entry', 'delete', customerId],
    mutationFn: (entryId) => deleteJourneyEntry(queryClient, customerId, entryId),
  });
}

/**
 * บันทึก "รู้จักร้านจากไหน" ต่อท้ายการสร้างลูกค้าใหม่ (dialog สร้างลูกค้า · POS)
 * คืน true = บันทึกไม่สำเร็จ — ไม่โยน ไม่ toast: การสร้างลูกค้าต้องสำเร็จเสมอ ผู้เรียกเตือน *หลัง* toast สร้างสำเร็จ
 * ห้ามใส่ heardFrom ใน body ของ POST /customers (whitelist ของ ValidationPipe ตัดทิ้งเงียบ)
 */
export async function postHeardFrom(customerId: string, code: JourneyHeardFrom): Promise<boolean> {
  const body: JourneyManualEntryInput = { kind: 'HEARD_FROM', heardFrom: code, clientRequestId: uid() };
  try {
    await api.post<JourneyEntryCreatedResponse>(entriesUrl(customerId), body);
    return false;
  } catch {
    return true;
  }
}
```

- [ ] **Step 32: Run it and watch it pass**

Run: `cd apps/web && npx vitest run src/hooks/customer-journey/journeyEntries.test.tsx`

Expected: PASS — 1 file, 11 tests passed.

- [ ] **Step 33: Commit the write helpers**

```bash
git add apps/web/src/hooks/customer-journey/journeyEntries.ts apps/web/src/hooks/customer-journey/journeyEntries.test.tsx
```

```bash
git commit -m "feat(web): hook บันทึก/เลิกทำการเดินทางลูกค้า — ตั้ง summary จากคำตอบ + โหลดรายการใหม่ · เลิกทำใช้ได้หลังสลับแท็บ · undoToastOptions ชุดเดียวของ toast เลิกทำ 10 วินาที · postHeardFrom ไม่โยน" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 34: Full verification of the task (both timezones, types, lint)**

Run each command separately:

```bash
cd apps/web && npx vitest run src/hooks/customer-journey src/components/customer/journey src/lib/__tests__/journey-record-roles.test.ts src/pages/CustomerDetailPage
```

```bash
cd apps/web && TZ=UTC npx vitest run src/hooks/customer-journey src/components/customer/journey src/lib/__tests__/journey-record-roles.test.ts src/pages/CustomerDetailPage
```

Expected (both): all files passed, 0 failed; the 6 new files contribute 46 tests (9 roles + 11 storage + 6 chip + 3 chooser + 6 heard-from + 11 entries).

```bash
cd apps/web && npx tsc --noEmit
```

Expected: exit 0, no output.

```bash
cd apps/web && npx eslint src/hooks/customer-journey src/components/customer/journey src/lib/constants.ts src/lib/__tests__/journey-record-roles.test.ts src/pages/CustomerDetailPage/index.tsx src/pages/CustomerDetailPage/tabs/CreditTab.tsx src/pages/CustomerDetailPage/tabs/JourneyTab.tsx src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx src/pages/CustomerDetailPage/components/RecentActivityCard.tsx src/pages/CustomerDetailPage/components/DetailHeader.tsx
```

Expected: no errors (exit 0). Nothing to commit when all four are green. If any fix is needed, stage only the files you changed with explicit paths and make a new commit (never amend) whose message ends with `-m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"`.

---

### Task 11: Stage strip (captions, lost/reopen) + KPI credit tile

**Files:**
- Create: `apps/web/src/pages/CustomerDetailPage/components/JourneyLostControls.tsx`
- Modify (replace whole file): `apps/web/src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx` (1-105 at the base `10d6e6d3a`; Task 1 added the `DOT_CLASS.not_needed` line)
- Modify: `apps/web/src/pages/CustomerDetailPage/utils/kpiTiles.ts` (import 1, signature 49, prospect credit tile 97-108)
- Modify: `apps/web/src/pages/CustomerDetailPage/index.tsx` (import after 9, `canRecord` after 69, `kpiTiles(...)` 126, `<JourneyStageStrip>` 128)
- Test (replace whole file — Task 2 already rewrote it for the new stage order): `apps/web/src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx`
- Test: `apps/web/src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts` (last test 125-131)
- Test: `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` (import 3, hoisted mocks 29-31, sonner mock 40, `beforeEach` 69-70, new `describe` appended after the last line)
- Test helper: `apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts` (append after the last line)

Line numbers are from the base `origin/main` `10d6e6d3a`; Tasks 1, 2 and 10 shift some of them — every edit below is anchored on quoted text, never on a line number.

**Interfaces:**

Consumes:
- `@installment/shared` (Tasks 1, 2, 4):
  - `JOURNEY_STAGES = ['CONTACTED','IDENTIFIED','CREDIT','INTERESTED','PURCHASED']`, `STAGE_LABELS.INTERESTED = 'นัด / จอง'` (Task 2)
  - `type JourneyStepState = 'done' | 'current' | 'skipped' | 'todo' | 'not_needed'` (read as `JourneyStep['state']`)
  - `JourneyStep.evidence: JourneyStepEvidence` = `'SYSTEM' | 'MANUAL' | 'CHAT_FILE'`
  - `JourneySummary.creditFilePending: boolean` (Task 4 computes it; Task 1 fixture default `false`)
  - `JOURNEY_LOST_REASONS = ['NOT_INTERESTED','BOUGHT_ELSEWHERE','CREDIT_FAILED','UNREACHABLE','OTHER'] as const`, `type JourneyLostReason = (typeof JOURNEY_LOST_REASONS)[number]`
  - `JOURNEY_LOST_REASON_LABELS: Readonly<Record<string, string>>` (shipped, type unchanged)
  - `type JourneyManualEntryInput` (members used: `{ kind: 'MARKED_LOST'; lostReason: JourneyLostReason; clientRequestId?: string }`, `{ kind: 'REOPENED'; clientRequestId?: string }`)
  - `interface JourneyEntryCreatedResponse { entryId: string | null; event: JourneyEvent | null; summary: JourneySummary }`
- Task 1 fixture `journeyFixtures.ts`: `stageSteps()` returns `at: null` for `todo` / `skipped` / `not_needed`; `journeySummary()` defaults `askHeardFrom: false`, `creditFilePending: false`.
- Tasks 7/8 endpoints: `POST /customers/:id/journey/entries` → 201 `JourneyEntryCreatedResponse` (REOPENED while not lost → `entryId: null`, D9); `DELETE /customers/:id/journey/entries/:entryId` → 200 `{ summary }`.
- Task 10 `@/hooks/customer-journey/journeyEntries`:
  - `useRecordJourneyEntry(customerId: string)` — TanStack mutation, variables `JourneyManualEntryInput`, data `JourneyEntryCreatedResponse`; `mutationFn` = `api.post('/customers/${customerId}/journey/entries', input)` → `data`; `onSuccess` in the `useMutation` options = `setQueryData(['customer-journey-summary', customerId], res.summary)` + invalidate `['customer-journey', customerId]`; no toast inside the hook.
  - `deleteJourneyEntry(queryClient: QueryClient, customerId: string, entryId: string): Promise<void>` — `api.delete('/customers/${customerId}/journey/entries/${entryId}')`, cache update, `toast.success('เลิกทำแล้ว')` / `toast.error(getErrorMessage(err))`; never rejects.
  - `undoToastOptions(queryClient: QueryClient, customerId: string, entryId: string | null, onUndo?: () => void): JourneyUndoToastOptions` + `JOURNEY_UNDO_TOAST_MS = 10_000` — `entryId` null → `{ duration: 10000 }`; otherwise `{ duration: 10000, action: { label: 'เลิกทำ', onClick: () => void deleteJourneyEntry(queryClient, customerId, entryId) } }`. This task keeps no local duration constant or toast-options helper.
- Task 10 `@/components/customer/journey/ChoiceChip`: named `ChoiceChip { active: boolean; busy?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }` (renders `<button type="button" aria-pressed aria-busy>`, `Loader2` when busy) and `ChoiceChipRow { label?: string; hint?: string; children: ReactNode }`.
- Task 10 `@/components/customer/journey/ResponsiveChooser`: named `ResponsiveChooser { open: boolean; onOpenChange: (open: boolean) => void; title: string; trigger: ReactElement; children: ReactNode }` (desktop `PopoverContent align="end" className="w-80" aria-label={title}` → role `dialog`; mobile bottom `Sheet`).
- Task 10 `@/lib/constants`: `canRecordJourney(role: string | null | undefined): boolean` (OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES).
- Shipped: `uid(): string` (`@/utils/uid`), `getErrorMessage(error: unknown): string` (`@/lib/api`), `Button` (`@/components/ui/button`), `Badge` (`@/components/ui/badge`), `formatDateShort(value: string | Date): string` (`@/utils/formatters`), `SILENT_AFTER_DAYS = 30` (`../utils/journeyGroups`).

Produces:
- `export interface JourneyStageStripProps { summary: JourneySummary; customerId: string; canRecord: boolean }`; `export default function JourneyStageStrip(props: JourneyStageStripProps)`.
  - Caption rules: `skipped` → `ข้าม` (no path suffix on any step) · `not_needed` → path `CASH` `ไม่ต้องตรวจ (ซื้อสด)`, `EXTERNAL_FINANCE` `ไฟแนนซ์นอกตรวจ` (any other path → `ข้าม`), same grey dot with its number and muted label as `skipped` · `todo` → `ยังไม่ถึง` · otherwise date + (`failed` ? `เครดิตไม่ผ่าน` : current && stage ≠ PURCHASED ? `อยู่ขั้นนี้ ${daysInStage} วัน` : nothing) + (`พนักงานบันทึก` when evidence `MANUAL`) + (`ส่งไฟล์ในแชท` when evidence `CHAT_FILE` and not failed), joined with ` · `.
  - `failed` = `step.stage === 'CREDIT' && summary.creditRejected && (step.state === 'done' || step.state === 'current')`.
  - Caption span `line-clamp-2 text-xs leading-snug`; label span keeps `block truncate`.
  - Right cluster `data-testid="journey-stage-actions"` renders when `summary.lost || silentDays !== null || (canRecord && summary.stage !== 'PURCHASED')`; classes `flex shrink-0 flex-wrap items-center gap-1.5 max-lg:w-full max-lg:justify-end`; order lost badge → silent badge → controls.
- `export interface JourneyLostControlsProps { customerId: string; summary: JourneySummary }`; `export default function JourneyLostControls(props: JourneyLostControlsProps)`:
  - `summary.stage === 'PURCHASED'` → `null`.
  - Not lost → `Button variant="ghost" size="sm" className="max-lg:h-11"` + `UserX className="size-3.5"` `ติดป้ายหลุด` as the `trigger` of `ResponsiveChooser` titled `ติดป้ายหลุด — เพราะอะไร` with 5 `ChoiceChip`s in `JOURNEY_LOST_REASONS` order; tap = POST `{ kind: 'MARKED_LOST', lostReason, clientRequestId: uid() }`; tapped chip `active` + `busy`, all chips `disabled`; success closes + `toast.success('ติดป้ายหลุดแล้ว', undoToastOptions(queryClient, customerId, res.entryId))` (= `{ duration: 10000, action: { label: 'เลิกทำ', onClick: () => deleteJourneyEntry(queryClient, customerId, entryId) } }`); error `toast.error(getErrorMessage(err))`, chooser stays open.
  - Lost → `Button variant="outline" size="sm" className="max-lg:h-11"` + `RotateCcw` `เปิดใหม่`, disabled while sending; one tap POST `{ kind: 'REOPENED', clientRequestId: uid() }` → `toast.success('เปิดใหม่แล้ว', undoToastOptions(queryClient, customerId, res.entryId))`, or `toast.info('เปิดอยู่แล้ว')` when `entryId === null`.
- `kpiTiles(c: CustomerDetail, loyaltyBalance: number | null, journey?: Pick<JourneySummary, 'creditFilePending'> | null): KpiTile[]` — prospect `credit` tile value `ส่งไฟล์แล้ว รอตรวจ` (tone `default`) when `journey?.creditFilePending && c.creditCheckStatus === 'NONE'`; everything else unchanged.
- `index.tsx`: `const canRecord = canRecordJourney(user?.role ?? '');` · `<JourneyStageStrip summary={journeySummary} customerId={customer.id} canRecord={canRecord} />` · `kpiTiles(customer, loyaltyPoints?.balance ?? null, journeySummary)`.
- `journeyFixtures.ts`: `withEvidence(steps: JourneyStep[], evidence: Partial<Record<JourneyStage, JourneyStep['evidence']>>): JourneyStep[]`.
- `CustomerDetailPage.test.tsx` harness (Task 12 builds on it): hoisted `mocks.entry` (POST body → response data, default throws), `mocks.post` / `mocks.del` reset in the file-level `beforeEach` with a URL router that throws on unknown URLs, `vi.mock('sonner')` exposes `success` / `error` / `info` / `warning`, toast mocks cleared per test, static `import { toast } from 'sonner'`.

---

- [ ] **Step 1: Add the `withEvidence` fixture helper**

Append at the end of `apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts` (after the closing `}` of `journeyPage`):

```ts

/** ตั้งหลักฐานของบางขั้นทับผลของ stageSteps (เช่น CREDIT = 'CHAT_FILE') — ไม่แตะ state / at */
export function withEvidence(
  steps: JourneyStep[],
  evidence: Partial<Record<JourneyStage, JourneyStep['evidence']>>,
): JourneyStep[] {
  return steps.map((step) => {
    const next = evidence[step.stage];
    return next ? { ...step, evidence: next } : step;
  });
}
```

- [ ] **Step 2: Write the failing strip test (replace the whole file)**

Replace the entire content of `apps/web/src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOURNEY_LOST_REASONS,
  JOURNEY_LOST_REASON_LABELS,
  STAGE_LABELS,
  type JourneyStage,
  type JourneySummary,
} from '@installment/shared';
import { formatDateShort } from '@/utils/formatters';
import JourneyStageStrip from '../components/JourneyStageStrip';
import { journeySummary, stageSteps, withEvidence } from './journeyFixtures';

/**
 * บอร์ด StageStrip (a)–(f) + MobileSheet (c) ของ canvas v2 ที่เจ้าของเคาะ 2026-09-15
 * 🔴 hook ของ vitest ห้าม return ค่า — คร่อมปีกกาเสมอ
 * 🔴 POST / DELETE ที่ไม่ได้ลงทะเบียนโยน error พร้อม URL
 * คำบรรยายใช้เว้นวรรคแบบไม่ตัดบรรทัดระหว่างเลขกับ "วัน" — getByText ยุบเป็นช่องว่างธรรมดา จึงเขียนคาดหวังด้วยช่องว่างธรรมดา
 * แล้วเช็คอักขระจริงด้วย textContent
 */
const mocks = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn() }));

vi.mock('@/lib/api', () => ({
  default: {
    get: async (url: string) => {
      throw new Error(`unexpected GET ${url}`);
    },
    post: mocks.post,
    delete: mocks.del,
  },
  getErrorMessage: () => 'ผิดพลาด',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const ENTRIES_URL = '/customers/c1/journey/entries';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOST_TITLE = 'ติดป้ายหลุด — เพราะอะไร';

// วันที่คำนวณด้วย formatter ตัวเดียวกับหน้าจอเสมอ — CI รันเป็น UTC · ลำดับขั้นใหม่: ตรวจเครดิตก่อนนัด / จอง
const AT: Record<JourneyStage, string> = {
  CONTACTED: '2026-09-10T03:00:00.000Z',
  IDENTIFIED: '2026-09-11T03:00:00.000Z',
  CREDIT: '2026-09-13T03:00:00.000Z',
  INTERESTED: '2026-09-14T03:00:00.000Z',
  PURCHASED: '2026-09-15T03:00:00.000Z',
};

const PROSPECT_STATES = {
  CONTACTED: 'done',
  IDENTIFIED: 'done',
  CREDIT: 'current',
  INTERESTED: 'todo',
  PURCHASED: 'todo',
} as const;

type ToastOptions = { duration?: number; action?: { label: string; onClick: () => void } };

/** ผู้สนใจอยู่ขั้นตรวจเครดิต 2 วัน ยังไม่หลุด ไม่เงียบ (บอร์ด StageStrip a) */
function prospect(over: Partial<JourneySummary> = {}): JourneySummary {
  return journeySummary({
    stage: 'CREDIT',
    stageEnteredAt: AT.CREDIT,
    daysInStage: 2,
    path: 'UNKNOWN',
    steps: stageSteps(PROSPECT_STATES, AT),
    ...over,
  });
}

function renderStrip(summary: JourneySummary, canRecord = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JourneyStageStrip summary={summary} customerId="c1" canRecord={canRecord} />
    </QueryClientProvider>,
  );
}

function strip(): HTMLElement {
  return screen.getByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
}

function stepItem(stage: JourneyStage): HTMLElement {
  const item = within(strip()).getByText(STAGE_LABELS[stage]).closest('li');
  if (!item) throw new Error(`ไม่พบขั้น ${stage}`);
  return item;
}

/** ตัวเลือกของ toast.success ครั้งล่าสุด — sonner ถูก mock ไม่ได้วาดจริง กดปุ่มด้วยการเรียก action.onClick */
function lastSuccessToastOptions(): ToastOptions {
  const calls = vi.mocked(toast.success).mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('ยังไม่มี toast.success');
  return (call[1] ?? {}) as unknown as ToastOptions;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockReset();
  mocks.post.mockImplementation(async (url: string) => {
    throw new Error(`unexpected POST ${url}`);
  });
  mocks.del.mockReset();
  mocks.del.mockImplementation(async (url: string) => {
    throw new Error(`unexpected DELETE ${url}`);
  });
});

describe('JourneyStageStrip — คำบรรยายขั้น', () => {
  it('(a) ลำดับขั้นใหม่ · ขั้นปัจจุบันบอกวันที่ + วันค้าง · ชื่อขั้นบรรทัดเดียว คำบรรยาย 2 บรรทัด · เลขติดคำว่า "วัน" · ขั้นหลังจากนี้ "ยังไม่ถึง"', () => {
    renderStrip(prospect());
    expect(Array.from(strip().querySelectorAll('li')).map((li) => li.getAttribute('data-stage'))).toEqual([
      'CONTACTED',
      'IDENTIFIED',
      'CREDIT',
      'INTERESTED',
      'PURCHASED',
    ]);
    expect(STAGE_LABELS.INTERESTED).toBe('นัด / จอง');

    const credit = stepItem('CREDIT');
    expect(credit).toHaveAttribute('aria-current', 'step');
    const caption = within(credit).getByText(`${formatDateShort(AT.CREDIT)} · อยู่ขั้นนี้ 2 วัน`);
    expect(caption).toHaveClass('line-clamp-2');
    expect(caption).not.toHaveClass('truncate');
    expect(caption.textContent).toContain('อยู่ขั้นนี้ 2 วัน');
    expect(within(credit).getByText(STAGE_LABELS.CREDIT)).toHaveClass('truncate');

    expect(stepItem('INTERESTED')).toHaveAttribute('data-state', 'todo');
    expect(within(stepItem('INTERESTED')).getByText('ยังไม่ถึง')).toBeInTheDocument();
    expect(within(stepItem('PURCHASED')).getByText('ยังไม่ถึง')).toBeInTheDocument();
  });

  it('(a2) ลูกค้าส่งไฟล์ในแชท (หลักฐาน CHAT_FILE) → ขั้นตรวจเครดิตต่อท้าย "ส่งไฟล์ในแชท" · ขั้นอื่นไม่มีคำนี้', () => {
    renderStrip(prospect({ daysInStage: 0, steps: withEvidence(stageSteps(PROSPECT_STATES, AT), { CREDIT: 'CHAT_FILE' }) }));
    const caption = within(stepItem('CREDIT')).getByText(
      `${formatDateShort(AT.CREDIT)} · อยู่ขั้นนี้ 0 วัน · ส่งไฟล์ในแชท`,
    );
    expect(caption).toHaveClass('line-clamp-2');
    expect(caption.textContent).toContain('อยู่ขั้นนี้ 0 วัน');
    expect(within(stepItem('IDENTIFIED')).queryByText(/ส่งไฟล์ในแชท/)).toBeNull();
  });

  it('(มือถือ c) บันทึก "นัดแล้ว" หลังส่งไฟล์ → ขั้นนัด / จอง "พนักงานบันทึก" · ขั้นตรวจเครดิตที่เลยมาแล้วยังโชว์ "ส่งไฟล์ในแชท"', () => {
    renderStrip(
      prospect({
        stage: 'INTERESTED',
        stageEnteredAt: AT.INTERESTED,
        daysInStage: 0,
        steps: withEvidence(
          stageSteps(
            { CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'done', INTERESTED: 'current', PURCHASED: 'todo' },
            AT,
            ['INTERESTED'],
          ),
          { CREDIT: 'CHAT_FILE' },
        ),
      }),
    );
    expect(stepItem('CREDIT')).toHaveAttribute('data-state', 'done');
    expect(within(stepItem('CREDIT')).getByText(`${formatDateShort(AT.CREDIT)} · ส่งไฟล์ในแชท`)).toBeInTheDocument();
    expect(
      within(stepItem('INTERESTED')).getByText(`${formatDateShort(AT.INTERESTED)} · อยู่ขั้นนี้ 0 วัน · พนักงานบันทึก`),
    ).toBeInTheDocument();
  });

  it('(a3) มีใบจองแต่ยังไม่มีหลักฐานตรวจเครดิต → ขั้นตรวจเครดิต "ข้าม" เปล่า ๆ · จุดเทามีเลข 3 · ชื่อขั้นสีจาง', () => {
    renderStrip(
      prospect({
        stage: 'INTERESTED',
        stageEnteredAt: AT.INTERESTED,
        daysInStage: 1,
        steps: stageSteps(
          { CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'skipped', INTERESTED: 'current', PURCHASED: 'todo' },
          AT,
        ),
      }),
    );
    const credit = stepItem('CREDIT');
    expect(credit).toHaveAttribute('data-state', 'skipped');
    expect(within(credit).getByText('ข้าม')).toBeInTheDocument();
    expect(within(credit).getByText('3')).toBeInTheDocument();
    expect(within(credit).getByText(STAGE_LABELS.CREDIT)).toHaveClass('text-muted-foreground');
    expect(
      within(stepItem('INTERESTED')).getByText(`${formatDateShort(AT.INTERESTED)} · อยู่ขั้นนี้ 1 วัน`),
    ).toBeInTheDocument();
  });

  it('(a4) ใบตรวจเครดิตไม่ผ่าน → คำบรรยายแค่ "เครดิตไม่ผ่าน" สีแดง (ไฟล์ในแชทไม่ต่อท้าย ไม่นับวันค้าง) · เงียบไม่เกิน 30 วันไม่ติดป้าย', () => {
    renderStrip(
      prospect({
        daysInStage: 4,
        path: 'INSTALLMENT',
        creditRejected: true,
        silentDays: 20,
        steps: withEvidence(stageSteps(PROSPECT_STATES, AT), { CREDIT: 'CHAT_FILE' }),
      }),
    );
    const caption = within(stepItem('CREDIT')).getByText(`${formatDateShort(AT.CREDIT)} · เครดิตไม่ผ่าน`);
    expect(caption).toHaveClass('text-destructive');
    expect(stepItem('CREDIT')).not.toHaveTextContent('ส่งไฟล์ในแชท');
    expect(stepItem('CREDIT')).not.toHaveTextContent('อยู่ขั้นนี้');
    expect(screen.queryByText(/^เงียบ/)).toBeNull();
    expect(within(strip()).getByRole('button', { name: 'ติดป้ายหลุด' })).toBeInTheDocument();
  });

  it('(e) ซื้อผ่อนแล้ว → ขั้นซื้อแล้วไม่นับวันค้าง · ไม่มีกลุ่มขวาและไม่มีปุ่มใด ๆ', () => {
    renderStrip(
      journeySummary({
        stage: 'PURCHASED',
        stageEnteredAt: AT.PURCHASED,
        daysInStage: 10,
        path: 'INSTALLMENT',
        steps: stageSteps(
          { CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'done', INTERESTED: 'done', PURCHASED: 'current' },
          AT,
        ),
      }),
    );
    expect(stepItem('PURCHASED')).toHaveAttribute('aria-current', 'step');
    expect(within(stepItem('PURCHASED')).getByText(formatDateShort(AT.PURCHASED))).toBeInTheDocument();
    expect(stepItem('PURCHASED')).not.toHaveTextContent('อยู่ขั้นนี้');
    expect(screen.queryByTestId('journey-stage-actions')).toBeNull();
    expect(within(strip()).queryAllByRole('button')).toHaveLength(0);
  });

  it.each([
    ['CASH', 'ไม่ต้องตรวจ (ซื้อสด)'],
    ['EXTERNAL_FINANCE', 'ไฟแนนซ์นอกตรวจ'],
  ] as const)(
    '(e2) ซื้อแบบ %s โดยไม่มีหลักฐานตรวจเครดิต → ขั้นตรวจเครดิตเทา "%s" ไม่ใช่ข้าม · ขั้นอื่นที่ข้ามยังเป็น "ข้าม" เปล่า ๆ',
    (path, caption) => {
      renderStrip(
        journeySummary({
          stage: 'PURCHASED',
          stageEnteredAt: AT.PURCHASED,
          daysInStage: 3,
          path,
          steps: stageSteps(
            { CONTACTED: 'done', IDENTIFIED: 'skipped', CREDIT: 'not_needed', INTERESTED: 'done', PURCHASED: 'current' },
            AT,
          ),
        }),
      );
      const credit = stepItem('CREDIT');
      expect(credit).toHaveAttribute('data-state', 'not_needed');
      expect(within(credit).getByText(caption)).toBeInTheDocument();
      expect(within(credit).getByText('3')).toBeInTheDocument();
      expect(within(credit).getByText(STAGE_LABELS.CREDIT)).toHaveClass('text-muted-foreground');
      expect(within(stepItem('IDENTIFIED')).getByText('ข้าม')).toBeInTheDocument();
      expect(within(strip()).queryByText(/ข้าม \(/)).toBeNull();
      expect(within(strip()).queryAllByRole('button')).toHaveLength(0);
    },
  );
});

describe('JourneyStageStrip — ติดป้ายหลุด / เปิดใหม่', () => {
  it('(a) ผู้สนใจที่ยังไม่หลุด + มีสิทธิ์บันทึก → ปุ่มโปร่ง "ติดป้ายหลุด" ท้ายแถบ · มือถือกลุ่มขวาลงใต้ขั้นชิดขวา ปุ่มสูง 44px', () => {
    renderStrip(prospect());
    const actions = screen.getByTestId('journey-stage-actions');
    expect(actions).toHaveClass('max-lg:w-full', 'max-lg:justify-end');
    expect(within(actions).getByRole('button', { name: 'ติดป้ายหลุด' })).toHaveClass('max-lg:h-11');
    expect(within(actions).queryByRole('button', { name: 'เปิดใหม่' })).toBeNull();
    const list = strip().querySelector('ol');
    expect(list).not.toBeNull();
    expect(list!.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('(b)(b2) แตะ "ติดป้ายหลุด" → 5 เหตุผลเรียงตาม shared ไม่มีช่องโน้ต · แตะเหตุผล = POST ทันที (UUID) · ชิปที่แตะหมุนรอ ชิปทั้งหมดกดไม่ได้', async () => {
    const pending = deferred<unknown>();
    mocks.post.mockImplementation((url: string) =>
      url === ENTRIES_URL ? pending.promise : Promise.reject(new Error(`unexpected POST ${url}`)),
    );
    renderStrip(prospect());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ติดป้ายหลุด' }));
    const dialog = await screen.findByRole('dialog', { name: LOST_TITLE });

    const labels = JOURNEY_LOST_REASONS.map((code) => JOURNEY_LOST_REASON_LABELS[code]);
    expect(labels).toEqual(['ไม่สนใจ', 'ซื้อที่อื่น', 'เครดิตไม่ผ่าน', 'ติดต่อไม่ได้', 'อื่น ๆ']);
    const chips = labels.map((label) => within(dialog).getByRole('button', { name: label }));
    for (let i = 1; i < chips.length; i += 1) {
      expect(chips[i - 1].compareDocumentPosition(chips[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(dialog).queryByRole('textbox')).toBeNull();

    await user.click(chips[1]);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledWith(ENTRIES_URL, {
      kind: 'MARKED_LOST',
      lostReason: 'BOUGHT_ELSEWHERE',
      clientRequestId: expect.stringMatching(UUID),
    });
    await waitFor(() => expect(chips[1]).toHaveAttribute('aria-busy', 'true'));
    expect(chips[1]).toHaveAttribute('aria-pressed', 'true');
    for (const chip of chips) expect(chip).toBeDisabled();
  });

  it('(b3) บันทึกสำเร็จ → ป๊อปโอเวอร์ปิด · toast "ติดป้ายหลุดแล้ว" 10 วิ พร้อม "เลิกทำ" → DELETE แถวที่เพิ่งเขียน', async () => {
    mocks.post.mockImplementation(async (url: string) => {
      if (url === ENTRIES_URL) {
        return {
          data: {
            entryId: 'entry-1',
            event: null,
            summary: prospect({ lost: { at: AT.INTERESTED, reason: 'NOT_INTERESTED' } }),
          },
        };
      }
      throw new Error(`unexpected POST ${url}`);
    });
    mocks.del.mockImplementation(async (url: string) => {
      if (url === `${ENTRIES_URL}/entry-1`) return { data: { summary: prospect() } };
      throw new Error(`unexpected DELETE ${url}`);
    });
    renderStrip(prospect());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ติดป้ายหลุด' }));
    const dialog = await screen.findByRole('dialog', { name: LOST_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'ไม่สนใจ' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: LOST_TITLE })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('ติดป้ายหลุดแล้ว', {
      duration: 10000,
      action: { label: 'เลิกทำ', onClick: expect.any(Function) },
    });
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      lastSuccessToastOptions().action?.onClick();
    });
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith(`${ENTRIES_URL}/entry-1`));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('เลิกทำแล้ว'));
  });

  it('บันทึกไม่สำเร็จ → toast ข้อความจากเซิร์ฟเวอร์ · ป๊อปโอเวอร์ยังเปิด ชิปกดได้อีก · แตะใหม่ได้ clientRequestId ใหม่', async () => {
    mocks.post.mockRejectedValue(new Error('network'));
    renderStrip(prospect());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ติดป้ายหลุด' }));
    const dialog = await screen.findByRole('dialog', { name: LOST_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'ติดต่อไม่ได้' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ผิดพลาด'));
    expect(screen.getByRole('dialog', { name: LOST_TITLE })).toBeInTheDocument();
    const chip = within(dialog).getByRole('button', { name: 'ติดต่อไม่ได้' });
    await waitFor(() => expect(chip).toBeEnabled());
    expect(toast.success).not.toHaveBeenCalled();

    await user.click(chip);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.post.mock.calls.map(
      ([, body]) => (body as { clientRequestId: string }).clientRequestId,
    );
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });

  it('(c) หลุดแล้ว → ป้ายหลุด · ป้ายเงียบ · ปุ่มขอบ "เปิดใหม่" ตามลำดับ · แตะเดียว POST REOPENED (ปุ่มปิดระหว่างส่ง ไม่มีกล่องยืนยัน) → toast "เปิดใหม่แล้ว" + เลิกทำ → DELETE', async () => {
    const pending = deferred<unknown>();
    mocks.post.mockImplementation((url: string) =>
      url === ENTRIES_URL ? pending.promise : Promise.reject(new Error(`unexpected POST ${url}`)),
    );
    mocks.del.mockImplementation(async (url: string) => {
      if (url === `${ENTRIES_URL}/entry-2`) {
        return { data: { summary: prospect({ lost: { at: AT.INTERESTED, reason: 'BOUGHT_ELSEWHERE' } }) } };
      }
      throw new Error(`unexpected DELETE ${url}`);
    });
    renderStrip(prospect({ silentDays: 45, lost: { at: AT.INTERESTED, reason: 'BOUGHT_ELSEWHERE' } }));

    const actions = screen.getByTestId('journey-stage-actions');
    const badge = within(actions).getByText('หลุด · ซื้อที่อื่น');
    const silent = within(actions).getByText('เงียบ 45 วัน');
    const reopen = within(actions).getByRole('button', { name: 'เปิดใหม่' });
    expect(reopen).toHaveClass('max-lg:h-11');
    expect(badge.compareDocumentPosition(silent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(silent.compareDocumentPosition(reopen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(actions).queryByRole('button', { name: 'ติดป้ายหลุด' })).toBeNull();

    await userEvent.setup().click(reopen);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(ENTRIES_URL, {
        kind: 'REOPENED',
        clientRequestId: expect.stringMatching(UUID),
      }),
    );
    await waitFor(() => expect(reopen).toBeDisabled());
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      pending.resolve({ data: { entryId: 'entry-2', event: null, summary: prospect() } });
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('เปิดใหม่แล้ว', {
        duration: 10000,
        action: { label: 'เลิกทำ', onClick: expect.any(Function) },
      }),
    );
    await act(async () => {
      lastSuccessToastOptions().action?.onClick();
    });
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith(`${ENTRIES_URL}/entry-2`));
  });

  it('Q4 กด "เปิดใหม่" แต่เซิร์ฟเวอร์เห็นว่ายังไม่หลุด (entryId null) → toast.info "เปิดอยู่แล้ว" ไม่มีปุ่มเลิกทำ', async () => {
    mocks.post.mockImplementation(async (url: string) => {
      if (url === ENTRIES_URL) return { data: { entryId: null, event: null, summary: prospect() } };
      throw new Error(`unexpected POST ${url}`);
    });
    renderStrip(prospect({ lost: { at: AT.INTERESTED, reason: 'OTHER' } }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'เปิดใหม่' }));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('เปิดอยู่แล้ว'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('(d) เงียบเกิน 30 วันแต่ยังไม่หลุด → ป้าย "เงียบ 41 วัน" คงเดิม ตามด้วยปุ่ม "ติดป้ายหลุด"', () => {
    renderStrip(prospect({ silentDays: 41, daysInStage: 42 }));
    const actions = screen.getByTestId('journey-stage-actions');
    const silent = within(actions).getByText('เงียบ 41 วัน');
    const button = within(actions).getByRole('button', { name: 'ติดป้ายหลุด' });
    expect(silent.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(actions).queryByText(/^หลุด/)).toBeNull();
  });

  it('(f) ACCOUNTANT (canRecord=false): หลุดแล้วยังเห็นป้าย (รหัสที่ไม่รู้จักไม่แสดงค่าดิบ) แต่ไม่มีปุ่ม · ไม่หลุดไม่เงียบ = ไม่มีกลุ่มขวา', () => {
    const view = renderStrip(prospect({ lost: { at: AT.INTERESTED, reason: 'SOMETHING_NEW' } }), false);
    const actions = screen.getByTestId('journey-stage-actions');
    expect(within(actions).getByText('หลุด')).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_NEW/)).toBeNull();
    expect(within(strip()).queryAllByRole('button')).toHaveLength(0);
    view.unmount();

    renderStrip(prospect(), false);
    expect(screen.queryByTestId('journey-stage-actions')).toBeNull();
    expect(within(strip()).queryAllByRole('button')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the strip test and confirm it fails**

Run: `cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx`

Expected: FAIL. At least (a) (`line-clamp-2` / `2 วัน`), (a2) and (มือถือ c) (no `ส่งไฟล์ในแชท`), both (e2) cases (`ข้าม (เงินสด)` / `ข้าม (ไฟแนนซ์นอก)` / `ข้าม` instead of the greyed caption), (a4) and every ติดป้ายหลุด / เปิดใหม่ test fail with `Unable to find an element by: [data-testid="journey-stage-actions"]` or `Unable to find an accessible element with the role "button" and name "ติดป้ายหลุด"` / `"เปิดใหม่"`. (a3) and (e) may already pass (their rules are unchanged).

- [ ] **Step 4: Create `JourneyLostControls.tsx`**

Create `apps/web/src/pages/CustomerDetailPage/components/JourneyLostControls.tsx`:

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw, UserX } from 'lucide-react';
import { toast } from 'sonner';
import {
  JOURNEY_LOST_REASONS,
  JOURNEY_LOST_REASON_LABELS,
  type JourneyLostReason,
  type JourneySummary,
} from '@installment/shared';
import { ChoiceChip, ChoiceChipRow } from '@/components/customer/journey/ChoiceChip';
import { ResponsiveChooser } from '@/components/customer/journey/ResponsiveChooser';
import { Button } from '@/components/ui/button';
import { undoToastOptions, useRecordJourneyEntry } from '@/hooks/customer-journey/journeyEntries';
import { getErrorMessage } from '@/lib/api';
import { uid } from '@/utils/uid';

const LOST_CHOOSER_TITLE = 'ติดป้ายหลุด — เพราะอะไร';

export interface JourneyLostControlsProps {
  customerId: string;
  summary: JourneySummary;
}

/**
 * ปุ่มท้ายแถบขั้น (คำตัดสินเจ้าของ 2026-09-15 ข้อ 4 · Q2 Q4 Q17) — ระบบปลดป้ายหลุดเองเป็นหลัก ปุ่มนี้ไม่บังคับ
 * - ยังไม่หลุด: ghost "ติดป้ายหลุด" → เลือกเหตุผล 1 ใน 5 = บันทึกทันที (ไม่มีช่องโน้ต)
 * - หลุดแล้ว: outline "เปิดใหม่" แตะเดียว ไม่มีกล่องยืนยัน — ป้าย "หลุด · เหตุผล" วาดที่แถบ (ACCOUNTANT ยังเห็น)
 * - ซื้อแล้ว: ไม่มีปุ่ม
 * clientRequestId = UUID ใหม่ทุกครั้งที่แตะ (D8) · ใช้ mutateAsync จึงไม่พึ่ง callback ต่อ mutate() ที่ถูกข้ามหลัง unmount
 */
export default function JourneyLostControls({ customerId, summary }: JourneyLostControlsProps) {
  const queryClient = useQueryClient();
  const record = useRecordJourneyEntry(customerId);
  const [open, setOpen] = useState(false);
  const [pendingReason, setPendingReason] = useState<JourneyLostReason | null>(null);
  const [reopening, setReopening] = useState(false);

  if (summary.stage === 'PURCHASED') return null;

  const markLost = async (lostReason: JourneyLostReason) => {
    if (pendingReason !== null) return;
    setPendingReason(lostReason);
    try {
      const res = await record.mutateAsync({ kind: 'MARKED_LOST', lostReason, clientRequestId: uid() });
      setOpen(false);
      // toast สำเร็จชุดกลาง (Task 10): 10 วินาที + "เลิกทำ" ที่ลบผ่าน deleteJourneyEntry ด้วย queryClient ที่จับไว้ (D12)
      toast.success('ติดป้ายหลุดแล้ว', undoToastOptions(queryClient, customerId, res.entryId));
    } catch (err) {
      // ป๊อปโอเวอร์ยังเปิดอยู่ — แตะใหม่ได้ด้วย UUID ใหม่
      toast.error(getErrorMessage(err));
    } finally {
      setPendingReason(null);
    }
  };

  const reopen = async () => {
    if (reopening) return;
    setReopening(true);
    try {
      const res = await record.mutateAsync({ kind: 'REOPENED', clientRequestId: uid() });
      // Q4 / D9: ระบบปลดป้ายไปก่อนแล้ว เซิร์ฟเวอร์ไม่เขียนแถว ⇒ ไม่มีอะไรให้เลิกทำ
      if (res.entryId) toast.success('เปิดใหม่แล้ว', undoToastOptions(queryClient, customerId, res.entryId));
      else toast.info('เปิดอยู่แล้ว');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setReopening(false);
    }
  };

  if (summary.lost) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="max-lg:h-11"
        disabled={reopening}
        onClick={() => {
          void reopen();
        }}
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        เปิดใหม่
      </Button>
    );
  }

  return (
    <ResponsiveChooser
      open={open}
      onOpenChange={setOpen}
      title={LOST_CHOOSER_TITLE}
      trigger={
        <Button variant="ghost" size="sm" className="max-lg:h-11">
          <UserX className="size-3.5" aria-hidden="true" />
          ติดป้ายหลุด
        </Button>
      }
    >
      <ChoiceChipRow>
        {JOURNEY_LOST_REASONS.map((code) => (
          <ChoiceChip
            key={code}
            active={pendingReason === code}
            busy={pendingReason === code}
            disabled={pendingReason !== null}
            onClick={() => {
              void markLost(code);
            }}
          >
            {JOURNEY_LOST_REASON_LABELS[code]}
          </ChoiceChip>
        ))}
      </ChoiceChipRow>
    </ResponsiveChooser>
  );
}
```

- [ ] **Step 5: Replace `JourneyStageStrip.tsx`**

Replace the entire content of `apps/web/src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx` with:

```tsx
import { Check } from 'lucide-react';
import { JOURNEY_LOST_REASON_LABELS, STAGE_LABELS, type JourneyStep, type JourneySummary } from '@installment/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/utils/formatters';
import { SILENT_AFTER_DAYS } from '../utils/journeyGroups';
import JourneyLostControls from './JourneyLostControls';

/** เว้นวรรคแบบไม่ตัดบรรทัด — เลขกับคำว่า "วัน" อยู่บรรทัดเดียวกันเสมอเมื่อคำบรรยายขึ้น 2 บรรทัด (คำตัดสินเจ้าของ 2026-09-15 ข้อ 12) */
const NBSP = ' ';

const DOT_CLASS: Record<JourneyStep['state'], string> = {
  done: 'bg-success text-success-foreground',
  current: 'bg-primary text-primary-foreground',
  skipped: 'bg-muted text-muted-foreground',
  // "ไม่ต้องตรวจ" ใช้เทาชุดเดียวกับข้าม (ไม่เพิ่มสีใหม่) — ต่างกันที่คำบรรยาย · จุดยังแสดงเลขขั้น
  not_needed: 'bg-muted text-muted-foreground',
  todo: 'border border-dashed border-border bg-background text-muted-foreground',
};

/** ชื่อขั้นสีจาง: ยังไม่ถึง · ข้าม · ไม่ต้องตรวจ */
const MUTED_STATES: ReadonlySet<JourneyStep['state']> = new Set<JourneyStep['state']>(['todo', 'skipped', 'not_needed']);

/** API ตั้ง not_needed เฉพาะขั้นตรวจเครดิตของลูกค้าที่ซื้อแล้วแบบเงินสด / ไฟแนนซ์นอก (D1) — path อื่นไม่ควรเกิด จึงใช้คำกลาง "ข้าม" */
function notNeededCaption(path: JourneySummary['path']): string {
  if (path === 'CASH') return 'ไม่ต้องตรวจ (ซื้อสด)';
  if (path === 'EXTERNAL_FINANCE') return 'ไฟแนนซ์นอกตรวจ';
  return 'ข้าม';
}

function stepCaption(step: JourneyStep, summary: JourneySummary, failed: boolean): string {
  // ขั้นก่อนขั้นปัจจุบันที่ไม่มีหลักฐาน = "ข้าม" เปล่า ๆ ทุกขั้น (คำตัดสิน 13(2) — เลิกวงเล็บต่อท้ายตาม path)
  if (step.state === 'skipped') return 'ข้าม';
  if (step.state === 'not_needed') return notNeededCaption(summary.path);
  if (step.state === 'todo') return 'ยังไม่ถึง';
  const parts = [step.at ? formatDateShort(step.at) : '—'];
  if (failed) parts.push('เครดิตไม่ผ่าน');
  else if (step.state === 'current' && step.stage !== 'PURCHASED') parts.push(`อยู่ขั้นนี้ ${summary.daysInStage}${NBSP}วัน`);
  if (step.evidence === 'MANUAL') parts.push('พนักงานบันทึก');
  // ไฟล์ในแชทพาขึ้นขั้นอย่างเดียว ผลตรวจมาจากใบตรวจเครดิต — เครดิตไม่ผ่านแสดงแค่ผล (บอร์ด StageStrip a4)
  if (step.evidence === 'CHAT_FILE' && !failed) parts.push('ส่งไฟล์ในแชท');
  return parts.join(' · ');
}

function lostLabel(reason: string): string {
  // รหัสที่ไม่มีใน shared แสดงแค่ "หลุด" ไม่แสดงค่าดิบ
  const label = JOURNEY_LOST_REASON_LABELS[reason];
  return label ? `หลุด · ${label}` : 'หลุด';
}

export interface JourneyStageStripProps {
  summary: JourneySummary;
  customerId: string;
  /** บทบาทที่บันทึกการเดินทางได้ (canRecordJourney) — ACCOUNTANT = false ไม่มีปุ่มใด ๆ */
  canRecord: boolean;
}

/** แถบ 5 ขั้นใต้ช่องตัวเลข — อ่านจาก summary เท่านั้น ห้าม derive ขั้นในเว็บ */
export default function JourneyStageStrip({ summary, customerId, canRecord }: JourneyStageStripProps) {
  const silentDays = summary.silentDays !== null && summary.silentDays > SILENT_AFTER_DAYS ? summary.silentDays : null;
  const showControls = canRecord && summary.stage !== 'PURCHASED';

  return (
    <section
      aria-label="ขั้นการเดินทางของลูกค้า"
      className="mb-5 rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ol className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-2">
          {summary.steps.map((step, index) => {
            const failed =
              step.stage === 'CREDIT' && summary.creditRejected && (step.state === 'done' || step.state === 'current');
            const muted = MUTED_STATES.has(step.state);
            return (
              <li
                key={step.stage}
                data-stage={step.stage}
                data-state={step.state}
                aria-current={step.state === 'current' ? 'step' : undefined}
                className="flex min-w-[9rem] flex-1 items-center gap-2"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                    failed ? 'bg-destructive text-destructive-foreground' : DOT_CLASS[step.state],
                  )}
                >
                  {step.state === 'done' && !failed ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block truncate text-[13px] font-medium leading-snug',
                      muted ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {STAGE_LABELS[step.stage]}
                  </span>
                  {/* Q15: คำบรรยายขึ้น 2 บรรทัด ไม่ตัดข้อมูล — ชื่อขั้นยังบรรทัดเดียว */}
                  <span className={cn('line-clamp-2 text-xs leading-snug', failed ? 'text-destructive' : 'text-muted-foreground')}>
                    {stepCaption(step, summary, failed)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {(summary.lost || silentDays !== null || showControls) && (
          <div
            data-testid="journey-stage-actions"
            className="flex shrink-0 flex-wrap items-center gap-1.5 max-lg:w-full max-lg:justify-end"
          >
            {summary.lost && (
              <Badge variant="destructive" appearance="light" size="md" className="leading-snug">
                {lostLabel(summary.lost.reason)}
              </Badge>
            )}
            {silentDays !== null && (
              <Badge variant="warning" appearance="light" size="md" className="leading-snug">
                {`เงียบ ${silentDays} วัน`}
              </Badge>
            )}
            {showControls && <JourneyLostControls customerId={customerId} summary={summary} />}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Run the strip test in UTC and in the machine time zone**

Run: `cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx`
Expected: PASS — `Tests  16 passed (16)`.

Run: `cd apps/web && npx vitest run src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx`
Expected: PASS — `Tests  16 passed (16)`.

(`index.tsx` still passes only `summary` to the strip, so `tsc` stays red until Step 14; vitest does not typecheck.)

- [ ] **Step 7: Write the failing KPI tile tests**

In `apps/web/src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts` replace:

```ts
    expect(tiles[3]).toMatchObject({ value: 'ยังไม่เคยตรวจ', tone: 'default' });
  });
});
```

with:

```ts
    expect(tiles[3]).toMatchObject({ value: 'ยังไม่เคยตรวจ', tone: 'default' });
  });

  it('ผู้สนใจที่ส่งไฟล์ในแชทแต่ยังไม่มีผลตรวจ (summary.creditFilePending) → ช่องเครดิต "ส่งไฟล์แล้ว รอตรวจ"', () => {
    const tiles = kpiTiles(detail({ creditCheckStatus: 'NONE' }), null, { creditFilePending: true });
    expect(tiles[3]).toMatchObject({ key: 'credit', label: 'เครดิต', value: 'ส่งไฟล์แล้ว รอตรวจ', sub: '', tone: 'default' });
  });

  it('ไม่มีธง creditFilePending หรือ summary ยังไม่มา → ช่องเครดิตคงเดิม "ยังไม่เคยตรวจ"', () => {
    expect(kpiTiles(detail(), null, { creditFilePending: false })[3]).toMatchObject({ value: 'ยังไม่เคยตรวจ' });
    expect(kpiTiles(detail(), null, null)[3]).toMatchObject({ value: 'ยังไม่เคยตรวจ' });
    expect(kpiTiles(detail(), null)[3]).toMatchObject({ value: 'ยังไม่เคยตรวจ' });
  });

  it('ข้อมูลลูกค้ามีผลตรวจแล้วแต่ summary ยังค้างธงเก่า → ผลตรวจจริงชนะ', () => {
    const tiles = kpiTiles(detail({ creditCheckStatus: 'REJECTED' }), null, { creditFilePending: true });
    expect(tiles[3]).toMatchObject({ value: 'ไม่ผ่าน', tone: 'destructive' });
  });

  it('ลูกค้าที่ซื้อแล้วไม่มีช่องเครดิต — ธง creditFilePending ไม่เปลี่ยนชุดช่อง', () => {
    const tiles = kpiTiles(detail({ purchase: { ...emptyPurchase, cashCount: 1 }, latestPurchase }), null, { creditFilePending: true });
    expect(tiles.map((t) => t.key)).toEqual(['purchase', 'salesTotal', 'latest', 'warranty', 'loyalty']);
    expect(tiles.some((t) => t.value === 'ส่งไฟล์แล้ว รอตรวจ')).toBe(false);
  });
});
```

- [ ] **Step 8: Run the KPI test and confirm it fails**

Run: `cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts`
Expected: FAIL — 1 failed (`ผู้สนใจที่ส่งไฟล์ในแชทแต่ยังไม่มีผลตรวจ …`: received `value: 'ยังไม่เคยตรวจ'`, expected `'ส่งไฟล์แล้ว รอตรวจ'`); the other 15 pass (the extra argument is ignored at runtime).

- [ ] **Step 9: Implement the KPI credit tile**

In `apps/web/src/pages/CustomerDetailPage/utils/kpiTiles.ts`:

Replace

```ts
import { customerCreditStatusMap } from '@/lib/status-badges';
```

with

```ts
import type { JourneySummary } from '@installment/shared';
import { customerCreditStatusMap } from '@/lib/status-badges';
```

Replace

```ts
export function kpiTiles(c: CustomerDetail, loyaltyBalance: number | null): KpiTile[] {
```

with

```ts
/**
 * journey = summary ของแถบขั้น (null / ไม่ส่ง = ยังโหลด หรือบทบาทที่ไม่เห็นการเดินทาง)
 * ใช้เฉพาะ creditFilePending ที่ API ตัดสินแล้ว — เว็บไม่ derive จากไฟล์ในแชทเอง
 */
export function kpiTiles(
  c: CustomerDetail,
  loyaltyBalance: number | null,
  journey?: Pick<JourneySummary, 'creditFilePending'> | null,
): KpiTile[] {
```

Replace

```ts
  const credit = customerCreditStatusMap[c.creditCheckStatus] ?? customerCreditStatusMap.NONE;
  return [
```

with

```ts
  const credit = customerCreditStatusMap[c.creditCheckStatus] ?? customerCreditStatusMap.NONE;
  // คำตัดสินเจ้าของ 2026-09-15 ข้อ 13(3): ส่งไฟล์ในแชทแล้วแต่ยังไม่มีผลตรวจ → "ส่งไฟล์แล้ว รอตรวจ"
  // ผลตรวจจริงบนข้อมูลลูกค้า (ไม่ใช่ NONE) ชนะเสมอ — กันธงจาก summary ที่ยังค้างแคชทับผลที่เพิ่งตรวจ
  const filePending = !!journey?.creditFilePending && c.creditCheckStatus === 'NONE';
  return [
```

Replace

```ts
      value: credit.label,
```

with

```ts
      value: filePending ? 'ส่งไฟล์แล้ว รอตรวจ' : credit.label,
```

- [ ] **Step 10: Run the KPI test**

Run: `cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts`
Expected: PASS — `Tests  16 passed (16)`.

- [ ] **Step 11: Extend the page test harness**

In `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx`:

Replace

```ts
import userEvent from '@testing-library/user-event';
```

with

```ts
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
```

Replace

```ts
  /** ตอบ GET /customers/c1/journey ตาม params (limit / groups / cursor) */
  journey: vi.fn(),
}));
```

with

```ts
  /** ตอบ GET /customers/c1/journey ตาม params (limit / groups / cursor) */
  journey: vi.fn(),
  /** ตอบ POST /customers/c1/journey/entries ตาม body — ค่าเริ่มต้นโยน error (เทสที่กดบันทึกต้องตั้งเอง) */
  entry: vi.fn(),
}));
```

Replace

```ts
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
```

with

```ts
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
```

Replace

```ts
  mocks.journey.mockImplementation(() => journeyPage());
```

with

```ts
  mocks.journey.mockImplementation(() => journeyPage());
  // เฟส 3: POST / DELETE รีเซ็ตทุกเทส (เทส R5 ตั้ง post เองแล้วเคยรั่วไปเทสถัดไปตามลำดับ) · URL ที่ไม่ได้ลงทะเบียนโยน error พร้อม URL
  mocks.entry.mockReset();
  mocks.entry.mockImplementation(() => {
    throw new Error('POST /customers/c1/journey/entries ไม่ได้ตั้งคำตอบ (mocks.entry)');
  });
  mocks.post.mockReset();
  mocks.post.mockImplementation(async (url: string, body?: unknown) => {
    if (url === '/customers/c1/journey/entries') return { data: mocks.entry(body) };
    throw new Error(`unexpected POST ${url}`);
  });
  mocks.del.mockReset();
  mocks.del.mockImplementation(async (url: string) => {
    if (/^\/customers\/c1\/journey\/entries\/[^/]+$/.test(url)) return { data: { summary: mocks.summaries.c1 } };
    throw new Error(`unexpected DELETE ${url}`);
  });
  for (const fn of [toast.success, toast.error, toast.info, toast.warning]) vi.mocked(fn).mockClear();
```

- [ ] **Step 12: Append the failing page tests**

Append at the end of `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` (after the final `});`):

```tsx

describe('แถบขั้นบนหน้า: ติดป้ายหลุด / เปิดใหม่ · ช่องเครดิตรอตรวจ (เฟส 3)', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const PROSPECT_AT = {
    CONTACTED: '2026-09-10T03:00:00.000Z',
    IDENTIFIED: '2026-09-11T03:00:00.000Z',
    CREDIT: '2026-09-13T03:00:00.000Z',
  };
  const prospectDetail = () =>
    detail({ phone: null, chatPlaceholder: true, source: 'FACEBOOK', purchase: emptyPurchase, contracts: [] });
  const prospectSummary = (over: Parameters<typeof journeySummary>[0] = {}) =>
    journeySummary({
      stage: 'CREDIT',
      stageEnteredAt: PROSPECT_AT.CREDIT,
      daysInStage: 2,
      steps: stageSteps(
        { CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'current', INTERESTED: 'todo', PURCHASED: 'todo' },
        PROSPECT_AT,
      ),
      ...over,
    });

  it('OWNER: "ติดป้ายหลุด" → เลือกเหตุผล = บันทึกทันที → แถบเปลี่ยนเป็นป้ายหลุด + "เปิดใหม่" จาก summary ที่ API ตอบกลับ', async () => {
    mocks.detail = prospectDetail();
    const lost = prospectSummary({ lost: { at: '2026-09-15T03:00:00.000Z', reason: 'NOT_INTERESTED' } });
    mocks.summaries.c1 = prospectSummary();
    mocks.entry.mockImplementation(() => {
      mocks.summaries.c1 = lost;
      return { entryId: 'entry-1', event: null, summary: lost };
    });
    renderAt('/customers/c1');
    const strip = await screen.findByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
    const user = userEvent.setup();
    await user.click(within(strip).getByRole('button', { name: 'ติดป้ายหลุด' }));
    const dialog = await screen.findByRole('dialog', { name: 'ติดป้ายหลุด — เพราะอะไร' });
    await user.click(within(dialog).getByRole('button', { name: 'ไม่สนใจ' }));

    expect(await within(strip).findByText('หลุด · ไม่สนใจ')).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: 'เปิดใหม่' })).toBeInTheDocument();
    expect(within(strip).queryByRole('button', { name: 'ติดป้ายหลุด' })).toBeNull();
    expect(mocks.post).toHaveBeenCalledWith('/customers/c1/journey/entries', {
      kind: 'MARKED_LOST',
      lostReason: 'NOT_INTERESTED',
      clientRequestId: expect.stringMatching(UUID),
    });
    expect(toast.success).toHaveBeenCalledWith('ติดป้ายหลุดแล้ว', {
      duration: 10000,
      action: { label: 'เลิกทำ', onClick: expect.any(Function) },
    });
  });

  it('ACCOUNTANT: เห็นป้ายหลุดบนแถบ แต่ไม่มีปุ่มติดป้ายหลุด / เปิดใหม่ และไม่ยิง POST', async () => {
    mocks.role = 'ACCOUNTANT';
    mocks.detail = prospectDetail();
    mocks.summaries.c1 = prospectSummary({ lost: { at: '2026-09-14T03:00:00.000Z', reason: 'BOUGHT_ELSEWHERE' } });
    renderAt('/customers/c1');
    const strip = await screen.findByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
    expect(within(strip).getByText('หลุด · ซื้อที่อื่น')).toBeInTheDocument();
    expect(within(strip).queryAllByRole('button')).toHaveLength(0);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('ผู้สนใจที่ส่งไฟล์ในแชทแล้วแต่ยังไม่มีผลตรวจ → ช่องเครดิต "ส่งไฟล์แล้ว รอตรวจ" (ค่าจาก summary.creditFilePending)', async () => {
    mocks.detail = prospectDetail();
    mocks.summaries.c1 = prospectSummary({ creditFilePending: true });
    renderAt('/customers/c1');
    expect(await screen.findByText('ส่งไฟล์แล้ว รอตรวจ')).toBeInTheDocument();
  });
});
```

- [ ] **Step 13: Run the page test and confirm the new cases fail**

Run: `cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx`
Expected: FAIL — 2 failed: `OWNER: "ติดป้ายหลุด" …` (`Unable to find an accessible element with the role "button" and name "ติดป้ายหลุด"` — `index.tsx` does not pass `canRecord` yet) and `ผู้สนใจที่ส่งไฟล์ในแชทแล้ว…` (`Unable to find an element with the text: ส่งไฟล์แล้ว รอตรวจ`). Every other test, including the new ACCOUNTANT case, passes.

- [ ] **Step 14: Wire `index.tsx`**

In `apps/web/src/pages/CustomerDetailPage/index.tsx`:

Replace

```tsx
import { useAuth } from '@/contexts/AuthContext';
```

with

```tsx
import { useAuth } from '@/contexts/AuthContext';
import { canRecordJourney } from '@/lib/constants';
```

Replace

```tsx
  const canReviewCredit = !!user && ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(user.role);
```

with

```tsx
  const canReviewCredit = !!user && ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(user.role);
  // ปุ่มบันทึกการเดินทาง (ติดป้ายหลุด / เปิดใหม่) — ตรง @Roles ของ POST /customers/:id/journey/entries · ACCOUNTANT ดูอย่างเดียว
  const canRecord = canRecordJourney(user?.role ?? '');
```

Replace

```tsx
      <KpiTiles tiles={kpiTiles(customer, loyaltyPoints?.balance ?? null)} />

      {journeySummary && <JourneyStageStrip summary={journeySummary} />}
```

with

```tsx
      <KpiTiles tiles={kpiTiles(customer, loyaltyPoints?.balance ?? null, journeySummary)} />

      {journeySummary && <JourneyStageStrip summary={journeySummary} customerId={customer.id} canRecord={canRecord} />}
```

- [ ] **Step 15: Run the whole customer detail folder in both time zones**

Run: `cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage`
Expected: PASS — every file green, including `JourneyStageStrip.test.tsx` (16), `kpiTiles.test.ts` (16) and `CustomerDetailPage.test.tsx` (all existing tests + 3 new).

Run: `cd apps/web && npx vitest run src/pages/CustomerDetailPage`
Expected: PASS — same counts.

- [ ] **Step 16: Typecheck and lint the touched files**

Run: `cd apps/web && npx tsc --noEmit`
Expected: exit 0, no output.

Run: `cd apps/web && npx eslint src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx src/pages/CustomerDetailPage/components/JourneyLostControls.tsx src/pages/CustomerDetailPage/utils/kpiTiles.ts src/pages/CustomerDetailPage/index.tsx src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts`
Expected: exit 0, no errors.

- [ ] **Step 17: Commit**

```bash
git add apps/web/src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx \
  apps/web/src/pages/CustomerDetailPage/components/JourneyLostControls.tsx \
  apps/web/src/pages/CustomerDetailPage/utils/kpiTiles.ts \
  apps/web/src/pages/CustomerDetailPage/index.tsx \
  apps/web/src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx \
  apps/web/src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts \
  apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx \
  apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts
git commit -F - <<'MSG'
feat(customer-journey): แถบขั้นเฟส 3 — ติดป้ายหลุด/เปิดใหม่ + เลิกทำ · คำบรรยาย 2 บรรทัด · ช่องเครดิต "ส่งไฟล์แล้ว รอตรวจ"

- คำบรรยายขั้น line-clamp-2 (Q15) เลขกับ "วัน" ติดกันด้วยเว้นวรรคไม่ตัดบรรทัด (ข้อ 12)
- ข้าม = "ข้าม" เปล่า ๆ ทุกขั้น · ขั้นตรวจเครดิต not_needed = "ไม่ต้องตรวจ (ซื้อสด)" / "ไฟแนนซ์นอกตรวจ" สีเทาชุดเดียวกับข้าม (ข้อ 13)
- หลักฐาน CHAT_FILE ต่อท้าย "ส่งไฟล์ในแชท" ยกเว้นเครดิตไม่ผ่าน (บอร์ด a4)
- JourneyLostControls: ghost "ติดป้ายหลุด" → เลือก 1 ใน 5 เหตุผล = บันทึก (Q2) · outline "เปิดใหม่" แตะเดียว · toast 10 วิ + เลิกทำ · เปิดอยู่แล้ว = toast.info (Q4) · มือถือ 44px (Q17) · ACCOUNTANT ไม่มีปุ่ม
- kpiTiles รับ summary.creditFilePending — ผลตรวจจริงบนข้อมูลลูกค้าชนะธงที่ค้างแคช
  · ต่างจากบอร์ด Main (a) ของแคนวาส (วาด "ยังไม่เคยตรวจ" หลังส่งไฟล์) โดยตั้งใจ — คำตัดสินข้อ 13(3) มาทีหลังจึงชนะ
- เทสหน้า: รีเซ็ต post/del ทุกเทสด้วยตัวจับ URL · mock sonner มี info/warning · toast เลิกทำใช้ undoToastOptions ของ Task 10

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

Expected: one new commit; `git show --stat HEAD` lists exactly the 8 files above.

**PR notes (copy into the PR body when the owner asks for the PR — no push in this task):**
- ⚠️ ช่อง KPI "เครดิต" ของผู้สนใจที่ส่งไฟล์ในแชทแล้วแต่ยังไม่มีผลตรวจ แสดง **"ส่งไฟล์แล้ว รอตรวจ"** ตามคำตัดสินเจ้าของข้อ 13(3) (brief §0) — บอร์ด **Main (a)** ในแคนวาสที่เคาะ (https://claude.ai/code/artifact/8dd2fd87-8def-4f76-9e83-b981360f3abb) ยังวาดและเขียนคำบรรยายว่าช่องนี้ "จึงยังเป็น ยังไม่เคยตรวจ" · คำตัดสินข้อ 13(3) อนุมัติทีหลังบอร์ด จึงเป็นตัวจริง — ผู้รีวิวที่เทียบกับบอร์ดจะเห็นต่าง **โดยตั้งใจ** (บันทึกเดียวกันอยู่ในสเปคบรรทัด creditFilePending ที่ Task 4 เขียน)
- ฝ่ายบัญชี (ACCOUNTANT) เห็นค่านี้และคำใต้ขั้น "ส่งไฟล์ในแชท" ด้วย — ชนิด + เวลาเท่านั้น (แนวเดียวกับ FR-CREDIT-STAGE · Risk 4)

---

### Task 12: Journey tab: record-contact button, chooser, lost prompt, row undo

**Files:**
- Create: `apps/web/src/pages/CustomerDetailPage/components/RecordContactChooser.tsx`
- Modify: `apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx` (whole file, 1-125 after Task 10's import-path move — replaced in full)
- Modify: `apps/web/src/pages/CustomerDetailPage/index.tsx` (the `<JourneyTab … />` element inside `<TabsContent value="journey">`, `:191` at HEAD — Task 11 shifts the line number, anchor by text)
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md` (section "บันทึกด้วยมือ (เฟส 3)", bullets (ค) and (ง), `:428-437` at HEAD)
- Test: `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` (hoisted `mocks` `:20-31`, `vi.mock` block `:33-40`, file-level `beforeEach` `:64-66`, imports `:6-12`; new `describe` appended at the end of the file)

**Interfaces:**

Consumes (must already exist — Step 1 verifies):
- Task 1 (`@installment/shared`): `JOURNEY_RECORDABLE_TOUCH_CHANNELS = ['PHONE','FB_APP','LINE_APP','WALK_IN'] as const`, `type JourneyRecordableTouchChannel`, `JOURNEY_TOUCH_CHANNEL_LABELS: Record<JourneyTouchChannel, string>`, `JOURNEY_TOUCH_OUTCOMES` (7, order นัดแล้ว … ไม่สนใจ), `type JourneyTouchOutcome`, `JOURNEY_TOUCH_OUTCOME_LABELS`, `type JourneyLostReason`, `JOURNEY_LOST_PROMPT_OUTCOMES: Readonly<Partial<Record<JourneyTouchOutcome, JourneyLostReason>>>`, `type JourneySummary`, `JourneyEvent.entryId?: string`, `JourneyEvent.canDelete?: boolean`, `JourneyManualEntryInput`, `JourneyEntryCreatedResponse { entryId: string | null; event: JourneyEvent | null; summary: JourneySummary }`.
- Task 8 (API): MANUAL rows of `GET /customers/:id/journey` carry `entryId` and `canDelete`; `POST /customers/:id/journey/entries` → 201 `JourneyEntryCreatedResponse`; `DELETE /customers/:id/journey/entries/:entryId` → 200 `{ summary }`.
- Task 10:
  - `@/hooks/customer-journey/useCustomerJourney` — `isJourneyRedirect`, `useCustomerJourney` (moved file).
  - `@/hooks/customer-journey/journeyEntries` — `useRecordJourneyEntry(customerId: string)` (TanStack mutation, variables `JourneyManualEntryInput`, data `JourneyEntryCreatedResponse`, `onSuccess` in the `useMutation` options sets the summary cache and invalidates the list); `deleteJourneyEntry(queryClient: QueryClient, customerId: string, entryId: string): Promise<void>` (DELETE `/customers/${customerId}/journey/entries/${entryId}` + cache + `toast.success('เลิกทำแล้ว')` / `toast.error`, never rejects); `useDeleteJourneyEntry(customerId: string)` (mutation, variables = `entryId: string`); `undoToastOptions(queryClient: QueryClient, customerId: string, entryId: string | null, onUndo?: () => void)` + `JOURNEY_UNDO_TOAST_MS = 10_000` (the one success-toast shape — this task defines no local duration or options helper).
  - `@/components/customer/journey/ChoiceChip` — `ChoiceChip { active: boolean; busy?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }` (renders `<button type="button" aria-pressed aria-busy>`), `ChoiceChipRow { label?: string; hint?: string; children: ReactNode }`.
  - `@/components/customer/journey/ResponsiveChooser` — `ResponsiveChooser { open: boolean; onOpenChange: (open: boolean) => void; title: string; trigger: ReactElement; children: ReactNode }` (desktop `PopoverContent align="end" className="w-80" aria-label={title}`; mobile `SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto"` + `SheetTitle`).
  - `@/components/customer/journey/journeyStorage` — `readLastChannel(): JourneyRecordableTouchChannel | null`, `writeLastChannel(channel: JourneyRecordableTouchChannel): void` (key `customerJourney.lastChannel.v1`, both swallow storage errors).
- Task 11: `index.tsx` has `const canRecord = canRecordJourney(user?.role ?? '');`; `CustomerDetailPage.test.tsx` harness (post/del reset, sonner mock with `success`/`error`/`info`/`warning`).

Produces:
- `JourneyTab` default export with props `{ customerId: string; role: string; summary: JourneySummary | null; canRecord: boolean }`; `index.tsx` passes all four.
- `type JourneyTimelineItem = EventTimelineItem & { entryId?: string; canDelete?: boolean }` (file-local in `JourneyTab.tsx`; still no `metadata`).
- `RecordContactChooser` default export, props `{ customerId: string; summary: JourneySummary | null }`. Renders the trigger `Button variant="outline" size="sm" className="max-lg:h-11 max-lg:w-full"` (`Plus` + `บันทึกการติดต่อ`, `disabled` when `summary === null`) and the chooser body. Mounted by `JourneyTab` as the first child of the chip header group inside `<div className="flex justify-end">`, only when `canRecord`.
- Row link `<button type="button" className="text-xs leading-snug text-primary hover:underline">เลิกทำ</button>` through `EventTimeline renderExtra`, only when `canRecord && event.canDelete && event.entryId`.
- Spec (ค)(ง) bullets rewritten for scope v2.

Toast contract (sonner, raw): `toast.success('บันทึกแล้ว', undoToastOptions(queryClient, customerId, res.entryId))` · `toast.success('ติดป้ายหลุดแล้ว', undoToastOptions(queryClient, customerId, res.entryId))` — both resolve to `{ duration: 10000, action: { label: 'เลิกทำ', onClick } }` · error `toast.error(getErrorMessage(err))`. `onClick` = `() => void deleteJourneyEntry(queryClient, customerId, entryId)` inside the Task 10 helper (D12 — survives the tab unmounting).

Request bodies (D8 — one `uid()` per tap, never per open): TOUCHPOINT `{ kind: 'TOUCHPOINT', channel, outcome, clientRequestId }`; lost prompt `{ kind: 'MARKED_LOST', lostReason, clientRequestId }` with a NEW id. Never `note`, `occurredAt`, `roomId`.

---

- [ ] **Step 1: Verify the Task 1 / 10 / 11 prerequisites are in the tree**

Run (from the worktree root):

```bash
grep -n "^export" apps/web/src/components/customer/journey/ChoiceChip.tsx apps/web/src/components/customer/journey/ResponsiveChooser.tsx apps/web/src/components/customer/journey/journeyStorage.ts apps/web/src/hooks/customer-journey/journeyEntries.ts
grep -n "canRecord" apps/web/src/pages/CustomerDetailPage/index.tsx
grep -n "JOURNEY_RECORDABLE_TOUCH_CHANNELS\|JOURNEY_LOST_PROMPT_OUTCOMES\|canDelete?:\|entryId?:" packages/shared/src/customer-journey.ts
grep -n "useCustomerJourney'" apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx
```

Expected:
- first command lists exported `ChoiceChip`, `ChoiceChipRow`, `ResponsiveChooser`, `readLastChannel`, `writeLastChannel`, `useRecordJourneyEntry`, `deleteJourneyEntry`, `JOURNEY_UNDO_TOAST_MS`, `undoToastOptions`, `useDeleteJourneyEntry`;
- second shows `const canRecord = canRecordJourney(user?.role ?? '');` and the strip receiving `canRecord={canRecord}`;
- third shows the two constants and the two `JourneyEvent` fields;
- fourth shows `import { isJourneyRedirect, useCustomerJourney } from '@/hooks/customer-journey/useCustomerJourney';`.

Stop and finish Tasks 1/10/11 first if any line is missing.

- [ ] **Step 2: Extend the page test harness (mobile switch + storage helpers)**

In `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx`:

(a) Add the storage helper import directly above the existing `mask.util` import:

```tsx
import { readLastChannel, writeLastChannel } from '@/components/customer/journey/journeyStorage';
import { formatNationalId, maskNationalId } from '@/utils/mask.util';
```

(b) In the hoisted `mocks` object replace

```tsx
  role: 'OWNER',
  detail: null as unknown,
```

with

```tsx
  role: 'OWNER',
  /** useIsMobile() — true = ตัวเลือกบันทึกการติดต่อเป็น bottom sheet */
  mobile: false,
  detail: null as unknown,
```

(c) Directly after the `vi.mock('@/contexts/AuthContext', …)` block (the three lines ending in `}));`) add:

```tsx
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.mobile }));
```

(d) In the file-level `beforeEach`, replace

```tsx
  mocks.role = 'OWNER';
  mocks.detail = detail();
```

with

```tsx
  mocks.role = 'OWNER';
  mocks.mobile = false;
  mocks.detail = detail();
```

- [ ] **Step 3: Write the failing tests**

Append at the very end of `CustomerDetailPage.test.tsx`:

```tsx
describe('แท็บการเดินทาง: บันทึกการติดต่อ (เฟส 3)', () => {
  const ENTRIES_URL = '/customers/c1/journey/entries';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const OUTCOME_LABELS = ['นัดแล้ว', 'มาร้านแล้ว', 'ขอคิดก่อน', 'งบ/ดาวน์ไม่พอ', 'ไม่รับสาย', 'ซื้อที่อื่น', 'ไม่สนใจ'];

  /** sonner ถูก mock ระดับไฟล์ — import แบบ dynamic เพื่อไม่ชนกับ import ของเทสอื่นในไฟล์ */
  async function sonnerToast() {
    return vi.mocked((await import('sonner')).toast);
  }

  /** POST ของบันทึกมือ — ตอบตามตัวรับ · URL อื่นโยน error พร้อม URL */
  function answerEntries(respond: (body: Record<string, unknown>) => unknown) {
    mocks.post.mockReset();
    mocks.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url === ENTRIES_URL) return respond(body);
      throw new Error(`unexpected POST ${url}`);
    });
  }

  function created(entryId: string, summary = journeySummary()) {
    return {
      data: {
        entryId,
        event: journeyEvent({ id: `entry-${entryId}`, type: 'TOUCHPOINT', origin: 'MANUAL', entryId, canDelete: true }),
        summary,
      },
    };
  }

  function entryBodies(): Record<string, unknown>[] {
    return mocks.post.mock.calls
      .filter(([url]) => url === ENTRIES_URL)
      .map(([, body]) => body as Record<string, unknown>);
  }

  async function openChooser(user: ReturnType<typeof userEvent.setup>) {
    const trigger = await screen.findByRole('button', { name: 'บันทึกการติดต่อ' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    return screen.findByRole('dialog', { name: 'บันทึกการติดต่อ' });
  }

  function rowWithTitle(title: string): HTMLElement {
    const row = screen.getAllByTestId('event-timeline-item').find((item) => within(item).queryByText(title));
    if (!row) throw new Error(`ไม่พบแถว ${title}`);
    return row;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.summaries.c1 = journeySummary();
    mocks.del.mockReset();
    mocks.del.mockImplementation(async (url: string) => {
      if (url.startsWith(`${ENTRIES_URL}/`)) return { data: { summary: journeySummary() } };
      throw new Error(`unexpected DELETE ${url}`);
    });
    answerEntries(() => created('e-new'));
  });

  it('ฝ่ายบัญชีไม่เห็นปุ่มบันทึกการติดต่อ และไม่เห็นลิงก์เลิกทำแม้แถวส่ง canDelete มา', async () => {
    mocks.role = 'ACCOUNTANT';
    mocks.journey.mockImplementation(() =>
      journeyPage({
        events: [
          journeyEvent({
            id: 'entry-e1',
            type: 'TOUCHPOINT',
            origin: 'MANUAL',
            title: 'ติดต่อทางโทร: นัดแล้ว',
            actor: { type: 'STAFF', name: 'admin' },
            entryId: 'e1',
            canDelete: true,
          }),
        ],
      }),
    );
    renderAt('/customers/c1?tab=journey');
    expect(await screen.findByText('ติดต่อทางโทร: นัดแล้ว')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'บันทึกการติดต่อ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'เลิกทำ' })).toBeNull();
  });

  it('ปุ่มอยู่แถวของตัวเองชิดขวาก่อนชิปกรอง (Q16) และกดไม่ได้ระหว่างรอ summary', async () => {
    let releaseSummary: (value: unknown) => void = () => {};
    const baseGet = mocks.get.getMockImplementation();
    mocks.get.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) =>
      url === '/customers/c1/journey/summary'
        ? new Promise((resolve) => {
            releaseSummary = resolve;
          })
        : baseGet!(url, config),
    );
    renderAt('/customers/c1?tab=journey');

    const trigger = await screen.findByRole('button', { name: 'บันทึกการติดต่อ' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveClass('max-lg:h-11', 'max-lg:w-full');
    expect(trigger.parentElement).toHaveClass('flex', 'justify-end');
    const allChip = screen.getByRole('button', { name: 'ทั้งหมด' });
    expect(trigger.compareDocumentPosition(allChip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    releaseSummary({ data: journeySummary() });
    await waitFor(() => expect(trigger).toBeEnabled());
  });

  it('ช่องทางที่ใช้ครั้งก่อนถูกเลือกไว้ · ค่าที่ไม่รู้จักถูกทิ้ง · localStorage โยน error ก็ยังเปิดได้', async () => {
    const user = userEvent.setup();
    writeLastChannel('LINE_APP');
    const first = renderAt('/customers/c1?tab=journey');
    let dialog = await openChooser(user);
    expect(within(dialog).getByRole('button', { name: 'LINE' })).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['โทร', 'แชทในแอป FB', 'หน้าร้าน']) {
      expect(within(dialog).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(within(dialog).getByRole('button', { name: 'นัดแล้ว' })).toBeEnabled();
    expect(within(dialog).queryByText('เลือกช่องทางก่อน')).toBeNull();
    first.unmount();

    localStorage.setItem('customerJourney.lastChannel.v1', 'OTHER');
    const second = renderAt('/customers/c1?tab=journey');
    dialog = await openChooser(user);
    expect(within(dialog).queryByRole('button', { pressed: true })).toBeNull();
    expect(within(dialog).getByText('เลือกช่องทางก่อน')).toBeInTheDocument();
    second.unmount();

    renderAt('/customers/c1?tab=journey');
    const trigger = await screen.findByRole('button', { name: 'บันทึกการติดต่อ' });
    await waitFor(() => expect(trigger).toBeEnabled());
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    try {
      await user.click(trigger);
      dialog = await screen.findByRole('dialog', { name: 'บันทึกการติดต่อ' });
      expect(within(dialog).queryByRole('button', { pressed: true })).toBeNull();
      expect(within(dialog).getByText('เลือกช่องทางก่อน')).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
    }
  });

  it('ยังไม่มีช่องทาง: ผลกดไม่ได้ + คำใบ้ → เลือกโทร แตะไม่รับสาย = POST ทันที ชิปล็อกระหว่างรอ ปิดตัวเลือก ไม่ถามติดป้ายหลุด', async () => {
    const user = userEvent.setup();
    let resolvePost: (value: unknown) => void = () => {};
    answerEntries(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    renderAt('/customers/c1?tab=journey');
    const dialog = await openChooser(user);

    expect(dialog).toHaveAttribute('data-slot', 'popover-content');
    // มีแค่ช่องทาง + ผล (ขอบเขตรอบ 2 ข้อ 4) — ไม่มีโน้ต ไม่มีเวลา ไม่มีปุ่มบันทึก
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'โทร',
      'แชทในแอป FB',
      'LINE',
      'หน้าร้าน',
      ...OUTCOME_LABELS,
    ]);
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(dialog.querySelector('input')).toBeNull();
    expect(within(dialog).getByText('เลือกช่องทางก่อน')).toBeInTheDocument();
    for (const name of OUTCOME_LABELS) expect(within(dialog).getByRole('button', { name })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'โทร' }));
    expect(within(dialog).getByRole('button', { name: 'โทร' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).queryByText('เลือกช่องทางก่อน')).toBeNull();
    expect(readLastChannel() ?? null).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'ไม่รับสาย' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'ไม่รับสาย' })).toHaveAttribute('aria-busy', 'true'),
    );
    expect(within(dialog).getByRole('button', { name: 'นัดแล้ว' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'โทร' })).toBeDisabled();

    resolvePost(created('e-new'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'บันทึกการติดต่อ' })).toBeNull());

    const bodies = entryBodies();
    expect(bodies).toHaveLength(1);
    expect(Object.keys(bodies[0]).sort()).toEqual(['channel', 'clientRequestId', 'kind', 'outcome']);
    expect(bodies[0]).toEqual({
      kind: 'TOUCHPOINT',
      channel: 'PHONE',
      outcome: 'NO_ANSWER',
      clientRequestId: expect.stringMatching(UUID),
    });
    const toast = await sonnerToast();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      'บันทึกแล้ว',
      expect.objectContaining({
        duration: 10000,
        action: expect.objectContaining({ label: 'เลิกทำ', onClick: expect.any(Function) }),
      }),
    );
    expect(screen.queryByText('ติดป้ายหลุดไหม')).toBeNull();
    expect(readLastChannel()).toBe('PHONE');
  });

  it('ซื้อที่อื่น → บันทึกแล้วถาม "ติดป้ายหลุดไหม" → "ใช่ ติดป้ายหลุด" ส่ง MARKED_LOST ด้วย clientRequestId ใหม่ แล้วปิด', async () => {
    const user = userEvent.setup();
    writeLastChannel('FB_APP');
    answerEntries((body) => created(body.kind === 'MARKED_LOST' ? 'e-lost' : 'e-touch'));
    renderAt('/customers/c1?tab=journey');
    const dialog = await openChooser(user);

    await user.click(within(dialog).getByRole('button', { name: 'ซื้อที่อื่น' }));

    expect(await within(dialog).findByText('ติดป้ายหลุดไหม')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'นัดแล้ว' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'ไม่ต้อง' })).toBeInTheDocument();
    const toast = await sonnerToast();
    expect(toast.success).toHaveBeenCalledWith('บันทึกแล้ว', expect.objectContaining({ duration: 10000 }));

    await user.click(within(dialog).getByRole('button', { name: 'ใช่ ติดป้ายหลุด' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'บันทึกการติดต่อ' })).toBeNull());

    const [touch, lost] = entryBodies();
    expect(touch).toEqual({
      kind: 'TOUCHPOINT',
      channel: 'FB_APP',
      outcome: 'BOUGHT_ELSEWHERE',
      clientRequestId: expect.stringMatching(UUID),
    });
    expect(Object.keys(lost).sort()).toEqual(['clientRequestId', 'kind', 'lostReason']);
    expect(lost).toEqual({ kind: 'MARKED_LOST', lostReason: 'BOUGHT_ELSEWHERE', clientRequestId: expect.stringMatching(UUID) });
    expect(lost.clientRequestId).not.toBe(touch.clientRequestId);
    expect(toast.success).toHaveBeenLastCalledWith(
      'ติดป้ายหลุดแล้ว',
      expect.objectContaining({ duration: 10000, action: expect.objectContaining({ label: 'เลิกทำ' }) }),
    );
  });

  it('ไม่สนใจ → ถามติดป้ายหลุด → "ไม่ต้อง" ปิดตัวเลือก ไม่ส่งคำขอที่สอง · เปิดใหม่กลับมาเป็นชิป', async () => {
    const user = userEvent.setup();
    writeLastChannel('PHONE');
    renderAt('/customers/c1?tab=journey');
    const dialog = await openChooser(user);

    await user.click(within(dialog).getByRole('button', { name: 'ไม่สนใจ' }));
    await user.click(await within(dialog).findByRole('button', { name: 'ไม่ต้อง' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'บันทึกการติดต่อ' })).toBeNull());

    expect(entryBodies()).toEqual([
      { kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'NOT_INTERESTED', clientRequestId: expect.stringMatching(UUID) },
    ]);
    expect((await sonnerToast()).success).not.toHaveBeenCalledWith('ติดป้ายหลุดแล้ว', expect.anything());

    const again = await openChooser(user);
    expect(within(again).queryByText('ติดป้ายหลุดไหม')).toBeNull();
    expect(within(again).getByRole('button', { name: 'นัดแล้ว' })).toBeEnabled();
  });

  it('ผลตอบกลับบอกว่าลูกค้าซื้อแล้ว → ไม่ถามติดป้ายหลุด ปิดตัวเลือกเลย', async () => {
    const user = userEvent.setup();
    writeLastChannel('WALK_IN');
    answerEntries(() => created('e-touch', journeySummary({ stage: 'PURCHASED' })));
    renderAt('/customers/c1?tab=journey');
    const dialog = await openChooser(user);

    await user.click(within(dialog).getByRole('button', { name: 'ซื้อที่อื่น' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'บันทึกการติดต่อ' })).toBeNull());

    expect(screen.queryByText('ติดป้ายหลุดไหม')).toBeNull();
    expect(entryBodies()).toHaveLength(1);
  });

  it('บันทึกไม่สำเร็จ → toast ข้อความจาก API · ตัวเลือกยังเปิดพร้อมช่องทางที่เลือก · ไม่จำช่องทาง', async () => {
    const user = userEvent.setup();
    answerEntries(() => Promise.reject({ response: { status: 400, data: { message: 'กรุณาเลือกผลการติดต่อ' } } }));
    renderAt('/customers/c1?tab=journey');
    const dialog = await openChooser(user);

    await user.click(within(dialog).getByRole('button', { name: 'หน้าร้าน' }));
    await user.click(within(dialog).getByRole('button', { name: 'งบ/ดาวน์ไม่พอ' }));

    const toast = await sonnerToast();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ผิดพลาด'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'บันทึกการติดต่อ' })).toBe(dialog);
    expect(within(dialog).getByRole('button', { name: 'หน้าร้าน' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'งบ/ดาวน์ไม่พอ' })).toBeEnabled());
    expect(within(dialog).getByRole('button', { name: 'งบ/ดาวน์ไม่พอ' })).not.toHaveAttribute('aria-busy', 'true');
    expect(readLastChannel() ?? null).toBeNull();
  });

  it('ลิงก์ "เลิกทำ" ขึ้นเฉพาะแถวที่ canDelete (Q18) · กดแล้วส่ง DELETE ของรายการนั้น', async () => {
    mocks.journey.mockImplementation(() =>
      journeyPage({
        events: [
          journeyEvent({
            id: 'entry-e1',
            type: 'TOUCHPOINT',
            origin: 'MANUAL',
            timestamp: '2026-09-15T03:00:00.000Z',
            title: 'ติดต่อทางโทร: นัดแล้ว',
            actor: { type: 'STAFF', name: 'admin' },
            entryId: 'e1',
            canDelete: true,
          }),
          journeyEvent({
            id: 'entry-e2',
            type: 'TOUCHPOINT',
            origin: 'MANUAL',
            timestamp: '2026-09-14T03:00:00.000Z',
            title: 'ติดต่อทางLINE: ขอคิดก่อน',
            actor: { type: 'STAFF', name: 'สุดา' },
            entryId: 'e2',
            canDelete: false,
          }),
          journeyEvent({
            id: 'chatfile-r1-2026-09-13',
            type: 'CHAT_CUSTOMER_FILE',
            origin: 'SOURCE',
            stage: 'CREDIT',
            timestamp: '2026-09-13T03:00:00.000Z',
            title: 'ลูกค้าส่งไฟล์ในแชท',
            href: '/inbox/r1',
          }),
        ],
      }),
    );
    renderAt('/customers/c1?tab=journey');
    await screen.findByText('ติดต่อทางโทร: นัดแล้ว');

    expect(within(rowWithTitle('ติดต่อทางโทร: นัดแล้ว')).getByRole('button', { name: 'เลิกทำ' })).toBeInTheDocument();
    expect(within(rowWithTitle('ติดต่อทางLINE: ขอคิดก่อน')).queryByRole('button', { name: 'เลิกทำ' })).toBeNull();
    expect(within(rowWithTitle('ลูกค้าส่งไฟล์ในแชท')).queryByRole('button', { name: 'เลิกทำ' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'เลิกทำ' })).toHaveLength(1);

    fireEvent.click(within(rowWithTitle('ติดต่อทางโทร: นัดแล้ว')).getByRole('button', { name: 'เลิกทำ' }));
    await waitFor(() =>
      expect(mocks.del.mock.calls.map(([url]) => url)).toEqual(['/customers/c1/journey/entries/e1']),
    );
    const toast = await sonnerToast();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('เลิกทำแล้ว'));
  });

  it('กด "เลิกทำ" ใน toast หลังสลับไปแท็บอื่น (แท็บการเดินทาง unmount แล้ว) ยังส่ง DELETE', async () => {
    const user = userEvent.setup();
    writeLastChannel('PHONE');
    answerEntries(() => created('e-toast'));
    renderAt('/customers/c1?tab=journey');
    const dialog = await openChooser(user);

    await user.click(within(dialog).getByRole('button', { name: 'นัดแล้ว' }));
    const toast = await sonnerToast();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('บันทึกแล้ว', expect.anything()));

    // Radix TabsTrigger สลับแท็บด้วย mouseDown — TabsContent ของแท็บการเดินทาง unmount
    fireEvent.mouseDown(screen.getByRole('tab', { name: /สัญญา/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'บันทึกการติดต่อ' })).toBeNull());

    const options = toast.success.mock.calls.find(([title]) => title === 'บันทึกแล้ว')?.[1] as unknown as {
      action: { onClick: () => void };
    };
    options.action.onClick();

    await waitFor(() =>
      expect(mocks.del.mock.calls.map(([url]) => url)).toEqual(['/customers/c1/journey/entries/e-toast']),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('เลิกทำแล้ว'));
  });

  it('มือถือ (< 1024px): ตัวเลือกเป็น bottom sheet และแตะผลบันทึกได้เหมือนเดสก์ท็อป', async () => {
    mocks.mobile = true;
    const user = userEvent.setup();
    writeLastChannel('LINE_APP');
    renderAt('/customers/c1?tab=journey');
    const dialog = await openChooser(user);

    expect(dialog).toHaveClass('rounded-t-2xl');
    expect(dialog).not.toHaveAttribute('data-slot', 'popover-content');
    expect(within(dialog).getByRole('button', { name: 'LINE' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(dialog).getByRole('button', { name: 'ขอคิดก่อน' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'บันทึกการติดต่อ' })).toBeNull());

    expect(entryBodies()).toEqual([
      { kind: 'TOUCHPOINT', channel: 'LINE_APP', outcome: 'THINKING', clientRequestId: expect.stringMatching(UUID) },
    ]);
  });
});
```

- [ ] **Step 4: Run the tests and watch them fail**

Run:

```bash
cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx -t "แท็บการเดินทาง: บันทึกการติดต่อ"
```

Expected: the 11 tests of the new describe run (all other tests skipped), **10 FAIL** — every test that opens the chooser fails at `findByRole('button', { name: 'บันทึกการติดต่อ' })` with `Unable to find an accessible element with the role "button" and name "บันทึกการติดต่อ"`, and the row-undo test fails at `getByRole('button', { name: 'เลิกทำ' })`. The ACCOUNTANT test **passes** already (it guards an absence and must stay green after the change). No `unexpected GET` / `unexpected POST` errors.

- [ ] **Step 5: Create `RecordContactChooser.tsx`**

Create `apps/web/src/pages/CustomerDetailPage/components/RecordContactChooser.tsx`:

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  JOURNEY_LOST_PROMPT_OUTCOMES,
  JOURNEY_RECORDABLE_TOUCH_CHANNELS,
  JOURNEY_TOUCH_CHANNEL_LABELS,
  JOURNEY_TOUCH_OUTCOMES,
  JOURNEY_TOUCH_OUTCOME_LABELS,
  type JourneyLostReason,
  type JourneyRecordableTouchChannel,
  type JourneySummary,
  type JourneyTouchOutcome,
} from '@installment/shared';
import { ChoiceChip, ChoiceChipRow } from '@/components/customer/journey/ChoiceChip';
import { readLastChannel, writeLastChannel } from '@/components/customer/journey/journeyStorage';
import { ResponsiveChooser } from '@/components/customer/journey/ResponsiveChooser';
import { Button } from '@/components/ui/button';
import { undoToastOptions, useRecordJourneyEntry } from '@/hooks/customer-journey/journeyEntries';
import { getErrorMessage } from '@/lib/api';
import { uid } from '@/utils/uid';

interface RecordContactChooserProps {
  customerId: string;
  /** null = summary ยังโหลด/ผิดพลาด → ปุ่มกดไม่ได้ */
  summary: JourneySummary | null;
}

/**
 * ปุ่ม "บันทึกการติดต่อ" ของแท็บการเดินทาง (ขอบเขตรอบ 2 ข้อ 4 — ไม่บังคับ)
 * ช่องทาง + ผลเท่านั้น · แตะผล = บันทึกทันที (เวลาเซิร์ฟเวอร์) · ไม่มีโน้ต/เวลา/ปุ่มบันทึก
 * clientRequestId ใหม่ทุกการแตะ (D8) — คำขอ MARKED_LOST ของ prompt ต้องไม่ถูก dedupe เข้ากับ TOUCHPOINT
 * ปุ่ม "เลิกทำ" ใน toast มาจาก undoToastOptions (เรียก deleteJourneyEntry ตรง — D12) — แท็บอาจ unmount ไปแล้วตอนกด
 */
export default function RecordContactChooser({ customerId, summary }: RecordContactChooserProps) {
  const queryClient = useQueryClient();
  const record = useRecordJourneyEntry(customerId);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<JourneyRecordableTouchChannel | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<JourneyTouchOutcome | null>(null);
  const [lostReason, setLostReason] = useState<JourneyLostReason | null>(null);
  const [markingLost, setMarkingLost] = useState(false);
  const busy = pendingOutcome !== null || markingLost;

  function handleOpenChange(next: boolean) {
    if (next) {
      setChannel(readLastChannel() ?? null);
      setLostReason(null);
    }
    setOpen(next);
  }

  async function recordOutcome(outcome: JourneyTouchOutcome) {
    if (!channel || busy) return;
    setPendingOutcome(outcome);
    try {
      const res = await record.mutateAsync({ kind: 'TOUCHPOINT', channel, outcome, clientRequestId: uid() });
      writeLastChannel(channel);
      toast.success('บันทึกแล้ว', undoToastOptions(queryClient, customerId, res.entryId));
      const reason = JOURNEY_LOST_PROMPT_OUTCOMES[outcome];
      // ตัดสินจาก summary ของคำตอบ ไม่ใช่ prop ที่อาจค้าง — ลูกค้าที่ซื้อแล้วติดป้ายหลุดไม่ได้ (API 409)
      if (reason && res.summary.stage !== 'PURCHASED') setLostReason(reason);
      else setOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setPendingOutcome(null);
    }
  }

  async function confirmLost() {
    if (!lostReason || busy) return;
    setMarkingLost(true);
    try {
      const res = await record.mutateAsync({ kind: 'MARKED_LOST', lostReason, clientRequestId: uid() });
      setOpen(false);
      toast.success('ติดป้ายหลุดแล้ว', undoToastOptions(queryClient, customerId, res.entryId));
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setMarkingLost(false);
    }
  }

  return (
    <ResponsiveChooser
      open={open}
      onOpenChange={handleOpenChange}
      title="บันทึกการติดต่อ"
      trigger={
        <Button variant="outline" size="sm" className="max-lg:h-11 max-lg:w-full" disabled={summary === null}>
          <Plus aria-hidden="true" />
          บันทึกการติดต่อ
        </Button>
      }
    >
      {lostReason ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-sm leading-snug">ติดป้ายหลุดไหม</span>
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/30 text-destructive max-lg:h-11"
            disabled={markingLost}
            onClick={() => void confirmLost()}
          >
            ใช่ ติดป้ายหลุด
          </Button>
          <Button variant="ghost" size="sm" className="max-lg:h-11" disabled={markingLost} onClick={() => setOpen(false)}>
            ไม่ต้อง
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-lg:gap-4">
          <ChoiceChipRow label="ช่องทาง">
            {JOURNEY_RECORDABLE_TOUCH_CHANNELS.map((code) => (
              <ChoiceChip key={code} active={channel === code} disabled={busy} onClick={() => setChannel(code)}>
                {JOURNEY_TOUCH_CHANNEL_LABELS[code]}
              </ChoiceChip>
            ))}
          </ChoiceChipRow>
          <ChoiceChipRow label="ผล" hint={channel ? undefined : 'เลือกช่องทางก่อน'}>
            {JOURNEY_TOUCH_OUTCOMES.map((code) => (
              <ChoiceChip
                key={code}
                active={pendingOutcome === code}
                busy={pendingOutcome === code}
                disabled={!channel || busy}
                onClick={() => void recordOutcome(code)}
              >
                {JOURNEY_TOUCH_OUTCOME_LABELS[code]}
              </ChoiceChip>
            ))}
          </ChoiceChipRow>
        </div>
      )}
    </ResponsiveChooser>
  );
}
```

- [ ] **Step 6: Replace `JourneyTab.tsx`**

Replace the whole content of `apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { JourneyEvent, JourneyListResponse, JourneySummary } from '@installment/shared';
import QueryBoundary from '@/components/QueryBoundary';
import { EventTimeline, type EventTimelineItem } from '@/components/timeline/EventTimeline';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useDeleteJourneyEntry } from '@/hooks/customer-journey/journeyEntries';
import { isJourneyRedirect, useCustomerJourney } from '@/hooks/customer-journey/useCustomerJourney';
import { cn } from '@/lib/utils';
import TimelineFilterChips, { type TimelineChip } from '@/pages/CollectionsPage/components/TimelineFilterChips';
import RecordContactChooser from '../components/RecordContactChooser';
import { allChipNote, journeyEventSubtitle, journeyGroupLabel, journeyGroupsForRole } from '../utils/journeyGroups';

const ALL_CHIP = 'ALL';

/** แถวไทม์ไลน์ + ข้อมูลเลิกทำของแถวบันทึกมือ (Task 8: entryId/canDelete มาจากเซิร์ฟเวอร์ — เว็บคำนวณช่วง 24 ชม. เองไม่ได้) */
type JourneyTimelineItem = EventTimelineItem & { entryId?: string; canDelete?: boolean };

/** ส่งเข้าไทม์ไลน์กลางเฉพาะฟิลด์ที่แสดง — ตัด metadata ทิ้ง (PDPA) · ผู้ทำต่อท้าย subtitle · ป้าย "ประมาณ" มาจาก reliability */
function toTimelineItem(event: JourneyEvent): JourneyTimelineItem {
  return {
    id: event.id,
    type: event.type,
    group: event.group,
    timestamp: event.timestamp,
    title: event.title,
    subtitle: journeyEventSubtitle(event) || undefined,
    reliability: event.reliability,
    href: event.href,
    entryId: event.entryId,
    canDelete: event.canDelete,
  };
}

function NotRecordedList({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium leading-snug text-muted-foreground hover:text-foreground"
        >
          <span>ระบบยังไม่เก็บ ({items.length})</span>
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="border-t border-border px-3 pt-2 text-xs leading-snug text-muted-foreground">
          เรื่องเหล่านี้ระบบยังไม่ได้บันทึก จึงไม่ปรากฏในการเดินทางด้านบน
        </p>
        <ul className="list-disc space-y-1 py-2 pl-7 pr-3 text-xs leading-snug text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface JourneyTabProps {
  customerId: string;
  role: string;
  /** summary ของหน้า (key เดียวกับแถบขั้น) — null = ยังโหลด/ผิดพลาด */
  summary: JourneySummary | null;
  /** บทบาทที่ POST/DELETE บันทึกมือได้ (canRecordJourney) — ฝ่ายบัญชีไม่เห็นปุ่มใด ๆ */
  canRecord: boolean;
}

export default function JourneyTab({ customerId, role, summary, canRecord }: JourneyTabProps) {
  const visibleGroups = useMemo(() => journeyGroupsForRole(role), [role]);
  const [filter, setFilter] = useState<string>(ALL_CHIP);
  const groups = useMemo(() => {
    const picked = visibleGroups.find((group) => group === filter);
    return picked ? [picked] : null;
  }, [filter, visibleGroups]);
  // ตัวเลขบนชิปต้องใช้ counts ของหน้าแรก — การ์ดภาพรวมไม่ขอ จึงไม่จ่ายค่าสแกน
  const query = useCustomerJourney(customerId, groups, { include: 'counts' });
  const deleteEntry = useDeleteJourneyEntry(customerId);

  const chips = useMemo<TimelineChip[]>(
    () => [
      { value: ALL_CHIP, label: 'ทั้งหมด' },
      ...visibleGroups.map((group) => ({ value: group, label: journeyGroupLabel(group) })),
    ],
    [visibleGroups],
  );

  const pages = (query.data?.pages ?? []).filter((page): page is JourneyListResponse => !isJourneyRedirect(page));
  const first: JourneyListResponse | undefined = pages[0];
  const items = pages.flatMap((page) => page.events.map(toTimelineItem));
  const note = filter === ALL_CHIP ? allChipNote(role) : null;

  // API ตอบหน้าว่างที่ยังมี nextCursor ได้ — EventTimeline วาด footer (ปุ่มโหลดเพิ่ม) เฉพาะเมื่อมีรายการ
  // จึงดึงหน้าถัดไปเองจนเจอรายการหรือหมด cursor · ตัดสินจาก cursor (hasNextPage) เท่านั้น ไม่ถือว่าหน้าว่าง = จบ
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  const emptyWithCursor = items.length === 0 && hasNextPage && !isError;
  useEffect(() => {
    if (emptyWithCursor && !isFetchingNextPage) void fetchNextPage();
  }, [emptyWithCursor, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {/* Q16: ปุ่มอยู่แถวของตัวเองชิดขวาเหนือชิปกรอง — ชิปกรองทั้งแถวอยู่บรรทัดเดียวที่ 1440 */}
        {canRecord && (
          <div className="flex justify-end">
            <RecordContactChooser customerId={customerId} summary={summary} />
          </div>
        )}
        <TimelineFilterChips chips={chips} value={filter} onChange={setFilter} counts={first?.counts} />
        {note && <p className="text-xs leading-snug text-muted-foreground">{note}</p>}
      </div>

      <QueryBoundary
        isLoading={query.isLoading || emptyWithCursor}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        errorTitle="โหลดการเดินทางของลูกค้าไม่สำเร็จ"
      >
        <EventTimeline
          events={items}
          emptyText={filter === ALL_CHIP ? 'ยังไม่มีกิจกรรม' : 'ยังไม่มีกิจกรรมในกลุ่มนี้'}
          renderExtra={(event) => {
            // Q18: ลิงก์ตาม canDelete — OWNER/ผจก.สาขา ทุกเวลา · ผจก.การเงิน/พนง.ขาย ของตัวเองภายใน 24 ชม.
            const entryId = event.entryId;
            if (!canRecord || !event.canDelete || !entryId) return null;
            return (
              <button
                type="button"
                className="text-xs leading-snug text-primary hover:underline"
                disabled={deleteEntry.isPending}
                onClick={() => deleteEntry.mutate(entryId)}
              >
                เลิกทำ
              </button>
            );
          }}
          footer={
            query.hasNextPage ? (
              <div className="flex justify-center pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="leading-snug"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
                </Button>
              </div>
            ) : null
          }
        />
      </QueryBoundary>

      {first && first.notRecorded.length > 0 && <NotRecordedList items={first.notRecorded} />}
    </div>
  );
}
```

- [ ] **Step 7: Pass `summary` and `canRecord` from the page**

In `apps/web/src/pages/CustomerDetailPage/index.tsx` replace

```tsx
                <JourneyTab customerId={customer.id} role={user?.role ?? ''} />
```

with

```tsx
                <JourneyTab
                  customerId={customer.id}
                  role={user?.role ?? ''}
                  summary={journeySummary}
                  canRecord={canRecord}
                />
```

(`journeySummary` is the existing `useJourneySummaryRedirect(...)` result declared before the early returns; `canRecord` is Task 11's `const canRecord = canRecordJourney(user?.role ?? '');`.)

- [ ] **Step 8: Run the new tests (UTC and machine TZ)**

Run:

```bash
cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx -t "แท็บการเดินทาง: บันทึกการติดต่อ"
cd apps/web && npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx -t "แท็บการเดินทาง: บันทึกการติดต่อ"
```

Expected: both runs `11 passed`.

- [ ] **Step 9: Run the whole customer-detail + shared journey web suites, typecheck and lint**

Run:

```bash
cd apps/web && TZ=UTC npx vitest run src/pages/CustomerDetailPage src/components/customer/journey src/hooks/customer-journey src/components/timeline
cd apps/web && npx tsc --noEmit
cd apps/web && npx eslint src/pages/CustomerDetailPage/components/RecordContactChooser.tsx src/pages/CustomerDetailPage/tabs/JourneyTab.tsx src/pages/CustomerDetailPage/index.tsx src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx
```

Expected: vitest all files passed (including every pre-existing `CustomerDetailPage.test.tsx` case — the new `vi.mock('@/hooks/useIsMobile')` defaults to `false`, same as jsdom's 1024px width); `tsc` exits 0 with no output; eslint reports 0 errors (0 new warnings on these four files).

- [ ] **Step 10: Rewrite spec bullets (ค) and (ง) for scope v2**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md` replace

```markdown
(ค) '+ บันทึกการติดต่อ' ในแท็บการเดินทาง (เฟส 3)
- เปิด bottom sheet บนมือถือ / popover บนเดสก์ท็อป
- แถว 1 ชิปช่องทาง: โทร · แชทในแอป FB · LINE · หน้าร้าน (จำค่าล่าสุดใน localStorage ห่อ try/catch)
- แถว 2 ชิปผล: นัดแล้ว · มาร้านแล้ว · ขอคิดก่อน · งบ/ดาวน์ไม่พอ · ไม่รับสาย · ซื้อที่อื่น · ไม่สนใจ
- แตะผล = บันทึกทันที (1 แตะถ้าช่องทางถูกอยู่แล้ว ไม่งั้น 2 แตะ) → toast 'บันทึกแล้ว · เลิกทำ' (soft delete ภายใน 24 ชม.)
- 'ซื้อที่อื่น' / 'ไม่สนใจ' ถามต่อแตะเดียว 'ติดป้ายหลุดไหม [ใช่]' (แตะที่ 3)
- 'เพิ่มโน้ต' พับไว้ (≤140 ตัว มีคำเตือนและ DTO ปฏิเสธเลขยาว) และ 'เปลี่ยนเวลา' (ย้อนได้ 7 วัน) เป็นทางเลือก

(ง) ปุ่ม 'ติดป้ายหลุด' / 'เปิดใหม่' บนแถบขั้น
- ไม่มีปุ่มเลื่อนขั้นด้วยมือ เพราะขั้นมาจากหลักฐานในระบบเท่านั้น
```

with

```markdown
(ค) 'บันทึกการติดต่อ' ในแท็บการเดินทาง (เฟส 3 — ไม่บังคับ, ขอบเขตรอบ 2 ข้อ 4)
- ปุ่ม outline เล็กอยู่แถวของตัวเอง ชิดขวา เหนือชิปกรอง (Q16) · มือถือเต็มกว้าง สูง 44px (Q17) · กดไม่ได้ระหว่างรอ summary · ฝ่ายบัญชีไม่เห็น (บทบาทที่บันทึกได้ = OWNER · ผจก.สาขา · ผจก.การเงิน · พนง.ขาย ตาม `@Roles` ของ POST)
- เปิด bottom sheet บนมือถือ (ต่ำกว่า 1024px) / popover กว้าง w-80 ชิดขวาปุ่มบนเดสก์ท็อป
- แถว 'ช่องทาง': โทร · แชทในแอป FB · LINE · หน้าร้าน — เลือกไว้จากค่าล่าสุดใน localStorage `customerJourney.lastChannel.v1` (ห่อ try/catch · ค่าที่ไม่ใช่ 4 ตัวนี้ถูกทิ้ง · เขียนหลังบันทึกสำเร็จเท่านั้น) · ยังไม่มีช่องทาง = ชิปผลกดไม่ได้ + คำใบ้ 'เลือกช่องทางก่อน'
- แถว 'ผล': นัดแล้ว · มาร้านแล้ว · ขอคิดก่อน · งบ/ดาวน์ไม่พอ · ไม่รับสาย · ซื้อที่อื่น · ไม่สนใจ (ขึ้น 3 แถวใน w-80 — Q19)
- แตะผล = บันทึกทันที เวลา = เวลาเซิร์ฟเวอร์ (1 แตะถ้าช่องทางถูกอยู่แล้ว ไม่งั้น 2 แตะ) · ชิปที่แตะหมุน ชิปอื่นล็อกกันแตะซ้ำ · สำเร็จ → ปิดตัวเลือก + toast 'บันทึกแล้ว · เลิกทำ' 10 วินาที · ไม่สำเร็จ → toast ข้อความจาก API ตัวเลือกยังเปิดพร้อมช่องทางที่เลือก
- 'ซื้อที่อื่น' / 'ไม่สนใจ' → บันทึกแล้วตัวเลือกยังเปิด เหลือบรรทัดเดียว 'ติดป้ายหลุดไหม [ใช่ ติดป้ายหลุด] [ไม่ต้อง]' — 'ใช่' = MARKED_LOST เหตุผลเดียวกับผล แล้ว toast 'ติดป้ายหลุดแล้ว · เลิกทำ' (แตะที่ 3) · ไม่ถามเมื่อคำตอบของเซิร์ฟเวอร์บอกว่าลูกค้าซื้อแล้ว · 'ไม่รับสาย' ไม่ถาม (Q3)
- ทุกการแตะใช้ clientRequestId ใหม่ (dedupe `MANUAL:<kind>:<id>`) — คำขอของ 'ใช่ ติดป้ายหลุด' จึงไม่ถูกรวมเข้ากับ TOUCHPOINT ที่เพิ่งบันทึก
- ไม่มีช่องโน้ต ไม่มีช่องเปลี่ยนเวลา ไม่มีปุ่ม 'บันทึก' (ตัดออกตามขอบเขตรอบ 2)
- ลิงก์ 'เลิกทำ' ท้ายแถวบันทึกมือขึ้นตาม `canDelete` ที่เซิร์ฟเวอร์ส่ง (Q18): OWNER/ผจก.สาขา ลบได้ทุกเวลา · ผจก.การเงิน/พนง.ขาย เฉพาะของตัวเองภายใน 24 ชม. (Q5) · แถวที่ระบบบันทึกเองไม่มีลิงก์ · ปุ่มใน toast และลิงก์ในแถวเรียกการลบตัวเดียวกัน กดได้แม้สลับไปแท็บอื่นแล้ว → toast 'เลิกทำแล้ว'

(ง) ปุ่ม 'ติดป้ายหลุด' / 'เปิดใหม่' บนแถบขั้น
- ไม่มีปุ่มเลื่อนขั้นด้วยมือ เพราะขั้นมาจากหลักฐานในระบบเท่านั้น
- ยังไม่หลุดและยังไม่ซื้อ: ghost 'ติดป้ายหลุด' → ตัวเลือก 'ติดป้ายหลุด — เพราะอะไร' 5 ชิป (ไม่สนใจ · ซื้อที่อื่น · เครดิตไม่ผ่าน · ติดต่อไม่ได้ · อื่น ๆ) แตะ = บันทึก (2 แตะ, Q2) ไม่มีโน้ต → toast 'ติดป้ายหลุดแล้ว · เลิกทำ'
- หลุดแล้ว: ป้าย 'หลุด · {เหตุผล}' + outline 'เปิดใหม่' แตะเดียวไม่มียืนยัน → toast 'เปิดใหม่แล้ว · เลิกทำ' (ถ้าเซิร์ฟเวอร์บอกว่าเปิดอยู่แล้ว = 'เปิดอยู่แล้ว' ไม่มีเลิกทำ) — ใช้ยามจำเป็น เพราะป้ายหลุดหายเองเมื่อลูกค้าทักกลับหรือมีเอกสารลูกค้าใหม่
- ซื้อแล้ว หรือบทบาทที่บันทึกไม่ได้: ไม่มีปุ่ม (ป้ายหลุด/เงียบยังแสดงตามเดิม) · มือถือกลุ่มปุ่มย้ายลงใต้ขั้น ชิดขวา สูง 44px
```

- [ ] **Step 11: Commit**

Run (from the worktree root):

```bash
git add apps/web/src/pages/CustomerDetailPage/components/RecordContactChooser.tsx apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx apps/web/src/pages/CustomerDetailPage/index.tsx apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx docs/superpowers/specs/2026-09-15-customer-journey-design.md
git commit -m "$(cat <<'EOF'
feat(customer-journey): ปุ่มบันทึกการติดต่อในแท็บการเดินทาง · ถามติดป้ายหลุดหลังซื้อที่อื่น/ไม่สนใจ · ลิงก์เลิกทำท้ายแถวตาม canDelete

- ช่องทาง + ผลเท่านั้น แตะผล = บันทึกทันที · จำช่องทางล่าสุด · popover เดสก์ท็อป / bottom sheet มือถือ
- toast บันทึกแล้ว · เลิกทำ 10 วินาที (ลบได้แม้แท็บ unmount) · clientRequestId ใหม่ทุกการแตะ
- ฝ่ายบัญชีไม่เห็นปุ่มใด ๆ · สเปก (ค)(ง) เขียนใหม่ตามขอบเขตรอบ 2

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit containing exactly those 5 files (`git show --stat HEAD` lists them and nothing else).

---

### Task 13: Heard-from ask (tap = save): journey banner + ContractCreate card + read-only first-contact line

**Goal:** walk-in customers are asked "ลูกค้ารู้จักร้านจากไหน" once, driven only by the API flag `askHeardFrom`, from the journey tab (banner) and from the ContractCreate "เลือกลูกค้า" step (card). Chat-first customers get the read-only line "ทักแชทครั้งแรกทาง {ช่องทาง}" in the selected row instead. Nothing writes `heard_from` automatically.

**Rulings covered:** brief §0 rulings 3, 12 (API flag shared by banner + card · one first-contact wording · referral gets nothing extra), 13 (canvas approved) · Q10/Q11 as amended by scope v2 · canvas Main (e), HeardFrom (c1)(c2)(c3) + summary table · outline D11, D12.

**Files:**
- Create: `apps/web/src/components/customer/journey/HeardFromAsk.tsx`
- Create: `apps/web/src/components/customer/journey/__tests__/HeardFromAsk.test.tsx`
- Modify: `apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx` — import block (`:1-11` at the base `10d6e6d3a`), state right after `const [filter, setFilter] = useState<string>(ALL_CHIP);` (`:58`), first child of the root `<div className="flex flex-col gap-3">` (`:88`). T10 and T12 shift these numbers — anchor on the quoted text, not on the number.
- Modify: `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` — one import after the `./journeyFixtures` import (`:12`), one new `describe` appended at the end of the file (after `:534` at HEAD; after T11/T12 additions).
- Modify: `apps/web/src/pages/ContractCreatePage/components/CustomerSelectStep.tsx` — `:1` (type import), `:7-20` (props), `:22-35` (destructure), after `:84` (selected-row line), after `:126` (slot).
- Modify: `apps/web/src/pages/ContractCreatePage/index.tsx` — imports after `:22`, new block after the `useOcrFlow({...})` call (`:64-68`), two props on `<CustomerSelectStep>` (`:131-144`).
- Create: `apps/web/src/pages/ContractCreatePage/components/__tests__/CustomerSelectStep.firstContact.test.tsx`
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md` — section (ข), the two bullets at `:423-424`.
- Test (must stay green, not edited): `apps/web/src/pages/ContractCreatePage/components/RestoredSelection.test.tsx`, `apps/web/src/pages/ContractCreatePage/ContractQuoteFlow.test.tsx`.
- Not touched: `apps/web/src/pages/ContractCreatePage/components/CustomerCreateModal.tsx`, `CustomerCreateDialog`, POS (Task 14).

**Interfaces:**

Consumes (exact names from the outline):
- T1 `@installment/shared`: `JOURNEY_HEARD_FROM_LABELS` (label per code), `type JourneyHeardFrom`, `firstChatContactTitle(firstChannel: string): string | null` (`'CHAT_FACEBOOK'` → `'ทักแชทครั้งแรกทาง Facebook'`, not `CHAT_` → `null`), `JourneyEntryCreatedResponse { entryId: string | null; event: JourneyEvent | null; summary: JourneySummary }`, `JourneyEntryDeletedResponse { summary: JourneySummary }`, `JourneyManualEntryInput` (`{ kind: 'HEARD_FROM'; heardFrom; clientRequestId? }`).
- T4 `JourneySummary.askHeardFrom: boolean` (API rule: `firstSource === 'WALK_IN' && heardFrom === null && purchaseCount < 2`), `JourneySummary.firstChannel: string`.
- T7 `POST /customers/:id/journey/entries` → 201 `JourneyEntryCreatedResponse`; T8 `DELETE /customers/:id/journey/entries/:entryId` → 200 `JourneyEntryDeletedResponse`.
- T10 `@/hooks/customer-journey/useCustomerJourney`: `useJourneySummary(customerId: string, enabled = true)` (key `['customer-journey-summary', id]`, returns `JourneySummary | JourneyRedirect`), `isJourneyRedirect(value)`.
- T10 `@/hooks/customer-journey/journeyEntries`: `useRecordJourneyEntry(customerId)` (useMutation; `mutateAsync(input: JourneyManualEntryInput): Promise<JourneyEntryCreatedResponse>`; its options `onSuccess` does `setQueryData(['customer-journey-summary', id], res.summary)` + invalidates `['customer-journey', id]`), `deleteJourneyEntry(queryClient: QueryClient, customerId: string, entryId: string): Promise<void>` (DELETE, `setQueryData` summary, invalidate list, `toast.success('เลิกทำแล้ว')`, `toast.error(getErrorMessage(err))`), `undoToastOptions(queryClient: QueryClient, customerId: string, entryId: string | null, onUndo?: () => void): JourneyUndoToastOptions` (`{ duration: JOURNEY_UNDO_TOAST_MS (10_000), action: { label: 'เลิกทำ', onClick: onUndo ?? deleteJourneyEntry(…) } }` — the one success-toast shape shared with T11/T12; this task defines no local duration constant).
- T10 `@/components/customer/journey/HeardFromChips` (named export — `import { HeardFromChips } from './HeardFromChips'`): `HeardFromChips { value: JourneyHeardFrom | null; onSelect: (code) => void; pendingCode?; disabled?; onSkip?: () => void; skipStyle: 'ghost-button' | 'text' }` — renders the heading `ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)`, a `ข้าม` button and the 9 `ChoiceChip`s.
- T10 `@/components/customer/journey/journeyStorage`: `isHeardFromSkipped(customerId: string): boolean`, `markHeardFromSkipped(customerId: string): void` (sessionStorage key `customerJourney.heardFromSkipped.v1:<id>`, try/catch inside).
- T12 `JourneyTab` props `{ customerId: string; role: string; summary: JourneySummary | null; canRecord: boolean }` and the record-contact row (`Button` named `บันทึกการติดต่อ`) as the first child of the `flex flex-col gap-1` group.

Produces:
- `apps/web/src/components/customer/journey/HeardFromAsk.tsx` — `export interface HeardFromAskProps { customerId: string; variant: 'banner' | 'card'; onSkip: () => void }` and `export default function HeardFromAsk(props: HeardFromAskProps)`. Root element carries `data-testid="heard-from-ask"` in every visible state.
  - Chips state: banner box `rounded-lg border border-primary/20 bg-primary/5 p-3` + `skipStyle="ghost-button"`; card box `mt-4 rounded-xl border border-border bg-card p-4` + `skipStyle="text"`.
  - Tap = POST `{ kind: 'HEARD_FROM', heardFrom, clientRequestId: uid() }` (one UUID per tap); tapped chip busy, all chips disabled; tap guard by ref.
  - 201 → local `answered = { entryId, code, linkLive: true }` and `toast.success('บันทึกแล้ว', { ...undoToastOptions(queryClient, customerId, entryId, () => void undo(entryId, true)), onAutoClose, onDismiss })` (= `{ duration: 10000, action: { label: 'เลิกทำ', onClick }, onAutoClose, onDismiss }`); collapsed line banner `flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-snug` / card `mt-4 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-snug`, content lucide `Check` `size-4 text-primary` + `ลูกค้าบอกว่ารู้จักร้านจาก` + `<span className="font-medium">{label}</span>` + muted `·` + `text-xs` button `เลิกทำ`.
  - Undo (link or toast action) → `deleteJourneyEntry` → chips again (summary from DELETE sets `askHeardFrom` true). The link path also `toast.dismiss(id)`.
  - Toast closes (`onAutoClose`/`onDismiss`) → banner renders nothing; card keeps the line without the link.
  - Error on POST → `toast.error(getErrorMessage(err))`, chips enabled again.
  - `askHeardFrom` is read inside the component from the summary query (see "Why the flag is read inside HeardFromAsk").
- `JourneyTab`: first child of the root = `canRecord && !heardFromSkipped` → `<HeardFromAsk key={customerId} customerId={customerId} variant="banner" onSkip={…} />` (ACCOUNTANT never sees it; askHeardFrom false → renders nothing).
- `CustomerSelectStepProps` gains `heardFromSlot?: ReactNode` (rendered between the active-contract banner and the credit box) and `firstContactLine?: string | null` (rendered only inside the selected row, under the phone line, `mt-1 text-xs leading-snug text-muted-foreground`).
- `ContractCreatePage` (`index.tsx`) calls `useJourneySummary(data.selectedCustomer?.id ?? '', data.step === 1 && !!data.selectedCustomer)`; `firstContactLine = firstChatContactTitle(summary.firstChannel)` (null while loading / redirect / error); `heardFromSlot = <HeardFromAsk key={id} variant="card">` unless that customer id was skipped on this page visit (`useState<ReadonlySet<string>>`). `canNext` is untouched.
- Spec (ข): walk-in only via `askHeardFrom`, host behaviour, read-only first-contact wording, no automatic write.

**Why the flag is read inside `HeardFromAsk` (implementer note):** `useRecordJourneyEntry`'s `onSuccess` writes the fresh summary (`askHeardFrom: false`) into the cache *before* `mutateAsync` resolves. If the host decided `summary.askHeardFrom && …`, React would unmount `HeardFromAsk` before it could render the collapsed "ลูกค้าบอกว่ารู้จักร้านจาก… · เลิกทำ" line. So hosts gate only on role / skip / selection and `HeardFromAsk` subscribes to the same `['customer-journey-summary', id]` query (no extra request — the page already holds it, `staleTime` 60s). Visible behaviour is exactly the outline's: the ask shows only when the API flag is true, and loading / redirect / error render nothing. The web never re-derives the walk-in rule.

**Why toast callbacks are plain closures (D12):** the undo action can be clicked after Radix `TabsContent` unmounted the journey tab. `undo` only uses `queryClient`, `customerId` and refs, and calls the plain `deleteJourneyEntry` helper, so the DELETE + cache update still happen; the `setState` calls become no-ops.

---

- [ ] **Step 1: Write the failing `HeardFromAsk` test**

Create `apps/web/src/components/customer/journey/__tests__/HeardFromAsk.test.tsx`:
```tsx
import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { journeySummary } from '@/pages/CustomerDetailPage/__tests__/journeyFixtures';
import HeardFromAsk from '../HeardFromAsk';

/**
 * 🔴 hook ของ vitest ห้าม return ค่า — คร่อมปีกกาเสมอ
 * api ถูก mock ระดับ HTTP (ไม่ mock hook ของ Task 10) — ทดสอบคู่กับ useRecordJourneyEntry / deleteJourneyEntry ตัวจริง
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  /** summary ปัจจุบันของ c1 — POST/DELETE เปลี่ยนค่านี้ ให้ GET ที่ refetch ได้ค่าเดียวกับคำตอบ */
  summary: null as unknown,
}));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, delete: mocks.del },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHIP_LABELS = ['โฆษณา FB', 'เพจ/โพสต์', 'TikTok', 'LINE', 'Google', 'เพื่อนแนะนำ', 'ผ่านหน้าร้าน', 'ลูกค้าเก่า', 'อื่น ๆ'];

type AskProps = ComponentProps<typeof HeardFromAsk>;
type SavedToast = {
  duration?: number;
  action?: { label: string; onClick: (event: unknown) => void };
  onAutoClose?: () => void;
  onDismiss?: () => void;
};

const walkIn = (over: Parameters<typeof journeySummary>[0] = {}) =>
  journeySummary({ firstChannel: 'WALK_IN', firstSource: 'WALK_IN', firstSourceLabel: 'หน้าร้าน', askHeardFrom: true, ...over });

function renderAsk(props: Partial<AskProps> = {}, options: { seed?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (options.seed !== false) client.setQueryData(['customer-journey-summary', 'c1'], mocks.summary);
  const onSkip = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <HeardFromAsk customerId="c1" variant="card" onSkip={onSkip} {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onSkip };
}

function savedToast(): SavedToast {
  const call = vi.mocked(toast.success).mock.calls.find(([title]) => title === 'บันทึกแล้ว');
  if (!call) throw new Error('ยังไม่มี toast "บันทึกแล้ว"');
  return call[1] as unknown as SavedToast;
}

async function answerFriend() {
  fireEvent.click(await screen.findByRole('button', { name: 'เพื่อนแนะนำ' }));
  await waitFor(() =>
    expect(screen.getByTestId('heard-from-ask')).toHaveTextContent('ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ'),
  );
}

beforeEach(() => {
  mocks.summary = walkIn();
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/customers/c1/journey/summary') return { data: mocks.summary };
    throw new Error(`unexpected GET ${url}`);
  });
  mocks.post.mockReset();
  mocks.post.mockImplementation(async (url: string, body: { heardFrom?: string }) => {
    if (url === '/customers/c1/journey/entries') {
      mocks.summary = walkIn({ askHeardFrom: false, heardFrom: body.heardFrom ?? null });
      return { data: { entryId: 'e-hf', event: null, summary: mocks.summary } };
    }
    throw new Error(`unexpected POST ${url}`);
  });
  mocks.del.mockReset();
  mocks.del.mockImplementation(async (url: string) => {
    if (url === '/customers/c1/journey/entries/e-hf') {
      mocks.summary = walkIn();
      return { data: { summary: mocks.summary } };
    }
    throw new Error(`unexpected DELETE ${url}`);
  });
  vi.mocked(toast.success).mockReset().mockReturnValue('toast-1');
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.dismiss).mockReset();
});

describe('HeardFromAsk', () => {
  it('ลูกค้าหน้าร้านที่ยังไม่ตอบ: ชิป 9 ตัว · แบนเนอร์พื้น primary/5 · การ์ดพื้น card', async () => {
    const banner = renderAsk({ variant: 'banner' });
    expect(await screen.findByTestId('heard-from-ask')).toHaveClass('rounded-lg', 'border-primary/20', 'bg-primary/5', 'p-3');
    for (const label of CHIP_LABELS) expect(screen.getByRole('button', { name: label })).toBeEnabled();
    banner.unmount();

    renderAsk({ variant: 'card' });
    expect(await screen.findByTestId('heard-from-ask')).toHaveClass('mt-4', 'rounded-xl', 'border-border', 'bg-card', 'p-4');
  });

  it('askHeardFrom = false · summary เป็น redirect · summary ยังโหลด → ไม่แสดงอะไร', async () => {
    mocks.summary = walkIn({ askHeardFrom: false, heardFrom: 'FRIEND' });
    const answeredView = renderAsk();
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    answeredView.unmount();

    mocks.summary = { redirectToCustomerId: 'c2' };
    const redirectView = renderAsk();
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    redirectView.unmount();

    mocks.get.mockImplementation(() => new Promise(() => {}));
    renderAsk({}, { seed: false });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/customers/c1/journey/summary'));
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
  });

  it('แตะชิป = POST HEARD_FROM พร้อม UUID → ยุบเป็นบรรทัด + ลิงก์เลิกทำ + toast 10 วินาที', async () => {
    renderAsk();
    await answerFriend();

    const [url, body] = mocks.post.mock.calls[0];
    expect(url).toBe('/customers/c1/journey/entries');
    expect(body).toEqual({ kind: 'HEARD_FROM', heardFrom: 'FRIEND', clientRequestId: expect.stringMatching(UUID_RE) });

    const line = screen.getByTestId('heard-from-ask');
    expect(line).toHaveClass('mt-4', 'flex', 'items-center', 'gap-2', 'rounded-xl', 'border-border', 'bg-card', 'px-4', 'py-3', 'text-sm', 'leading-snug');
    expect(screen.getByRole('button', { name: 'เลิกทำ' })).toHaveClass('text-xs');
    expect(screen.queryByRole('button', { name: 'โฆษณา FB' })).toBeNull();
    expect(savedToast()).toEqual(
      expect.objectContaining({
        duration: 10000,
        action: expect.objectContaining({ label: 'เลิกทำ' }),
        onAutoClose: expect.any(Function),
        onDismiss: expect.any(Function),
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('ระหว่างรอผล ชิปทุกตัวกดไม่ได้ และแตะซ้ำไม่ยิงซ้ำ', async () => {
    let finish!: () => void;
    mocks.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            mocks.summary = walkIn({ askHeardFrom: false, heardFrom: 'FRIEND' });
            resolve({ data: { entryId: 'e-hf', event: null, summary: mocks.summary } });
          };
        }),
    );
    renderAsk();
    const friend = await screen.findByRole('button', { name: 'เพื่อนแนะนำ' });
    const google = screen.getByRole('button', { name: 'Google' });

    fireEvent.click(friend);
    await waitFor(() => expect(google).toBeDisabled());
    expect(friend).toBeDisabled();
    fireEvent.click(google);
    fireEvent.click(friend);
    expect(mocks.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    expect(await screen.findByRole('button', { name: 'เลิกทำ' })).toBeInTheDocument();
  });

  it('ลิงก์ "เลิกทำ" ในการ์ด → DELETE รายการเดียวกัน · ปิด toast · กลับเป็นชิป', async () => {
    renderAsk();
    await answerFriend();

    fireEvent.click(screen.getByRole('button', { name: 'เลิกทำ' }));

    expect(await screen.findByRole('button', { name: 'เพื่อนแนะนำ' })).toBeEnabled();
    expect(mocks.del.mock.calls[0][0]).toBe('/customers/c1/journey/entries/e-hf');
    expect(toast.dismiss).toHaveBeenCalledWith('toast-1');
    expect(vi.mocked(toast.success).mock.calls.some(([title]) => title === 'เลิกทำแล้ว')).toBe(true);
    expect(screen.queryByText(/ลูกค้าบอกว่ารู้จักร้านจาก/)).toBeNull();
  });

  it('"เลิกทำ" จาก toast ลบรายการเดียวกัน โดยไม่สั่งปิด toast ซ้ำ', async () => {
    renderAsk();
    await answerFriend();

    await act(async () => {
      savedToast().action?.onClick({});
    });

    expect(await screen.findByRole('button', { name: 'เพื่อนแนะนำ' })).toBeInTheDocument();
    expect(mocks.del.mock.calls[0][0]).toBe('/customers/c1/journey/entries/e-hf');
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it('toast หมดเวลา: การ์ดคงบรรทัดไว้แต่ไม่มีลิงก์เลิกทำ', async () => {
    renderAsk();
    await answerFriend();

    act(() => {
      savedToast().onAutoClose?.();
    });

    expect(screen.getByTestId('heard-from-ask')).toHaveTextContent('ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ');
    expect(screen.queryByRole('button', { name: 'เลิกทำ' })).toBeNull();
  });

  it('toast หมดเวลา: แบนเนอร์หายไปทั้งแถบ', async () => {
    renderAsk({ variant: 'banner' });
    await answerFriend();
    expect(screen.getByTestId('heard-from-ask')).toHaveClass('rounded-lg', 'border-primary/20', 'bg-primary/5', 'px-3', 'py-2');

    act(() => {
      savedToast().onAutoClose?.();
    });

    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
  });

  it('"ข้าม" เรียก onSkip และไม่บันทึกอะไร', async () => {
    const { onSkip } = renderAsk();
    fireEvent.click(await screen.findByRole('button', { name: 'ข้าม' }));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('บันทึกไม่สำเร็จ → toast.error · ชิปกลับมากดได้ · ไม่มีบรรทัดยุบ', async () => {
    mocks.post.mockImplementation(() => Promise.reject(new Error('network')));
    renderAsk();
    fireEvent.click(await screen.findByRole('button', { name: 'เพื่อนแนะนำ' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('บันทึกไม่สำเร็จ'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'เพื่อนแนะนำ' })).toBeEnabled());
    expect(screen.queryByText(/ลูกค้าบอกว่ารู้จักร้านจาก/)).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run (from `apps/web`): `npx vitest run src/components/customer/journey/__tests__/HeardFromAsk.test.tsx`
Expected: FAIL `Test Files 1 failed (1)` · `Error: Failed to resolve import "../HeardFromAsk" from "src/components/customer/journey/__tests__/HeardFromAsk.test.tsx". Does the file exist?`

- [ ] **Step 3: Implement `HeardFromAsk`**

Create `apps/web/src/components/customer/journey/HeardFromAsk.tsx`:
```tsx
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { JOURNEY_HEARD_FROM_LABELS, type JourneyHeardFrom } from '@installment/shared';
import { deleteJourneyEntry, undoToastOptions, useRecordJourneyEntry } from '@/hooks/customer-journey/journeyEntries';
import { isJourneyRedirect, useJourneySummary } from '@/hooks/customer-journey/useCustomerJourney';
import { getErrorMessage } from '@/lib/api';
import { uid } from '@/utils/uid';
import { HeardFromChips } from './HeardFromChips';

const BOX_CLASS = {
  banner: 'rounded-lg border border-primary/20 bg-primary/5 p-3',
  card: 'mt-4 rounded-xl border border-border bg-card p-4',
} as const;

const LINE_CLASS = {
  banner: 'flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-snug',
  card: 'mt-4 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-snug',
} as const;

interface Answered {
  entryId: string;
  code: JourneyHeardFrom;
  /** ลิงก์ "เลิกทำ" ใช้ได้ตราบที่ toast "บันทึกแล้ว" ยังอยู่ */
  linkLive: boolean;
}

export interface HeardFromAskProps {
  customerId: string;
  /** banner = บนสุดของแท็บการเดินทาง · card = ขั้นเลือกลูกค้าของสร้างสัญญา */
  variant: 'banner' | 'card';
  onSkip: () => void;
}

/**
 * ถาม "ลูกค้ารู้จักร้านจากไหน" — แตะชิป = บันทึก HEARD_FROM ทันที (คำตัดสินเจ้าของ 2026-09-15 ข้อ 3, 12)
 * - แสดงเฉพาะเมื่อ API ตั้งธง askHeardFrom (ลูกค้าหน้าร้านที่ยังไม่ตอบ) — เว็บไม่คิดกติกาเอง ระบบไม่เดาคำตอบให้
 * - อ่านธงที่นี่ ไม่ใช่ที่ผู้วาง: onSuccess ของ POST เขียน askHeardFrom=false ลงแคชก่อนบรรทัดยุบจะได้วาด
 *   ถ้าผู้วางตัดสินจากธงเอง คอมโพเนนต์จะถูกถอดทิ้งก่อนแสดง "ลูกค้าบอกว่ารู้จักร้านจาก… · เลิกทำ"
 * - callback ของ toast ใช้แค่ ref + deleteJourneyEntry ⇒ กดเลิกทำหลังแท็บถูก unmount ก็ยังลบได้ (outline D12)
 */
export default function HeardFromAsk({ customerId, variant, onSkip }: HeardFromAskProps) {
  const queryClient = useQueryClient();
  const { data } = useJourneySummary(customerId);
  const record = useRecordJourneyEntry(customerId);
  const [pendingCode, setPendingCode] = useState<JourneyHeardFrom | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [undoing, setUndoing] = useState(false);
  const pendingRef = useRef(false);
  const undoingRef = useRef(false);
  const toastIdRef = useRef<string | number | undefined>(undefined);

  const asking = !!data && !isJourneyRedirect(data) && data.askHeardFrom;

  /** toast ปิด (หมดเวลา / กดปิด / ปัดทิ้ง): แบนเนอร์หาย · การ์ดคงบรรทัดแต่ถอดลิงก์ — ข้ามระหว่างกำลังเลิกทำ กันกระพริบ */
  function closeLink(entryId: string) {
    if (undoingRef.current) return;
    setAnswered((current) => {
      if (!current || current.entryId !== entryId) return current;
      return variant === 'banner' ? null : { ...current, linkLive: false };
    });
  }

  async function undo(entryId: string, fromToast: boolean) {
    if (undoingRef.current) return;
    undoingRef.current = true;
    setUndoing(true);
    // จากลิงก์ในการ์ด/แบนเนอร์: ปิด toast ด้วย ไม่ให้เหลือปุ่มเลิกทำที่ไม่มีอะไรให้ลบ · จาก toast: sonner ปิดเองแล้ว
    // mock ของเทสคืน undefined — ห้ามเรียก dismiss(undefined) เพราะ sonner จะปิด toast ทุกใบ
    if (!fromToast && toastIdRef.current !== undefined) toast.dismiss(toastIdRef.current);
    try {
      await deleteJourneyEntry(queryClient, customerId, entryId);
      // summary จาก DELETE ตั้ง askHeardFrom กลับเป็นจริง ⇒ ชิปกลับมา
      setAnswered((current) => (current?.entryId === entryId ? null : current));
    } catch {
      // deleteJourneyEntry แจ้ง toast.error เองแล้ว · คำตอบยังอยู่ ⇒ ถอดลิงก์ (แบนเนอร์หาย การ์ดคงบรรทัด)
      setAnswered((current) => {
        if (!current || current.entryId !== entryId) return current;
        return variant === 'banner' ? null : { ...current, linkLive: false };
      });
    } finally {
      undoingRef.current = false;
      setUndoing(false);
    }
  }

  async function save(code: JourneyHeardFrom) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingCode(code);
    try {
      // UUID ต่อการแตะหนึ่งครั้ง — กดซ้ำจากเครือข่ายช้า server dedupe ให้ (outline D8)
      const res = await record.mutateAsync({ kind: 'HEARD_FROM', heardFrom: code, clientRequestId: uid() });
      const entryId = res.entryId;
      if (entryId) {
        setAnswered({ entryId, code, linkLive: true });
        // toast ชุดกลาง (Task 10) — ลิงก์ "เลิกทำ" มีอายุเท่า toast (JOURNEY_UNDO_TOAST_MS) · onUndo ให้ undo() ถอดบรรทัดยุบด้วย
        toastIdRef.current = toast.success('บันทึกแล้ว', {
          ...undoToastOptions(queryClient, customerId, entryId, () => void undo(entryId, true)),
          onAutoClose: () => closeLink(entryId),
          onDismiss: () => closeLink(entryId),
        });
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      pendingRef.current = false;
      setPendingCode(null);
    }
  }

  if (answered) {
    return (
      <div data-testid="heard-from-ask" className={LINE_CLASS[variant]}>
        <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
          ลูกค้าบอกว่ารู้จักร้านจาก<span className="font-medium">{JOURNEY_HEARD_FROM_LABELS[answered.code]}</span>
        </span>
        {answered.linkLive && (
          <>
            <span className="text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              disabled={undoing}
              onClick={() => void undo(answered.entryId, false)}
              className="text-xs leading-snug text-primary hover:underline disabled:opacity-60"
            >
              เลิกทำ
            </button>
          </>
        )}
      </div>
    );
  }

  // ระหว่างรอผลคงชิปไว้ แม้แคชจะพลิก askHeardFrom เป็น false ไปก่อนแล้ว (กันกระพริบ)
  if (!asking && pendingCode === null) return null;

  return (
    <div data-testid="heard-from-ask" className={BOX_CLASS[variant]}>
      <HeardFromChips
        value={null}
        onSelect={(code) => {
          if (code) void save(code);
        }}
        pendingCode={pendingCode ?? undefined}
        disabled={pendingCode !== null}
        onSkip={onSkip}
        skipStyle={variant === 'banner' ? 'ghost-button' : 'text'}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test until it passes**

Run (from `apps/web`): `npx vitest run src/components/customer/journey/__tests__/HeardFromAsk.test.tsx`
Expected: PASS `Test Files 1 passed (1)` · `Tests 10 passed (10)`

Then the same with `TZ=UTC npx vitest run src/components/customer/journey/__tests__/HeardFromAsk.test.tsx` → PASS `Tests 10 passed (10)`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/customer/journey/HeardFromAsk.tsx apps/web/src/components/customer/journey/__tests__/HeardFromAsk.test.tsx
git commit -m "feat(customer-journey): HeardFromAsk ถามรู้จักร้านจากไหน แตะ = บันทึกทันที · ยุบเป็นบรรทัด + เลิกทำจน toast หาย

- แสดงตามธง askHeardFrom ของ API เท่านั้น อ่านธงในคอมโพเนนต์ (onSuccess เขียนธงลงแคชก่อนบรรทัดยุบวาด)
- UUID ต่อการแตะ · ระหว่างรอผลชิปทุกตัวกดไม่ได้
- เลิกทำจากลิงก์หรือ toast ใช้ deleteJourneyEntry ตัวเดียว (กดได้แม้แท็บถูก unmount)
- toast ปิด: แบนเนอร์หาย การ์ดคงบรรทัดแต่ไม่มีลิงก์

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing journey-tab banner tests**

In `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx`, add this import directly below the `import { journeyEvent, journeyPage, journeySummary, stageSteps } from './journeyFixtures';` line:
```tsx
import { isHeardFromSkipped } from '@/components/customer/journey/journeyStorage';
```

Append this block at the end of the file (after the last `describe`):
```tsx
describe('ถามรู้จักร้านจากไหน — แถบบนสุดของแท็บการเดินทาง (เฟส 3)', () => {
  const walkIn = (over: Parameters<typeof journeySummary>[0] = {}) =>
    journeySummary({ firstChannel: 'WALK_IN', firstSource: 'WALK_IN', firstSourceLabel: 'หน้าร้าน', askHeardFrom: true, ...over });
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const entryPosts = () => mocks.post.mock.calls.filter(([url]) => url === '/customers/c1/journey/entries');

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('OWNER + ลูกค้าหน้าร้านที่ยังไม่ตอบ: แถบอยู่บนสุด เหนือปุ่ม "บันทึกการติดต่อ"', async () => {
    mocks.summaries.c1 = walkIn();
    renderAt('/customers/c1?tab=journey');
    const banner = await screen.findByTestId('heard-from-ask');
    expect(within(banner).getByText('ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)')).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'เพื่อนแนะนำ' })).toBeInTheDocument();
    const record = screen.getByRole('button', { name: 'บันทึกการติดต่อ' });
    expect(banner.compareDocumentPosition(record) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('ฝ่ายบัญชีไม่เห็นแถบ แม้ API ส่ง askHeardFrom = true', async () => {
    mocks.role = 'ACCOUNTANT';
    mocks.summaries.c1 = walkIn();
    renderAt('/customers/c1?tab=journey');
    await screen.findByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
    expect(await screen.findByText('ยังไม่มีกิจกรรม')).toBeInTheDocument();
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    expect(screen.queryByRole('button', { name: 'เพื่อนแนะนำ' })).toBeNull();
  });

  it('ลูกค้าที่ทักแชทมาก่อน (askHeardFrom = false): ไม่มีแถบ', async () => {
    mocks.summaries.c1 = journeySummary({ firstChannel: 'CHAT_FACEBOOK', askHeardFrom: false });
    renderAt('/customers/c1?tab=journey');
    await screen.findByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
    expect(await screen.findByText('ยังไม่มีกิจกรรม')).toBeInTheDocument();
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
  });

  it('"ข้าม" ซ่อนทั้ง session · เปิดหน้าใหม่ยังไม่ขึ้น · ล้าง session แล้วขึ้นอีก', async () => {
    mocks.summaries.c1 = walkIn();
    const first = renderAt('/customers/c1?tab=journey');
    const banner = await screen.findByTestId('heard-from-ask');
    fireEvent.click(within(banner).getByRole('button', { name: 'ข้าม' }));
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    expect(isHeardFromSkipped('c1')).toBe(true);
    expect(entryPosts()).toHaveLength(0);
    first.unmount();

    const second = renderAt('/customers/c1?tab=journey');
    await screen.findByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    second.unmount();

    sessionStorage.clear();
    renderAt('/customers/c1?tab=journey');
    expect(await screen.findByTestId('heard-from-ask')).toBeInTheDocument();
  });

  it('แตะชิป = บันทึกทันที → แถบยุบเป็น "ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ · เลิกทำ"', async () => {
    mocks.summaries.c1 = walkIn();
    mocks.post.mockImplementation(async (url: string) => {
      if (url === '/customers/c1/journey/entries') {
        return { data: { entryId: 'e-hf', event: null, summary: walkIn({ askHeardFrom: false, heardFrom: 'FRIEND' }) } };
      }
      throw new Error(`unexpected POST ${url}`);
    });
    renderAt('/customers/c1?tab=journey');
    fireEvent.click(within(await screen.findByTestId('heard-from-ask')).getByRole('button', { name: 'เพื่อนแนะนำ' }));

    await waitFor(() =>
      expect(screen.getByTestId('heard-from-ask')).toHaveTextContent('ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ'),
    );
    expect(within(screen.getByTestId('heard-from-ask')).getByRole('button', { name: 'เลิกทำ' })).toBeInTheDocument();
    expect(entryPosts()).toHaveLength(1);
    expect(entryPosts()[0][1]).toEqual({ kind: 'HEARD_FROM', heardFrom: 'FRIEND', clientRequestId: expect.stringMatching(UUID_RE) });
  });
});
```

- [ ] **Step 7: Run it and watch the presence tests fail**

Run (from `apps/web`): `npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx -t "ถามรู้จักร้านจากไหน"`
Expected: FAIL `Tests 3 failed | 2 passed` (the rest of the file reported as skipped by `-t`) — the OWNER, "ข้าม" and "แตะชิป" tests fail with `Unable to find an element by: [data-testid="heard-from-ask"]`; the ACCOUNTANT and chat-first absence tests already pass.

- [ ] **Step 8: Mount the banner in `JourneyTab`**

In `apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx`:

(a) Add these imports directly below `import { Button } from '@/components/ui/button';`:
```tsx
import HeardFromAsk from '@/components/customer/journey/HeardFromAsk';
import { isHeardFromSkipped, markHeardFromSkipped } from '@/components/customer/journey/journeyStorage';
```

(b) Directly below `const [filter, setFilter] = useState<string>(ALL_CHIP);` add:
```tsx
  // แถบถามรู้จักร้านจากไหน: "ข้าม" = ซ่อนทั้ง session ต่อลูกค้า (sessionStorage)
  // ถือชุด id ในหน่วยความจำด้วย — storage เขียนไม่ได้ (โหมดส่วนตัว) แถบก็ยังหายทันที · ธง askHeardFrom อ่านใน HeardFromAsk
  const [heardFromSkippedIds, setHeardFromSkippedIds] = useState<ReadonlySet<string>>(() => new Set());
  const heardFromSkipped = heardFromSkippedIds.has(customerId) || isHeardFromSkipped(customerId);
```

(c) Replace the opening of the returned JSX
```tsx
  return (
    <div className="flex flex-col gap-3">
```
with
```tsx
  return (
    <div className="flex flex-col gap-3">
      {canRecord && !heardFromSkipped && (
        <HeardFromAsk
          key={customerId}
          customerId={customerId}
          variant="banner"
          onSkip={() => {
            markHeardFromSkipped(customerId);
            setHeardFromSkippedIds((ids) => new Set(ids).add(customerId));
          }}
        />
      )}
```
Everything after it (T12's record-contact row + filter chips group, `QueryBoundary`, `NotRecordedList`) stays as is, so the banner is the root's first child and sits above the record-button row. `canRecord` is the prop T12 added.

- [ ] **Step 9: Run the page tests until they pass**

Run (from `apps/web`): `npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx`
Expected: PASS `Test Files 1 passed (1)` · 0 failed — every test in the file, including the 5 new ones (with `-t "ถามรู้จักร้านจากไหน"` → `Tests 5 passed`, the rest skipped).

Then `TZ=UTC npx vitest run src/pages/CustomerDetailPage` → PASS all files in the folder.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx
git commit -m "feat(customer-journey): แถบถามรู้จักร้านจากไหนบนสุดของแท็บการเดินทาง (ลูกค้าหน้าร้าน)

- ขึ้นเมื่อ API ตั้งธง askHeardFrom และบทบาทบันทึกได้ — ฝ่ายบัญชีไม่เห็น ลูกค้าจากแชทไม่เห็น
- อยู่เหนือปุ่มบันทึกการติดต่อ · แตะชิป = บันทึกทันที แล้วยุบเป็นบรรทัด + เลิกทำ
- ข้าม = ซ่อนทั้ง session ต่อลูกค้า มาหน้าใหม่ครั้งหน้าขึ้นอีก

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 11: Write the failing ContractCreate tests (step unit + page wiring)**

Create `apps/web/src/pages/ContractCreatePage/components/__tests__/CustomerSelectStep.firstContact.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { journeySummary } from '@/pages/CustomerDetailPage/__tests__/journeyFixtures';
import ContractCreatePage from '../../index';
import type { Customer } from '../../types';
import { CustomerSelectStep, type CustomerSelectStepProps } from '../CustomerSelectStep';

/**
 * ขั้นเลือกลูกค้า (UI "ขั้นตอน 2", โค้ด step === 1) — บรรทัดช่องทางแรกของลูกค้าที่เลือก + การ์ดถามรู้จักร้านจากไหน
 * 🔴 hook ของ vitest ห้าม return ค่า · ข้อมูลลูกค้าในไฟล์นี้เป็นข้อมูลสังเคราะห์
 */
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn(), summary: null as unknown }));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, delete: mocks.del },
  getErrorMessage: () => 'ผิดพลาด',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'heard-staff', role: 'SALES' } }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@/components/trade-in/TradeInCreditPicker', () => ({ default: () => null }));

const FIRST_CONTACT = 'ทักแชทครั้งแรกทาง Facebook';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function person(over: Partial<Customer> = {}): Customer {
  return {
    id: 'a', name: 'ลูกค้าสังเคราะห์ ก', phone: '0800000001', nationalId: '1000000000001', salary: null,
    occupation: null, salaryPayDay: 31, activeContracts: 0, overdueContracts: 0, ...over,
  };
}

const rowOf = (name: string) => screen.getByText(name).closest('[class*="cursor-pointer"]') as HTMLElement;

function renderStep(over: Partial<CustomerSelectStepProps> = {}) {
  const props: CustomerSelectStepProps = {
    customers: [person(), person({ id: 'b', name: 'ลูกค้าสังเคราะห์ ข', phone: '0800000002', nationalId: '1000000000002' })],
    customerSearch: '', setCustomerSearch: vi.fn(), selectedCustomer: null, setSelectedCustomer: vi.fn(), onNext: vi.fn(),
    latestCreditCheck: null, customerCreditApproved: false, onOpenCredit: vi.fn(), onOpenCustomerModal: vi.fn(),
    overrideActiveContractCheck: false, setOverrideActiveContractCheck: vi.fn(), ...over,
  };
  return render(<CustomerSelectStep {...props} />);
}

describe('CustomerSelectStep — บรรทัดช่องทางแรก + ช่องการ์ด', () => {
  it('บรรทัด "ทักแชทครั้งแรกทาง Facebook" อยู่ในแถวที่เลือกเท่านั้น ใต้บรรทัดเบอร์', () => {
    const selected = person({ id: 'b', name: 'ลูกค้าสังเคราะห์ ข', phone: '0800000002', nationalId: '1000000000002' });
    renderStep({ selectedCustomer: selected, firstContactLine: FIRST_CONTACT });

    expect(screen.getAllByText(FIRST_CONTACT)).toHaveLength(1);
    const line = within(rowOf('ลูกค้าสังเคราะห์ ข')).getByText(FIRST_CONTACT);
    expect(line).toHaveClass('mt-1', 'text-xs', 'leading-snug', 'text-muted-foreground');
    const phone = within(rowOf('ลูกค้าสังเคราะห์ ข')).getByText('0800000002');
    expect(phone.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(rowOf('ลูกค้าสังเคราะห์ ก')).queryByText(FIRST_CONTACT)).toBeNull();
  });

  it('firstContactLine เป็น null → ไม่มีบรรทัดเพิ่ม', () => {
    renderStep({ selectedCustomer: person(), firstContactLine: null });
    expect(screen.queryByText(/ทักแชทครั้งแรกทาง/)).toBeNull();
  });

  it('ช่องการ์ดอยู่ระหว่างแถบเตือนสัญญาค้างกับกล่องเครดิต', () => {
    const blocked = person({ activeContracts: 1 });
    renderStep({ customers: [blocked], selectedCustomer: blocked, heardFromSlot: <div data-testid="heard-from-slot">การ์ด</div> });

    const banner = screen.getByText('ลูกค้ายังมีสัญญาที่กำลังผ่อนอยู่ 1 รายการ');
    const slot = screen.getByTestId('heard-from-slot');
    const credit = screen.getByText('สถานะเครดิต: ยังไม่ได้ตรวจ');
    expect(banner.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(credit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

const product = {
  id: 'product', branchId: 'branch', category: 'PHONE_NEW', name: 'Synthetic phone', brand: 'Test', model: 'One',
  status: 'IN_STOCK', installmentPrice: '10000', prices: [], branch: { id: 'branch', name: 'Test branch' },
};
const selected = person({ id: 'customer', name: 'ลูกค้าที่เลือกไว้', phone: '0800000009', nationalId: '1000000000009' });
const config = {
  interestRate: '0.01', minDownPaymentPct: '0.15', storeCommissionPct: '0.1', vatPct: '0.07',
  minInstallmentMonths: 6, maxInstallmentMonths: 12,
};
const approvedCredit = {
  id: 'check', status: 'APPROVED', checkType: 'FULL', aiScore: null,
  approvals: [{ id: 'approval', salaryPayDay: 31, approvedMonthlyPayment: '2000', supersededAt: null, usedByContractId: null }],
};
const walkIn = (over: Parameters<typeof journeySummary>[0] = {}) =>
  journeySummary({ firstChannel: 'WALK_IN', firstSource: 'WALK_IN', firstSourceLabel: 'หน้าร้าน', askHeardFrom: true, ...over });

function mountAtCustomerStep() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/contracts/create']}>
        <ContractCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContractCreatePage ขั้นเลือกลูกค้า — ถามรู้จักร้านจากไหน / ช่องทางแรก', () => {
  beforeEach(() => {
    localStorage.clear();
    // ร่างที่กู้คืนพาไปขั้นเลือกลูกค้าพร้อมลูกค้าที่เลือกไว้ (step = min(1, 2))
    localStorage.setItem('bestchoice-contract-draft:heard-staff', JSON.stringify({
      step: 1, productId: product.id, customerId: selected.id, downPayment: 0, totalMonths: 6, paymentDueDay: 31,
      notes: '', savedAt: new Date().toISOString(),
    }));
    mocks.summary = walkIn();
    mocks.get.mockReset();
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/products/product') return { data: product };
      if (url === '/customers/customer') return { data: selected };
      if (url === '/customers/customer/journey/summary') return { data: mocks.summary };
      if (url === '/customers/customer/credit-check/latest') return { data: approvedCredit };
      if (url.startsWith('/interest-configs') || url === '/sales/config') return { data: config };
      return { data: { data: [] } };
    });
    mocks.post.mockReset();
    mocks.post.mockImplementation(async (url: string, body: { heardFrom?: string }) => {
      if (url === '/customers/customer/journey/entries') {
        mocks.summary = walkIn({ askHeardFrom: false, heardFrom: body.heardFrom ?? null });
        return { data: { entryId: 'e-card', event: null, summary: mocks.summary } };
      }
      // ใบเสนอราคาใช้ขั้นตอน 3 — ขั้นนี้ให้ล้มเงียบ ๆ (quote เป็น undefined ไม่กระทบขั้นเลือกลูกค้า)
      if (url === '/contracts/quote') throw new Error('quote not used on the customer step');
      throw new Error(`unexpected POST ${url}`);
    });
  });

  it('ลูกค้าหน้าร้านที่ยังไม่ตอบ: การ์ดอยู่ระหว่างแถวลูกค้ากับกล่องเครดิต · แตะ = บันทึก · ปุ่มถัดไปไม่เปลี่ยน', async () => {
    mountAtCustomerStep();
    const next = await screen.findByRole('button', { name: 'ถัดไป' });
    await waitFor(() => expect(next).toBeEnabled());

    const card = await screen.findByTestId('heard-from-ask');
    expect(card).toHaveClass('mt-4', 'rounded-xl', 'border-border', 'bg-card', 'p-4');
    expect(rowOf('ลูกค้าที่เลือกไว้').compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(screen.getByText('สถานะเครดิต: ผ่าน')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/ทักแชทครั้งแรกทาง/)).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'เพื่อนแนะนำ' }));
    await waitFor(() =>
      expect(screen.getByTestId('heard-from-ask')).toHaveTextContent('ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ'),
    );
    const entryCall = mocks.post.mock.calls.find(([url]) => url === '/customers/customer/journey/entries');
    expect(entryCall?.[1]).toEqual({ kind: 'HEARD_FROM', heardFrom: 'FRIEND', clientRequestId: expect.stringMatching(UUID_RE) });
    expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeEnabled();
  });

  it('"ข้าม" ซ่อนการ์ดของลูกค้าคนนี้รอบนี้ ไม่ยิงบันทึก และปุ่มถัดไปยังกดได้', async () => {
    mountAtCustomerStep();
    const card = await screen.findByTestId('heard-from-ask');
    fireEvent.click(within(card).getByRole('button', { name: 'ข้าม' }));

    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    expect(mocks.post.mock.calls.some(([url]) => url === '/customers/customer/journey/entries')).toBe(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeEnabled());
  });

  it('ลูกค้าที่ทักแชทมาก่อน: ไม่มีการ์ดชิป · แถวที่เลือกบอก "ทักแชทครั้งแรกทาง Facebook"', async () => {
    mocks.summary = journeySummary({ firstChannel: 'CHAT_FACEBOOK', askHeardFrom: false });
    mountAtCustomerStep();

    const line = await screen.findByText(FIRST_CONTACT);
    expect(rowOf('ลูกค้าที่เลือกไว้')).toContainElement(line);
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    expect(screen.queryByRole('button', { name: 'เพื่อนแนะนำ' })).toBeNull();
  });

  it('ลูกค้าหน้าร้านที่ตอบแล้ว (askHeardFrom = false): ไม่แสดงอะไรเพิ่ม', async () => {
    mocks.summary = walkIn({ askHeardFrom: false, heardFrom: 'FRIEND' });
    mountAtCustomerStep();

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/customers/customer/journey/summary'));
    await screen.findByText('สถานะเครดิต: ผ่าน');
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    expect(screen.queryByText(/ทักแชทครั้งแรกทาง/)).toBeNull();
  });
});
```

- [ ] **Step 12: Run it and watch it fail**

Run (from `apps/web`): `npx vitest run src/pages/ContractCreatePage/components/__tests__/CustomerSelectStep.firstContact.test.tsx`
Expected: FAIL `Tests 5 failed | 2 passed (7)`:
- `บรรทัด "ทักแชทครั้งแรกทาง Facebook" อยู่ในแถวที่เลือกเท่านั้น…` → `Unable to find an element with the text: ทักแชทครั้งแรกทาง Facebook`
- `ช่องการ์ดอยู่ระหว่างแถบเตือนสัญญาค้างกับกล่องเครดิต` → `Unable to find an element by: [data-testid="heard-from-slot"]`
- the walk-in, "ข้าม" and chat-first page tests → `Unable to find an element by: [data-testid="heard-from-ask"]` / `Unable to find an element with the text: ทักแชทครั้งแรกทาง Facebook`
- `firstContactLine เป็น null…` and `…ที่ตอบแล้ว…` already pass (absence).

- [ ] **Step 13: Add the two optional props to `CustomerSelectStep`**

In `apps/web/src/pages/ContractCreatePage/components/CustomerSelectStep.tsx`:

(a) Add as the first line of the file (above `import { AlertTriangle } from 'lucide-react';`):
```tsx
import type { ReactNode } from 'react';
```

(b) In `export interface CustomerSelectStepProps`, below `setOverrideActiveContractCheck: (v: boolean) => void;` add:
```tsx
  /** การ์ด "ลูกค้ารู้จักร้านจากไหน" ของลูกค้าที่เลือก (index.tsx สร้าง) — วางระหว่างแถบเตือนสัญญาค้างกับกล่องเครดิต */
  heardFromSlot?: ReactNode;
  /** "ทักแชทครั้งแรกทาง …" ของลูกค้าที่เลือก (อ่านอย่างเดียว ไม่เขียน heardFrom) — แสดงเฉพาะในแถวที่เลือก */
  firstContactLine?: string | null;
```

(c) In the destructured parameter list, below `setOverrideActiveContractCheck,` add:
```tsx
  heardFromSlot,
  firstContactLine,
```

(d) Replace the phone line inside the row
```tsx
                  <div className="mt-1 text-xs text-muted-foreground"><ProspectPhoneLine phone={c.phone} chatPlaceholder={c.chatPlaceholder} /></div>
```
with
```tsx
                  <div className="mt-1 text-xs text-muted-foreground"><ProspectPhoneLine phone={c.phone} chatPlaceholder={c.chatPlaceholder} /></div>
                  {selectedCustomer?.id === c.id && firstContactLine && (
                    <div className="mt-1 text-xs leading-snug text-muted-foreground">{firstContactLine}</div>
                  )}
```

(e) Replace the start of the credit block
```tsx
      {/* Credit check status for selected customer */}
```
with
```tsx
      {/* การ์ด "ลูกค้ารู้จักร้านจากไหน" (index.tsx ส่งมา) — หลังแถบเตือนสัญญาค้าง ก่อนกล่องเครดิต */}
      {heardFromSlot}

      {/* Credit check status for selected customer */}
```

Run (from `apps/web`): `npx vitest run src/pages/ContractCreatePage/components/__tests__/CustomerSelectStep.firstContact.test.tsx`
Expected: still FAIL `Tests 3 failed | 4 passed (7)` — the 3 step unit tests pass; the walk-in, "ข้าม" and chat-first page tests still fail with `Unable to find an element by: [data-testid="heard-from-ask"]` / `Unable to find an element with the text: ทักแชทครั้งแรกทาง Facebook` (index.tsx does not pass the props yet).

- [ ] **Step 14: Wire the summary, the card and the first-contact line in `ContractCreatePage`**

In `apps/web/src/pages/ContractCreatePage/index.tsx`:

(a) Below `import { contractCreditIssue } from './credit-approval';` add:
```tsx
import { firstChatContactTitle } from '@installment/shared';
import HeardFromAsk from '@/components/customer/journey/HeardFromAsk';
import { isJourneyRedirect, useJourneySummary } from '@/hooks/customer-journey/useCustomerJourney';
```

(b) Directly below the `useOcrFlow` call
```tsx
  const ocrFlow = useOcrFlow({
    setSelectedCustomer: data.setSelectedCustomer,
    setCustForm: data.setCustForm,
    setCustAddrIdCard: data.setCustAddrIdCard,
  });
```
add:
```tsx
  // ขั้นเลือกลูกค้า (เฟส 3): summary ของลูกค้าที่เลือก — ยิงเฉพาะตอนอยู่ขั้นนี้
  // · ลูกค้าจากแชท → บรรทัดอ่านอย่างเดียว "ทักแชทครั้งแรกทาง …" (ถ้อยคำเดียวกับแถวไทม์ไลน์)
  // · ลูกค้าหน้าร้านที่ API ตั้งธง askHeardFrom → การ์ดถาม (HeardFromAsk อ่านธงเอง) · "ข้าม" = ซ่อนของคนนั้นรอบนี้
  // · ระหว่างโหลด / redirect / error ไม่แสดงอะไร · ไม่แตะ canNext
  const selectedCustomerId = data.selectedCustomer?.id ?? '';
  const journeySummaryQuery = useJourneySummary(selectedCustomerId, data.step === 1 && !!data.selectedCustomer);
  const selectedJourney =
    journeySummaryQuery.data && !isJourneyRedirect(journeySummaryQuery.data) ? journeySummaryQuery.data : null;
  const firstContactLine = selectedJourney ? firstChatContactTitle(selectedJourney.firstChannel) : null;
  const [heardFromSkippedIds, setHeardFromSkippedIds] = useState<ReadonlySet<string>>(() => new Set());
  const heardFromSlot =
    selectedCustomerId && !heardFromSkippedIds.has(selectedCustomerId) ? (
      <HeardFromAsk
        key={selectedCustomerId}
        customerId={selectedCustomerId}
        variant="card"
        onSkip={() => setHeardFromSkippedIds((ids) => new Set(ids).add(selectedCustomerId))}
      />
    ) : null;
```

(c) In the `<CustomerSelectStep …>` element, below `setOverrideActiveContractCheck={data.setOverrideActiveContractCheck}` add:
```tsx
          heardFromSlot={heardFromSlot}
          firstContactLine={firstContactLine}
```

`canNext`, `goToStep`, `CustomerCreateModal` and the step-2 block are unchanged.

- [ ] **Step 15: Run the ContractCreate tests until they pass (new + untouched)**

Run (from `apps/web`):
`npx vitest run src/pages/ContractCreatePage/components/__tests__/CustomerSelectStep.firstContact.test.tsx src/pages/ContractCreatePage/components/RestoredSelection.test.tsx src/pages/ContractCreatePage/ContractQuoteFlow.test.tsx`
Expected: PASS `Test Files 3 passed (3)` — `CustomerSelectStep.firstContact.test.tsx` `7 passed`, `RestoredSelection.test.tsx` `2 passed` (renders the step without a QueryClientProvider — the new props are optional and the step has no query), `ContractQuoteFlow.test.tsx` `3 passed` (draft restores at step 2 ⇒ the summary query is disabled and the card is never mounted).

Then `TZ=UTC npx vitest run src/pages/ContractCreatePage` → PASS all files in the folder.

- [ ] **Step 16: Commit**

```bash
git add apps/web/src/pages/ContractCreatePage/index.tsx apps/web/src/pages/ContractCreatePage/components/CustomerSelectStep.tsx apps/web/src/pages/ContractCreatePage/components/__tests__/CustomerSelectStep.firstContact.test.tsx
git commit -m "feat(contracts): ขั้นเลือกลูกค้า — การ์ดถามรู้จักร้านจากไหน (ลูกค้าหน้าร้าน) + บรรทัด \"ทักแชทครั้งแรกทาง …\" (ลูกค้าจากแชท)

- index.tsx ยิง summary ของลูกค้าที่เลือกเฉพาะขั้นเลือกลูกค้า · การ์ดใช้ธง askHeardFrom ตัวเดียวกับแท็บการเดินทาง
- การ์ดอยู่ระหว่างแถบเตือนสัญญาค้างกับกล่องเครดิต · ข้าม = ซ่อนของคนนั้นรอบนี้ · ไม่แตะปุ่มถัดไป
- บรรทัดช่องทางแรกอยู่เฉพาะในแถวที่เลือก อ่านอย่างเดียว ไม่เขียน heardFrom
- CustomerSelectStep ยังเป็น presentational (props ใหม่ไม่บังคับ) · CustomerCreateModal ไม่แตะ

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 17: Rewrite spec section (ข)**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md`, section `(ข) ชิป 'รู้จักร้านจากไหน' (เฟส 3, แตะเดียว)`, replace exactly these two bullets:
```
- แสดงเฉพาะเมื่อ state.heardFrom ว่าง ข้ามได้
- ในแท็บการเดินทางแสดงเป็นแถบบนสุดจนกว่าจะตอบ
```
with:
```
- ถามเฉพาะลูกค้าหน้าร้าน (คำตัดสินเจ้าของ 2026-09-15 ข้อ 3, 12): API คิดธง `askHeardFrom` ครั้งเดียวในสรุปการเดินทาง = firstSource `WALK_IN` · heardFrom ว่าง · ซื้อไม่ถึง 2 ครั้ง (คนที่ซื้อครั้งแรกยังถาม) — แถบในแท็บการเดินทางกับการ์ดในหน้าสร้างสัญญาอ่านธงตัวเดียวกัน เว็บไม่คิดเงื่อนไขซ้ำ
- แท็บการเดินทาง: แถบบนสุด เหนือปุ่ม "บันทึกการติดต่อ" เฉพาะบทบาทที่บันทึกได้ (ฝ่ายบัญชีไม่เห็น) · แตะชิป = บันทึกทันที → แถบยุบเป็น "ลูกค้าบอกว่ารู้จักร้านจาก{x} · เลิกทำ" จน toast 'บันทึกแล้ว · เลิกทำ' (10 วินาที) ปิด แล้วหาย · "ข้าม" = ซ่อนทั้ง session ต่อลูกค้า (sessionStorage) เปิดครั้งหน้าขึ้นอีกจนกว่าจะตอบ
- ขั้นเลือกลูกค้าของ ContractCreatePage: การ์ดของลูกค้าที่เลือก ระหว่างแถบเตือนสัญญาค้างกับกล่องเครดิต เมื่อธงเป็นจริง (รวมลูกค้าใหม่จาก CustomerCreateModal ซึ่งไม่แตะ) · แตะชิป = บันทึกทันที → การ์ดยุบเป็นบรรทัดเดียว ลิงก์ "เลิกทำ" ใช้ได้จน toast หาย แล้วคงบรรทัดไว้ · "ข้าม" = ซ่อนการ์ดของลูกค้าคนนั้นรอบนี้ · ระหว่างรอผลไม่แสดงอะไร · ไม่แตะเงื่อนไขปุ่ม "ถัดไป"
- ลูกค้าที่ทักแชทมาก่อน (รวมคนที่มาจากโฆษณา) ไม่มีชิปและไม่มีแถบ: ขั้นเลือกลูกค้าแสดงบรรทัดอ่านอย่างเดียว "ทักแชทครั้งแรกทาง {ช่องทาง}" ใต้เบอร์ในแถวที่เลือก — ถ้อยคำเดียวกับแถวไทม์ไลน์ (`firstChatContactTitle`) ใช้คำเดียวทุกที่ · ลูกค้าที่มีคนแนะนำไม่แสดงอะไรเพิ่ม (ช่อง "ที่มา" แสดงอยู่แล้ว)
- ระบบไม่เขียน heardFrom ให้เองในทุกกรณี และไม่เก็บย้อนหลังของลูกค้าเก่า
```
Leave the host-list bullet above and the "บันทึกเป็น entry HEARD_FROM …" / "ห้ามแก้ acquisitionSource" bullets below untouched (Task 14 extends the dialog hosts).

```bash
git add docs/superpowers/specs/2026-09-15-customer-journey-design.md
git commit -m "docs(spec): (ข) ถามรู้จักร้านจากไหนเฉพาะลูกค้าหน้าร้านด้วยธง askHeardFrom · ลูกค้าจากแชทเห็นช่องทางแรกแบบอ่านอย่างเดียว · ระบบไม่เขียนเอง

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 18: Verify the whole slice (types · lint · both time zones · full web suite)**

Run from the worktree root:
- `./tools/check-types.sh web` → Expected: `Web: OK`

Run from `apps/web` (the flat ESLint config lives in `apps/web/eslint.config.mjs`; there is no root config):
- `npx eslint src/components/customer/journey/HeardFromAsk.tsx src/components/customer/journey/__tests__/HeardFromAsk.test.tsx src/pages/CustomerDetailPage/tabs/JourneyTab.tsx src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx src/pages/ContractCreatePage/index.tsx src/pages/ContractCreatePage/components/CustomerSelectStep.tsx src/pages/ContractCreatePage/components/__tests__/CustomerSelectStep.firstContact.test.tsx` → Expected: exit 0, no errors (do not add `--fix`).
- `TZ=UTC npx vitest run src/components/customer src/pages/CustomerDetailPage src/pages/ContractCreatePage` → Expected: PASS, 0 failed
- `npx vitest run src/components/customer src/pages/CustomerDetailPage src/pages/ContractCreatePage` → Expected: PASS, 0 failed (local Asia/Bangkok)
- `npx vitest run` → Expected: PASS `Test Files … passed` with 0 failed (the whole web suite once; nothing outside this slice imports the changed files except through the moved hooks from Task 10).

---

### Task 14: Heard-from chained after create: CustomerCreateDialog + POS quick-create

**Files:**
- Modify: `apps/web/src/components/customer/CustomerCreateDialog.tsx` — imports `:14-16`, props interface end `:98-100`, `CustomerCreateForm` signature `:118-119`, state `:129`, `mutationFn` signature `:149`, fill-branch return `:160`, create-branch return + `onSuccess` + `onError` signature `:197-209`, form `onSubmit` `:400`, end of the "ข้อมูลหลัก" card `:618-623` (line numbers at HEAD — no earlier task touches this file; anchor by the quoted text anyway)
- Modify: `apps/web/src/components/customer/CustomerCreateDialog.test.tsx` — imports `:1-2`, mocks `:12`, component import `:15`, new `describe` appended after the last line `:252`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx` — create-mode `<CustomerCreateDialog>` `:756-763` (one new prop)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx` — dialog mock `:24-26`, create test `:88-89`
- Modify: `apps/web/src/pages/CustomersPage/index.tsx` — `<CustomerCreateDialog>` `:364-376` (one new prop)
- Modify: `apps/web/src/pages/CustomersPage/__tests__/CustomersPage.test.tsx` — `?new=1` test `:389-395` (+ one new test right after it, same `describe('URL state')`)
- Modify: `apps/web/src/pages/POSPage/components/CustomerSearch.tsx` — whole file `:1-239` replaced
- Create: `apps/web/src/pages/POSPage/components/CustomerSearch.test.tsx`
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md` — section "บันทึกด้วยมือ (เฟส 3)", sub-section (ข), the last two bullets (`:425-426` at HEAD; Task 13 rewrites the bullets above them and explicitly leaves these two untouched)

**Interfaces:**

Consumes (must already exist — Step 1 verifies):
- Task 1 (`@installment/shared`): `export type JourneyHeardFrom = (typeof JOURNEY_HEARD_FROM_CODES)[number]` where `JOURNEY_HEARD_FROM_CODES = ['FB_AD','FB_PAGE','TIKTOK','LINE','GOOGLE','FRIEND','WALK_BY','OLD_CUSTOMER','OTHER'] as const`; labels `JOURNEY_HEARD_FROM_LABELS` (FRIEND = `เพื่อนแนะนำ`, WALK_BY = `ผ่านหน้าร้าน`, OLD_CUSTOMER = `ลูกค้าเก่า`, TIKTOK = `TikTok`, LINE = `LINE`).
- Task 7 (API): `POST /customers/:id/journey/entries` accepts `{ kind: 'HEARD_FROM', heardFrom: JourneyHeardFrom, clientRequestId?: string }` for OWNER / BRANCH_MANAGER / FINANCE_MANAGER / SALES → 201 `JourneyEntryCreatedResponse`.
- Task 10:
  - `@/hooks/customer-journey/journeyEntries` — `export async function postHeardFrom(customerId: string, code: JourneyHeardFrom): Promise<boolean>` — `api.post('/customers/${customerId}/journey/entries', { kind: 'HEARD_FROM', heardFrom: code, clientRequestId: uid() })` with exactly two arguments; resolves `true` = failed, `false` = saved; never throws, never toasts, does not touch the query cache.
  - `@/components/customer/journey/HeardFromChips` — named export `HeardFromChips(props: HeardFromChipsProps)`, `HeardFromChipsProps { value: JourneyHeardFrom | null; onSelect: (code: JourneyHeardFrom) => void; pendingCode?: JourneyHeardFrom | null; disabled?: boolean; onSkip?: () => void; skipStyle: 'ghost-button' | 'text' }`. DOM: `<div role="group" aria-label="ลูกค้ารู้จักร้านจากไหน">` → heading `ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)` + (only with `onSkip`) `skipStyle="text"` → `<button type="button">ข้าม</button>` (disabled only while `pendingCode` is set) + 9 `ChoiceChip` `<button type="button" aria-pressed>` in code order, `disabled` when `disabled || pendingCode`. `onSelect` always receives the tapped code — **the host toggles off itself**.

Produces:
- `CustomerCreateDialogProps.linkedToChat?: boolean` — jsdoc: opened from a chat room (RoomDossier "บันทึกและผูกกับแชท", `/customers?new=1&fromRoomId=…`), the first channel is already known ⇒ no heard-from chips.
- Module-local in `CustomerCreateDialog.tsx`: `type CreateVariables = CustomerFormData & { heardFrom: JourneyHeardFrom | null }`; `interface CreateResult { data: CreatedCustomer; heardFromFailed: boolean }`. Inside `CustomerCreateForm`: `const askHeardFrom = !isFill && !linkedToChat;` and `const [heardFrom, setHeardFrom] = useState<JourneyHeardFrom | null>(null);` (not in `customerSchema`). `createMutation`: `useMutation` with variables `CreateVariables`, data `CreateResult`; fill branch returns `{ data, heardFromFailed: false }` (same request, same toasts, same `onFilled`); create branch awaits `postHeardFrom(created.data.id, chosenHeardFrom)` only when a chip was chosen; `onSuccess` (create) = `toast.success('เพิ่มลูกค้าสำเร็จ')` → if failed `toast.warning('บันทึกลูกค้าแล้ว แต่บันทึกช่องทางที่รู้จักไม่สำเร็จ')` → `onCreated(res.data)` → `onClose()`. 409 path unchanged.
- Chips block `<div className="mt-4 border-t border-border pt-4"><HeardFromChips … skipStyle="text" /></div>` as the last child of the "ข้อมูลหลัก" card, rendered only when `askHeardFrom`.
- `RoomDossier` create dialog passes `linkedToChat`; `CustomersPage` passes `linkedToChat={!!linkAfterCreate}`; the fill dialogs (RoomDossier fill, DetailHeader) pass nothing.
- POS `CustomerSearch` (default export, props unchanged): module-local `interface QuickCreatedCustomer { id: string; name: string; phone: string; nationalId?: string | null }` and `interface QuickCreateInput { name: string; phone: string; heardFrom: JourneyHeardFrom | null }`; state `newHeardFrom: JourneyHeardFrom | null` reset in `openCreate` and after success, kept on error; `mutationFn: async ({ heardFrom, ...input }: QuickCreateInput) => { created; heardFromFailed }`; `onSuccess` = `toast.success('เพิ่มลูกค้าใหม่สำเร็จ')` → optional same warning → existing invalidate/select/close.
- Spec (ข): create-flow bullets.

---

- [ ] **Step 1: Verify the Task 1 / 7 / 10 prerequisites are in the tree**

Run (from the worktree root):

```bash
grep -n "^export" apps/web/src/components/customer/journey/HeardFromChips.tsx apps/web/src/hooks/customer-journey/journeyEntries.ts
grep -n 'role="group" aria-label="ลูกค้ารู้จักร้านจากไหน"\|skipStyle' apps/web/src/components/customer/journey/HeardFromChips.tsx
grep -n "export const JOURNEY_HEARD_FROM_CODES\|export type JourneyHeardFrom" packages/shared/src/customer-journey.ts
grep -n "journey/entries" apps/api/src/modules/customer-journey/customer-journey.controller.ts
```

Expected:
- first command lists `export interface HeardFromChipsProps`, `export function HeardFromChips(`, and in `journeyEntries.ts` `export async function postHeardFrom(customerId: string, code: JourneyHeardFrom): Promise<boolean>` (plus the other Task 10 exports);
- second shows the `role="group" aria-label="ลูกค้ารู้จักร้านจากไหน"` wrapper and `skipStyle: 'ghost-button' | 'text';`;
- third shows both shared exports;
- fourth shows `@Post(':id/journey/entries')`.

Stop and finish Tasks 1/7/10 first if any line is missing.

- [ ] **Step 2: Write the failing CustomerCreateDialog tests**

In `apps/web/src/components/customer/CustomerCreateDialog.test.tsx`:

(a) Replace

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
```

with

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
```

(b) Replace

```tsx
vi.mock('@/lib/cardReader', () => ({ checkCardReaderStatus: vi.fn(), readSmartCard: vi.fn() }));
```

with

```tsx
vi.mock('@/lib/cardReader', () => ({ checkCardReaderStatus: vi.fn(), readSmartCard: vi.fn() }));
/* toast ถูก mock เพื่อเช็คลำดับ "สำเร็จ" ก่อน "เตือน" (invocationCallOrder) — เทสเดิมไม่อ่าน toast จึงไม่กระทบ */
const toastMock = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
```

(c) Replace

```tsx
import CustomerCreateDialog, { splitDisplayName } from './CustomerCreateDialog';
```

with

```tsx
import CustomerCreateDialog, { splitDisplayName, type CustomerCreateDialogProps } from './CustomerCreateDialog';
```

(d) Replace the end of the file

```tsx
    expect(alert).not.toHaveTextContent('0899999999');
  });

});
```

with

```tsx
    expect(alert).not.toHaveTextContent('0899999999');
  });

});

describe('CustomerCreateDialog — ชิป "ลูกค้ารู้จักร้านจากไหน" (ลูกค้าหน้าร้าน · เฟส 3)', () => {
  /** ลำดับตามบอร์ด HeardFrom (a) = JOURNEY_HEARD_FROM_CODES — ปักตัวอักษรจริง */
  const HEARD_FROM_LABELS = ['โฆษณา FB', 'เพจ/โพสต์', 'TikTok', 'LINE', 'Google', 'เพื่อนแนะนำ', 'ผ่านหน้าร้าน', 'ลูกค้าเก่า', 'อื่น ๆ'];
  const WARNING = 'บันทึกลูกค้าแล้ว แต่บันทึกช่องทางที่รู้จักไม่สำเร็จ';
  const CREATED = { id: 'c-new', name: 'ทดสอบ หน้าร้าน' };
  const GROUP_NAME = 'ลูกค้ารู้จักร้านจากไหน';

  const heardFromGroup = () => screen.getByRole('group', { name: GROUP_NAME });
  const chip = (label: string) => within(heardFromGroup()).getByRole('button', { name: label });
  const renderCreate = (props: Partial<CustomerCreateDialogProps> = {}) => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    wrap(
      <CustomerCreateDialog
        open
        onOpenChange={onOpenChange}
        initialValues={{ firstName: 'ทดสอบ', lastName: 'หน้าร้าน' }}
        onCreated={onCreated}
        {...props}
      />,
    );
    return { onCreated, onOpenChange };
  };

  // ห้ามคืนค่า mock ออกจาก hook — คร่อมปีกกาเสมอ
  beforeEach(() => {
    apiPost.mockReset();
    toastMock.success.mockReset();
    toastMock.warning.mockReset();
    toastMock.error.mockReset();
  });

  it('โหมดสร้าง: ชิป 9 ตัวตามลำดับ · แตะชิปไม่ส่งฟอร์ม · แตะซ้ำ = ยกเลิก · "ข้าม" ล้างที่เลือก', async () => {
    renderCreate();
    const chips = within(heardFromGroup()).getAllByRole('button', { pressed: false });
    expect(chips.map((button) => button.textContent)).toEqual(HEARD_FROM_LABELS);
    // ชิปอยู่ใน <form> — ปุ่มที่ไม่ใช่ type="button" จะส่งฟอร์มทันทีที่แตะ
    for (const button of chips) expect(button).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'ข้าม' })).toHaveAttribute('type', 'button');

    fillRequired();
    fireEvent.click(chip('เพื่อนแนะนำ'));
    expect(chip('เพื่อนแนะนำ')).toHaveAttribute('aria-pressed', 'true');
    // ให้ handleSubmit (async) มีเวลาทำงานถ้าเผลอส่งฟอร์ม — ต้องไม่มีการยิง API
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiPost).not.toHaveBeenCalled();

    fireEvent.click(chip('เพื่อนแนะนำ'));
    expect(chip('เพื่อนแนะนำ')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(chip('LINE'));
    expect(chip('LINE')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'ข้าม' }));
    expect(within(heardFromGroup()).queryAllByRole('button', { pressed: true })).toHaveLength(0);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('เลือกชิปแล้วบันทึก → POST /customers (ไม่มี heardFrom) ก่อน แล้ว POST journey/entries ไปที่ id ใหม่ · รอให้เสร็จก่อนเรียก onCreated', async () => {
    apiPost.mockImplementation((url: string) =>
      Promise.resolve(url === '/customers' ? { data: CREATED } : { data: { entryId: 'e-1', event: null, summary: null } }),
    );
    const { onCreated, onOpenChange } = renderCreate();
    fillRequired();
    fireEvent.click(chip('เพื่อนแนะนำ'));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(apiPost).toHaveBeenCalledTimes(2);
    const [createUrl, createBody] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(createUrl).toBe('/customers');
    expect(createBody).toMatchObject({ name: 'ทดสอบ หน้าร้าน', nationalId: VALID_NID, phone: '0812345678', prefix: 'นาย' });
    expect(createBody).not.toHaveProperty('heardFrom');
    const [entryUrl, entryBody] = apiPost.mock.calls[1] as [string, Record<string, unknown>];
    expect(entryUrl).toBe('/customers/c-new/journey/entries');
    expect(entryBody).toEqual({ kind: 'HEARD_FROM', heardFrom: 'FRIEND', clientRequestId: expect.any(String) });
    // บันทึกชิปเสร็จก่อนส่งต่อ — หน้าที่เปิดต่อจึงได้ summary ที่ตอบแล้ว
    expect(apiPost.mock.invocationCallOrder[1]).toBeLessThan(onCreated.mock.invocationCallOrder[0]);
    expect(toastMock.success).toHaveBeenCalledWith('เพิ่มลูกค้าสำเร็จ');
    expect(toastMock.warning).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('บันทึกชิปไม่สำเร็จ → ลูกค้ายังถูกสร้างและเรียก onCreated · toast สำเร็จก่อนแล้วตามด้วย toast เตือน · ไม่มี toast error', async () => {
    // reject ตอนถูกเรียกเท่านั้น (mockRejectedValue = unhandled ตั้งแต่ตั้งค่า)
    apiPost.mockImplementation((url: string) =>
      url === '/customers' ? Promise.resolve({ data: CREATED }) : Promise.reject(new Error('journey entries unavailable')),
    );
    const { onCreated, onOpenChange } = renderCreate();
    fillRequired();
    fireEvent.click(chip('ลูกค้าเก่า'));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(toastMock.success).toHaveBeenCalledWith('เพิ่มลูกค้าสำเร็จ');
    expect(toastMock.warning).toHaveBeenCalledWith(WARNING);
    expect(toastMock.success.mock.invocationCallOrder[0]).toBeLessThan(toastMock.warning.mock.invocationCallOrder[0]);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ไม่เลือกชิป → ยิงแค่ POST /customers ครั้งเดียว ไม่มี toast เตือน', async () => {
    apiPost.mockResolvedValue({ data: CREATED });
    const { onCreated } = renderCreate();
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0][0]).toBe('/customers');
    expect(toastMock.success).toHaveBeenCalledWith('เพิ่มลูกค้าสำเร็จ');
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it('dialog ผูกกับห้องแชท (linkedToChat) → ไม่มีแถวชิป การ์ดข้อมูลหลักจบที่วันเกิด', () => {
    renderCreate({ linkedToChat: true, submitLabel: 'บันทึกและผูกกับแชท' });
    expect(screen.getByText('วันเกิด')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: GROUP_NAME })).toBeNull();
    expect(screen.queryByText('ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'ข้าม' })).toBeNull();
  });

  it('โหมด fill (เติมข้อมูลผู้สนใจจากแชท) → ไม่มีแถวชิป', () => {
    renderCreate({ mode: 'fill', fillCustomerId: 'p1', onFilled: vi.fn() });
    expect(screen.getByRole('heading', { name: 'เพิ่มเบอร์/ข้อมูลผู้สนใจ' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: GROUP_NAME })).toBeNull();
    expect(screen.queryByText('ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the dialog tests and watch them fail**

Run:

```bash
cd apps/web && npx vitest run src/components/customer/CustomerCreateDialog.test.tsx
```

Expected: `Tests  3 failed | 14 passed (17)`. The three failures are the first three tests of the new `describe` (`โหมดสร้าง: ชิป 9 ตัว…`, `เลือกชิปแล้วบันทึก…`, `บันทึกชิปไม่สำเร็จ…`), each with `Unable to find an accessible element with the role "group" and name "ลูกค้ารู้จักร้านจากไหน"`. The no-chip, `linkedToChat` and fill tests pass already (they guard absence/unchanged behaviour). All 11 pre-existing tests pass (the sonner mock does not change them).

- [ ] **Step 4: Implement the chips in CustomerCreateDialog**

In `apps/web/src/components/customer/CustomerCreateDialog.tsx`:

(a) Imports — replace

```tsx
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown, CreditCard, Camera, User, MapPin, Phone, Briefcase, Users, Link2 } from 'lucide-react';
import type { OcrResult } from '@/types/ocr';
```

with

```tsx
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { HeardFromChips } from '@/components/customer/journey/HeardFromChips';
import { postHeardFrom } from '@/hooks/customer-journey/journeyEntries';
import { ChevronDown, CreditCard, Camera, User, MapPin, Phone, Briefcase, Users, Link2 } from 'lucide-react';
import type { JourneyHeardFrom } from '@installment/shared';
import type { OcrResult } from '@/types/ocr';
```

(b) Props — replace

```tsx
  /** โหมด fill บันทึกสำเร็จ — dialog ปิดตัวเองหลังเรียก */
  onFilled?: (customer: CreatedCustomer) => void;
}
```

with

```tsx
  /** โหมด fill บันทึกสำเร็จ — dialog ปิดตัวเองหลังเรียก */
  onFilled?: (customer: CreatedCustomer) => void;
  /**
   * เปิดจากห้องแชท (แผงอินบ็อกซ์ "บันทึกและผูกกับแชท" · /customers?new=1&fromRoomId=…) — ระบบรู้ช่องทางแรกจากห้องแล้ว
   * จึงไม่ถามชิป "ลูกค้ารู้จักร้านจากไหน" (คำตัดสินเจ้าของ 2026-09-15 ข้อ 3, 12) · โหมด fill ไม่ถามอยู่แล้ว
   */
  linkedToChat?: boolean;
}

/** ตัวแปรของ mutation — ชิปถูกจับ ณ ตอนกดบันทึก และถูกถอดออกก่อนสร้าง body ของ POST /customers */
type CreateVariables = CustomerFormData & { heardFrom: JourneyHeardFrom | null };

/** ผลของ mutation — heardFromFailed = สร้าง/เติมลูกค้าได้ แต่บันทึกชิปไม่สำเร็จ (ไม่ขวางการสร้าง) */
interface CreateResult {
  data: CreatedCustomer;
  heardFromFailed: boolean;
}
```

(c) Form signature — replace

```tsx
function CustomerCreateForm({ mode = 'create', fillCustomerId, initialValues, context, submitLabel = 'บันทึก', onCreated, onFilled, onUseExisting, onClose }: FormProps) {
  const isFill = mode === 'fill';
```

with

```tsx
function CustomerCreateForm({ mode = 'create', fillCustomerId, initialValues, context, submitLabel = 'บันทึก', onCreated, onFilled, onUseExisting, linkedToChat = false, onClose }: FormProps) {
  const isFill = mode === 'fill';
  /* ถามช่องทางที่รู้จักเฉพาะลูกค้าหน้าร้านที่สร้างใหม่ — โหมด fill / ผูกห้องแชท = ทักแชทมาก่อน ระบบรู้ช่องทางแล้ว */
  const askHeardFrom = !isFill && !linkedToChat;
```

(d) State — replace

```tsx
  const [formExtra, setFormExtra] = useState({ facebookFriends: '', googleMapLink: '', addressCurrentType: '' });
```

with

```tsx
  const [formExtra, setFormExtra] = useState({ facebookFriends: '', googleMapLink: '', addressCurrentType: '' });
  /* ชิป "รู้จักร้านจากไหน" — ไม่อยู่ใน customerSchema (ห้ามเข้า body ของ POST /customers) · ฟอร์ม mount ตอนเปิดเท่านั้น ⇒ เปิดใหม่ = ว่าง */
  const [heardFrom, setHeardFrom] = useState<JourneyHeardFrom | null>(null);
```

(e) `mutationFn` signature — replace

```tsx
    mutationFn: async (data: CustomerFormData) => {
```

with

```tsx
    mutationFn: async ({ heardFrom: chosenHeardFrom, ...data }: CreateVariables): Promise<CreateResult> => {
```

(f) Fill-branch return — replace

```tsx
        return api.post<CreatedCustomer>(`/customers/${fillCustomerId}/fill-contact`, fillPayload);
```

with

```tsx
        const filled = await api.post<CreatedCustomer>(`/customers/${fillCustomerId}/fill-contact`, fillPayload);
        return { data: filled.data, heardFromFailed: false };
```

(g) Create-branch return, `onSuccess`, `onError` signature — replace

```tsx
      return api.post<CreatedCustomer>('/customers', payload);
    },
    onSuccess: (res) => {
      if (isFill) {
        toast.success('บันทึกข้อมูลผู้สนใจแล้ว');
        onFilled?.(res.data);
      } else {
        toast.success('เพิ่มลูกค้าสำเร็จ');
        onCreated(res.data);
      }
      onClose();
    },
    onError: (err: unknown, variables: CustomerFormData) => {
```

with

```tsx
      const created = await api.post<CreatedCustomer>('/customers', payload);
      // ชิปบันทึกแยกหลังได้ id — รอให้เสร็จก่อนปิด: ปุ่มบันทึกยัง disabled (กันกดซ้ำ) และหน้าที่เปิดต่อได้ summary ที่ตอบแล้ว
      // postHeardFrom ไม่ throw — ล้ม = true แล้วเตือนหลัง toast สำเร็จ · 409 ของ /customers โยนก่อนถึงบรรทัดนี้
      const heardFromFailed = chosenHeardFrom ? await postHeardFrom(created.data.id, chosenHeardFrom) : false;
      return { data: created.data, heardFromFailed };
    },
    onSuccess: (res) => {
      if (isFill) {
        toast.success('บันทึกข้อมูลผู้สนใจแล้ว');
        onFilled?.(res.data);
      } else {
        toast.success('เพิ่มลูกค้าสำเร็จ');
        // ต้องยิงหลัง toast สำเร็จ ไม่งั้นป้ายเตือนจะซ้อนอยู่ใต้ป้ายสำเร็จ (บอร์ด HeardFrom d) · ไม่มีปุ่มลองใหม่
        if (res.heardFromFailed) toast.warning('บันทึกลูกค้าแล้ว แต่บันทึกช่องทางที่รู้จักไม่สำเร็จ');
        onCreated(res.data);
      }
      onClose();
    },
    onError: (err: unknown, variables: CreateVariables) => {
```

(h) Form submit — replace

```tsx
        <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
```

with

```tsx
        <form onSubmit={form.handleSubmit((data) => createMutation.mutate({ ...data, heardFrom: askHeardFrom ? heardFrom : null }))} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
```

(i) End of the "ข้อมูลหลัก" card — replace

```tsx
                    return <span className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1.5 rounded-lg">อายุ {age} ปี</span>;
                  })()}
                </div>
              )}
            </div>
          </div>
```

with

```tsx
                    return <span className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1.5 rounded-lg">อายุ {age} ปี</span>;
                  })()}
                </div>
              )}
            </div>
            {/* ลูกค้าหน้าร้านที่สร้างใหม่ — ไม่บังคับ · แตะซ้ำ = ยกเลิก · "ข้าม" = ล้าง (บอร์ด HeardFrom a) · ซ่อนแล้วการ์ดจบที่วันเกิด ไม่มีเส้นคั่น (a2) */}
            {askHeardFrom && (
              <div className="mt-4 border-t border-border pt-4">
                <HeardFromChips
                  value={heardFrom}
                  onSelect={(code) => setHeardFrom((current) => (current === code ? null : code))}
                  onSkip={() => setHeardFrom(null)}
                  skipStyle="text"
                  disabled={createMutation.isPending}
                />
              </div>
            )}
          </div>
```

- [ ] **Step 5: Run the dialog tests and watch them pass**

Run:

```bash
cd apps/web && npx vitest run src/components/customer/CustomerCreateDialog.test.tsx
```

Expected: `Tests  17 passed (17)`.

- [ ] **Step 6: Write the failing host tests (RoomDossier + /customers)**

(a) In `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx` replace the mock's first three lines

```tsx
    default: (p: { open: boolean; mode?: string; fillCustomerId?: string; submitLabel?: string; initialValues?: Record<string, string>; onCreated: (c: { id: string; name: string }) => void; onFilled?: (c: { id: string; name: string }) => void; onUseExisting?: (c: { id: string; name: string }) => void }) =>
      p.open ? (
        <div data-testid="create-dialog" data-mode={p.mode ?? 'create'} data-fill-id={p.fillCustomerId ?? ''}>
```

with

```tsx
    default: (p: { open: boolean; mode?: string; fillCustomerId?: string; submitLabel?: string; linkedToChat?: boolean; initialValues?: Record<string, string>; onCreated: (c: { id: string; name: string }) => void; onFilled?: (c: { id: string; name: string }) => void; onUseExisting?: (c: { id: string; name: string }) => void }) =>
      p.open ? (
        <div data-testid="create-dialog" data-mode={p.mode ?? 'create'} data-fill-id={p.fillCustomerId ?? ''} data-linked-to-chat={String(!!p.linkedToChat)}>
```

and in the test `สร้างลูกค้าใหม่: เปิดเป็น popup ในห้อง …` replace

```tsx
    const dlg = screen.getByTestId('create-dialog');
    expect(dlg).toHaveTextContent('บันทึกและผูกกับแชท');
```

with

```tsx
    const dlg = screen.getByTestId('create-dialog');
    expect(dlg).toHaveTextContent('บันทึกและผูกกับแชท');
    // ผูกกับห้องแชท ⇒ dialog ไม่ถามรู้จักร้านจากไหน (คำตัดสิน 2026-09-15 ข้อ 12)
    expect(dlg).toHaveAttribute('data-linked-to-chat', 'true');
```

(b) In `apps/web/src/pages/CustomersPage/__tests__/CustomersPage.test.tsx` replace

```tsx
  it('ยังพาพารามิเตอร์ ?new=1 ไปเปิดโมดัลแล้วล้างทิ้ง โดยไม่ทับ ?zone=', async () => {
    show('/customers?zone=shop&new=1&name=สมหมาย%20ใจดี&fromRoomId=room-9');
    await waitFor(() => expect(locationText()).not.toContain('new=1'));
    expect(locationText()).toContain('zone=shop');
    expect(locationText()).not.toContain('fromRoomId');
    expect(await screen.findByLabelText('เพิ่มลูกค้าใหม่')).toBeInTheDocument();
  });
```

with

```tsx
  it('ยังพาพารามิเตอร์ ?new=1 ไปเปิดโมดัลแล้วล้างทิ้ง โดยไม่ทับ ?zone=', async () => {
    show('/customers?zone=shop&new=1&name=สมหมาย%20ใจดี&fromRoomId=room-9');
    await waitFor(() => expect(locationText()).not.toContain('new=1'));
    expect(locationText()).toContain('zone=shop');
    expect(locationText()).not.toContain('fromRoomId');
    expect(await screen.findByLabelText('เพิ่มลูกค้าใหม่')).toBeInTheDocument();
    // มากับ fromRoomId = สร้างแล้วผูกห้องแชท ⇒ ไม่ถามรู้จักร้านจากไหน (ระบบรู้ช่องทางแรกจากห้องแล้ว)
    expect(screen.queryByRole('group', { name: 'ลูกค้ารู้จักร้านจากไหน' })).not.toBeInTheDocument();
  });

  it('?new=1 ที่ไม่มี fromRoomId (ลูกค้าหน้าร้าน) → โมดัลมีชิปรู้จักร้านจากไหน', async () => {
    show('/customers?zone=shop&new=1');
    expect(await screen.findByLabelText('เพิ่มลูกค้าใหม่')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'ลูกค้ารู้จักร้านจากไหน' })).toBeInTheDocument();
  });
```

- [ ] **Step 7: Run the host tests and watch them fail**

Run:

```bash
cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx
cd apps/web && npx vitest run src/pages/CustomersPage/__tests__/CustomersPage.test.tsx -t "new=1"
```

Expected:
- RoomDossier: `1 failed | 16 passed (17)` — `สร้างลูกค้าใหม่: เปิดเป็น popup ในห้อง …` fails with `Expected the element to have attribute: data-linked-to-chat="true"` / `Received: data-linked-to-chat="false"`.
- CustomersPage (`-t "new=1"` selects 2 tests, the rest skipped): `1 failed | 1 passed` — `ยังพาพารามิเตอร์ ?new=1 …` fails with `expected document not to contain element, found <div aria-label="ลูกค้ารู้จักร้านจากไหน" … role="group">` (Step 4 shows chips whenever the prop is missing); the new `?new=1 ที่ไม่มี fromRoomId …` test passes.

- [ ] **Step 8: Pass `linkedToChat` from the two chat-linked hosts**

(a) In `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx` replace

```tsx
        submitLabel="บันทึกและผูกกับแชท"
        onCreated={(c) => linkCreated.mutate(c.id)}
```

with

```tsx
        submitLabel="บันทึกและผูกกับแชท"
        linkedToChat
        onCreated={(c) => linkCreated.mutate(c.id)}
```

(The fill-mode `<CustomerCreateDialog key={`fill-${room.id}`} …>` below it stays unchanged — `mode="fill"` already hides the chips.)

(b) In `apps/web/src/pages/CustomersPage/index.tsx` replace

```tsx
        initialValues={prefill ?? undefined}
        onCreated={handleCreated}
      />
```

with

```tsx
        initialValues={prefill ?? undefined}
        /* ?fromRoomId = สร้างแล้วผูกห้องแชท ⇒ ไม่ถามรู้จักร้านจากไหน · ตั้งพร้อม setIsModalOpen ในเอฟเฟกต์เดียวกัน ล้างตอนปิด */
        linkedToChat={!!linkAfterCreate}
        onCreated={handleCreated}
      />
```

- [ ] **Step 9: Run the dialog + host tests, typecheck and lint**

Run:

```bash
cd apps/web && npx vitest run src/components/customer/CustomerCreateDialog.test.tsx src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx src/pages/CustomersPage/__tests__/CustomersPage.test.tsx
./tools/check-types.sh web
cd apps/web && npx eslint src/components/customer/CustomerCreateDialog.tsx src/components/customer/CustomerCreateDialog.test.tsx src/pages/UnifiedInboxPage/components/RoomDossier.tsx src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx src/pages/CustomersPage/index.tsx src/pages/CustomersPage/__tests__/CustomersPage.test.tsx
```

(the `./tools/check-types.sh web` line runs from the worktree root)

Expected: vitest `Test Files  3 passed (3)`, 0 failed (CustomerCreateDialog 17 passed · RoomDossier 17 passed · CustomersPage every test passed including the 2 `?new=1` tests); check-types prints `Web: OK`; eslint `✖ 2 problems (0 errors, 2 warnings)` — the same two pre-existing warnings in `RoomDossier.tsx` (`Hardcoded Tailwind color scale detected` and `Unexpected any`), nothing new.

- [ ] **Step 10: Commit the dialog change**

Run (from the worktree root):

```bash
git add apps/web/src/components/customer/CustomerCreateDialog.tsx apps/web/src/components/customer/CustomerCreateDialog.test.tsx apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx apps/web/src/pages/CustomersPage/index.tsx apps/web/src/pages/CustomersPage/__tests__/CustomersPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(customer-journey): ชิปรู้จักร้านจากไหนใน dialog สร้างลูกค้าใหม่ — บันทึกต่อจากสร้างลูกค้า ไม่ขวางการสร้าง

- ท้ายการ์ด "ข้อมูลหลัก" (โหมดสร้าง) ไม่บังคับ · แตะซ้ำ = ยกเลิก · ข้าม = ล้างที่เลือก
- POST /customers ก่อน แล้ว POST journey/entries HEARD_FROM ไปที่ id ใหม่ · body ของ /customers ไม่มี heardFrom
- บันทึกชิปล้ม = toast เตือนหลัง toast สำเร็จ · ไม่แสดงในโหมด fill และ dialog ที่ผูกห้องแชท (RoomDossier · ?fromRoomId)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `git show --stat HEAD` lists exactly those 6 files.

- [ ] **Step 11: Write the failing POS CustomerSearch tests**

Create `apps/web/src/pages/POSPage/components/CustomerSearch.test.tsx`:

```tsx
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Customer } from '../types';
import CustomerSearch from './CustomerSearch';

/**
 * POS "เพิ่มลูกค้าใหม่" (dialog 2 ช่อง) + ชิปรู้จักร้านจากไหน — POSPage.test mock คอมโพเนนต์นี้ทั้งตัว ไฟล์นี้จึงเป็นเทสแรกของมัน
 * 🔴 hook ของ vitest ห้าม return ค่า (mockReset คืนฟังก์ชัน = teardown ลอย) ⇒ คร่อมปีกกาเสมอ
 * reject ด้วย mockImplementation ตอนถูกเรียกเท่านั้น (mockRejectedValue = unhandled rejection ตั้งแต่ตั้งค่า)
 */

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error'),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const GROUP_NAME = 'ลูกค้ารู้จักร้านจากไหน';
const WARNING = 'บันทึกลูกค้าแล้ว แต่บันทึกช่องทางที่รู้จักไม่สำเร็จ';
const CREATED = { id: 'c-new', name: 'ทดสอบ หน้าร้าน', phone: '0800000000', nationalId: null };
const SELECTED_NEW: Customer = { id: 'c-new', name: 'ทดสอบ หน้าร้าน', phone: '0800000000', nationalId: '', _count: { contracts: 0 } };
const EXISTING: Customer = { id: 'c-old', name: 'ลูกค้าเดิม ทดสอบ', phone: '0800000001', nationalId: '', _count: { contracts: 1 } };

function Harness({ onSelectCustomer }: { onSelectCustomer: (customer: Customer) => void }) {
  const [search, setSearch] = useState('');
  return (
    <CustomerSearch
      customerSearch={search}
      setCustomerSearch={setSearch}
      selectedCustomer={null}
      onSelectCustomer={onSelectCustomer}
      onClearCustomer={() => undefined}
    />
  );
}

function renderSearch() {
  const onSelectCustomer = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness onSelectCustomer={onSelectCustomer} />
    </QueryClientProvider>,
  );
  return onSelectCustomer;
}

async function openCreateDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มลูกค้าใหม่' }));
  return screen.findByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' });
}

function fillNameAndPhone(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText('ชื่อลูกค้า *'), { target: { value: 'ทดสอบ หน้าร้าน' } });
  fireEvent.change(within(dialog).getByLabelText('เบอร์โทร *'), { target: { value: '0800000000' } });
}

const heardFromGroup = (dialog: HTMLElement) => within(dialog).getByRole('group', { name: GROUP_NAME });
const chip = (dialog: HTMLElement, label: string) => within(heardFromGroup(dialog)).getByRole('button', { name: label });

beforeEach(() => {
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.toast.success.mockReset();
  mocks.toast.warning.mockReset();
  mocks.toast.error.mockReset();
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/customers/search') return { data: [EXISTING] };
    throw new Error(`unexpected GET ${url}`);
  });
});

describe('POS CustomerSearch — เพิ่มลูกค้าใหม่ + ชิปรู้จักร้านจากไหน', () => {
  it('เลือกชิปแล้วบันทึก → POST /customers ด้วยชื่อ+เบอร์เท่านั้น แล้ว POST journey/entries ไปที่ id ใหม่ · เลือกลูกค้าใหม่ให้ POS', async () => {
    mocks.post.mockImplementation(async (url: string) =>
      url === '/customers' ? { data: CREATED } : { data: { entryId: 'e-1', event: null, summary: null } },
    );
    const onSelectCustomer = renderSearch();
    const dialog = await openCreateDialog();
    fillNameAndPhone(dialog);
    fireEvent.click(chip(dialog, 'ผ่านหน้าร้าน'));
    expect(chip(dialog, 'ผ่านหน้าร้าน')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกลูกค้า' }));

    await waitFor(() => expect(onSelectCustomer).toHaveBeenCalledWith(SELECTED_NEW));
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[0]).toEqual(['/customers', { name: 'ทดสอบ หน้าร้าน', phone: '0800000000' }]);
    const [entryUrl, entryBody] = mocks.post.mock.calls[1] as [string, Record<string, unknown>];
    expect(entryUrl).toBe('/customers/c-new/journey/entries');
    expect(entryBody).toEqual({ kind: 'HEARD_FROM', heardFrom: 'WALK_BY', clientRequestId: expect.any(String) });
    expect(mocks.post.mock.invocationCallOrder[1]).toBeLessThan(onSelectCustomer.mock.invocationCallOrder[0]);
    expect(mocks.toast.success).toHaveBeenCalledWith('เพิ่มลูกค้าใหม่สำเร็จ');
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('บันทึกชิปไม่สำเร็จ → ยังเลือกลูกค้าใหม่ให้ POS · toast สำเร็จก่อนแล้วตามด้วย toast เตือน · ไม่มี toast error', async () => {
    mocks.post.mockImplementation((url: string) =>
      url === '/customers' ? Promise.resolve({ data: CREATED }) : Promise.reject(new Error('journey entries unavailable')),
    );
    const onSelectCustomer = renderSearch();
    const dialog = await openCreateDialog();
    fillNameAndPhone(dialog);
    fireEvent.click(chip(dialog, 'เพื่อนแนะนำ'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกลูกค้า' }));

    await waitFor(() => expect(onSelectCustomer).toHaveBeenCalledWith(SELECTED_NEW));
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.toast.success).toHaveBeenCalledWith('เพิ่มลูกค้าใหม่สำเร็จ');
    expect(mocks.toast.warning).toHaveBeenCalledWith(WARNING);
    expect(mocks.toast.success.mock.invocationCallOrder[0]).toBeLessThan(mocks.toast.warning.mock.invocationCallOrder[0]);
    expect(mocks.toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('ไม่เลือกชิป → ยิงแค่ POST /customers ครั้งเดียว ไม่มี toast เตือน', async () => {
    mocks.post.mockResolvedValue({ data: CREATED });
    const onSelectCustomer = renderSearch();
    const dialog = await openCreateDialog();
    fillNameAndPhone(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกลูกค้า' }));

    await waitFor(() => expect(onSelectCustomer).toHaveBeenCalledWith(SELECTED_NEW));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]).toEqual(['/customers', { name: 'ทดสอบ หน้าร้าน', phone: '0800000000' }]);
    expect(mocks.toast.success).toHaveBeenCalledWith('เพิ่มลูกค้าใหม่สำเร็จ');
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });

  it('สร้างลูกค้าไม่สำเร็จ → dialog ยังเปิด ชิปที่เลือกยังค้าง ไม่ยิง journey/entries · ปิดแล้วเปิดใหม่ = ชิปว่าง', async () => {
    mocks.post.mockImplementation(() => Promise.reject(new Error('เบอร์โทรนี้มีลูกค้าอยู่แล้ว')));
    const onSelectCustomer = renderSearch();
    const dialog = await openCreateDialog();
    fillNameAndPhone(dialog);
    fireEvent.click(chip(dialog, 'TikTok'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกลูกค้า' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('เบอร์โทรนี้มีลูกค้าอยู่แล้ว'));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(onSelectCustomer).not.toHaveBeenCalled();
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' })).toBeInTheDocument();
    expect(chip(dialog, 'TikTok')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(dialog).getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const reopened = await openCreateDialog();
    expect(within(heardFromGroup(reopened)).queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });

  it('เลือกลูกค้าเดิมจากผลค้นหา → ไม่ถามรู้จักร้านจากไหน ไม่ยิง POST ใด ๆ', async () => {
    const onSelectCustomer = renderSearch();
    fireEvent.change(screen.getByPlaceholderText(/พิมพ์อย่างน้อย 2 ตัวอักษร/), { target: { value: 'ทดสอบ' } });
    fireEvent.click(await screen.findByRole('button', { name: /ลูกค้าเดิม ทดสอบ/ }));

    expect(onSelectCustomer).toHaveBeenCalledWith(EXISTING);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('group', { name: GROUP_NAME })).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 12: Run the POS tests and watch them fail**

Run:

```bash
cd apps/web && npx vitest run src/pages/POSPage/components/CustomerSearch.test.tsx
```

Expected: `Tests  3 failed | 2 passed (5)`. `เลือกชิปแล้วบันทึก…`, `บันทึกชิปไม่สำเร็จ…` and `สร้างลูกค้าไม่สำเร็จ…` fail with `Unable to find an accessible element with the role "group" and name "ลูกค้ารู้จักร้านจากไหน"`; `ไม่เลือกชิป…` and `เลือกลูกค้าเดิมจากผลค้นหา…` pass (current behaviour already matches). No `unexpected GET` error appears.

- [ ] **Step 13: Replace `CustomerSearch.tsx`**

Replace the whole of `apps/web/src/pages/POSPage/components/CustomerSearch.tsx` with:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import type { JourneyHeardFrom } from '@installment/shared';
import { useDebounce } from '@/hooks/useDebounce';
import { postHeardFrom } from '@/hooks/customer-journey/journeyEntries';
import { HeardFromChips } from '@/components/customer/journey/HeardFromChips';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import api, { getErrorMessage } from '@/lib/api';
import type { Customer } from '../types';

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';

interface CustomerSearchProps {
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  selectedCustomer: Customer | null;
  onSelectCustomer: (customer: Customer) => void;
  onClearCustomer: () => void;
}

/** สิ่งที่ POST /customers คืนมาและ POS ใช้ต่อ */
interface QuickCreatedCustomer {
  id: string;
  name: string;
  phone: string;
  nationalId?: string | null;
}

/** ตัวแปรของ mutation สร้างลูกค้าด่วน — heardFrom ถูกถอดออกก่อนสร้าง body ของ POST /customers */
interface QuickCreateInput {
  name: string;
  phone: string;
  heardFrom: JourneyHeardFrom | null;
}

export default function CustomerSearch({
  customerSearch,
  setCustomerSearch,
  selectedCustomer,
  onSelectCustomer,
  onClearCustomer,
}: CustomerSearchProps) {
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const queryClient = useQueryClient();

  const {
    data: customers,
    isFetching: customersFetching,
    isError: customersError,
  } = useQuery<Customer[]>({
    queryKey: ['pos-customers', debouncedCustomerSearch],
    queryFn: async () => {
      if (!debouncedCustomerSearch || debouncedCustomerSearch.length < 2) return [];
      const { data } = await api.get('/customers/search', {
        params: { q: debouncedCustomerSearch },
      });
      return data;
    },
    enabled: !!debouncedCustomerSearch && debouncedCustomerSearch.length >= 2,
  });

  // Quick-add customer (name + phone) so a fresh system with no customers is
  // never a dead end at POS — mirrors the vendor "+ เพิ่มผู้ขายใหม่" pattern.
  // Only name + phone are required by CreateCustomerDto; the rest can be filled
  // later on the customer page.
  // ลูกค้าใหม่ที่สร้างจาก POS = ลูกค้าหน้าร้าน ⇒ ถามชิป "รู้จักร้านจากไหน" (ไม่บังคับ) แล้วบันทึกแยกหลังได้ id
  // เลือกลูกค้าเดิมจากผลค้นหาไม่ถาม (บอร์ด HeardFrom b)
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newHeardFrom, setNewHeardFrom] = useState<JourneyHeardFrom | null>(null);

  const createMutation = useMutation({
    mutationFn: async ({ heardFrom, ...input }: QuickCreateInput) => {
      const created = (await api.post<QuickCreatedCustomer>('/customers', input)).data;
      // postHeardFrom ไม่ throw — ล้ม = true แล้วเตือนหลัง toast สำเร็จ · การสร้างลูกค้าไม่ถูกขวาง
      const heardFromFailed = heardFrom ? await postHeardFrom(created.id, heardFrom) : false;
      return { created, heardFromFailed };
    },
    onSuccess: ({ created, heardFromFailed }) => {
      toast.success('เพิ่มลูกค้าใหม่สำเร็จ');
      // ต้องยิงหลัง toast สำเร็จ ไม่งั้นป้ายเตือนจะซ้อนอยู่ใต้ป้ายสำเร็จ (บอร์ด HeardFrom d) · ไม่มีปุ่มลองใหม่
      if (heardFromFailed) toast.warning('บันทึกลูกค้าแล้ว แต่บันทึกช่องทางที่รู้จักไม่สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
      onSelectCustomer({
        id: created.id,
        name: created.name,
        phone: created.phone,
        nationalId: created.nationalId ?? '',
        _count: { contracts: 0 },
      });
      setCustomerSearch('');
      setNewHeardFrom(null);
      setShowCreate(false);
    },
    // ค่าชิปคงไว้เมื่อสร้างไม่สำเร็จ — กดบันทึกซ้ำได้โดยไม่ต้องเลือกใหม่
    onError: (e) => toast.error(getErrorMessage(e) ?? 'เพิ่มลูกค้าไม่สำเร็จ'),
  });

  const openCreate = () => {
    const typed = customerSearch.trim();
    const looksLikePhone = /^0[0-9]{0,9}$/.test(typed);
    setNewName(looksLikePhone ? '' : typed);
    setNewPhone(looksLikePhone ? typed : '');
    setNewHeardFrom(null);
    setShowCreate(true);
  };

  const submitCreate = () => {
    if (!newName.trim()) {
      toast.error('กรุณาระบุชื่อลูกค้า');
      return;
    }
    if (!/^0[0-9]{9}$/.test(newPhone.trim())) {
      toast.error('เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0');
      return;
    }
    createMutation.mutate({ name: newName.trim(), phone: newPhone.trim(), heardFrom: newHeardFrom });
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="text-sm font-semibold text-foreground">เลือกลูกค้า</div>
      </CardHeader>
      <CardContent>
        {selectedCustomer ? (
          <div className="flex items-center justify-between bg-muted rounded-lg p-3">
            <div>
              <div className="text-sm font-medium">{selectedCustomer.name}</div>
              <div className="text-xs text-muted-foreground">
                {selectedCustomer.phone} | สัญญา {selectedCustomer._count.contracts} รายการ
              </div>
            </div>
            <button onClick={onClearCustomer} className="text-xs text-destructive hover:underline">
              เปลี่ยน
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร เช่น ชื่อ, เบอร์โทร, เลขบัตร..."
                className={inputClass}
              />
              {customerSearch.length >= 2 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-60 overflow-y-auto">
                  {customersError ? (
                    <div className="px-3 py-4 text-center text-sm text-destructive">
                      ค้นหาลูกค้าไม่สำเร็จ กรุณาลองใหม่
                    </div>
                  ) : customersFetching ? (
                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mx-auto mb-2" />
                      กำลังค้นหา...
                    </div>
                  ) : customers && customers.length > 0 ? (
                    customers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          onSelectCustomer(c);
                          setCustomerSearch('');
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b last:border-b-0"
                      >
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.phone}</div>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-3 text-center text-sm text-muted-foreground">
                      ไม่พบลูกค้าที่ตรงกับ &quot;{customerSearch}&quot;
                    </div>
                  )}
                  {/* Always offer create at the bottom of the dropdown. */}
                  <button
                    onClick={openCreate}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 border-t flex items-center gap-2 text-primary"
                  >
                    <UserPlus className="size-4" />
                    เพิ่มลูกค้าใหม่{customerSearch.trim() ? ` "${customerSearch.trim()}"` : ''}
                  </button>
                </div>
              )}
            </div>
            {/* Always-visible add button so an empty list / no-typing is never a dead end. */}
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <UserPlus className="size-4" />
              เพิ่มลูกค้าใหม่
            </button>
          </div>
        )}
      </CardContent>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มลูกค้าใหม่</DialogTitle>
            <DialogDescription className="leading-snug">
              กรอกชื่อ + เบอร์โทร เพื่อใช้ขายได้ทันที (เพิ่มข้อมูลอื่นภายหลังที่หน้าลูกค้าได้)
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div>
              <Label htmlFor="new-cust-name">ชื่อลูกค้า *</Label>
              <Input
                id="new-cust-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ชื่อ-นามสกุล"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="new-cust-phone">เบอร์โทร *</Label>
              <Input
                id="new-cust-phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="08XXXXXXXX"
                inputMode="numeric"
                maxLength={10}
              />
            </div>
            {/* ลูกคนที่ 3 ของ grid ต่อจากช่องเบอร์ ก่อน DialogFooter · แตะซ้ำ = ยกเลิก · "ข้าม" = ล้าง (บอร์ด HeardFrom b) */}
            <HeardFromChips
              value={newHeardFrom}
              onSelect={(code) => setNewHeardFrom((current) => (current === code ? null : code))}
              onSkip={() => setNewHeardFrom(null)}
              skipStyle="text"
              disabled={createMutation.isPending}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreate(false)}
              disabled={createMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button onClick={submitCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกลูกค้า'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

- [ ] **Step 14: Run the POS tests and watch them pass**

Run:

```bash
cd apps/web && npx vitest run src/pages/POSPage/components/CustomerSearch.test.tsx src/pages/POSPage/POSPage.test.tsx
```

Expected: `Test Files  2 passed (2)` — CustomerSearch 5 passed, POSPage 8 passed (it mocks `CustomerSearch` entirely, so it must be untouched by this change).

- [ ] **Step 15: Add the create-flow bullets to spec (ข)**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md`, section `(ข) ชิป 'รู้จักร้านจากไหน' (เฟส 3, แตะเดียว)`, replace

```markdown
- บันทึกเป็น entry HEARD_FROM ครั้งแรก ตอบซ้ำ = แก้ค่า
- ห้ามแก้ acquisitionSource (R14/R24)
```

with

```markdown
- ตอนสร้างลูกค้าใหม่หน้าร้าน (CustomerCreateDialog โหมดสร้าง · POS "เพิ่มลูกค้าใหม่"): ชิป 9 ตัว ไม่บังคับ เลือกได้ 1 · แตะซ้ำ = ยกเลิก · "ข้าม" = ล้างที่เลือก (ไม่บันทึกอะไร) · CustomerCreateDialog วางท้ายการ์ด "ข้อมูลหลัก" ต่อจากเส้นคั่น · POS วางใต้ช่องเบอร์ก่อนปุ่ม · เลือกลูกค้าเดิมที่ POS ไม่ถาม
- CustomerCreateDialog ไม่แสดงชิปในโหมด fill และเมื่อ dialog ผูกกับห้องแชท (prop `linkedToChat`: แผงอินบ็อกซ์ "บันทึกและผูกกับแชท" · /customers?new=1&fromRoomId=…) — คนกลุ่มนี้ทักแชทมาก่อน ระบบรู้ช่องทางแรกจากห้องแล้ว
- บันทึกตอนกดบันทึก ต่อจาก POST /customers ที่ได้ id: POST /customers/:id/journey/entries { kind: 'HEARD_FROM', heardFrom, clientRequestId } ไปที่ id ใหม่ — ห้ามใส่ heardFrom ใน body ของ POST /customers · dialog รอให้เสร็จก่อนปิด (ปุ่มบันทึกกดซ้ำไม่ได้ระหว่างรอ)
- บันทึกชิปไม่สำเร็จไม่ขวางการสร้าง: toast สำเร็จเดิม ("เพิ่มลูกค้าสำเร็จ" / POS "เพิ่มลูกค้าใหม่สำเร็จ") ขึ้นก่อน แล้วตามด้วย toast เตือน "บันทึกลูกค้าแล้ว แต่บันทึกช่องทางที่รู้จักไม่สำเร็จ" ไม่มีปุ่มลองใหม่ — ตอบภายหลังได้จากแถบบนสุดของแท็บการเดินทาง (ธง askHeardFrom ยังเป็นจริง)
- POS: สร้างลูกค้าไม่สำเร็จ = ชิปที่เลือกค้างไว้ให้กดบันทึกซ้ำ · ล้างเมื่อเปิด dialog ใหม่หรือสร้างสำเร็จ
- เบอร์/เลขบัตรซ้ำ (409) ไม่บันทึกชิปให้ลูกค้าเดิม: หน้า /customers ขึ้นแค่ข้อความ ส่วนปุ่ม "ใช้ลูกค้าเดิมคนนี้แทน" มีเฉพาะแผงแชทซึ่งไม่แสดงชิปอยู่แล้ว
- บันทึกเป็น entry HEARD_FROM ครั้งแรก ตอบซ้ำ = แก้ค่า
- ห้ามแก้ acquisitionSource (R14/R24)
```

Check: `grep -c "prop \`linkedToChat\`" docs/superpowers/specs/2026-09-15-customer-journey-design.md` prints `1`.

- [ ] **Step 16: Verify the whole slice (both time zones · types · lint)**

Run from `apps/web`:

```bash
TZ=UTC npx vitest run src/components/customer src/pages/POSPage src/pages/CustomersPage src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx src/hooks/customer-journey
npx vitest run src/components/customer src/pages/POSPage src/pages/CustomersPage src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx src/hooks/customer-journey
npx eslint src/components/customer/CustomerCreateDialog.tsx src/components/customer/CustomerCreateDialog.test.tsx src/pages/UnifiedInboxPage/components/RoomDossier.tsx src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx src/pages/CustomersPage/index.tsx src/pages/CustomersPage/__tests__/CustomersPage.test.tsx src/pages/POSPage/components/CustomerSearch.tsx src/pages/POSPage/components/CustomerSearch.test.tsx
```

Then from the worktree root:

```bash
./tools/check-types.sh web
```

Expected: both vitest runs report 0 failed test files (every file under `src/components/customer` — including Task 10's `journey/__tests__` — `src/pages/POSPage`, `src/pages/CustomersPage`, `RoomDossier.test.tsx`, `src/hooks/customer-journey`); eslint `✖ 2 problems (0 errors, 2 warnings)` — the two pre-existing warnings in `RoomDossier.tsx` only; check-types `Web: OK`. `e2e/customers.spec.ts` needs no change: its create test fills `input[type="text"]`/`input[type="tel"]` and clicks `button:has-text("บันทึก")`, none of which match a chip or "ข้าม".

- [ ] **Step 17: Commit POS + spec**

Run (from the worktree root):

```bash
git add apps/web/src/pages/POSPage/components/CustomerSearch.tsx apps/web/src/pages/POSPage/components/CustomerSearch.test.tsx docs/superpowers/specs/2026-09-15-customer-journey-design.md
git commit -m "$(cat <<'EOF'
feat(customer-journey): ชิปรู้จักร้านจากไหนใน POS เพิ่มลูกค้าใหม่ · สเปก (ข) ขั้นตอนสร้างลูกค้าหน้าร้าน

- ลูกคนที่ 3 ของ dialog 2 ช่อง ไม่บังคับ · แตะซ้ำ = ยกเลิก · ค่าชิปค้างเมื่อสร้างไม่สำเร็จ ล้างเมื่อเปิดใหม่/สร้างสำเร็จ
- POST /customers ด้วยชื่อ+เบอร์เท่านั้น แล้ว POST journey/entries HEARD_FROM ไปที่ id ใหม่ · ล้ม = toast เตือนหลัง toast สำเร็จ
- เลือกลูกค้าเดิมที่ POS ไม่ถาม · เทสแรกของ CustomerSearch · สเปกไม่มีการบันทึกชิปให้ลูกค้าเดิมตอน 409

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `git show --stat HEAD` lists exactly those 3 files.

---

### Task 15: Hide /crm from menus and palette + final docs + web version bump

Line numbers below are from the base `origin/main` `10d6e6d3a` (byte-identical to `05f1f8f3d` for these files). Tasks 1–14 do not touch `apps/web/src/config/menu.ts`, `menu.test.ts`, `apps/web/src/components/CommandPalette.tsx`, `CommandPalette.test.tsx`, `apps/web/package.json` or `package-lock.json`, so those line numbers still hold. The spec and the runbook are edited by earlier tasks (T2/T3/T7/T9/T12/T13/T14), so **every docs edit below is anchored by exact old text, never by line number**.

**Files:**
- Modify: `apps/web/src/config/menu.ts` — lucide import `:16` (`  Kanban,`) · SALES section `sales-tools` entry `:196` · BRANCH_MANAGER section `bm-followup` entry `:279` · FINANCE_MANAGER section `fm-collection` stale comment + entry `:378-379` · OWNER section `owner-marketing` stale comment + entry `:841-842`
- Modify: `apps/web/src/components/CommandPalette.tsx` — `pages` array entry `:61`
- Test: `apps/web/src/config/menu.test.ts` — import `:3`; new `describe` appended after the last line `:386`
- Test: `apps/web/src/components/CommandPalette.test.tsx` — new import after `:12`; new `describe` appended after the last line `:200` (this file — not anything under `components/__tests__/` — is the one that renders the `pages` group)
- Unchanged, run as guards: `apps/web/src/config/__tests__/route-reachability.test.ts`, `apps/web/src/components/__tests__/command-palette-reachability.test.ts`, `apps/web/src/components/__tests__/command-palette-search.test.tsx`, `apps/web/src/components/layout/__tests__/MainLayout.zone.test.tsx`
- Modify: `apps/web/package.json` `:3` (`"version"`)
- Modify: `package-lock.json` `:159-161` (the `"apps/web"` workspace entry — precedent: commit `85cefe0c7` bumped both files by hand)
- Modify: `docs/superpowers/specs/2026-09-15-customer-journey-design.md` — `(ก)` heading (`:413` at HEAD) · `(จ)` heading (`:439`) · heard-from bullet in "สิ่งที่ระบบยังไม่บันทึกวันนี้ + ทางแก้เล็กสุด" (`:507`) · phase-2 SamePerson bullet (`:547`) · whole section `### เฟส 3 — บันทึกมือ 1-3 แตะ (4 วัน)` (`:552-558`)
- Modify: `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` (created by Task 2) — table row `| 5 | ตรวจหลัง backfill |` gets a row 6 under it; one new section appended at the end of the file

**Interfaces:**

Consumes:
- Tasks 1–14 committed on the branch (Step 1 checks markers: Task 1 `askHeardFrom`, Task 14 `linkedToChat`, Task 2 runbook row + rollback heading, Task 12 spec (ค) rewrite).
- Task 2 runbook headings/rows used as anchors or references: `| 5 | ตรวจหลัง backfill |`, `### 1.2 จดของเดิมไว้ถอย` (Firebase release to roll back to), `## 2. merge PR นี้ + ด่านหลัง merge`, ``## 3. `backfill:customer-journey` dry-run``, `## 4. รันจริง`, `## 5. ตรวจหลัง backfill (MCP นับอย่างเดียว)` (its last query picks one customer), `## ถอย (rollback)` → `### ถอยเพราะลำดับขั้น`.
- `apps/web/src/config/menu.ts`: `resolveZoneForPath(role: string, path: string, preferredZone?: Zone): Zone | null` (scans only sidebar items + children) · `getMenuConfig(role: string): RoleMenuConfig` (`{ sidebar: MenuSection[]; bottomNav: BottomNavItem[] }`) · `getZoneConfigForRole(role: string, companies?: readonly string[]): RoleZoneConfig | undefined` (`bottomNav: Record<Zone, BottomNavItem[]>`, keys `shop` / `fin` / `settings`).
- `apps/web/src/config/work-navigation.ts`: `NAV_LABELS.crm = 'ติดตามลูกค้า'` (stays).
- `apps/web/src/components/CommandPalette.test.tsx` file-local helper `renderPaletteOpen(userObj: { id: string; role: string; name: string }): Promise<void>` (sets the `useAuth` mock, renders inside `QueryClientProvider` + `MemoryRouter`, dispatches Ctrl+K inside `act`).
- `MainLayout.tsx` bounce rule: a path in no role's sidebar is treated as a common route (the page renders; `ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']}` in `App.tsx:509` still gates ACCOUNTANT). Removing `/crm` from only some roles bounces the remaining roles with "คุณไม่มีสิทธิ์เข้าถึงหน้านี้" — hence one commit for all four entries plus the palette (outline D13).
- `origin/main` web version at merge time (today `26.9.29`, from the #1595 merge `9e7bface4`; the base `10d6e6d3a` carries the same number) — this task bumps to `26.9.30` (Controller ruling R-P4).

Produces:
- No new exports, types, routes or API changes.
- `/crm` in no role's sidebar (OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES, ACCOUNTANT), in no bottom bar, and not in the CommandPalette `pages` group for any role.
- Kept on purpose: `App.tsx` `/crm` route + `ProtectedRoute`, `pages/CrmPipelinePage.tsx` (+ its test), `components/layout/resolvePageTitle.ts` `'/crm'` title, `NAV_LABELS.crm`, `e2e/crm-kanban-stages.spec.ts` (navigates by URL), the API `crm` module and its data.
- `apps/web/package.json` + `package-lock.json` web version `26.9.30` (or the number Step 9 computes).
- Spec phase-3 section rewritten for scope v2 (delivered list · /crm hidden · deferred list · known limits); `(ก)` / `(จ)` / phase-2 SamePerson bullet marked deferred; heard-from "not recorded" bullet marked done.
- Runbook section `## เว็บ 26.9.30 · ซ่อนเมนู /crm (Task 15)` + order-table row 6. The 2-week usage metric is **not** written here: it lives only in Task 7's section `## ตัวชี้วัดการใช้งานบันทึกมือ — 2 สัปดาห์หลังเปิด (POST journey/entries)` (start = `<LAUNCH_UTC>`, the API revision's traffic start in UTC; kept/undone query included); this task only links to it.

Commits: two — (1) the /crm hide (code + tests, atomic across all four roles and the palette), (2) docs + version bump (last and separate, so only it needs redoing if `origin/main` moves before merge).

---

- [ ] **Step 1: Verify prerequisites and the baseline**

Run (from the worktree root):
```bash
git status --short -- apps/web/src/config/menu.ts apps/web/src/config/menu.test.ts apps/web/src/components/CommandPalette.tsx apps/web/src/components/CommandPalette.test.tsx apps/web/package.json package-lock.json docs/superpowers/specs/2026-09-15-customer-journey-design.md docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -c "path: '/crm'" apps/web/src/config/menu.ts
grep -c "path: '/crm'" apps/web/src/components/CommandPalette.tsx
grep -c "Kanban" apps/web/src/config/menu.ts
grep -c "askHeardFrom" packages/shared/src/customer-journey.ts
grep -c "linkedToChat" apps/web/src/components/customer/CustomerCreateDialog.tsx
grep -c "^| 5 | ตรวจหลัง backfill |$" docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -c "^### ถอยเพราะลำดับขั้น$" docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -c "เพิ่มโน้ต" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -n '"version"' apps/web/package.json
```
Expected, in order:
- `git status` prints nothing (none of the eight files has uncommitted edits — other sessions work in this checkout; never proceed over someone else's edits)
- `4` · `1` · `5` (the import + four entries)
- `askHeardFrom` ≥ `1` (Task 1) · `linkedToChat` ≥ `1` (Task 14)
- `1` · `1` (Task 2 runbook row and rollback heading)
- `0` (Task 12 already replaced the old `'เพิ่มโน้ต' พับไว้ …` bullet — `1` means Task 12 Step 10 is missing: stop and apply it first)
- `3:  "version": "26.9.29",`

- [ ] **Step 2: Write the failing menu test**

In `apps/web/src/config/menu.test.ts` replace line 3
```ts
import { getSidebarForRole, getZoneConfigForRole, resolveZoneForPath } from './menu';
```
with
```ts
import { getMenuConfig, getSidebarForRole, getZoneConfigForRole, resolveZoneForPath } from './menu';
```

Then append after the last line of the file — right after
```ts
  it.each(COMPANY_ACCESS_ROLES)('role %s มี ZONE_CONFIG ที่ให้โซนทำงานอย่างน้อยหนึ่งโซน', (role) => {
    expect(getZoneConfigForRole(role, [])?.zones.length ?? 0).toBeGreaterThan(0);
  });
});
```
— this block:
```ts

// ── เฟส 3 (ขอบเขตรอบ 2 ข้อ 8, เจ้าของเคาะ 2026-09-15): ซ่อนเมนู "ติดตามลูกค้า" (/crm) ─────────
// ต้องหายจาก **ทุก** บทบาทพร้อมกัน: MainLayout เด้งผู้ใช้ออกจาก path ที่ไม่อยู่ในเมนูตัวเอง
// เฉพาะเมื่อ "บทบาทอื่นยังมี path นี้ในเมนู" ⇒ คืนเมนูให้บทบาทเดียว = บทบาทที่เหลือเปิด /crm ด้วย URL
// แล้วโดน toast "คุณไม่มีสิทธิ์เข้าถึงหน้านี้" ทั้งที่ ProtectedRoute อนุญาต
// route · CrmPipelinePage · ข้อมูล lead · ชื่อหน้าใน resolvePageTitle ยังอยู่ครบ (ตั้งใจ)
describe('/crm ถูกซ่อนจากเมนูทุกบทบาท — route ยังเปิดด้วย URL ได้', () => {
  const ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT'];

  it.each(ROLES)('%s: resolveZoneForPath คืน null (ไม่อยู่ใน sidebar โซนใดเลย)', (role) => {
    expect(resolveZoneForPath(role, '/crm')).toBeNull();
  });

  it.each(ROLES)('%s: แถบล่างทุกโซนไม่มี /crm', (role) => {
    const legacy = getMenuConfig(role).bottomNav.map((item) => item.path);
    const zoneBar = getZoneConfigForRole(role, [])?.bottomNav;
    const zoned = zoneBar
      ? [...zoneBar.shop, ...zoneBar.fin, ...zoneBar.settings].map((item) => item.path)
      : [];
    expect([...legacy, ...zoned]).not.toContain('/crm');
  });
});
```

- [ ] **Step 3: Write the failing CommandPalette test**

In `apps/web/src/components/CommandPalette.test.tsx` replace line 12
```tsx
import CommandPalette from './CommandPalette';
```
with
```tsx
import CommandPalette from './CommandPalette';
import { NAV_LABELS } from '@/config/work-navigation';
```

Then append after the last line of the file — right after
```tsx
  it('shows "รายชื่อผู้ติดต่อ" → /contacts entry for ACCOUNTANT', async () => {
    await renderPaletteOpen(makeAccountant());

    const entry = screen.getByText('รายชื่อผู้ติดต่อ');
    expect(entry).toBeInTheDocument();
  });
});
```
— this block:
```tsx

/* ── เฟส 3 (ขอบเขตรอบ 2 ข้อ 8): /crm ถูกซ่อนจาก ⌘K ด้วย ─────────────────────────────
 * เมนูซ้ายถอด /crm ออกจากทุกบทบาทแล้ว (config/menu.test.ts) — palette เป็นอีกทางที่พาพนักงาน
 * ไปหน้าที่ไม่มีใครใช้ จึงต้องไม่มีรายการ "ติดตามลูกค้า" ในกลุ่ม "ไปยังหน้า" สำหรับบทบาทใดเลย
 * (หน้า /crm ยังเปิดด้วย URL ได้ — ไม่ใช่เรื่องของเทสนี้)
 */
describe('CommandPalette — ไม่มีรายการ /crm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
  });

  it.each([
    { id: 'u-owner', role: 'OWNER', name: 'Owner' },
    { id: 'u-bm', role: 'BRANCH_MANAGER', name: 'BM' },
    { id: 'u-fm', role: 'FINANCE_MANAGER', name: 'FM' },
    { id: 'u-sales', role: 'SALES', name: 'Sales' },
    { id: 'u-acc', role: 'ACCOUNTANT', name: 'ACC' },
  ])('$role ไม่เห็น "ติดตามลูกค้า" แต่ยังเห็นหน้าที่เปิดให้ทุกบทบาท', async (user) => {
    await renderPaletteOpen(user);

    // guard: palette เปิดจริงและกลุ่ม "ไปยังหน้า" render แล้ว (/sales ไม่ประกาศ roles ⇒ ทุกบทบาทเห็น)
    // กันเทสเขียวเพราะไม่มีอะไรบนจอเลย
    expect(screen.getByText('ประวัติการขาย')).toBeInTheDocument();
    expect(screen.queryByText(NAV_LABELS.crm)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run both tests and watch them fail**

Run (from `apps/web`):
```bash
TZ=UTC npx vitest run src/config/menu.test.ts src/components/CommandPalette.test.tsx
```
Expected: FAIL — `Test Files  2 failed (2)` and `Tests  8 failed`:
- `menu.test.ts`, 4 failures: `OWNER: resolveZoneForPath คืน null …` → `AssertionError: expected 'shop' to be null`; `BRANCH_MANAGER` → `expected 'shop' to be null`; `FINANCE_MANAGER` → `expected 'fin' to be null`; `SALES` → `expected 'shop' to be null`. The `ACCOUNTANT` case and all five `แถบล่างทุกโซนไม่มี /crm` cases pass (bottom bars never had /crm — they guard against it being added there).
- `CommandPalette.test.tsx`, 4 failures for `OWNER` / `BRANCH_MANAGER` / `FINANCE_MANAGER` / `SALES`: `expected document not to contain element, found <span>ติดตามลูกค้า</span> instead`. `ACCOUNTANT` passes (the entry's `roles` already excluded it).
- Every pre-existing test in both files passes.

- [ ] **Step 5: Remove the four /crm menu entries, the unused `Kanban` import and the two stale comments (menu.ts)**

In `apps/web/src/config/menu.ts` make these five replacements (each old block is unique).

(a) Import `:15-17` — replace
```ts
  Coins,
  Kanban,
  Home,
```
with
```ts
  Coins,
  Home,
```

(b) SALES `sales-tools` `:195-197` — replace
```ts
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: NAV_LABELS.crm, path: '/crm', icon: Kanban },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
```
with
```ts
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
```

(c) BRANCH_MANAGER `bm-followup` `:278-280` — replace
```ts
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
        { label: NAV_LABELS.crm, path: '/crm', icon: Kanban },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
```
with
```ts
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
```

(d) FINANCE_MANAGER `fm-collection` `:377-380` — replace
```ts
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: NAV_LABELS.crm, path: '/crm', icon: Kanban },
      ],
```
with
```ts
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
      ],
```

(e) OWNER `owner-marketing` `:840-843` — replace
```ts
        { label: 'Broadcast', path: '/broadcast', icon: Send },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: NAV_LABELS.crm, path: '/crm', icon: Kanban },
      ],
```
with
```ts
        { label: 'Broadcast', path: '/broadcast', icon: Send },
      ],
```

No section becomes empty (SALES `sales-tools` keeps 5 items, BM `bm-followup` 4, FM `fm-collection` 3, OWNER `owner-marketing` 2), so the `'owner-marketing'` key guard in `menu.test.ts` stays green. `NAV_LABELS` is still used by other entries.

- [ ] **Step 6: Remove the /crm entry from the CommandPalette `pages` array**

In `apps/web/src/components/CommandPalette.tsx` replace `:60-62`
```tsx
  { label: 'ประวัติการขาย', path: '/sales', icon: Receipt, keywords: 'sales history' },
  { label: NAV_LABELS.crm, path: '/crm', icon: Users, keywords: 'crm pipeline ติดตามลูกค้า', roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'] },
  { label: 'ลูกค้า', path: '/customers', icon: Users, keywords: 'customer ลูกค้า' },
```
with
```tsx
  { label: 'ประวัติการขาย', path: '/sales', icon: Receipt, keywords: 'sales history' },
  { label: 'ลูกค้า', path: '/customers', icon: Users, keywords: 'customer ลูกค้า' },
```
`Users` (still used by `/customers`) and `NAV_LABELS` (home / sales / contracts / payments / stock) stay imported.

- [ ] **Step 7: Run the tests, the reachability guards, the keep-list check, typecheck and lint**

Run (from `apps/web`):
```bash
TZ=UTC npx vitest run src/config/menu.test.ts src/components/CommandPalette.test.tsx src/config/__tests__/route-reachability.test.ts src/components/__tests__/command-palette-reachability.test.ts src/components/__tests__/command-palette-search.test.tsx src/components/layout/__tests__/MainLayout.zone.test.tsx
npx vitest run src/config/menu.test.ts src/components/CommandPalette.test.tsx src/config/__tests__/route-reachability.test.ts src/components/__tests__/command-palette-reachability.test.ts src/components/__tests__/command-palette-search.test.tsx src/components/layout/__tests__/MainLayout.zone.test.tsx
grep -n "Kanban\|/crm" src/config/menu.ts src/components/CommandPalette.tsx
grep -n 'path="/crm"' src/App.tsx
grep -n "'/crm'" src/components/layout/resolvePageTitle.ts
grep -n "crm:" src/config/work-navigation.ts
ls src/pages/CrmPipelinePage.tsx e2e/crm-kanban-stages.spec.ts
npx tsc --noEmit
npx eslint src/config/menu.ts src/config/menu.test.ts src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx
```
Expected:
- both vitest runs (UTC and the machine TZ): `Test Files  6 passed (6)`, no `failed` — `route-reachability.test.ts` gap A stays empty because no role keeps `/crm` in its menu (its `KNOWN_GAPS_*` lists need no edit); `command-palette-reachability.test.ts` needs no edit
- the `Kanban\|/crm` grep prints nothing (exit code 1)
- `App.tsx` prints the `<Route path="/crm" element={<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']}><CrmPipelinePage /></ProtectedRoute>} />` line · `resolvePageTitle.ts` prints `  '/crm': NAV_LABELS.crm,` · `work-navigation.ts` prints `  crm: 'ติดตามลูกค้า',` · `ls` lists both files
- `tsc` exits 0 with no output
- eslint: `✖ 4 problems (0 errors, 4 warnings)` — exactly the pre-existing `Truck` / `BadgePercent` / `LayoutGrid` / `ReceiptText` unused-import warnings in `menu.ts`; no `Kanban` warning, nothing reported for the other three files

- [ ] **Step 8: Commit the /crm hide (one commit for all four roles + the palette)**

Run (from the worktree root):
```bash
git add apps/web/src/config/menu.ts apps/web/src/config/menu.test.ts apps/web/src/components/CommandPalette.tsx apps/web/src/components/CommandPalette.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): ซ่อนเมนู "ติดตามลูกค้า" (/crm) จากทุกบทบาทและ ⌘K — route/หน้า/ข้อมูลยังอยู่

คำตัดสินเจ้าของ 2026-09-15 (ขอบเขตเฟส 3 รอบ 2 ข้อ 8): หน้า /crm มี lead 0 ใบตั้งแต่เปิด ⇒ เลิกชี้พนักงานไปหน้านี้
- menu.ts ถอด 4 รายการในคอมมิตเดียว (พนง.ขาย "เครื่องมือ" · ผจก.สาขา "ติดตาม" · ผจก.การเงิน "ติดตามหนี้" · OWNER "การตลาด")
  + import Kanban ที่ไม่มีใครใช้แล้ว + คอมเมนต์ค้าง 2 จุด
  ถอดครบทุกบทบาทพร้อมกัน: MainLayout เด้งเฉพาะเมื่อบทบาทอื่นยังมี path ในเมนู ⇒ ถอดบางบทบาท = ที่เหลือโดน toast "ไม่มีสิทธิ์"
- CommandPalette ถอดรายการ /crm ในกลุ่ม "ไปยังหน้า"
- คงไว้: route + ProtectedRoute ใน App.tsx · CrmPipelinePage · ชื่อหน้าใน resolvePageTitle · NAV_LABELS.crm · e2e crm-kanban-stages (เปิดด้วย URL)
- เทส: resolveZoneForPath(role, '/crm') = null และแถบล่างไม่มี /crm ทั้ง 5 บทบาท · palette ไม่มี "ติดตามลูกค้า" ทั้ง 5 บทบาท
  route-reachability / command-palette-reachability เขียวโดยไม่ต้องแก้

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: one commit, `4 files changed`.

- [ ] **Step 9: Decide the web version number (next after `origin/main`)**

Run (from the worktree root):
```bash
git fetch origin main
git show origin/main:apps/web/package.json | grep '"version"'
TZ=Asia/Bangkok date +%y.%-m
```
Expected: `  "version": "26.9.29",` and `26.9` ⇒ the new version is **`26.9.30`**.

Rule when the output differs (memory `bump-version-every-deploy`: `YY.M.N`, N restarts each month):
- `origin/main` shows `26.9.N` with N ≥ 30 and `date` prints `26.9` ⇒ use `26.9.(N+1)`
- `date` prints a later month (for example `26.10`) and `origin/main` is still on `26.9.*` ⇒ use `26.10.1`; if `origin/main` is already on `26.10.N` ⇒ `26.10.(N+1)`

The number this step yields replaces every `26.9.30` in Steps 10–15 (package.json, package-lock.json, the spec header line, the runbook heading / bundle grep / checklist, the commit message). Never use `npm version` (it rewrote node_modules and dropped `@prisma/client-finance` last time).

- [ ] **Step 10: Bump the web version by hand**

`apps/web/package.json` `:3` — replace
```json
  "version": "26.9.29",
```
with
```json
  "version": "26.9.30",
```

`package-lock.json` `:159-161` — replace
```json
    "apps/web": {
      "name": "@installment/web",
      "version": "26.9.29",
```
with
```json
    "apps/web": {
      "name": "@installment/web",
      "version": "26.9.30",
```

Run (from the worktree root):
```bash
grep -n '"version": "26.9.30"' apps/web/package.json package-lock.json
grep -c '"version": "26.9.29"' package-lock.json
```
Expected: exactly two lines — `apps/web/package.json:3:  "version": "26.9.30",` and `package-lock.json:161:      "version": "26.9.30",` — then `0`.

- [ ] **Step 11: Rewrite the spec for phase 3 scope v2**

In `docs/superpowers/specs/2026-09-15-customer-journey-design.md` make these five replacements.

(a) Section "บันทึกด้วยมือ (เฟส 3)" — replace the line
```markdown
(ก) คำใบ้ 'อาจเป็นคนเดียวกัน' ตอนขาย (เฟส 2, แตะเดียว)
```
with
```markdown
(ก) คำใบ้ 'อาจเป็นคนเดียวกัน' ตอนขาย (เฟส 2, แตะเดียว) — **เลื่อน ไม่อยู่ในเฟส 3** (ขอบเขตรอบ 2 ข้อ 9 — เจ้าของเคาะ 2026-09-15)
```

(b) Same section — replace the line
```markdown
(จ) การ์ดผู้สนใจใน RoomDossier ของอินบ็อกซ์
```
with
```markdown
(จ) การ์ดผู้สนใจใน RoomDossier ของอินบ็อกซ์ — **เลื่อน ไม่อยู่ในเฟส 3** (ขอบเขตรอบ 2 ข้อ 9 — เจ้าของเคาะ 2026-09-15)
```

(c) Section "สิ่งที่ระบบยังไม่บันทึกวันนี้ + ทางแก้เล็กสุด" — replace the line
```markdown
- ลูกค้าหน้าร้านรู้จักร้านจากไหน (CreateCustomerDto ไม่มีช่อง และห้ามแก้ acquisitionSource) — ทางแก้: ชิป heardFrom แตะเดียวใน CustomerCreateDialog / POS / สร้างสัญญา บันทึกเป็น entry HEARD_FROM
```
with
```markdown
- ลูกค้าหน้าร้านรู้จักร้านจากไหน (CreateCustomerDto ไม่มีช่อง และห้ามแก้ acquisitionSource) — ทางแก้: ชิป heardFrom แตะเดียวใน CustomerCreateDialog / POS / สร้างสัญญา บันทึกเป็น entry HEARD_FROM · **ทำแล้วในเฟส 3** — ถามเฉพาะลูกค้าหน้าร้าน (ธง `askHeardFrom` จาก API) ในแท็บการเดินทาง · การ์ดขั้นเลือกลูกค้าของสร้างสัญญา · CustomerCreateDialog ที่ไม่ผูกแชท · POS สร้างลูกค้าใหม่
```
If that exact line is not found because another task already edited it: run `grep -n "ลูกค้าหน้าร้านรู้จักร้านจากไหน (CreateCustomerDto" docs/superpowers/specs/2026-09-15-customer-journey-design.md`; if the printed line does not contain `ทำแล้ว`, append the text from ` · **ทำแล้วในเฟส 3**` to the end of that line; if it already contains `ทำแล้ว`, leave it.

(d) Section "เฟส" → "เฟส 2 — คำตอบการตลาด (4 วัน)" — replace the line
```markdown
- คำใบ้ SamePerson แตะเดียวในหน้า POS และสร้างสัญญา
```
with
```markdown
- ~~คำใบ้ SamePerson แตะเดียวในหน้า POS และสร้างสัญญา~~ — **เลื่อน ไม่อยู่ในเฟส 3** (ขอบเขตรอบ 2 ข้อ 9 — เจ้าของเคาะ 2026-09-15)
```

(e) Replace the whole phase-3 section — from its heading through its last bullet:
```markdown
### เฟส 3 — บันทึกมือ 1-3 แตะ (4 วัน)

- POST/DELETE journey/entries
- sheet บันทึกการติดต่อ (ชิปช่องทาง + ชิปผล + เลิกทำ)
- ชิป 'รู้จักร้านจากไหน' ใน CustomerCreateDialog / POS / สร้างสัญญา
- ป้ายหลุด/เปิดใหม่ และชิปชุดเดียวกันใน RoomDossier
- วัดการใช้งานหลัง 2 สัปดาห์
```
(if an earlier task changed any of those bullets, replace everything from the line starting `### เฟส 3 —` up to, not including, the blank line before `### เฟส 4 —`) with:
```markdown
### เฟส 3 — ระบบบันทึกเองก่อน · บันทึกมือไม่บังคับ (ขอบเขตรอบ 2 — เจ้าของเคาะ 2026-09-15)

> ขอบเขตเดิมของเฟสนี้ ("บันทึกมือ 1-3 แตะ" + ชิปใน RoomDossier) ถูกแทนด้วยคำตัดสินเจ้าของ 2026-09-15 ข้อ 1–13
> ตรวจแล้วทีมแทบไม่กรอกอะไรเอง (หน้า /crm มี lead 0 ใบตั้งแต่เปิด · call_logs มีแค่แถวทดสอบ · ยังไม่มีบัญชีพนักงานขาย)
> ⇒ **ระบบบันทึกเองก่อน ส่วนที่พนักงานกดเป็นทางเสริม ไม่บังคับ**
> แคนวาสที่เคาะ: https://claude.ai/code/artifact/8dd2fd87-8def-4f76-9e83-b981360f3abb · runbook: `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` · เว็บ 26.9.30 · ไม่มี migration

ส่งมอบ — ระบบบันทึกเอง:
- ลำดับขั้นใหม่ ตรวจเครดิตก่อนนัด: ทักเข้ามา → ได้เบอร์ / ยืนยันตัวตน → ตรวจเครดิต → นัด / จอง → ซื้อแล้ว (ชื่อ enum เดิม · ป้าย `INTERESTED` เปลี่ยนเป็น "นัด / จอง") · ค่า `stage` ในแคชเปลี่ยนความหมาย ⇒ คำนวณแคชใหม่ทั้งหมดหลัง deploy
- ลูกค้าส่งไฟล์เอกสารในแชท (`chat_messages` role `CUSTOMER` + type `FILE` + `media_url` ลงท้าย .pdf / .doc(x) / .xls(x) — เงื่อนไขเดียว `CUSTOMER_DOCUMENT_FILE_SQL` ใน `chat-document-file.ts` · media_url อยู่ในเงื่อนไขเท่านั้น ไม่เลือกออกมา · ไม่อ่านชื่อไฟล์ / เนื้อหา · คำตัดสินผู้ควบคุม R-P1) = หลักฐานขั้นตรวจเครดิต แต่ไม่ตั้งเส้นทางเป็นผ่อน · ไทม์ไลน์หนึ่งแถวต่อห้องต่อวัน "ลูกค้าส่งไฟล์ในแชท" (+ " N ไฟล์" เมื่อมากกว่า 1) · คำใต้ขั้น "ส่งไฟล์ในแชท" · ช่อง KPI เครดิต "ส่งไฟล์แล้ว รอตรวจ" เมื่อยังไม่มีผลตรวจ
- ซื้อสดโดยไม่มีหลักฐานเครดิต → ขั้นตรวจเครดิตสีเทา "ไม่ต้องตรวจ (ซื้อสด)" · ซื้อผ่านไฟแนนซ์นอก → "ไฟแนนซ์นอกตรวจ" (ทั้งคู่ไม่นับเป็นข้าม) · มีนัด / จองแต่ไม่มีหลักฐานเครดิต → "ข้าม" ธรรมดา
- ออมเครื่อง + สั่งซื้อออนไลน์ = หลักฐานขั้นนัด / จอง (เพิ่มจาก touchpoint นัดแล้ว / มาร้านแล้ว · จอง · todo นัดที่มีวัน · สมัครผ่อนออนไลน์ · จองสินค้าบนเว็บ · รับซื้อ/เทิร์น)
- เอกสาร 6 ชนิดที่ลูกค้าสร้างหลังติดป้ายหลุด (จอง · สมัครผ่อนออนไลน์ · จองสินค้าบนเว็บ · รับซื้อ/เทิร์น · ออมเครื่อง · สั่งซื้อออนไลน์) ล้างป้ายหลุดเอง · ทุกชนิดมีแถวของตัวเองในไทม์ไลน์ (กลุ่มขาย · ไม่มีลิงก์ · คัดแค่ id + เวลา — ออมเครื่อง / สั่งซื้อออนไลน์ / จองเครื่องบนเว็บ / สมัครผ่อนออนไลน์ / เทิร์นเครื่อง ขึ้นแถวครั้งแรกในเฟส 3 และหลุดจากรายการ "ระบบยังไม่เก็บ") ⇒ ป้ายที่ล้างด้วยเอกสารมีแถวอธิบายเสมอ
- แถว "กลับมาติดต่ออีกครั้ง" = ข้อความลูกค้าแรกหลังการติดป้ายหลุดล่าสุด (ไม่ขึ้นเมื่อมีเอกสาร 6 ชนิดข้างบนอธิบายการล้างอยู่แล้ว)
- แถว "ร้านตอบครั้งแรก (หลังทัก N นาที / N ชม. / N วัน)" จาก `firstStaffReplyAt` · ผู้ทำ "ร้าน (ไม่ทราบชื่อ)" · ค่าประมาณ · ไม่มีลิงก์
- ที่มาจากโฆษณานับเฉพาะ `ads_attributions.referrer_url = 'ADS'` · ห้องที่ผูกโฆษณาแล้วไม่ถูกย้ายไปที่มาอื่น

ส่งมอบ — พนักงานกด (ไม่บังคับ · OWNER / ผจก.สาขา / ผจก.การเงิน / พนง.ขาย · ฝ่ายบัญชีไม่เห็นปุ่ม):
- `POST /customers/:id/journey/entries` + `DELETE /customers/:id/journey/entries/:entryId` · กันซ้ำด้วย `clientRequestId` ใหม่ทุกการแตะ · เวลาเป็นเวลาเซิร์ฟเวอร์เสมอ
- ปุ่ม "บันทึกการติดต่อ" ในแท็บการเดินทาง: ชิปช่องทาง 4 (โทร · แชทในแอป FB · LINE · หน้าร้าน — จำค่าล่าสุด) + ชิปผล 7 · แตะผล = บันทึก · toast "เลิกทำ" · "ซื้อที่อื่น" / "ไม่สนใจ" ถามต่อ "ติดป้ายหลุดไหม"
- แถบขั้น: "ติดป้ายหลุด" (เลือกเหตุผลจากชิป 5 ตัว) · "เปิดใหม่" (ทางสำรอง — ป้ายหลุดส่วนใหญ่ล้างเอง)
- "เลิกทำ": OWNER / ผจก.สาขา ลบรายการที่พนักงานบันทึกได้ทุกเมื่อ · ผจก.การเงิน / พนง.ขาย เฉพาะของตัวเองภายใน 24 ชม.
- "รู้จักร้านจากไหน" ถามเฉพาะลูกค้าหน้าร้าน (ธง `askHeardFrom` คิดที่ API): แถบบนแท็บการเดินทาง · การ์ดขั้นเลือกลูกค้าของสร้างสัญญา · ชิปใน CustomerCreateDialog (ไม่แสดงเมื่อผูกกับห้องแชท) และ POS สร้างลูกค้าใหม่ · ลูกค้าที่ทักแชทก่อนเห็นบรรทัดอ่านอย่างเดียว "ทักแชทครั้งแรกทาง …" · ระบบไม่เขียน heardFrom เอง
- ซ่อนเมนู "ติดตามลูกค้า" (/crm) จากเมนูทุกบทบาทและจาก ⌘K (ข้อ 8) — route · หน้า · ข้อมูล lead · ชื่อหน้า · e2e ยังอยู่ เปิดด้วย URL ได้ · คืนเมนูต้องคืนให้ทั้ง 4 บทบาทพร้อมกัน
- วัดการใช้งานหลัง 2 สัปดาห์ (คิวรีและวันวัดใน runbook เฟส 3 หัวข้อ "ตัวชี้วัดการใช้งานบันทึกมือ" — เริ่มนับจาก `<LAUNCH_UTC>` ที่หัวข้อนั้นนิยาม) — entries MANUAL ≈ 0 ให้คงไว้แต่ไม่ขยาย

เลื่อน — ไม่อยู่ในเฟส 3:
- (จ) ชิปบันทึกใน RoomDossier ของอินบ็อกซ์ (ทีมยังไม่ใช้อินบ็อกซ์ — R21)
- (ก) คำใบ้ "อาจเป็นคนเดียวกัน" ตอนขายที่ POS / สร้างสัญญา
- AI อ่านแชทเพื่ออนุมานผลการติดต่อ — เฟสถัดไป วางแผนแยก (PDPA · ความแม่น · ต้นทุน)
- ช่องโน้ต และช่องเปลี่ยนเวลา ในทุกรายการ (รวมติดป้ายหลุด — เหตุผลเป็นชิปอย่างเดียว) · ชิปช่องทาง "อื่น ๆ" (ป้ายคงไว้ให้อ่านแถวเก่า)
- เก็บสายโทรจาก PBX / Yeastar
- ติดป้ายหลุดอัตโนมัติเมื่อเงียบ (ไม่ทำ — ป้าย "เงียบ" ครอบอยู่แล้ว) · ป้ายใน Meta Business Suite (ทีมไม่ใช้)

ข้อจำกัดที่รู้แล้ว:
- webhook Facebook เก็บไฟล์แนบชนิดที่ไม่รู้จัก (fallback / template เช่นลูกค้าแชร์ลิงก์) เป็น `FILE` · ระบบนับเฉพาะไฟล์เอกสารจากนามสกุลใน media_url จึงตัด media_url ว่างและลิงก์แชร์ออกแล้ว (R-P1) · เลิกแปลงลิงก์แชร์เป็น `FILE` ที่ตัวแปลงของ webhook = งานต่อยอดที่เจ้าของต้องตัดสิน
- `note` ไม่ถูกเพิ่มใน `SENSITIVE_FIELDS` ของ audit (คำตัดสินผู้ควบคุม R-P2 ถอยกลับ 2026-09-16 — ถ้าเพิ่ม โน้ตปลดล็อกเครื่อง MDM ที่มีอยู่ใน audit_logs ที่เดียวจะหายถาวร และสำเนา audit ของใบซ่อม / `account_role_map` / โปรไฟล์พนักงาน และอื่น ๆ จะถูกมาสก์) · `POST /customers/:id/journey/entries` ไม่มีช่อง note และหน้าเว็บไม่เคยส่ง แต่ client อื่นที่ส่ง `note` มาเองยังถูก AuditInterceptor เก็บลง audit_logs (ลบไม่ได้) = ความเสี่ยงที่ยอมรับ
- ฝ่ายบัญชีเห็นคำใต้ขั้น "ส่งไฟล์ในแชท" และค่า KPI "ส่งไฟล์แล้ว รอตรวจ" (ชนิด + เวลาเท่านั้น — แนวเดียวกับ FR-CREDIT-STAGE)
- ถอย API image ข้ามเส้นเฟส 3 ต้องคำนวณแคชใหม่ด้วย image ที่ถอยไปทุกครั้ง (ความหมายของ `stage` ผูกกับลำดับขั้นของ image ที่เขียนล่าสุด)
- ลิงก์สินค้า m.me ไม่สร้างแถว `ads_attributions` อีกต่อไป (กลับทิศ `5f0dc62c4`) — โน้ตสินค้าในห้องยังเหมือนเดิม
```

- [ ] **Step 12: Runbook — order-table row 6 + the web section at the end**

(a) In `docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` replace the table line
```markdown
| 5 | ตรวจหลัง backfill |
```
with
```markdown
| 5 | ตรวจหลัง backfill |
| 6 | เว็บ: ตรวจบันเดิล + ซ่อน /crm ด้วยตา (หัวข้อ "เว็บ 26.9.30 …" ท้ายไฟล์) → 14 วันหลัง `<LAUNCH_UTC>`: ตัวชี้วัด (หัวข้อ "ตัวชี้วัดการใช้งานบันทึกมือ") |
```

(b) Go to the last line of the same file, add one blank line, and append this section exactly:
~~~~markdown
## เว็บ 26.9.30 · ซ่อนเมนู /crm (Task 15)

เว็บเฟส 3 = `apps/web` เลข `26.9.30` (ต่อจาก 26.9.29 ของ PR "ร้านตอบครั้งแรก" #1595) · ไม่แตะ `apps/web-shop`

### ก่อน merge (เว็บ)

- `git fetch origin main && git show origin/main:apps/web/package.json | grep '"version"'` ต้องได้ `"version": "26.9.29",`
  - main ขยับไปแล้ว (PR อื่น merge ก่อน) = bump PR นี้เป็นเลขถัดจาก main ก่อนกด merge ทั้ง `apps/web/package.json` และ `package-lock.json` (แก้มือ ห้าม `npm version`) — เลขซ้ำกัน = เจ้าของแยกไม่ออกจาก VersionBadge ว่าเครื่องได้โค้ดเฟส 3 แล้วหรือยัง
- release ของ Firebase Hosting ที่จดในข้อ 1.2 คือจุดถอยเว็บของหัวข้อนี้ด้วย

### หลัง merge (เว็บ) — ต่อจากด่านข้อ 2

1. 🚨 เว็บขึ้นก่อน API ได้ — เว็บเฟส 3 กับ API เก่า:
   - ปุ่ม "บันทึกการติดต่อ" · "ติดป้ายหลุด" · "เปิดใหม่" · ชิป "รู้จักร้านจากไหน" ได้ข้อความ error (API เก่าไม่มี `POST /customers/:id/journey/entries`)
   - สร้างลูกค้าใหม่ที่เลือกชิปยังสำเร็จ แต่มี toast "บันทึกลูกค้าแล้ว แต่บันทึกช่องทางที่รู้จักไม่สำเร็จ"
   - แถบ / การ์ด "รู้จักร้านจากไหน" ไม่ขึ้น (API เก่าไม่ส่ง `askHeardFrom`)
   - ⇒ `deploy-web` เขียว แต่ `build-and-push-api` / `migrate-db` / `deploy-api` ตัวใดไม่เขียว (แดง · ยกเลิก · หรือ skipped) = ถอยเว็บทันที ("ถอยเว็บ (เฟส 3)" ด้านล่าง)
2. บันเดิลเป็นเลขของ PR นี้:
   ```bash
   JS=$(curl -s https://bestchoicephone.app/ | grep -o '/assets/index-[^"]*\.js' | head -1)
   curl -s "https://bestchoicephone.app$JS" | grep -c '26.9.30'
   ```
   - ต้องได้ตัวเลข **≥ 1** · ได้ 0 = บันเดิลยังเก่า (`deploy-web` ยังไม่จบ หรือ cache) — รอ 5 นาทีแล้วรันซ้ำ · ยัง 0 = เปิด log ของ `deploy-web`
3. ทำขั้น 3–5 (`backfill:customer-journey`) ของไฟล์นี้ให้จบในวันเดียวกัน — เว็บเฟส 3 วาดแถบขั้นจากแคช ถ้ายังไม่คำนวณใหม่ ลำดับใหม่และหลักฐานใหม่ (ไฟล์ในแชท · ออมเครื่อง · สั่งซื้อออนไลน์ · เอกสารล้างป้ายหลุด) ยังไม่ขึ้น
4. ตรวจด้วยตา — ล็อกอิน OWNER บนคอมพิวเตอร์ แล้วซ้ำบนมือถือหนึ่งรอบ:
   - VersionBadge มุมจอเป็น `26.9.30`
   - เมนูหมวด "การตลาด" เหลือ `Ads & ROI` · `Broadcast` — ไม่มี "ติดตามลูกค้า"
   - กด Ctrl+K (Mac: ⌘K) พิมพ์ `crm` → ไม่มี "ติดตามลูกค้า"
   - เปิด `https://bestchoicephone.app/crm` ตรง ๆ → หน้าเปิดได้ ไม่มี toast "คุณไม่มีสิทธิ์เข้าถึงหน้านี้" (ตั้งใจ — route · หน้า · ข้อมูล lead ยังอยู่)
   - หน้า `/customers/<customer_id>` ของคนที่ได้จากคิวรีท้ายขั้น 5 → แถบขั้นเรียง ทักเข้ามา → ได้เบอร์ / ยืนยันตัวตน → ตรวจเครดิต → นัด / จอง → ซื้อแล้ว · มีปุ่ม "ติดป้ายหลุด" บนแถบขั้น และ "บันทึกการติดต่อ" ในแท็บการเดินทาง · บนมือถือปุ่มไม่ล้นจอ
   - ไม่ต้องกดบันทึกทดสอบกับลูกค้าจริง — เผลอกดให้กด "เลิกทำ" ใน toast ทันที
5. **ไม่ต้องประกาศบังคับให้ทีมกดบันทึก** — คำตัดสินข้อ 1: ระบบบันทึกเองก่อน ปุ่มเป็นทางเสริม (ตัวชี้วัดวัดการใช้โดยสมัครใจ)
6. ตัวชี้วัด 2 สัปดาห์ = หัวข้อ "ตัวชี้วัดการใช้งานบันทึกมือ — 2 สัปดาห์หลังเปิด" ของไฟล์นี้ **ที่เดียว** — วันเริ่มนับคือ `<LAUNCH_UTC>` ตามนิยามในหัวข้อนั้น (ไม่ใช่วันที่ตรวจเว็บข้อนี้) · จด `<LAUNCH_UTC>` และวันวัดลง PR วันนี้

### ถอยเว็บ (เฟส 3)

- Firebase console → Hosting → site admin (`bestchoicephone.app`) → ประวัติ release → Rollback ไป release ที่จดในข้อ 1.2 · site shop ไม่ต้องถอย
- **ถอยเฉพาะเว็บ** (สาย API ไม่เขียว หรือบั๊กอยู่ที่หน้าจออย่างเดียว) ไม่ต้องคำนวณแคชใหม่ — เว็บ 26.9.29 ใช้กับ API เฟส 3 ได้ เพราะ API เฟส 3 เพิ่มฟิลด์และ endpoint ใหม่เท่านั้น · สิ่งที่เห็นต่างระหว่างนั้น:
  - ขั้นที่ 4 ใช้ป้ายเก่า "สนใจจริง" แต่เรียงตามลำดับใหม่ (หลังตรวจเครดิต)
  - ผู้ซื้อสด / ไฟแนนซ์นอกที่ไม่มีหลักฐานเครดิต เห็นขั้น 3 เป็นจุดไม่มีสี คำใต้ขั้น "—" (เว็บเก่าไม่รู้จักสถานะ `not_needed`)
  - เมนู "ติดตามลูกค้า" กลับมาทั้ง 4 บทบาท · ปุ่มบันทึกทุกตัวหายไป
- **ถอย API ด้วย** = ทำ "ถอยเพราะลำดับขั้น" ครบทุกข้อ (ถอยเว็บคู่กันเสมอ · ปุ่มของเว็บเฟส 3 ยิง endpoint ที่ API เก่าไม่มี · ต้องคำนวณแคชใหม่ด้วย image ที่ถอยไป)
- รายการที่พนักงานบันทึกระหว่างเฟส 3 (`customer_journey_entries` origin `MANUAL`) **ห้ามลบตอนถอย** — ตาราง/คอลัมน์เดิม API เก่าแสดงแถว TOUCHPOINT / HEARD_FROM / MARKED_LOST / REOPENED ได้อยู่แล้ว
- PR revert ถาวรต้อง bump `apps/web/package.json` + `package-lock.json` เป็นเลขถัดไป (revert แตะ `apps/web/src/**` จึง deploy เว็บซ้ำ)
- จะเอาเมนู "ติดตามลูกค้า" กลับ = คืนให้ **ทั้ง 4 บทบาทพร้อมกัน** (OWNER · ผจก.สาขา · ผจก.การเงิน · พนง.ขาย) — คืนบทบาทเดียว = อีกสามบทบาทเปิด /crm แล้วโดนเด้งพร้อม toast "คุณไม่มีสิทธิ์เข้าถึงหน้านี้" (เทส `apps/web/src/config/menu.test.ts` จะแดง)
~~~~

Do **not** add a metric subsection or a second start date here — Task 7's section already holds the only 2-week metric (per-kind, per-staff and kept/undone queries, all from `<LAUNCH_UTC>`).

- [ ] **Step 13: Check the docs edits**

Run (from the worktree root):
```bash
grep -c "^### เฟส 3 — ระบบบันทึกเองก่อน · บันทึกมือไม่บังคับ" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "บันทึกมือ 1-3 แตะ (4 วัน)" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "ชิปชุดเดียวกันใน RoomDossier" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "เพิ่มโน้ต" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "'เปลี่ยนเวลา' (ย้อนได้ 7 วัน)" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "เลื่อน ไม่อยู่ในเฟส 3" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "ทำแล้วในเฟส 3" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "^### เฟส 4 —" docs/superpowers/specs/2026-09-15-customer-journey-design.md
grep -c "^| 6 | เว็บ: ตรวจบันเดิล" docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -c "^## เว็บ 26.9.30 · ซ่อนเมนู /crm (Task 15)$" docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -c "ตัวชี้วัด 2 สัปดาห์" docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -c "^## ตัวชี้วัดการใช้งานบันทึกมือ — 2 สัปดาห์หลังเปิด" docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
grep -c "+07'\|วันเริ่มนับ YYYY" docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
tail -n 1 docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
```
Expected, in order: `1` · `0` · `0` · `0` · `0` · `3` (the (ก) heading, the (จ) heading and the phase-2 bullet — the deferred list inside the new section is headed `เลื่อน — ไม่อยู่ในเฟส 3:` and does not match) · `1` · `1` (phase-4 heading untouched) · `1` · `1` · `1` (only item 6 of the web section says "ตัวชี้วัด 2 สัปดาห์", pointing at Task 7's section) · `1` (Task 7's metric section is the only one) · `0` (no Bangkok-time start date anywhere) · the last line is the bullet starting `- จะเอาเมนู "ติดตามลูกค้า" กลับ` — i.e. the appended section ends the file.

- [ ] **Step 14: Final full runs (once — everything green before the docs/version commit)**

Run in this order, from the worktree root unless the command changes directory itself:
```bash
npm run build --workspace=@installment/shared
npm run test --workspace=@installment/shared
./tools/check-types.sh all
ls /tmp/bc-chat-prospects-pg/socket/.s.PGSQL.55491
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" JWT_SECRET=test-secret TZ=Asia/Bangkok NODE_ENV=test npm run test --workspace=apps/api
(cd apps/api && npx nest build && npm run verify:assets)
TZ=UTC npm run test --workspace=apps/web
npm run test --workspace=apps/web
(cd apps/web && npx eslint src/config/menu.ts src/config/menu.test.ts src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx)
git status --short
```
Expected:
- shared build exits 0 · shared tests `Test Files  N passed (N)` with no `failed`
- `check-types.sh all` ends with `API: OK`, `Web: OK`, `TypeScript check passed!` (if tsc reports `Cannot find module '@prisma/client-finance'`, run `npm run prisma:finance:generate --workspace=apps/api` once and rerun — known worktree side effect)
- the socket path is listed (the per-file test cluster used by Tasks 1–14 is running; if `ls` fails, stop and report — do not start another cluster or point at any other database)
- API jest (its `pretest` rebuilds shared, then `jest --runInBand --forceExit`): the `Test Suites:` line has no `failed` count. `bc_journey_test` satisfies the `test_db` / `*_test` name guards; `prisma-finance.service.spec.ts` skips itself without `DATABASE_URL_FINANCE`. If a suite fails: rerun that file alone with the same env; if it still fails **and** `git log --oneline origin/main..HEAD -- <that file's directory>` prints nothing (no phase-3 commit touched it), record it in the PR body as pre-existing with the failing test name; otherwise fix it in the task that touched it before continuing
- `✓ Assets verified` (the customer-journey SQL files Tasks 2/3/9 edited are copied into `dist`)
- web vitest in UTC and in the machine TZ: `Test Files  N passed (N)` with no `failed`, both runs
- eslint: `✖ 4 problems (0 errors, 4 warnings)` (the pre-existing `menu.ts` warnings only)
- `git status --short` lists exactly `M apps/web/package.json`, `M package-lock.json`, `M docs/superpowers/specs/2026-09-15-customer-journey-design.md`, `M docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md` among tracked files (untracked files of other sessions may also appear — never add those; `apps/api/dist` is git-ignored)

- [ ] **Step 15: Commit docs + version**

Run (from the worktree root):
```bash
git add apps/web/package.json package-lock.json docs/superpowers/specs/2026-09-15-customer-journey-design.md docs/superpowers/runbooks/2026-09-15-customer-journey-phase3-deploy.md
git commit -m "$(cat <<'EOF'
docs(customer-journey): ปิดงานเฟส 3 ขอบเขตรอบ 2 — สเปคส่งมอบ/เลื่อน · runbook เว็บ + ถอย · web 26.9.30

เว็บเปลี่ยน (แท็บการเดินทาง · แถบขั้น · ชิปรู้จักร้าน · ซ่อน /crm) ⇒ ขึ้นเลขเวอร์ชัน 26.9.29 → 26.9.30
(apps/web/package.json + package-lock.json แก้มือ — เลขถัดจาก origin/main ตอน merge)

สเปค:
- หัวข้อเฟส 3 เขียนใหม่ตามคำตัดสินเจ้าของ 2026-09-15 ข้อ 1–13: ส่งมอบฝั่งระบบบันทึกเอง / ฝั่งพนักงานกด (ไม่บังคับ)
  · ซ่อนเมนู /crm · รายการเลื่อน (RoomDossier · คำใบ้คนเดียวกัน · AI อ่านแชท · ช่องโน้ต/เปลี่ยนเวลา · PBX) · ข้อจำกัดที่รู้แล้ว
- (ก) / (จ) / บรรทัด SamePerson ของเฟส 2 ติดป้ายเลื่อน · บรรทัด "รู้จักร้านจากไหน" ในรายการยังไม่บันทึก = ทำแล้ว

runbook เฟส 3:
- ขั้น 6 ในตารางลำดับ + หัวข้อเว็บ: ด่านเลขเวอร์ชันก่อน merge · เว็บขึ้นก่อน API เห็นอะไร · คำสั่งตรวจบันเดิล
  · ตรวจด้วยตา (เมนู การตลาด · ⌘K · เปิด /crm ด้วย URL · แถบขั้นลำดับใหม่) · ไม่ประกาศบังคับทีม
- ถอยเว็บอย่างเดียวไม่ต้องคำนวณแคช (เว็บเก่าใช้กับ API ใหม่ได้ + สิ่งที่เห็นต่าง) · ถอย API = ถอยเพราะลำดับขั้นครบข้อ
  · ห้ามลบรายการ MANUAL · คืนเมนู /crm ต้องคืนทั้ง 4 บทบาท
- ตัวชี้วัด 2 สัปดาห์: ชี้ไปหัวข้อ "ตัวชี้วัดการใช้งานบันทึกมือ" ที่เดียว (เริ่มนับ <LAUNCH_UTC> · คิวรี kept/undone อยู่ในหัวข้อนั้น)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -2
```
Expected: the two newest commits are `docs(customer-journey): ปิดงานเฟส 3 …` (4 files changed) and `feat(web): ซ่อนเมนู "ติดตามลูกค้า" (/crm) …`. No `git push` — the PR is opened when the owner says so; if `origin/main` moves before merge, redo Steps 9–10 (plus the `26.9.30` occurrences from Steps 11–12) and amend only this commit.
