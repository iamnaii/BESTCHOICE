# Owner Decisions Pending (2026-06-22)

> These items are **decision-gated, not engineering-gated** — code work cannot proceed correctly
> until the owner/ops makes a call. Verified against current code (re: the 2026-06-22 repo survey +
> `docs/ceo-review/deep-audit-2026-06-11-findings.md` + `tier-8-fraud-heatmap-master.md`). Each entry
> states the decision needed, the options, a recommendation, and what it unblocks. **Do not start the
> code work until the decision is recorded here.**

---

## D1 — SHOP-side accounting JE wiring (deep-audit F3) — most material accounting gap

**State:** 7 of 8 `shop-*` JE templates have **zero production callers** (only `ShopExchangeReturnTemplate`
is wired, at `contract-exchange.service.ts:396`). So `/shop/accounting` Trial Balance + P&L are
near-empty even though SHOP is actively selling (real numbers live in the `Sale` table / Dashboard). A
disclaimer banner is already on `ShopAccountingPage.tsx`, so there is no misleading-report harm today.

**Decision needed:** At contract activation (and cash sale / trade-in accept), should the system post the
SHOP-side JEs, and should activation post **SHOP + FINANCE atomically** (Phase A.5 brief §4)?

- **Option A (recommended):** Approve atomic SHOP+FINANCE posting at activation; wire all 7 templates to
  their intended triggers (cash sale → `ShopCashSaleTemplate`; down payment → `ShopDownPaymentTemplate`;
  activation → `ShopInventoryTransfer` + `ShopFinanceReceipt`; trade-in accept → `ShopTradeInTemplate`;
  shop expenses → `ShopExpenseTemplate`). Reuse the existing idempotent `metadata.flow` + `CompanyResolverService`
  and the existing golden `.spec.ts` files as acceptance tests.
- **Option B:** Keep SHOP accounting non-authoritative (disclaimer stays); revisit at multi-entity split (D3).

**Unblocks:** real SHOP Trial Balance / P&L. **Effort:** LARGE. Also do deep-audit **X5** first (add
`companyCode:FINANCE` filter to PEAK sync) so SHOP JEs don't leak into the PEAK export.

---

## D2 — Tier-8 controls: 7 PARTIAL items (all owner/ops/design-gated)

Tracker (`tier-8-fraud-heatmap-master.md`): 44 DONE / 7 PARTIAL / 0 OPEN. None is a quick code patch.
The one item that can proceed **without** an owner sign-off is flagged ⚡.

| ID | Control | Decision needed | Rec. |
|----|---------|-----------------|------|
| ⚡ **T6-C5** | PEAK partial-sync has no retry/backoff | None for retry itself — add bounded retry/backoff on transient PEAK HTTP errors (does NOT touch JE numbers, no accountant sign-off). Confirm PEAK dedupes `/DailyJournals` on `code`/`reference` to close the POST-then-mark-fails double-post window. | Do when PEAK is enabled. **Downgrade from CRITICAL** — sync is self-healing via `peakSyncedAt=null` re-attempt; PEAK is unset in current env. |
| T3-C5 | OWNER-only payment reversal path missing | Feature/design: do you want a dedicated reverse-posted-payment flow, or does journal void→reversal (T2-C9) suffice? | Likely suffices → close, else build `reversePayment()`. |
| T4-C9 | LIFF OTP/lockout uses in-memory Map (not multi-node correct) | Infra: provision/standardize Redis, then move the per-`lineUserId` fail counter there. | Gate on Redis decision. |
| T5-C13 | `adjustShopWarranty` is unreachable (no endpoint) | Feature: expose warranty-end-date adjustment via endpoint+roles+UI through the gated `adjustShopWarranty`? | Owner call. **Note:** the tracker's "bypass writer at repair-warranty.service.ts:209" claim is **false** (that file is read-only) — fix the tracker; this is not a security gap, just a missing feature. |
| T6-C9 | PEAK credential reads not audited; rotation is monitor-only | Ops/design: rotation cadence + storage + add an `IntegrationAccessLog` (or reuse `AuditLog` READ action) on `getValue/getConfig`. | Pair with T6-C13. Cheapest v1 = log reads to existing `AuditLog`. |
| T6-C13 | MDM `apiKeyPrevious` declared but not used in service | Ops/design (pairs with T6-C9): make `mdm.service` read `apiKeyPrevious` during a grace window + retry on 401/403. | Decide rotation policy first. |
| T7-C9 | `/metrics` scrape token is a shared secret (manual dual-token rotation) | Ops/design: mTLS or OAuth + auto-rotation cron; needs scraper-side config decision. | Low priority. |

---

## D3 — Multi-entity legal split (roadmap Phase 6.1 / P3-SP7) — the one un-started big rock

**State:** system is **1 legal entity, 1 Postgres DB** partitioned by `companyCode` ('SHOP'/'FINANCE')
with an `S`-prefix CoA convention. No second Prisma client / separate SHOP DB exists.

**Decision needed:** Register the 2nd นิติบุคคล and commit to splitting? (Business + legal decision —
the real entity `บริษัท เบสท์ช้อยส์โฟน จำกัด` exists; see memory `company_legal_entity`.)

- If **yes**: stand up a 2nd legal company + 2nd DB/Prisma client; convert inter-company JEs'
  `from_company_id`/`to_company_id` into cross-company FKs; route SHOP JEs through `PairedJournalService`.
  Depends on D1 being wired first. **Effort:** LARGE.
- If **not yet**: stay single-DB partitioned (current). No code action.

---

## Low-value engineering debt (not owner-gated — listed for completeness)

- Split `expense-document-create.service.ts` (1061 LOC, 7 create-* methods) — behavior-preserving. LOW/MEDIUM.
- Chatbot Phase 7.2: route simple/no-tool queries to Haiku (`finance-ai.service.ts:99` hardcodes Sonnet) — cost saving, SMALL.
- Branch hygiene: ~23 fully-merged local branches safe to delete; ~33 stale rebase artifacts.
