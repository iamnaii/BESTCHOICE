# Customer Journey — Phase 3 design brief (manual recording in 1-3 taps)

Worktree: `/Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/feat+customer-detail-journey`. All paths below are relative to it.

Spec: `docs/superpowers/specs/2026-09-15-customer-journey-design.md`
- manual recording §405-450
- phase-3 plan §551-556
- API §318-339
- OD-12 §573-574

Owner rule (2026-09-06): **the mockup must be approved before any code is written.** This brief feeds two things: (a) the mockup boards and (b) the implementation plan.

When this brief disagrees with the spec, it follows the **shipped code** and says why. Items marked **DEFAULT** are recommendations waiting for an owner ruling (§5).

---

## 0. SCOPE V2 — owner rulings 2026-09-15 (SUPERSEDES the rest of this brief where they conflict)

Context: the owner asked "what can the system record automatically, since staff very likely won't fill anything in". An audit (workflow wf_1b9e54a3-19e, verified against code and prod aggregates) found: /crm manual pipeline exists in the menu with 0 leads ever; call_logs 3 test rows; inbox unused since ~2026-09-06; 0 SALES accounts. Owner rulings:

1. **Automatic first. Manual is optional.**
2. **Customer sends a file in chat → automatic timeline row AND INTERESTED stage evidence.** Signal: chat_messages role='CUSTOMER' AND type='FILE' (FB file attachment saved at apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts:546-550). Use timestamp + type only — never media_url, file name or contents. Prod: 951 files in 456 rooms, 184 rooms in the last 30 days (INTERESTED today = 1). Images are NOT a signal (staff images appear in ~6,800 rooms). Timeline title: "ลูกค้าส่งไฟล์เอกสารในแชท" (chat group, same room scope/role gate as other chat rows). Stage caption evidence on สนใจจริง: "ส่งไฟล์ในแชท".
3. **Heard-from ("รู้จักร้านจากไหน") is asked ONLY for walk-in customers** (state.first_source = 'WALK_IN', heard_from IS NULL; do not hide for first-time buyers; hide only for repeat buyers purchaseCount ≥ 2). Chat/ad/referral-first people: no banner, no chips; show the known first-contact channel read-only (e.g. "ทักครั้งแรกทาง Facebook"). Never write heard_from automatically. Create flows (CustomerCreateDialog, POS quick-create, ContractCreate step card) keep the chips for NEW walk-in customers, optional. Prod: 39 walk-in vs 9,028 chat-first.
4. **Record-contact button = slim, one tap, optional.** Channel chips + outcome chips + row-level "เลิกทำ". REMOVE the note field (Q1 moot) and the change-time field. Lost/reopen on the stage strip stays (Q2 reason picker), "เปิดใหม่" becomes a rare fallback because reopen is automatic (item 6).
5. **More automatic signals (no UI control):** saving_plans (ออมเครื่อง) and online_orders join interest evidence (journey module ignores them today); repeat of bookings/online applications/reservations/trade-ins/saving plans after a MARKED_LOST clears lost.
6. **"กลับมาติดต่ออีกครั้ง"** read-time row = first CUSTOMER chat message after the latest active MARKED_LOST (chat group, room scope). Document-based clearing does NOT emit this row (the document row explains it).
7. **Fix FB ad attribution correctness before ads data flows** (count as ad only when ads_attributions.referrer_url='ADS'; linkAttribution must not re-point an ADS attribution to a non-ADS one). Backend only.
8. **Hide /crm from the menu** (apps/web/src/config/menu.ts lines ~196, 279, 379, 842). Keep code and data; route may stay reachable by URL.
9. **DEFERRED (not phase 3):** (จ) RoomDossier chip bar; (ก) same-person hint at sale; AI reading chat to infer outcomes (owner wants it as the NEXT phase — plan separately with PDPA/accuracy/cost); PBX/Yeastar call capture; auto-mark lost after silence (NO — silent badge already covers it); Meta Business Suite labels (staff do not use them).
10. **Already fixed separately (backend, not in the phase-3 plan):** message_echoes added to Facebook subscribe defaults; journey-state.sql staff_reply no longer requires outbound_sent_at (first_staff_reply_at was 1/9,067 on prod).
11. **Stage order changes: credit check comes BEFORE the appointment** (owner 2026-09-15 "ต้องเช็คเครดิตก่อนนัด"). This changes phase-1 shipped behaviour (packages/shared/src/customer-journey.ts JOURNEY_STAGES + STAGE_LABELS, journey-state.sql, journey-summary builder, JourneyStageStrip and every consumer of stage order).
    - New order and labels: ① CONTACTED "ทักเข้ามา" → ② IDENTIFIED "ได้เบอร์ / ยืนยันตัวตน" → ③ CREDIT "ตรวจเครดิต" → ④ INTERESTED relabelled "นัด / จอง" → ⑤ PURCHASED "ซื้อแล้ว". Enum names stay (no data migration); only order and the INTERESTED label change.
    - **Customer file in chat counts toward CREDIT (step ③), not INTERESTED** — this REPLACES ruling 2's stage target. Caption evidence on ③: "ส่งไฟล์ในแชท". A credit result (approved/rejected) still comes from credit checks; rejected keeps the red step.
    - Step ④ "นัด / จอง" evidence: APPOINTED/VISITED touchpoints, bookings, dated appointment todos, online installment applications, product reservations, trade-ins, saving plans, online orders.
    - **Cash buyers:** after a CASH purchase (saleType CASH) with no credit evidence (external-finance sales keep the shipped behaviour — open question for the owner), step ③ shows a greyed state "ไม่ต้องตรวจ (ซื้อสด)" — NOT counted as skipped. Before any purchase, a prospect with ④ evidence but no ③ evidence shows ③ as the normal not-yet-reached/skipped rule of the shipped strip (decide from JourneyStageStrip + journey-summary.builder skipped rule and caption the choice).
12. **Controller rulings after canvas v2 review (2026-09-15, shown on the canvas for owner approval):**
    - **File-in-chat timeline row = one row per room per day**, not one per file: title "ลูกค้าส่งไฟล์ในแชท" + " N ไฟล์" when N > 1 (951 files / 456 rooms would otherwise spam). Link /inbox/:roomId, chat group, exact. Credit step ③ evidence caption stays "ส่งไฟล์ในแชท".
    - **First staff reply row is IN phase 3** as a new read-time event source from state.firstStaffReplyAt (does not exist in code today). Title "ร้านตอบครั้งแรก (หลังทัก {gap})" with gap formatted "N นาที" (< 60 min) / "N ชม." (< 24 h) / "N วัน". Actor "ร้าน (ไม่ทราบชื่อ)", approximate, chat group, no link.
    - **Heard-from ask flag is computed once by the API** (summary field, e.g. askHeardFrom) and used by the journey banner and the ContractCreate card. CustomerCreateDialog hides the chips whenever the dialog is linked to a chat room (RoomDossier "บันทึกและผูกกับแชท", /customers?new=1&fromRoomId).
    - **Read-only first-contact wording = the shipped timeline wording "ทักแชทครั้งแรกทาง Facebook"** (one wording everywhere). Referral-first customers: show nothing extra (referredById has no web writer; the KPI tile "ที่มา" already shows it).
    - **Online orders also clear lost**, same as the other customer-created documents in ruling 5.
    - **Lost reasons are chips only** (no note on MARKED_LOST).
    - **"N วัน" never splits across lines** (no-break space between number and วัน in step captions).
    - **One tag style on every board** (B3's: solid border, dot, 12px): "ระบบบันทึกเอง" (recorded automatically) · "ระบบคำนวณเอง" (computed when read, e.g. silent badge) · "พนักงานกด (ไม่บังคับ)" · decision pills "Qn".
    - Open question for the owner on the canvas: external-finance purchases (e.g. GFIN) — how should step ③ ตรวจเครดิต look.
13. **OWNER APPROVED canvas v2 (https://claude.ai/code/artifact/8dd2fd87-8def-4f76-9e83-b981360f3abb) on 2026-09-15 — "เคาะตามที่เสนอทั้งหมด".** This includes: all Q defaults drawn on the boards (Q2 Q3 Q4 Q5 Q6 Q8 Q15 Q16 Q17 Q18 Q19), rulings 11-12, and the three open questions resolved as: (1) external-finance purchase → step ③ greyed "ไฟแนนซ์นอกตรวจ" (same visual treatment as "ไม่ต้องตรวจ (ซื้อสด)"); (2) appointment/booking without credit evidence → step ③ shows the shipped grey "ข้าม" (plain, no suffix); (3) KPI tile "เครดิต" shows "ส่งไฟล์แล้ว รอตรวจ" when a chat file exists but no credit check result. Implementation notes from the boards: skippedCaption suffix "(เงินสด)/(ไฟแนนซ์นอก)" must apply only to the CREDIT step; withLiveBought fallback order becomes INTERESTED, CREDIT, IDENTIFIED; chat-file evidence must NOT set path=INSTALLMENT; JourneyStep.evidence needs a new value for "ส่งไฟล์ในแชท" on CREDIT; file row time = latest file of the day; no-break space in "N วัน".

Remaining canvas questions — apply the recommended defaults and show them for approval on the revised canvas: Q2 reason picker (2 taps) · Q3 no lost prompt after ไม่รับสาย · Q4 no-op/allowed · Q5 OWNER/BM delete any time, FM/SALES own within 24h · Q6 clientRequestId dedupe · Q8 FM may record · Q15 stage caption wraps to 2 lines (line-clamp-2) · Q16 record button on its own right-aligned row above the filter chips · Q17 mobile 44px (max-lg:h-11) · Q18 "เลิกทำ" link driven by canDelete · Q19 accept 3-row outcome chips. Q1, Q7, Q9-Q14, Q20 are moot under this scope.


## 1. Scope

| # | Spec item | Spec phase | In phase 3? | Note |
|---|---|---|---|---|
| API | `POST /customers/:id/journey/entries` + `DELETE …/entries/:entryId` | 3 (§323-339, §553) | **Yes — foundation** | The controller has only 2 GET routes today (`apps/api/src/modules/customer-journey/customer-journey.controller.ts:19-31`) |
| (ข) | Chip row "รู้จักร้านจากไหน" (9 chips) in the create flows, plus a banner at the top of the journey tab | 3 (§420-425) | **Yes** | |
| (ค) | "+ บันทึกการติดต่อ" → popover (desktop) / bottom sheet (mobile): channel chips + outcome chips + undo + optional note/time | 3 (§427-433) | **Yes — core** | |
| (ง) | "ติดป้ายหลุด" / "เปิดใหม่" buttons on the stage strip | 3 (§435-436) | **Yes** | |
| (จ) | The same chips in the inbox RoomDossier prospect card (roomId attached automatically) | 3 (§438-440) | **Yes, lowest priority** | R21: the team does not use the inbox yet. Build it on the shared chip component so it costs almost nothing. Do not count it in the 2-week metric. |
| (ก) | Same-person hint at POS / contract customer selection | The body says **phase 2** (§412). OD-12 (§573-574) moves it to "เฟส 3 หลัง backfill ผู้สนใจ" and groups it with heard-from. | **Recommend: include it as its own last task, gated on readiness** | It is the only way a sale gets counted toward the chat channel (§418). It depends on the chat-prospects backfill running on prod, which is not confirmed. The merge cannot be undone. Show it in the mockup now; ship it as an independent task that is allowed to slip. |
| — | Metric: count MANUAL entries per staff member after 2 weeks | 3 (§447, §556) | Yes (a read-only SQL/MCP query, no UI) | |
| — | Read-time event "กลับมาติดต่ออีกครั้ง" (spec event table §244/§271) | 1-2 (not implemented — grep finds nothing) | **Recommend: include (small)** | When a lost badge clears automatically (`apps/api/src/modules/customer-journey/sql/journey-state.sql:218-221`), the timeline gives no reason. Phase 3 is what makes "lost" common. |
| — | Funnel, `journeyStage` filter on /customers | 2 | No | |
| — | Ads data / `markConversion` | 4 | No | |

The spec's "ไม่ทำ" list (§442-446) still applies: no long form, no mandatory note, no manual stage selection, no separate follow-up list.

The old unpublished mockup `scratchpad/customer-detail-mockup/journey.mjs:30-47` has a "นัดต่อไป" date field and a save button. Both **contradict the spec — drop them.**

Spec typo: `SameProsonService` (§414) is really `SamePersonService` (`apps/api/src/modules/chat-prospects/same-person.service.ts:24`).

---

## 2. UI elements

### 2.0 Shared foundation (web)

**`ChoiceChip` / `ChoiceChipRow`**
- New component in `apps/web/src/components/customer/journey/`. No generic chip exists in `components/ui`.
- Copy the style of `apps/web/src/pages/CollectionsPage/components/CallResultChips.tsx:73-133`, the closest analogue (a channel/result picker):
  - row label: `text-xs font-medium text-muted-foreground mb-1.5 leading-snug`
  - row: `flex flex-wrap gap-1.5`
  - chip: `<button type="button" aria-pressed>` with `rounded-full border px-3 py-1 text-xs leading-snug transition-colors`
  - idle: `border-input bg-card text-foreground hover:bg-accent`
  - on: `border-primary bg-primary text-primary-foreground`
  - disabled: `disabled:opacity-40`
- The alternative is the dossier pill: `h-8 rounded-full … ring-[3px] ring-primary/15` (`apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx:604-625`).
- **DEFAULT:** use the CallResultChips style everywhere, with a `size` prop for the dossier. Board B5(d) compares the two styles.

**Shared label maps**
- Move `TOUCH_CHANNELS` / `OUTCOMES` from `apps/api/src/modules/customer-journey/sources/entries.source.ts:28-30` into `packages/shared/src/customer-journey.ts`.
- Put them next to `JOURNEY_LOST_REASON_LABELS` (:73-79) and `JOURNEY_HEARD_FROM_LABELS` (:82-92).
- Also export them as const arrays, so DTOs can use `@IsIn`.

**`ResponsiveChooser`**
- Switches on `useIsMobile()` (`apps/web/src/hooks/useIsMobile.ts:3-19`: 1024px breakpoint, initial value `false`).
- Mobile: `Sheet side="bottom"` with `rounded-t-2xl max-h-[80vh] overflow-y-auto`, plus `SheetHeader`/`SheetTitle` and an sr-only `SheetDescription`. Precedent: `apps/web/src/pages/UnifiedInboxPage/components/customer360/CustomerContractDialogs.tsx:104-124`.
- Desktop: `Popover` with `PopoverContent align="end" className="w-80"`. The default `w-72` (`apps/web/src/components/ui/popover.tsx:18-28`) wraps 7 outcome chips onto 3+ lines.

**Mutation hooks**
- `useRecordJourneyEntry(customerId)` and `useDeleteJourneyEntry(customerId)`.
- On success:
  1. `queryClient.setQueryData(['customer-journey-summary', id], res.summary)`
  2. `invalidateCustomerJourney(qc, id)` (`apps/web/src/pages/CustomerDetailPage/hooks/useCustomerJourney.ts:18-21`), which refreshes the strip, the tab and RecentActivityCard.
- **Move** these hooks, `useJourneySummary` and the invalidation helper to a shared location (e.g. `apps/web/src/hooks/customer-journey/`). POS, ContractCreate and RoomDossier all need them, and importing across pages is a smell.

**Role gate**
- `JOURNEY_RECORD_ROLES = ['OWNER','BRANCH_MANAGER','FINANCE_MANAGER','SALES']` in `apps/web/src/lib/constants.ts`, mirroring the POST `@Roles`. Pattern: `CUSTOMER_CREATE_ROLES` (:88-93).
- ACCOUNTANT can view the tab but gets 403 on writes. ACCOUNTANT also cannot see group `chat`, where every manual row lives (`packages/shared/src/customer-journey.ts:65-70`). ⇒ **Hide every manual control for ACCOUNTANT.**

**Toast**
- The real Toaster is raw `sonner` with `position="top-right" richColors closeButton` (`apps/web/src/main.tsx:114`).
- `components/ui/sonner.tsx` is **not mounted**, so mockups must show the richColors look.
- Pattern (as in `apps/web/src/pages/UnifiedInboxPage/index.tsx:384-393`):
  `toast.success('บันทึกแล้ว', { duration: 10000, action: { label: 'เลิกทำ', onClick } })`
- Undo success → `toast.success('เลิกทำแล้ว')`. Failure → `toast.error(getErrorMessage(err))`.
- **DEFAULT duration: 10s.** `CollectionsPage/hooks/useUndoMutation.ts` uses 10-30s.

### 2.1 (ค) "+ บันทึกการติดต่อ" — journey tab

**Where**
- `apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx:87-124`.
- Wrap the chip header in `flex items-center justify-between gap-2`.
  - Left: `TimelineFilterChips`.
  - Right: `Button variant="outline" size="sm"` (h-7, text-xs) with lucide `Plus` and the label "บันทึกการติดต่อ".
- On mobile the button drops to its own full-width row.
- JourneyTab currently gets only `customerId` and `role` (`apps/web/src/pages/CustomerDetailPage/index.tsx:189-193`). Add `summary` (or call `useJourneySummary` — same key, no extra request) and `canRecord`.

**Interaction**
1. Tap the button → the chooser opens with title "บันทึกการติดต่อ".
2. **Row 1 "ช่องทาง":** โทร · แชทในแอป FB · LINE · หน้าร้าน (codes PHONE/FB_APP/LINE_APP/WALK_IN, spec §429).
   - Pre-selected from localStorage `customerJourney.lastChannel.v1`: wrap in try/catch and validate against the shared list (pattern `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx:203-218`).
   - Nothing remembered → no channel selected, the outcome row is disabled, and a `text-2xs` hint reads "เลือกช่องทางก่อน".
   - **DEFAULT: no `OTHER` chip here** (it is a valid code, but the spec lists 4).
3. **Row 2 "ผล":** นัดแล้ว · มาร้านแล้ว · ขอคิดก่อน · งบ/ดาวน์ไม่พอ · ไม่รับสาย · ซื้อที่อื่น · ไม่สนใจ (APPOINTED/VISITED/THINKING/BUDGET/NO_ANSWER/BOUGHT_ELSEWHERE/NOT_INTERESTED).
4. **Tap an outcome = save immediately.**
   - The tapped chip shows lucide `Loader2 size-3 animate-spin`.
   - **Every chip is disabled while the request is pending** (double-tap guard).
   - On 201: store the channel, close the chooser, show the undo toast.
5. **Lost prompt for BOUGHT_ELSEWHERE / NOT_INTERESTED.** The chooser stays open and its body becomes one line: "ติดป้ายหลุดไหม" + `Button variant="outline"` (destructive tone) "ใช่ ติดป้ายหลุด" + ghost "ไม่ต้อง".
   - "ใช่" posts MARKED_LOST with the reason mapped 1:1.
   - Hidden when `summary.stage === 'PURCHASED'`.
6. **Collapsed extras** (text-xs text-primary links under the outcome row): **"เพิ่มโน้ต"** and **"เปลี่ยนเวลา"**.
   - While either is open, tapping an outcome only *selects* it, and a primary sm "บันทึก" button appears. Otherwise a typed note would be lost.
   - Note: `Textarea variant="sm" maxLength={140}`, a `{n}/140` counter, and a `text-2xs` warning "ห้ามใส่เบอร์โทรหรือเลขบัตร".
   - Time: `apps/web/src/components/ui/ThaiDateInput.tsx` plus a time input, allowed range now−7d … now.

**States**
- Summary loading → button disabled.
- Pending → chips disabled + spinner.
- Error → `toast.error(getErrorMessage(err))`; the chooser stays open with its selections kept.

**Timeline rows**
- The read side already ships (`entries.source.ts:84-103`). Titles:
  - "ติดต่อทาง{ช่องทาง}: {ผล}"
  - "ลูกค้าบอกว่ารู้จักร้านจาก{x}"
  - "ติดป้ายหลุด: {เหตุผล}"
  - "เปิดใหม่"
- All rows are group chat, with the actor in the subtitle. Draw them in `apps/web/src/components/timeline/EventTimeline.tsx:48-116` format.

**Row-level undo** (the toast is gone after 10s; the server allows 24h)
- Use the `renderExtra` slot of EventTimeline for a "เลิกทำ" link: `text-xs text-primary hover:underline`.
- The server must send `entryId`, `undoableUntil` and `canDelete`. The web cannot compute the window: `JourneyEvent.timestamp` is `occurredAt`, which can be backdated.

**Data written**
- `CustomerJourneyEntry` (`apps/api/prisma/schema.prisma:6844-6876`; no migration needed):
  - `origin=MANUAL`, `kind=TOUCHPOINT`, `channel`, `outcome`
  - `note?` (≤140, no digit runs)
  - `occurredAt` (server now, or a clamped client value)
  - `roomId` null on this surface
  - `actorType=STAFF`, `actorUserId=me`, `data=null`, `dedupeKey` per §3

**PDPA**
- `note` is never selected on read (`entries.source.ts:67`) and not granted to MCP (`.claude/mcp/sql/policy.mjs:68-77`).
- `apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts:60` forbids the key `note` in responses.
- It must also be redacted from `audit_logs` (§3).

### 2.2 (ง) Lost / reopen on the stage strip

**Where**
- `apps/web/src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx:88-101`, the right badge cluster.
- Today it renders only when the customer is lost or silent. Change the condition to `lost || silent || canRecord`.
- New props: `customerId`, `canRecord`.

**By state**
- **Not lost and not PURCHASED:** `Button variant="ghost" size="sm"` "ติดป้ายหลุด" (lucide `UserX` size-3.5, muted).
  - Tap → ResponsiveChooser "ติดป้ายหลุด — เพราะอะไร" with 5 chips: ไม่สนใจ / ซื้อที่อื่น / เครดิตไม่ผ่าน / ติดต่อไม่ได้ / อื่น ๆ (`JOURNEY_LOST_REASON_LABELS`).
  - **DEFAULT: tap = save** (2 taps total). Optional "เพิ่มโน้ต".
  - Toast: "ติดป้ายหลุดแล้ว · เลิกทำ".
- **Lost:** the existing `Badge variant="destructive" appearance="light" size="md"` "หลุด · {reason}", followed by `Button variant="outline" size="sm"` "เปิดใหม่" (lucide `RotateCcw`).
  - One tap, no confirm dialog. Toast: "เปิดใหม่แล้ว · เลิกทำ".
- **PURCHASED:** no buttons. The silent badge is unchanged.

**Layout**
- The 5 steps are `min-w-[9rem]` and already wrap. On mobile, put the cluster under the `<ol>` with `w-full justify-end`.

**Data**
- `MARKED_LOST` (`lostReason`, `note?`) / `REOPENED`, with **server** time.

### 2.3 (ข) Heard-from chips — journey banner + 3 create flows

**`HeardFromChips`**
- 9 chips in shared order: โฆษณา FB · เพจ/โพสต์ · TikTok · LINE · Google · เพื่อนแนะนำ · ผ่านหน้าร้าน · ลูกค้าเก่า · อื่น ๆ.
- Heading: "ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)" (`text-xs font-medium text-muted-foreground`).
- A ghost "ข้าม" link on the right. Single-select.

| Host | File / placement | Save timing |
|---|---|---|
| **Journey tab banner** | First child of `JourneyTab.tsx`. Style: `rounded-lg border border-primary/20 bg-primary/5 p-3` (from `apps/web/src/pages/CustomerDetailPage/components/ContractReturnNotice.tsx:13`). Shown when `summary.heardFrom === null && canRecord`, **including buyers**. | Tap = POST now. The banner collapses to "ลูกค้าบอกว่ารู้จักร้านจาก{x} · เลิกทำ", then hides. "ข้าม" = hide for this session (sessionStorage per customer); it reappears next visit, following spec "จนกว่าจะตอบ". |
| **CustomerCreateDialog** (create mode) | `apps/web/src/components/customer/CustomerCreateDialog.tsx`, end of the always-open "ข้อมูลหลัก" card (~after :620). Chip state is local `useState`, not part of `customerSchema`. **DEFAULT: hidden in fill mode.** | Chained inside `mutationFn` after `POST /customers` returns an id: `await api.post('/customers/:id/journey/entries', …).catch(warn)`. The dialog unmounts in onSuccess (:118-146). A failure never blocks creation: `toast.warning('บันทึกลูกค้าแล้ว แต่บันทึกช่องทางที่รู้จักไม่สำเร็จ')`. On the 409 "ใช้ลูกค้าเดิม" path, post to the existing id. |
| **POS quick-create** | `apps/web/src/pages/POSPage/components/CustomerSearch.tsx:192-236`. This is a 2-field Dialog, **not** CustomerCreateDialog. Chips go between the phone input and DialogFooter. | Chained after create. Keep the chip value until success — there is no 409 handling there. |
| **ContractCreatePage step 1** | `apps/web/src/pages/ContractCreatePage/components/CustomerSelectStep.tsx`: a card between the active-contract banner and the credit box, for the **selected** customer when `heardFrom` is null. This covers new customers from `CustomerCreateModal.tsx` (untouched) and existing ones. | Tap = POST now + undo toast. |

**Rules**
- **Never** put `heardFrom` in the `POST /customers` body. With `whitelist:true` and `forbidNonWhitelisted` off (`apps/api/src/app.setup.ts:165-173`), it would be silently dropped. It would also flirt with R14/R24 (acquisitionSource must stay untouched).
- "Answer again = edit" needs no update path: append a new entry. The SQL takes the newest (`journey-state.sql:78-84`), and an undo falls back to the previous answer.
- The create flows are OWNER/BM/SALES only (`apps/api/src/modules/customers/customers.controller.ts:281`, `apps/web/src/App.tsx:502,546`). FM can answer only from the banner.

### 2.4 (จ) RoomDossier chip bar

**Where**
- `RoomDossier.tsx`: a new `<Group label="บันทึกการติดต่อ">` right after the ข้อมูลลูกค้า group (:629-680).
- Group style: `rounded-[10px] border border-border bg-card px-3 pb-3 pt-2.5`, header `text-[12.5px] font-bold`.

**Visibility** — **DEFAULT:**
- shown for placeholders **and** for linked customers who have not bought (owner definition: not bought = prospect)
- hidden for buyers and for unlinked rooms

**Content**
- Channel row pre-selected from `room.channel`: FACEBOOK→FB_APP, LINE_SHOP/LINE_FINANCE→LINE_APP, TIKTOK/WEB→OTHER. This overrides localStorage; OTHER appears only here.
- Outcome row with instant save; `roomId: room.id` attached.
- A small link row "ติดป้ายหลุด / เปิดใหม่".
- A heard-from row when it is still null.
- It must render **inline**. Below xl the dossier is already a right Sheet (`UnifiedInboxPage/index.tsx:687-714`), so a nested popover/sheet is not allowed. At 320px wide the chips wrap to about 3 rows.

**Double count**
- The header "ตั้งนัด" already creates a Todo → APPOINTMENT event (`apps/api/src/modules/customer-journey/sources/chat.source.ts:69-70`).
- **DEFAULT:** after "นัดแล้ว", the toast gets a second action "ตั้งนัด" that opens the existing TodoForm. No automatic todo.
- Do not reuse the label "บันทึกติดต่อ + นัดชำระ" (`Customer360Panel.tsx:655-659`).

**Data**
- The dossier needs `useJourneySummary(customerId)`, a new GET. Update the mocks in `RoomDossier.test.tsx:235-249`.

### 2.5 (ก) Same-person hint at sale (last task)

**Component**
- Extract `apps/web/src/components/customer/SamePersonHint.tsx` from `RoomDossier.tsx:196-252`.
- Style: `rounded-lg border border-primary/35 bg-primary/5 px-2.5 py-2 text-xs leading-snug`, lucide `Users` size-3.5.
- Copy: "อาจเป็นผู้สนใจ {Facebook/LINE…} ชื่อ **{name}** · ทักมา {date}".
- Buttons: `Button primary sm` "ใช่ รวมประวัติแชท" and `Button ghost sm` "ไม่ใช่".

**Placement**
- POS: under the selected-customer block `bg-muted rounded-lg p-3` (`CustomerSearch.tsx:110-127`), and right after a quick-create succeeds.
- ContractCreate: a card `mt-4 rounded-xl border border-primary/35 bg-primary/5 p-4` between the selected list and the credit box.

**Actions**
- **"ใช่" → `ConfirmDialog`** (`apps/web/src/components/ui/ConfirmDialog.tsx:28`), not an undo toast, because the merge is irreversible.
  - Body: "ย้ายห้องแชท N ห้อง และผลเช็คเครดิตมาไว้ที่ลูกค้า {name} · ย้อนกลับไม่ได้".
  - Confirm → `POST /customers/{candidate}/absorb-into/{selected}` (`customers.controller.ts:296-316`) → toast "รวมเป็นคนเดียวกันแล้ว".
- **"ไม่ใช่"** → dismiss + an undo toast.

**Rules**
- Never blocks checkout.
- Hidden when the selected customer already has a live chat room.
- When `canMerge=false`, the button is disabled with a truthful Thai reason:
  - room held by another staff member — R26, `apps/api/src/modules/chat-prospects/customer-merge.service.ts:113-125`
  - blocking relations — `customer-merge.service.ts:26-33`
- Roles: OWNER/BM/FM/SALES.

---

## 3. API contract

Module: `apps/api/src/modules/customer-journey/`. It must stay import-free (`customer-journey.module.ts:9-12`). Import `BOUGHT_WHERE` (`customers/services/customer-query.service.ts:43`) and `roomAssignmentScope` (`credit-check/services/room-credit-access.ts:10-12`) by file path only, as the existing sources do.

### Shared types (`packages/shared/src/customer-journey.ts`)

```ts
export const JOURNEY_TOUCH_CHANNELS = ['PHONE','FB_APP','LINE_APP','WALK_IN','OTHER'] as const;
export const JOURNEY_TOUCH_CHANNEL_LABELS: Record<JourneyTouchChannel, string>; // โทร · แชทในแอป FB · LINE · หน้าร้าน · อื่น ๆ
export const JOURNEY_TOUCH_OUTCOMES = ['APPOINTED','VISITED','THINKING','BUDGET','NO_ANSWER','BOUGHT_ELSEWHERE','NOT_INTERESTED'] as const;
export const JOURNEY_TOUCH_OUTCOME_LABELS: Record<JourneyTouchOutcome, string>;
export type JourneyManualEntryInput =
  | { kind: 'TOUCHPOINT'; channel; outcome; note?; occurredAt?; roomId?; clientRequestId? }
  | { kind: 'HEARD_FROM'; heardFrom; clientRequestId? }
  | { kind: 'MARKED_LOST'; lostReason; note?; clientRequestId? }
  | { kind: 'REOPENED'; clientRequestId? };
export interface JourneyEntryCreatedResponse { entryId: string | null; event: JourneyEvent | null; summary: JourneySummary }
// JourneyEvent gains (MANUAL rows only): entryId?: string; undoableUntil?: string | null; canDelete?: boolean
```

`entries.source.ts:28-30` then imports the shared maps (single source of truth).

### `POST /customers/:id/journey/entries`

**Roles and guards**
- `@Roles('OWNER','BRANCH_MANAGER','FINANCE_MANAGER','SALES')`, the same set as absorb-into/fill-contact (`customers.controller.ts:304-333`).
- Guards: JwtAuthGuard + RolesGuard + BranchGuard. `Customer` has no branchId, so no branch scope applies.

**DTO** (class-validator; the global ValidationPipe is at `app.setup.ts:172-178`)
- `kind`: `@IsIn(MANUAL kinds)`. Other fields use `@ValidateIf(o => o.kind === …)`.
- `channel`: `@IsIn(JOURNEY_TOUCH_CHANNELS)`. `outcome`: `@IsIn(JOURNEY_TOUCH_OUTCOMES)`.
- `lostReason`: `@IsIn` keys of `JOURNEY_LOST_REASON_LABELS`. `heardFrom`: `@IsIn` keys of `JOURNEY_HEARD_FROM_LABELS`.
- `note`: `@IsOptional @IsString @MaxLength(140)` plus a custom `@NoLongDigitRun()`.
  - Normalize ๐-๙→0-9 and strip `.()` before testing `/\d[\d\s-]{8,}\d/`.
  - Message: **'ห้ามใส่เบอร์โทรหรือเลขบัตรในบันทึก'**.
  - Trim; an empty string becomes null.
- `occurredAt`: `@IsOptional @IsISO8601`. Values earlier than now−7d or later than now+2min → 400 **'เลือกเวลาได้ย้อนหลังไม่เกิน 7 วัน'**. Otherwise clamp to `min(value, now)`.
- `roomId`: `@IsOptional @IsUUID` (TOUCHPOINT only).
- `clientRequestId`: `@IsOptional @IsUUID`.

**Service `JourneyManualEntryService.create(customerId, dto, actor)`**

**Do not reuse `JourneyEntryWriter`.** It drops non-SYSTEM kinds and swallows errors (`journey-entry-writer.service.ts:66-107`).

1. **Resolve the target.** If the customer has `deletedAt` + `mergedIntoId`, follow the chain to the live target (same logic as `journey-summary.service.ts:53-70`). Missing → 404 **'ไม่พบลูกค้า'**. Write `customerId = originCustomerId = target`.
2. **Kind rules** — read `BOUGHT_WHERE` and the latest non-deleted MARKED_LOST/REOPENED over the family:
   - MARKED_LOST on a buyer → 409 **'ลูกค้ารายนี้ซื้อแล้ว ติดป้ายหลุดไม่ได้'**
   - MARKED_LOST while already lost → **DEFAULT: allowed** (changes the reason)
   - REOPENED while not lost → **DEFAULT: 200 no-op** with `{ entryId: null, event: null, summary }`; the toast says "เปิดอยู่แล้ว"
3. **roomId check.** It must be a live `chat_room` with `customerId ∈ family`, and for SALES it must be inside `roomAssignmentScope(actor)`.
   - Otherwise 400 **'ห้องแชทนี้ไม่ใช่ของลูกค้ารายนี้'** or 403 **'ไม่มีสิทธิ์เข้าถึงห้องแชทนี้'**.
   - Without this, SALES could write a row they cannot see (`entries.source.ts:76-87`).
4. **Time.** HEARD_FROM / MARKED_LOST / REOPENED get server now. TOUCHPOINT gets the clamped client value. The lost logic compares `occurred_at` (`journey-state.sql:203-221`).
5. **Dedupe.** If `clientRequestId` is present, `dedupeKey = 'MANUAL:' + clientRequestId`. A P2002 conflict returns the existing row as 200.
   - This deviates from the spec's "MANUAL: null" (Q6). **DEFAULT: adopt**; the web sends one UUID per chooser open.
6. `prisma.customerJourneyEntry.create({ origin: 'MANUAL', actorType: 'STAFF', actorUserId, data: null, … })`.
7. `try { await journeyState.recompute([targetId]) } catch (e) { Sentry.captureException(e, { tags: { subsystem: 'customer-journey' } }) }`.
   - Without this the summary is stale: `needsRecompute` skips caches younger than 15 min (`journey-summary.service.ts:76-81`).
   - `recompute` throws (`journey-state.service.ts:37-43`).
8. `summary = summaryService.summary(targetId, actor)`; `event = manualEntryToEvent(row, actorUser, actor)`. This is a pure mapper extracted from `entries.source.ts:84-103`, so the list and POST cannot drift.
9. Return **201** `{ entryId, event, summary }`.

**Audit**
- The global `AuditInterceptor` logs the body (`apps/api/src/modules/audit/audit.interceptor.ts:22-54`).
- **Add `note` to `SENSITIVE_FIELDS`** in `audit-sanitize.util.ts:1-17`. Otherwise free text lands in immutable `audit_logs` that DSAR deletion does not reach (`apps/api/src/modules/pdpa/pdpa.service.ts:283-305`).
- No extra domain audit row is needed; the entry itself (actor, createdAt, deletedById) is the trail.
- If one is added later, write it after commit, never `audit.log` inside `$transaction` (`.claude/rules/database.md`).

### `DELETE /customers/:id/journey/entries/:entryId`

- Roles: the same 4. The service decides ownership.
- Resolve the family of `:id` (redirect-follow).
- Errors:
  - entry missing, or `customerId ∉ family` → 404 **'ไม่พบรายการนี้'**
  - `origin !== 'MANUAL'` → 400 **'ลบได้เฉพาะรายการที่พนักงานบันทึกเอง'**
- Allowed if `role ∈ {OWNER, BRANCH_MANAGER}`, **or** `actorUserId === user.id && now − createdAt ≤ 24h`. Use `createdAt`, not `occurredAt`.
  - Otherwise 403 **'ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง'**.
- Already deleted → 200 no-op (covers a double-clicked "เลิกทำ").
- Write as CAS: `updateMany({ where: { id, origin: 'MANUAL', deletedAt: null }, data: { deletedAt: now, deletedById: user.id } })`. Then recompute (try/catch) → 200 `{ summary }`.
- The activity probes already count `deleted_at` (`sql/journey-activity-probe.sql:5`, `sql/journey-active-since.sql:5`).

### Read-side additions

- `entries.source.ts` adds `entryId`, `undoableUntil` and `canDelete` for MANUAL rows.
  - `undoableUntil` = author only, `createdAt + 24h`, null once expired.
  - `canDelete` = OWNER/BM, or the author inside the window.
  - It still **never selects `note`**.
- `customer-journey.service.ts:41`: drop the notRecorded line "ลูกค้าหน้าร้านรู้จักร้านจากไหน".
- Derived event "กลับมาติดต่ออีกครั้ง": the first CUSTOMER message after the latest active MARKED_LOST. Group chat, stage null.

### Same-person endpoints (task 9)

**`GET /customers/:id/possible-same-person`** (OWNER/BM/FM/SALES)
- `CustomersModule` already imports `ChatProspectsModule` (`apps/api/src/modules/customers/customers.module.ts:16,22-24`).
- New `SamePersonService.findForCustomer`, extracting the shared core from `same-person.service.ts:27-110`.
- Candidates are live placeholders only. Returns `[]` when the customer already owns a live room.
- Each hint gets `canMerge` + `blockedReason`, using the same predicates as `assertActorMayAbsorb` and `BLOCKING_RELATIONS`.

**`PATCH /customers/:id/same-person/dismiss { candidateId }`**
- Pushes `:id` into `dismissedSamePersonIds` of the candidate's live rooms (`schema.prisma:5377-5378`, no migration).
- Idempotent: skip if the id is already present.
- SALES room-hold rule → 403.

**Other**
- `…/undismiss` removes the id (for the undo toast).
- The merge itself reuses `absorb-into` unchanged.

---

## 4. Mockup boards

The approved canvas (`scratchpad/customer-detail-mockup/canvas.json`) has **no journey boards**. `journey.mjs` / `JourneyPreview.dc.html` were never published and contradict both the spec and the shipped code. Their problems:
- post-sale stages
- a save button
- 5 outcomes instead of 7
- a date field
- a connector-line strip

**Draw from the shipped components.** Reuse the `gen.mjs` helpers (`T`, `tint`, `icon`, `btn`, `badge`, `card`, `tabs`, `shell`) and embed B1/B3 inside the real page shell via `boardMain` / `boardProspect(mainOverride)`.

Two `gen.mjs` corrections:
- `cardHeaded` must use min-height **56px** (the real CardHeader is `min-h-14`, `apps/web/src/components/ui/card.tsx:35`).
- **Do not use `T.amber`** (#D97706 has no CSS token).

| # | Board | Purpose | States |
|---|---|---|---|
| B1 | Journey tab, desktop 1440 (prospect) | Placement of "+ บันทึกการติดต่อ", heard-from banner, manual rows | (a) default with heard-from banner · (b) popover open, channel remembered · (c) after tap: top-right toast "บันทึกแล้ว · เลิกทำ" + new row "ติดต่อทางโทร: นัดแล้ว" with "เลิกทำ" link + strip caption "พนักงานบันทึก" on สนใจจริง · (d) lost prompt "ติดป้ายหลุดไหม [ใช่ ติดป้ายหลุด] [ไม่ต้อง]" · (e) note + time expanded ("บันทึก" button) with the 400 error "ห้ามใส่เบอร์โทรหรือเลขบัตรในบันทึก" |
| B2 | Journey tab, mobile 390 | Bottom sheet | (a) no remembered channel → outcomes disabled + hint · (b) pending spinner on the tapped chip · (c) toast on mobile |
| B3 | Stage strip (1440 + 390) | Lost / reopen | (a) prospect not lost → ghost "ติดป้ายหลุด" · (b) 5-reason chooser · (c) lost → badge "หลุด · ซื้อที่อื่น" + outline "เปิดใหม่" · (d) silent + not lost · (e) PURCHASED → no button · (f) ACCOUNTANT → no controls |
| B4 | Heard-from in create flows | Pixel-accurate chip row inside the real dialogs | (a) CustomerCreateDialog, end of ข้อมูลหลัก · (b) POS 2-field quick-create Dialog · (c) ContractCreatePage step-1 card, unanswered and answered-with-undo · (d) warning toast when saving the chip fails after create |
| B5 | Inbox RoomDossier, 320px | (จ) | (a) placeholder + new Group, channel pre-selected "แชทในแอป FB" · (b) after "นัดแล้ว": toast with "เลิกทำ" + "ตั้งนัด" · (c) linked non-buyer · (d) chip-style comparison: CallResultChips vs dossier h-8 pill |
| B6 | Same-person hint at sale | (ก) | (a) POS selected customer + hint · (b) ContractCreate step 1 + hint · (c) ConfirmDialog "ย้อนกลับไม่ได้" · (d) disabled "รวม" with the reason "ห้องแชทนี้มีพนักงานอื่นดูแลอยู่" · (e) "ไม่ใช่" undo toast |
| B7 | Timeline row catalogue | Final copy for every title | TOUCHPOINT ×7 outcomes, HEARD_FROM, MARKED_LOST ×5, REOPENED, "กลับมาติดต่ออีกครั้ง", rows with and without "เลิกทำ" |

### Token table (light theme — `apps/web/src/index.css:265-297`; hex from `gen.mjs:5-8`)

| Token | HSL | Hex | Used for |
|---|---|---|---|
| `--background` | 40 23% 97% | #F9F8F6 | page ground, sheet body |
| `--card` / `--popover` | 40 20% 99% | #FDFDFC | cards, idle chip bg, popover |
| `--foreground` | 25 14% 12% | #231E1A | idle chip text, titles |
| `--muted` / `--accent` | 36 14% 93% | #F0EEEB | chip hover, POS selected block |
| `--muted-foreground` | 25 8% 42% | #746A63 | row labels, captions, hints |
| `--border` / `--input` | 34 12% 88% | #E4E1DD | idle chip border, card border |
| `--primary` | 160 84% 32% | #0D9668 | chip on, primary button, banner (/5 bg, /20 border), hint box (/5, /35) |
| `--primary-foreground` | 0 0% 100% | #FFFFFF | chip on text |
| `--ring` | 160 84% 39% | — | focus ring |
| `--success` | 142 71% 45% | #21C45D | done dots, richColors success toast |
| `--warning` | 38 92% 50% | #F59F0A | "เงียบ N วัน" badge (/10) |
| `--destructive` | 0 84.2% 60.2% | #EF4444 | "หลุด" badge (/10), destructive text |
| `--radius` | 0.5rem | 8px | rounded-lg (rounded-md = 6px) |

| Metric | Value | Source |
|---|---|---|
| Font | Inter + IBM Plex Sans Thai; Thai text `leading-snug` | `index.css:12`, `.claude/rules/frontend.md` |
| Choice chip | `rounded-full border px-3 py-1 text-xs` (≈26px tall), gap 6px | `CallResultChips.tsx:73-133` |
| Tab filter chip | Button sm `h-7 px-2.5 text-xs`, count `text-[10px]` | `TimelineFilterChips.tsx:33-64` |
| Button sm / md | h-7 (28px) text-xs rounded-md / h-8.5 | `components/ui/button.tsx:38-43` |
| Badge md light | `rounded-full h-6 text-xs`, bg-tone/10 + tone text | `components/ui/badge.tsx:42-46` |
| Stage strip | `rounded-xl border-border/50 bg-card px-4 py-3 shadow-sm`; dots size-6; label 13px medium; caption 12px | `JourneyStageStrip.tsx:38-104` |
| Timeline row | size-8 round icon (chat = MessageCircle on primary/10); meta `text-[10px]`; title `text-sm font-medium`; subtitle `text-xs` | `EventTimeline.tsx:48-116`, `eventTimelineStyles.ts:27-36` |
| Popover | use `w-80`; `rounded-md border p-4 shadow-md shadow-black/5` | `popover.tsx:18-28` |
| Bottom sheet | Sheet bottom `rounded-t-2xl max-h-[80vh] p-6`; overlay `bg-black/30 backdrop-blur-xs` | `components/ui/sheet.tsx:30-48` |
| Dossier | aside `w-80`; Group `rounded-[10px] px-3 pb-3 pt-2.5`, header 12.5px bold; pill h-8 | `RoomDossier.tsx:118-146, 604-625` |
| Toast | sonner raw, top-right, richColors, closeButton | `main.tsx:114` |
| Textarea sm | `text-xs px-2.5 py-2.5 rounded-md` | `components/ui/textarea.tsx:5-30` |

---

## 5. Risks and open questions

### Engineering risks (each with its mitigation)

1. **Duplicate rows from double taps.** MANUAL `dedupeKey` is null, and the unique index allows many NULLs (`schema.prisma:6868`). → Disable chips while pending, and use the `clientRequestId` dedupe key.
2. **The note leaks into `audit_logs`.** → Add `note` to `SENSITIVE_FIELDS`, with a test.
3. **Stale summary, or a 500 after the row is committed.** → Explicit recompute in try/catch + Sentry.
4. **Clock skew hides the lost badge** (`journey-state.sql:218-221`). → Server-owned timestamps; clamp TOUCHPOINT times.
5. **Merged placeholder ids.** Entries move to the target on merge. → POST follows `mergedIntoId`; DELETE checks family membership.
6. **A foreign roomId makes the row invisible to its own author.** → Validate family + `roomAssignmentScope`.
7. **Reusing `JourneyEntryWriter` returns 201 while writing nothing.** → Use a separate service.
8. **Phone guard bypass** with Thai digits or dots. The ASCII regex also misses 9-digit landlines. → Normalize before testing.
9. **Channel/outcome labels drift** (they live only in the API). → Move to shared first (task 1).
10. **The web cannot compute the 24h undo window.** → Server sends `undoableUntil` / `canDelete`.
11. **Strip layout shifts for every prospect.** → On mobile the cluster moves below the steps; update `JourneyStageStrip.test.tsx`.
12. **Same-person merge risks.** It is irreversible, the hit-rate is low (exact normalized names, `SCAN_LIMIT 50` with no orderBy), and test data is mixed with real chat rooms (OD-11). → ConfirmDialog. Ship only after the prospect backfill is confirmed on prod and a count-only hit-rate check (no PII export).
13. **There are two create forms** (CustomerCreateDialog vs ContractCreatePage's own modal). → The contract flow uses the step-1 card; the modal is untouched.
14. **Inbox double counting** (Todo APPOINTMENT + TOUCHPOINT APPOINTED). → No automatic todo; the toast offers "ตั้งนัด" instead.
15. **Test mechanics.**
    - Radix popovers/dropdowns need `userEvent`; tabs need `mouseDown`.
    - The page test mock (`CustomerDetailPage.test.tsx:69-79`) must gain post/delete.
    - Never run `npm run lint` in apps/api (it runs `--fix`).
16. **The dossier nests inside a right Sheet below xl.** → Render the chips inline; do not nest a sheet.

### Business questions for the owner (recommended default in bold)

- **Q1 — Who reads the 140-character note?** Nothing returns it today: not the API, MCP or Excel. → **Keep it write-only for now, with warning text.** Showing it to the author and OWNER/BM is a later phase. The alternative is dropping the note entirely to remove PDPA risk.
- **Q2 — Strip "ติดป้ายหลุด": reason picker, or save OTHER instantly?** → **Reason picker; tapping a reason saves (2 taps).**
- **Q3 — Should "ไม่รับสาย" also ask "ติดป้ายหลุดไหม" (UNREACHABLE)?** → **No.** One missed call does not mean lost.
- **Q4 — REOPENED when the customer is not lost / MARKED_LOST when already lost?** → **No-op / allowed (changes the reason).**
- **Q5 — Undo window.** → **OWNER/BM may delete any manual entry at any time; FM/SALES only their own within 24h; the row-level "เลิกทำ" link stays visible for the whole window.**
- **Q6 — Idempotency key `MANUAL:<clientRequestId>` for manual writes** (deviates from the spec)? → **Yes.**
- **Q7 — "อื่น ๆ" channel chip?** → **Not on the customer page; only as a pre-selection from an inbox room.**
- **Q8 — Do FINANCE_MANAGER users get recording controls?** → **Yes** (POST roles include FM).
- **Q9 — Also put "+ บันทึกการติดต่อ" in the header ActionsMenu or ภาพรวม?** → **No for now; revisit after the 2-week metric.**
- **Q10 — What does "ข้าม" on heard-from do?** → **Hide for the session only. Show the banner to buyers too. Hide in fill mode and for existing customers selected at POS.**
- **Q11 — Heard-from in ContractCreate: only right after creating, or for any selected customer with no answer?** → **Any selected customer whose heardFrom is null.**
- **Q12 — Dossier chip bar for linked non-buyers? Lost/reopen in the dossier?** → **Yes to both (lost/reopen as a small link row).**
- **Q13 — Same-person hint details.**
  - Wording → **the spec's "ใช่ รวมประวัติแชท" at sale; the inbox keeps its current wording.**
  - Date shown → **creation date of the first chat room ("ทักมา …").**
  - Confirm step → **yes (2 taps).**
  - Duplicate real↔real customers → **not shown.**
  - Timing → **after the backfill is confirmed on prod.**
- **Q14 — Inbox-logged touchpoints disappear for other SALES once the room is reassigned** (`entries.source.ts:78-89`). Acceptable? → **Yes, consistent with room privacy (R19/R26).**

### Questions raised while drawing the boards (canvas https://claude.ai/code/artifact/c9e4920a-2402-4239-9f20-933b75904dc9)

- **Q15 — Stage-strip caption truncation** (B1 c, B2). `JourneyStageStrip` uses `block truncate text-xs`. At 1440 the caption "15/09/2569 · อยู่ขั้นนี้ 0 วัน · พนักงานบันทึก" needs 221px but the slot is 150px. Mobile already truncates today ("ได้เบอร์ / ยืนยันตัวตน"). Options: ก drop the day count when evidence=MANUAL · ข two-line caption (`line-clamp-2`) · ค truncate + `title`. → **ข two lines** (owner rule: fit by shrinking, never cut data; ค does not work on touch).
- **Q16 — Filter-chip row + record button wraps at 1440** (B1 a2). 9 OWNER chips + the new button push "ระบบ" to line 2. Options: ก items-center · ข items-start · ค the button on its own right-aligned row above the chips. → **ค** (all chips fit on one line; the button has a stable position).
- **Q17 — Mobile hit targets** (B2, B3). Today Button sm is h-7 (28px) and ChoiceChip is ~26px. → **`max-lg:h-11` (44px) on the record button, strip ghost/outline buttons, and the chooser chips; desktop unchanged.** Exempt the `aria-busy` chip from `disabled:opacity-40` so its spinner stays visible.
- **Q18 — Which field drives the row "เลิกทำ" link** (B7 e6a/e6b). ~~undoableUntil (author-only, 24h)~~ vs **`canDelete`** (OWNER/BM see it on everyone's manual rows). → **`canDelete`**, otherwise Q5's "OWNER/BM may delete any time" has no control.
- **Q19 — Popover outcome chips wrap to 3 rows at w-80** (B1 b). → **Accept** (still one tap).
- **Q20 — Disabled "รวม" reason** (B6 d). → **Visible 12px muted line under the button (info icon 14px)**, not the inbox's `title` tooltip (works on touch).

Implementation notes from the board reviews (not owner questions):
- Heard-from after create: `api.post(...).catch(warn)` inside `mutationFn` would fire the warning toast *before* `onSuccess`'s `toast.success('เพิ่มลูกค้าสำเร็จ')` (CustomerCreateDialog.tsx:204). Return a flag from `mutationFn` and show the warning in `onSuccess` after the success toast.
- "ContractCreate step 1" in this brief is 0-indexed; the UI shows it as "ขั้นตอน 2". The step-1 card also sits next to `TradeInCreditPicker` (index.tsx:111).
- "กลับมาติดต่ออีกครั้ง" rows link to `/inbox/:roomId` like the other chat rows.
- The chat icon is lucide-react 1.14 `message-circle` (rounded tail).

---

## 6. Suggested task breakdown (each independently testable)

1. **Shared contract.**
   - Scope: channel/outcome arrays + label maps; `JourneyManualEntryInput` / `JourneyEntryCreatedResponse`; `JourneyEvent.entryId/undoableUntil/canDelete`; `entries.source.ts` imports the shared maps; extract `manualEntryToEvent`.
   - Tests: existing entries.source titles still pass; shared typecheck.
2. **API: POST entries.**
   - Scope: DTO + `NoLongDigitRun` (normalizes Thai digits), `JourneyManualEntryService.create`, route. Redirect-follow, buyer 409, reopen no-op, roomId family/scope check, server time + 7-day clamp, clientRequestId dedupe, recompute try/catch, audit `note` redaction.
   - Tests: controller roles metadata; service unit tests for every error with its Thai message; DB spec (writes show up as summary heardFrom / lost / INTERESTED-by-manual; PDPA spec still has no `note`; audit row has the note redacted).
3. **API: DELETE + read-side undo fields + "กลับมาติดต่ออีกครั้ง".**
   - Scope: CAS soft delete, 24h/role matrix, family check, idempotent repeat, recompute; `undoableUntil`/`canDelete`; remove the stale notRecorded line; derived re-contact event.
   - Tests: unit matrix (author <24h / >24h, FM on another's row, BM any, SYSTEM row 400, wrong family 404); DB spec (lost → customer message → event appears and lost clears).
4. **Web foundation.**
   - Scope: move journey hooks to a shared location; `useRecordJourneyEntry` / `useDeleteJourneyEntry`; `ChoiceChip(Row)`; `ResponsiveChooser`; `JOURNEY_RECORD_ROLES`; safe localStorage helper.
   - Tests: vitest for chip aria-pressed/disabled, chooser switching Sheet/Popover, hook invalidating both keys.
5. **(ค) Record-contact chooser in JourneyTab + row undo.**
   - Tests: ACCOUNTANT sees no button; tapping an outcome sends the right POST body; a 400 keeps the chooser open; BOUGHT_ELSEWHERE shows the lost prompt → MARKED_LOST; the row "เลิกทำ" calls DELETE; the note mode requires "บันทึก".
6. **(ง) Stage-strip lost/reopen.**
   - Tests: B3 states a-f; a reason tap sends POST; reopen sends POST; PURCHASED hides the buttons.
7. **(ข) Heard-from chips.**
   - Scope: `HeardFromChips`; journey banner (session skip); CustomerCreateDialog chained post + warning; POS quick-create; ContractCreate step-1 card.
   - Tests: each host posts to the returned id; creation still succeeds when the entry post fails; the `/customers` payload never contains `heardFrom`; the banner hides once answered.
8. **(จ) RoomDossier chip bar.**
   - Scope: Group, room-channel mapping, roomId in the body, "ตั้งนัด" toast action, heard-from + lost links, inline rendering.
   - Tests: summary fixture; visible for placeholder and linked non-buyer, hidden for buyer; POST includes roomId; the existing "no /chat-summary for placeholder" assertion stays green.
9. **(ก) Same-person hint at sale** (gated on backfill readiness).
   - Scope: `findForCustomer` + canMerge/blockedReason; dismiss/undismiss endpoints; extract `SamePersonHint` (inbox unchanged); POS + ContractCreate with ConfirmDialog.
   - Tests: placeholder-only candidates; a customer with a room returns []; dismissed candidates excluded; SALES R26 gives canMerge=false; blocking relations; controller roles; web tests (confirm required, disabled reason shown, checkout never blocked).

**After launch (not a code task):** the 2-week metric —
`SELECT actor_user_id, count(*) FROM customer_journey_entries WHERE origin='MANUAL' AND deleted_at IS NULL AND created_at >= <launch> GROUP BY 1`.
